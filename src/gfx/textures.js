// Procedural texture library. Every surface texture in R.O.O.M. is generated at load
// time on a canvas (albedo + height-derived normal map + roughness), so the game ships
// with zero image assets and still gets detailed, non-repeating-looking materials.
//
// Usage:
//   const t = Tex.get('wallpaper');          // { map, normalMap, roughnessMap, size }
//   const t2 = Tex.get('wood', 2);           // same images, UV repeat x2 (shared GPU upload)
//
// World geometry uses UVs in meters; `size` is how many meters one texture tile covers,
// so world materials use repeat = 1/size.
import * as THREE from 'three';
import { tileFbm, tileNoise2, hash01, RNG, clamp, smoothstep } from '../core/rng.js';

const cache = new Map();
const variantCache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

class Layer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.col = new Float32Array(w * h * 3);
    this.height = new Float32Array(w * h);
    this.rough = new Float32Array(w * h).fill(0.8);
    this.metal = null;
  }
  idx(x, y) { return y * this.w + x; }
}

function toCanvasRGB(layer) {
  const c = makeCanvas(layer.w, layer.h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(layer.w, layer.h);
  const d = img.data;
  for (let i = 0, n = layer.w * layer.h; i < n; i++) {
    d[i * 4] = clamp(layer.col[i * 3] * 255, 0, 255);
    d[i * 4 + 1] = clamp(layer.col[i * 3 + 1] * 255, 0, 255);
    d[i * 4 + 2] = clamp(layer.col[i * 3 + 2] * 255, 0, 255);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function toCanvasGray(arr, w, h, extraChannelB) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, n = w * h; i < n; i++) {
    const v = clamp(arr[i] * 255, 0, 255);
    // roughnessMap reads G, metalnessMap reads B
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = extraChannelB ? clamp(extraChannelB[i] * 255, 0, 255) : v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function normalFromHeight(layer, strength = 2.0) {
  const { w, h, height } = layer;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const dx = (height[y * w + xr] - height[y * w + xl]) * strength;
      const dy = (height[yd * w + x] - height[yu * w + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function canvasTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function finish(layer, opts = {}) {
  const out = {
    map: canvasTex(toCanvasRGB(layer), true),
    normalMap: canvasTex(normalFromHeight(layer, opts.normalStrength ?? 2), false),
    roughnessMap: canvasTex(toCanvasGray(layer.rough, layer.w, layer.h, layer.metal), false),
    size: opts.size ?? 1,
    hasMetal: !!layer.metal,
  };
  return out;
}

function setCol(layer, i, r, g, b) {
  layer.col[i * 3] = r;
  layer.col[i * 3 + 1] = g;
  layer.col[i * 3 + 2] = b;
}

// Overlay drawing helpers that operate on 2D canvas then read back into the layer.
function stampCanvas(layer, drawFn, mode = 'multiply') {
  const c = makeCanvas(layer.w, layer.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = mode === 'multiply' ? '#fff' : '#000';
  ctx.fillRect(0, 0, layer.w, layer.h);
  drawFn(ctx, layer.w, layer.h);
  const d = ctx.getImageData(0, 0, layer.w, layer.h).data;
  return d;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
const gens = {};

// Classic Level 0 mono-yellow wallpaper with faint vertical stripes and an old,
// barely visible chevron/diamond print. 1 tile = 1.06m (two paper strips).
gens.wallpaper = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      // stripes: 16 per tile, alternating subtle tone
      const stripe = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5;
      const fine = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5;
      // diamond motif inside every other stripe
      const du = (u * 8) % 1, dv = (v * 12) % 1;
      const diamond = 1 - smoothstep(0.32, 0.36, Math.abs(du - 0.5) + Math.abs(dv - 0.5) * 0.66);
      const mot = diamond * (Math.floor(u * 8) % 2 === 0 ? 1 : 0.4);
      const mott = tileFbm(u * 6, v * 6, 6, 6, 4, 11);
      const fiber = hash01(x, y, 3) * 0.5 + hash01(x >> 1, y >> 1, 4) * 0.5;
      let r = 0.80, g = 0.72, b = 0.40;
      const tone = 1 - stripe * 0.035 - fine * 0.012 - mot * 0.03 + (mott - 0.5) * 0.10 + (fiber - 0.5) * 0.04;
      r *= tone; g *= tone; b *= tone * (1 - (mott - 0.5) * 0.15);
      // seam between paper strips at u=0 and u=0.5
      const seamD = Math.min(Math.abs(u - 0.5), u, 1 - u) * W;
      const seam = seamD < 1.5 ? 1 : 0;
      if (seam) { r *= 0.86; g *= 0.85; b *= 0.82; }
      setCol(L, i, r, g, b);
      L.height[i] = fiber * 0.15 + stripe * 0.05 + mot * 0.08 + (seamD < 3 ? (3 - seamD) * 0.08 : 0);
      L.rough[i] = 0.82 + fiber * 0.1;
    }
  }
  return finish(L, { size: 1.06, normalStrength: 1.4 });
};

// Damp, matted mustard carpet. 1 tile = 1m.
gens.carpet = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const loop = hash01(x, y, 21);
      const tuft = hash01(x >> 2, y >> 2, 22);
      const mott = tileFbm(u * 8, v * 8, 8, 8, 4, 23);
      const big = tileFbm(u * 2, v * 2, 2, 2, 3, 24);
      // woven row structure
      const row = Math.sin((v * 160 + Math.sin(u * 40) * 0.5) * Math.PI) * 0.5 + 0.5;
      const tone = 0.82 + loop * 0.16 + tuft * 0.1 + (mott - 0.5) * 0.25 + (big - 0.5) * 0.15 - row * 0.05;
      setCol(L, i, 0.60 * tone, 0.52 * tone, 0.31 * tone);
      L.height[i] = loop * 0.6 + tuft * 0.4 + row * 0.15;
      L.rough[i] = 0.92 + loop * 0.08;
    }
  }
  return finish(L, { size: 1, normalStrength: 2.2 });
};

// Acoustic drop-ceiling tiles (0.6m) with fissure pattern and T-bar grid. 1 tile = 1.2m.
gens.ceiling = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  const rng = new RNG(77);
  const tilePx = W / 2;
  const holes = new Float32Array(W * H);
  // fissures: short random worms
  for (let k = 0; k < 2600; k++) {
    let x = rng.next() * W, y = rng.next() * H;
    const len = rng.int(2, 9);
    let a = rng.next() * Math.PI * 2;
    for (let s = 0; s < len; s++) {
      const xi = Math.floor(x) & (W - 1), yi = Math.floor(y) & (H - 1);
      holes[yi * W + xi] = 1;
      a += rng.range(-0.8, 0.8);
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const tx = x % tilePx, ty = y % tilePx;
      const edge = Math.min(tx, ty, tilePx - 1 - tx, tilePx - 1 - ty);
      const grid = edge < 4;
      const bevel = smoothstep(4, 10, edge);
      const mott = tileFbm(u * 6, v * 6, 6, 6, 3, 31);
      const speck = hash01(x, y, 32);
      if (grid) {
        const t = 0.83 + speck * 0.04;
        setCol(L, i, t, t, t * 0.98);
        L.height[i] = 1.0;
        L.rough[i] = 0.45;
      } else {
        const hole = holes[i];
        let t = 0.86 + (mott - 0.5) * 0.06 + (speck - 0.5) * 0.05 - hole * 0.25;
        t *= 0.9 + bevel * 0.1;
        setCol(L, i, t * 0.99, t * 0.97, t * 0.9);
        L.height[i] = 0.55 * bevel + 0.25 - hole * 0.3 + speck * 0.05;
        L.rough[i] = 0.95;
      }
    }
  }
  return finish(L, { size: 1.2, normalStrength: 3.0 });
};

// Fluorescent troffer diffuser (prismatic lens). Used as emissive map; 0..1 UV per panel.
gens.lightpanel = () => {
  const W = 256, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const frame = Math.min(u, v * 2, 1 - u, (1 - v) * 2);
      const prism = (Math.sin(x * 0.9) * Math.sin(y * 0.9)) * 0.5 + 0.5;
      const glowU = Math.sin(u * Math.PI);
      let t = frame < 0.04 ? 0.35 : 0.82 + prism * 0.12;
      // tube hot-spots
      const tubes = Math.max(Math.exp(-Math.pow((u - 0.33) * 9, 2)), Math.exp(-Math.pow((u - 0.67) * 9, 2)));
      if (frame >= 0.04) t = t * (0.75 + glowU * 0.15) + tubes * 0.25;
      setCol(L, i, t, t * 0.99, t * 0.9);
      L.height[i] = prism * 0.3 + (frame < 0.04 ? 1 : 0);
      L.rough[i] = 0.3;
    }
  }
  return finish(L, { size: 1, normalStrength: 1 });
};

