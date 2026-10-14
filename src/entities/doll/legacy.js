// R.O.O.M. — legacy doll helpers (the original sack-doll head/torso shape functions, fabric
// materials and mouth atlas). Kept with unchanged behaviour for the modules that still build
// their own dolls on top of them (still lifes, healthity). The player avatar itself lives in
// ./doll_avatar.js. Re-exported by avatar.js.
import * as THREE from 'three';
import { labelTexture } from '../../gfx/textures.js';
import { RNG, valueNoise2, hash01, tileFbm } from '../../core/rng.js';
import { G, surfaceGrid, paint, cached, canvasTex, mkCanvas, clamp, lerp } from './kit.js';

const PI = Math.PI, TAU = PI * 2;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

// Generic fabric: fn(x, y, W, H, o) sets o.r,o.g,o.b (0..1) and o.h (height 0..1).
// post(ctx, W, H) may paint on top of the colour map. Returns {map, normalMap} with
// repeat = 1/tile, so geometry UVs are expected in metres.
export function fabricTex(key, size, tile, fn, { normal = 2, post = null } = {}) {
  return cached('fab_' + key, () => {
    const W = size, H = size;
    const hgt = new Float32Array(W * H);
    const cc = mkCanvas(W, H), cx = cc.getContext('2d');
    const img = cx.createImageData(W, H), d = img.data;
    const o = { r: 0, g: 0, b: 0, h: 0 };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      fn(x, y, W, H, o);
      const i = y * W + x;
      d[i * 4] = clamp(o.r * 255, 0, 255); d[i * 4 + 1] = clamp(o.g * 255, 0, 255); d[i * 4 + 2] = clamp(o.b * 255, 0, 255); d[i * 4 + 3] = 255;
      hgt[i] = o.h;
    }
    cx.putImageData(img, 0, 0);
    if (post) post(cx, W, H, hgt);
    const nc = mkCanvas(W, H), nx = nc.getContext('2d');
    const ni = nx.createImageData(W, H), nd = ni.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W, xr = (x + 1) % W, yu = (y - 1 + H) % H, yd = (y + 1) % H;
      const dx = (hgt[y * W + xr] - hgt[y * W + xl]) * normal, dy = (hgt[yd * W + x] - hgt[yu * W + x]) * normal;
      const l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
      nd[i] = (-dx / l * 0.5 + 0.5) * 255; nd[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    nx.putImageData(ni, 0, 0);
    const mk = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
      return t;
    };
    return { map: mk(cc, true), normalMap: mk(nc, false), tile };
  });
}
const hsh = (x, y, s = 0) => hash01(x, y, 0, s);

