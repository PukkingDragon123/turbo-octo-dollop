// R.O.O.M. — cloth rags for the clone android: tattered shirts, ponchos, capes, scarves, bandanas, hoods,
// head wraps and waist wraps, simulated as position-based (Verlet) cloth.
//
// Every garment is a small particle grid (≤ 16 x 16) authored in rig rest space (design units, feet at
// the origin, facing -Z). Each particle is skinned to the two nearest bone segments; that skinned
// position is (a) where pinned particles go (collar, waistband, the band round the head), (b) a weak
// "memory" pull that keeps the cloth from tangling, and (c) the whole garment on the LOW quality preset
// or far away (a stiff skinned fallback, no simulation). The simulation runs in world space (so it reacts
// to running, jumping, turning), at 60 Hz for the local clone and 30 Hz for teammates, with distance /
// shear / bend constraints and collision against sphere / capsule proxies on the rig. Frayed hems, holes
// and fringes are alpha-tested in the hand-painted textures.
//
//   RAGS / RAG_ZONES / ragEntry(id) / parseRags(str) / canonRags(v)
//   new ClothSet(avatar, rags) ; .update(dt) ; .reset() ; .dispose()  (avatar: doll_avatar.js Avatar)
//   buildRagPreview(id) -> { object, update(dt, anchor) }  hanging on a hook (customizer rail)
import * as THREE from 'three';
import { engine } from '../../core/engine.js';
import { RY, RD, BI, restMatrices } from './robotrig.js';
import { HC } from './robotshape.js';
import { coverPt } from './robotbody.js';
import { setRagCanon } from './dollcos.js';
import { ptex, css, shade, mixHex, P, FM, heightToNormal, mkCanvas } from './handpaint.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v1 = V(), _v2 = V(), _v3 = V(), _m = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// catalogue: type -> shape builder, entries = colourways
export const RAG_ZONES = ['torso', 'neck', 'head', 'waist'];
export const RAGS = [
  { id: 'poncho_sunset', type: 'poncho', zone: 'torso', name: 'Sunset Poncho', pal: [0xc4572a, 0xf0bf4a, 0x3f8c8a, 0xf1e6cc, 0x6e3f6e] },
  { id: 'poncho_moss', type: 'poncho', zone: 'torso', name: 'Moss Blanket', pal: [0x5d6236, 0x8ea67a, 0xd8c8a4, 0x3e4a3f, 0xa8843a] },
  { id: 'tee_faded', type: 'tee', zone: 'torso', name: 'Faded Tee', base: 0xd08a8e, print: 'smile' },
  { id: 'tee_work', type: 'tee', zone: 'torso', name: 'Work Shirt', base: 0x4f6b78, print: 'pocket' },
  { id: 'cape_wool', type: 'cape', zone: 'torso', name: 'Wool Cape', base: 0x6a2e2a, trim: 0xc9a74e },
  { id: 'cape_tarp', type: 'cape', zone: 'torso', name: 'Tarp Cloak', base: 0x3f6b66, trim: 0xd8c8a4 },
  { id: 'scarf_knit', type: 'scarf', zone: 'neck', name: 'Long Knit Scarf', pal: [0xc4572a, 0xf1e6cc, 0x3557a6] },
  { id: 'scarf_moth', type: 'scarf', zone: 'neck', name: 'Moth-eaten Scarf', pal: [0x8ea67a, 0x5d6236, 0xf0bf4a] },
  { id: 'bandana_red', type: 'bandana', zone: 'neck', name: 'Red Bandana', base: 0xa83228, ink: 0xf1e6cc },
  { id: 'bandana_teal', type: 'bandana', zone: 'neck', name: 'Teal Kerchief', base: 0x3f8c8a, ink: 0xf0bf4a },
  { id: 'hood_burlap', type: 'hood', zone: 'head', name: 'Burlap Hood', base: 0xb89a6a },
  { id: 'hood_dusk', type: 'hood', zone: 'head', name: 'Dusk Hood', base: 0x4a3a5a },
  { id: 'wrap_bandage', type: 'headwrap', zone: 'head', name: 'Bandage Wrap', base: 0xe8dcc0 },
  { id: 'wrap_rust', type: 'headwrap', zone: 'head', name: 'Rust Headband', base: 0xc4572a },
  { id: 'kilt_plaid', type: 'kilt', zone: 'waist', name: 'Plaid Wrap', pal: [0x6a2e2a, 0x3e4a3f, 0xf0bf4a] },
  { id: 'kilt_apron', type: 'kilt', zone: 'waist', name: 'Shop Apron', pal: [0x8a6a44, 0x5a4428, 0xf1e6cc], apron: true },
];
// the old accessory ids that are cloth now
export const LEGACY_RAG = { scarf: 'scarf_knit', bandana: 'bandana_red' };
const BY_ID = Object.fromEntries(RAGS.map((r) => [r.id, r]));
export const ragEntry = (id) => BY_ID[id] || null;
export function parseRags(v) {
  const ids = (Array.isArray(v) ? v : String(v || '').split(/[,+|]/)).map((s) => s.trim()).filter(Boolean);
  const out = [], used = new Set();
  for (const id of ids) { const e = BY_ID[id]; if (!e || used.has(e.zone)) continue; used.add(e.zone); out.push(e); }
  return out;
}
export const canonRags = (v) => parseRags(v).map((e) => e.id).join(',');
setRagCanon(canonRags);

