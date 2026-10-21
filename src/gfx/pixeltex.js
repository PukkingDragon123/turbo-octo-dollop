// Pixel-art texture pass. Turns every procedural material texture into crisp, realistic pixel art:
//   - resampled (gamma-correct box filter) to a target texel density (texels per metre, measured from the
//     mesh's UV-vs-world area and the texture repeat), power-of-two steps so tiling patterns stay aligned,
//   - light unsharp mask + a 1-texel dark edge on strong luminance steps (hand-painted outline feel),
//   - colours quantized per texture to a median-cut palette (~20-48 colours) with ordered Bayer 4x4 dither,
//   - normal maps resampled + renormalized, roughness/ORM maps resampled + 8-level dithered quantize,
//   - NearestFilter magnification (visible texels up close) + trilinear mipmapped minification (no shimmer).
// Results are new small DataTextures swapped into material slots (originals stay untouched for any code that
// reads their pixels or keeps animating them; offset/repeat changes on the original are mirrored each frame).
// A texture whose version changes after it was swapped (an animated screen) is put back and, if it keeps
// changing, never processed again. Processing is cached per texture source and done once, time-sliced:
//   pixelPass.update(engine)  -- called from engine.render(): sweeps scene/vmScene/view scene incrementally and
//                                runs jobs within PIXEL.budgetMs per frame
//   renderer.compileAsync     -- wrapped on first update: worlds are fully processed behind the loading screen
// Opt out: texture/material/object .userData.noPixel = true. Toggle: ?pixel=0, profile.settings.pixelArt.
import * as THREE from 'three';
import { profile } from '../core/profile.js';
import { gpuResample } from './texsynth.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const qn = (k, d) => { const v = Q.get(k); return v !== null && v !== '' && Number.isFinite(+v) ? +v : d; };
const URL_ENABLED = Q.has('pixel') ? Q.get('pixel') !== '0' : null;

// One config object for every strength knob (URL overrides: pxd, pxp, pxc, pxdither, pxedge).
export const PIXEL = {
  enabled: true,
  density: qn('pxd', 128), // texels per metre on world surfaces (walls, floors, ceilings)
  propDensity: qn('pxp', 176), // furniture, items, creatures: seen up close, a little denser
  minSize: 16,
  maxSize: 1024,
  colors: qn('pxc', 32), // default palette size per texture
  dither: qn('pxdither', 0.75), // ordered dither spread, in palette steps
  edge: qn('pxedge', 0.5), // dark 1-texel outline on strong luminance edges (0 = off)
  edgeThreshold: 0.11, // luminance step (0..1) that counts as an edge
  sharpen: 0.35, // unsharp amount after the downsample
  dataLevels: 8, // roughness / AO / metal quantization levels
  gpu: Q.get('pxgpu') !== '0', // box-filter downsample on the GPU (texsynth's private context); CPU fallback
  minFilter: THREE.LinearMipmapLinearFilter,
  budgetMs: 3.5, // per-frame processing budget
  sweepInterval: 1.0, // seconds between scene sweeps
  stableSec: 1.5, // a non-factory texture must be unchanged this long before it is processed in-game
  basic: false, // also process MeshBasicMaterial maps (mostly screens, glows and signs: off)
  disposeOriginals: true, // free the GPU copy of a replaced original (re-uploads automatically if used again)
  // per material family (first match on recipe / texture / material name); world: uses PIXEL.density
  families: [
    { re: /carpet|rug|felt|fabric|uphol|burlap|knit|ticking|quilt|insulation|towel|cloth|sack|wool/, colors: 40, dither: 1.0, edge: 0.25, sharpen: 0.25 },
    { re: /tile|mosaic|ceramic|vct|terrazzo|enamel|grout/, colors: 20, dither: 0.55, edge: 0.8, world: true },
    { re: /ceiling|acoustic|prism|lightpanel|diffuser/, colors: 20, dither: 0.6, edge: 0.6, world: true },
    { re: /wallpaper/, colors: 32, dither: 0.8, edge: 0.45, world: true },
    { re: /wood|plank|bark|laminate|ply|cardboard|crate/, colors: 32, dither: 0.7, edge: 0.6 },
    { re: /metal|steel|rust|galvan|pipe|brass|chrome|brushed|foil|cast|alumin|iron|turned/, colors: 28, dither: 0.85, edge: 0.5 },
    { re: /skin|flesh|doll|pvc|tyvek|hazmat|coverall|rubber|vinyl|leather|plastic|creature|monster|smiler|bacteria|rat|fish|critter|robot/, colors: 36, dither: 0.6, edge: 0.4, sharpen: 0.3 },
    { re: /concrete|slab|cmu|plaster|stucco|paint|plenum|linoleum/, colors: 28, dither: 0.9, edge: 0.4, world: true },
    { re: /pool|water|caustic|deck/, colors: 24, dither: 0.7, edge: 0.6, world: true },
    { re: /grass|meadow|moss|soil|ground|sand|rock|pebble|forest|trail|terrain/, colors: 40, dither: 1.0, edge: 0.35, world: true },
  ],
};
if (URL_ENABLED !== null) PIXEL.enabled = URL_ENABLED;

