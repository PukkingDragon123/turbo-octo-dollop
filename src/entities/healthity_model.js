// R.O.O.M. — Healthity MK-VII (service year 1979): an old, uncanny medical unit (~0.30 m). A yellowed,
// cracked "space-age" plastic ball (engraved panel seams with screws, taped-over cracks, a faded red cross,
// stencils, back vents) split by a riveted aluminium belt, with a small bulging CRT behind dirty, cracked
// glass that shows only a pair of doll eyes. Its mouth is a bolted-on thermal receipt printer: a bevelled
// housing with a slot, a serrated tear bar and a hinged lip that chatters while it talks (a red LED glows
// inside). A dented speaker grille on one cheek, a bakelite dial and a snapped-off one on the other, a
// crooked antenna, a leaking cable stub, and a rattling ducted hover fan underneath.
//
// Every surface has canvas texture maps (albedo + normal + roughness): the shell its own UV-painted set
// (decals, seams, cracks, grime), the painted / metal parts a shared tiling worn-paint / brushed-metal set
// (multiplied by per-part vertex colours), the grille and the CRT glass their own sets.
// Parts are lathed (shell, bezel, belt, knob, duct) or bevel-extruded (printer housing, plates, blades).
//
// buildHealthity() -> { root, setFace(expr), setTalking(bool), setPrinting(bool), setPower(0..1),
//                       setGaze(x, y), update(dt), screen, mouth }
//   expressions: HEALTHITY_FACES. root origin = centre of the ball; the face looks down +Z (Object3D.lookAt).
//   mouth: Object3D at the printer slot (+Z out of the slot, +Y up) for receipts.
// ~11 draw calls; geometry, textures and shared materials are cached, per instance only the CRT canvas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const PI = Math.PI, TAU = PI * 2;
export const HEALTHITY_FACES = ['happy', 'neutral', 'worried', 'alarmed', 'sleepy', 'dead', 'love', 'glitch', 'wink', 'angry', 'stare', 'static', 'boot', 'off'];
const R = 0.15;                        // shell radius
const HC = 0.7 * R;                    // CRT opening plane (z)
const RC = Math.sqrt(R * R - HC * HC); // opening radius
const RS = 0.074;                      // CRT screen radius
const SZ = HC - 0.013;                 // screen rim plane
const PHI_CUT = Math.acos(-HC / R);    // profile angle (from the back pole) of the opening
const NPROF = 30;                      // sphere points in the lathe profile (+2 lip points)
const BELT_H = -0.45 * R;
const SCR = 256;                       // CRT canvas size
const PHOS = { happy: '#9dffd0', neutral: '#9dffd0', worried: '#c8ffb0', alarmed: '#ffd27a', sleepy: '#7fdcb8', dead: '#5f8f7a', love: '#ffb0dc', glitch: '#9dffd0', wink: '#9dffd0', angry: '#ff7a5c', stare: '#d8fff0', static: '#c8d8d0', boot: '#d8fff0', off: '#000000' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _cache = new Map();
const cached = (k, fn) => { if (!_cache.has(k)) _cache.set(k, fn()); return _cache.get(k); };
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const dirv = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------------------------------------------------------------- texture helpers
// tangent-space normal map from a grey height canvas (OpenGL convention, canvas top = v 1)
function heightToNormal(src, strength = 2, wrapX = true, wrapY = true) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), oc = out.getContext('2d'), id = oc.createImageData(w, h), d = id.data;
  const H = (x, y) => {
    x = wrapX ? (x + w) % w : clamp(x, 0, w - 1); y = wrapY ? (y + h) % h : clamp(y, 0, h - 1);
    return s[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const nx = -dx, ny = dy, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  return out;
}
function mkTex(cv, srgb, repeat = 0) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  if (repeat) { t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
// a tiling worn set: draw(albedo, height, rough, size, rnd) -> { map, normalMap, roughnessMap }
function wornSet(key, size, draw, strength, repeat) {
  return cached(key, () => {
    const A = canvas(size), Hc = canvas(size), Rc = canvas(size);
    draw(A.getContext('2d'), Hc.getContext('2d', { willReadFrequently: true }), Rc.getContext('2d'), size, mulberry(key.length * 7919 + size));
    return { map: mkTex(A, true, repeat), normalMap: mkTex(heightToNormal(Hc, strength), false, repeat), roughnessMap: mkTex(Rc, false, repeat) };
  });
}
const fill = (c, col, s) => { c.fillStyle = col; c.fillRect(0, 0, s, s); };
function speckle(c, s, rnd, n, col, a0, a1, r0, r1) {
  for (let i = 0; i < n; i++) { c.fillStyle = col.replace('A', (a0 + rnd() * (a1 - a0)).toFixed(3)); const r = r0 + rnd() * (r1 - r0); c.fillRect(rnd() * s, rnd() * s, r, r * (0.5 + rnd())); }
}
function blotches(c, s, rnd, n, col, a0, a1, r0, r1) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s, r = r0 + rnd() * (r1 - r0);
    for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, col.replace('A', (a0 + rnd() * (a1 - a0)).toFixed(3))); g.addColorStop(1, col.replace('A', '0'));
      c.fillStyle = g; c.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    }
  }
}
function scratches(cs, s, rnd, n, len, cols) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s, a = rnd() * PI, l = len * (0.3 + rnd());
    cs.forEach((c, k) => { c.strokeStyle = cols[k]; c.lineWidth = 0.7 + rnd() * 0.6; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); });
  }
}
// painted steel / bakelite / rubber: grime, chipped edges, scratches, orange-peel (multiplied by vertex colour)
const paintSet = () => wornSet('hm_paint', 256, (a, h, r, s, rnd) => {
  fill(a, '#efece6', s); fill(h, 'rgb(128,128,128)', s); fill(r, 'rgb(150,150,150)', s);
  const id = h.getImageData(0, 0, s, s), D = id.data;
  for (let i = 0; i < D.length; i += 4) D[i] = D[i + 1] = D[i + 2] = 128 + (rnd() - 0.5) * 10;
  h.putImageData(id, 0, 0);
  blotches(a, s, rnd, 26, 'rgba(70,58,40,A)', 0.06, 0.22, 10, 50);
  blotches(r, s, rnd, 20, 'rgba(220,220,220,A)', 0.1, 0.35, 10, 45);
  blotches(r, s, rnd, 12, 'rgba(60,60,60,A)', 0.1, 0.3, 8, 30);
  // chips: bare lighter primer, sunk into the height
  for (let i = 0; i < 40; i++) {
    const x = rnd() * s, y = rnd() * s, rr = 1.5 + rnd() * 4;
    a.fillStyle = 'rgba(255,250,240,0.55)'; a.beginPath(); a.ellipse(x, y, rr, rr * (0.5 + rnd() * 0.6), rnd() * PI, 0, TAU); a.fill();
    h.fillStyle = 'rgba(70,70,70,0.8)'; h.beginPath(); h.ellipse(x, y, rr, rr * 0.7, 0, 0, TAU); h.fill();
    r.fillStyle = 'rgba(210,210,210,0.8)'; r.beginPath(); r.arc(x, y, rr, 0, TAU); r.fill();
  }
  scratches([a, h, r], s, rnd, 70, 30, ['rgba(255,255,255,0.22)', 'rgba(80,80,80,0.6)', 'rgba(90,90,90,0.5)']);
  speckle(a, s, rnd, 500, 'rgba(40,30,20,A)', 0.05, 0.25, 0.5, 2);
}, 2.2, 3);
// oxidised / brushed aluminium and chrome: directional streaks, pitting, fingerprints of grime
const metalSet = () => wornSet('hm_metal', 256, (a, h, r, s, rnd) => {
  fill(a, '#e4e1da', s); fill(h, 'rgb(128,128,128)', s); fill(r, 'rgb(95,95,95)', s);
  for (let y = 0; y < s; y += 1) {
    const v = (rnd() - 0.5);
    a.fillStyle = `rgba(${v > 0 ? '255,255,255' : '60,55,50'},${Math.abs(v) * 0.12})`; a.fillRect(0, y, s, 1);
    h.fillStyle = `rgba(${v > 0 ? '150,150,150' : '105,105,105'},0.5)`; h.fillRect(0, y, s, 1);
    r.fillStyle = `rgba(${v > 0 ? '130,130,130' : '70,70,70'},0.35)`; r.fillRect(0, y, s, 1);
  }
  blotches(a, s, rnd, 18, 'rgba(90,75,50,A)', 0.08, 0.28, 8, 40);
  blotches(r, s, rnd, 18, 'rgba(200,200,200,A)', 0.15, 0.45, 8, 40);
  for (let i = 0; i < 120; i++) { const x = rnd() * s, y = rnd() * s; h.fillStyle = 'rgba(60,60,60,0.8)'; h.fillRect(x, y, 1.5, 1.5); a.fillStyle = 'rgba(70,60,45,0.4)'; a.fillRect(x, y, 1.5, 1.5); r.fillStyle = 'rgba(220,220,220,0.7)'; r.fillRect(x, y, 2, 2); }
  scratches([a, h, r], s, rnd, 40, 40, ['rgba(255,255,255,0.3)', 'rgba(90,90,90,0.5)', 'rgba(60,60,60,0.5)']);
}, 1.6, 3);