gens.concrete = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const n1 = tileFbm(u * 4, v * 4, 4, 4, 5, 41);
      const n2 = tileFbm(u * 24, v * 24, 24, 24, 3, 42);
      const pit = hash01(x, y, 43) > 0.985 ? 1 : 0;
      const t = 0.5 + (n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.12 - pit * 0.15;
      setCol(L, i, t * 0.98, t * 0.97, t * 0.93);
      L.height[i] = n2 * 0.5 + n1 * 0.3 - pit * 0.5;
      L.rough[i] = 0.85 + (n2 - 0.5) * 0.2;
    }
  }
  return finish(L, { size: 2, normalStrength: 2.5 });
};

// Desk veneer / furniture wood (UV 0..1 covers about 1m, grain along U)
gens.wood = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const warp = tileFbm(u * 2, v * 6, 2, 6, 4, 51) * 3.0;
      const rings = Math.sin((v * 22 + warp) * Math.PI * 2) * 0.5 + 0.5;
      const fine = tileNoise2(u * 4, v * 180, 4, 180, 52);
      const t = 0.75 + rings * 0.12 + (fine - 0.5) * 0.16;
      setCol(L, i, 0.55 * t, 0.36 * t, 0.2 * t);
      L.height[i] = fine * 0.35 + rings * 0.2;
      L.rough[i] = 0.55 + fine * 0.2;
    }
  }
  return finish(L, { size: 1, normalStrength: 1.2 });
};