// material slot -> role
const SLOTS = [['map', 'color'], ['emissiveMap', 'color'], ['normalMap', 'normal'], ['roughnessMap', 'data'], ['metalnessMap', 'data'], ['aoMap', 'data'], ['bumpMap', 'data'], ['alphaMap', 'data']];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16 - 0.5);
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const SRGB = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) { const l = i / 4096; SRGB[i] = 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055); }
const toSrgb = (l) => SRGB[l <= 0 ? 0 : l >= 1 ? 4096 : (l * 4096 + 0.5) | 0];

// ---------------------------------------------------------------------------
// state
const results = new WeakMap(); // Source -> Map(version|role -> result)
const subs = new WeakMap(); // original Texture -> Map(role -> { res, sub })
const subInfo = new WeakMap(); // sub -> { orig, v }
const seen = new WeakMap(); // original Texture -> { v, t, restores, dyn }
const skipTex = new WeakSet();
const recs = new Map(); // sub -> record (live swaps, checked every frame)
const jobs = new Map(); // key -> job
const queue = [];
const stats = { textures: 0, gpu: 0, ms: 0, gpuMs: 0, readMs: 0, quantMs: 0, bytesIn: 0, bytesOut: 0, restored: 0 };
let sweep = null, sweepId = 0, lastSweep = -1e9, attached = false, flushing = 0;
let scratch = null;

const now = () => performance.now();

function familyOf(tex, mat) {
  const px = tex.userData?.px;
  const s = `${px?.recipe || ''} ${px?.name || ''} ${tex.name || ''} ${mat?.name || ''} ${mat?.userData?.synth?.recipe || ''}`.toLowerCase();
  for (const f of PIXEL.families) if (f.re.test(s)) return f;
  return null;
}

function paramsFor(tex, mat) {
  // text labels (Tex.labelTexture keeps its canvas/ctx): stay readable, just crisp and lightly quantized
  if (tex.userData?.ctx || tex.userData?.canvas) return { colors: 24, dither: 0.3, edge: 0, sharpen: 0, density: PIXEL.propDensity * 3 };
  const f = familyOf(tex, mat) || {};
  const world = !!(mat?.userData?.synth || mat?.userData?.pxWorld || f.world);
  return {
    colors: f.colors ?? PIXEL.colors, dither: f.dither ?? PIXEL.dither, edge: (f.edge ?? 0.5) * (PIXEL.edge / 0.5),
    sharpen: f.sharpen ?? PIXEL.sharpen, density: world ? PIXEL.density : PIXEL.propDensity,
  };
}

function supported(tex) {
  if (!tex || !tex.isTexture || skipTex.has(tex)) return false;
  const bad = tex.userData?.noPixel || tex.isRenderTargetTexture || tex.isVideoTexture || tex.isCubeTexture || tex.isCompressedTexture || tex.isDepthTexture
    || tex.isData3DTexture || tex.isDataArrayTexture || tex.isFramebufferTexture
    || (tex.mipmaps && tex.mipmaps.length) || tex.format !== THREE.RGBAFormat || tex.type !== THREE.UnsignedByteType;
  if (bad) { skipTex.add(tex); return false; }
  const img = tex.image;
  if (!img) return false;
  if (img.data) {
    const ok = (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray) && img.width >= 8 && img.height >= 8 && img.data.length >= img.width * img.height * 4;
    if (!ok) skipTex.add(tex);
    return ok;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return img.width >= 8 && img.height >= 8;
  if (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) return img.width >= 8 && img.height >= 8;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img.complete && img.naturalWidth >= 8;
  skipTex.add(tex);
  return false;
}

function readPixels(img) {
  if (img.data) return { data: img.data, W: img.width, H: img.height };
  const W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
  if (!scratch) { scratch = document.createElement('canvas'); scratch.ctx = scratch.getContext('2d', { willReadFrequently: true }); }
  if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; } else scratch.ctx.clearRect(0, 0, W, H);
  scratch.ctx.drawImage(img, 0, 0);
  const data = scratch.ctx.getImageData(0, 0, W, H).data;
  if (W * H > 512 * 512) { scratch.width = scratch.height = 1; } // don't keep a big scratch around
  return { data, W, H };
}

// ---------------------------------------------------------------------------
// processing (generators: yield every ~64k source texels so jobs can be time-sliced)

