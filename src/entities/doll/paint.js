// R.O.O.M. — spray paint layer for the clone android (body + face painting).
//
// Paint lives in one RGBA canvas atlas per painted clone, blended over the base materials (coverall,
// ABS shell, porcelain face, rubber, plastic, metal). The procedural body has no unique UV unwrap, so the
// atlas is "region triplanar": the body is split into 8 regions by bone (head, torso, arms, hands, legs)
// and every region owns 5 orthographic tiles (+X, -X, +Z, -Z, +Y) of its rest-space bounding box. A
// surface point reads the tiles its rest normal faces (blended like triplanar mapping), weighted by how
// much of each region its skin weights belong to (computed in the vertex shader from skinIndex). There
// are no seams, legs / arms never paint each other, and a spray dab is plain 2D canvas drawing.
//
//   PaintLayer          canvas + texture; dab() (soft spray with speckled edges, build-up), wipe, undo
//                       snapshots, encode() -> small string for the network / profile, decode
//   paintHit(i, out)    raycast intersection on a painted avatar mesh -> rest point / normal / regions
//   paintMaterial(m, L) per-avatar clone of a base material with the paint layer injected
//   paintTexture(str)   shared texture for an encoded paint string (async decode, cached)
//
// Rest space = rig rest space in design units (feet at the origin, facing -Z, 1.70 m). Paint coordinates
// use the pre-morph rest positions (attribute paintPos) so a body-plan change keeps the paint in place.
import * as THREE from 'three';
import { BONE_NAMES } from './robotrig.js';
import { hashString } from '../../core/rng.js';

export const PAINT_KEYS = new Set(['suit', 'shell', 'face', 'rubber', 'plastic', 'metal']);
export const REGION_NAMES = ['head', 'torso', 'armL', 'armR', 'handL', 'handR', 'legL', 'legR'];
const REG_OF = {
  head: 0, jaw: 0, lidUL: 0, lidUR: 0, lidDL: 0, lidDR: 0, browL: 0, browR: 0,
  pelvis: 1, spine: 1, chest: 1, neck: 1,
  shL: 2, elL: 2, shR: 3, elR: 3,
  wrL: 4, fiL: 4, fjL: 4, ixL: 4, thL: 4, wrR: 5, fiR: 5, fjR: 5, ixR: 5, thR: 5,
  hipL: 6, knL: 6, anL: 6, hipR: 7, knR: 7, anR: 7,
};
export const BONE_REGION = BONE_NAMES.map((n) => REG_OF[n] ?? -1);

// region bounding boxes (rest space, measured from the stock body + every head layout, padded)
const PAD = 0.016;
const BOX = [
  [[-0.085, 1.468, -0.12], [0.085, 1.703, 0.102], 1.8],
  [[-0.164, 0.85, -0.13], [0.163, 1.5, 0.107], 1.0],
  [[-0.231, 0.857, -0.051], [-0.106, 1.413, 0.051], 1.0],
  [[0.106, 0.857, -0.051], [0.231, 1.415, 0.051], 1.0],
  [[-0.196, 0.675, -0.076], [-0.132, 0.851, 0.04], 1.5],
  [[0.132, 0.675, -0.076], [0.196, 0.851, 0.04], 1.5],
  [[-0.176, 0.005, -0.197], [0.004, 0.985, 0.091], 0.9],
  [[-0.004, 0.005, -0.197], [0.176, 0.985, 0.091], 0.9],
];
export const REG_MIN = BOX.map(([a]) => new THREE.Vector3(a[0] - PAD, a[1] - PAD, a[2] - PAD));
export const REG_SIZE = BOX.map(([a, b]) => new THREE.Vector3(b[0] - a[0] + 2 * PAD, b[1] - a[1] + 2 * PAD, b[2] - a[2] + 2 * PAD));
const REG_DENS = BOX.map((b) => b[2]);