// ---------------------------------------------------------------------------
// textures (hand painted; alpha = frays, holes, fringes)
function fray(g, w, h, r, edges, { depth = 0.06, fringe = 0, holes = 0 } = {}) {
  // ragged torn edges: cut a wobbly band off the chosen sides, leave thread strands
  g.save(); g.globalCompositeOperation = 'destination-out';
  const side = (pts) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.closePath(); g.fill(); };
  const n = 40;
  for (const e of edges) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, d = depth * (0.25 + r.next() * 0.75 + 0.6 * Math.max(0, Math.sin(t * 13 + r.next())) ** 4);
      if (e === 'bottom') pts.push([t * w, h * (1 - d)]); else if (e === 'top') pts.push([t * w, h * d]);
      else if (e === 'left') pts.push([w * d, t * h]); else pts.push([w * (1 - d), t * h]);
    }
    if (e === 'bottom') side([[0, h + 2], ...pts, [w, h + 2]]); else if (e === 'top') side([[0, -2], ...pts, [w, -2]]);
    else if (e === 'left') side([[-2, 0], ...pts, [-2, h]]); else side([[w + 2, 0], ...pts, [w + 2, h]]);
  }
  for (let i = 0; i < holes; i++) {
    const x = (0.15 + r.next() * 0.7) * w, y = (0.2 + r.next() * 0.6) * h, R = (0.012 + r.next() * 0.025) * w;
    g.beginPath(); for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, rr = R * (0.5 + r.next() * 0.8); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill();
  }
  g.restore();
  if (fringe) {
    // loose threads hanging off the torn edges (drawn back in)
    g.save(); g.lineCap = 'round';
    for (const e of edges) for (let i = 0; i < fringe; i++) {
      const t = r.next(), L = (0.02 + r.next() * 0.05) * h;
      g.strokeStyle = css(0xe8dcc0, 0.0); g.lineWidth = 2 + r.next() * 2;
      if (e === 'bottom' || e === 'top') {
        const x = t * w, y0 = e === 'bottom' ? h * (1 - depth * 0.6) : h * depth * 0.6, dir = e === 'bottom' ? 1 : -1;
        const c = g.getImageData(Math.min(w - 1, x | 0), Math.min(h - 1, Math.max(0, (y0 - dir * 4) | 0)), 1, 1).data;
        if (c[3] < 128) continue;
        g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},1)`;
        g.beginPath(); g.moveTo(x, y0 - dir * 4); g.quadraticCurveTo(x + (r.next() - 0.5) * 6, y0 + dir * L * 0.5, x + (r.next() - 0.5) * 10, y0 + dir * L); g.stroke();
      }
    }
    g.restore();
  }
}
function patch(g, w, h, r, col) {
  const x = (0.2 + r.next() * 0.5) * w, y = (0.25 + r.next() * 0.45) * h, pw = (0.12 + r.next() * 0.1) * w, ph = (0.1 + r.next() * 0.08) * h, a = (r.next() - 0.5) * 0.4;
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = css(col); g.fillRect(-pw / 2, -ph / 2, pw, ph);
  P.weave(g, pw, ph, col, r, { pitch: 3, alpha: 0.2 });
  P.stitches(g, [[-pw / 2 + 4, -ph / 2 + 4], [pw / 2 - 4, -ph / 2 + 4], [pw / 2 - 4, ph / 2 - 4], [-pw / 2 + 4, ph / 2 - 4], [-pw / 2 + 4, -ph / 2 + 4]], r, { col: 0x2a2018, len: 6, gap: 4, wid: 2 });
  g.restore();
}
const RAG_TEX = {
  poncho(e) {
    return ptex('rag_' + e.id, 512, 512, (g, w, h, r) => {
      const [a, b, c, d, f] = e.pal;
      g.fillStyle = css(d); g.fillRect(0, 0, w, h);
      // serape bands, mirrored about the centre, uneven painted lines
      const bands = [[0.0, 0.07, a], [0.07, 0.012, b], [0.09, 0.03, c], [0.13, 0.01, f], [0.16, 0.05, a], [0.22, 0.02, b], [0.3, 0.012, c], [0.34, 0.03, f]];
      for (const [y0, hh, col] of bands) for (const yy of [y0, 1 - y0 - hh]) {
        g.fillStyle = css(col, 0.92);
        g.beginPath(); g.moveTo(0, yy * h);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, yy * h + (r.next() - 0.5) * 2.5);
        for (let x = w; x >= 0; x -= 16) g.lineTo(x, (yy + hh) * h + (r.next() - 0.5) * 2.5);
        g.fill();
      }
      // diamonds down the middle band
      for (let i = 0; i < 9; i++) { const x = (i + 0.5) / 9 * w, y = 0.5 * h; g.fillStyle = css(i % 2 ? a : c, 0.85); g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x + 12, y); g.lineTo(x, y + 14); g.lineTo(x - 12, y); g.fill(); }
      P.weave(g, w, h, d, r, { pitch: 4, alpha: 0.28 });
      P.strokes(g, w, h, d, r, { n: 50, len: 0.3, alpha: 0.1 });
      P.blotches(g, w, h, 0x4a3820, r, { n: 7, r: 0.15, alpha: 0.18 });
      patch(g, w, h, r, b);
      fray(g, w, h, r, ['bottom', 'top', 'left', 'right'], { depth: 0.035, holes: 3, fringe: 60 });
    });
  },
  tee(e) {
    return ptex('rag_' + e.id, 512, 512, (g, w, h, r) => {
      P.wash(g, w, h, e.base, { k: 0.18, angle: PI / 2 });
      P.weave(g, w, h, e.base, r, { pitch: 3, alpha: 0.3 });
      P.strokes(g, w, h, e.base, r, { n: 60, len: 0.3, alpha: 0.12 });
      // u wraps round the body: u 0.5 = front centre
      if (e.print === 'smile') {
        g.strokeStyle = css(0xf1e6cc, 0.7); g.lineWidth = 9;
        g.beginPath(); g.arc(w * 0.5, h * 0.36, 46, 0, TAU); g.stroke();
        g.beginPath(); g.arc(w * 0.5, h * 0.37, 28, 0.25, PI - 0.25); g.stroke();
        g.fillStyle = css(0xf1e6cc, 0.7); g.fillRect(w * 0.5 - 18, h * 0.32, 7, 12); g.fillRect(w * 0.5 + 11, h * 0.32, 7, 12);
        P.blotches(g, w, h, e.base, r, { n: 12, r: 0.04, alpha: 0.4 });   // cracked, worn print
      } else {
        g.fillStyle = css(shade(e.base, -0.12)); g.fillRect(w * 0.56, h * 0.2, w * 0.08, h * 0.1);
        P.stitches(g, [[w * 0.56, h * 0.2], [w * 0.56, h * 0.3], [w * 0.64, h * 0.3], [w * 0.64, h * 0.2]], r, { col: shade(e.base, 0.4), len: 5, gap: 3, wid: 1.5 });
        for (const u of [0.5, 0.0, 1.0]) P.stitches(g, [[w * u, 0], [w * u, h]], r, { col: shade(e.base, -0.3), len: 6, gap: 4, wid: 1.5 });
      }
      P.blotches(g, w, h, 0x5a4428, r, { n: 9, r: 0.12, alpha: 0.2 });
      patch(g, w, h, r, shade(e.base, -0.25));
      fray(g, w, h, r, ['bottom'], { depth: 0.09, holes: 4, fringe: 40 });
    });
  },
  cape(e) {
    return ptex('rag_' + e.id, 512, 512, (g, w, h, r) => {
      P.wash(g, w, h, e.base, { k: 0.2, angle: PI / 2 });
      P.weave(g, w, h, e.base, r, { pitch: 5, alpha: 0.35 });
      P.strokes(g, w, h, e.base, r, { n: 70, len: 0.5, wid: 0.04, alpha: 0.12, angle: PI / 2, jitter: 0.3 });
      g.fillStyle = css(e.trim, 0.9); g.fillRect(0, 0, w, h * 0.045);
      P.stitches(g, [[0, h * 0.055], [w, h * 0.055]], r, { col: e.trim, len: 8, gap: 5 });
      P.blotches(g, w, h, 0x2a2018, r, { n: 10, r: 0.15, alpha: 0.2 });
      patch(g, w, h, r, shade(e.base, 0.2));
      fray(g, w, h, r, ['bottom'], { depth: 0.12, holes: 5, fringe: 50 });
    });
  },
  scarf(e) {
    return ptex('rag_' + e.id, 256, 1024, (g, w, h, r) => {
      const [a, b, c] = e.pal;
      g.fillStyle = css(a); g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 64) { g.fillStyle = css(b, 0.95); g.fillRect(0, y + 20, w, 18); g.fillStyle = css(c, 0.9); g.fillRect(0, y + 44, w, 7); }
      // knit: rows of little v's
      for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 8) { g.strokeStyle = css(0x000000, 0.08); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 5); g.lineTo(x + 8, y); g.stroke(); }
      P.blotches(g, w, h, 0x3a2a1a, r, { n: 10, r: 0.2, alpha: 0.15 });
      if (e.id.includes('moth')) fray(g, w, h, r, [], { holes: 9 });
      // fringe tassels at both ends
      g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(0, 0, w, h * 0.06); g.fillRect(0, h * 0.94, w, h * 0.06); g.restore();
      g.lineCap = 'round';
      for (const [y0, dir] of [[h * 0.06, -1], [h * 0.94, 1]]) for (let x = 6; x < w; x += 11) {
        g.strokeStyle = css(shade(a, (r.next() - 0.5) * 0.2)); g.lineWidth = 5;
        g.beginPath(); g.moveTo(x, y0 - dir * 3); g.lineTo(x + (r.next() - 0.5) * 6, y0 + dir * h * (0.035 + r.next() * 0.02)); g.stroke();
      }
    });
  },
  bandana(e) {
    return ptex('rag_' + e.id, 512, 512, (g, w, h, r) => {
      P.wash(g, w, h, e.base, { k: 0.15 });
      // paisley-ish dots and teardrops + a border
      g.strokeStyle = css(e.ink, 0.85); g.lineWidth = 6; g.strokeRect(20, 20, w - 40, h - 40);
      g.lineWidth = 2; g.strokeRect(34, 34, w - 68, h - 68);
      for (let i = 0; i < 26; i++) {
        const x = 60 + r.next() * (w - 120), y = 60 + r.next() * (h - 120), s = 10 + r.next() * 12, a = r.next() * TAU;
        g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = css(e.ink, 0.8);
        g.beginPath(); g.arc(0, 0, s, 0, PI); g.quadraticCurveTo(-s, -s * 1.8, s * 0.2, -s * 2.2); g.quadraticCurveTo(s * 0.6, -s, s, 0); g.fill();
        g.fillStyle = css(e.base); g.beginPath(); g.arc(0, -s * 0.1, s * 0.35, 0, TAU); g.fill();
        g.restore();
      }
      for (let i = 0; i < 80; i++) { g.fillStyle = css(e.ink, 0.7); g.beginPath(); g.arc(r.next() * w, r.next() * h, 2 + r.next() * 2, 0, TAU); g.fill(); }
      P.weave(g, w, h, e.base, r, { pitch: 3, alpha: 0.25 });
      P.blotches(g, w, h, 0x3a2418, r, { n: 6, r: 0.14, alpha: 0.18 });
      // triangle: cut the upper-right half away (folded kerchief)
      g.save(); g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h); g.closePath(); g.fill();
      g.restore();
      fray(g, w, h, r, [], { holes: 1 });
    });
  },
  hood(e) {
    return ptex('rag_' + e.id, 512, 512, (g, w, h, r) => {
      P.wash(g, w, h, e.base, { k: 0.2, angle: PI / 2 });
      // coarse burlap weave
      for (let y = 0; y < h; y += 5) { g.fillStyle = css(shade(e.base, (r.next() - 0.5) * 0.25), 0.5); g.fillRect(0, y, w, 2.5); }
      for (let x = 0; x < w; x += 5) { g.fillStyle = css(shade(e.base, (r.next() - 0.5) * 0.25 - 0.1), 0.4); g.fillRect(x, 0, 2.5, h); }
      P.strokes(g, w, h, e.base, r, { n: 50, len: 0.4, alpha: 0.12 });
      // seam down the back (u = 0.5) and round the face opening (u = 0 / 1)
      P.stitches(g, [[w * 0.5, 0], [w * 0.5, h * 0.55]], r, { col: 0x3a2a18, len: 9, gap: 6, wid: 3 });
      for (const u of [0.02, 0.98]) P.stitches(g, [[w * u, 0], [w * u, h]], r, { col: 0x3a2a18, len: 7, gap: 5, wid: 2.5 });
      P.blotches(g, w, h, 0x3a2a18, r, { n: 9, r: 0.15, alpha: 0.2 });
      patch(g, w, h, r, shade(e.base, -0.3));
      fray(g, w, h, r, ['bottom'], { depth: 0.08, holes: 2, fringe: 50 });
    });
  },
  headwrap(e) {
    return ptex('rag_' + e.id, 256, 1024, (g, w, h, r) => {
      P.wash(g, w, h, e.base, { k: 0.12, angle: PI / 2 });
      P.weave(g, w, h, e.base, r, { pitch: 3, alpha: 0.4 });
      for (let i = 0; i < 6; i++) { g.strokeStyle = css(shade(e.base, -0.2), 0.25); g.lineWidth = 2; const y = r.next() * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (r.next() - 0.5) * 30); g.stroke(); }
      P.blotches(g, w, h, e.id.includes('bandage') ? 0x8a5a3a : 0x3a2418, r, { n: 10, r: 0.25, alpha: 0.18 });
      fray(g, w, h, r, ['top', 'bottom', 'left', 'right'], { depth: 0.04, fringe: 20 });
    });
  },
  kilt(e) {
    return ptex('rag_' + e.id, 512, 512, (g, w, h, r) => {
      const [a, b, c] = e.pal;
      if (e.apron) {
        P.wash(g, w, h, a, { k: 0.2, angle: PI / 2 });
        P.weave(g, w, h, a, r, { pitch: 4, alpha: 0.4 });
        g.fillStyle = css(b); g.fillRect(w * 0.38, h * 0.3, w * 0.24, h * 0.22);
        P.stitches(g, [[w * 0.38, h * 0.3], [w * 0.38, h * 0.52], [w * 0.62, h * 0.52], [w * 0.62, h * 0.3]], r, { col: c, len: 6, gap: 4 });
        P.blotches(g, w, h, 0x2a1a10, r, { n: 14, r: 0.1, alpha: 0.3 });
        // cut away the back half (u 0..0.2, 0.8..1): an apron only covers the front
        g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(0, 0, w * 0.2, h); g.fillRect(w * 0.8, 0, w * 0.2, h); g.restore();
      } else {
        P.plaid(g, w, h, a, [[0.1, 0.12, b], [0.32, 0.03, c], [0.5, 0.12, b], [0.72, 0.03, c], [0.86, 0.06, shade(a, -0.3)]], r);
        P.weave(g, w, h, a, r, { pitch: 3, alpha: 0.25 });
        P.blotches(g, w, h, 0x2a1a10, r, { n: 6, r: 0.15, alpha: 0.18 });
      }
      fray(g, w, h, r, ['bottom'], { depth: 0.07, holes: 1, fringe: 40 });
    });
  },
};
const NORMALS = new Map();
function weaveNormal() {
  if (NORMALS.has('weave')) return NORMALS.get('weave');
  const c = mkCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 4) for (let x = 0; x < 128; x += 4) { const up = ((x + y) / 4) % 2; g.fillStyle = up ? '#c0c0c0' : '#505050'; g.fillRect(x, y, up ? 4 : 2, up ? 2 : 4); }
  const t = heightToNormal('rag_weave_n', c, 1.6, { repeat: [12, 12] });
  NORMALS.set('weave', t);
  return t;
}
export function ragMaterial(e) {
  return FM.fabric('rag_' + e.id, RAG_TEX[e.type](e), { normalMap: weaveNormal(), nScale: 0.6, sheen: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, rough: 0.95 });
}

// ---------------------------------------------------------------------------
// shapes (rest space). Each returns { nu, nv, pos: Vector3[], pin: Float32Array (0 free .. 1 pinned),
// mem: Float32Array (memory pull strength), uv: [u, v][], skip(i, j): drop quad, close: wrap u }
const NECK_Y = 1.452, SHOULDER_Y = RY.sh;
const torsoR = (phi, y, off) => coverPt(phi, clamp(y, 0.86, 1.45), off, V());
const SHAPES = {
  poncho() {
    const nu = 16, nv = 16, S = 0.92, pos = [], pin = [], mem = [], uv = [];
    const cz = 0.008;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = i / (nu - 1), v = j / (nv - 1);
      const px = (u - 0.5) * S, pz = (v - 0.5) * S;
      const d = Math.hypot(px, pz), th = Math.atan2(pz, px);
      // over the shoulders (an ellipse round the neck/shoulders), then straight down
      const Rx = 0.215, Rz = 0.135, R = 1 / Math.sqrt((Math.cos(th) / Rx) ** 2 + (Math.sin(th) / Rz) ** 2);
      let p;
      if (d < R) { const k = d / R; p = V(Math.cos(th) * d, NECK_Y + 0.01 - k * k * (NECK_Y - SHOULDER_Y + 0.012), Math.sin(th) * d + cz); }
      else p = V(Math.cos(th) * (R + 0.012), SHOULDER_Y - 0.002 - (d - R), Math.sin(th) * (R + 0.012) + cz);
      pos.push(p); uv.push([u, v]);
      pin.push(d < 0.085 ? 1 : 0);
      mem.push(d < 0.16 ? 0.08 : 0.004);
    }
    return { nu, nv, pos, pin, mem, uv, skip: (i, j) => Math.hypot((i + 0.5) / (nu - 1) - 0.5, (j + 0.5) / (nv - 1) - 0.5) * S < 0.06 };
  },
  tee() {
    const nu = 16, nv = 10, pos = [], pin = [], mem = [], uv = [];
    const y0 = 1.43, y1 = 0.88;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const v = j / (nv - 1), phi = (i / nu) * TAU;   // phi 0 = front
      const y = y0 + (y1 - y0) * v;
      const p = torsoR(phi, y, 0.016 + v * 0.012);
      pos.push(p); uv.push([0.5 + phi / TAU, v]);
      pin.push(j === 0 ? 1 : 0); mem.push(j <= 1 ? 0.2 : 0.05);
    }
    return { nu, nv, pos, pin, mem, uv, close: true };
  },
  cape() {
    const nu = 12, nv = 14, W = 0.52, L = 0.76, pos = [], pin = [], mem = [], uv = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = i / (nu - 1), v = j / (nv - 1);
      const x = (u - 0.5) * W * (1 + v * 0.25);
      let p;
      if (j === 0) { const phi = PI + (u - 0.5) * 2.3; p = torsoR(phi, 1.43, 0.02); p.y = NECK_Y - 0.01 - Math.abs(u - 0.5) * 0.05; }
      else p = V(x, 1.42 - v * L, 0.13 + v * 0.03 + 0.01 * Math.cos((u - 0.5) * PI));
      pos.push(p); uv.push([u, v]);
      pin.push(j === 0 ? 1 : 0); mem.push(j === 1 ? 0.1 : 0.003);
    }
    return { nu, nv, pos, pin, mem, uv };
  },
  scarf() {
    // a strip: left tail hangs down the chest, wraps round the neck, right tail down the front
    const nu = 3, nv = 26, Wd = 0.075, pos = [], pin = [], mem = [], uv = [];
    const ring = (a, y) => V(Math.sin(a) * 0.072, y, -Math.cos(a) * 0.066 + 0.004);
    const path = [];
    for (let k = 0; k < nv; k++) {
      const t = k / (nv - 1);
      let c;
      if (t < 0.3) { const s = t / 0.3; c = V(-0.06 - s * 0.01, 1.03 + s * 0.38, -0.115 + s * 0.02); }
      else if (t < 0.72) { const s = (t - 0.3) / 0.42; c = ring(-0.6 - s * (TAU - 1.2 + 0.6), 1.43 + Math.sin(s * PI) * 0.02); }
      else { const s = (t - 0.72) / 0.28; c = V(0.05 + s * 0.02, 1.41 - s * 0.3, -0.112 - s * 0.01); }
      path.push(c);
    }
    for (let j = 0; j < nv; j++) {
      const c = path[j], nxt = path[Math.min(nv - 1, j + 1)], prv = path[Math.max(0, j - 1)];
      const tng = nxt.clone().sub(prv).normalize();
      const out = V(c.x, 0, c.z + 0.005).normalize();
      const side = tng.clone().cross(out).normalize();
      for (let i = 0; i < nu; i++) {
        const s = (i / (nu - 1) - 0.5) * Wd;
        pos.push(c.clone().addScaledVector(side, s)); uv.push([i / (nu - 1), j / (nv - 1)]);
        const t = j / (nv - 1), wrap = t > 0.33 && t < 0.69;
        pin.push(wrap ? 1 : 0); mem.push(wrap ? 0.3 : t > 0.27 && t < 0.75 ? 0.08 : 0.004);
      }
    }
    return { nu, nv, pos, pin, mem, uv };
  },
  bandana() {
    // square kerchief folded on the diagonal, tied round the neck, the point hanging on the chest
    const nu = 9, nv = 9, pos = [], pin = [], mem = [], uv = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = i / (nu - 1), v = j / (nv - 1);
      // top edge (v = 0) wraps the front half of the neck; v -> 1 hangs toward the point
      const a = (u - 0.5) * 2.6, y = 1.44 - v * 0.2, r = 0.074 + v * 0.03;
      const p = V(Math.sin(a) * r * (1 - v * 0.55), y, -Math.cos(a) * r * (1 - v * 0.2) - v * 0.06);
      pos.push(p); uv.push([u, v]);
      pin.push(j === 0 ? 1 : 0); mem.push(j <= 1 ? 0.25 : 0.03);
    }
    return { nu, nv, pos, pin, mem, uv, skip: (i, j) => (i + 0.5) / (nu - 1) + (j + 0.5) / (nv - 1) < 0.45 - 1 };
  },
  hood() {
    // a cowl round the back / sides / top of the skull (open face) with a short cape resting on the shoulders
    const nu = 15, nv = 12, pos = [], pin = [], mem = [], uv = [];
    const hc = V(HC.x, RY.head + HC.y, HC.z);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = i / (nu - 1), v = j / (nv - 1);
      const th = PI + (u - 0.5) * 4.7;   // azimuth round the head (th = PI is the back), open at the face
      let p;
      if (v < 0.62) {
        const ph = 1.45 - (v / 0.62) * 1.75;   // crown -> under the ear
        const cp = Math.cos(ph), sp = Math.sin(ph), R = 0.118;
        p = V(Math.sin(th) * cp * R * 0.88, hc.y + sp * R * 1.06, -Math.cos(th) * cp * R * 1.06 + 0.01);
      } else {
        const s = (v - 0.62) / 0.38;
        const Rx = 0.1 + s * 0.11, Rz = 0.09 + s * 0.06;
        p = V(Math.sin(th) * Rx, hc.y - 0.07 - s * 0.13, -Math.cos(th) * Rz + 0.015);
      }
      pos.push(p); uv.push([u, v]);
      pin.push(v < 0.25 ? 1 : 0); mem.push(v < 0.55 ? 0.3 : 0.05);
    }
    return { nu, nv, pos, pin, mem, uv };
  },
  headwrap() {
    // a band round the forehead, the two tails knotted at the back and streaming down
    const nu = 3, nv = 24, Wd = 0.045, pos = [], pin = [], mem = [], uv = [];
    const hc = V(HC.x, RY.head + HC.y, HC.z);
    const path = [];
    for (let k = 0; k < nv; k++) {
      const t = k / (nv - 1);
      let c;
      if (t < 0.62) { const a = PI * 0.92 + t / 0.62 * (TAU - 0.3); c = V(Math.sin(a) * 0.088, hc.y + 0.035 - 0.012 * Math.cos(a), -Math.cos(a) * 0.104 + hc.z + 0.008); }
      else { const s = (t - 0.62) / 0.38; c = V(0.01 + s * 0.03, hc.y + 0.02 - s * 0.32, hc.z + 0.11 + s * 0.04); }
      path.push(c);
    }
    for (let j = 0; j < nv; j++) {
      const c = path[j], nxt = path[Math.min(nv - 1, j + 1)], prv = path[Math.max(0, j - 1)];
      const tng = nxt.clone().sub(prv).normalize();
      const out = V(c.x - hc.x, 0, c.z - hc.z).normalize();
      const side = tng.clone().cross(out).normalize();
      for (let i = 0; i < nu; i++) {
        pos.push(c.clone().addScaledVector(side, (i / (nu - 1) - 0.5) * Wd)); uv.push([i / (nu - 1), j / (nv - 1)]);
        const t = j / (nv - 1);
        pin.push(t < 0.6 ? 1 : 0); mem.push(t < 0.66 ? 0.3 : 0.004);
      }
    }
    return { nu, nv, pos, pin, mem, uv };
  },
  kilt() {
    const nu = 16, nv = 9, pos = [], pin = [], mem = [], uv = [];
    const y0 = 0.99, L = 0.36;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const v = j / (nv - 1), phi = (i / nu) * TAU;
      const y = y0 - v * L;
      const p = torsoR(phi, Math.max(0.87, y), 0.02 + v * 0.05);
      p.y = y; p.x *= 1 + v * 0.18; p.z = (p.z - 0.0) * (1 + v * 0.15);
      pos.push(p); uv.push([0.5 + phi / TAU, v]);
      pin.push(j === 0 ? 1 : 0); mem.push(j <= 1 ? 0.15 : 0.012);
    }
    return { nu, nv, pos, pin, mem, uv, close: true };
  },
};

// ---------------------------------------------------------------------------
// collision proxies: [boneA, localA, boneB|null, localB, radius] in design units
const CAPS = [
  ['head', [HC.x, HC.y, HC.z], null, null, 0.103],
  ['neck', [0, -0.02, 0.0], 'head', [0, 0.02, 0.0], 0.052],
  ['chest', [-0.075, 0.105, 0.005], 'chest', [0.075, 0.105, 0.005], 0.112],
  ['chest', [-0.06, -0.02, 0.0], 'chest', [0.06, -0.02, 0.0], 0.108],
  ['spine', [-0.055, 0.04, 0.0], 'spine', [0.055, 0.04, 0.0], 0.095],
  ['pelvis', [-0.07, -0.02, 0.0], 'pelvis', [0.07, -0.02, 0.0], 0.1],
  ['shL', [0, 0, 0], 'elL', [0, 0, 0], 0.055], ['shR', [0, 0, 0], 'elR', [0, 0, 0], 0.055],
  ['elL', [0, 0, 0], 'wrL', [0, 0, 0], 0.044], ['elR', [0, 0, 0], 'wrR', [0, 0, 0], 0.044],
  ['hipL', [0, 0, 0], 'knL', [0, 0, 0], 0.078], ['hipR', [0, 0, 0], 'knR', [0, 0, 0], 0.078],
  ['knL', [0, 0, 0], 'anL', [0, 0, 0], 0.06], ['knR', [0, 0, 0], 'anR', [0, 0, 0], 0.06],
];
// bone segments for the skin binding (nearest two)
const SEGS = [
  ['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', null],
  ['shL', 'elL'], ['elL', 'wrL'], ['shR', 'elR'], ['elR', 'wrR'],
  ['hipL', 'knL'], ['knL', 'anL'], ['hipR', 'knR'], ['knR', 'anR'],
];
const segDist = (p, a, b) => {
  if (!b) return p.distanceTo(a) - 0.05;
  const ab = _v1.subVectors(b, a), t = clamp(_v2.subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(_v3.copy(a).addScaledVector(ab, t));
};

class Garment {
  constructor(entry, rig, over, quality) {
    this.e = entry;
    const S = SHAPES[entry.type]();
    Object.assign(this, { nu: S.nu, nv: S.nv });
    const n = (this.n = S.nu * S.nv);
    this.rest = S.pos; this.pinW = Float32Array.from(S.pin); this.memW = Float32Array.from(S.mem);
    // skin binding: two nearest bone segments, bone-local rest offsets
    const RM = restMatrices(over || {});
    const P = (b) => V().setFromMatrixPosition(RM[BI[b]]);
    const segs = SEGS.map(([a, b]) => [a, P(a), b ? P(b) : null]);
    this.bind = [];
    const inv = RM.map((m) => m.clone().invert());
    for (let i = 0; i < n; i++) {
      const p = this.rest[i];
      const ds = segs.map(([bone, a, b]) => [bone, Math.max(1e-4, segDist(p, a, b))]).sort((x, y) => x[1] - y[1]);
      let [b0, d0] = ds[0], [b1, d1] = ds[1];
      if (entry.zone === 'head' && p.y > RY.head - 0.02) { b0 = 'head'; d0 = 1e-4; }
      const w0 = 1 / (d0 * d0), w1 = 1 / (d1 * d1), k = w0 / (w0 + w1);
      const l0 = p.clone().applyMatrix4(inv[BI[b0]]), l1 = p.clone().applyMatrix4(inv[BI[b1]]);
      this.bind.push({ b0: BI[b0], l0, b1: BI[b1], l1, k: k > 0.9 ? 1 : k });
    }
    // particles (world)
    this.x = new Float32Array(n * 3); this.px = new Float32Array(n * 3); this.tg = new Float32Array(n * 3);
    // constraints: structural, shear, bend
    const idx = (i, j) => j * S.nu + ((i + S.nu) % S.nu);
    const C = [];
    const add = (a, b, k) => C.push(a, b, this.rest[a].distanceTo(this.rest[b]), k);
    const iu = S.close ? S.nu : S.nu - 1;
    for (let j = 0; j < S.nv; j++) for (let i = 0; i < S.nu; i++) {
      if (i < iu) add(idx(i, j), idx(i + 1, j), 1);
      if (j < S.nv - 1) add(idx(i, j), idx(i, j + 1), 1);
      if (i < iu && j < S.nv - 1) { add(idx(i, j), idx(i + 1, j + 1), 0.5); add(idx(i + 1, j), idx(i, j + 1), 0.5); }
      if ((S.close || i < S.nu - 2) && S.nu > 2) add(idx(i, j), idx(i + 2, j), 0.12);
      if (j < S.nv - 2) add(idx(i, j), idx(i, j + 2), 0.12);
    }
    this.C = Float32Array.from(C);
    // mesh (positions in avatar-root space)
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(S.uv.flat(), 2));
    const I = [];
    for (let j = 0; j < S.nv - 1; j++) for (let i = 0; i < iu; i++) {
      if (S.skip && S.skip(i, j)) continue;
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
      I.push(a, c, b, b, c, d);
    }
    if (S.close) {
      // duplicate the seam column so the texture does not wrap backwards across it
      const extra = [];
      const P2 = new Float32Array((n + S.nv) * 3); this.pos = P2;
      const uvs = S.uv.flat();
      for (let j = 0; j < S.nv; j++) { extra.push(idx(0, j)); uvs.push(S.uv[idx(0, j)][0] + 1, S.uv[idx(0, j)][1]); }
      this.seam = extra;
      g.setAttribute('position', new THREE.BufferAttribute(P2, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const I2 = [];
      for (let j = 0; j < S.nv - 1; j++) for (let i = 0; i < S.nu; i++) {
        if (S.skip && S.skip(i, j)) continue;
        const a = idx(i, j), c = idx(i, j + 1);
        const b = i === S.nu - 1 ? n + j : idx(i + 1, j), d = i === S.nu - 1 ? n + j + 1 : idx(i + 1, j + 1);
        I2.push(a, c, b, b, c, d);
      }
      I.length = 0; I.push(...I2);
    }
    g.setIndex(I);
    g.computeVertexNormals();
    this.geo = g;
    this.mesh = new THREE.Mesh(g, ragMaterial(entry));
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.name = 'rag_' + entry.id;
    this.ready = false;
    this.quality = quality;
  }

  // skinned (kinematic) positions -> this.tg
  skin(bones) {
    const tg = this.tg;
    for (let i = 0; i < this.n; i++) {
      const B = this.bind[i];
      _v1.copy(B.l0).applyMatrix4(bones[B.b0].matrixWorld);
      if (B.k < 1) { _v2.copy(B.l1).applyMatrix4(bones[B.b1].matrixWorld); _v1.lerp(_v2, 1 - B.k); }
      tg[i * 3] = _v1.x; tg[i * 3 + 1] = _v1.y; tg[i * 3 + 2] = _v1.z;
    }
  }
  reset() { this.x.set(this.tg); this.px.set(this.tg); this.ready = true; }

  step(h, scale, caps, ncap, grav) {
    const x = this.x, px = this.px, tg = this.tg, n = this.n, pin = this.pinW, mem = this.memW;
    const damp = 0.985, g = grav * h * h;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (pin[i] >= 1) { px[k] = x[k]; px[k + 1] = x[k + 1]; px[k + 2] = x[k + 2]; x[k] = tg[k]; x[k + 1] = tg[k + 1]; x[k + 2] = tg[k + 2]; continue; }
      const vx = (x[k] - px[k]) * damp, vy = (x[k + 1] - px[k + 1]) * damp, vz = (x[k + 2] - px[k + 2]) * damp;
      px[k] = x[k]; px[k + 1] = x[k + 1]; px[k + 2] = x[k + 2];
      x[k] += vx; x[k + 1] += vy - g; x[k + 2] += vz;
      const m = mem[i];
      if (m > 0) { x[k] += (tg[k] - x[k]) * m; x[k + 1] += (tg[k + 1] - x[k + 1]) * m; x[k + 2] += (tg[k + 2] - x[k + 2]) * m; }
    }
    const C = this.C, nc = C.length;
    for (let it = 0; it < 4; it++) {
      for (let c = 0; c < nc; c += 4) {
        const a = C[c] * 3, b = C[c + 1] * 3, L = C[c + 2] * scale, s = C[c + 3];
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        // cloth barely stretches but compresses freely for bend links (it buckles)
        let diff = (d - L) / d;
        if (s < 1 && diff < 0) diff *= 0.2;
        const wa = pin[C[c]] >= 1 ? 0 : 1, wb = pin[C[c + 1]] >= 1 ? 0 : 1, ws = wa + wb;
        if (!ws) continue;
        const f = diff * s / ws;
        x[a] += dx * f * wa; x[a + 1] += dy * f * wa; x[a + 2] += dz * f * wa;
        x[b] -= dx * f * wb; x[b + 1] -= dy * f * wb; x[b + 2] -= dz * f * wb;
      }
      if (it % 2 === 1) this._collide(caps, ncap);
    }
  }
  _collide(caps, ncap) {
    const x = this.x, pin = this.pinW;
    for (let i = 0; i < this.n; i++) {
      if (pin[i] >= 1) continue;
      const k = i * 3;
      let X = x[k], Y = x[k + 1], Z = x[k + 2];
      for (let c = 0; c < ncap; c++) {
        const o = c * 7, ax = caps[o], ay = caps[o + 1], az = caps[o + 2], bx = caps[o + 3], by = caps[o + 4], bz = caps[o + 5], r = caps[o + 6];
        const ux = bx - ax, uy = by - ay, uz = bz - az, ll = ux * ux + uy * uy + uz * uz;
        let t = ll > 1e-9 ? ((X - ax) * ux + (Y - ay) * uy + (Z - az) * uz) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + ux * t, cy = ay + uy * t, cz = az + uz * t;
        const dx = X - cx, dy = Y - cy, dz = Z - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-6, f = r / d; X = cx + dx * f; Y = cy + dy * f; Z = cz + dz * f; }
      }
      x[k] = X; x[k + 1] = Y; x[k + 2] = Z;
    }
  }
  // world positions -> mesh (root space)
  write(src, inv) {
    const P = this.pos, n = this.n;
    for (let i = 0; i < n; i++) { _v1.fromArray(src, i * 3).applyMatrix4(inv); P[i * 3] = _v1.x; P[i * 3 + 1] = _v1.y; P[i * 3 + 2] = _v1.z; }
    if (this.seam) this.seam.forEach((s, j) => { P[(n + j) * 3] = P[s * 3]; P[(n + j) * 3 + 1] = P[s * 3 + 1]; P[(n + j) * 3 + 2] = P[s * 3 + 2]; });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  dispose() { this.geo.dispose(); this.mesh.removeFromParent(); }
}

// ---------------------------------------------------------------------------
export class ClothSet {
  constructor(avatar, rags, opts = {}) {
    this.av = avatar;
    this.list = parseRags(rags).map((e) => new Garment(e, avatar.rig, avatar._merged?.over, engine.qualityName));
    for (const G of this.list) avatar.root.add(G.mesh);
    this.caps = new Float32Array(CAPS.length * 7);
    this.acc = 0;
    this.rate = opts.rate || 60;       // simulation steps per second
    this.kinematic = false;
    this.lastRoot = V(); this.hasLast = false;
    this._inv = new THREE.Matrix4();
  }
  get empty() { return this.list.length === 0; }
  // a garment just put on falls onto the body from h metres above and drapes (customizer)
  dropIn(id, h = 0.4) { const G = this.list.find((g) => g.e.id === id); if (G) { G.drop = 0; G.dropH = h; G.ready = false; } }
  reset() { this.hasLast = false; for (const G of this.list) G.ready = false; }
  _caps(bones, scale) {
    const c = this.caps;
    CAPS.forEach(([ba, la, bb, lb, r], k) => {
      _v1.fromArray(la).applyMatrix4(bones[BI[ba]].matrixWorld);
      if (bb) _v2.fromArray(lb).applyMatrix4(bones[BI[bb]].matrixWorld); else _v2.copy(_v1);
      c[k * 7] = _v1.x; c[k * 7 + 1] = _v1.y; c[k * 7 + 2] = _v1.z; c[k * 7 + 3] = _v2.x; c[k * 7 + 4] = _v2.y; c[k * 7 + 5] = _v2.z;
      c[k * 7 + 6] = (r + 0.012) * scale;
    });
  }
  // call after the avatar's bones are posed and their world matrices are current
  update(dt) {
    if (!this.list.length) return;
    const av = this.av, bones = av.rig.bones;
    av.root.updateWorldMatrix(true, false);
    const scale = av.rigRoot.getWorldScale(_v3).x;
    const lowQ = engine.qualityName === 'low';
    // far from the camera: the stiff skinned fallback is plenty
    const cam = engine.view?.camera || engine.camera;
    const far = cam ? cam.getWorldPosition(_v2).distanceToSquared(_v1.setFromMatrixPosition(av.root.matrixWorld)) > 15 * 15 : false;
    const kin = this.kinematic || lowQ || far || !av.root.visible;
    for (const G of this.list) G.mesh.visible = G.e.zone !== this.hideZone;
    // teleports / first frame: snap the cloth onto the body
    const rp = _v3.setFromMatrixPosition(av.root.matrixWorld);
    if (this.hasLast && rp.distanceTo(this.lastRoot) > 2.5) for (const G of this.list) G.ready = false;
    this.lastRoot.copy(rp); this.hasLast = true;
    this._inv.copy(av.root.matrixWorld).invert();
    for (const G of this.list) {
      G.skin(bones);
      if (G.drop != null && G.drop < 1) {
        G.drop = Math.min(1, G.drop + Math.max(dt, 0) / 0.6);
        const off = (1 - (1 - Math.pow(1 - G.drop, 3))) * G.dropH * scale;
        for (let i = 0; i < G.n; i++) G.tg[i * 3 + 1] += off * (G.pinW[i] >= 1 ? 1 : 0.6);
      }
      if (!G.ready) G.reset();
    }
    if (kin || dt <= 0) {
      for (const G of this.list) G.write(kin ? G.tg : G.x, this._inv);
      return;
    }
    this._caps(bones, scale);
    const h = 1 / this.rate;
    this.acc = Math.min(this.acc + dt, h * 3);
    let stepped = false;
    while (this.acc >= h) {
      this.acc -= h;
      for (const G of this.list) G.step(h, scale, this.caps, CAPS.length, 9.8);
      stepped = true;
    }
    if (stepped) for (const G of this.list) G.write(G.x, this._inv);
  }
  dispose() { for (const G of this.list) G.dispose(); this.list.length = 0; }
}

// ---------------------------------------------------------------------------
// a rag hanging from a hook (customizer rail): the same garment cloth pinned along its top edge,
// swaying when touched. anchor: Object3D (the hook); kick(v) pushes it.
export function buildRagPreview(id) {
  const e = ragEntry(id);
  if (!e) return null;
  const S = SHAPES[e.type]();
  // lay the garment flat as a hanging sheet: grid in the hook's plane, top row pinned
  const nu = S.nu, nv = S.nv, n = nu * nv;
  const flat = e.type === 'scarf' || e.type === 'headwrap';
  const W = flat ? 0.08 : e.type === 'bandana' ? 0.34 : 0.42, Hh = flat ? 0.9 : e.type === 'bandana' ? 0.3 : e.type === 'kilt' ? 0.38 : 0.5;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), uv = [];
  const x = new Float32Array(n * 3), px = new Float32Array(n * 3), rest = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = i / (nu - 1), v = j / (nv - 1);
    rest.push(V((u - 0.5) * W, -v * Hh, (Math.sin(u * PI * 3) * 0.01)));
    uv.push(S.close ? u : S.uv[j * nu + i][0], S.uv[j * nu + i][1]);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const I = [];
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) { const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1; I.push(a, c, b, b, c, d); }
  g.setIndex(I);
  const mesh = new THREE.Mesh(g, ragMaterial(e));
  mesh.castShadow = true; mesh.frustumCulled = false; mesh.name = 'ragpreview_' + id;
  const C = [];
  const add = (a, b, k) => C.push(a, b, rest[a].distanceTo(rest[b]), k);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * nu + i;
    if (i < nu - 1) add(a, a + 1, 1);
    if (j < nv - 1) add(a, a + nu, 1);
    if (i < nu - 1 && j < nv - 1) { add(a, a + nu + 1, 0.5); add(a + 1, a + nu, 0.5); }
    if (j < nv - 2) add(a, a + 2 * nu, 0.15);
  }
  const pinned = (i) => i < nu && (flat || i % 2 === 0 || i === nu - 1);
  for (let i = 0; i < n; i++) { rest[i].toArray(x, i * 3); rest[i].toArray(px, i * 3); }
  const wind = V();
  const api = {
    object: mesh, entry: e, kickV: V(),
    kick(v) { api.kickV.add(v); },
    update(dt) {
      const h = Math.min(dt, 1 / 30);
      const t = performance.now() / 1000;
      wind.set(Math.sin(t * 0.7 + nu) * 0.02, 0, Math.sin(t * 1.1 + nv) * 0.03).add(api.kickV);
      api.kickV.multiplyScalar(Math.exp(-6 * dt));
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        if (pinned(i)) { x[k] = rest[i].x; x[k + 1] = rest[i].y; x[k + 2] = rest[i].z; px[k] = x[k]; px[k + 1] = x[k + 1]; px[k + 2] = x[k + 2]; continue; }
        const vx = (x[k] - px[k]) * 0.98, vy = (x[k + 1] - px[k + 1]) * 0.98, vz = (x[k + 2] - px[k + 2]) * 0.98;
        px[k] = x[k]; px[k + 1] = x[k + 1]; px[k + 2] = x[k + 2];
        const f = (i / n);
        x[k] += vx + wind.x * h * h * 40 * f; x[k + 1] += vy - 9.8 * h * h; x[k + 2] += vz + wind.z * h * h * 40 * f;
        if (x[k + 2] > 0.04) x[k + 2] = 0.04;   // the wall / rail backing
      }
      for (let it = 0; it < 5; it++) for (let c = 0; c < C.length; c += 4) {
        const a = C[c] * 3, b = C[c + 1] * 3, L = C[c + 2], s = C[c + 3];
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
        let diff = (d - L) / d; if (s < 1 && diff < 0) diff *= 0.2;
        const wa = pinned(C[c]) ? 0 : 1, wb = pinned(C[c + 1]) ? 0 : 1, ws = wa + wb; if (!ws) continue;
        const ff = diff * s / ws;
        x[a] += dx * ff * wa; x[a + 1] += dy * ff * wa; x[a + 2] += dz * ff * wa;
        x[b] -= dx * ff * wb; x[b + 1] -= dy * ff * wb; x[b + 2] -= dz * ff * wb;
      }
      pos.set(x);
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
    },
  };
  api.update(0.016);
  return api;
}
void mixHex; void RD; void _m;