function* resample(src, W, H, w, h, role, srgb, alpha, out) {
  const xs = new Int32Array(w + 1), ys = new Int32Array(h + 1);
  for (let x = 0; x <= w; x++) xs[x] = Math.round((x * W) / w);
  for (let y = 0; y <= h; y++) ys[y] = Math.round((y * H) / h);
  const T = srgb ? LIN : null;
  let work = 0;
  for (let y = 0; y < h; y++) {
    const y0 = ys[y], y1 = ys[y + 1];
    for (let x = 0; x < w; x++) {
      const x0 = xs[x], x1 = xs[x + 1], n = (x1 - x0) * (y1 - y0), o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      if (role === 'color' && !alpha && T) {
        for (let sy = y0; sy < y1; sy++) for (let i = (sy * W + x0) * 4, e = (sy * W + x1) * 4; i < e; i += 4) { r += T[src[i]]; g += T[src[i + 1]]; b += T[src[i + 2]]; }
        out[o] = toSrgb(r / n); out[o + 1] = toSrgb(g / n); out[o + 2] = toSrgb(b / n); out[o + 3] = 255;
      } else if (role === 'color') { // alpha-weighted (and/or non-sRGB) colour
        for (let sy = y0; sy < y1; sy++) {
          for (let i = (sy * W + x0) * 4, e = (sy * W + x1) * 4; i < e; i += 4) {
            const wa = alpha ? src[i + 3] / 255 : 1;
            if (T) { r += T[src[i]] * wa; g += T[src[i + 1]] * wa; b += T[src[i + 2]] * wa; } else { r += src[i] * wa; g += src[i + 1] * wa; b += src[i + 2] * wa; }
            ws += wa; a += src[i + 3];
          }
        }
        if (ws > 1e-6) { r /= ws; g /= ws; b /= ws; }
        out[o] = T ? toSrgb(r) : r; out[o + 1] = T ? toSrgb(g) : g; out[o + 2] = T ? toSrgb(b) : b; out[o + 3] = a / n;
      } else if (role === 'normal') {
        for (let sy = y0; sy < y1; sy++) for (let i = (sy * W + x0) * 4, e = (sy * W + x1) * 4; i < e; i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; }
        r = r / (127.5 * n) - 1; g = g / (127.5 * n) - 1; b = b / (127.5 * n) - 1;
        const l = Math.hypot(r, g, b) || 1;
        out[o] = (r / l * 0.5 + 0.5) * 255; out[o + 1] = (g / l * 0.5 + 0.5) * 255; out[o + 2] = (b / l * 0.5 + 0.5) * 255; out[o + 3] = 255;
      } else {
        for (let sy = y0; sy < y1; sy++) for (let i = (sy * W + x0) * 4, e = (sy * W + x1) * 4; i < e; i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; }
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
      }
    }
    work += (y1 - y0) * W;
    if (work > 65536) { work = 0; yield; }
  }
}

// unsharp mask (cross kernel) + dark outline on the dark side of strong luminance steps
function sharpenAndEdge(img, w, h, wrap, amount, edge, thr) {
  const n = w * h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114;
  const src = amount > 0 ? img.slice() : img;
  const T = thr * 255;
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : wrap ? h - 1 : 0, yd = y < h - 1 ? y + 1 : wrap ? 0 : h - 1;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : wrap ? w - 1 : 0, xr = x < w - 1 ? x + 1 : wrap ? 0 : w - 1;
      const i = y * w + x, a = yu * w + x, b = yd * w + x, c = y * w + xl, d = y * w + xr;
      const o = i * 4;
      if (amount > 0) {
        for (let k = 0; k < 3; k++) {
          const v = src[o + k], blur = (src[a * 4 + k] + src[b * 4 + k] + src[c * 4 + k] + src[d * 4 + k]) * 0.25;
          img[o + k] = v + (v - blur) * amount;
        }
      }
      if (edge > 0) {
        const m = Math.max(L[a], L[b], L[c], L[d]) - L[i];
        if (m > T) {
          const k = 1 - edge * 0.3 * Math.min(1, (m - T) / T + 0.35);
          img[o] *= k; img[o + 1] *= k; img[o + 2] *= k;
        }
      }
    }
  }
}