// tiles: 0 +X, 1 -X (u = z, v = down y), 2 +Z, 3 -Z (u = x, v = down y), 4 +Y (u = x, v = z)
// rect = [u0, v0, du, dv] in atlas UV (v down: canvas rows, texture flipY = false); px = pixels per metre
function packLayout() {
  const tiles = [];
  for (let r = 0; r < 8; r++) {
    const s = REG_SIZE[r], d = REG_DENS[r];
    const dims = [[s.z, s.y], [s.z, s.y], [s.x, s.y], [s.x, s.y], [s.x, s.z]];
    dims.forEach(([w, h], t) => tiles.push({ r, t, w: w * d, h: h * d }));
  }
  const order = tiles.slice().sort((a, b) => b.h - a.h || b.w - a.w || a.r - b.r || a.t - b.t);
  const GAP = 6 / 1024;
  const fits = (k) => {
    let x = GAP, y = GAP, rowH = 0;
    for (const T of order) {
      const w = T.w * k, h = T.h * k;
      if (x + w + GAP > 1) { x = GAP; y += rowH + GAP; rowH = 0; }
      T._x = x; T._y = y; x += w + GAP; rowH = Math.max(rowH, h);
      if (y + h + GAP > 1) return false;
    }
    return true;
  };
  let lo = 0.1, hi = 3;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  fits(lo);
  const rects = new Array(40);
  for (const T of tiles) rects[T.r * 5 + T.t] = [T._x, T._y, T.w * lo, T.h * lo];
  return { rects, k: lo };
}
export const LAYOUT = packLayout();
// atlas UV of a rest point q (0..1 inside its region box) on tile t of region r
export function tileUV(r, t, q, out) {
  const R = LAYOUT.rects[r * 5 + t];
  let u, v;
  if (t < 2) { u = q.z; v = 1 - q.y; } else if (t < 4) { u = q.x; v = 1 - q.y; } else { u = q.x; v = q.z; }
  out.x = R[0] + R[2] * u; out.y = R[1] + R[3] * v;
  return out;
}
const TILE_AXIS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)];

// ---------------------------------------------------------------------------
// paint colours: the cans on the paint shelf (ids are stable: strokes / presets reference them)
export const PAINT_COLORS = [
  { id: 'rust', name: 'Rust Orange', hex: 0xc4572a },
  { id: 'teal', name: 'Faded Teal', hex: 0x3f8c8a },
  { id: 'rose', name: 'Dusty Rose', hex: 0xd08a8e },
  { id: 'sage', name: 'Sage', hex: 0x8ea67a },
  { id: 'honey', name: 'Honey', hex: 0xf0bf4a },
  { id: 'cream', name: 'Cream', hex: 0xf1e6cc },
  { id: 'cobalt', name: 'Cobalt', hex: 0x3557a6 },
  { id: 'plum', name: 'Plum', hex: 0x6e3f6e },
  { id: 'olive', name: 'Olive Drab', hex: 0x5d6236 },
  { id: 'brick', name: 'Brick Red', hex: 0xa83228 },
  { id: 'soot', name: 'Soot Black', hex: 0x24221f },
  { id: 'chalk', name: 'Chalk White', hex: 0xfbf8f0 },
];