// --- burlap / hessian: coarse plain weave with gaps, slubs and fuzz
export const burlapTex = () => fabricTex('burlap', 256, 0.085, (x, y, W, H, o) => {
  const P = 16, i = Math.floor(x / P), j = Math.floor(y / P), u = (x % P) / P, v = (y % P) / P;
  const wH = 0.74 + (hsh(j, 3, 11) - 0.5) * 0.2, wV = 0.74 + (hsh(i, 5, 12) - 0.5) * 0.2;
  const ph = Math.abs(v - 0.5) * 2 / wH, pv = Math.abs(u - 0.5) * 2 / wV;
  const top = (i + j) % 2 === 0;
  const hor = ph < 1 ? Math.sqrt(1 - ph * ph) * (top ? 1 : 0.55) * (0.8 + 0.2 * Math.sin(u * PI)) : 0;
  const ver = pv < 1 ? Math.sqrt(1 - pv * pv) * (top ? 0.55 : 1) * (0.8 + 0.2 * Math.sin(v * PI)) : 0;
  const h = Math.max(hor, ver);
  const which = hor >= ver ? hsh(j, 7, 13) : hsh(i, 9, 14);
  const grain = hsh(x, y, 15) * 0.08;
  let t = h > 0 ? 0.62 + h * 0.3 + (which - 0.5) * 0.16 + grain : 0.22 + grain;
  const dirt = tileFbm(x / W * 3, y / H * 3, 3, 3, 3, 16);
  t *= 0.9 + dirt * 0.18;
  o.r = t * 1.0; o.g = t * 0.95; o.b = t * 0.86; o.h = h * 0.8 + grain;
}, {
  normal: 2.6,
  post(ctx, W, H) {
    const r = new RNG(21);
    for (let k = 0; k < 900; k++) {
      const x = r.next() * W, y = r.next() * H, a = r.next() * TAU, l = 3 + r.next() * 10, v = 170 + Math.floor(r.next() * 70);
      ctx.strokeStyle = `rgba(${v},${v - 10},${v - 30},${0.25 + r.next() * 0.35})`; ctx.lineWidth = 0.5 + r.next() * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  },
});

// --- nylon/poly fabric for coveralls and jackets: soft wrinkles + fine weave
export const nylonTex = () => fabricTex('nylon', 256, 0.3, (x, y, W, H, o) => {
  const u = x / W, v = y / H;
  const f1 = tileFbm(u * 3, v * 3, 3, 3, 4, 31);
  const crease = Math.pow(1 - Math.abs(Math.sin((u * 2 + v * 0.6 + f1 * 1.2) * PI * 2)), 8);
  const fine = ((x + y) % 4 < 2 ? 1 : 0) * 0.12 + hsh(x, y, 33) * 0.08;
  const t = 0.93 + (f1 - 0.5) * 0.07 - crease * 0.015 + fine * 0.03;
  o.r = o.g = o.b = t; o.h = f1 * 0.9 + crease * 0.12 + fine * 0.08;
}, { normal: 2.2 });

// --- quilted puffer (channels)
export const pufferTex = () => fabricTex('puffer', 256, 0.24, (x, y, W, H, o) => {
  const u = x / W, v = y / H;
  const ch = (v * 3) % 1;
  const puff = Math.pow(Math.sin(ch * PI), 0.45);
  const wr = tileFbm(u * 6, v * 6, 6, 6, 3, 41);
  const stitch = ch < 0.03 || ch > 0.97 ? ((x % 6) < 3 ? 0.2 : 0) : 0;
  const t = 0.72 + puff * 0.25 + (wr - 0.5) * 0.06 - stitch;
  o.r = o.g = o.b = t; o.h = puff * 0.9 + wr * 0.15;
}, { normal: 3 });

// --- pink hawaiian print (cotton) with white flowers, red centres and green leaves
export const hawaiiTex = () => fabricTex('hawaii', 512, 0.32, (x, y, W, H, o) => {
  const n = hsh(x, y, 51) * 0.04 + (((x >> 1) + (y >> 1)) % 2) * 0.02;
  o.r = 0.9 + n; o.g = 0.43 + n; o.b = 0.6 + n; o.h = n * 4;
}, {
  normal: 1.2,
  post(ctx, W, H) {
    const r = new RNG(52);
    const at = (fn, x, y) => { for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) fn(x + ox, y + oy); };
    for (let k = 0; k < 16; k++) {
      const x = r.next() * W, y = r.next() * H, a = r.next() * TAU, s = 22 + r.next() * 16;
      at((px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = '#3f9a4c';
        for (const sa of [0.4, 2.6]) { ctx.save(); ctx.rotate(sa); ctx.beginPath(); ctx.ellipse(s * 1.25, 0, s * 0.9, s * 0.35, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#2c7038'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s * 0.4, 0); ctx.lineTo(s * 2, 0); ctx.stroke(); ctx.restore(); }
        ctx.restore();
      }, x, y);
    }
    for (let k = 0; k < 22; k++) {
      const x = r.next() * W, y = r.next() * H, a = r.next() * TAU, s = 13 + r.next() * 12;
      at((px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = '#fbf6ef';
        for (let p = 0; p < 5; p++) { ctx.rotate(TAU / 5); ctx.beginPath(); ctx.ellipse(s * 0.75, 0, s * 0.7, s * 0.45, 0, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#d8283a'; ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f6d24a'; for (let p = 0; p < 5; p++) { ctx.beginPath(); ctx.arc(Math.cos(p * 1.3) * s * 0.18, Math.sin(p * 1.3) * s * 0.18, 1.8, 0, TAU); ctx.fill(); }
        ctx.restore();
      }, x, y);
    }
  },
});

// --- mustard fleece (mottled, fuzzy)
export const fleeceTex = () => fabricTex('fleece', 256, 0.22, (x, y, W, H, o) => {
  const u = x / W, v = y / H;
  const m = tileFbm(u * 5, v * 5, 5, 5, 4, 61), f = tileFbm(u * 40, v * 40, 40, 40, 2, 62), s = hsh(x, y, 63);
  const t = 0.8 + (m - 0.5) * 0.35 + (f - 0.5) * 0.2 + (s - 0.5) * 0.08 - (s > 0.97 ? 0.25 : 0);
  o.r = t * 0.8; o.g = t * 0.6; o.b = t * 0.22; o.h = f * 0.7 + m * 0.3;
}, { normal: 2.2 });

// --- twill (khaki shorts / work pants; tint via material colour)
export const twillTex = () => fabricTex('twill', 256, 0.12, (x, y, W, H, o) => {
  const d = ((x + y) % 8) / 8;
  const rib = Math.pow(Math.sin(d * PI), 0.6);
  const n = hsh(x, y, 71) * 0.06 + tileFbm(x / W * 4, y / H * 4, 4, 4, 3, 72) * 0.08;
  const t = 0.84 + rib * 0.1 + n;
  o.r = o.g = o.b = t; o.h = rib * 0.6 + n;
}, { normal: 1.6 });

// --- denim
export const denimTex = () => fabricTex('denim', 256, 0.12, (x, y, W, H, o) => {
  const d = ((x + y * 1) % 6) / 6, rib = Math.pow(Math.sin(d * PI), 0.6);
  const weft = hsh(x, y, 81) > 0.62 ? 1 : 0;
  const fade = tileFbm(x / W * 3, y / H * 3, 3, 3, 3, 82);
  const b = 0.55 + rib * 0.15 + fade * 0.2;
  o.r = 0.17 * b + weft * 0.25; o.g = 0.28 * b + weft * 0.25; o.b = 0.5 * b + weft * 0.25; o.h = rib * 0.6;
}, { normal: 1.5 });

// --- knit (beanie, scarf, socks): V stitches; colour comes from vertex colours
export const knitTex = () => fabricTex('knit', 128, 0.045, (x, y, W, H, o) => {
  const P = 16, cx = (x % P) / P, cy = (y % P) / P;
  const side = cx < 0.5 ? 1 : -1;
  const lx = (cx - 0.5) * 2 * side;   // 0..1 from centre outwards
  const d = Math.abs((cy - 0.15 - lx * 0.55)) * 2.2;
  const h = Math.max(0, 1 - d * d) * (0.75 + 0.25 * Math.sin(lx * PI));
  const t = 0.55 + h * 0.45 + hsh(x, y, 91) * 0.05;
  o.r = o.g = o.b = t; o.h = h;
}, { normal: 2.5 });

export const feltTex = () => cached('tex_felt', () => {
  const t = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, w, h);
    const r = new RNG(77);
    for (let i = 0; i < 2600; i++) {
      const x = r.next() * w, y = r.next() * h, a = r.next() * TAU, l = 2 + r.next() * 7;
      const v = 200 + Math.floor(r.next() * 55);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      ctx.lineWidth = 0.6 + r.next();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30);
  return t;
});

export const camoTex = () => cached('tex_camo', () => {
  const t = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a8a58'; ctx.fillRect(0, 0, w, h);
    const r = new RNG(9);
    for (const c of ['#5d6b3a', '#3e4a2a', '#a28f62', '#2f2a22']) {
      ctx.fillStyle = c;
      for (let i = 0; i < 16; i++) {
        const x = r.next() * w, y = r.next() * h, s = 14 + r.next() * 26;
        for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
          ctx.beginPath();
          for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, rr = s * (0.6 + r.next() * 0.6); const px = x + ox + Math.cos(a) * rr * 1.4, py = y + oy + Math.sin(a) * rr * 0.8; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
          ctx.closePath(); ctx.fill();
        }
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.45, 1 / 0.45);
  return t;
});

const FABRICS = {
  burlap: { tex: burlapTex, rough: 0.97, sheen: 0.8, ns: 1.0 },
  nylon: { tex: nylonTex, rough: 0.72, sheen: 0.35, ns: 0.9 },
  satin: { tex: nylonTex, rough: 0.45, sheen: 0.2, ns: 0.6, metal: 0.45 },
  camo: { tex: nylonTex, rough: 0.8, sheen: 0.3, ns: 0.9, map: camoTex },
  puffer: { tex: pufferTex, rough: 0.6, sheen: 0.3, ns: 1.0 },
  hawaii: { tex: hawaiiTex, rough: 0.9, sheen: 0.4, ns: 0.6 },
  fleece: { tex: fleeceTex, rough: 0.98, sheen: 1.0, ns: 1.0 },
  twill: { tex: twillTex, rough: 0.92, sheen: 0.4, ns: 0.8 },
  denim: { tex: denimTex, rough: 0.9, sheen: 0.3, ns: 0.9 },
  knit: { tex: knitTex, rough: 0.95, sheen: 0.8, ns: 1.0 },
};
export function clothMat(fab, hex) {
  return cached(`cloth_${fab}_${hex}`, () => {
    const F = FABRICS[fab] || FABRICS.nylon, T = F.tex();
    return new THREE.MeshPhysicalMaterial({
      name: `cloth_${fab}`, color: hex, vertexColors: true, map: F.map ? F.map() : T.map, normalMap: T.normalMap,
      normalScale: new THREE.Vector2(F.ns, F.ns), roughness: F.rough, metalness: F.metal || 0,
      sheen: F.sheen, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.55),
    });
  });
}
export const M = (fab, hex) => `c:${fab}:${hex.toString(16).padStart(6, '0')}`;

export const AM = {
  trim: () => cached('trim', () => new THREE.MeshStandardMaterial({ name: 'av_trim', color: 0xffffff, vertexColors: true, roughness: 0.75, normalMap: twillTex().normalMap, normalScale: new THREE.Vector2(0.5, 0.5) })),
  reflect: () => cached('reflect', () => new THREE.MeshStandardMaterial({ name: 'av_reflect', color: 0xb9bec4, vertexColors: true, roughness: 0.35, metalness: 0.35, emissive: 0x3a3c40, envMapIntensity: 1.6 })),
  metal: () => cached('metal', () => new THREE.MeshStandardMaterial({ name: 'av_metal', color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 1, envMapIntensity: 1.4 })),
  felt: () => cached('felt', () => new THREE.MeshPhysicalMaterial({
    name: 'av_felt', color: 0xffffff, vertexColors: true, roughness: 0.95, sheen: 1, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffe8e0), map: feltTex(), bumpMap: feltTex(), bumpScale: 0.8,
  })),
  eyes: () => cached('eyes', () => new THREE.MeshPhysicalMaterial({ name: 'av_eyes', color: 0xffffff, vertexColors: true, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 })),
  knit: () => cached('knit', () => clothMat('knit', 0xffffff)),
  matte: () => cached('matte', () => new THREE.MeshPhysicalMaterial({ name: 'av_matte', color: 0xffffff, vertexColors: true, roughness: 0.88, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.6), map: twillTex().map, normalMap: twillTex().normalMap, normalScale: new THREE.Vector2(0.6, 0.6) })),
  gloss: () => cached('gloss', () => new THREE.MeshPhysicalMaterial({ name: 'av_gloss', color: 0xffffff, vertexColors: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 })),
  rubber: () => cached('rubber', () => new THREE.MeshStandardMaterial({ name: 'av_rubber', color: 0xffffff, vertexColors: true, roughness: 0.62 })),
  hazardhat: () => cached('hazardhat', () => {
    const t = canvasTex(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#f2c418'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d1d1f';
      for (let x = -h; x < w + h; x += 64) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 32, h); ctx.lineTo(x + 32 + h * 0.6, 0); ctx.lineTo(x + h * 0.6, 0); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#f2c418'; ctx.fillRect(0, h * 0.82, w, h * 0.18);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshPhysicalMaterial({ name: 'av_hazardhat', color: 0xffffff, vertexColors: true, map: t, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  }),
  glass: () => cached('glass', () => new THREE.MeshPhysicalMaterial({ name: 'av_glass', color: 0xdff2ff, transparent: true, opacity: 0.22, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide })),
  glow: (hex) => cached('glow_' + hex, () => new THREE.MeshStandardMaterial({ name: 'av_glow', color: 0x111111, emissive: hex, emissiveIntensity: 2.4, roughness: 0.4 })),
  hose: () => cached('hose', () => {
    const t = canvasTex(16, 64, (ctx, w, h) => { for (let y = 0; y < h; y++) { const s = 0.5 + 0.5 * Math.sin((y / h) * TAU * 4); const v = Math.floor(40 + s * 40); ctx.fillStyle = `rgb(${v},${v},${v + 4})`; ctx.fillRect(0, y, w, 1); } });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 12);
    return new THREE.MeshStandardMaterial({ name: 'av_hose', color: 0xffffff, map: t, bumpMap: t, bumpScale: 2, roughness: 0.55 });
  }),
  get(key, cos) {
    if (key === 'skin') return clothMat('burlap', cos.skinEntry.color);
    if (key.startsWith('c:')) { const [, fab, hex] = key.split(':'); return clothMat(fab, parseInt(hex, 16)); }
    if (key.startsWith('glow_')) return AM.glow(parseInt(key.slice(5), 16));
    if (!AM[key]) throw new Error('AM: unknown material ' + key);
    return AM[key]();
  },
};
export const glowKey = (hex) => 'glow_' + hex.toString(16).padStart(6, '0');

// Hazard stripe band + "AIR" label (tank decal)
export const hazardTex = () => cached('tex_hazard', () => canvasTex(512, 96, (ctx, w, h) => {
  ctx.fillStyle = '#f2c418'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1b1b1b';
  for (let x = -h; x < w + h; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 18, 0); ctx.lineTo(x + 18 - h, h); ctx.lineTo(x - h, h); ctx.closePath(); ctx.fill(); }
  for (const cx of [w * 0.25, w * 0.75]) {
    ctx.fillStyle = '#f4f1e6'; ctx.fillRect(cx - 70, 16, 140, h - 32);
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 4; ctx.strokeRect(cx - 70, 16, 140, h - 32);
    ctx.fillStyle = '#1b1b1b'; ctx.font = "bold 44px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('O₂ AIR', cx, h / 2 + 2);
  }
}));
export const watchTex = () => cached('tex_watch', () => canvasTex(128, 96, (ctx, w, h) => {
  ctx.fillStyle = '#0d1f12'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5dff8a'; ctx.font = "56px 'VT323', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('03:33', w / 2, h / 2 + 4);
  ctx.fillStyle = '#2f8a48'; ctx.fillRect(10, 10, 30, 8); ctx.fillRect(w - 40, 10, 30, 8);
}));