const WR = 2, WG = 4, WB = 3;
// median cut over (sub-sampled) texels, refined with one k-means step. Returns Float32Array k*3
function buildPalette(img, n, alpha, k) {
  const step = Math.max(1, Math.floor(n / 16384));
  const S = new Uint8Array(Math.ceil(n / step) * 3);
  let m = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    if (alpha && img[o + 3] < 16) continue;
    S[m * 3] = clamp8(img[o]); S[m * 3 + 1] = clamp8(img[o + 1]); S[m * 3 + 2] = clamp8(img[o + 2]); m++;
  }
  if (m === 0) return new Float32Array(3);
  const idx = new Uint32Array(m), tmp = new Uint32Array(m), cnt = new Uint32Array(256);
  for (let i = 0; i < m; i++) idx[i] = i;
  const box = (s, e) => {
    const mn = [255, 255, 255], mx = [0, 0, 0];
    for (let i = s; i < e; i++) for (let c = 0; c < 3; c++) { const v = S[idx[i] * 3 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
    const rr = [(mx[0] - mn[0]) * 1.0, (mx[1] - mn[1]) * 1.2, (mx[2] - mn[2]) * 0.8];
    const ch = rr[0] >= rr[1] && rr[0] >= rr[2] ? 0 : rr[1] >= rr[2] ? 1 : 2;
    return { s, e, ch, score: e - s > 1 ? rr[ch] * Math.sqrt(e - s) : -1 };
  };
  const boxes = [box(0, m)];
  while (boxes.length < k) {
    let bi = -1, best = 0;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].score > best) { best = boxes[i].score; bi = i; }
    if (bi < 0) break;
    const B = boxes[bi];
    cnt.fill(0);
    for (let i = B.s; i < B.e; i++) cnt[S[idx[i] * 3 + B.ch]]++;
    let acc = B.s;
    const pos = new Uint32Array(256);
    for (let v = 0; v < 256; v++) { pos[v] = acc; acc += cnt[v]; }
    for (let i = B.s; i < B.e; i++) tmp[pos[S[idx[i] * 3 + B.ch]]++] = idx[i];
    for (let i = B.s; i < B.e; i++) idx[i] = tmp[i];
    const mid = B.s + ((B.e - B.s) >> 1);
    boxes.splice(bi, 1, box(B.s, mid), box(mid, B.e));
  }
  let P = new Float32Array(boxes.length * 3);
  boxes.forEach((B, j) => {
    let r = 0, g = 0, b = 0;
    for (let i = B.s; i < B.e; i++) { r += S[idx[i] * 3]; g += S[idx[i] * 3 + 1]; b += S[idx[i] * 3 + 2]; }
    const c = Math.max(1, B.e - B.s);
    P[j * 3] = r / c; P[j * 3 + 1] = g / c; P[j * 3 + 2] = b / c;
  });
  // one k-means refinement
  const K = boxes.length, acc = new Float64Array(K * 4);
  for (let i = 0; i < m; i++) {
    const r = S[i * 3], g = S[i * 3 + 1], b = S[i * 3 + 2];
    const j = nearest(P, K, r, g, b);
    acc[j * 4] += r; acc[j * 4 + 1] += g; acc[j * 4 + 2] += b; acc[j * 4 + 3]++;
  }
  for (let j = 0; j < K; j++) if (acc[j * 4 + 3] > 0) { P[j * 3] = acc[j * 4] / acc[j * 4 + 3]; P[j * 3 + 1] = acc[j * 4 + 1] / acc[j * 4 + 3]; P[j * 3 + 2] = acc[j * 4 + 2] / acc[j * 4 + 3]; }
  return P;
}
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v + 0.5) | 0;
function nearest(P, K, r, g, b) {
  let bi = 0, bd = Infinity;
  for (let j = 0; j < K; j++) {
    const dr = P[j * 3] - r, dg = P[j * 3 + 1] - g, db = P[j * 3 + 2] - b;
    const d = WR * dr * dr + WG * dg * dg + WB * db * db;
    if (d < bd) { bd = d; bi = j; }
  }
  return bi;
}

const LUT = new Int16Array(1 << 18), LUT_STAMP = new Uint16Array(1 << 18);
let stamp = 0;

function* quantizeColor(img, w, h, alpha, p, out) {
  const n = w * h, K0 = Math.max(2, p.colors | 0);
  const P = buildPalette(img, n, alpha, K0), K = P.length / 3;
  // dither spread = mean distance from a palette colour to its nearest neighbour (per channel units)
  let nn = 0;
  for (let j = 0; j < K; j++) {
    let bd = Infinity;
    for (let q = 0; q < K; q++) { if (q === j) continue; const d = Math.hypot(P[j * 3] - P[q * 3], P[j * 3 + 1] - P[q * 3 + 1], P[j * 3 + 2] - P[q * 3 + 2]); if (d < bd) bd = d; }
    if (bd < Infinity) nn += bd;
  }
  const spread = K > 1 ? (nn / K) * p.dither : 0;
  stamp = (stamp + 1) & 0xffff;
  if (stamp === 0) { LUT_STAMP.fill(0); stamp = 1; }
  yield;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, t = BAYER[(y & 3) * 4 + (x & 3)], v = t * spread;
      const r = clamp8(img[o] + v), g = clamp8(img[o + 1] + v), b = clamp8(img[o + 2] + v);
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let j;
      if (LUT_STAMP[key] === stamp) j = LUT[key];
      else { j = nearest(P, K, r, g, b); LUT[key] = j; LUT_STAMP[key] = stamp; }
      out[o] = P[j * 3] + 0.5; out[o + 1] = P[j * 3 + 1] + 0.5; out[o + 2] = P[j * 3 + 2] + 0.5;
      out[o + 3] = alpha ? clamp8(Math.round(img[o + 3] / 255 * 7 + t * 0.9) / 7 * 255) : 255;
    }
    if ((y & 31) === 31) yield;
  }
}