// ---------------------------------------------------------------------------
const _q = new THREE.Vector3(), _uv = new THREE.Vector2();
const PI = Math.PI;
let _seed = 1;
const rnd = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
const hexCss = (hex, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

export class PaintLayer {
  constructor(size = 1024) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.premultiplyAlpha = true;
    this.texture.anisotropy = 4;
    this.texture.name = 'paint_layer';
    this.undoStack = [];
    this.dirty = false;
    this.empty = true;
    this.strokes = 0;
  }
  // upload pending changes (call once per frame)
  flush() { if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; } }
  clear() { this.ctx.clearRect(0, 0, this.size, this.size); this.dirty = true; this.empty = true; }
  // undo checkpoint before a stroke
  checkpoint(max = 10) {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    this.undoStack.push({ c, empty: this.empty });
    while (this.undoStack.length > max) this.undoStack.shift();
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.ctx.drawImage(s.c, 0, 0);
    this.empty = s.empty;
    this.dirty = true;
    return true;
  }
  get canUndo() { return this.undoStack.length > 0; }

  // One spray dab at a paint hit ({ p: rest point, n: rest normal, reg: Float32Array(8) }).
  // radius in metres; strength 0..1 is the alpha laid down this dab (repeated passes build up);
  // opts.wipe: rag (removes paint), opts.speckle: overspray dots at the edge, opts.seed: deterministic
  dab(hit, hex, radius, strength, opts = {}) {
    const g = this.ctx, S = this.size;
    _seed = (opts.seed ?? ((Math.random() * 1e9) | 0)) % 2147483646 + 1;
    const wipe = !!opts.wipe, speck = opts.speckle ?? 1;
    for (let r = 0; r < 8; r++) {
      const rw = hit.reg[r];
      if (rw < 0.03) continue;
      const kr = Math.min(1, rw / 0.35);
      _q.copy(hit.p).sub(REG_MIN[r]).divide(REG_SIZE[r]);
      if (_q.x < -0.2 || _q.x > 1.2 || _q.y < -0.2 || _q.y > 1.2 || _q.z < -0.2 || _q.z > 1.2) continue;
      const pxm = LAYOUT.k * REG_DENS[r] * S;   // atlas pixels per metre in this region
      for (let t = 0; t < 5; t++) {
        const f = hit.n.dot(TILE_AXIS[t]);
        if (f < 0.08) continue;
        const kt = Math.min(1, (f - 0.08) / 0.32) * kr;
        const R = LAYOUT.rects[r * 5 + t];
        tileUV(r, t, _q, _uv);
        const cx = _uv.x * S, cy = _uv.y * S, rad = Math.max(1.2, radius * pxm);
        g.save();
        g.beginPath(); g.rect(R[0] * S, R[1] * S, R[2] * S, R[3] * S); g.clip();
        g.globalCompositeOperation = wipe ? 'destination-out' : 'source-over';
        const a = Math.min(1, strength * kt);
        const col = wipe ? 0x000000 : hex;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, hexCss(col, a));
        gr.addColorStop(0.3, hexCss(col, a * 0.88));
        gr.addColorStop(0.62, hexCss(col, a * 0.42));
        gr.addColorStop(0.85, hexCss(col, a * 0.12));
        gr.addColorStop(1, hexCss(col, 0));
        g.fillStyle = gr;
        g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        // overspray: a few fine droplets scattered round the edge of the cone
        if (!wipe && speck > 0) {
          const n = Math.round((2 + rad * 0.12) * speck * Math.min(1, strength * 4));
          g.fillStyle = hexCss(hex, Math.min(1, 0.55 + strength));
          for (let i = 0; i < n; i++) {
            const ang = rnd() * Math.PI * 2, d = rad * (0.75 + rnd() * 0.75);
            const dr = Math.max(0.5, (0.35 + rnd() * 0.9) * pxm * 0.0012);
            g.globalAlpha = 0.35 + rnd() * 0.6;
            g.beginPath(); g.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, dr, 0, Math.PI * 2); g.fill();
          }
          g.globalAlpha = 1;
        }
        g.restore();
      }
    }
    this.dirty = true;
    if (!wipe) this.empty = false;
  }

  // a run: too much paint in one spot sags into a drip down the side tiles (v grows downward there)
  drip(hit, hex, len = 0.04, wid = 0.004) {
    const g = this.ctx, S = this.size;
    for (let r = 0; r < 8; r++) {
      if (hit.reg[r] < 0.3) continue;
      _q.copy(hit.p).sub(REG_MIN[r]).divide(REG_SIZE[r]);
      const pxm = LAYOUT.k * REG_DENS[r] * S;
      for (let t = 0; t < 4; t++) {
        if (hit.n.dot(TILE_AXIS[t]) < 0.35) continue;
        const R = LAYOUT.rects[r * 5 + t];
        tileUV(r, t, _q, _uv);
        const x = _uv.x * S, y = _uv.y * S, L = len * pxm, w = Math.max(1, wid * pxm);
        g.save(); g.beginPath(); g.rect(R[0] * S, R[1] * S, R[2] * S, R[3] * S); g.clip();
        g.fillStyle = hexCss(hex, 0.92);
        g.beginPath();
        g.moveTo(x - w, y); g.quadraticCurveTo(x - w * 0.6, y + L * 0.6, x - w * 0.45, y + L);
        g.arc(x, y + L, w * 0.8, PI, 0, false);
        g.quadraticCurveTo(x + w * 0.6, y + L * 0.6, x + w, y);
        g.closePath(); g.fill();
        g.restore();
      }
    }
    this.dirty = true;
  }

  // ---- serialisation: atlas downsampled to `res`, RGBA 4 bits per channel, deflated, base64.
  async encode(res = 256, budget = 26000) {
    if (this.empty) return '';
    for (const r of [res, 192, 128, 96]) {
      const s = await encodeAt(this.canvas, r);
      if (s.length <= budget || r === 96) return s;
    }
    return '';
  }
  // full-resolution copy for the local profile (PNG data URL)
  toDataURL() { return this.empty ? '' : this.canvas.toDataURL('image/png'); }
  async loadDataURL(url) {
    const img = await loadImage(url);
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.ctx.drawImage(img, 0, 0, this.size, this.size);
    this.empty = false; this.dirty = true; this.flush();
  }
  async loadEncoded(str) {
    const src = await decodeToCanvas(str);
    if (!src) return false;
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(src, 0, 0, this.size, this.size);
    this.empty = false; this.dirty = true; this.flush();
    return true;
  }
  dispose() { this.texture.dispose(); this.undoStack.length = 0; }
}

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