// Raw pale plank (pine), for crafting planks / pallets
gens.plank = () => {
  const W = 256, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const warp = tileFbm(u * 3, v * 2, 3, 2, 4, 61) * 2.5;
      const grain = Math.sin((u * 18 + warp) * Math.PI * 2) * 0.5 + 0.5;
      const fine = tileNoise2(u * 120, v * 3, 120, 3, 62);
      const knot = Math.exp(-(Math.pow((u - 0.6) * 9, 2) + Math.pow((v - 0.3) * 14, 2)));
      const t = 0.85 + grain * 0.1 + (fine - 0.5) * 0.12 - knot * 0.35;
      setCol(L, i, 0.78 * t, 0.62 * t, 0.42 * t);
      L.height[i] = fine * 0.4 + grain * 0.2 - knot * 0.3;
      L.rough[i] = 0.78;
    }
  }
  return finish(L, { size: 1, normalStrength: 1.5 });
};

// Scuffed painted metal (neutral light grey, tint with material.color)
gens.metal = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  L.metal = new Float32Array(W * H);
  const rng = new RNG(71);
  const scr = stampCanvas(L, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < 220; k++) {
      ctx.lineWidth = rng.range(0.4, 1.4);
      const x = rng.next() * w, y = rng.next() * h, a = rng.next() * Math.PI, l = rng.range(4, 40);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const n = tileFbm(u * 5, v * 5, 5, 5, 4, 72);
      const s = 1 - scr[i * 4] / 255; // scratch amount
      const chip = smoothstep(0.68, 0.72, tileFbm(u * 9, v * 9, 9, 9, 4, 73));
      let t = 0.9 + (n - 0.5) * 0.1;
      let r = t, g = t, b = t;
      if (chip > 0) { r = r * (1 - chip) + 0.45 * chip; g = g * (1 - chip) + 0.44 * chip; b = b * (1 - chip) + 0.43 * chip; }
      r -= s * 0.25; g -= s * 0.25; b -= s * 0.25;
      setCol(L, i, r, g, b);
      L.height[i] = -s * 0.4 - chip * 0.3 + n * 0.05;
      L.rough[i] = 0.45 + n * 0.2 + s * 0.2 - chip * 0.15;
      L.metal[i] = Math.max(chip, s) * 0.9;
    }
  }
  return finish(L, { size: 1, normalStrength: 1.5 });
};

// Brushed steel
gens.steel = () => {
  const W = 256, H = 256, L = new Layer(W, H);
  L.metal = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const brush = tileNoise2(u * 2, v * 256, 2, 256, 81);
      const n = tileFbm(u * 4, v * 4, 4, 4, 3, 82);
      const t = 0.72 + brush * 0.12 + (n - 0.5) * 0.08;
      setCol(L, i, t, t, t * 1.02);
      L.height[i] = brush * 0.2;
      L.rough[i] = 0.3 + brush * 0.12 + n * 0.1;
    }
  }
  return finish(L, { size: 1, normalStrength: 0.8 });
};