function quantizeData(img, w, h, levels, out) {
  const L = levels - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, t = BAYER[(y & 3) * 4 + (x & 3)];
      for (let k = 0; k < 3; k++) { const q = Math.round(img[o + k] / 255 * L + t); out[o + k] = (q < 0 ? 0 : q > L ? L : q) / L * 255 + 0.5; }
      out[o + 3] = clamp8(img[o + 3]);
    }
  }
}

let gpuBroken = false;
function* processJob(job) {
  const { w, h, role, p } = job;
  let img = null, alpha = false, flip = job.flip;
  if (PIXEL.gpu && !gpuBroken) { // box filter on the GPU (mipmaps), tiny readback
    const t0 = now();
    try {
      const b = gpuResample(job.tex, w, h, role);
      if (b) { img = Float32Array.from(b); flip = false; stats.gpu++; }
    } catch (e) { gpuBroken = true; console.warn('[pixeltex] GPU resample unavailable, using CPU', e); }
    stats.ms += now() - t0; stats.gpuMs += now() - t0;
    if (img && role === 'color') for (let i = 3; i < img.length; i += 4) if (img[i] < 250) { alpha = true; break; }
    yield;
  }
  if (!img) { // CPU fallback: gamma-correct, alpha-weighted box filter over the full-size pixels
    const t0 = now();
    const { data, W, H } = readPixels(job.src.data);
    stats.ms += now() - t0; stats.readMs += now() - t0;
    yield;
    if (role === 'color') for (let i = 3, n = W * H * 4, s = Math.max(4, ((n / 4 / 4096) | 0) * 4); i < n; i += s) if (data[i] < 250) { alpha = true; break; }
    img = new Float32Array(w * h * 4);
    yield* timed(resample(data, W, H, w, h, role, job.srgb, alpha, img));
  }
  const out = new Uint8Array(w * h * 4);
  if (role === 'color') {
    const t = now();
    sharpenAndEdge(img, w, h, job.wrap, p.sharpen, p.edge, PIXEL.edgeThreshold);
    stats.ms += now() - t;
    yield;
    const q0 = stats.ms;
    yield* timed(quantizeColor(img, w, h, alpha, p, out));
    stats.quantMs += stats.ms - q0;
  } else if (role === 'normal') {
    for (let i = 0; i < out.length; i++) out[i] = img[i] + 0.5;
  } else {
    const t = now();
    quantizeData(img, w, h, PIXEL.dataLevels, out);
    stats.ms += now() - t;
  }
  let res = out;
  if (flip) { // canvas rows are top-down; the result is a flipY=false DataTexture
    res = new Uint8Array(out.length);
    const row = w * 4;
    for (let y = 0; y < h; y++) res.set(out.subarray(y * row, y * row + row), (h - 1 - y) * row);
  }
  const W = job.tex.image.width || job.tex.image.naturalWidth, H = job.tex.image.height || job.tex.image.naturalHeight;
  stats.textures++; stats.bytesIn += W * H * 4; stats.bytesOut += w * h * 4;
  return { role, w, h, source: new (THREE.TextureSource || THREE.Source)({ data: res, width: w, height: h }) };
}

function* timed(gen) {
  for (;;) {
    const t = now();
    const r = gen.next();
    stats.ms += now() - t;
    if (r.done) return r.value;
    yield;
  }
}

// ---------------------------------------------------------------------------
// density estimate: metres per UV unit from the mesh's world-vs-UV triangle areas
const geoMpu = new WeakMap();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

function metresPerUv(mesh, channel) {
  const g = mesh.geometry;
  if (!g?.attributes?.position) return 0;
  const name = channel ? `uv${channel}` : 'uv';
  let per = geoMpu.get(g);
  if (!per) { per = {}; geoMpu.set(g, per); }
  if (per[name] === undefined) {
    const pos = g.attributes.position, uv = g.attributes[name] || g.attributes.uv, ix = g.index;
    let A = 0, U = 0;
    if (uv) {
      const tris = (ix ? ix.count : pos.count) / 3 | 0, step = Math.max(1, (tris / 160) | 0);
      for (let t = 0; t < tris; t += step) {
        const i0 = ix ? ix.getX(t * 3) : t * 3, i1 = ix ? ix.getX(t * 3 + 1) : t * 3 + 1, i2 = ix ? ix.getX(t * 3 + 2) : t * 3 + 2;
        _a.fromBufferAttribute(pos, i0); _b.fromBufferAttribute(pos, i1).sub(_a); _c.fromBufferAttribute(pos, i2).sub(_a);
        const area = _b.cross(_c).length();
        const u0 = uv.getX(i0), v0 = uv.getY(i0);
        const ua = Math.abs((uv.getX(i1) - u0) * (uv.getY(i2) - v0) - (uv.getX(i2) - u0) * (uv.getY(i1) - v0));
        if (ua > 1e-12 && area > 1e-12) { A += area; U += ua; }
      }
    }
    per[name] = U > 0 ? Math.sqrt(A / U) : 0;
  }
  if (!per[name]) return 0;
  _s.setFromMatrixScale(mesh.matrixWorld);
  let sc = (Math.abs(_s.x) + Math.abs(_s.y) + Math.abs(_s.z)) / 3;
  if (mesh.isInstancedMesh && mesh.count > 0) { mesh.getMatrixAt(0, _m); _s.setFromMatrixScale(_m); sc *= (Math.abs(_s.x) + Math.abs(_s.y) + Math.abs(_s.z)) / 3; }
  return per[name] * (sc || 1);
}