async function encodeAt(src, res) {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, res, res);
  const d = g.getImageData(0, 0, res, res).data, n = res * res;
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    if (a < 9) continue;   // 0 stays 0 (runs of empty atlas compress to nothing)
    const q = (v) => Math.min(15, Math.round(v / 17));
    out[i * 2] = (q(d[i * 4]) << 4) | q(d[i * 4 + 1]);
    out[i * 2 + 1] = (q(d[i * 4 + 2]) << 4) | Math.max(1, q(a));
  }
  const z = await deflate(out);
  return z ? 'p1.' + res + '.' + b64(z) : '';
}
async function decodeToCanvas(str) {
  if (!str || typeof str !== 'string' || !str.startsWith('p1.') || typeof DecompressionStream === 'undefined') return null;
  try {
    const [, rs, data] = str.split('.');
    const res = +rs;
    if (!(res >= 16 && res <= 1024)) return null;
    const raw = await inflate(unb64(data));
    if (raw.length !== res * res * 2) return null;
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d');
    const img = g.createImageData(res, res), d = img.data;
    for (let i = 0; i < res * res; i++) {
      const b0 = raw[i * 2], b1 = raw[i * 2 + 1];
      if (!b1) continue;
      d[i * 4] = (b0 >> 4) * 17; d[i * 4 + 1] = (b0 & 15) * 17; d[i * 4 + 2] = (b1 >> 4) * 17; d[i * 4 + 3] = (b1 & 15) * 17;
    }
    g.putImageData(img, 0, 0);
    return c;
  } catch (e) { console.warn('[paint] decode', e); return null; }
}

// ---------------------------------------------------------------------------
// shared textures per encoded paint string (several avatars, portraits); the local player's full-
// resolution canvas is registered by the customizer so the clone in game shows the crisp original
const TEX = new Map();
const FULL_KEY = 'room_paint_full_v1';
export function paintId(str) { return str ? hashString(str).toString(36) : ''; }
export function registerFullPaint(str, layer) {
  if (!str) return;
  const id = paintId(str);
  const e = { layer, ready: Promise.resolve(layer), refs: 1 };
  TEX.set(id, e);
  try { localStorage.setItem(FULL_KEY, JSON.stringify({ id, url: layer.toDataURL() })); } catch (err) { /* quota: the compact copy still works */ }
}
// -> { texture, ready: Promise<layer|null> } (texture may still be blank until ready resolves)
export function paintTexture(str) {
  if (!str) return null;
  const id = paintId(str);
  let e = TEX.get(id);
  if (e) return e;
  let full = null;
  try { const s = JSON.parse(localStorage.getItem(FULL_KEY) || 'null'); if (s && s.id === id && s.url) full = s.url; } catch (err) { /* */ }
  const layer = new PaintLayer(full ? 1024 : 256);
  e = { layer, refs: 0 };
  e.ready = (full ? layer.loadDataURL(full).then(() => true).catch(() => layer.loadEncoded(str)) : layer.loadEncoded(str)).then((ok) => (ok ? layer : null));
  TEX.set(id, e);
  if (TEX.size > 24) for (const [k, v] of TEX) { if (TEX.size <= 24) break; if (v !== e && v.refs <= 0) { v.layer.dispose(); TEX.delete(k); } }
  return e;
}