// ---------------------------------------------------------------------------
// Mouth atlas: 4x4 cells (128x64) of tiny stitched mouths
// ---------------------------------------------------------------------------
export const MOUTHS = ['smile', 'grin', 'flat', 'frown', 'o', 'O', 'wobble', 'grit', 'cat', 'tongue', 'talk1', 'talk2', 'talk3', 'shy', 'grumpy', 'gap'];
const MOUTH_IDX = Object.fromEntries(MOUTHS.map((m, i) => [m, i]));
export const mouthAtlas = () => cached('tex_mouth', () => {
  const t = labelTexture(512, 256, (ctx) => {
    ctx.clearRect(0, 0, 512, 256);
    const thread = '#2a1810', inside = '#3a1214', tongue = '#d9707c', teeth = '#f4ecdc';
    MOUTHS.forEach((name, i) => {
      ctx.save();
      ctx.translate((i % 4) * 128, Math.floor(i / 4) * 64);
      ctx.beginPath(); ctx.rect(4, 4, 120, 56); ctx.clip();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = thread;
      const stitch = (path, lw = 5) => { ctx.lineWidth = lw; ctx.setLineDash([9, 4]); path(); ctx.stroke(); ctx.setLineDash([]); };
      const open = (path, tg = true, th = false) => {
        ctx.fillStyle = inside; path(); ctx.fill();
        ctx.save(); path(); ctx.clip();
        if (tg) { ctx.fillStyle = tongue; ctx.beginPath(); ctx.ellipse(64, 54, 18, 11, 0, 0, TAU); ctx.fill(); }
        if (th) { ctx.fillStyle = teeth; ctx.fillRect(30, 0, 68, 22); }
        ctx.restore();
        ctx.lineWidth = 4; path(); ctx.stroke();
      };
      switch (name) {
        case 'smile': stitch(() => { ctx.beginPath(); ctx.moveTo(42, 27); ctx.quadraticCurveTo(64, 44, 86, 27); }); break;
        case 'grin': open(() => { ctx.beginPath(); ctx.moveTo(38, 24); ctx.quadraticCurveTo(64, 28, 90, 24); ctx.quadraticCurveTo(84, 54, 64, 54); ctx.quadraticCurveTo(44, 54, 38, 24); ctx.closePath(); }); break;
        case 'flat': stitch(() => { ctx.beginPath(); ctx.moveTo(46, 32); ctx.quadraticCurveTo(64, 34, 82, 32); }); break;
        case 'frown': stitch(() => { ctx.beginPath(); ctx.moveTo(44, 40); ctx.quadraticCurveTo(64, 24, 84, 40); }); break;
        case 'o': open(() => { ctx.beginPath(); ctx.ellipse(64, 32, 7, 9, 0, 0, TAU); }, false); break;
        case 'O': open(() => { ctx.beginPath(); ctx.ellipse(64, 33, 14, 19, 0, 0, TAU); }); break;
        case 'wobble': stitch(() => { ctx.beginPath(); for (let x = 40; x <= 88; x += 2) { const y = 34 + Math.sin((x - 40) / 48 * TAU * 2) * 5; if (x === 40) ctx.moveTo(x, y); else ctx.lineTo(x, y); } }, 4.5); break;
        case 'grit': {
          ctx.fillStyle = teeth; ctx.beginPath(); ctx.roundRect(40, 22, 48, 22, 8); ctx.fill();
          ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(42, 33); ctx.lineTo(86, 33); for (const x of [52, 64, 76]) { ctx.moveTo(x, 23); ctx.lineTo(x, 43); } ctx.stroke();
          ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(40, 22, 48, 22, 8); ctx.stroke(); break;
        }
        case 'cat': stitch(() => { ctx.beginPath(); ctx.moveTo(42, 28); ctx.quadraticCurveTo(52, 42, 64, 30); ctx.quadraticCurveTo(76, 42, 86, 28); }); break;
        case 'tongue':
          ctx.fillStyle = tongue; ctx.beginPath(); ctx.moveTo(62, 30); ctx.lineTo(62, 44); ctx.arc(71, 44, 9, PI, 0, true); ctx.lineTo(80, 30); ctx.closePath(); ctx.fill();
          ctx.lineWidth = 3; ctx.stroke(); ctx.beginPath(); ctx.moveTo(71, 32); ctx.lineTo(71, 43); ctx.stroke();
          stitch(() => { ctx.beginPath(); ctx.moveTo(44, 30); ctx.lineTo(86, 30); }); break;
        case 'talk1': open(() => { ctx.beginPath(); ctx.ellipse(64, 30, 12, 7, 0, 0, TAU); }); break;
        case 'talk2': open(() => { ctx.beginPath(); ctx.moveTo(47, 24); ctx.quadraticCurveTo(64, 28, 81, 24); ctx.quadraticCurveTo(81, 46, 64, 46); ctx.quadraticCurveTo(47, 46, 47, 24); ctx.closePath(); }); break;
        case 'talk3': open(() => { ctx.beginPath(); ctx.ellipse(64, 34, 17, 19, 0, 0, TAU); }); break;
        case 'shy': stitch(() => { ctx.beginPath(); ctx.moveTo(52, 32); ctx.quadraticCurveTo(58, 38, 64, 32); ctx.quadraticCurveTo(70, 38, 76, 32); }, 4.5); break;
        case 'grumpy': stitch(() => { ctx.beginPath(); ctx.moveTo(44, 38); ctx.quadraticCurveTo(58, 26, 70, 31); ctx.quadraticCurveTo(78, 34, 84, 40); }); break;
        case 'gap':
          open(() => { ctx.beginPath(); ctx.moveTo(40, 24); ctx.quadraticCurveTo(64, 29, 88, 24); ctx.quadraticCurveTo(82, 48, 64, 48); ctx.quadraticCurveTo(46, 48, 40, 24); ctx.closePath(); }, true, false);
          ctx.fillStyle = teeth; ctx.fillRect(54, 26, 9, 10); ctx.fillRect(66, 26, 9, 10); ctx.lineWidth = 2; ctx.strokeRect(54, 26, 9, 10); ctx.strokeRect(66, 26, 9, 10);
          break;
      }
      ctx.restore();
    });
  });
  t.anisotropy = 4;
  return t;
});
export function setMouthCell(tex, name) {
  const i = MOUTH_IDX[name] ?? 0;
  tex.offset.set((i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 4);
}

// ============================================================================
// Body dimensions / shapes
// ============================================================================
export const D = {
  pelvisY: 0.33, hipX: 0.11, thigh: 0.115, shin: 0.115, ankleH: 0.1, legR: 0.068,
  chestY: 0.39, headY: 0.095,
  shX: 0.205, shY: 0.0, upper: 0.13, fore: 0.115, armR: 0.058, handLen: 0.07,
  bodyDepth: 0.9,
};
export const SKIN = 0xc9a977, THREAD = 0x2e1c12, NOSE = 0xd2302b, BLUSH = 0xd98472, EYE = 0x09090b;

// Torso profile [r, y] (pelvis space)
const BODY_PROFILE = [[0, -0.105], [0.1, -0.1], [0.18, -0.078], [0.238, -0.04], [0.272, 0.02], [0.288, 0.09], [0.288, 0.17], [0.275, 0.25], [0.25, 0.32], [0.215, 0.38], [0.175, 0.43], [0.135, 0.47], [0.09, 0.5], [0, 0.515]];
const bodyCurve = new THREE.SplineCurve(BODY_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
const BODY_PTS = bodyCurve.getSpacedPoints(80);
export function bodyR(y) {
  const P = BODY_PTS;
  if (y <= P[0].y) return 0;
  for (let i = 1; i < P.length; i++) if (P[i].y >= y) { const a = P[i - 1], b = P[i]; return lerp(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y)); }
  return 0;
}
const curveV = (y) => { const P = BODY_PTS; for (let i = 1; i < P.length; i++) if (P[i].y >= y) return (i - 1 + (y - P[i - 1].y) / Math.max(1e-6, P[i].y - P[i - 1].y)) / (P.length - 1); return 1; };
const bulge = (y) => 0.07 * Math.exp(-Math.pow((y - 0.1) / 0.15, 2));
// phi=0 at the back (+Z), phi=PI at the front (-Z)
export function bodyPoint(phi, y, off = 0, out = new THREE.Vector3(), r = null) {
  const rr = (r ?? bodyR(y)) + off;
  let z = Math.cos(phi) * rr * D.bodyDepth;
  if (z < 0) z *= 1 + bulge(y) * Math.max(0, -Math.cos(phi)) * 1.4;
  return out.set(Math.sin(phi) * rr, y, z);
}
export function bodyNormal(phi, y, out = new THREE.Vector3()) {
  const e = 0.004;
  const a = bodyPoint(phi + e, y), b = bodyPoint(phi - e, y), c = bodyPoint(phi, y + e), d = bodyPoint(phi, y - e);
  out.crossVectors(a.sub(b), c.sub(d)).normalize();
  const p = bodyPoint(phi, y, 0, _v4);
  if (out.x * p.x + out.z * p.z < 0) out.negate();
  return out;
}
// torso grid between profile heights ya..yb, offset outward
export function bodyGrid(ya, yb, off = 0, nu = 32, nv = 12, puff = 0) {
  const va = ya <= BODY_PTS[0].y ? 0 : curveV(ya), vb = yb >= BODY_PTS[BODY_PTS.length - 1].y ? 1 : curveV(yb);
  const g = surfaceGrid(nu, nv, (u, v, p) => {
    const P = bodyCurve.getPoint(lerp(va, vb, v));
    bodyPoint(u * TAU, P.y, off + puff * Math.pow(Math.sin(PI * v), 0.4), p, P.x);
  }, { closedU: true, poleBottom: va === 0, poleTop: vb === 1 });
  return G.uv(g, 1.75, Math.max(0.05, (vb - va) * 0.9));
}
// orientation whose local +Z is the outward surface normal n (local +Y stays roughly up)
export const surfQ = (n) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(ORIGIN, n.clone().negate(), UP));