// scale factor (<= 1, power of two) for this use of the texture
function factorFor(mesh, mat, tex, density) {
  const W = tex.image.width || tex.image.naturalWidth, H = tex.image.height || tex.image.naturalHeight;
  let tx, ty;
  const tri = mat.userData?.triplanar;
  if (tri) { tx = 1 / (tri.scale * Math.abs(tex.repeat.x || 1)); ty = 1 / (tri.scale * Math.abs(tex.repeat.y || 1)); } else {
    const mpu = mesh ? metresPerUv(mesh, tex.channel) : 0;
    const m = mpu || tex.userData?.px?.meters || 0.6;
    tx = m / Math.abs(tex.repeat.x || 1); ty = m / Math.abs(tex.repeat.y || 1);
  }
  const f = Math.max((density * tx) / W, (density * ty) / H);
  return Math.min(1, 2 ** Math.round(Math.log2(Math.max(f, 1e-4))));
}

// ---------------------------------------------------------------------------
// swapping

function subFor(orig, res) {
  let m = subs.get(orig);
  if (!m) { m = new Map(); subs.set(orig, m); }
  const e = m.get(res.role);
  if (e && e.res === res) return e.sub;
  const t = new THREE.DataTexture(null, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.source = res.source;
  t.name = orig.name; t.mapping = orig.mapping; t.channel = orig.channel;
  t.wrapS = orig.wrapS; t.wrapT = orig.wrapT;
  t.offset.copy(orig.offset); t.repeat.copy(orig.repeat); t.center.copy(orig.center); t.rotation = orig.rotation;
  t.matrixAutoUpdate = orig.matrixAutoUpdate; t.matrix.copy(orig.matrix);
  t.colorSpace = orig.colorSpace; t.anisotropy = orig.anisotropy;
  t.flipY = false; t.premultiplyAlpha = false; t.unpackAlignment = 4; t.generateMipmaps = true;
  t.magFilter = THREE.NearestFilter; t.minFilter = PIXEL.minFilter;
  t.userData.pxSub = true;
  t.needsUpdate = true;
  m.set(res.role, { res, sub: t });
  subInfo.set(t, { orig, v: orig.version });
  return t;
}

function record(sub, orig, mat, slot) {
  let r = recs.get(sub);
  if (!r) {
    const info = subInfo.get(sub);
    r = { orig, sub, v: info ? info.v : orig.version, uses: [], seen: sweepId, ox: orig.offset.x, oy: orig.offset.y, rx: orig.repeat.x, ry: orig.repeat.y, rot: orig.rotation };
    recs.set(sub, r);
  }
  r.seen = sweepId;
  for (const u of r.uses) if (u[0] === mat && u[1] === slot) return r;
  r.uses.push([mat, slot]);
  return r;
}

function swap(mat, slot, orig, res) {
  if (mat[slot] !== orig) return false;
  const sub = subFor(orig, res);
  mat[slot] = sub;
  record(sub, orig, mat, slot);
  return true;
}

function restore(r, permanent) {
  for (const [mat, slot] of r.uses) if (mat[slot] === r.sub) mat[slot] = r.orig;
  recs.delete(r.sub);
  if (permanent) return;
  stats.restored++;
  const s = seen.get(r.orig) || { v: r.orig.version, t: now(), restores: 0, dyn: false };
  s.v = r.orig.version; s.t = now(); s.restores++;
  if (s.restores >= 2) s.dyn = true;
  seen.set(r.orig, s);
}

// every frame: put back textures that their owner redrew, mirror offset/repeat animation of the original
function syncRecords() {
  for (const r of recs.values()) {
    const o = r.orig;
    if (o.version !== r.v) { restore(r); continue; }
    if (o.offset.x !== r.ox || o.offset.y !== r.oy || o.repeat.x !== r.rx || o.repeat.y !== r.ry || o.rotation !== r.rot) {
      r.sub.offset.copy(o.offset); r.sub.repeat.copy(o.repeat); r.sub.rotation = o.rotation; r.sub.center.copy(o.center);
      r.ox = o.offset.x; r.oy = o.offset.y; r.rx = o.repeat.x; r.ry = o.repeat.y; r.rot = o.rotation;
    }
  }
}

// ---------------------------------------------------------------------------
// sweeping

function eligible(tex, t, flush) {
  let s = seen.get(tex);
  if (!s) { s = { v: tex.version, t, restores: 0, dyn: false }; seen.set(tex, s); }
  if (s.dyn) return false;
  if (s.v !== tex.version) { s.v = tex.version; s.t = t; return flush && s.restores === 0; }
  return flush || !!tex.userData?.px || t - s.t >= PIXEL.stableSec * 1000;
}

function resultFor(src, role) {
  const m = results.get(src);
  return m ? m.get(`${src.version}|${role}`) : undefined;
}

function visitMesh(o, ctx) {
  if (!o.isMesh || o.userData?.noPixel) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const mat of mats) {
    if (!mat || mat.userData?.noPixel || mat.isShaderMaterial || (mat.isMeshBasicMaterial && !PIXEL.basic) || mat.isSpriteMaterial) continue;
    for (const [slot, role0] of SLOTS) {
      const tex = mat[slot];
      if (!tex) continue;
      if (tex.userData?.pxSub) {
        const info = subInfo.get(tex);
        if (info) { const r = record(tex, info.orig, mat, slot); if (info.orig.version !== r.v) restore(r); }
        continue;
      }
      if (!supported(tex) || !eligible(tex, ctx.t, ctx.flush)) continue;
      const role = tex.userData?.px?.kind || role0;
      const src = tex.source;
      const res = resultFor(src, role);
      if (res) { swap(mat, slot, tex, res); continue; }
      const key = `${src.uuid}|${src.version}|${role}`;
      const job = jobs.get(key) || ctx.pend.get(key);
      const p = job ? job.p : paramsFor(tex, mat);
      const f = factorFor(o, mat, tex, p.density);
      if (job) { job.uses.push([mat, slot, tex]); if (!job.gen && f > job.f) job.f = f; continue; }
      ctx.pend.set(key, { key, src, ver: src.version, role, p, f, uses: [[mat, slot, tex]], tex });
    }
  }
}