// ---------------------------------------------------------------- shell texture (UV = lathe around +Z)
// u = azimuth (0 = bottom, .25 = +x, .5 = top, .75 = -x), v = profile from the back pole (0) to the lip (1)
const TW = 1024, TH = 512;
function uvOf(d) {
  const pp = Math.acos(clamp(-d.z, -1, 1));
  let phi = Math.atan2(d.x, -d.y); if (phi < 0) phi += TAU;
  return { u: phi / TAU, v: (pp / PHI_CUT) * NPROF / (NPROF + 2), r: R * Math.sin(pp) };
}
const yOfPhi = (pp) => (1 - (pp / PHI_CUT) * NPROF / (NPROF + 2)) * TH; // canvas y of a profile angle
const PXM_V = TH / ((NPROF + 2) * (PHI_CUT / NPROF) * R); // canvas px per metre along the profile
// draw fn(ctx, layer) on every layer (0 albedo, 1 height, 2 roughness) at a model direction, metric-ish units
function decal(cs, d, rot, fn) {
  const { u, v, r } = uvOf(d);
  const kx = (TW / (TAU * Math.max(0.01, r))) / PXM_V;
  cs.forEach((c, k) => { c.save(); c.translate(u * TW, (1 - v) * TH); c.scale(kx, 1); c.rotate(rot); fn(c, k); c.restore(); });
}
function crack(L, rnd, x, y, len, ang, w, depth = 0) {
  const pts = [[x, y]];
  for (let s = 0; s < len; s += 5 + rnd() * 9) {
    ang += (rnd() - 0.5) * 0.9;
    x += Math.cos(ang) * 7; y += Math.sin(ang) * 7;
    pts.push([x, y]);
    if (depth < 2 && rnd() < 0.13) crack(L, rnd, x, y, len * 0.45, ang + (rnd() < 0.5 ? 0.8 : -0.8), w * 0.6, depth + 1);
  }
  const line = (ctx, col, lw, ox = 0, oy = 0) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy))); ctx.stroke(); };
  line(L[0], 'rgba(245,236,205,0.5)', w * 0.8, 0.9, 1.1);
  line(L[0], 'rgba(70,52,28,0.9)', w);
  line(L[1], 'rgb(20,20,20)', w * 1.6);
  line(L[2], 'rgb(235,235,235)', w * 2);
}
// a Phillips screw head: domed in the height map, a cross slot, a rust ring
function screw(L, x, y, r) {
  L[0].fillStyle = '#9c968a'; L[0].beginPath(); L[0].arc(x, y, r, 0, TAU); L[0].fill();
  L[0].strokeStyle = 'rgba(110,60,25,0.6)'; L[0].lineWidth = 1.5; L[0].beginPath(); L[0].arc(x, y, r + 1, 0, TAU); L[0].stroke();
  L[0].fillStyle = '#2a2622'; L[0].fillRect(x - r * 0.7, y - 0.8, r * 1.4, 1.6); L[0].fillRect(x - 0.8, y - r * 0.7, 1.6, r * 1.4);
  const g = L[1].createRadialGradient(x, y, 0, x, y, r + 1.5); g.addColorStop(0, 'rgb(200,200,200)'); g.addColorStop(0.75, 'rgb(150,150,150)'); g.addColorStop(1, 'rgb(70,70,70)');
  L[1].fillStyle = g; L[1].beginPath(); L[1].arc(x, y, r + 1.5, 0, TAU); L[1].fill();
  L[1].fillStyle = 'rgb(60,60,60)'; L[1].fillRect(x - r * 0.7, y - 0.8, r * 1.4, 1.6); L[1].fillRect(x - 0.8, y - r * 0.7, 1.6, r * 1.4);
  L[2].fillStyle = 'rgb(90,90,90)'; L[2].beginPath(); L[2].arc(x, y, r, 0, TAU); L[2].fill();
}
// an engraved panel seam (a groove with a dark grime line and a light catch edge)
function seam(L, pts, w = 2.4) {
  const path = (c) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); };
  L[0].lineCap = L[1].lineCap = L[2].lineCap = 'round';
  path(L[0]); L[0].strokeStyle = 'rgba(255,248,225,0.35)'; L[0].lineWidth = w + 2; L[0].stroke();
  path(L[0]); L[0].strokeStyle = 'rgba(62,46,24,0.85)'; L[0].lineWidth = w; L[0].stroke();
  path(L[1]); L[1].strokeStyle = 'rgb(95,95,95)'; L[1].lineWidth = w + 3; L[1].stroke();
  path(L[1]); L[1].strokeStyle = 'rgb(30,30,30)'; L[1].lineWidth = w; L[1].stroke();
  path(L[2]); L[2].strokeStyle = 'rgb(225,225,225)'; L[2].lineWidth = w + 1; L[2].stroke();
}
function shellTextures() {
  return cached('hm_shellTex', () => {
    const cc = canvas(TW, TH), hc = canvas(TW, TH), rc = canvas(TW, TH);
    const c = cc.getContext('2d'), b = hc.getContext('2d', { willReadFrequently: true }), ro = rc.getContext('2d');
    const L = [c, b, ro];
    const rnd = mulberry(1979);
    // yellowed ABS: warm base, sun-bleached crown, nicotine-brown blotches, grime toward the back and bottom
    c.fillStyle = '#d6c69a'; c.fillRect(0, 0, TW, TH);
    ro.fillStyle = 'rgb(112,112,112)'; ro.fillRect(0, 0, TW, TH);
    const g1 = c.createLinearGradient(0, 0, TW, 0);
    g1.addColorStop(0, 'rgba(90,70,35,0.35)'); g1.addColorStop(0.3, 'rgba(90,70,35,0)'); g1.addColorStop(0.5, 'rgba(255,250,225,0.18)'); g1.addColorStop(0.7, 'rgba(90,70,35,0)'); g1.addColorStop(1, 'rgba(90,70,35,0.35)');
    c.fillStyle = g1; c.fillRect(0, 0, TW, TH);
    const g2 = c.createLinearGradient(0, 0, 0, TH);
    g2.addColorStop(0, 'rgba(60,45,25,0.28)'); g2.addColorStop(0.07, 'rgba(60,45,25,0)'); g2.addColorStop(0.7, 'rgba(80,62,30,0.05)'); g2.addColorStop(1, 'rgba(80,62,30,0.4)');
    c.fillStyle = g2; c.fillRect(0, 0, TW, TH);
    const r2 = ro.createLinearGradient(0, 0, 0, TH); r2.addColorStop(0, 'rgba(200,200,200,0.3)'); r2.addColorStop(0.5, 'rgba(200,200,200,0)'); r2.addColorStop(1, 'rgba(210,210,210,0.45)');
    ro.fillStyle = r2; ro.fillRect(0, 0, TW, TH);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * TW, y = rnd() * TH, r = 6 + rnd() * 46;
      const a = 0.04 + rnd() * 0.1, dark = rnd() < 0.7;
      let g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? `rgba(140,105,45,${a})` : `rgba(250,244,220,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      g = ro.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? `rgba(215,215,215,${a * 2})` : `rgba(40,40,40,${a * 1.5})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ro.fillStyle = g; ro.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // orange-peel moulding in the height map
    const id = b.createImageData(TW, TH), D = id.data;
    for (let i = 0; i < D.length; i += 4) { const n = 128 + (rnd() - 0.5) * 12; D[i] = D[i + 1] = D[i + 2] = n; D[i + 3] = 255; }
    b.putImageData(id, 0, 0);
    scratches(L, TW, rnd, 140, 26, ['rgba(255,250,230,0.25)', 'rgba(90,90,90,0.55)', 'rgba(200,200,200,0.45)']);
    // grime where the belt meets the shell, and in the lip seam
    const yb = yOfPhi(Math.acos(-BELT_H / R));
    for (const [lay, col] of [[c, 'rgba(70,52,25,A)'], [ro, 'rgba(225,225,225,A)']]) {
      const g3 = lay.createLinearGradient(0, yb - 22, 0, yb + 22);
      g3.addColorStop(0, col.replace('A', '0')); g3.addColorStop(0.5, col.replace('A', '0.55')); g3.addColorStop(1, col.replace('A', '0'));
      lay.fillStyle = g3; lay.fillRect(0, yb - 22, TW, 44);
    }
    c.fillStyle = 'rgba(55,40,20,0.5)'; c.fillRect(0, 0, TW, 9);
    for (let i = 0; i < 40; i++) {
      const x = (rnd() < 0.5 ? rnd() * 0.2 : 0.8 + rnd() * 0.2) * TW, l = 10 + rnd() * 60;
      const g = c.createLinearGradient(0, yb, 0, yb + l);
      g.addColorStop(0, 'rgba(80,58,28,0.35)'); g.addColorStop(1, 'rgba(80,58,28,0)');
      c.fillStyle = g; c.fillRect(x, yb, 1.5 + rnd() * 2.5, l);
    }
    // panel seams: a ring around the face (constant profile angle = a horizontal line), four seams from the
    // face ring to the belt, a round service hatch on the back with six screws
    const yFace = yOfPhi(PHI_CUT - 0.2), yHatch = yOfPhi(0.62);
    seam(L, [[0, yFace], [TW, yFace]]);
    for (const u of [0.125, 0.375, 0.625, 0.875]) seam(L, [[u * TW, yFace], [u * TW, yb - 8]], 2);
    seam(L, [[0, yHatch], [TW, yHatch]]);
    for (let i = 0; i < 6; i++) screw(L, ((i + 0.5) / 6) * TW, yHatch + 12, 4.5);
    for (const u of [0.125, 0.375, 0.625, 0.875]) { screw(L, u * TW + 9, yFace + 12, 3.6); screw(L, u * TW + 9, yb - 20, 3.6); }
    // back vents: five rounded slots in the hatch
    decal(L, dirv(0, 0.3, -0.95), PI, (x, k) => {
      for (let i = 0; i < 5; i++) {
        x.beginPath(); x.roundRect(-26, -16 + i * 7, 52, 4.2, 2.1);
        x.fillStyle = k === 0 ? '#120e0a' : k === 1 ? 'rgb(25,25,25)' : 'rgb(230,230,230)'; x.fill();
      }
    });
    // cracks: forehead-right (taped over), lower left cheek, the back
    const cracks = [[dirv(0.55, 0.62, 0.55), 70, 0.4], [dirv(-0.62, -0.55, 0.45), 90, 2.4], [dirv(0.2, 0.5, -0.84), 120, 1.2], [dirv(0.5, -0.86, 0.1), 50, 3.6]];
    for (const [d, l, a] of cracks) { const { u, v } = uvOf(d); crack(L, rnd, u * TW, (1 - v) * TH, l, a, 1.6); }
    // grey duct tape across the forehead crack, frayed ends
    decal(L, dirv(0.5, 0.64, 0.55), 2.6, (x, k) => {
      x.beginPath(); x.moveTo(-34, -9); for (let i = 0; i <= 8; i++) x.lineTo(-34 + i * 8.5, -9 + (i % 2) * 1.5); x.lineTo(34, 9); for (let i = 8; i >= 0; i--) x.lineTo(-34 + i * 8.5, 9 - (i % 2) * 1.5); x.closePath();
      if (k === 0) {
        const g = x.createLinearGradient(0, -9, 0, 9); g.addColorStop(0, '#8d8f8a'); g.addColorStop(0.5, '#a9aba5'); g.addColorStop(1, '#7d7f7a');
        x.fillStyle = g; x.fill();
        x.strokeStyle = 'rgba(60,60,55,0.35)'; x.lineWidth = 0.6;
        for (let i = -30; i < 34; i += 3) { x.beginPath(); x.moveTo(i, -8); x.lineTo(i + 1, 8); x.stroke(); }
        x.fillStyle = 'rgba(70,55,30,0.25)'; x.fillRect(-34, 5, 68, 4);
      } else { x.fillStyle = k === 1 ? 'rgb(168,168,168)' : 'rgb(205,205,205)'; x.fill(); }
    });
    // faded red cross on the crown, chipped
    decal(L, dirv(0, 0.96, 0.27), PI, (x, k) => {
      if (k === 1) return;
      x.globalAlpha = k === 0 ? 0.72 : 0.5; x.fillStyle = k === 0 ? '#a0473a' : 'rgb(150,150,150)';
      x.beginPath(); x.arc(0, 0, 26, 0, TAU); x.lineWidth = 3; x.strokeStyle = x.fillStyle; x.stroke();
      x.fillRect(-7, -19, 14, 38); x.fillRect(-19, -7, 38, 14);
      x.globalAlpha = 1;
      if (k === 0) { x.fillStyle = '#d3c397'; for (let i = 0; i < 60; i++) { const a = rnd() * TAU, r = rnd() * 28; x.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1 + rnd() * 3, 1 + rnd() * 2); } }
    });
    // brand above the screen, stencils on the crown and the right cheek
    const label = (d, rot, lines) => decal([c], d, rot, (x) => {
      for (const [t, y, px, col, font] of lines) {
        x.font = `${font || 'bold'} ${px}px "Jolly Lodger", Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillStyle = col; x.fillText(t, 0, y);
      }
      for (let i = 0; i < 50; i++) { x.fillStyle = `rgba(214,198,154,${0.4 + rnd() * 0.5})`; x.fillRect((rnd() - 0.5) * 120, (rnd() - 0.5) * 30, 1 + rnd() * 4, 1 + rnd() * 2); }
    });
    label(dirv(0, 0.8, 0.6), PI, [['HEALTHITY', 0, 15, 'rgba(70,48,30,0.85)', '900']]);
    label(dirv(0, 0.995, -0.1), PI, [['MEDI-UNIT  MK.VII', 0, 11, 'rgba(60,45,30,0.8)'], ['R.O.O.M. MEDICAL DIVISION', 13, 7, 'rgba(60,45,30,0.7)']]);
    label(dirv(0.97, 0.18, -0.16), PI / 2, [['SN 07-1979-0042', 0, 8, 'rgba(60,45,30,0.75)'], ['DO NOT REACTIVATE', 11, 7, 'rgba(120,40,30,0.75)']]);
    return { map: mkTex(cc, true), normalMap: mkTex(heightToNormal(hc, 3, true, false), false), roughnessMap: mkTex(rc, false) };
  });
}

// speaker grille: painted steel with a hex hole pattern and rust (albedo / normal / roughness)
const grilleSet = () => wornSet('hm_grille', 256, (a, h, r, s, rnd) => {
  fill(a, '#8e8877', s); fill(h, 'rgb(150,150,150)', s); fill(r, 'rgb(140,140,140)', s);
  blotches(a, s, rnd, 30, 'rgba(120,62,25,A)', 0.2, 0.5, 8, 30);
  blotches(r, s, rnd, 20, 'rgba(225,225,225,A)', 0.2, 0.5, 8, 30);
  for (let y = 10, row = 0; y < s; y += 13, row++) for (let x = 10 + (row % 2) * 7; x < s; x += 14) {
    const dx = x - s / 2, dy = y - s / 2; if (dx * dx + dy * dy > (s * 0.43) ** 2) continue;
    a.fillStyle = '#0d0b09'; a.beginPath(); a.arc(x, y, 4.2, 0, TAU); a.fill();
    a.strokeStyle = 'rgba(230,220,190,0.25)'; a.lineWidth = 1; a.beginPath(); a.arc(x + 0.5, y + 0.8, 4.4, 0.2, 2.6); a.stroke();
    h.fillStyle = 'rgb(20,20,20)'; h.beginPath(); h.arc(x, y, 4.4, 0, TAU); h.fill();
    r.fillStyle = 'rgb(240,240,240)'; r.beginPath(); r.arc(x, y, 4.2, 0, TAU); r.fill();
  }
  scratches([a, h, r], s, rnd, 20, 30, ['rgba(255,255,255,0.2)', 'rgba(90,90,90,0.5)', 'rgba(90,90,90,0.4)']);
}, 2.5, 0);
// dirty, cracked CRT glass (RGBA albedo + roughness: smudges are matte, clean glass is glossy)
const dirtSet = () => cached('hm_dirt', () => {
  const s = 256, A = canvas(s), Rc = canvas(s), c = A.getContext('2d'), r = Rc.getContext('2d'), rnd = mulberry(4242);
  r.fillStyle = 'rgb(20,20,20)'; r.fillRect(0, 0, s, s);
  c.fillStyle = 'rgba(120,105,70,0.07)'; c.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * s, y = rnd() * s, rr = 10 + rnd() * 50, a = 0.08 + rnd() * 0.18;
    let g = c.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(110,95,60,${a})`); g.addColorStop(1, 'rgba(110,95,60,0)'); c.fillStyle = g; c.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
    g = r.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(200,200,200,${a * 2.5})`); g.addColorStop(1, 'rgba(200,200,200,0)'); r.fillStyle = g; r.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
  }
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.34, s / 2, s / 2, s * 0.5); g.addColorStop(0, 'rgba(60,48,30,0)'); g.addColorStop(1, 'rgba(60,48,30,0.75)');
  c.fillStyle = g; c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(150,140,110,0.1)'; c.lineWidth = 1;
  for (let k = 0; k < 7; k++) { const a0 = rnd() * TAU; c.beginPath(); c.ellipse(52, 196, 4 + k * 2.4, 3 + k * 1.8, 0.5, a0, a0 + 1.2 + rnd() * 1.5); c.stroke(); }
  for (const [lay, col] of [[c, 'rgba(235,240,230,0.55)'], [r, 'rgba(230,230,230,0.9)']]) {
    const rr = mulberry(77); lay.strokeStyle = col; lay.lineWidth = 1.1;
    for (let k = 0; k < 6; k++) {
      let x = 196, y = 52, a = PI * 0.55 + k * 0.42 + rr() * 0.2;
      lay.beginPath(); lay.moveTo(x, y);
      for (let i = 0; i < 6 + rr() * 6; i++) { a += (rr() - 0.5) * 0.5; x += Math.cos(a) * 9; y += Math.sin(a) * 9; lay.lineTo(x, y); }
      lay.stroke();
    }
  }
  for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '230,225,205' : '50,40,25'},${0.2 + rnd() * 0.4})`; c.fillRect(rnd() * s, rnd() * s, 1, 1); }
  return { map: mkTex(A, true), roughnessMap: mkTex(Rc, false) };
});

// ---------------------------------------------------------------- geometry
const D_GRILLE = dirv(-0.86, -0.02, 0.5);
const D_DIAL = dirv(0.86, -0.1, 0.5), D_STUB = dirv(0.78, 0.3, 0.55);
const D_ANT = dirv(-0.45, 0.88, -0.15);
const CHIN = { y: -0.108, z: 0.095, w: 0.09, h: 0.036, d: 0.07 };
const SLOT = new THREE.Vector3(0, CHIN.y + 0.003, CHIN.z + CHIN.d / 2 + 0.0035);
const FAN_Y = -R * 0.955, FAN_Z = -0.018;

// a vertex-coloured piece for a merge: non-indexed, position + normal + uv (scaled) + color
function piece(g, col, m = null, uvScale = 1) {
  if (m) g.applyMatrix4(m);
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (uvScale !== 1) { const U = g.attributes.uv; for (let i = 0; i < n; i++) U.setXY(i, U.getX(i) * uvScale, U.getY(i) * uvScale); }
  const c = new THREE.Color(col), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// matrix that puts local +Y (or +Z) along a surface normal at the sphere surface (+ lift)
function onSurface(d, lift = 0, axis = _Y, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(axis, d);
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(axis, spin));
  return new THREE.Matrix4().compose(d.clone().multiplyScalar(R + lift), q, new THREE.Vector3(1, 1, 1));
}
const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
function lathe(pts, seg = 40) { return new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg); }
function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// a bevelled rounded plate / block (w x h, depth d along z, centred); uv in ~cm so the worn set tiles sensibly
function plate(w, h, d, r = Math.min(w, h) * 0.3, bev = Math.min(d * 0.35, Math.min(w, h) * 0.2)) {
  const g = new THREE.ExtrudeGeometry(roundRect(w - 2 * bev, h - 2 * bev, Math.max(0.0002, r - bev)), { depth: Math.max(0.0001, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 5 });
  g.translate(0, 0, -(d - 2 * bev) / 2);
  const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * 12, U.getY(i) * 12);
  return g;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

function shellGeometry() {
  return cached('hm_shell', () => {
    const pts = [];
    for (let i = 0; i <= NPROF; i++) { const p = (PHI_CUT * i) / NPROF; pts.push([Math.max(1e-4, R * Math.sin(p)), -R * Math.cos(p)]); }
    pts.push([RC - 0.0022, HC + 0.0024], [RC - 0.0065, HC + 0.0018]);
    const g = lathe(pts, 64);
    g.rotateX(PI / 2);
    g.computeBoundingSphere();
    return g;
  });
}
function screenGeometry() {
  return cached('hm_screen', () => {
    const g = new THREE.RingGeometry(0.0004, RS, 40, 7);
    const P = g.attributes.position, Rb = 0.25, base = Math.sqrt(Rb * Rb - RS * RS);
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i); P.setZ(i, SZ + Math.sqrt(Rb * Rb - x * x - y * y) - base); }
    g.computeVertexNormals();
    return g;
  });
}
function grilleGeometry() {
  return cached('hm_grilleGeo', () => {
    const r = 0.034, g = new THREE.RingGeometry(0.0004, r, 30, 6);
    const P = g.attributes.position;
    const dents = [[0.012, 0.008, 0.011, 0.004], [-0.014, -0.012, 0.008, 0.0025]];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      let z = -((x * x + y * y) / (2 * R)); // follow the ball's curvature
      for (const [dx, dy, dr, dd] of dents) { const q = Math.hypot(x - dx, y - dy) / dr; if (q < 1) z -= dd * (1 - q * q) ** 2; }
      P.setZ(i, z);
    }
    g.computeVertexNormals();
    g.applyMatrix4(onSurface(D_GRILLE, 0.0035, _Z));
    return g;
  });
}
function partsGeometry() {
  return cached('hm_parts', () => {
    const dark = [], metal = [];
    // bakelite bezel from the lip down into the screen
    const bz = lathe([[RC - 0.0062, HC + 0.0019], [RC - 0.0095, HC + 0.0042], [RS + 0.013, HC + 0.0022], [RS + 0.0045, HC - 0.004], [RS + 0.0008, SZ + 0.0004], [RS - 0.0005, SZ - 0.002]], 56);
    bz.rotateX(PI / 2);
    dark.push(piece(bz, '#2a211a', null, 4));
    // aluminium belt (a rolled strip with a centre bead) + domed rivets
    const rb = Math.sqrt(R * R - BELT_H * BELT_H);
    const belt = lathe([[rb - 0.001, BELT_H - 0.0085], [rb + 0.0024, BELT_H - 0.008], [rb + 0.0036, BELT_H - 0.006], [rb + 0.0038, BELT_H - 0.0012], [rb + 0.0046, BELT_H], [rb + 0.0038, BELT_H + 0.0012], [rb + 0.0036, BELT_H + 0.006], [rb + 0.0024, BELT_H + 0.008], [rb - 0.001, BELT_H + 0.0085]], 64);
    belt.rotateX(PI / 2);
    metal.push(piece(belt, '#a39d8e', null, 6));
    const rivet = () => new THREE.SphereGeometry(0.0033, 10, 5, 0, TAU, 0, PI / 2);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + 0.07, d = new THREE.Vector3(Math.sin(a) * rb, -Math.cos(a) * rb, BELT_H).normalize();
      metal.push(piece(rivet(), i === 9 ? '#6b5a44' : '#b8b2a2', onSurface(d, 0.0032)));
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.35, f = (a / TAU) % 1; if (f < 0.07 || f > 0.93) continue;
      const rr = (RC + RS) / 2 + 0.004, m = new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a) * rr, -Math.cos(a) * rr, HC + 0.0035), new THREE.Quaternion().setFromUnitVectors(_Y, _Z), new THREE.Vector3(1, 1, 1));
      metal.push(piece(rivet(), '#c3bba8', m));
    }
    // printer "chin" bolted under the screen: a bevelled housing, an inset faceplate, the slot with a chrome
    // lip and a serrated tear bar, domed screws, two bent straps to the ball
    const C = CHIN, zf = C.z + C.d / 2;
    dark.push(piece(plate(C.w, C.h, C.d, 0.009, 0.0035), '#aaa38c', mat4(0, C.y, C.z)));
    dark.push(piece(plate(C.w - 0.008, C.h - 0.009, 0.004, 0.005, 0.0012), '#1e1b17', mat4(0, C.y, zf + 0.0004)));
    dark.push(piece(plate(0.064, 0.0068, 0.004, 0.0025, 0.0008), '#030303', mat4(0, SLOT.y, zf + 0.0014)));
    metal.push(piece(capsule(0.0016, 0.064), '#d0cbbd', mat4(0, SLOT.y + 0.0052, zf + 0.0026, 0, 0, PI / 2)));
    metal.push(piece(plate(0.066, 0.0026, 0.0034, 0.001, 0.0006), '#bdb7a8', mat4(0, SLOT.y - 0.0048, zf + 0.0034)));
    for (let i = 0; i < 13; i++) metal.push(piece(new THREE.ConeGeometry(0.0016, 0.0028, 4), '#bdb7a8', mat4(-0.03 + i * 0.005, SLOT.y - 0.0074, zf + 0.0036, PI, PI / 4, 0)));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) metal.push(piece(new THREE.SphereGeometry(0.0026, 10, 5, 0, TAU, 0, PI / 2), '#8f897a', mat4(sx * 0.038, C.y + sy * 0.011, zf + 0.0019, PI / 2, 0, 0)));
    for (const sx of [-1, 1]) dark.push(piece(plate(0.006, 0.032, 0.05, 0.002, 0.0012), '#8f8873', mat4(sx * (C.w / 2 + 0.0008), C.y + 0.004, C.z - 0.006, 0.35, 0, 0)));
    // grille rim
    metal.push(piece(new THREE.TorusGeometry(0.0345, 0.0028, 8, 40), '#8b8576', onSurface(D_GRILLE, 0.0028, _Z), 4));
    // lathed bakelite dial (skirt + fluted cap) with a cream pointer, and a snapped-off dial (bare D-shaft)
    const dm = onSurface(D_DIAL, 0, _Y);
    dark.push(piece(lathe([[0, 0.0145], [0.0098, 0.0145], [0.0118, 0.0136], [0.0127, 0.0118], [0.0131, 0.005], [0.0138, 0.0035], [0.0178, 0.003], [0.0186, 0.0016], [0.0186, 0]], 24), '#2a1c12', dm, 6));
    dark.push(piece(capsule(0.0011, 0.008), '#e6dcc0', dm.clone().multiply(mat4(0, 0.0148, 0.004, PI / 2, 0, 0))));
    const sm = onSurface(D_STUB, 0, _Y);
    dark.push(piece(lathe([[0.0035, 0.0014], [0.0085, 0.0012], [0.0092, 0]], 18), '#120d09', sm));
    metal.push(piece(new THREE.CylinderGeometry(0.0028, 0.0028, 0.013, 10, 1, false, 0.4, TAU - 0.8), '#a7a196', sm.clone().multiply(mat4(0, 0.0065, 0))));
    // crooked antenna on a lathed base
    const base = D_ANT.clone().multiplyScalar(R);
    metal.push(piece(lathe([[0.0095, 0], [0.0092, 0.002], [0.0062, 0.005], [0.0032, 0.007], [0.0026, 0.009]], 16), '#77715f', onSurface(D_ANT, -0.001, _Y)));
    const p1 = base.clone().addScaledVector(D_ANT, 0.05), bend = dirv(-0.1, 0.6, -0.8);
    const curve = new THREE.CatmullRomCurve3([base.clone().addScaledVector(D_ANT, 0.004), base.clone().addScaledVector(D_ANT, 0.028), p1, p1.clone().addScaledVector(bend, 0.022), p1.clone().addScaledVector(bend, 0.046)]);
    metal.push(piece(new THREE.TubeGeometry(curve, 16, 0.0015, 6), '#b7b2a6'));
    // leaking cable stub out of the back-bottom: a rubber grommet, the cable, a frayed copper end
    const cb = dirv(0.25, -0.55, -0.8);
    dark.push(piece(new THREE.TorusGeometry(0.0055, 0.0022, 8, 16), '#15120e', onSurface(cb, 0.0005, _Z)));
    const cp = cb.clone().multiplyScalar(R * 0.98);
    const cc = new THREE.CatmullRomCurve3([cp, cp.clone().add(new THREE.Vector3(0.01, -0.02, -0.02)), cp.clone().add(new THREE.Vector3(0.018, -0.055, -0.018)), cp.clone().add(new THREE.Vector3(0.012, -0.08, 0.0))]);
    dark.push(piece(new THREE.TubeGeometry(cc, 16, 0.0038, 8), '#1b1712', null, 4));
    const tip = cc.getPoint(1);
    for (let i = 0; i < 5; i++) metal.push(piece(new THREE.CylinderGeometry(0.0006, 0.0006, 0.012, 4), i % 2 ? '#c27a3a' : '#d08a48', mat4(tip.x + (i - 2) * 0.0013, tip.y - 0.005, tip.z + (i % 2) * 0.001, 0.2 * (i - 2), 0, 0.15 * (i - 2))));
    // hover fan: a lathed duct with a rolled lip, a domed hub, three rounded struts (this group rattles)
    const duct = lathe([[0.0398, -0.012], [0.0398, 0.011], [0.0412, 0.0135], [0.0445, 0.0142], [0.0472, 0.0115], [0.0478, 0.006], [0.0478, -0.009], [0.0465, -0.0145], [0.0438, -0.0162], [0.0412, -0.015], [0.0398, -0.012]], 40);
    const fan = [piece(duct, '#4a4741', null, 5)];
    fan.push(piece(lathe([[0, -0.008], [0.0085, -0.0078], [0.0105, -0.005], [0.011, 0.004], [0.0095, 0.0068], [0, 0.0075]], 20), '#2a2825'));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; fan.push(piece(capsule(0.0015, 0.028), '#3a3833', mat4(Math.cos(a) * 0.025, -0.006, Math.sin(a) * 0.025, 0, -a, PI / 2))); }
    const m = (list) => { const g = mergeGeometries(list); g.computeBoundingSphere(); return g; };
    return { dark: m(dark), metal: m(metal), fan: m(fan) };
  });
}
// five twisted, rounded fan blades (a bevelled tear-drop outline), one of them replaced in a darker colour
function bladeGeometry() {
  return cached('hm_blades', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.0035); s.bezierCurveTo(0.012, -0.0058, 0.024, -0.0052, 0.0265, 0); s.bezierCurveTo(0.0255, 0.004, 0.012, 0.0062, 0, 0.0038); s.quadraticCurveTo(-0.002, 0, 0, -0.0035);
    const list = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.0004, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 8 });
      g.translate(0.008, 0, -0.0002);
      g.rotateX(PI / 2 - 0.5);
      const U = g.attributes.uv; for (let k = 0; k < U.count; k++) U.setXY(k, U.getX(k) * 12, U.getY(k) * 12);
      list.push(piece(g, i === 3 ? '#5a4f40' : '#6d675c', mat4(0, 0.001, 0, 0, (i / 5) * TAU, 0)));
    }
    const g = mergeGeometries(list); g.computeBoundingSphere(); return g;
  });
}
// the printer's hinged lower lip
function jawGeometry() {
  return cached('hm_jaw', () => {
    const g = mergeGeometries([
      piece(plate(0.07, 0.011, 0.0024, 0.003, 0.0008), '#bfb9a9', mat4(0, -0.0055, 0)),
      piece(capsule(0.0016, 0.07), '#8d877a', mat4(0, 0, 0, 0, 0, PI / 2)),
    ]);
    g.computeBoundingSphere(); return g;
  });
}