gens.rust = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  L.metal = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const n = tileFbm(u * 6, v * 6, 6, 6, 5, 91);
      const m = tileFbm(u * 20, v * 20, 20, 20, 3, 92);
      const rust = smoothstep(0.42, 0.62, n);
      const r = 0.45 * (1 - rust) + 0.48 * rust + (m - 0.5) * 0.1;
      const g = 0.45 * (1 - rust) + 0.24 * rust + (m - 0.5) * 0.06;
      const b = 0.46 * (1 - rust) + 0.12 * rust;
      setCol(L, i, r, g, b);
      L.height[i] = rust * m * 0.6;
      L.rough[i] = 0.4 + rust * 0.55;
      L.metal[i] = 1 - rust;
    }
  }
  return finish(L, { size: 1, normalStrength: 2.5 });
};

// Corrugated cardboard with tape strip and printed corporate stamp
gens.cardboard = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  const print = stampCanvas(L, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.font = 'bold 54px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('R.O.O.M.', w * 0.5, h * 0.62);
    ctx.font = 'bold 22px "IBM Plex Mono", monospace';
    ctx.fillText('SUPPLY DIVISION', w * 0.5, h * 0.7);
    ctx.fillText('THIS SIDE UP  ↑↑', w * 0.5, h * 0.9);
    ctx.lineWidth = 4;
    ctx.strokeRect(w * 0.18, h * 0.5, w * 0.64, h * 0.25);
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const n = tileFbm(u * 8, v * 8, 8, 8, 4, 101);
      const fib = hash01(x, y, 102);
      const corr = Math.sin(u * Math.PI * 2 * 60) * 0.5 + 0.5;
      const tape = Math.abs(v - 0.25) < 0.06;
      let r = 0.66, g = 0.5, b = 0.32;
      const t = 0.92 + (n - 0.5) * 0.18 + (fib - 0.5) * 0.06;
      r *= t; g *= t; b *= t;
      const ink = 1 - print[i * 4] / 255;
      r = r * (1 - ink * 0.85); g = g * (1 - ink * 0.85); b = b * (1 - ink * 0.8);
      if (tape) { r = r * 0.75 + 0.18; g = g * 0.75 + 0.14; b = b * 0.75 + 0.08; }
      setCol(L, i, r, g, b);
      L.height[i] = corr * 0.12 + fib * 0.1 + (tape ? 0.3 : 0);
      L.rough[i] = tape ? 0.35 : 0.9;
    }
  }
  return finish(L, { size: 1, normalStrength: 1.3 });
};

// Woven upholstery
gens.fabric = () => {
  const W = 256, H = 256, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const wx = Math.sin(x * Math.PI / 2) * 0.5 + 0.5;
      const wy = Math.sin(y * Math.PI / 2) * 0.5 + 0.5;
      const weave = ((x >> 1) + (y >> 1)) % 2 ? wx : wy;
      const n = tileFbm(u * 6, v * 6, 6, 6, 3, 111);
      const t = 0.85 + weave * 0.12 + (n - 0.5) * 0.12 + (hash01(x, y, 112) - 0.5) * 0.06;
      setCol(L, i, t, t, t);
      L.height[i] = weave * 0.6;
      L.rough[i] = 0.95;
    }
  }
  return finish(L, { size: 0.25, normalStrength: 1.8 });
};

// Lobby: blue-grey commercial carpet tiles, 0.5m tiles. 1 tile = 1m
gens.officeCarpet = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const tile = ((x >> 8) + (y >> 8)) % 2;
      const dir = tile ? Math.sin(v * 300) : Math.sin(u * 300);
      const loop = hash01(x, y, 121);
      const fleck = hash01(x, y, 122) > 0.97 ? 1 : 0;
      const mott = tileFbm(u * 6, v * 6, 6, 6, 3, 123);
      const tx = x % 256, ty = y % 256;
      const seam = Math.min(tx, ty, 255 - tx, 255 - ty) < 1 ? 1 : 0;
      const t = 0.8 + loop * 0.16 + dir * 0.03 + (mott - 0.5) * 0.15 - seam * 0.2;
      let r = 0.30 * t, g = 0.34 * t, b = 0.42 * t;
      if (fleck) { r = 0.55; g = 0.45; b = 0.35; }
      setCol(L, i, r, g, b);
      L.height[i] = loop * 0.5 + dir * 0.1 - seam * 0.4;
      L.rough[i] = 0.95;
    }
  }
  return finish(L, { size: 1, normalStrength: 2 });
};