function startJobs(pend) {
  for (const j of pend.values()) { jobs.set(j.key, j); queue.push(j); }
  pend.clear();
}

// final size, decided when the job starts (later uses may have asked for more detail)
function sizeJob(j) {
  const tex = j.tex, W = tex.image.width || tex.image.naturalWidth, H = tex.image.height || tex.image.naturalHeight;
  let f = j.f;
  const mn = Math.min(W, H), mx = Math.max(W, H);
  while (f < 1 && mn * f < PIXEL.minSize) f *= 2; // clamp into [minSize, maxSize], never upsample
  while (mx * f > PIXEL.maxSize) f /= 2;
  j.f = Math.min(1, f);
  j.w = Math.max(1, Math.round(W * j.f)); j.h = Math.max(1, Math.round(H * j.f));
  j.srgb = tex.colorSpace === THREE.SRGBColorSpace;
  j.wrap = tex.wrapS !== THREE.ClampToEdgeWrapping;
  j.flip = !tex.image.data && tex.flipY;
}

const LOG = Q.get('pxlog') === '1';
function finishJob(j, res) {
  jobs.delete(j.key);
  if (LOG) console.log(`[px] ${j.role} ${j.tex.name || j.tex.userData?.px?.recipe || j.tex.userData?.px?.name || '?'} ${j.tex.image.width}x${j.tex.image.height}->${j.w}x${j.h} ${j.ms | 0}ms/${(now() - j.t0) | 0}ms uses=${j.uses.length}`);
  if (!res || j.src.version !== j.ver) return;
  let m = results.get(j.src);
  if (!m) { m = new Map(); results.set(j.src, m); }
  m.set(`${j.ver}|${j.role}`, res);
  if (!PIXEL.enabled) return;
  const done = new Set();
  for (const [mat, slot, tex] of j.uses) if (swap(mat, slot, tex, res)) done.add(tex);
  if (PIXEL.disposeOriginals) for (const t of done) if (!t.userData?.noPixel) t.dispose();
}

function runJobs(deadline) {
  while (queue.length) {
    const j = queue[0];
    let r;
    try {
      if (!j.gen) { if (j.src.version !== j.ver) { queue.shift(); jobs.delete(j.key); continue; } sizeJob(j); j.t0 = now(); j.gen = processJob(j); }
      const t = now();
      r = j.gen.next();
      j.ms = (j.ms || 0) + now() - t;
    } catch (e) {
      console.warn('[pixeltex] job failed', j.key, e);
      r = { done: true, value: null };
      for (const u of j.uses) skipTex.add(u[2]);
    }
    if (r.done) { queue.shift(); finishJob(j, r.value); }
    if (now() > deadline) return;
  }
}

function rootsOf(engine) {
  const out = [];
  for (const s of [engine.view?.scene, engine.scene, engine.vmScene]) if (s && !out.includes(s)) out.push(s);
  return out;
}