// ---------------------------------------------------------------- materials (shared)
const shellMat = () => cached('hm_shellMat', () => { const t = shellTextures(); return new THREE.MeshStandardMaterial({ name: 'hm_shell', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0 }); });
const darkMat = () => cached('hm_darkMat', () => { const t = paintSet(); return new THREE.MeshStandardMaterial({ name: 'hm_paint', vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.05 }); });
const metalMat = () => cached('hm_metalMat', () => { const t = metalSet(); return new THREE.MeshStandardMaterial({ name: 'hm_metal', vertexColors: true, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.85 }); });
const grilleMat = () => cached('hm_grilleMat', () => { const t = grilleSet(); return new THREE.MeshStandardMaterial({ name: 'hm_grille', map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.45 }); });
const glassMat = () => cached('hm_glassMat', () => { const t = dirtSet(); return new THREE.MeshStandardMaterial({ name: 'hm_glass', map: t.map, roughnessMap: t.roughnessMap, roughness: 1, transparent: true, depthWrite: false, metalness: 0, envMapIntensity: 1.6 }); });

// ---------------------------------------------------------------- the CRT face
function drawFace(c, st, col) {
  const s = SCR, cx = s / 2, cy = s / 2;
  c.globalCompositeOperation = 'source-over';
  c.shadowBlur = 0;
  c.fillStyle = '#020403'; c.fillRect(0, 0, s, s);
  const e = st.expr;
  if (e === 'off' || st.power < 0.05) {
    if (st.power > 0.001 || e === 'off') { c.fillStyle = `rgba(160,200,180,${0.03 + st.ember * 0.25})`; c.beginPath(); c.arc(cx, cy, 6 + st.ember * 30, 0, TAU); c.fill(); }
    return;
  }
  const a = st.bright;
  // lit black level + glow
  const g = c.createRadialGradient(cx, cy * 0.95, 10, cx, cy, s * 0.55);
  g.addColorStop(0, hexA(col, 0.1 * a)); g.addColorStop(1, hexA(col, 0.02 * a));
  c.fillStyle = g; c.fillRect(0, 0, s, s);
  if (e === 'static') {
    const rnd = st.rnd;
    for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) { const v = rnd(); if (v > 0.45) { c.fillStyle = hexA('#d8e8e0', (v - 0.45) * 0.9 * a); c.fillRect(x, y, 4, 4); } }
  } else if (e === 'boot') {
    const k = st.bootK, h = 2 + k * k * 150;
    c.shadowColor = col; c.shadowBlur = 18;
    c.fillStyle = hexA(col, 0.9 * a); c.fillRect(cx - 10 - k * 110, cy - h / 2, 20 + k * 220, h);
    c.fillStyle = hexA('#ffffff', 0.7 * (1 - k)); c.fillRect(cx - 40 - k * 80, cy - 1, 80 + k * 160, 2);
  } else {
    c.shadowColor = col; c.shadowBlur = 14;
    drawEyes(c, st, col, a);
  }
  // rolling hum bar, scanlines, squircle vignette
  c.shadowBlur = 0;
  const hy = ((st.t * 34) % (s + 60)) - 30;
  c.fillStyle = hexA(col, 0.05 * a); c.fillRect(0, hy, s, 26);
  c.fillStyle = 'rgba(0,0,0,0.32)';
  for (let y = 0; y < s; y += 3) c.fillRect(0, y, s, 1);
  if (st.glitchK > 0.02 || e === 'glitch') glitchSlices(c, st, e === 'glitch' ? 0.6 : st.glitchK);
  const v = c.createRadialGradient(cx, cy, s * 0.26, cx, cy, s * 0.5);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.85)');
  c.fillStyle = v; c.fillRect(0, 0, s, s);
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1).toFixed(3)})`; }
function glitchSlices(c, st, k) {
  const rnd = st.rnd, s = SCR;
  for (let i = 0; i < 5 * k + 1; i++) {
    const y = rnd() * s, h = 4 + rnd() * 22, dx = (rnd() - 0.5) * 50 * k;
    c.drawImage(c.canvas, 0, y, s, h, dx, y, s, h);
  }
}
// doll eyes: dim lit whites, a bright iris ring, a black pupil with a catchlight, dark lids
function drawEyes(c, st, col, a) {
  const e = st.expr, cy = 120, rx = 39, ry = 32;
  const blink = st.blink > 0 && e !== 'stare' && e !== 'dead';
  const lids = { neutral: [0.22, 0.08, 0], happy: [0.18, 0.42, 0], worried: [0.3, 0.05, -0.32], alarmed: [0, 0, 0], sleepy: [0.66, 0.1, 0], love: [0.12, 0.25, 0], glitch: [0.2, 0.1, 0], wink: [0.18, 0.4, 0], angry: [0.42, 0.1, 0.38], stare: [0, 0, 0], dead: [0, 0, 0] }[e] || [0.22, 0.08, 0];
  for (const side of [-1, 1]) {
    const ex = 128 + side * 55 + (e === 'alarmed' ? (st.rnd() - 0.5) * 2 : 0);
    if (e === 'dead') {
      c.strokeStyle = hexA(col, 0.8 * a); c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(ex - 16, cy - 14); c.lineTo(ex + 16, cy + 14); c.moveTo(ex + 16, cy - 14); c.lineTo(ex - 16, cy + 14); c.stroke();
      continue;
    }
    const wink = e === 'wink' && side === 1;
    if (blink || wink) {
      c.strokeStyle = hexA(col, 0.9 * a); c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.ellipse(ex, cy + 4, rx * 0.9, ry * 0.45, 0, wink ? PI * 1.1 : 0.15 * PI, wink ? PI * 1.9 : 0.85 * PI); c.stroke();
      continue;
    }
    const sc = e === 'alarmed' || e === 'stare' ? 1.12 : 1;
    const RX = rx * sc, RY = ry * sc;
    c.save();
    c.beginPath(); c.ellipse(ex, cy, RX, RY, 0, 0, TAU); c.clip();
    c.fillStyle = hexA(col, 0.3 * a); c.fillRect(ex - RX, cy - RY, RX * 2, RY * 2);
    // iris + pupil follow the gaze
    const gx = ex + st.gx * RX * 0.42, gy = cy + st.gy * RY * 0.38;
    const ir = e === 'stare' ? 19 : 17;
    c.fillStyle = hexA(col, 0.95 * a); c.beginPath(); c.arc(gx, gy, ir, 0, TAU); c.fill();
    c.fillStyle = hexA('#000000', 0.55); for (let k = 0; k < 10; k++) { const an = (k / 10) * TAU; c.fillRect(gx + Math.cos(an) * ir * 0.62 - 1, gy + Math.sin(an) * ir * 0.62 - 1, 2, 2); }
    c.fillStyle = '#010201';
    if (e === 'love') heart(c, gx, gy, 9);
    else { const pr = e === 'alarmed' ? 3.5 : e === 'stare' ? 10 : e === 'angry' ? 5 : 7; c.beginPath(); c.arc(gx, gy, pr, 0, TAU); c.fill(); }
    c.fillStyle = hexA('#ffffff', 0.85 * a); c.beginPath(); c.arc(gx - 5, gy - 6, 2.6, 0, TAU); c.fill();
    // lids (slanted toward the nose for worried / angry)
    const [top, bot, slant] = lids;
    c.fillStyle = '#020403';
    c.save(); c.translate(ex, cy); c.rotate(slant * side);
    if (top > 0) c.fillRect(-RX - 8, -RY - 8, RX * 2 + 16, 8 + RY * 2 * top);
    if (bot > 0) { c.beginPath(); c.ellipse(0, RY + RY * 2 * (0.5 - bot) + RY * 0.2, RX * 1.3, RY * 1.0, 0, PI, TAU); c.lineTo(RX * 1.4, RY + 10); c.lineTo(-RX * 1.4, RY + 10); c.fill(); }
    c.restore();
    c.restore();
    // eyelash line + rim
    c.strokeStyle = hexA(col, 0.75 * a); c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(ex, cy, RX, RY, 0, 0, TAU); c.stroke();
    if (top > 0) {
      c.save(); c.translate(ex, cy); c.rotate(slant * side);
      c.lineWidth = 4; c.beginPath(); c.moveTo(-RX, -RY + RY * 2 * top); c.lineTo(RX, -RY + RY * 2 * top); c.stroke();
      c.restore();
    }
  }
  if (e === 'love') { const k = (st.t * 0.5) % 1; c.fillStyle = hexA(col, (1 - k) * a); heart(c, 210 + Math.sin(k * 9) * 6, 200 - k * 120, 8); }
  if (e === 'sleepy') { const k = (st.t * 0.6) % 1; c.font = 'bold 22px "Jolly Lodger", Georgia, serif'; c.fillStyle = hexA(col, (1 - k) * 0.9 * a); c.fillText('z', 200 + k * 16, 70 - k * 30); }
}
function heart(c, x, y, r) { c.beginPath(); c.moveTo(x, y + r); c.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.3, x, y - r * 0.4); c.bezierCurveTo(x + r * 0.6, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r); c.fill(); }

// ---------------------------------------------------------------------------
export function buildHealthity() {
  const root = new THREE.Group(); root.name = 'Healthity';
  const body = new THREE.Group(); root.add(body);
  const P = partsGeometry();
  const shell = new THREE.Mesh(shellGeometry(), shellMat());
  const dark = new THREE.Mesh(P.dark, darkMat());
  const metal = new THREE.Mesh(P.metal, metalMat());
  const grille = new THREE.Mesh(grilleGeometry(), grilleMat());
  for (const m of [shell, dark, metal, grille]) { m.castShadow = true; m.receiveShadow = true; body.add(m); }
  // CRT (per instance canvas) + dirty glass
  const cv = document.createElement('canvas'); cv.width = cv.height = SCR;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const screenMat = new THREE.MeshPhysicalMaterial({ name: 'hm_crt', color: 0x050807, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.8 });
  const scr = new THREE.Mesh(screenGeometry(), screenMat); scr.name = 'screen';
  const glass = new THREE.Mesh(screenGeometry(), glassMat()); glass.position.z = 0.0009; glass.renderOrder = 2;
  body.add(scr, glass);
  // printer jaw + slot LED + mouth anchor
  const jawPivot = new THREE.Group(); jawPivot.position.set(0, SLOT.y - 0.0062, SLOT.z + 0.0012); body.add(jawPivot);
  const jaw = new THREE.Mesh(jawGeometry(), metalMat()); jaw.castShadow = true; jawPivot.add(jaw);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff2a14, emissiveIntensity: 0.1, roughness: 0.4 });
  const led = new THREE.Mesh(cached('hm_ledGeo', () => new THREE.BoxGeometry(0.056, 0.003, 0.001)), ledMat);
  led.position.set(0, SLOT.y, SLOT.z - 0.0006); body.add(led);
  const mouth = new THREE.Object3D(); mouth.name = 'mouth'; mouth.position.copy(SLOT); body.add(mouth);
  // antenna bulb
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x300404, emissive: 0xff3a22, emissiveIntensity: 1.5, roughness: 0.3 });
  const bulb = new THREE.Mesh(cached('hm_bulbGeo', () => new THREE.SphereGeometry(0.0058, 12, 8)), bulbMat);
  { const base = D_ANT.clone().multiplyScalar(R), p1 = base.clone().addScaledVector(D_ANT, 0.05); bulb.position.copy(p1.addScaledVector(dirv(-0.1, 0.6, -0.8), 0.049)); }
  body.add(bulb);
  // rattling hover fan + faint amber downdraft glow
  const fan = new THREE.Group(); fan.position.set(0, FAN_Y, FAN_Z); body.add(fan);
  const duct = new THREE.Mesh(P.fan, metalMat()); duct.castShadow = true; fan.add(duct);
  const blades = new THREE.Mesh(bladeGeometry(), darkMat()); blades.position.y = -0.003; fan.add(blades);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(cached('hm_coneGeo', () => new THREE.CylinderGeometry(0.036, 0.01, 0.1, 20, 1, true)), coneMat);
  cone.position.y = -0.065; cone.renderOrder = 3; fan.add(cone);

  let seed = 7;
  const st = {
    t: 0, expr: 'neutral', talking: false, printing: false, talkOpen: 0, blink: 0, blinkT: 2.5, glitchK: 0, power: 1, ember: 0, bootK: 0,
    gx: 0, gy: 0, tgx: 0, tgy: 0, gazeT: 1, gazeLock: null, bright: 1, fanA: 0, hic: 0, hicT: 6, paintT: 0, dirty: true,
    rnd: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; },
  };
  function setFace(expr) {
    if (!PHOS[expr]) expr = 'neutral';
    if (expr === st.expr) return;
    if (expr === 'boot') st.bootK = 0;
    st.expr = expr; st.glitchK = Math.max(st.glitchK, 0.5); st.dirty = true;
  }
  function setTalking(v) { st.talking = !!v; }
  function setPrinting(v) { st.printing = !!v; }
  function setPower(p) { const was = st.power; st.power = clamp(p, 0, 1); if (was > 0.05 && st.power <= 0.05) st.ember = 1; st.dirty = true; }
  function setGaze(x, y) { st.gazeLock = x == null ? null : [clamp(x, -1, 1), clamp(y, -1, 1)]; }
  function update(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    const t = st.t, pw = st.power, e = st.expr;
    // fan spin-up / stutter ("hiccup": the fan chokes, the ball dips, then catches)
    st.hicT -= dt;
    if (st.hicT <= 0 && pw > 0.5) { st.hic = 1; st.hicT = 4 + st.rnd() * 7; }
    st.hic = Math.max(0, st.hic - dt * 2.2);
    const fanTarget = pw * (1 - st.hic * 0.7);
    st.fanA = damp(st.fanA, fanTarget, pw > st.fanA ? 1.6 : 0.8, dt);
    blades.rotation.y += dt * 46 * st.fanA;
    const rat = st.fanA;
    fan.rotation.x = Math.sin(t * 53) * 0.03 * rat + Math.sin(t * 7.1) * 0.01 * rat;
    fan.rotation.z = Math.sin(t * 41 + 1) * 0.03 * rat;
    fan.position.x = Math.sin(t * 67) * 0.0006 * rat;
    coneMat.opacity = rat * (0.012 + Math.sin(t * 29) * 0.005 + (st.rnd() < 0.05 ? 0.015 : 0));
    // body: an uneven hover with a rattle, a dip on each hiccup, a slight lean into speech
    const amp = 0.012 * pw;
    body.position.y = Math.sin(t * 1.9) * amp + Math.sin(t * 5.3) * amp * 0.25 - Math.sin(st.hic * PI) * 0.012 * pw + Math.sin(t * 61) * 0.0007 * rat;
    body.position.x = Math.sin(t * 73) * 0.0005 * rat;
    body.rotation.z = Math.sin(t * 1.2) * 0.05 * pw + Math.sin(t * 37) * 0.004 * rat + (pw < 0.05 ? 0 : 0);
    body.rotation.x = Math.sin(t * 1.55 + 1) * 0.035 * pw - st.talkOpen * 0.04 + (e === 'sleepy' ? 0.16 : 0) + (e === 'dead' ? 0.3 : 0);
    // the printer lip chatters with speech, hangs a little open while printing
    if (st.talking && pw > 0.2) st.talkOpen = 0.5 + 0.5 * Math.sin(t * 19) * Math.sin(t * 6.7 + 1);
    else st.talkOpen = damp(st.talkOpen, 0, 18, dt);
    jawPivot.rotation.x = -(st.talkOpen * 0.55 + (st.printing ? 0.18 + Math.sin(t * 40) * 0.03 : 0) + (pw < 0.05 ? 0.42 : 0));
    ledMat.emissiveIntensity = pw * (0.08 + st.talkOpen * 3 + (st.printing ? 2.2 + Math.sin(t * 33) * 0.6 : 0));
    bulbMat.emissiveIntensity = pw > 0.05 ? (Math.floor(t * 0.9) % 2 === 0 ? 1.8 : 0.08) * pw : 0;
    // eyes: saccades, blinking, ember / boot / glitch timers
    st.gazeT -= dt;
    if (st.gazeLock) { st.tgx = st.gazeLock[0]; st.tgy = st.gazeLock[1]; }
    else if (e === 'stare') { st.tgx = 0; st.tgy = 0; }
    else if (st.gazeT <= 0) { st.gazeT = 0.5 + st.rnd() * 2.2; const far = st.rnd() < 0.3; st.tgx = far ? (st.rnd() - 0.5) * 2 : (st.rnd() - 0.5) * 0.6; st.tgy = far ? (st.rnd() - 0.5) * 1.4 : (st.rnd() - 0.5) * 0.4; }
    st.gx = damp(st.gx, st.tgx, 22, dt); st.gy = damp(st.gy, st.tgy, 22, dt);
    st.blinkT -= dt;
    if (st.blinkT <= 0) { st.blink = 0.12; st.blinkT = 2 + st.rnd() * 4.5; }
    st.blink -= dt;
    st.glitchK = Math.max(0, st.glitchK - dt * 2);
    st.ember = Math.max(0, st.ember - dt * 0.7);
    if (e === 'boot') st.bootK = Math.min(1, st.bootK + dt * 1.4);
    // CRT flicker: mains hum + the odd brown-out
    st.bright = pw * (0.92 + Math.sin(t * 120) * 0.03 + (st.rnd() < 0.015 ? -0.35 : 0));
    screenMat.emissiveIntensity = 1.75 * (e === 'dead' ? 0.6 : 1);
    // repaint the CRT at ~15 fps (it never sits perfectly still: hum bar, gaze, flicker)
    st.paintT -= dt;
    if ((st.paintT <= 0 && (pw > 0.01 || st.ember > 0)) || st.dirty) {
      st.paintT = 1 / 15; st.dirty = false;
      drawFace(ctx, st, PHOS[e] || PHOS.neutral);
      tex.needsUpdate = true;
    }
  }
  setFace('neutral');
  update(0);
  root.userData.dispose = () => { tex.dispose(); screenMat.dispose(); ledMat.dispose(); bulbMat.dispose(); coneMat.dispose(); };
  return { root, body, setFace, setTalking, setPrinting, setPower, setGaze, update, screen: scr, mouth };
}