// Lab / break-room vinyl tile: off-white with speckle; checker alt. 1 tile = 1.2m (4 tiles of 0.3)
gens.linoleum = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const tx = Math.floor(u * 4), ty = Math.floor(v * 4);
      const alt = (tx + ty) % 2;
      const fx = (u * 4) % 1, fy = (v * 4) % 1;
      const grout = Math.min(fx, fy, 1 - fx, 1 - fy) < 0.006;
      const speck = hash01(x, y, 131);
      const n = tileFbm(u * 10, v * 10, 10, 10, 3, 132 + alt);
      let base = alt ? [0.80, 0.80, 0.76] : [0.62, 0.66, 0.64];
      let t = 0.95 + (n - 0.5) * 0.1;
      if (speck > 0.96) t -= 0.2;
      if (speck < 0.02) t += 0.06;
      let r = base[0] * t, g = base[1] * t, b = base[2] * t;
      if (grout) { r = g = b = 0.32; }
      setCol(L, i, r, g, b);
      L.height[i] = grout ? 0 : 0.5;
      L.rough[i] = grout ? 0.9 : 0.22 + n * 0.15;
    }
  }
  return finish(L, { size: 1.2, normalStrength: 2 });
};

// Beige painted drywall (orange peel)
gens.paint = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const peel = tileFbm(u * 40, v * 40, 40, 40, 2, 141);
      const n = tileFbm(u * 3, v * 3, 3, 3, 4, 142);
      const t = 0.94 + (peel - 0.5) * 0.04 + (n - 0.5) * 0.08;
      setCol(L, i, t, t, t);
      L.height[i] = peel * 0.7;
      L.rough[i] = 0.75 + peel * 0.1;
    }
  }
  return finish(L, { size: 1.5, normalStrength: 1.2 });
};

// 80s/90s dark wood wall paneling with vertical grooves. 1 tile = 1.2m
gens.panel = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const board = Math.floor(u * 6);
      const fu = (u * 6) % 1;
      const groove = fu < 0.03 ? 1 : 0;
      const warp = tileFbm(u * 6 + board * 1.7, v * 1, 6, 1, 4, 151) * 2;
      const grain = Math.sin((fu * 7 + warp) * Math.PI * 2) * 0.5 + 0.5;
      const fine = tileNoise2(u * 300, v * 6, 300, 6, 152);
      const shade = 0.85 + hash01(board, 0, 153) * 0.2;
      const t = shade * (0.7 + grain * 0.2 + (fine - 0.5) * 0.15) * (groove ? 0.35 : 1);
      setCol(L, i, 0.42 * t, 0.26 * t, 0.15 * t);
      L.height[i] = groove ? 0 : 0.6 + fine * 0.1;
      L.rough[i] = 0.5 + fine * 0.2;
    }
  }
  return finish(L, { size: 1.2, normalStrength: 2.5 });
};

// White ceramic wall tile (break room / lab), 0.15m tiles. 1 tile = 0.6m
gens.tile = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const fx = (u * 4) % 1, fy = (v * 4) % 1;
      const e = Math.min(fx, fy, 1 - fx, 1 - fy);
      const grout = e < 0.025;
      const bevel = smoothstep(0.025, 0.07, e);
      const n = tileFbm(u * 8, v * 8, 8, 8, 3, 161);
      const tint = hash01(Math.floor(u * 4), Math.floor(v * 4), 162) * 0.04;
      let t = grout ? 0.55 + n * 0.1 : 0.92 - tint + (n - 0.5) * 0.03;
      setCol(L, i, t * 0.97, t, t * 0.98);
      L.height[i] = grout ? 0 : 0.4 + bevel * 0.6;
      L.rough[i] = grout ? 0.9 : 0.12;
    }
  }
  return finish(L, { size: 0.6, normalStrength: 3 });
};