// incremental sweep (explicit stack, resumable across frames)
function advanceSweep(deadline) {
  const S = sweep;
  let k = 0;
  while (S.stack.length) {
    const o = S.stack.pop();
    visitMesh(o, S);
    const ch = o.children;
    for (let i = ch.length - 1; i >= 0; i--) S.stack.push(ch[i]);
    if ((++k & 63) === 0 && now() > deadline) return false;
  }
  startJobs(S.pend);
  // forget swaps whose materials left the scene (materials keep their sub; it is re-recorded on return)
  for (const r of recs.values()) if (r.seen < sweepId - 3) recs.delete(r.sub);
  sweep = null;
  return true;
}

function fullSweep(roots, flush) {
  sweepId++;
  const ctx = { stack: [], pend: new Map(), t: now(), flush };
  for (const r of roots) { r.updateMatrixWorld?.(); r.traverse((o) => visitMesh(o, ctx)); }
  startJobs(ctx.pend);
}

// ---------------------------------------------------------------------------
// public API

function settingEnabled() {
  if (URL_ENABLED !== null) return URL_ENABLED;
  return profile?.data?.settings?.pixelArt !== false;
}

export function setEnabled(on) {
  on = !!on;
  if (PIXEL.enabled === on) return;
  PIXEL.enabled = on;
  if (!on) for (const r of [...recs.values()]) restore(r, true);
  lastSweep = -1e9;
}

// Process every texture in the given scenes now (time-sliced with setTimeout yields unless sync).
export async function flush(roots, { sync = false } = {}) {
  if (!PIXEL.enabled) return;
  flushing++;
  try {
    fullSweep(roots, true);
    while (queue.length) {
      runJobs(now() + (sync ? 1e9 : 40));
      if (!sync && queue.length) await new Promise((r) => setTimeout(r, 0));
    }
  } finally { flushing--; }
}

function attach(engine) {
  attached = true;
  const r = engine.renderer;
  if (r && !r.__pixelWrapped) {
    const orig = r.compileAsync.bind(r);
    r.compileAsync = async (scene, camera, target) => {
      try { await flush([scene]); } catch (e) { console.warn('[pixeltex] flush failed', e); }
      return orig(scene, camera, target);
    };
    r.__pixelWrapped = true;
  }
  if (typeof window !== 'undefined') window.__pixel = pixelPass;
}

export const pixelPass = {
  config: PIXEL,
  stats,
  flush,
  setEnabled,
  update(engine) {
    if (!attached) {
      attach(engine);
      PIXEL.enabled = settingEnabled();
      if (PIXEL.enabled) { flushing++; try { fullSweep(rootsOf(engine), true); runJobs(1e15); } finally { flushing--; } }
    }
    if (recs.size) syncRecords();
    const t = now();
    if (t - lastSweep > PIXEL.sweepInterval * 1000) {
      const want = settingEnabled();
      if (want !== PIXEL.enabled) setEnabled(want);
    }
    if (!PIXEL.enabled || flushing) return;
    const deadline = t + PIXEL.budgetMs;
    if (!sweep && t - lastSweep > PIXEL.sweepInterval * 1000) {
      lastSweep = t;
      sweepId++;
      sweep = { stack: rootsOf(engine).slice(), pend: new Map(), t, flush: false };
    }
    if (sweep) advanceSweep(deadline);
    if (queue.length && now() < deadline) runJobs(deadline);
  },
};

// Pixelize one texture right now (synchronous). opts: role ('color'|'normal'|'data'), meters (tile size), density,
// colors, dither, edge, sharpen. Returns the processed texture (cached), or the input when it can't be processed.
export function pixelizeTexture(tex, opts = {}) {
  if (!tex || tex.userData?.pxSub || !supported(tex)) return tex;
  const role = opts.role || tex.userData?.px?.kind || (tex.colorSpace === THREE.SRGBColorSpace ? 'color' : 'data');
  const src = tex.source;
  let res = resultFor(src, role);
  if (!res) {
    const p = { ...paramsFor(tex, null), ...opts };
    const W = tex.image.width || tex.image.naturalWidth, H = tex.image.height || tex.image.naturalHeight;
    const m = opts.meters ?? tex.userData?.px?.meters ?? 1;
    const f = Math.min(1, 2 ** Math.round(Math.log2(Math.max(1e-4, (p.density * m) / Math.max(W, H)))));
    const pend = new Map([['x', { key: `${src.uuid}|${src.version}|${role}`, src, ver: src.version, role, p, f, uses: [], tex }]]);
    startJobs(pend);
    const j = queue.pop();
    jobs.delete(j.key);
    sizeJob(j);
    const g = processJob(j);
    let r;
    do r = g.next(); while (!r.done);
    finishJob(j, r.value);
    res = r.value;
  }
  return res ? subFor(tex, res) : tex;
}