// ---------------------------------------------------------------------------
// raycast intersection on a painted (skinned, merged) avatar mesh -> rest-space paint hit
export function paintHit(it, out = { p: new THREE.Vector3(), n: new THREE.Vector3(), reg: new Float32Array(8) }) {
  const g = it.object.geometry, f = it.face, bc = it.barycoord;
  if (!f || !bc) return null;
  const P = g.attributes.paintPos || g.attributes.position, N = g.attributes.normal;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  out.p.set(0, 0, 0); out.n.set(0, 0, 0); out.reg.fill(0);
  const idx = [f.a, f.b, f.c], w = [bc.x, bc.y, bc.z];
  for (let k = 0; k < 3; k++) {
    const i = idx[k], b = w[k];
    out.p.x += P.getX(i) * b; out.p.y += P.getY(i) * b; out.p.z += P.getZ(i) * b;
    if (N) { out.n.x += N.getX(i) * b; out.n.y += N.getY(i) * b; out.n.z += N.getZ(i) * b; }
    if (si && sw) for (let c = 0; c < 4; c++) {
      const ww = sw.getComponent(i, c);
      if (ww <= 0) continue;
      const r = BONE_REGION[si.getComponent(i, c)];
      if (r >= 0) out.reg[r] += ww * b;
    }
  }
  if (out.n.lengthSq() < 1e-8) out.n.set(0, 0, -1); else out.n.normalize();
  let any = 0; for (let r = 0; r < 8; r++) any += out.reg[r];
  return any > 0.05 ? out : null;
}