// --- head: tall, rounded, slightly squarish burlap sack (head-bone space; front = -Z)
export const HEAD = { a: 0.208, c: 0.19, y0: -0.06, y1: 0.505, n: 2.7, m: 2.4, cy: 0.225 };
export function headF(y, H = HEAD) { const t = (y - H.y0) / (H.y1 - H.y0); const s = Math.min(1, Math.abs(2 * t - 1)); return Math.pow(Math.max(0, 1 - Math.pow(s, H.m)), 1 / H.m); }
export function headRphi(phi, H = HEAD) { const s = Math.abs(Math.sin(phi)), c = Math.abs(Math.cos(phi)); return Math.pow(Math.pow(s / H.a, H.n) + Math.pow(c / H.c, H.n), -1 / H.n); }
const cheek = (phi, y) => 1 + 0.05 * Math.exp(-Math.pow((y - 0.14) / 0.11, 2)) * Math.pow(Math.max(0, -Math.cos(phi)), 2);
export function headPt(phi, y, off = 0, out = new THREE.Vector3(), H = HEAD) {
  const R = headRphi(phi, H) * headF(y, H) * (H === HEAD ? cheek(phi, y) : 1) + off;
  return out.set(Math.sin(phi) * R, y, Math.cos(phi) * R);
}
export function headNormal(phi, y, out = new THREE.Vector3(), H = HEAD) {
  const e = 0.003;
  const a = headPt(phi + e, y, 0, new THREE.Vector3(), H), b = headPt(phi - e, y, 0, new THREE.Vector3(), H);
  const c = headPt(phi, y + e, 0, new THREE.Vector3(), H), d = headPt(phi, y - e, 0, new THREE.Vector3(), H);
  out.crossVectors(a.sub(b), c.sub(d)).normalize();
  const p = headPt(phi, y, 0, _v4, H);
  if (out.x * p.x + out.z * p.z < 0) out.negate();
  return out;
}
// phi for a feature at horizontal offset x on the front
export const frontPhi = (x, y, H = HEAD) => PI - Math.asin(clamp(x / (headRphi(PI, H) * Math.max(0.2, headF(y, H))), -0.98, 0.98));
export function featurePt(x, y, off = 0, H = HEAD) { const phi = frontPhi(x, y, H); const p = headPt(phi, y, 0, new THREE.Vector3(), H); const n = headNormal(phi, y, new THREE.Vector3(), H); return { p: p.addScaledVector(n, off), n, q: surfQ(n), phi }; }
// sack surface grid
export function headGrid(H = HEAD, nu = 36, nv = 26, scale = 1, yStart = null, seed = 1) {
  const c = new THREE.Vector3(0, H.cy, 0);
  const ys = yStart ?? H.y0;
  const aS = yStart == null ? -PI / 2 : Math.asin(clamp((ys - (H.y0 + H.y1) / 2) / ((H.y1 - H.y0) / 2), -1, 1));
  const g = surfaceGrid(nu, nv, (u, v, p) => {
    const a = lerp(aS, PI / 2, v);
    const y = (H.y0 + H.y1) / 2 + Math.sin(a) * (H.y1 - H.y0) / 2;
    headPt(u * TAU, y, 0, p, H);
    if (scale !== 1) p.sub(c).multiplyScalar(scale).add(c);
    if (seed) { const n = valueNoise2(u * 9 + seed, y * 14, seed) - 0.5; const k = 1 + n * 0.022; p.x *= k; p.z *= k; }
  }, { closedU: true, poleBottom: yStart == null, poleTop: true });
  return g;
}