// Rubberized hazmat fabric with wrinkles and seams (tint via material.color)
gens.hazmat = () => {
  const W = 512, H = 512, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const wr = tileFbm(u * 5 + tileFbm(u * 3, v * 3, 3, 3, 2, 171) * 2, v * 9, 5, 9, 4, 172);
      const wrinkle = Math.pow(Math.abs(Math.sin(wr * 12)), 0.6);
      const grain = hash01(x, y, 173);
      const seam = Math.abs(u - 0.5) < 0.006 || Math.abs(v - 0.5) < 0.004;
      const stitch = seam && ((x + y) % 8 < 4);
      const t = 0.93 + (wrinkle - 0.5) * 0.08 + (grain - 0.5) * 0.03 - (seam ? 0.12 : 0) - (stitch ? 0.05 : 0);
      setCol(L, i, t, t, t);
      L.height[i] = wrinkle * 0.6 + grain * 0.08 + (seam ? 0.5 : 0);
      L.rough[i] = 0.5 + wrinkle * 0.15 + grain * 0.05;
    }
  }
  return finish(L, { size: 0.5, normalStrength: 2.2 });
};

// Glossy plastic micro-texture (tint via color)
gens.plastic = () => {
  const W = 256, H = 256, L = new Layer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = L.idx(x, y);
      const u = x / W, v = y / H;
      const n = tileFbm(u * 20, v * 20, 20, 20, 2, 181);
      const scuff = tileFbm(u * 3, v * 3, 3, 3, 4, 182);
      const t = 0.97 + (n - 0.5) * 0.04 - smoothstep(0.6, 0.8, scuff) * 0.05;
      setCol(L, i, t, t, t);
      L.height[i] = n * 0.25;
      L.rough[i] = 0.35 + smoothstep(0.55, 0.8, scuff) * 0.25 + n * 0.05;
    }
  }
  return finish(L, { size: 0.5, normalStrength: 0.6 });
};

// Grayscale tileable noise (linear) for shaders: R = low freq fbm, G = mid, B = high, A=1
gens.noise = () => {
  const W = 256, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const i = (y * W + x) * 4;
      d[i] = tileFbm(u * 4, v * 4, 4, 4, 5, 191) * 255;
      d[i + 1] = tileFbm(u * 16, v * 16, 16, 16, 4, 192) * 255;
      d[i + 2] = hash01(x, y, 193) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTex(c, false);
  return { map: t, normalMap: null, roughnessMap: null, size: 1 };
};

// ---------------------------------------------------------------------------

export function get(name, repeat = 1) {
  if (!cache.has(name)) {
    const g = gens[name];
    if (!g) throw new Error(`Unknown texture '${name}'`);
    cache.set(name, g());
  }
  const base = cache.get(name);
  if (repeat === 1) return base;
  const key = `${name}@${repeat}`;
  if (!variantCache.has(key)) {
    const v = { size: base.size, hasMetal: base.hasMetal };
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      if (base[k]) {
        v[k] = base[k].clone();
        v[k].repeat.set(repeat, repeat);
        v[k].needsUpdate = true;
      }
    }
    cache.set(key, v);
    variantCache.set(key, true);
  }
  return cache.get(key);
}

export function names() {
  return Object.keys(gens);
}

// World surfaces now come from GPU-synthesized sets (materials.js + src/world/env/recipes.js); their old canvas
// generators stay available for anyone still calling Tex.get() on them but are no longer generated at boot.
const SYNTHESIZED = new Set(['wallpaper', 'carpet', 'ceiling', 'concrete', 'officeCarpet', 'linoleum', 'paint', 'panel', 'tile', 'lightpanel']);

// Generate everything up front (call during loading screen); yields between textures.
export async function preload(onProgress) {
  const list = names().filter((n) => !SYNTHESIZED.has(n));
  const total = list.length + 1;
  for (let i = 0; i < list.length; i++) {
    get(list[i]);
    onProgress?.((i + 1) / total, list[i]);
    await new Promise((r) => setTimeout(r, 0));
  }
  // synthesize the world material sets (dynamic import: materials.js imports this module)
  try {
    const M = await import('./materials.js');
    await M.warmWorld?.((p, n) => onProgress?.((list.length + p) / total, n));
  } catch (e) {
    console.warn('[textures] world material warm-up failed', e);
  }
}

// Simple 2D canvas text/label texture helper (posters, signs, labels)
export function labelTexture(w, h, draw, srgb = true) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.userData.canvas = c;
  t.userData.ctx = ctx;
  return t;
}