// ---------------------------------------------------------------------------
// material injection
const f3 = (v) => `vec3(${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`;
const GLSL_CONST = `
const float PNT_BREG[${BONE_REGION.length}] = float[${BONE_REGION.length}](${BONE_REGION.map((r) => r.toFixed(1)).join(',')});
`;
const GLSL_FRAG_CONST = `
const vec3 PNT_MIN[8] = vec3[8](${REG_MIN.map(f3).join(',')});
const vec3 PNT_SZ[8] = vec3[8](${REG_SIZE.map(f3).join(',')});
const vec4 PNT_T[40] = vec4[40](${LAYOUT.rects.map((R) => `vec4(${R.map((x) => x.toFixed(5)).join(',')})`).join(',')});
uniform sampler2D uPaintMap;
varying vec3 vPaintP;
varying vec3 vPaintN;
varying vec4 vPaintRA;
varying vec4 vPaintRB;
vec4 pntTap(int r, vec3 P, vec3 dx, vec3 dy, vec3 aw, vec3 sn) {
  vec3 isz = 1.0 / PNT_SZ[r];
  vec3 q = clamp((P - PNT_MIN[r]) * isz, 0.0, 1.0);
  vec3 qx = dx * isz, qy = dy * isz;
  vec4 c = vec4(0.0);
  if (aw.x > 0.002) {
    vec4 R = PNT_T[r * 5 + (sn.x > 0.0 ? 0 : 1)];
    c += aw.x * textureGrad(uPaintMap, R.xy + R.zw * vec2(q.z, 1.0 - q.y), R.zw * vec2(qx.z, -qx.y), R.zw * vec2(qy.z, -qy.y));
  }
  if (aw.z > 0.002) {
    vec4 R = PNT_T[r * 5 + (sn.z > 0.0 ? 2 : 3)];
    c += aw.z * textureGrad(uPaintMap, R.xy + R.zw * vec2(q.x, 1.0 - q.y), R.zw * vec2(qx.x, -qx.y), R.zw * vec2(qy.x, -qy.y));
  }
  if (aw.y > 0.002) {
    vec4 R = PNT_T[r * 5 + 4];
    c += aw.y * textureGrad(uPaintMap, R.xy + R.zw * q.xz, R.zw * qx.xz, R.zw * qy.xz);
  }
  return c;
}
`;
const GLSL_FRAG_MAIN = `
  float paintA = 0.0;
  {
    vec3 pdx = dFdx(vPaintP), pdy = dFdy(vPaintP);
    vec3 pn = normalize(vPaintN);
    vec3 aw = pow(abs(pn), vec3(4.0));
    aw /= max(aw.x + aw.y + aw.z, 1e-4);
    if (pn.y < 0.0) aw.y = 0.0;
    float rw[8] = float[8](vPaintRA.x, vPaintRA.y, vPaintRA.z, vPaintRA.w, vPaintRB.x, vPaintRB.y, vPaintRB.z, vPaintRB.w);
    vec4 pacc = vec4(0.0);
    for (int r = 0; r < 8; r++) { if (rw[r] > 0.01) pacc += rw[r] * pntTap(r, vPaintP, pdx, pdy, aw, pn); }
    paintA = clamp(pacc.a, 0.0, 1.0);
    if (paintA > 0.002) {
      vec3 pc = pacc.rgb / max(pacc.a, 1e-4);
      float pao = 1.0;
      #ifdef USE_COLOR
        pao = mix(1.0, clamp(dot(vColor.rgb, vec3(0.3333)) * 1.3, 0.5, 1.0), 0.65);
      #endif
      diffuseColor.rgb = mix(diffuseColor.rgb, pc * pao, paintA);
    }
  }
`;
function injectPaint(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec3 paintPos;
varying vec3 vPaintP;
varying vec3 vPaintN;
varying vec4 vPaintRA;
varying vec4 vPaintRB;
${GLSL_CONST}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
  vPaintP = paintPos; vPaintN = normal; vPaintRA = vec4(0.0); vPaintRB = vec4(0.0);
  #ifdef USE_SKINNING
    for (int k = 0; k < 4; k++) {
      float pr = PNT_BREG[int(skinIndex[k] + 0.5)];
      vPaintRA += skinWeight[k] * vec4(equal(vec4(pr), vec4(0.0, 1.0, 2.0, 3.0)));
      vPaintRB += skinWeight[k] * vec4(equal(vec4(pr), vec4(4.0, 5.0, 6.0, 7.0)));
    }
  #endif`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + GLSL_FRAG_CONST)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_FRAG_MAIN)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.5, paintA);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.0, paintA);')
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  #ifdef USE_CLEARCOAT
    material.clearcoat *= 1.0 - 0.55 * paintA;
  #endif
  #ifdef USE_SHEEN
    material.sheenColor *= 1.0 - 0.5 * paintA;
  #endif`);
}
// per (base material, paint texture) clone; keeps the base material's own shader patch
const PMAT = new WeakMap();
export function paintMaterial(base, tex) {
  let byTex = PMAT.get(base);
  if (!byTex) { byTex = new Map(); PMAT.set(base, byTex); }
  let m = byTex.get(tex);
  if (m) return m;
  m = base.clone();
  m.name = base.name + '_painted';
  const prev = base.onBeforeCompile, prevKey = base.customProgramCacheKey?.bind(base);
  const u = { uPaintMap: { value: tex } };
  m.userData = { ...base.userData, paintU: u };
  m.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, sh, r);
    sh.uniforms.uPaintMap = u.uPaintMap;
    injectPaint(sh);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|paint1';
  byTex.set(tex, m);
  return m;
}
export function releasePaintMaterials(tex) {
  // materials are tiny; textures are released by the cache sweep in paintTexture()
}

// geometry: the paint lookup uses pre-morph rest positions (shared attribute when not morphed)
export function ensurePaintPos(g, restPos = null) {
  if (g.attributes.paintPos) return g;
  g.setAttribute('paintPos', restPos || g.attributes.position);
  return g;
}