// Face features on a sack head. opts: H, bone, eyeX, eyeY, eyeR, noseY, noseR, mouthY, skin, noseColor, mouth, noMouth...
export function buildFace(B, f, opts = {}) {
  const { add, R } = B;
  const H = opts.H || HEAD, bone = opts.bone || 'head';
  const dead = !!B.dead;
  const fp = (x, y, off) => featurePt(x, y, off, H);
  const eyeY = opts.eyeY ?? 0.3, eyeX = opts.eyeX ?? 0.098;
  const eyeR = f.eyes === 'cyclops' ? 0.034 : (opts.eyeR ?? 0.021);
  const sides = f.eyes === 'cyclops' ? [['L', 0]] : [['L', -1], ['R', 1]];
  for (const [S, s] of sides) {
    const x = s * eyeX, y = f.eyes === 'cyclops' ? eyeY + 0.01 : eyeY;
    const F = fp(x, y, 0);
    R.setRest('eye' + S, F.p.clone().addScaledVector(F.n, eyeR * 0.45).toArray(), F.q);
    R.setRest('x' + S, F.p.clone().addScaledVector(F.n, 0.002).toArray(), F.q);
    const kind = f.eyes === 'button' || (f.eyes === 'mismatch' && s > 0) ? 'button' : 'bead';
    if (!dead) {
      if (kind === 'bead') {
        add('eye' + S, 'eyes', G.sphere(eyeR, 14, 10), EYE);
        const hl = new THREE.Vector3(0.42, 0.5, 0.76).normalize().multiplyScalar(eyeR * 0.8);
        add('eye' + S, 'eyes', G.xf(G.sphere(eyeR * 0.32, 8, 6), hl.toArray()), 0xffffff);
        add('eye' + S, 'eyes', G.xf(G.sphere(eyeR * 0.14, 6, 4), [-eyeR * 0.3, -eyeR * 0.42, eyeR * 0.86]), 0xbfbfcc);
        add('eye' + S, 'felt', G.xf(G.torus(eyeR * 0.9, 0.0022, 4, 16), [0, 0, -eyeR * 0.4]), THREAD);
      } else {
        const br = eyeR * 1.45;
        add('eye' + S, 'eyes', G.xf(G.cyl(br, br, 0.008, 20), [0, 0, -0.004], [PI / 2, 0, 0]), 0x1e1612);
        add('eye' + S, 'eyes', G.xf(G.torus(br * 0.9, 0.003, 6, 20), [0, 0, 0.0]), 0x120c09);
        for (const [hx, hy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) add('eye' + S, 'eyes', G.xf(G.sphere(0.0038, 6, 4), [hx * br * 0.3, hy * br * 0.3, 0.0]), 0x000000);
        add('eye' + S, 'felt', G.between([-br * 0.3, -br * 0.3, 0.002], [br * 0.3, br * 0.3, 0.002], 0.0022, 2, 5), 0xe8dcc8);
        add('eye' + S, 'felt', G.between([-br * 0.3, br * 0.3, 0.002], [br * 0.3, -br * 0.3, 0.002], 0.0022, 2, 5), 0xe8dcc8);
      }
    }
    const xr = eyeR * 1.1;
    add('x' + S, 'felt', G.between([-xr, -xr, 0.002], [xr, xr, 0.002], 0.0042, 2, 5), THREAD);
    add('x' + S, 'felt', G.between([-xr, xr, 0.002], [xr, -xr, 0.002], 0.0042, 2, 5), THREAD);
    if (!opts.noBrows) {
      const bx = f.eyes === 'cyclops' ? 0 : s * (eyeX + 0.004), by = eyeY + (f.eyes === 'cyclops' ? 0.075 : 0.07);
      const BF = fp(bx, by, 0.002);
      R.setRest('brow' + S, BF.p.toArray(), BF.q);
      const w = f.eyes === 'cyclops' ? 0.04 : 0.024;
      add('brow' + S, 'felt', G.tube([[-w, -0.003, 0], [-w * 0.35, 0.002, -0.001], [w * 0.35, 0.002, -0.001], [w, -0.003, 0]], 0.0042, 8, 4), THREAD);
    }
  }
  // big red pom-pom nose
  if (!opts.noNose) {
    const nr = opts.noseR ?? 0.047;
    const NF = fp(0, opts.noseY ?? 0.222, nr * 0.55);
    R.setRest('nose', NF.p.toArray(), NF.q);
    add('nose', 'felt', G.fuzzball(nr, 0.05, 11, 3, 20, 14), opts.noseColor ?? NOSE);
    B.springs.nose = { k: 120, d: 6, gain: 0.006, mode: 'stand', limit: 0.3 };
  }
  // blush
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const BF = fp(s * 0.135, opts.blushY ?? 0.19, 0.0);
    R.setRest('blush' + S, BF.p.toArray(), BF.q);
    add('blush' + S, 'felt', G.ell(0.027, 0.017, 0.0035, 12, 6), opts.blush ?? BLUSH);
    if (f.freckles) {
      const r = new RNG(5 + s);
      for (let i = 0; i < 6; i++) add(bone, 'felt', G.xf(G.sphere(0.0042, 6, 4), fp(s * (0.07 + r.next() * 0.09), 0.22 + r.next() * 0.06, 0.001).p.toArray()), 0x6b4428);
    }
    if (f.whiskers) for (let i = -1; i <= 1; i++) {
      const a = fp(s * 0.105, 0.19 + i * 0.016, 0.002).p, b = fp(s * 0.175, 0.19 + i * 0.03, 0.002).p;
      add(bone, 'felt', G.between(a, b, 0.0026, 2, 4), THREAD);
    }
  }
  if (f.scar) {
    const pts = []; for (let i = 0; i <= 8; i++) pts.push(fp(-0.04 - i * 0.014, 0.42 - i * 0.022, 0.002).p);
    add(bone, 'felt', G.tube(pts, 0.0032, 16, 4), 0x5a3222);
    for (let i = 1; i < 8; i++) { const c = pts[i]; add(bone, 'felt', G.between(c.clone().add(new THREE.Vector3(-0.008, -0.006, 0)), c.clone().add(new THREE.Vector3(0.008, 0.006, 0)), 0.0024, 2, 4), THREAD); }
  }
  // mouth patch (atlas texture) conforming to the sack
  if (!opts.noMouth) {
    const my = opts.mouthY ?? 0.142, w = opts.mouthW ?? 0.085, h = w / 2;
    const Rf = headRphi(PI, H) * headF(my, H);
    const dphi = Math.asin(clamp(w / 2 / Rf, 0, 0.9));
    const g = surfaceGrid(8, 4, (u, v, p) => headPt(lerp(PI - dphi, PI + dphi, u), lerp(my - h / 2, my + h / 2, v), 0.0016, p, H));
    const tex = mouthAtlas().clone();
    tex.repeat.set(0.25, 0.25);
    setMouthCell(tex, dead ? 'tongue' : (opts.mouth || f.mouth || 'smile'));
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'mouth'; mesh.castShadow = false;
    B.attach(bone, mesh);
    B.mouth = mesh;
  }
}
