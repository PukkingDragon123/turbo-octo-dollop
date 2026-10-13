// R.O.O.M. — device / set-piece model library.
// Everything is procedural: three.js primitives, rounded boxes, lathes, extrusions, tubes
// and canvas textures (one small texture atlas per model for labels / decals / dials).
//
// Usage:
//   import { DEVICES, buildDevice, scoreDart } from './models_devices.js';
//   const d = buildDevice('vending_snack');   // or DEVICES.vending_snack(opts)
//   scene.add(d.object);  d.parts.coils[3].rotation.z += 0.1; ...
//
// Every builder returns { object, colliders, mass, material, anchors, parts, screens?, params?, halfHeight? }.
// Conventions: meters, Y up, FRONT FACES +Z. Floor devices have their origin at the floor
// under their center; wall devices at the center of their back plane (wall surface, z=0);
// physics props (radio, crates, boxes) at their geometric center (see halfHeight).
//
// Performance: each (model key + opts) is built once into a template (static sub-meshes
// merged per material, one canvas atlas for all of the model's print) and later calls clone
// the template (shared geometry + shared materials). Materials that must be toggled per
// instance (screens, lamps, LEDs, glows) are flagged userData.unique and cloned per instance.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as Mat from '../gfx/materials.js';
import * as Tex from '../gfx/textures.js';
import { labelTexture } from '../gfx/textures.js';
import { RNG } from '../core/rng.js';

const PI = Math.PI, TAU = Math.PI * 2, HP = Math.PI / 2;
const DEG = Math.PI / 180;
const NO = Object.freeze({});
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ===========================================================================
// Materials
// ===========================================================================
const _mc = new Map();
// Mirror chrome / polished steel make blinding highlight bloom under unshadowed point lights:
// devices use satin variants by default.
const SATIN = { chrome: { roughness: 0.3, color: 0xc4c8cc }, steel: { color: 0x8c9094, metalness: 0.9 } };
// Shared material (optionally a cached tinted/overridden variant of a library material)
function M(m, ov) {
  if (m && m.isMaterial) return m;
  if (!ov && SATIN[m]) ov = SATIN[m];
  if (!ov) return Mat.get(m);
  const key = m + JSON.stringify(ov);
  let r = _mc.get(key);
  if (!r) { r = Mat.make(m, ov); r.name = m + '*'; _mc.set(key, r); }
  return r;
}
// Per-instance material (cloned for every built instance)
function own(name, ov) {
  const m = Mat.make(name, ov);
  m.userData.unique = true;
  return m;
}
// Clear glass: black base + additive blending, so only reflections/highlights are added on top
// of what is behind it (alpha-blended 'glass' turns tanks and windows milky under bright lights).
const _clear = new Map();
function CLEAR(o = NO) {
  const key = `${o.env ?? 1.4}|${o.rough ?? 0.06}|${o.side ?? 0}|${o.tint ?? 0}`;
  if (_clear.has(key)) return _clear.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: o.tint ?? 0x000000, emissiveIntensity: 1, roughness: o.rough ?? 0.06, metalness: 0,
    envMapIntensity: o.env ?? 1.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: o.side ?? THREE.FrontSide,
  });
  m.name = 'clear_glass';
  m.userData.noShadow = true;
  _clear.set(key, m);
  return m;
}
const GLASS = () => CLEAR();
const STEEL = () => M('steel', { color: 0x8c9094, metalness: 0.9 });
// Painted sheet metal: scuffed metal texture but paint (not bare metal) in the chips
const PAINT = (color, metalness = 0.25) => M('plastic_white', { color, metalness });
// Worn industrial paint: own canvas albedo (fine mottling, drips, small bare-metal chips and
// scratches) on top of the library metal normal/roughness maps. UVs in meters (1 tile = 1 m).
let _indTex = null;
const _indMats = new Map();
function WORN(color, metalness = 0.45) {
  const key = color + '|' + metalness;
  if (_indMats.has(key)) return _indMats.get(key);
  if (!_indTex) {
    _indTex = labelTexture(512, 512, (c, w, h) => {
      const r = new RNG(99);
      c.fillStyle = '#d4d4d4'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const x = r.next() * w, y = r.next() * h, rad = r.range(10, 70);
        const g = c.createRadialGradient(x, y, 0, x, y, rad);
        const v = r.next() < 0.5 ? '255,255,255' : '40,36,30';
        g.addColorStop(0, `rgba(${v},${r.range(0.03, 0.08)})`); g.addColorStop(1, `rgba(${v},0)`);
        c.fillStyle = g;
        for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) c.fillRect(x - rad + dx, y - rad + dy, rad * 2, rad * 2);
      }
      // grime drips
      for (let i = 0; i < 40; i++) {
        const x = r.next() * w, y = r.next() * h, l = r.range(20, 140);
        const g = c.createLinearGradient(x, y, x, y + l);
        g.addColorStop(0, 'rgba(60,45,30,0.18)'); g.addColorStop(1, 'rgba(60,45,30,0)');
        c.fillStyle = g; c.fillRect(x, y, r.range(1, 4), l);
      }
      // scratches (bright)
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 90; i++) {
        c.lineWidth = r.range(0.5, 1.4);
        const x = r.next() * w, y = r.next() * h, a = r.next() * PI, l = r.range(4, 30);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
      }
      // small chips: bare metal with a dark rim
      for (let i = 0; i < 70; i++) {
        const x = r.next() * w, y = r.next() * h, rad = r.range(1.5, 5);
        c.fillStyle = 'rgba(30,28,26,0.5)'; c.beginPath(); c.ellipse(x, y, rad * 1.3, rad, r.next() * 3, 0, TAU); c.fill();
        c.fillStyle = 'rgba(235,235,232,0.9)'; c.beginPath(); c.ellipse(x, y, rad, rad * 0.7, r.next() * 3, 0, TAU); c.fill();
      }
    });
    _indTex.wrapS = _indTex.wrapT = THREE.RepeatWrapping;
  }
  const t = Tex.get('metal');
  const m = new THREE.MeshStandardMaterial({ color, map: _indTex, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: t.roughnessMap, roughness: 1, metalness });
  m.name = 'worn_' + color.toString(16);
  _indMats.set(key, m);
  return m;
}
const LAMP = {
  red: ['emissive_red'],
  green: ['emissive_green'],
  amber: ['emissive_amber'],
  white: ['emissive_white'],
  blue: ['emissive_white', { color: 0x001433, emissive: 0x3a8cff, emissiveIntensity: 2.6 }],
  orange: ['emissive_amber', { color: 0x331100, emissive: 0xff6a10, emissiveIntensity: 3 }],
  yellow: ['emissive_amber', { color: 0x332a00, emissive: 0xffd21a, emissiveIntensity: 2.6 }],
  cyan: ['emissive_white', { color: 0x002a2a, emissive: 0x30fff0, emissiveIntensity: 2.4 }],
  uv: ['emissive_white', { color: 0x10051f, emissive: 0x9b4dff, emissiveIntensity: 2.6 }],
};
function lampMat(color, ov) {
  const [n, o] = LAMP[color] || LAMP.red;
  return own(n, { ...o, ...ov });
}

// Canvas-texture material (cached per key)
const _cmats = new Map();
function canvasMat(key, w, h, draw, params = {}, repeat = 1, base = null) {
  if (_cmats.has(key)) return _cmats.get(key);
  const tex = labelTexture(w, h, draw);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.generateMipmaps = true;
  const p = { map: tex, roughness: 0.8, metalness: 0, ...params };
  if (base) {
    const t = Tex.get(base);
    if (t.normalMap) p.normalMap = t.normalMap;
    if (t.roughnessMap && p.roughnessMap === undefined) p.roughnessMap = t.roughnessMap;
  }
  const m = new THREE.MeshStandardMaterial(p);
  m.name = key;
  _cmats.set(key, m);
  return m;
}

// Yellow/black diagonal hazard stripes (UVs in meters: one tile = 0.5 m)
function hazardMat(variant = 'yb') {
  const cols = variant === 'rw' ? ['#c8261d', '#ece6d6'] : ['#e8b417', '#151412'];
  return canvasMat('hazard_' + variant, 256, 256, (c, w, h) => {
    c.fillStyle = cols[0];
    c.fillRect(0, 0, w, h);
    c.fillStyle = cols[1];
    const p = w / 2;
    for (let i = -2; i < 4; i++) {
      c.beginPath();
      c.moveTo(i * p, 0); c.lineTo(i * p + p / 2, 0); c.lineTo(i * p + p / 2 - h, h); c.lineTo(i * p - h, h);
      c.closePath(); c.fill();
    }
    grime(c, w, h, 0.5, 7);
  }, { roughness: 0.75, metalness: 0.15, roughnessMap: null }, 2, 'metal');
}

// ===========================================================================
// Canvas drawing helpers
// ===========================================================================
const FONT = {
  sans: '"Arial Black", "Inter Black", "Inter", "Helvetica Neue", Arial, sans-serif',
  bold: '"Arial", "Inter", "Helvetica Neue", "Liberation Sans", sans-serif',
  mono: '"IBM Plex Mono", "DejaVu Sans Mono", "Courier New", monospace',
  vt: '"VT323", "IBM Plex Mono", monospace',
  serif: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
  stencil: '"Stencil", "Arial Black", "Inter Black", "Impact", sans-serif',
};
function txt(c, s, x, y, px, o = NO) {
  const fam = FONT[o.f || 'sans'] || o.f;
  const wt = o.w || (o.f === 'mono' || o.f === 'vt' ? 'bold' : '900');
  c.font = `${o.i ? 'italic ' : ''}${wt} ${px}px ${fam}`;
  if (o.maxW) {
    const mw = c.measureText(s).width;
    if (mw > o.maxW) { px *= o.maxW / mw; c.font = `${o.i ? 'italic ' : ''}${wt} ${px}px ${fam}`; }
  }
  c.textAlign = o.al || 'center';
  c.textBaseline = o.bl || 'middle';
  if (o.stroke) { c.lineWidth = o.lw || px * 0.12; c.strokeStyle = o.stroke; c.lineJoin = 'round'; c.strokeText(s, x, y); }
  c.fillStyle = o.col || '#111';
  c.fillText(s, x, y);
  return px;
}
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
// Dirt, scuffs and speckles (keeps alpha where already painted)
function grime(c, w, h, amt = 1, seed = 1) {
  const r = new RNG(seed);
  c.save();
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 40 * amt; i++) {
    const x = r.next() * w, y = r.next() * h, rad = r.range(2, Math.max(4, w * 0.08));
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(40,30,20,${0.12 * r.next()})`);
    g.addColorStop(1, 'rgba(40,30,20,0)');
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  c.strokeStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 25 * amt; i++) {
    c.lineWidth = r.range(0.5, 1.5);
    const x = r.next() * w, y = r.next() * h, a = r.next() * PI, l = r.range(3, w * 0.12);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  c.restore();
}
// The R.O.O.M. corporate mark: isometric cube outline + wordmark
function drawLogo(c, x, y, s, col = '#111', o = NO) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = col; c.fillStyle = col;
  c.lineWidth = s * 0.07; c.lineJoin = 'round';
  const k = s * 0.42;
  const cx = o.text === false ? 0 : -s * 0.95;
  c.beginPath();
  c.moveTo(cx, -k); c.lineTo(cx + k * 0.87, -k / 2); c.lineTo(cx + k * 0.87, k / 2); c.lineTo(cx, k);
  c.lineTo(cx - k * 0.87, k / 2); c.lineTo(cx - k * 0.87, -k / 2); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(cx - k * 0.87, -k / 2); c.lineTo(cx, 0); c.lineTo(cx + k * 0.87, -k / 2); c.moveTo(cx, 0); c.lineTo(cx, k); c.stroke();
  c.beginPath(); c.arc(cx, -k * 0.05, k * 0.16, 0, TAU); c.fill();
  if (o.text !== false) txt(c, 'R.O.O.M.', -s * 0.35, 0, s * 0.62, { col, al: 'left', f: o.f || 'sans' });
  c.restore();
}
// Cute chubby clone mascot (yellow hazmat suit, black visor)
function drawClone(c, x, y, s, o = NO) {
  c.save();
  c.translate(x, y);
  const yel = o.col || '#f2c418', ink = o.ink || '#1a1a1a';
  c.lineWidth = s * 0.045; c.strokeStyle = ink;
  // body
  c.fillStyle = yel;
  c.beginPath(); c.ellipse(0, s * 0.18, s * 0.3, s * 0.3, 0, 0, TAU); c.fill(); c.stroke();
  // arms
  c.beginPath(); c.ellipse(-s * 0.3, s * 0.2, s * 0.08, s * 0.14, 0.5, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(s * 0.3, s * 0.12, s * 0.08, s * 0.14, o.wave ? -2.2 : -0.5, 0, TAU); c.fill(); c.stroke();
  // head / hood
  c.beginPath(); c.ellipse(0, -s * 0.2, s * 0.27, s * 0.25, 0, 0, TAU); c.fill(); c.stroke();
  // visor
  c.fillStyle = '#1b2228';
  rrect(c, -s * 0.18, -s * 0.3, s * 0.36, s * 0.2, s * 0.09); c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(-s * 0.07, -s * 0.2, s * 0.03, 0, TAU); c.arc(s * 0.07, -s * 0.2, s * 0.03, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.beginPath(); c.ellipse(-s * 0.1, -s * 0.27, s * 0.06, s * 0.02, -0.2, 0, TAU); c.fill();
  // belt / badge
  c.fillStyle = ink; c.fillRect(-s * 0.28, s * 0.22, s * 0.56, s * 0.05);
  c.restore();
}
function hazardTri(c, x, y, s, sym = '!') {
  c.save();
  c.translate(x, y);
  c.fillStyle = '#f2c418'; c.strokeStyle = '#111'; c.lineWidth = s * 0.08; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(0, -s * 0.5); c.lineTo(s * 0.55, s * 0.45); c.lineTo(-s * 0.55, s * 0.45); c.closePath(); c.fill(); c.stroke();
  if (sym === 'bolt') {
    c.fillStyle = '#111';
    c.beginPath(); c.moveTo(s * 0.06, -s * 0.28); c.lineTo(-s * 0.14, s * 0.08); c.lineTo(s * 0.0, s * 0.06); c.lineTo(-s * 0.08, s * 0.36);
    c.lineTo(s * 0.16, -s * 0.02); c.lineTo(s * 0.02, 0); c.closePath(); c.fill();
  } else if (sym === 'rad') {
    c.fillStyle = '#111';
    c.beginPath(); c.arc(0, s * 0.1, s * 0.05, 0, TAU); c.fill();
    for (let i = 0; i < 3; i++) {
      const a = -HP + i * TAU / 3;
      c.beginPath(); c.moveTo(0, s * 0.1); c.arc(0, s * 0.1, s * 0.26, a - 0.5, a + 0.5); c.closePath(); c.fill();
    }
    c.fillStyle = '#f2c418'; c.beginPath(); c.arc(0, s * 0.1, s * 0.08, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(0, s * 0.1, s * 0.05, 0, TAU); c.fill();
  } else {
    txt(c, sym, 0, s * 0.12, s * 0.55, { col: '#111' });
  }
  c.restore();
}
function drawPerforation(c, w, h, step, rad, bg = '#222', hole = '#050505') {
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = hole;
  for (let y = step / 2; y < h; y += step) for (let x = step / 2 + ((y / step) % 2 ? step / 2 : 0); x < w; x += step) {
    c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
  }
}
// Gauge dial face (270° sweep, value 0 at lower-left, 1 at lower-right)
function drawDial(c, w, h, o = NO) {
  const cx = w / 2, cy = h / 2, R = w / 2;
  c.fillStyle = o.bg || '#efe8d4';
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  const g = c.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(1, 'rgba(60,40,10,0.25)');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  const ang = (v) => (v - 0.5) * 1.5 * PI; // clockwise from up
  const P = (v, r) => [cx + Math.sin(ang(v)) * r, cy - Math.cos(ang(v)) * r];
  if (o.red !== undefined) {
    c.strokeStyle = '#c0281c'; c.lineWidth = R * 0.12;
    c.beginPath(); c.arc(cx, cy, R * 0.78, ang(o.red) - HP, ang(1) - HP); c.stroke();
  }
  if (o.green) {
    c.strokeStyle = '#2f8a3a'; c.lineWidth = R * 0.12;
    c.beginPath(); c.arc(cx, cy, R * 0.78, ang(o.green[0]) - HP, ang(o.green[1]) - HP); c.stroke();
  }
  c.strokeStyle = o.ink || '#151515';
  const n = o.ticks || 10;
  for (let i = 0; i <= n * 5; i++) {
    const v = i / (n * 5), major = i % 5 === 0;
    const [x0, y0] = P(v, R * (major ? 0.66 : 0.74)), [x1, y1] = P(v, R * 0.86);
    c.lineWidth = major ? R * 0.045 : R * 0.02;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  if (o.nums !== false) {
    const lab = o.labels || Array.from({ length: n / 2 + 1 }, (_, i) => String(Math.round((o.max ?? 10) * i / (n / 2))));
    lab.forEach((s, i) => { const [x, y] = P(i / (lab.length - 1), R * 0.5); txt(c, s, x, y, R * 0.16, { col: o.ink || '#151515', f: 'bold', w: 'bold' }); });
  }
  if (o.label) txt(c, o.label, cx, cy + R * 0.42, R * 0.17, { col: o.ink || '#151515', f: 'bold', w: 'bold', maxW: R });
  if (o.brand !== false) txt(c, o.brand || 'R.O.O.M.', cx, cy - R * 0.25, R * 0.11, { col: '#555', f: 'bold', w: 'bold' });
}

// ===========================================================================
// Geometry helpers
// ===========================================================================
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _v = new THREE.Vector3(), _sc = new THREE.Vector3();
function localMatrix(x, y, z, rot, s, out = _m4) {
  if (rot) _eu.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, rot[3] || 'XYZ'); else _eu.set(0, 0, 0);
  _q.setFromEuler(_eu);
  if (s === undefined) _sc.set(1, 1, 1); else if (typeof s === 'number') _sc.setScalar(s); else _sc.fromArray(s);
  return out.compose(_v.set(x, y, z), _q, _sc);
}
// Planar box-projection UVs in meters (texture sticks to the part, no stretching)
function boxUV(g, s = 1) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ax >= ay && ax >= az) { u = -p.getZ(i) * Math.sign(nx); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = -p.getZ(i) * Math.sign(ny); }
    else { u = p.getX(i) * Math.sign(nz); v = p.getY(i); }
    uv.setXY(i, u * s, v * s);
  }
  return g;
}
function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
function axisRot(g, axis) {
  if (axis === 'x') g.rotateZ(-HP);
  else if (axis === 'z') g.rotateX(HP);
  else if (axis === '-z') g.rotateX(-HP);
  else if (axis === '-x') g.rotateZ(HP);
  return g;
}
function gBox(w, h, d, o = NO) {
  const g = o.r ? new RoundedBoxGeometry(w, h, d, o.seg ?? (o.r >= 0.02 ? 2 : 1), o.r) : new THREE.BoxGeometry(w, h, d);
  if (o.uv !== false) boxUV(g, o.uv || 1);
  return g;
}
// Box whose -Z face is scaled (CRT backs, hoppers, tapered housings)
function gTaper(w, h, d, sx, sy, o = NO) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * sx); p.setY(i, p.getY(i) * sy + (o.dy || 0)); }
  g.computeVertexNormals();
  // BoxGeometry has split faces so recomputed normals stay flat per face
  if (o.uv !== false) boxUV(g, o.uv || 1);
  return g;
}
function gCyl(r, h, o = NO) {
  const rb = o.r2 ?? r;
  const g = new THREE.CylinderGeometry(r, rb, h, o.seg ?? 20, o.hs ?? 1, !!o.open, o.t0 ?? 0, o.tl ?? TAU);
  if (o.uv !== false) {
    const n = g.attributes.normal, uv = g.attributes.uv, p = g.attributes.position, circ = TAU * Math.max(r, rb), s = o.uv || 1;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.97) uv.setXY(i, p.getX(i) * s, p.getZ(i) * s);
      else uv.setXY(i, uv.getX(i) * circ * s, uv.getY(i) * h * s);
    }
  }
  return axisRot(g, o.axis);
}
function gSph(r, o = NO) {
  const g = new THREE.SphereGeometry(r, o.ws ?? 18, o.hs ?? 12, o.p0 ?? 0, o.pl ?? TAU, o.t0 ?? 0, o.tl ?? PI);
  if (o.uv !== false) scaleUV(g, TAU * r * (o.uv || 1), PI * r * (o.uv || 1));
  return axisRot(g, o.axis);
}
// Torus in the XY plane (axis Z); axis:'y' lays it flat
function gTor(R, t, o = NO) {
  const g = new THREE.TorusGeometry(R, t, o.rs ?? 8, o.ts ?? 28, o.arc ?? TAU);
  if (o.uv !== false) scaleUV(g, TAU * R, TAU * t);
  if (o.axis === 'y') g.rotateX(HP);
  else if (o.axis === 'x') g.rotateY(HP);
  return g;
}
// Lathe from [[r, y], ...] around Y
function gLathe(pts, o = NO) {
  const v = pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.00001), y));
  const g = new THREE.LatheGeometry(v, o.seg ?? 24, o.p0 ?? 0, o.pl ?? TAU);
  if (o.uv !== false) {
    let len = 0, mr = 0;
    for (let i = 1; i < v.length; i++) len += v[i].distanceTo(v[i - 1]);
    for (const p of v) mr = Math.max(mr, p.x);
    scaleUV(g, TAU * mr, len);
  }
  return axisRot(g, o.axis);
}
// Degenerate (collinear) triangles get zero normals, which turn into NaN pixels in the
// shader on slivers and then smear across the screen through bloom: give them a unit normal.
function fixNormals(g) {
  const n = g.attributes.normal;
  if (!n) return g;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    const l = Math.hypot(x, y, z);
    if (!(l > 1e-6)) n.setXYZ(i, 0, 0, 1);
    else if (Math.abs(l - 1) > 1e-3) n.setXYZ(i, x / l, y / l, z / l);
  }
  return g;
}
function gExt(shape, depth, o = NO) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: o.cs ?? 5,
    bevelEnabled: !!o.bev, bevelThickness: o.bev || 0, bevelSize: o.bevS ?? o.bev ?? 0, bevelSegments: o.bseg ?? 1,
  });
  fixNormals(g);
  if (o.cz) g.translate(0, 0, -depth / 2);
  if (o.uv && o.uv !== 1) scaleUV(g, o.uv, o.uv);
  return g;
}
function gTube(pts, r, o = NO) {
  const curve = pts instanceof THREE.Curve ? pts : new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V3(...p))), !!o.closed, o.ct || 'catmullrom', o.tension ?? 0.5);
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, o.ts ?? Math.max(4, Math.ceil(len * (o.density ?? 30))), r, o.rs ?? 6, !!o.closed);
  if (o.uv !== false) scaleUV(g, len, TAU * r);
  return g;
}
// Straight segment polyline -> tube with sharp-ish corners (pipes): rounded via small fillets
function pipePath(pts, bend = 0.06) {
  const path = new THREE.CurvePath();
  const P = pts.map((p) => V3(...p));
  let prev = P[0].clone();
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if (i < P.length - 1) {
      const c = P[i + 1];
      const d1 = b.clone().sub(a), d2 = c.clone().sub(b);
      const r = Math.min(bend, d1.length() / 2, d2.length() / 2);
      const e1 = b.clone().addScaledVector(d1.normalize(), -r), e2 = b.clone().addScaledVector(d2.normalize(), r);
      path.add(new THREE.LineCurve3(prev, e1));
      path.add(new THREE.QuadraticBezierCurve3(e1, b.clone(), e2));
      prev = e2;
    } else path.add(new THREE.LineCurve3(prev, b.clone()));
  }
  return path;
}
function gPlane(w, h, o = NO) {
  const g = new THREE.PlaneGeometry(w, h, o.ws ?? 1, o.hs ?? 1);
  if (o.uv !== false) scaleUV(g, w * (o.uv || 1), h * (o.uv || 1));
  return g;
}
function gDisc(r, o = NO) {
  const g = new THREE.CircleGeometry(r, o.seg ?? 24, o.t0 ?? 0, o.tl ?? TAU);
  if (o.uv !== false && !o.keepUV) scaleUV(g, 2 * r, 2 * r);
  return g;
}
// 2D shapes
function rrShape(w, h, r, cx = 0, cy = 0, path = null) {
  const s = path || new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function rrHole(w, h, r, cx = 0, cy = 0) { return rrShape(w, h, r, cx, cy, new THREE.Path()); }
function frameShape(w, h, r, iw, ih, ir, icx = 0, icy = 0) {
  const s = rrShape(w, h, r);
  s.holes.push(rrHole(iw, ih, ir, icx, icy));
  return s;
}
function circleShape(r, holeR = 0) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, TAU, false);
  if (holeR) { const p = new THREE.Path(); p.absarc(0, 0, holeR, 0, TAU, true); s.holes.push(p); }
  return s;
}
// Remap 0..1 UVs into an atlas region
function mapUV(g, r, flipU = false) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i);
    if (flipU) u = 1 - u;
    uv.setXY(i, r.u0 + u * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  }
  return g;
}
// CRT glass: pillow-bulged plane (UVs 0..1)
function gCRT(w, h, bulge = 0.01) {
  const g = new THREE.PlaneGeometry(w, h, 12, 9);
  if (bulge) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = (2 * p.getX(i)) / w, y = (2 * p.getY(i)) / h;
      p.setZ(i, bulge * (1 - 0.55 * x * x - 0.45 * y * y - 0.2 * x * x * y * y));
    }
    g.computeVertexNormals();
  }
  return g;
}
// Annular-sector slab around the Y axis (curved desks, counters); angle 0 = +Z, increases toward +X
function gArcSlab(r0, r1, a0, a1, y0, y1, seg = 24, o = NO) {
  const pos = [], nor = [], uv = [], idx = [];
  const quad = (A, B, C, D, n, uvs) => {
    const b = pos.length / 3;
    for (const [p, t] of [[A, uvs[0]], [B, uvs[1]], [C, uvs[2]], [D, uvs[3]]]) { pos.push(...p); nor.push(...(typeof n === 'function' ? n(p) : n)); uv.push(...t); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const P = (r, a, y) => [r * Math.sin(a), y, r * Math.cos(a)];
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
    const s0 = r1 * t0, s1 = r1 * t1, q0 = r0 * t0, q1 = r0 * t1;
    // outer (normal outward)
    const nO = (p) => { const l = Math.hypot(p[0], p[2]); return [p[0] / l, 0, p[2] / l]; };
    quad(P(r1, t0, y0), P(r1, t1, y0), P(r1, t1, y1), P(r1, t0, y1), nO, [[s0, y0], [s1, y0], [s1, y1], [s0, y1]]);
    if (!o.noInner) {
      const nI = (p) => { const l = Math.hypot(p[0], p[2]); return [-p[0] / l, 0, -p[2] / l]; };
      quad(P(r0, t1, y0), P(r0, t0, y0), P(r0, t0, y1), P(r0, t1, y1), nI, [[-q1, y0], [-q0, y0], [-q0, y1], [-q1, y1]]);
    }
    // top & bottom
    const tp = (r, a) => [r * Math.sin(a), r * Math.cos(a)];
    const [a, b, c, d] = [P(r0, t0, y1), P(r1, t0, y1), P(r1, t1, y1), P(r0, t1, y1)];
    quad(a, b, c, d, [0, 1, 0], [tp(r0, t0), tp(r1, t0), tp(r1, t1), tp(r0, t1)]);
    if (!o.noBottom) {
      const [e, f, g2, h] = [P(r0, t1, y0), P(r1, t1, y0), P(r1, t0, y0), P(r0, t0, y0)];
      quad(e, f, g2, h, [0, -1, 0], [tp(r0, t1), tp(r1, t1), tp(r1, t0), tp(r0, t0)]);
    }
  }
  // end caps
  for (const [a, sgn] of [[a0, -1], [a1, 1]]) {
    const n = [Math.cos(a) * sgn, 0, -Math.sin(a) * sgn];
    const A = P(r0, a, y0), B = P(r1, a, y0), Cc = P(r1, a, y1), D = P(r0, a, y1);
    if (sgn > 0) quad(A, B, Cc, D, n, [[r0, y0], [r1, y0], [r1, y1], [r0, y1]]);
    else quad(B, A, D, Cc, n, [[r1, y0], [r0, y0], [r0, y1], [r1, y1]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// Helix (vending coil), axis Z, from z0 to z1
class HelixCurve extends THREE.Curve {
  constructor(r, z0, z1, turns, lead = 0) { super(); Object.assign(this, { r, z0, z1, turns, lead }); }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * this.turns * TAU;
    return out.set(Math.cos(a) * this.r, Math.sin(a) * this.r, this.z1 - (this.z1 - this.z0) * t);
  }
}

function prepGeo(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  fixNormals(g);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.clearGroups();
  g.morphAttributes = {};
  return g;
}
function shadowFlags(m, big = true) {
  const mt = m.material;
  const tr = mt.transparent || mt.userData.noShadow;
  m.castShadow = !tr && big;
  m.receiveShadow = !mt.transparent;
}

// ===========================================================================
// Texture atlas (all of one model's labels, decals, dials and package art)
// ===========================================================================
class Atlas {
  constructor(w = 512, h = 512) {
    this.w = w; this.h = h;
    this.tex = labelTexture(w, h, (c) => c.clearRect(0, 0, w, h));
    this.tex.anisotropy = 8;
    this.ctx = this.tex.userData.ctx;
    this.sky = [{ x: 0, w: w, y: 0 }]; this.pad = 4; this.used = 0;
  }
  // skyline bottom-left packer
  _alloc(pw, ph) {
    const sk = this.sky;
    let bestY = Infinity, bestX = 0;
    for (let i = 0; i < sk.length; i++) {
      const x = sk[i].x;
      if (x + pw > this.w) break;
      let y = 0, j = i, rem = pw;
      while (rem > 0 && j < sk.length) { y = Math.max(y, sk[j].y); rem -= sk[j].w; j++; }
      if (rem > 0) continue;
      if (y < bestY) { bestY = y; bestX = x; }
    }
    if (bestY === Infinity) bestY = this.used;
    const X0 = bestX, X1 = Math.min(this.w, bestX + pw + this.pad), Y = bestY + ph + this.pad;
    const out = [];
    for (const s of sk) {
      const s0 = s.x, s1 = s.x + s.w;
      if (s1 <= X0 || s0 >= X1) { out.push(s); continue; }
      if (s0 < X0) out.push({ x: s0, w: X0 - s0, y: s.y });
      if (s1 > X1) out.push({ x: X1, w: s1 - X1, y: s.y });
    }
    out.push({ x: X0, w: X1 - X0, y: Y });
    out.sort((p, q) => p.x - q.x);
    this.sky = out;
    this.used = Math.max(this.used, Y);
    return [bestX, bestY];
  }
  add(pw, ph, draw) {
    pw = Math.ceil(pw); ph = Math.ceil(ph);
    const [px, py] = this._alloc(pw, ph);
    if (py + ph > this.h) console.warn(`[models_devices] atlas overflow (${this.w}x${this.h})`);
    const c = this.ctx;
    c.save(); c.translate(px, py); c.beginPath(); c.rect(0, 0, pw, ph); c.clip();
    draw(c, pw, ph);
    c.restore();
    const e = 0.5;
    return { u0: (px + e) / this.w, u1: (px + pw - e) / this.w, v0: 1 - (py + ph - e) / this.h, v1: 1 - (py + e) / this.h, pw, ph };
  }
  // solid color swatch region
  solid(col) {
    this._sol = this._sol || {};
    if (!this._sol[col]) this._sol[col] = this.add(8, 8, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); });
    return this._sol[col];
  }
}

// ===========================================================================
// Screens (CanvasTexture placeholders the game replaces)
// ===========================================================================
const _ph = new Map();
function placeholderTex(style, aspect, text = '') {
  const key = `${style}|${aspect.toFixed(3)}|${text}`;
  if (_ph.has(key)) return _ph.get(key);
  const W = aspect >= 1 ? 512 : Math.round(512 * aspect);
  const H = aspect >= 1 ? Math.max(32, Math.round(512 / aspect)) : 512;
  const t = labelTexture(W, H, (c, w, h) => {
    const lines = String(text).split('\n');
    const S = Math.min(w, h);
    if (style === 'paper' || style === 'card') {
      c.fillStyle = '#efe9d8'; c.fillRect(0, 0, w, h);
      lines.forEach((l, i) => txt(c, l, w / 2, h * (0.5 + (i - (lines.length - 1) / 2) * 0.32), S * 0.26, { col: '#1a1a1a', f: 'mono', maxW: w * 0.9 }));
      grime(c, w, h, 0.3, 3);
    } else if (style === 'photo') {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#6c7f93'); g.addColorStop(1, '#2d3540');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      drawClone(c, w / 2, h * 0.6, w * 0.8);
      txt(c, text || 'PHOTO', w / 2, h * 0.08, w * 0.08, { col: '#fff', f: 'mono' });
    } else if (style === 'poster') {
      c.fillStyle = '#0d0d0f'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#d9d2c0'; c.lineWidth = S * 0.012; c.strokeRect(w * 0.08, h * 0.06, w * 0.84, h * 0.6);
      const g = c.createLinearGradient(0, h * 0.06, 0, h * 0.66);
      g.addColorStop(0, '#3d5a7a'); g.addColorStop(1, '#d9a24a');
      c.fillStyle = g; c.fillRect(w * 0.085, h * 0.065, w * 0.83, h * 0.59);
      c.fillStyle = 'rgba(0,0,0,0.85)';
      for (let i = 0; i < 4; i++) { c.save(); c.translate(w * (0.3 + i * 0.14), h * 0.55); drawClone(c, 0, 0, w * 0.16, { ink: '#000', col: '#111' }); c.restore(); }
      txt(c, lines[0] || 'TEAMWORK', w / 2, h * 0.75, S * 0.1, { col: '#efe6cf', f: 'serif', w: 'normal', maxW: w * 0.84 });
      txt(c, lines[1] || 'Alone you are disposable. Together, slightly less so.', w / 2, h * 0.84, S * 0.035, { col: '#cfc6b0', f: 'serif', w: 'normal', i: true, maxW: w * 0.84 });
      drawLogo(c, w / 2, h * 0.93, S * 0.04, '#9a917c');
    } else if (style === 'brass') {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f6dc94'); g.addColorStop(0.45, '#c9a24e'); g.addColorStop(1, '#8a6a28');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(60,40,8,0.6)'; c.lineWidth = Math.max(2, h * 0.04); c.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
      txt(c, lines[0] || 'NAME', w / 2, h / 2 + 1, h * 0.5, { col: '#2e1e04', f: 'serif', maxW: w * 0.88 });
    } else if (style === 'led') {
      c.fillStyle = '#120202'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,40,20,0.06)';
      for (let x = 0; x < w; x += 6) for (let y = 0; y < h; y += 6) c.fillRect(x, y, 4, 4);
      txt(c, lines[0] || '88:88', w / 2, h / 2, h * 0.7, { col: '#ff3a1e', f: 'vt', maxW: w * 0.9 });
    } else if (style === 'lcd') {
      c.fillStyle = '#8f9a6a'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(w * 0.03, h * 0.08, w * 0.94, h * 0.84);
      lines.forEach((l, i) => txt(c, l, w / 2, h * (0.5 + (i - (lines.length - 1) / 2) * 0.4), h * 0.34 / Math.max(1, lines.length * 0.7), { col: '#1d2410', f: 'vt', maxW: w * 0.9 }));
    } else if (style === 'scope') {
      c.fillStyle = '#031208'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(80,255,140,0.18)'; c.lineWidth = 1;
      for (let i = 1; i < 10; i++) { c.beginPath(); c.moveTo((w * i) / 10, 0); c.lineTo((w * i) / 10, h); c.stroke(); }
      for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(0, (h * i) / 8); c.lineTo(w, (h * i) / 8); c.stroke(); }
      c.strokeStyle = '#6dffa0'; c.lineWidth = S * 0.012; c.shadowColor = '#6dffa0'; c.shadowBlur = 8;
      c.beginPath();
      for (let x = 0; x <= w; x += 2) { const t = x / w; const y = h / 2 + Math.sin(t * 22) * h * 0.18 * Math.sin(t * 3.1) + (t > 0.45 && t < 0.5 ? -h * 0.3 : 0); x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke(); c.shadowBlur = 0;
    } else if (style === 'sign') {
      c.fillStyle = '#1a0000'; c.fillRect(0, 0, w, h);
      txt(c, lines[0] || 'EXIT', w / 2, h * 0.52, h * 0.72, { col: '#ff3322', f: 'sans', maxW: w * 0.92 });
    } else {
      // CRT terminal: phosphor text on dark glass (style: 'crt' green, 'amber', 'blue')
      const pal = style === 'amber' ? ['#100800', '#ffb02a'] : style === 'blue' ? ['#0b1a5c', '#d8e4ff'] : ['#020c05', '#5dff8a'];
      c.fillStyle = pal[0]; c.fillRect(0, 0, w, h);
      const g = c.createRadialGradient(w / 2, h / 2, S * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const L = lines.length ? lines : ['R.O.O.M.'];
      const px = Math.min(h / (L.length + 2.5), w / 14);
      c.shadowColor = pal[1]; c.shadowBlur = px * 0.4;
      L.forEach((l, i) => txt(c, l, w * 0.07, px * (1.4 + i * 1.15), px, { col: pal[1], f: 'vt', al: 'left', maxW: w * 0.86 }));
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
    }
  });
  _ph.set(key, t);
  return t;
}
const PRINTED = new Set(['paper', 'card', 'photo', 'poster', 'brass']);
const SCREEN_GLOW = { brass: 0.06, crt: 1.2, amber: 1.2, blue: 1.1, scope: 1.3, led: 1.4, lcd: 0.55, sign: 1.8, paper: 0.12, card: 0.1, photo: 0.15, poster: 0.12 };

// ===========================================================================
// Kit: builder that merges static geometry per (target, material)
// ===========================================================================
class Kit {
  constructor(name) {
    this.name = name;
    this.root = new THREE.Group();
    this.root.name = name;
    this.tgt = this.root;
    this.cur = new THREE.Matrix4();
    this.stack = [];
    this.buckets = new Map();
    this.parts = {};
    this.anchors = {};
    this.screens = {};
    this.colliders = [];
    this.params = {};
    this.atlas = null;
    this._amats = new Map();
  }
  // --- frames ---
  push(x = 0, y = 0, z = 0, rot, s) {
    this.stack.push(this.cur);
    this.cur = this.cur.clone().multiply(localMatrix(x, y, z, rot, s, new THREE.Matrix4()));
    return this;
  }
  pop() { this.cur = this.stack.pop(); return this; }
  inside(obj, fn) {
    const save = [this.tgt, this.cur, this.stack];
    this.tgt = obj; this.cur = new THREE.Matrix4(); this.stack = [];
    try { fn(obj); } finally { [this.tgt, this.cur, this.stack] = save; }
    return obj;
  }
  // transform a local point by the current frame (for anchors)
  pt(x, y, z) {
    const v = V3(x, y, z);
    if (this.stack.length) v.applyMatrix4(this.cur);
    return v;
  }
  // --- core ---
  put(mat, g, x = 0, y = 0, z = 0, o = NO) {
    if (o.sep) return this.mesh(mat, g, x, y, z, o);
    g.applyMatrix4(localMatrix(x, y, z, o.rot, o.s));
    const target = o.to || this.tgt;
    if (this.stack.length && target === this.tgt) g.applyMatrix4(this.cur);
    const material = M(mat, o.ov);
    let tb = this.buckets.get(target);
    if (!tb) this.buckets.set(target, (tb = new Map()));
    let list = tb.get(material);
    if (!list) tb.set(material, (list = []));
    list.push(g);
    return g;
  }
  _place(obj, x, y, z, o) {
    obj.position.set(x, y, z);
    if (o.rot) obj.rotation.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0, o.rot[3] || 'XYZ');
    if (o.s !== undefined) typeof o.s === 'number' ? obj.scale.setScalar(o.s) : obj.scale.fromArray(o.s);
    if (o.name) obj.name = o.name;
    const parent = o.to || this.tgt;
    if (this.stack.length && parent === this.tgt) obj.applyMatrix4(this.cur);
    parent.add(obj);
    return obj;
  }
  mesh(mat, g, x = 0, y = 0, z = 0, o = NO) {
    const m = new THREE.Mesh(g, M(mat, o.ov));
    shadowFlags(m, o.shadow !== false);
    return this._place(m, x, y, z, o);
  }
  grp(x = 0, y = 0, z = 0, o = NO) { return this._place(new THREE.Group(), x, y, z, o); }
  box(mat, w, h, d, x, y, z, o = NO) { return this.put(mat, gBox(w, h, d, o), x, y, z, o); }
  taper(mat, w, h, d, sx, sy, x, y, z, o = NO) { return this.put(mat, gTaper(w, h, d, sx, sy, o), x, y, z, o); }
  cyl(mat, r, h, x, y, z, o = NO) { return this.put(mat, gCyl(r, h, o), x, y, z, o); }
  sph(mat, r, x, y, z, o = NO) { return this.put(mat, gSph(r, o), x, y, z, o); }
  tor(mat, R, t, x, y, z, o = NO) { return this.put(mat, gTor(R, t, o), x, y, z, o); }
  lathe(mat, pts, x, y, z, o = NO) { return this.put(mat, gLathe(pts, o), x, y, z, o); }
  ext(mat, shape, depth, x, y, z, o = NO) { return this.put(mat, gExt(shape, depth, o), x, y, z, o); }
  tube(mat, pts, r, o = NO) { return this.put(mat, gTube(pts, r, o), 0, 0, 0, o); }
  plane(mat, w, h, x, y, z, o = NO) { return this.put(mat, gPlane(w, h, o), x, y, z, o); }
  disc(mat, r, x, y, z, o = NO) { return this.put(mat, gDisc(r, o), x, y, z, o); }
  // hex bolt heads; pts: [[x,y,z],...]; axis: direction the head faces
  bolts(pts, o = NO) {
    const r = o.r ?? 0.007;
    for (const p of pts) this.cyl(o.mat || 'steel', r, r * 0.7, p[0], p[1], p[2], { seg: 6, axis: o.axis || 'z', uv: false, rot: o.rot });
  }
  // --- atlas / labels ---
  useAtlas(w = 512, h = 512) {
    this.atlas = new Atlas(w, h);
    this.atlasMat = new THREE.MeshStandardMaterial({ map: this.atlas.tex, roughness: 0.6, metalness: 0, alphaTest: 0.35 });
    this.atlasMat.name = this.name + '_atlas';
    return this.atlas;
  }
  amat(o = NO) {
    if (o.mat) return o.mat;
    if (!o.glow && !o.metal && !o.rough) return this.atlasMat;
    const key = `${o.glow || 0}|${o.metal || 0}|${o.rough || 0}|${o.own ? Math.random() : ''}`;
    if (!o.own && this._amats.has(key)) return this._amats.get(key);
    const m = new THREE.MeshStandardMaterial({ map: this.atlas.tex, roughness: o.rough ?? 0.5, metalness: o.metal || 0, alphaTest: 0.35 });
    if (o.glow) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = this.atlas.tex; m.emissiveIntensity = o.glow; m.userData.noShadow = true; }
    if (o.own) m.userData.unique = true; else this._amats.set(key, m);
    return m;
  }
  // flat label quad (front +Z)
  label(reg, w, h, x, y, z, o = NO) {
    const g = mapUV(new THREE.PlaneGeometry(w, h), reg, o.flipU);
    if (o.own) return this.mesh(this.amat(o), g, x, y, z, o);
    return this.put(this.amat(o), g, x, y, z, o);
  }
  // disc label (dials)
  dlabel(reg, r, x, y, z, o = NO) {
    const g = mapUV(new THREE.CircleGeometry(r, o.seg ?? 28), reg);
    return this.put(this.amat(o), g, x, y, z, o);
  }
  // curved label wrapped on a cylinder (axis Y) of radius r, centered at angle a (0 = +Z)
  clabel(reg, r, h, arc, x, y, z, o = NO) {
    const a = o.a ?? 0;
    const g = mapUV(new THREE.CylinderGeometry(r, r, h, o.seg ?? 16, 1, true, a - arc / 2, arc), reg);
    return this.put(this.amat(o), g, x, y, z, o);
  }
  // box with atlas regions per face: {px,nx,py,ny,pz,nz, side, all}
  labelBox(faces, w, h, d, x, y, z, o = NO) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    for (let f = 0; f < 6; f++) {
      const r = faces[order[f]] || faces.side || faces.all;
      for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    }
    return this.put(this.amat(o), g, x, y, z, o);
  }
  // --- screens ---
  screen(name, w, h, x, y, z, o = NO) {
    const style = o.style || 'crt';
    const aspect = o.aspect ?? w / h;
    const tex = placeholderTex(style, aspect, o.text ?? '');
    const m = new THREE.MeshStandardMaterial({
      color: o.color ?? (PRINTED.has(style) ? 0xffffff : 0x3a3a3a), map: tex, emissiveMap: tex, emissive: 0xffffff,
      emissiveIntensity: o.glow ?? SCREEN_GLOW[style] ?? 1.2, roughness: o.rough ?? 0.2, metalness: o.metal ?? 0,
    });
    m.name = 'screen_' + name;
    m.userData.unique = true;
    m.userData.noShadow = true;
    const g = o.disc ? new THREE.CircleGeometry(w / 2, 32) : gCRT(w, h, o.bulge ?? 0);
    const mesh = this.mesh(m, g, x, y, z, { ...o, name: 'screen_' + name, shadow: false });
    mesh.castShadow = false;
    this.screens[name] = { mesh, aspect };
    return mesh;
  }
  collide(c) { this.colliders.push(c); return c; }
  // --- finish ---
  done(extra = {}) {
    for (const [target, tb] of this.buckets) {
      for (const [mat, list] of tb) {
        const geo = list.length === 1 ? prepGeo(list[0]) : mergeGeometries(list.map(prepGeo), false);
        if (!geo) { console.warn('[models_devices] merge failed', this.name, mat.name); continue; }
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `${target === this.root ? this.name : target.name || 'part'}:${mat.name || 'mat'}`;
        shadowFlags(mesh);
        target.add(mesh);
      }
    }
    this.buckets.clear();
    if (this.atlas) { this.atlas.tex.needsUpdate = true; this.root.userData.atlasFill = +(this.atlas.used / this.atlas.h).toFixed(2); }
    return {
      object: this.root,
      colliders: this.colliders,
      anchors: this.anchors,
      parts: this.parts,
      screens: this.screens,
      params: this.params,
      ...extra,
    };
  }
}
const cbox = (w, h, d, x, y, z, rot) => (rot ? { type: 'box', size: [w, h, d], pos: [x, y, z], rot } : { type: 'box', size: [w, h, d], pos: [x, y, z] });
const ccyl = (r, h, x, y, z, rot) => (rot ? { type: 'cylinder', radius: r, height: h, pos: [x, y, z], rot } : { type: 'cylinder', radius: r, height: h, pos: [x, y, z] });
const cball = (r, x, y, z) => ({ type: 'ball', radius: r, pos: [x, y, z] });

// ===========================================================================
// Shaders: volumetric water / glowing fluid, caustics
// ===========================================================================
const TIME = { value: 0 };
function tick() { TIME.value = performance.now() / 1000; }
const CAUSTIC_GLSL = /* glsl */`
float roomCaustic(vec2 uv, float time){
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}`;
// Translucent volume rendered on its front faces with analytic thickness (ray vs box / cylinder
// in object space, so scaling the mesh to drain it keeps working).
function volumeMat(o) {
  const m = new THREE.MeshStandardMaterial({ color: o.tint, roughness: o.rough ?? 0.08, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: o.env ?? 1 });
  m.name = 'volume_' + o.shape;
  m.userData.noShadow = true;
  const u = {
    uTime: TIME,
    uMin: { value: V3(...o.min) }, uMax: { value: V3(...o.max) }, uR: { value: o.radius || 0 },
    uTint: { value: new THREE.Color(o.tint) }, uDeep: { value: new THREE.Color(o.deep) }, uGlow: { value: new THREE.Color(o.glow || 0) },
    uDensity: { value: o.density ?? 3 }, uA: { value: new THREE.Vector2(o.a0 ?? 0.2, o.a1 ?? 0.8) },
  };
  const isect = o.shape === 'cyl' ? /* glsl */`
    vec2 o2 = ro.xz, d2 = rd.xz;
    float qa = max(dot(d2, d2), 1e-6), qb = dot(o2, d2), qc = dot(o2, o2) - uR * uR;
    float qh = qb * qb - qa * qc;
    float tn = 0.0, tf = 0.0;
    if (qh > 0.0) { qh = sqrt(qh); tn = (-qb - qh) / qa; tf = (-qb + qh) / qa; }
    float iy = 1.0 / (abs(rd.y) < 1e-5 ? 1e-5 : rd.y);
    float ya = (uMin.y - ro.y) * iy, yb = (uMax.y - ro.y) * iy;
    tn = max(tn, min(ya, yb)); tf = min(tf, max(ya, yb));` : /* glsl */`
    vec3 ird = 1.0 / (rd + vec3(1e-6));
    vec3 ta = (uMin - ro) * ird, tb = (uMax - ro) * ird;
    vec3 t1 = min(ta, tb), t2 = max(ta, tb);
    float tn = max(max(t1.x, t1.y), t1.z), tf = min(min(t2.x, t2.y), t2.z);`;
  const fx = o.swirl ? /* glsl */`
    float acc = 0.0;
    for (int s = 0; s < 4; s++) {
      vec3 p = ro + rd * mix(max(tn, 0.0), tf, (float(s) + 0.5) / 4.0);
      float rr = clamp(length(p.xz) / max(uR, 1e-3), 0.0, 1.0);
      float ang = atan(p.z, p.x);
      float sw = sin(ang * 3.0 + rr * 8.0 - uTime * 1.1 + p.y * 3.0) * 0.5 + 0.5;
      sw *= sin(p.y * 6.0 - uTime * 0.7 + ang * 2.0) * 0.3 + 0.7;
      acc += sw * (1.15 - rr * 0.8);
    }
    acc *= 0.25;
    totalEmissiveRadiance += uGlow * (0.3 + acc * 0.9) * att;` : /* glsl */`
    vec3 pm = ro + rd * (max(tn, 0.0) + thick * 0.35);
    float cs = roomCaustic(pm.xz * 1.6 + vec2(pm.y * 0.7), uTime * 0.45);
    totalEmissiveRadiance += uGlow * (0.3 + cs * 1.6) * (0.35 + att);`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vRoomOP;\nvarying vec3 vRoomOC;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvRoomOP = position;\nvRoomOC = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vRoomOP;\nvarying vec3 vRoomOC;\nuniform float uTime, uR, uDensity;\nuniform vec3 uMin, uMax, uTint, uDeep, uGlow;\nuniform vec2 uA;\n' + CAUSTIC_GLSL + '\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    vec3 ro = vRoomOC; vec3 rd = normalize(vRoomOP - vRoomOC);
    ${isect}
    float thick = max(tf - max(tn, 0.0), 0.0);
    float att = 1.0 - exp(-uDensity * thick);
    diffuseColor.rgb = mix(uTint, uDeep, att);
    diffuseColor.a = mix(uA.x, uA.y, att);
    ${fx}`);
  };
  m.customProgramCacheKey = () => 'roomvol_' + o.shape + (o.swirl ? '_s' : '_c');
  m.onBeforeRender = tick;
  m.userData.uniforms = u;
  return m;
}
// Add animated caustic light to a lit material (aquarium gravel / ornaments)
function withCaustics(m, strength = 0.35, color = 0x9fe8ff) {
  const u = { uTime: TIME, uCaustCol: { value: new THREE.Color(color).multiplyScalar(strength) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vRoomWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoomWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vRoomWP;\nuniform float uTime;\nuniform vec3 uCaustCol;\n' + CAUSTIC_GLSL + '\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uCaustCol * diffuseColor.rgb * roomCaustic(vRoomWP.xz * 2.2 + vRoomWP.y * 0.5, uTime * 0.5) * 3.0;');
  };
  m.customProgramCacheKey = () => 'roomcaustic';
  m.onBeforeRender = tick;
  return m;
}

// ===========================================================================
// Shared sub-assemblies (all build in the kit's current frame, facing +Z)
// ===========================================================================
// Round analog gauge; returns the needle pivot (rotate around local Z; 0 = straight up,
// use gaugeAngle(v) for v in 0..1 over the 270° scale).
export function gaugeAngle(v) { return (0.5 - Math.min(1, Math.max(0, v))) * 1.5 * PI; }
function gauge(k, x, y, z, r, o = NO) {
  const reg = k.atlas.add(o.px ?? 128, o.px ?? 128, (c, w, h) => drawDial(c, w, h, o));
  k.cyl(o.cup || 'metal_dark', r * 1.12, 0.022, x, y, z - 0.011, { axis: 'z', seg: 24 });
  k.tor(o.bezel || 'chrome', r * 1.04, r * 0.1, x, y, z + 0.002, { rs: 6, ts: 28 });
  k.dlabel(reg, r * 0.98, x, y, z + 0.001);
  const piv = k.grp(x, y, z + 0.004, { name: o.name || 'needle' });
  k.inside(piv, () => {
    const s = new THREE.Shape();
    s.moveTo(-r * 0.035, -r * 0.18); s.lineTo(r * 0.035, -r * 0.18); s.lineTo(r * 0.012, r * 0.8); s.lineTo(-r * 0.012, r * 0.8); s.closePath();
    k.ext(o.needle || M('plastic_red', { color: 0xd02a1a }), s, 0.0015, 0, 0, 0);
    k.cyl('metal_dark', r * 0.08, 0.006, 0, 0, 0.002, { axis: 'z', seg: 10 });
  });
  if (o.glass !== false) k.disc(CLEAR({ env: 1 }), r * 1.02, x, y, z + 0.009, { seg: 24 });
  piv.rotation.z = gaugeAngle(o.value ?? 0.3);
  return piv;
}
// Indicator lamp (dome facing +Z) with its own emissive material; returns the lamp mesh
function lamp(k, x, y, z, r, color = 'red', o = NO) {
  const t = Math.min(0.008, r * 1.2);
  k.cyl(o.bezel || 'chrome', r * 1.4, t, x, y, z + t / 2, { axis: 'z', seg: 18 });
  const g = gSph(r, { ws: 14, hs: 7, tl: PI / 2, uv: false });
  g.rotateX(HP);
  return k.mesh(lampMat(color, o.ov), g, x, y, z + t * 0.8, { name: o.name || 'lamp_' + color, shadow: false });
}
// Rotary knob; returns group (rotate around local Z)
function knob(k, x, y, z, r, o = NO) {
  const g = k.grp(x, y, z, { name: o.name || 'knob' });
  k.inside(g, () => {
    const h = o.h ?? r * 0.9;
    k.cyl(o.skirt || 'chrome', r * 1.25, 0.004, 0, 0, 0.002, { axis: 'z', seg: 20 });
    k.cyl(o.mat || 'plastic_black', r * 0.92, h, 0, 0, h / 2 + 0.004, { axis: 'z', seg: o.seg ?? 14, r2: r });
    k.cyl(o.cap || o.skirt || 'chrome', r * 0.7, 0.002, 0, 0, h + 0.004, { axis: 'z', seg: 16, uv: false });
    k.box(o.mark || o.skirt || 'chrome', r * 0.16, r * 0.75, 0.003, 0, r * 0.45, h + 0.005, { uv: false });
  });
  return g;
}
// Push button (chunky): returns cap mesh group (translate local Z to press)
function pushButton(k, x, y, z, r, o = NO) {
  k.cyl(o.ring || 'chrome', r * 1.35, 0.01, x, y, z + 0.005, { axis: 'z', seg: 20 });
  const g = k.grp(x, y, z + 0.01, { name: o.name || 'button' });
  k.inside(g, () => {
    k.cyl(o.mat || M('plastic_red', { color: 0xc8231b }), r, o.h ?? r * 0.7, 0, 0, (o.h ?? r * 0.7) / 2, { axis: 'z', seg: 20, r2: r * 1.02 });
    k.sph(o.mat || M('plastic_red', { color: 0xc8231b }), r, 0, 0, o.h ?? r * 0.7, { ws: 20, hs: 6, tl: 0.5, axis: 'z', s: [1, 1, 0.35] });
  });
  return g;
}
// Toggle switch with plate; returns lever group (rotate local X)
function toggle(k, x, y, z, o = NO) {
  k.box('chrome', 0.026, 0.04, 0.003, x, y, z + 0.0015, { r: 0.002 });
  k.cyl('chrome', 0.007, 0.008, x, y, z + 0.007, { axis: 'z', seg: 10 });
  const g = k.grp(x, y, z + 0.01, { name: o.name || 'toggle' });
  k.inside(g, () => {
    k.cyl('chrome', 0.0025, 0.022, 0, 0.011, 0, { seg: 8, r2: 0.0035 });
    k.sph(o.tip || 'chrome', 0.0045, 0, 0.022, 0, { ws: 8, hs: 6 });
  });
  g.rotation.x = o.on ? -0.45 : 0.45;
  return g;
}
// Louvered vent facing +Z (dark recess + slanted slats)
function louvers(k, x, y, z, w, h, n, o = NO) {
  k.box(o.back || 'plastic_black', w, h, 0.004, x, y, z - 0.004);
  const sh = (h / n) * 0.8;
  for (let i = 0; i < n; i++) k.box(o.mat || 'metal_dark', w * 0.98, sh, 0.003, x, y - h / 2 + (i + 0.5) * (h / n), z + 0.002, { rot: [-0.7, 0, 0] });
  if (o.frame !== false) k.ext(o.frameMat || o.mat || 'metal_dark', frameShape(w + 0.02, h + 0.02, 0.006, w, h, 0.003), 0.006, x, y, z - 0.002);
}
// Slot vents (row of dark rounded slots) on a surface facing +Z
function slots(k, x, y, z, w, h, n, o = NO) {
  const sw = o.vertical ? (w / n) * 0.5 : w, sh = o.vertical ? h : (h / n) * 0.5;
  for (let i = 0; i < n; i++) {
    const px = o.vertical ? x - w / 2 + (i + 0.5) * (w / n) : x;
    const py = o.vertical ? y : y - h / 2 + (i + 0.5) * (h / n);
    k.box(o.mat || 'plastic_black', sw, sh, 0.004, px, py, z, { r: Math.min(sw, sh) * 0.45, seg: 1, uv: false });
  }
}
// Cable (tube) through points
function cable(k, pts, r = 0.006, mat = 'rubber', o = NO) { return k.tube(mat, pts, r, { rs: o.rs ?? 6, ...o }); }
// Shared CRT monitor (base on y=0 of the frame, screen facing +Z). Returns { screen, cy }.
function crtMonitor(k, name, o = NO) {
  const sw = o.sw ?? 0.28, sh = sw * 0.75;
  const bw = sw + (o.bx ?? 0.085), bh = sh + (o.by ?? 0.1), bd = o.depth ?? sw * 1.15;
  const shell = o.shell || 'plastic_beige';
  const stand = o.stand !== false;
  const cy = (stand ? 0.055 : 0) + bh / 2 + (o.lift || 0);
  // bezel frame with screen opening (slightly above center like real CRTs)
  const ox = 0, oy = (o.by ?? 0.1) * 0.12;
  k.ext(shell, frameShape(bw, bh, 0.018, sw + 0.012, sh + 0.012, 0.012, ox, oy), 0.03, 0, cy, -0.036, { bev: 0.006, cs: 4 });
  // inner recess (dark ring around glass)
  k.ext(o.recess || 'plastic_black', frameShape(sw + 0.018, sh + 0.018, 0.012, sw - 0.004, sh - 0.004, 0.01, 0, 0), 0.02, ox, cy + oy, -0.044, { cs: 3 });
  // body: tapered tube to the back
  k.taper(shell, bw - 0.012, bh - 0.012, bd - 0.04, 0.62, 0.62, 0, cy, -0.04 - (bd - 0.04) / 2, { dy: -0.02 });
  // back cap & vents
  k.box(shell, (bw - 0.012) * 0.6, (bh - 0.012) * 0.6, 0.04, 0, cy - 0.024, -bd - 0.005, { r: 0.01 });
  for (let i = 0; i < 6; i++) k.box('plastic_black', 0.01, 0.004, bd * 0.38, -0.06 + i * 0.024, cy + (bh - 0.012) * 0.42 * 0.8 + 0.006, -bd * 0.55, { rot: [-0.13, 0, 0], uv: false });
  // glass
  const screen = k.screen(name, sw, sh, ox, cy + oy, -0.03, { bulge: o.bulge ?? sw * 0.04, style: o.style || 'crt', text: o.text ?? 'R.O.O.M. OS v2.1\n> READY_', aspect: 4 / 3, glow: o.glow });
  // controls row under the screen
  const by = cy - bh / 2 + (o.by ?? 0.1) * 0.3;
  if (k.atlas && o.badge !== false) {
    const reg = k.atlas.add(128, 24, (c, w, h) => { txt(c, o.badge || 'R.O.O.M. VISION 14', w / 2, h / 2, h * 0.62, { col: '#4a4436', f: 'bold', maxW: w * 0.95 }); });
    k.label(reg, bw * 0.38, bw * 0.38 * 24 / 128, -bw * 0.22, by, 0.001);
  }
  k.box('plastic_grey', 0.018, 0.012, 0.006, bw * 0.38, by, 0.002, { r: 0.002, uv: false });
  const led = lamp(k, bw * 0.3, by, -0.001, 0.003, 'green', { bezel: 'plastic_black', name: 'powerLed' });
  for (let i = 0; i < 3; i++) k.cyl('plastic_grey', 0.005, 0.006, bw * 0.06 + i * 0.022, by, 0.003, { axis: 'z', seg: 10, uv: false });
  // swivel stand
  if (stand) {
    k.cyl(shell, bw * 0.3, 0.018, 0, 0.009, -bd * 0.35, { seg: 28, r2: bw * 0.32 });
    k.cyl(shell, bw * 0.2, 0.03, 0, 0.033, -bd * 0.35, { seg: 24, r2: bw * 0.24 });
    k.box(shell, bw * 0.4, 0.03, bd * 0.4, 0, 0.05, -bd * 0.35, { r: 0.008 });
  }
  // power + signal cables out of the back
  if (o.cables !== false) {
    cable(k, [[0.03, cy - 0.06, -bd - 0.02], [0.04, cy - 0.12, -bd - 0.1], [0.05, 0.01, -bd - 0.14], [0.12, 0.006, -bd - 0.2]], 0.004, 'plastic_grey');
    cable(k, [[-0.03, cy - 0.06, -bd - 0.02], [-0.04, cy - 0.12, -bd - 0.08], [-0.06, 0.01, -bd - 0.12], [-0.2, 0.006, -bd - 0.15]], 0.004, 'rubber');
  }
  return { screen, cy: cy + oy, led, bw, bh, bd };
}

// ===========================================================================
// MODELS
// ===========================================================================
// ---------------------------------------------------------------------------
// Vending machines
// ---------------------------------------------------------------------------
const SNACKS = [
  // brand, bg, fg, accent
  ['CRUNCHOS', '#f4c21b', '#c8231b', '#7a1410'],
  ['VOID CHIPS', '#2a1840', '#c9a2ff', '#f0e8ff'],
  ['NUTRI-BAR', '#2c63b5', '#ffffff', '#f2c418'],
  ['CHOCO LOOPS', '#5a2f1a', '#f6d7a8', '#e2392b'],
  ['SALTY BOYS', '#1f8a4a', '#fff7d6', '#0d4a24'],
  ['MOIST CAKES', '#f08fb0', '#ffffff', '#8a2048'],
  ['PORK RINDZ', '#e8661c', '#fff2c0', '#5a2008'],
  ['LEVEL 0 CRISPS', '#d9c36a', '#3a3420', '#8a7a2a'],
  ['MEAT STIX', '#8a1c14', '#ffd66b', '#2a0805'],
  ['MINT GUM', '#9fe0d0', '#0d5a4a', '#ffffff'],
  ['CHEEZ PUFS', '#ff9a1a', '#1a3a8a', '#ffffff'],
  ['PRETZL', '#3a2a8a', '#ffd21a', '#ffffff'],
  ['ALMOND JOYLESS', '#e9e2cf', '#6a3a1a', '#2f6a3a'],
  ['GLUE-E BEARS', '#e23a8a', '#fff04a', '#3a0a2a'],
];
function drawSnack(c, w, h, b, kind, seed) {
  const [name, bg, fg, ac] = b;
  const r = new RNG(seed);
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  // glossy pillow shading
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.18, 'rgba(255,255,255,0.18)'); g.addColorStop(0.32, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (kind === 'chips' || kind === 'pastry') {
    // crimped seals
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < w; x += 6) { c.fillRect(x, 0, 3, h * 0.07); c.fillRect(x, h * 0.93, 3, h * 0.07); }
    // food illustration
    for (let i = 0; i < 5; i++) {
      c.fillStyle = i % 2 ? '#f0c060' : '#e2a840';
      c.beginPath(); c.ellipse(w * (0.25 + r.next() * 0.5), h * (0.62 + r.next() * 0.18), w * 0.16, w * 0.1, r.next() * 3, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(120,60,0,0.5)'; c.lineWidth = 1.5; c.stroke();
    }
  } else if (kind === 'bar') {
    c.fillStyle = ac; c.fillRect(0, h * 0.72, w, h * 0.1);
    c.fillStyle = '#5a2f1a'; rrect(c, w * 0.2, h * 0.84, w * 0.6, h * 0.1, 4); c.fill();
  } else {
    c.fillStyle = ac;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(w * (0.28 + i * 0.22), h * 0.72, w * 0.1, 0, TAU); c.fill(); }
  }
  // badge
  c.fillStyle = ac; c.beginPath(); c.arc(w * 0.8, h * 0.18, w * 0.13, 0, TAU); c.fill();
  txt(c, r.pick(['NEW!', '50%', 'XTRA', '!!!', 'HOT']), w * 0.8, h * 0.18, w * 0.09, { col: bg, f: 'sans' });
  // brand
  const words = name.split(' ');
  c.save(); c.translate(w / 2, h * 0.36); c.rotate(-0.12);
  words.forEach((wd, i) => txt(c, wd, 0, (i - (words.length - 1) / 2) * w * 0.24, w * 0.24, { col: fg, stroke: ac, lw: w * 0.035, maxW: w * 0.92 }));
  c.restore();
  txt(c, 'NET WT 1.5 OZ', w / 2, h * 0.96, w * 0.065, { col: fg, f: 'bold', w: 'bold' });
}

function b_vending_snack(o) {
  const k = new Kit('vending_snack');
  const A = k.useAtlas(1024, 1024);
  const body = PAINT(0x2c2e33);
  const doorM = PAINT(0x9a1f1a, 0.3);
  const W = 1.0, H = 1.85, D = 0.85;
  const zf = 0.398; // door back plane
  // --- cabinet shell ---
  k.box('rubber', W - 0.06, 0.07, D - 0.08, 0, 0.035, -0.01);
  for (const [x, z] of [[-0.44, -0.36], [0.44, -0.36], [-0.44, 0.36], [0.44, 0.36]]) k.cyl('steel', 0.024, 0.04, x, 0.02, z, { seg: 12 });
  k.box(body, 0.03, H - 0.07, D - 0.03, -W / 2 + 0.015, 0.07 + (H - 0.07) / 2, -0.015, { r: 0.006 });
  k.box(body, 0.03, H - 0.07, D - 0.03, W / 2 - 0.015, 0.07 + (H - 0.07) / 2, -0.015, { r: 0.006 });
  k.box(body, W, 0.03, D - 0.03, 0, H - 0.015, -0.015, { r: 0.006 });
  k.box(body, W - 0.06, H - 0.07, 0.03, 0, 0.07 + (H - 0.07) / 2, -D / 2 + 0.015);
  k.box(body, W - 0.06, 0.03, D - 0.06, 0, 0.085, -0.01);
  // interior (light grey liner so products pop)
  const liner = M('plastic_white', { color: 0x8f9396 });
  k.box(liner, 0.64, 1.2, 0.01, -0.14, 1.16, -0.385);
  k.box(liner, 0.01, 1.2, 0.77, -0.463, 1.16, 0.0);
  k.box(liner, 0.01, 1.2, 0.77, 0.178, 1.16, 0.0);
  k.box(liner, 0.64, 0.01, 0.77, -0.14, 1.755, 0.0);
  // --- door (one extrusion with window + pickup openings) ---
  const ds = rrShape(0.98, 1.75, 0.02, 0, 0.955);
  ds.holes.push(rrHole(0.62, 1.12, 0.012, -0.14, 1.16));
  ds.holes.push(rrHole(0.44, 0.22, 0.01, -0.16, 0.31));
  k.ext(doorM, ds, 0.035, 0, 0, zf, { bev: 0.006, cs: 3, uv: 2.5 });
  const zF = zf + 0.041; // door front face
  // window trim + glass
  k.ext(M('metal_dark', { roughness: 0.6 }), frameShape(0.65, 1.15, 0.018, 0.62, 1.12, 0.012), 0.008, -0.14, 1.16, zF - 0.002, { bev: 0.002, cs: 3 });
  k.plane(GLASS(), 0.63, 1.13, -0.14, 1.16, zf + 0.018);
  // header (lit marquee) above window
  const hdr = A.add(512, 56, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e8b030'); g.addColorStop(1, '#b8720c');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    txt(c, 'SNACKS  •  CANDY  •  CHIPS', w / 2, h * 0.54, h * 0.62, { col: '#5a0c08', maxW: w * 0.94 });
  });
  k.box('plastic_black', 0.6, 0.07, 0.01, -0.14, 1.775, zF + 0.001, { r: 0.004 });
  k.label(hdr, 0.58, 0.056, -0.14, 1.775, zF + 0.0065, { glow: 0.45 });
  // interior light tube (left edge, behind stile)
  const light = k.cyl(own('emissive_white', { emissiveIntensity: 0.9 }), 0.011, 0.6, -0.14, 1.745, 0.37, { seg: 10, sep: true, name: 'light', axis: 'x' });
  k.box('plastic_white', 0.62, 0.02, 0.03, -0.14, 1.765, 0.37);
  // --- shelves, coils, products ---
  const rows = 5, cols = 4;
  const colX = [-0.365, -0.215, -0.065, 0.085];
  const kinds = ['bar', 'chips', 'chips', 'cookie', 'pastry'];
  const dims = { bar: [0.075, 0.15, 0.024], chips: [0.13, 0.185, 0.05], cookie: [0.125, 0.12, 0.04], pastry: [0.125, 0.15, 0.045] };
  const coilGeo = prepGeo(mergeGeometries([
    prepGeo(gTube(new HelixCurve(0.052, -0.33, 0.33, 5), 0.0028, { ts: 40, rs: 3 })),
    prepGeo(gCyl(0.016, 0.02, { axis: 'z', seg: 8 }).translate(0, 0, -0.34)),
    prepGeo(gBox(0.004, 0.052, 0.004).translate(0, 0.026, -0.335)),
  ]));
  const coilMat = M('chrome', { color: 0xc8ccd0, roughness: 0.35 });
  k.parts.coils = []; k.parts.products = []; k.anchors.slots = [];
  const brandIdx = new RNG(o.seed ?? 7).shuffle(SNACKS.map((_, i) => i));
  const swatch = {};
  for (let r = 0; r < rows; r++) {
    const yb = 1.72 - (r + 1) * 0.218 + 0.012;
    k.box(STEEL(), 0.62, 0.008, 0.74, -0.14, yb - 0.004, 0.0);
    k.box('plastic_black', 0.62, 0.03, 0.008, -0.14, yb - 0.008, 0.374);
    const strip = A.add(512, 26, (c, w, h) => {
      c.fillStyle = '#f4f0e2'; c.fillRect(0, 0, w, h);
      for (let j = 0; j < cols; j++) {
        const cx = (j + 0.5) * (w / cols);
        txt(c, `${'ABCDE'[r]}${j + 1}`, cx - w * 0.07, h / 2, h * 0.75, { col: '#c8231b', f: 'sans' });
        txt(c, ['75¢', '$1.00', '85¢', '60¢', '$1.25'][(r + j) % 5], cx + w * 0.045, h / 2, h * 0.7, { col: '#111', f: 'mono' });
        c.fillStyle = '#999'; c.fillRect((j + 1) * (w / cols) - 1, 0, 2, h);
      }
    });
    k.label(strip, 0.6, 0.024, -0.14, yb - 0.008, 0.379);
    for (let j = 0; j < cols; j++) {
      const i = r * cols + j;
      const cy = yb + 0.056;
      const coil = k.mesh(coilMat, coilGeo, colX[j], cy, 0, { name: `coil_${i}` });
      k.parts.coils.push(coil);
      k.box('plastic_black', 0.05, 0.06, 0.03, colX[j], cy, -0.365, { r: 0.004 });
      k.anchors.slots.push(V3(colX[j], yb + 0.1, 0.34));
      // products
      const b = SNACKS[brandIdx[i % brandIdx.length]];
      const kind = kinds[r];
      const [pw, ph, pd] = dims[kind];
      const art = A.add(kind === 'bar' ? 64 : 112, kind === 'bar' ? 128 : Math.round(112 * ph / pw), (c, w, h) => drawSnack(c, w, h, b, kind, i + 3));
      const side = swatch[b[1]] || (swatch[b[1]] = A.solid(b[1]));
      const pg = k.grp(colX[j], yb, 0, { name: `products_${i}` });
      k.inside(pg, () => {
        for (let s = 0; s < 5; s++) {
          const z = 0.33 - (s + 0.5) * 0.132;
          k.labelBox({ pz: art, nz: art, side }, pw, ph, pd, 0, ph / 2 + 0.001, z, { glow: 0.12, rot: [0, 0, (s % 2 ? 0.02 : -0.015)] });
        }
      });
      k.parts.products.push(pg);
    }
  }
  // --- control panel ---
  const cx = 0.33;
  k.box(STEEL(), 0.27, 1.12, 0.004, cx, 1.16, zF + 0.002, { r: 0.002 });
  const brand = A.add(256, 150, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b0806'); g.addColorStop(1, '#6a120d');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    drawClone(c, w * 0.2, h * 0.55, h * 0.7, { wave: true });
    txt(c, 'R.O.O.M.', w * 0.66, h * 0.32, h * 0.22, { col: '#ffd34a', maxW: w * 0.6 });
    txt(c, 'SNAX', w * 0.66, h * 0.62, h * 0.36, { col: '#ffffff', stroke: '#c8231b', maxW: w * 0.6 });
    txt(c, 'FUEL FOR THE DISPOSABLE', w * 0.66, h * 0.86, h * 0.08, { col: '#ffd34a', f: 'bold', maxW: w * 0.6 });
  });
  k.ext('chrome', frameShape(0.27, 0.165, 0.01, 0.25, 0.145, 0.006), 0.008, cx, 1.62, zF + 0.003, { cs: 3 });
  k.label(brand, 0.25, 0.146, cx, 1.62, zF + 0.006, { glow: 0.5 });
  k.box('plastic_black', 0.22, 0.085, 0.014, cx, 1.465, zF + 0.009, { r: 0.006 });
  k.screen('main', 0.19, 0.055, cx, 1.465, zF + 0.0165, { style: 'led', text: 'MAKE SELECTION', bulge: 0 });
  // keypad
  k.box('plastic_black', 0.23, 0.215, 0.006, cx, 1.29, zF + 0.005, { r: 0.004 });
  const keys = ['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4', '*', '0', 'CLR'];
  keys.forEach((s, i) => {
    const kx = cx + ((i % 3) - 1) * 0.068, ky = 1.36 - Math.floor(i / 3) * 0.046;
    k.box(M('plastic_white', { color: 0xc4bea9 }), 0.056, 0.036, 0.016, kx, ky, zF + 0.015, { r: 0.006, seg: 1 });
    const reg = A.add(48, 30, (c, w, h) => { c.fillStyle = '#c4bea9'; c.fillRect(0, 0, w, h); txt(c, s, w / 2, h / 2 + 1, h * (s.length > 1 ? 0.5 : 0.75), { col: i < 5 ? '#c8231b' : '#151515' }); });
    k.label(reg, 0.044, 0.026, kx, ky, zF + 0.0232);
  });
  // coin slot + return button
  const coinTxt = A.add(160, 24, (c, w, h) => txt(c, '25¢  50¢  $1 COIN', w / 2, h / 2, h * 0.7, { col: '#151515', f: 'bold', maxW: w * 0.95 }));
  k.label(coinTxt, 0.2, 0.03, cx, 1.165, zF + 0.0045);
  k.box('chrome', 0.07, 0.1, 0.012, cx - 0.05, 1.09, zF + 0.008, { r: 0.006 });
  k.box('plastic_black', 0.006, 0.04, 0.004, cx - 0.05, 1.095, zF + 0.0145);
  pushButton(k, cx + 0.06, 1.09, zF + 0.002, 0.018, { mat: 'chrome', ring: 'plastic_black', name: 'coinReturn' });
  // bill acceptor
  k.box('plastic_black', 0.15, 0.075, 0.03, cx, 0.95, zF + 0.016, { r: 0.008 });
  k.box(M('plastic_black', { color: 0x050505 }), 0.1, 0.004, 0.004, cx, 0.95, zF + 0.0315);
  const bill = A.add(128, 24, (c, w, h) => { c.fillStyle = '#062'; c.fillRect(0, 0, w, h); txt(c, '▼ BILLS FACE UP ▼', w / 2, h / 2, h * 0.65, { col: '#7dff9a', f: 'bold', maxW: w * 0.95 }); });
  k.label(bill, 0.11, 0.02, cx, 0.975, zF + 0.0315, { glow: 1.0 });
  // coin return cup
  k.ext('chrome', frameShape(0.1, 0.075, 0.01, 0.08, 0.055, 0.008), 0.01, cx, 0.8, zF + 0.002, { cs: 3 });
  k.box(M('plastic_black', { color: 0x070707 }), 0.08, 0.055, 0.004, cx, 0.8, zF + 0.002);
  const cr = A.add(128, 20, (c, w, h) => txt(c, 'COIN RETURN', w / 2, h / 2, h * 0.75, { col: '#151515', f: 'bold' }));
  k.label(cr, 0.1, 0.016, cx, 0.855, zF + 0.0045);
  // instruction card
  const inst = A.add(200, 190, (c, w, h) => {
    c.fillStyle = '#d9d2bc'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c8231b'; c.fillRect(0, 0, w, h * 0.17);
    txt(c, 'HOW TO SNACK', w / 2, h * 0.09, h * 0.11, { col: '#fff' });
    ['1. INSERT EXACT CHANGE', '2. ENTER LETTER + NUMBER', '3. RETRIEVE PRODUCT BELOW', '4. RETURN TO WORK'].forEach((s, i) =>
      txt(c, s, w * 0.06, h * (0.29 + i * 0.12), h * 0.075, { col: '#151515', f: 'mono', al: 'left', maxW: w * 0.9 }));
    txt(c, 'R.O.O.M. is not liable for products', w / 2, h * 0.82, h * 0.055, { col: '#555', f: 'mono', maxW: w * 0.92 });
    txt(c, 'lost to other dimensions.', w / 2, h * 0.9, h * 0.055, { col: '#555', f: 'mono', maxW: w * 0.92 });
    grime(c, w, h, 0.4, 11);
  });
  k.label(inst, 0.22, 0.209, cx, 0.56, zF + 0.0045);
  // --- pickup bin + flap ---
  const binM = M('plastic_black', { color: 0x111214 });
  k.box(binM, 0.44, 0.012, 0.24, -0.16, 0.2, 0.29);
  k.box(binM, 0.44, 0.3, 0.012, -0.16, 0.33, 0.2, { rot: [0.5, 0, 0] });
  k.box(binM, 0.012, 0.24, 0.24, -0.38, 0.31, 0.29);
  k.box(binM, 0.012, 0.24, 0.24, 0.06, 0.31, 0.29);
  k.cyl('chrome', 0.005, 0.44, -0.16, 0.418, 0.415, { axis: 'x', seg: 8 });
  const flap = k.grp(-0.16, 0.418, 0.415, { name: 'flap' });
  const push = A.add(128, 48, (c, w, h) => { c.fillStyle = '#1a1b1e'; c.fillRect(0, 0, w, h); txt(c, 'PUSH', w / 2, h * 0.55, h * 0.6, { col: '#d8d2c0' }); });
  k.inside(flap, () => {
    k.box(M('plastic_black', { color: 0x1d1e22, roughness: 0.4 }), 0.432, 0.205, 0.006, 0, -0.105, 0, { r: 0.002 });
    k.label(push, 0.1, 0.0375, 0, -0.07, 0.0035);
  });
  k.parts.flap = flap;
  // side decals
  const sideArt = A.add(160, 420, (c, w, h) => {
    c.fillStyle = '#8a1d19'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2b318'; c.fillRect(w * 0.1, 0, w * 0.06, h); c.fillRect(w * 0.84, 0, w * 0.06, h);
    c.save(); c.translate(w / 2, h * 0.42); c.rotate(-HP);
    txt(c, 'R.O.O.M. SNAX', 0, 0, w * 0.34, { col: '#fff', stroke: '#2a0805', maxW: h * 0.75 });
    c.restore();
    drawClone(c, w / 2, h * 0.86, w * 0.55);
    grime(c, w, h, 0.6, 4);
  });
  k.label(sideArt, 0.32, 0.84, W / 2 + 0.001, 1.1, -0.05, { rot: [0, HP, 0] });
  k.label(sideArt, 0.32, 0.84, -W / 2 - 0.001, 1.1, -0.05, { rot: [0, -HP, 0] });
  // back: vent + power cord
  slots(k, 0.2, 0.4, -D / 2 - 0.001, 0.3, 0.2, 8, { mat: 'plastic_black' });
  cable(k, [[0.3, 0.3, -0.43], [0.32, 0.12, -0.46], [0.36, 0.012, -0.55], [0.6, 0.012, -0.75]], 0.006, 'rubber');
  k.collide(cbox(W, H, 0.87, 0, H / 2, 0.005));
  k.anchors.tray = V3(-0.16, 0.24, 0.3);
  k.parts.light = light;
  return k.done({ mass: 320, material: 'metal' });
}

function drawColaPanel(c, w, h) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#e01a2a'); g.addColorStop(0.55, '#a50c18'); g.addColorStop(1, '#5c040b');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // white swoosh
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.beginPath(); c.moveTo(0, h * 0.62); c.bezierCurveTo(w * 0.4, h * 0.5, w * 0.6, h * 0.78, w, h * 0.6);
  c.lineTo(w, h * 0.66); c.bezierCurveTo(w * 0.6, h * 0.84, w * 0.4, h * 0.57, 0, h * 0.68); c.closePath(); c.fill();
  // bubbles
  const r = new RNG(5);
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 60; i++) { c.lineWidth = r.range(1, 3); c.beginPath(); c.arc(r.next() * w, r.next() * h, r.range(2, 12), 0, TAU); c.stroke(); }
  // giant can
  const cx = w * 0.5, cy = h * 0.43, cw = w * 0.44, ch = h * 0.36;
  c.save(); c.translate(cx, cy); c.rotate(-0.12);
  const cg = c.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  cg.addColorStop(0, '#5a0008'); cg.addColorStop(0.25, '#e8303c'); cg.addColorStop(0.4, '#ff9aa0'); cg.addColorStop(0.55, '#d01828'); cg.addColorStop(1, '#4a0006');
  c.fillStyle = cg; rrect(c, -cw / 2, -ch / 2, cw, ch, cw * 0.12); c.fill();
  const tg = c.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  tg.addColorStop(0, '#666'); tg.addColorStop(0.4, '#eee'); tg.addColorStop(1, '#555');
  c.fillStyle = tg; c.fillRect(-cw / 2 + 4, -ch / 2 - 6, cw - 8, 14); c.fillRect(-cw / 2 + 4, ch / 2 - 8, cw - 8, 14);
  txt(c, 'R.O.O.M.', 0, -ch * 0.18, cw * 0.2, { col: '#fff' });
  txt(c, 'COLA', 0, ch * 0.08, cw * 0.32, { col: '#fff', i: true, stroke: '#7a0010' });
  c.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 8; i++) { c.beginPath(); c.arc(-cw * 0.3 + r.next() * cw * 0.6, ch * 0.3 + r.next() * ch * 0.12, 3, 0, TAU); c.fill(); }
  c.restore();
  // header + tagline
  drawLogo(c, w * 0.56, h * 0.07, w * 0.09, '#ffffff');
  txt(c, 'R.O.O.M. COLA', w / 2, h * 0.16, w * 0.13, { col: '#ffffff', i: true, stroke: '#5c040b', maxW: w * 0.92 });
  txt(c, 'Refreshment is Mandatory', w / 2, h * 0.81, w * 0.075, { col: '#ffe08a', f: 'serif', i: true, w: 'bold', maxW: w * 0.9 });
  // ice cold badge
  c.fillStyle = '#1d5fbf'; c.beginPath(); c.arc(w * 0.83, h * 0.3, w * 0.1, 0, TAU); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke();
  txt(c, 'ICE', w * 0.83, h * 0.288, w * 0.05, { col: '#fff' });
  txt(c, 'COLD', w * 0.83, h * 0.316, w * 0.045, { col: '#fff' });
  txt(c, 'NOW WITH 30% MORE CAFFEINE-ADJACENT COMPOUNDS', w / 2, h * 0.9, w * 0.028, { col: '#ffd0d0', f: 'mono', maxW: w * 0.9 });
  txt(c, 'Consumption logged to your employee file.', w / 2, h * 0.94, w * 0.028, { col: '#ffd0d0', f: 'mono', maxW: w * 0.9 });
}

function b_vending_drink(o) {
  const k = new Kit('vending_drink');
  const A = k.useAtlas(1024, 1024);
  const body = PAINT(0x8c0f18);
  const dark = PAINT(0x1c1c20);
  const W = 1.0, H = 1.85, D = 0.85, zF = 0.44;
  // shell
  k.box('rubber', W - 0.06, 0.07, D - 0.08, 0, 0.035, -0.01);
  for (const [x, z] of [[-0.44, -0.36], [0.44, -0.36], [-0.44, 0.36], [0.44, 0.36]]) k.cyl('steel', 0.024, 0.04, x, 0.02, z, { seg: 12 });
  k.box(body, W, H - 0.4, D, 0, 0.4 + (H - 0.4) / 2, 0.0, { r: 0.012 });
  // lower body, carved around the pickup bin cavity (x -0.33..0.01, y 0.155..0.355, z > 0.19)
  k.box(body, W, 0.33, D - 0.235, 0, 0.235, -D / 2 + (D - 0.235) / 2);
  k.box(body, 0.17, 0.33, 0.235, -0.415, 0.235, D / 2 - 0.1175);
  k.box(body, 0.49, 0.33, 0.235, 0.255, 0.235, D / 2 - 0.1175);
  k.box(body, 0.34, 0.085, 0.235, -0.16, 0.1125, D / 2 - 0.1175);
  k.box(body, 0.34, 0.045, 0.235, -0.16, 0.3775, D / 2 - 0.1175);
  // front door frame (dark) with the light panel window + button column
  const ds = rrShape(0.98, 1.76, 0.02, 0, 0.95);
  ds.holes.push(rrHole(0.6, 1.24, 0.015, -0.16, 1.11));
  ds.holes.push(rrHole(0.34, 0.2, 0.012, -0.16, 0.255));
  k.ext(dark, ds, 0.03, 0, 0, D / 2 - 0.004, { bev: 0.006, cs: 3 });
  const zP = D / 2 + 0.03; // front plane of door
  // illuminated panel (own material so it can flicker / be switched off)
  const art = A.add(420, 860, drawColaPanel);
  const pg = gCRT(0.6, 1.24, 0.012);
  mapUV(pg, art);
  const pm = new THREE.MeshStandardMaterial({ map: A.tex, emissiveMap: A.tex, emissive: 0xffffff, emissiveIntensity: 0.38, roughness: 0.25, metalness: 0 });
  pm.userData.unique = true; pm.userData.noShadow = true; pm.name = 'cola_panel';
  const panel = k.mesh(pm, pg, -0.16, 1.11, zP - 0.012, { name: 'panel' });
  panel.castShadow = false;
  k.ext('chrome', frameShape(0.63, 1.27, 0.022, 0.6, 1.24, 0.015), 0.008, -0.16, 1.11, zP, { cs: 3 });
  // header lip above the panel
  k.box(dark, 0.98, 0.06, 0.06, 0, 1.8, D / 2 + 0.02, { r: 0.01 });
  // --- button column ---
  const cx = 0.32;
  k.box(dark, 0.27, 1.5, 0.012, cx, 1.02, zP + 0.004, { r: 0.006 });
  const flav = [['R.O.O.M. COLA', '#c8102e', '#fff'], ['DIET COLA', '#a9a9a9', '#9a0010'], ['ALMOND WATER', '#c8b890', '#4a3010'], ['LEMON-LIME', '#7fd23a', '#0d3a0d'], ['ORANGE FIZZ', '#ff8a1a', '#fff'], ['ROOT BEER', '#5a2a12', '#ffd9a0']];
  k.parts.buttons = []; k.parts.buttonLights = [];
  flav.forEach(([name, bg, fg], i) => {
    const y = 1.66 - i * 0.1;
    const reg = A.add(220, 72, (c, w, h) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      txt(c, name, w / 2, h * 0.42, h * 0.36, { col: fg, maxW: w * 0.9 });
      txt(c, '75¢', w / 2, h * 0.8, h * 0.2, { col: fg, f: 'mono' });
    });
    k.box('chrome', 0.225, 0.088, 0.008, cx, y, zP + 0.014, { r: 0.004 });
    const bg2 = k.grp(cx, y, zP + 0.018, { name: 'button_' + i });
    k.inside(bg2, () => {
      k.box(M('plastic_white', { color: 0xdedad0 }), 0.205, 0.072, 0.014, 0, 0, 0.007, { r: 0.006, seg: 1 });
      k.parts.buttonLights.push(k.label(reg, 0.19, 0.062, 0, 0, 0.0145, { glow: 0.32, own: true, name: 'buttonLight_' + i }));
    });
    k.parts.buttons.push(bg2);
  });
  // small display + money
  k.box('plastic_black', 0.2, 0.07, 0.014, cx, 1.03, zP + 0.017, { r: 0.006 });
  k.screen('main', 0.17, 0.045, cx, 1.03, zP + 0.0245, { style: 'led', text: 'INSERT COINS', bulge: 0 });
  k.box('chrome', 0.07, 0.1, 0.012, cx - 0.06, 0.9, zP + 0.016, { r: 0.006 });
  k.box('plastic_black', 0.006, 0.04, 0.004, cx - 0.06, 0.905, zP + 0.0225);
  pushButton(k, cx + 0.06, 0.9, zP + 0.01, 0.018, { mat: 'chrome', ring: 'plastic_black', name: 'coinReturn' });
  k.box('plastic_black', 0.15, 0.075, 0.03, cx, 0.78, zP + 0.025, { r: 0.008 });
  k.box(M('plastic_black', { color: 0x050505 }), 0.1, 0.004, 0.004, cx, 0.78, zP + 0.0405);
  const bill = A.add(128, 24, (c, w, h) => { c.fillStyle = '#062'; c.fillRect(0, 0, w, h); txt(c, '▼ BILLS FACE UP ▼', w / 2, h / 2, h * 0.65, { col: '#7dff9a', f: 'bold', maxW: w * 0.95 }); });
  k.label(bill, 0.11, 0.02, cx, 0.805, zP + 0.0405, { glow: 0.8 });
  k.ext('chrome', frameShape(0.1, 0.075, 0.01, 0.08, 0.055, 0.008), 0.01, cx, 0.64, zP + 0.01, { cs: 3 });
  k.box(M('plastic_black', { color: 0x070707 }), 0.08, 0.055, 0.004, cx, 0.64, zP + 0.01);
  const warn = A.add(220, 150, (c, w, h) => {
    c.fillStyle = '#d6cfb8'; c.fillRect(0, 0, w, h);
    hazardTri(c, w * 0.15, h * 0.32, h * 0.35);
    txt(c, 'WARNING', w * 0.62, h * 0.2, h * 0.14, { col: '#c8102e' });
    ['DO NOT ROCK OR TILT.', 'MACHINE MAY TIP OVER', 'CAUSING INJURY OR', 'ADMINISTRATIVE DEATH.'].forEach((s, i) => txt(c, s, w * 0.62, h * (0.38 + i * 0.13), h * 0.075, { col: '#111', f: 'mono', maxW: w * 0.62 }));
    grime(c, w, h, 0.5, 9);
  });
  k.label(warn, 0.22, 0.15, cx, 0.42, zP + 0.0105);
  // pickup bin + flap
  const binM = M('plastic_black', { color: 0x111214 });
  k.box(binM, 0.34, 0.012, 0.22, -0.16, 0.16, 0.33);
  k.box(binM, 0.34, 0.26, 0.012, -0.16, 0.28, 0.23, { rot: [0.45, 0, 0] });
  k.box(binM, 0.012, 0.2, 0.22, -0.33, 0.25, 0.33);
  k.box(binM, 0.012, 0.2, 0.22, 0.01, 0.25, 0.33);
  k.cyl('chrome', 0.005, 0.34, -0.16, 0.352, zP - 0.016, { axis: 'x', seg: 8 });
  const flap = k.grp(-0.16, 0.352, zP - 0.016, { name: 'flap' });
  const push = A.add(128, 48, (c, w, h) => { c.fillStyle = '#1a1b1e'; c.fillRect(0, 0, w, h); txt(c, 'PUSH', w / 2, h * 0.55, h * 0.6, { col: '#d8d2c0' }); });
  k.inside(flap, () => {
    k.box(M('plastic_black', { color: 0x1d1e22, roughness: 0.4 }), 0.332, 0.195, 0.006, 0, -0.1, 0, { r: 0.002 });
    k.label(push, 0.1, 0.0375, 0, -0.07, 0.0035);
  });
  k.parts.flap = flap;
  // kick plate vents
  louvers(k, 0.25, 0.11, zP + 0.004, 0.36, 0.05, 4, { mat: dark, back: 'plastic_black' });
  // side graphics
  const side = A.add(200, 420, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#8c0f18'); g.addColorStop(1, '#c8102e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(0, h * 0.62, w, h * 0.05);
    c.save(); c.translate(w * 0.5, h * 0.36); c.rotate(-HP);
    txt(c, 'R.O.O.M. COLA', 0, 0, w * 0.3, { col: '#fff', i: true, maxW: h * 0.66 });
    c.restore();
    txt(c, 'Refreshment', w / 2, h * 0.76, w * 0.12, { col: '#ffe08a', f: 'serif', i: true });
    txt(c, 'is Mandatory', w / 2, h * 0.82, w * 0.12, { col: '#ffe08a', f: 'serif', i: true });
    grime(c, w, h, 0.6, 21);
  });
  k.label(side, 0.4, 0.84, W / 2 + 0.001, 1.05, -0.02, { rot: [0, HP, 0] });
  k.label(side, 0.4, 0.84, -W / 2 - 0.001, 1.05, -0.02, { rot: [0, -HP, 0] });
  slots(k, 0.2, 0.4, -D / 2 - 0.001, 0.3, 0.2, 8, { mat: 'plastic_black' });
  cable(k, [[0.3, 0.3, -0.43], [0.32, 0.12, -0.46], [0.36, 0.012, -0.55], [0.6, 0.012, -0.75]], 0.006, 'rubber');
  k.collide(cbox(W, H, D + 0.04, 0, H / 2, 0.02));
  k.anchors.tray = V3(-0.16, 0.19, 0.34);
  k.parts.panel = panel;
  return k.done({ mass: 340, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Water cooler
// ---------------------------------------------------------------------------
function b_water_cooler(o) {
  const k = new Kit('water_cooler');
  const A = k.useAtlas(512, 256);
  const shell = PAINT(0xc9c3b2, 0.05);
  const W = 0.31, D = 0.33, top = 0.95;
  // cabinet with dispensing alcove (y 0.6..0.86)
  k.box(shell, W, 0.6, D, 0, 0.3, 0, { r: 0.018 });
  k.box(shell, W, 0.1, D, 0, top - 0.05, 0, { r: 0.018 });
  k.box(shell, 0.045, 0.28, D, -W / 2 + 0.0225, 0.73, 0, { r: 0.01 });
  k.box(shell, 0.045, 0.28, D, W / 2 - 0.0225, 0.73, 0, { r: 0.01 });
  k.box(shell, W - 0.08, 0.28, D - 0.1, 0, 0.73, -0.05);
  // alcove inner liner (grey)
  k.box(M('plastic_grey', { color: 0x8d8f90 }), W - 0.09, 0.26, 0.004, 0, 0.73, 0.067);
  // drip tray with grille
  k.box(M('plastic_grey', { color: 0x5d5f61 }), W - 0.085, 0.022, 0.1, 0, 0.611, 0.116, { r: 0.004 });
  for (let i = 0; i < 9; i++) k.box(M('plastic_grey', { color: 0x9a9c9e }), 0.006, 0.004, 0.085, -0.1 + i * 0.025, 0.624, 0.116);
  // taps (cold blue, hot red w/ safety)
  const tap = (x, col, name) => {
    k.cyl(M('plastic_white', { color: 0xd8d4c8 }), 0.016, 0.03, x, 0.835, 0.11, { seg: 14 });
    k.cyl('chrome', 0.006, 0.02, x, 0.81, 0.11, { seg: 8 });
    const g = k.grp(x, 0.845, 0.128, { name });
    k.inside(g, () => {
      k.box(M('plastic_' + (col === 'blue' ? 'blue' : 'red'), { color: col === 'blue' ? 0x2b6fd0 : 0xd0302a }), 0.032, 0.06, 0.012, 0, -0.03, 0.006, { r: 0.005 });
    });
    return g;
  };
  k.parts.tapCold = tap(-0.05, 'blue', 'tapCold');
  k.parts.tapHot = tap(0.05, 'red', 'tapHot');
  k.box(M('plastic_red', { color: 0xd0302a }), 0.03, 0.008, 0.01, 0.05, 0.875, 0.13, { r: 0.003 });
  // top collar where the bottle seats
  k.cyl(shell, 0.11, 0.03, 0, top + 0.015, 0, { seg: 28, r2: 0.13 });
  k.cyl(M('plastic_grey', { color: 0x777a7c }), 0.045, 0.012, 0, top + 0.036, 0, { seg: 20 });
  // front badge + labels
  const badge = A.add(200, 60, (c, w, h) => {
    c.fillStyle = '#1f4f8a'; rrect(c, 0, 0, w, h, 10); c.fill();
    txt(c, 'R.O.O.M.', w * 0.3, h * 0.5, h * 0.42, { col: '#fff' });
    txt(c, 'AQUA-COOL', w * 0.72, h * 0.38, h * 0.26, { col: '#bfe3ff', f: 'bold' });
    txt(c, 'MODEL WC-9', w * 0.72, h * 0.7, h * 0.18, { col: '#bfe3ff', f: 'mono' });
  });
  k.label(badge, 0.17, 0.051, 0, 0.5, D / 2 + 0.001);
  const hc = A.add(140, 36, (c, w, h) => {
    c.fillStyle = '#e2ddcf'; c.fillRect(0, 0, w, h);
    txt(c, 'COLD', w * 0.25, h / 2, h * 0.5, { col: '#2b6fd0' }); txt(c, 'HOT', w * 0.75, h / 2, h * 0.5, { col: '#d0302a' });
  });
  k.label(hc, 0.13, 0.033, 0, 0.885, D / 2 + 0.001);
  // power LEDs (cooling / heating)
  k.parts.leds = [lamp(k, -0.05, 0.915, D / 2, 0.004, 'green', { name: 'ledCold' }), lamp(k, 0.05, 0.915, D / 2, 0.004, 'red', { name: 'ledHot' })];
  // back: condenser coil + cord
  const coil = [];
  for (let i = 0; i < 9; i++) { const y = 0.12 + i * 0.05; coil.push([i % 2 ? 0.1 : -0.1, y, -D / 2 - 0.02]); coil.push([i % 2 ? -0.1 : 0.1, y, -D / 2 - 0.02]); }
  k.tube('metal_dark', coil.map((p) => V3(...p)), 0.004, { ct: 'centripetal', ts: 160, rs: 5 });
  for (const y of [0.12, 0.52]) k.box('metal_dark', 0.24, 0.01, 0.025, 0, y, -D / 2 - 0.012);
  cable(k, [[0.08, 0.15, -D / 2], [0.1, 0.05, -D / 2 - 0.05], [0.12, 0.008, -D / 2 - 0.12], [0.3, 0.008, -D / 2 - 0.3]], 0.004, 'rubber');
  k.box('rubber', W - 0.02, 0.012, D - 0.02, 0, 0.006, 0);
  // --- cup dispenser tube (right side) ---
  const tx = W / 2 + 0.05, tz = 0.06;
  k.box(shell, 0.04, 0.05, 0.03, W / 2 + 0.012, 0.86, tz, { r: 0.006 });
  k.box(shell, 0.04, 0.05, 0.03, W / 2 + 0.012, 0.6, tz, { r: 0.006 });
  k.cyl(GLASS(), 0.04, 0.34, tx, 0.72, tz, { seg: 18, open: true });
  k.cyl(shell, 0.044, 0.02, tx, 0.9, tz, { seg: 18 });
  k.tor(shell, 0.042, 0.005, tx, 0.552, tz, { axis: 'y', ts: 18, rs: 5 });
  const cup = gLathe([[0.002, 0], [0.034, 0.085], [0.037, 0.088]], { seg: 14 });
  for (let i = 0; i < 9; i++) k.put(M('paper', { color: 0xc8c4b8 }), cup.clone(), tx, 0.645 + i * 0.025, tz, { rot: [PI, 0, 0] });
  // --- bottle (inverted 5-gal) ---
  const prof = [[0.028, 0], [0.028, 0.055], [0.036, 0.068], [0.08, 0.09], [0.12, 0.118], [0.134, 0.15], [0.134, 0.2], [0.127, 0.21], [0.134, 0.22],
    [0.134, 0.3], [0.127, 0.31], [0.134, 0.32], [0.134, 0.41], [0.126, 0.45], [0.095, 0.476], [0.04, 0.488], [0.0, 0.49]];
  const by = top + 0.02;
  const bottle = k.lathe(M('glass', { color: 0x8fc4f0, opacity: 0.22, roughness: 0.12, envMapIntensity: 1.0 }), prof, 0, by, 0, { seg: 28, sep: true, name: 'bottle' });
  bottle.renderOrder = 2;
  k.cyl(M('plastic_blue', { color: 0x2b6fd0 }), 0.031, 0.018, 0, by + 0.008, 0, { seg: 16 });
  // water (origin at the neck so scale.y drains toward it)
  const lvl = 0.42;
  const wprof = [[0.0, 0.004], [0.026, 0.004]].concat(prof.filter(([r, y]) => y > 0.004 && y < lvl).map(([r, y]) => [r * 0.94, y]), [[0.126, lvl], [0.0, lvl]]);
  const water = k.lathe(M('glass', { color: 0x3a8ad8, opacity: 0.42, roughness: 0.05, envMapIntensity: 0.8 }), wprof, 0, by, 0, { seg: 24, sep: true, name: 'water' });
  water.renderOrder = 1;
  const bub = k.grp(0, by + 0.06, 0, { name: 'bubbleOrigin' });
  // label band
  const lab = A.add(400, 80, (c, w, h) => {
    c.fillStyle = '#f4f2ea'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f4f8a'; c.fillRect(0, 0, w, h * 0.12); c.fillRect(0, h * 0.88, w, h * 0.12);
    txt(c, 'R.O.O.M. SPRING', w * 0.35, h * 0.42, h * 0.32, { col: '#1f4f8a' });
    txt(c, '100% COMPLIANT HYDRATION • 18.9 L', w * 0.35, h * 0.72, h * 0.15, { col: '#333', f: 'mono', maxW: w * 0.6 });
    drawLogo(c, w * 0.85, h * 0.5, h * 0.3, '#1f4f8a', { text: false });
  });
  k.clabel(lab, 0.1355, 0.07, 2.2, 0, by + 0.265, 0, { seg: 18 });
  k.collide(cbox(W, top, D, 0, top / 2, 0));
  k.collide(ccyl(0.135, 0.49, 0, by + 0.245, 0));
  k.anchors.tap = V3(-0.05, 0.625, 0.11);
  k.anchors.tapHot = V3(0.05, 0.625, 0.11);
  k.anchors.cups = V3(tx, 0.55, tz);
  k.parts.water = water;
  k.parts.bubbleOrigin = bub;
  k.parts.bottle = bottle;
  return k.done({ mass: 38, material: 'plastic' });
}

// ---------------------------------------------------------------------------
// Aquarium
// ---------------------------------------------------------------------------
function gravelTexMat() {
  const m = canvasMat('aq_gravel', 256, 256, (c, w, h) => {
    c.fillStyle = '#3a3326'; c.fillRect(0, 0, w, h);
    const r = new RNG(31);
    const cols = ['#c9b48a', '#8a7a5a', '#d8d0c0', '#5a6a8a', '#a0584a', '#e0c070', '#6a8a6a', '#ffffff', '#3a3a3a'];
    for (let i = 0; i < 1400; i++) {
      const x = r.next() * w, y = r.next() * h, rr = r.range(2, 5.5);
      c.fillStyle = r.pick(cols);
      for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { c.beginPath(); c.ellipse(x + dx, y + dy, rr, rr * r.range(0.6, 1), r.next() * 3, 0, TAU); c.fill(); }
    }
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 600; i++) { const x = r.next() * w, y = r.next() * h; c.fillRect(x, y, 1.5, 1.5); }
  }, { roughness: 0.75 }, 6);
  if (!m.userData.caustic) { withCaustics(m, 0.4); m.userData.caustic = true; }
  return m;
}
function gLeaf(len, wid, bend, twist = 0) {
  const g = new THREE.PlaneGeometry(wid, len, 1, 6);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / len, x = p.getX(i);
    const taper = Math.sin(Math.min(1, t * 1.15) * PI * 0.92 + 0.12);
    p.setX(i, x * taper + Math.sin(t * PI * 0.8) * twist * len * 0.2);
    p.setZ(i, bend * t * t * len);
    p.setY(i, y * (1 - Math.abs(bend) * 0.25 * t));
  }
  g.computeVertexNormals();
  return g;
}

function b_aquarium(o) {
  const k = new Kit('aquarium');
  const A = k.useAtlas(512, 512);
  const r = new RNG(o.seed ?? 12);
  const wood = M('wood_dark', { color: 0x6a4a34 });
  const SW = 1.24, SH = 0.86, SD = 0.52;
  // --- stand cabinet ---
  k.box(wood, SW, 0.05, SD, 0, SH - 0.025, 0, { r: 0.008 });
  k.box(wood, SW - 0.02, SH - 0.13, SD - 0.04, 0, 0.08 + (SH - 0.13) / 2, -0.01);
  k.box(M('wood_dark', { color: 0x3e2a1c }), SW - 0.06, 0.08, SD - 0.08, 0, 0.04, -0.01);
  for (let i = 0; i < 2; i++) {
    const x = (i ? 1 : -1) * 0.3;
    k.box(wood, 0.58, 0.64, 0.02, x, 0.43, SD / 2 - 0.02, { r: 0.006 });
    k.box(M('wood_dark', { color: 0x5a3c28 }), 0.48, 0.54, 0.01, x, 0.43, SD / 2 - 0.006, { r: 0.004 });
    k.sph('brass', 0.014, (i ? 1 : -1) * 0.04, 0.5, SD / 2 + 0.006, { ws: 10, hs: 8 });
  }
  const plate = A.add(220, 44, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e8c878'); g.addColorStop(1, '#9a7a32');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    txt(c, 'MORALE AQUARIUM', w / 2, h * 0.38, h * 0.32, { col: '#3a2808', f: 'serif' });
    txt(c, 'Do not tap glass. Do not name fish.', w / 2, h * 0.75, h * 0.18, { col: '#3a2808', f: 'serif', i: true, maxW: w * 0.92 });
  });
  k.label(plate, 0.22, 0.044, 0, 0.8, SD / 2 + 0.002, { metal: 0.8, rough: 0.35 });
  // --- tank ---
  const TW = 1.2, TD = 0.5, TH = 0.5, ty = SH + 0.02;
  const trim = M('plastic_black', { color: 0x141414 });
  k.ext(trim, frameShape(TW + 0.02, TD + 0.02, 0.008, TW - 0.02, TD - 0.02, 0.004), 0.025, 0, SH, 0, { rot: [-HP, 0, 0] });
  k.box(trim, TW, 0.006, TD, 0, SH + 0.003, 0);
  k.ext(trim, frameShape(TW + 0.02, TD + 0.02, 0.008, TW - 0.03, TD - 0.03, 0.004), 0.02, 0, ty + TH - 0.01, 0, { rot: [-HP, 0, 0] });
  const gm = CLEAR({ env: 1.3, tint: 0x020403 });
  const pane = (w, h, x, y, z, ry, name) => { const m = k.mesh(gm, gBox(w, h, 0.008), x, y, z, { rot: [0, ry, 0], name, shadow: false }); m.renderOrder = 3; return m; };
  k.parts.glass = [
    pane(TW, TH, 0, ty + TH / 2, TD / 2, 0, 'glass_front'),
    pane(TW, TH, 0, ty + TH / 2, -TD / 2, 0, 'glass_back'),
    pane(TD - 0.016, TH, -TW / 2, ty + TH / 2, 0, HP, 'glass_left'),
    pane(TD - 0.016, TH, TW / 2, ty + TH / 2, 0, HP, 'glass_right'),
  ];
  // background print on the back pane (outside)
  const bgArt = A.add(384, 160, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0e4a6a'); g.addColorStop(1, '#06222e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const rr = new RNG(3);
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = `rgba(30,${90 + rr.next() * 60},60,0.8)`; c.lineWidth = rr.range(3, 8);
      const x = rr.next() * w; c.beginPath(); c.moveTo(x, h); c.quadraticCurveTo(x + rr.range(-30, 30), h * 0.5, x + rr.range(-20, 20), h * rr.range(0.1, 0.6)); c.stroke();
    }
  });
  k.label(bgArt, TW - 0.02, TH - 0.02, 0, ty + TH / 2, -TD / 2 - 0.006, { rot: [0, PI, 0] });
  k.label(bgArt, TW - 0.02, TH - 0.02, 0, ty + TH / 2, -TD / 2 - 0.0045);
  // water volume (origin at the tank floor)
  const wh = TH - 0.04, wx = TW / 2 - 0.006, wz = TD / 2 - 0.006;
  const wmat = volumeMat({ shape: 'box', min: [-wx, 0, -wz], max: [wx, wh, wz], tint: 0x3a9a8c, deep: 0x0b4446, glow: 0x0a2a26, density: 2.4, a0: 0.04, a1: 0.5, rough: 0.3, env: 0.3 });
  const water = k.mesh(wmat, new THREE.BoxGeometry(wx * 2, wh, wz * 2).translate(0, wh / 2, 0), 0, ty, 0, { name: 'water', shadow: false });
  water.renderOrder = 2;
  // gravel bed (sloped toward the back)
  const gmat = gravelTexMat();
  const gg = new THREE.PlaneGeometry(TW - 0.016, TD - 0.016, 30, 12);
  gg.rotateX(-HP);
  const gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, 0.035 + (-z / TD + 0.5) * 0.035 + Math.sin(x * 9) * 0.006 + Math.cos(x * 23 + z * 17) * 0.004);
  }
  gg.computeVertexNormals();
  scaleUV(gg, TW, TD);
  k.put(gmat, gg, 0, ty, 0);
  k.put(gmat, scaleUV(new THREE.PlaneGeometry(TW - 0.016, 0.04), TW, 0.04), 0, ty + 0.02, TD / 2 - 0.009);
  // castle ornament
  const stone = withCaustics(M('concrete', { color: 0xa49c8c }).clone(), 0.35);
  stone.customProgramCacheKey = () => 'roomcaustic';
  k.push(-0.3, ty + 0.045, -0.06, [0, 0.3, 0]);
  k.box(stone, 0.16, 0.08, 0.1, 0, 0.04, 0);
  for (const sx of [-1, 1]) {
    k.cyl(stone, 0.035, 0.16, sx * 0.075, 0.08, 0, { seg: 12 });
    k.cyl(stone, 0.042, 0.02, sx * 0.075, 0.17, 0, { seg: 12 });
    if (sx > 0) for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.box(stone, 0.014, 0.018, 0.014, sx * 0.075 + Math.cos(a) * 0.035, 0.188, Math.sin(a) * 0.035); }
    if (sx < 0) k.cyl(M('plastic_red', { color: 0x9a2a1a }), 0.001, 0.08, sx * 0.075, 0.22, 0, { seg: 12, r2: 0.047 });
  }
  for (let i = 0; i < 4; i++) k.box(stone, 0.02, 0.02, 0.1, -0.045 + i * 0.03, 0.09, 0);
  k.box(M('plastic_black', { color: 0x0a0a0a }), 0.04, 0.05, 0.004, 0, 0.025, 0.051);
  k.cyl(M('plastic_black', { color: 0x0a0a0a }), 0.02, 0.004, 0, 0.05, 0.051, { axis: 'z', seg: 10, tl: PI, t0: -HP });
  k.pop();
  // rocks + driftwood
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(r.range(0.025, 0.05), 0);
    k.put(stone, boxUV(g), r.range(-0.5, 0.5), ty + 0.04, r.range(-0.18, 0.1), { s: [1, r.range(0.5, 0.8), 1], rot: [0, r.next() * 3, 0] });
  }
  k.tube(M('wood_dark', { color: 0x4a3424 }), [[0.15, ty + 0.05, -0.15], [0.25, ty + 0.1, -0.1], [0.32, ty + 0.2, -0.12], [0.36, ty + 0.27, -0.08]], 0.018, { rs: 6, ts: 14 });
  // plants (each a pivot at its base on the gravel)
  const plantMats = [M('plastic_green', { color: 0x2f7a32, side: THREE.DoubleSide, roughness: 0.6 }), M('plastic_green', { color: 0x5aa03a, side: THREE.DoubleSide }), M('plastic_red', { color: 0x9a3a2a, side: THREE.DoubleSide })];
  const spots = [[-0.48, -0.16], [-0.38, -0.18], [-0.12, -0.19], [0.05, -0.17], [0.42, -0.17], [0.5, -0.05], [-0.52, 0.05], [0.2, -0.2]];
  k.parts.plants = spots.map(([x, z], i) => {
    const pg = k.grp(x, ty + 0.05, z, { name: 'plant_' + i });
    const tall = i % 3 !== 1;
    const mat = plantMats[i === 4 ? 2 : i % 2];
    k.inside(pg, () => {
      const n = tall ? 7 : 5;
      for (let j = 0; j < n; j++) {
        const len = tall ? r.range(0.22, 0.4) : r.range(0.1, 0.18);
        const g = gLeaf(len, tall ? 0.018 : 0.045, r.range(-0.4, 0.4), r.range(-0.5, 0.5));
        g.rotateY((j / n) * TAU + r.next());
        g.rotateX(r.range(-0.15, 0.15));
        k.put(mat, g, r.range(-0.01, 0.01), 0, r.range(-0.01, 0.01));
      }
    });
    return pg;
  });
  // air stone + bubbler
  k.cyl(M('plastic_grey', { color: 0x9aa0a8 }), 0.022, 0.025, 0.28, ty + 0.06, -0.15, { seg: 12 });
  const bubbler = k.grp(0.28, ty + 0.075, -0.15, { name: 'bubbler' });
  k.tube(M('rubber', { color: 0x9ac8c0, roughness: 0.3 }), [[0.28, ty + 0.07, -0.16], [0.3, ty + 0.25, -0.22], [0.31, ty + 0.48, -0.235], [0.33, ty + 0.53, -0.25], [0.36, ty + 0.5, -0.29], [0.38, SH + 0.02, -0.3]], 0.003, { rs: 5, ts: 30 });
  k.box(M('plastic_white', { color: 0xc8c4b8 }), 0.12, 0.05, 0.08, 0.45, SH + 0.025, -SD / 2 + 0.05, { r: 0.012 });
  // hang-on-back filter
  const fm = M('plastic_black', { color: 0x202224 });
  k.box(fm, 0.2, 0.18, 0.09, -0.35, ty + TH - 0.06, -TD / 2 - 0.05, { r: 0.012 });
  k.box(fm, 0.18, 0.02, 0.07, -0.35, ty + TH + 0.025, -TD / 2 - 0.0, { r: 0.006 });
  k.box(fm, 0.14, 0.012, 0.04, -0.35, ty + TH - 0.02, -TD / 2 + 0.025);
  k.cyl(M('glass', { color: 0x9fc0c0, opacity: 0.4 }), 0.012, 0.36, -0.39, ty + TH - 0.2, -TD / 2 + 0.03, { seg: 10 });
  k.cyl(fm, 0.018, 0.05, -0.39, ty + 0.07, -TD / 2 + 0.03, { seg: 10 });
  // hood with light strip
  const hood = M('plastic_black', { color: 0x18191b, roughness: 0.5 });
  k.box(hood, TW + 0.02, 0.06, TD + 0.02, 0, ty + TH + 0.04, 0, { r: 0.012 });
  k.box(M('plastic_black', { color: 0x262729 }), 0.3, 0.004, 0.16, 0.25, ty + TH + 0.071, 0.06, { r: 0.002 });
  k.box('chrome', 0.04, 0.008, 0.01, 0.25, ty + TH + 0.073, 0.135, { r: 0.002 });
  const light = k.box(own('emissive_white', { color: 0xdff6ff, emissive: 0xcfeeff, emissiveIntensity: 1.3 }), TW - 0.12, 0.008, 0.04, 0, ty + TH + 0.006, 0.05, { sep: true, name: 'light' });
  const hl = A.add(160, 26, (c, w, h) => { txt(c, 'R.O.O.M. AQUATICS', w / 2, h / 2, h * 0.6, { col: '#bbb', f: 'bold' }); });
  k.label(hl, 0.16, 0.026, 0, ty + TH + 0.04, TD / 2 + 0.011);
  // thermometer sticker
  const th = A.add(28, 140, (c, w, h) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { c.fillStyle = i === 4 ? '#3f6' : '#235'; c.fillRect(4, 8 + i * 15, w - 8, 12); txt(c, String(20 + i * 2), w / 2, 14 + i * 15, 9, { col: i === 4 ? '#000' : '#79a', f: 'mono' }); }
  });
  k.label(th, 0.022, 0.11, 0.52, ty + 0.3, TD / 2 + 0.0045);
  // colliders / anchors
  k.collide(cbox(SW, SH, SD, 0, SH / 2, 0));
  k.collide(cbox(TW + 0.02, TH + 0.1, TD + 0.02, 0, ty + (TH + 0.1) / 2 - 0.01, 0));
  k.anchors.tankMin = V3(-wx + 0.03, ty + 0.1, -wz + 0.03);
  k.anchors.tankMax = V3(wx - 0.03, ty + wh - 0.03, wz - 0.03);
  k.anchors.surface = V3(0, ty + wh, 0);
  k.parts.water = water;
  k.parts.bubbler = bubbler;
  k.parts.light = light;
  return k.done({ mass: 320, material: 'glass' });
}

// ---------------------------------------------------------------------------
// Service bell
// ---------------------------------------------------------------------------
function b_service_bell(o) {
  const k = new Kit('service_bell');
  const brass = M('brass', { roughness: 0.25 });
  k.lathe(M('plastic_black', { color: 0x161616, roughness: 0.35 }), [[0, 0], [0.044, 0], [0.047, 0.004], [0.047, 0.01], [0.043, 0.014], [0, 0.014]], 0, 0, 0, { seg: 32 });
  k.lathe(brass, [[0.04, 0.0142], [0.043, 0.0145], [0.0425, 0.02], [0.041, 0.03], [0.036, 0.039], [0.026, 0.046], [0.012, 0.0495], [0.0, 0.05]], 0, 0, 0, { seg: 32 });
  k.cyl(brass, 0.0045, 0.006, 0, 0.053, 0, { seg: 12 });
  const pl = k.grp(0, 0, 0, { name: 'plunger' });
  k.inside(pl, () => {
    k.cyl(brass, 0.0025, 0.014, 0, 0.06, 0, { seg: 10 });
    k.sph(brass, 0.0075, 0, 0.069, 0, { ws: 14, hs: 10, s: [1, 0.75, 1] });
  });
  k.collide(ccyl(0.047, 0.075, 0, 0.0375, 0));
  k.parts.plunger = pl;
  k.anchors.top = V3(0, 0.075, 0);
  return k.done({ mass: 0.4, material: 'metal' });
}

// ---------------------------------------------------------------------------
// CRT terminal (monitor + keyboard + tower)
// ---------------------------------------------------------------------------
function keyboard(k, x, y, z, o = NO) {
  const kb = o.mat || M('plastic_beige', { color: 0xa69d80 });
  const keyM = M('plastic_beige', { color: 0xc4bca0 });
  const modM = M('plastic_grey', { color: 0x858176 });
  const u = 0.019, W = 0.46, D = 0.17;
  k.push(x, y, z);
  k.taper(kb, W, 0.03, D, 1, 0.55, 0, 0.015, 0, { dy: -0.006, rot: [0, PI, 0] });
  k.box(kb, W, 0.006, D, 0, 0.003, 0, { r: 0.002 });
  const rows = [
    [[1, 1], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [2, 1]],
    [[1.5, 1], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1.5, 1]],
    [[1.75, 1], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [2.25, 1]],
    [[2.25, 1], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [2.75, 1]],
    [[1.5, 1], [1.25, 1], [1.25, 1], [6.5, 0], [1.25, 1], [1.25, 1], [1.5, 1]],
  ];
  const x0 = -W / 2 + 0.012, zr = D / 2 - 0.035;
  rows.forEach((row, ri) => {
    let cx = x0;
    const kz = zr - (4 - ri) * u * 1.02 - 0.012, ky = 0.024 + (4 - ri) * 0.002;
    for (const [wu, mod] of row) {
      const kw = wu * u - 0.003;
      k.taper(mod ? modM : keyM, kw, u - 0.003, 0.009, 0.82, 0.8, cx + (wu * u) / 2, ky + 0.0045, kz, { uv: false, rot: [HP, 0, 0] });
      cx += wu * u;
    }
  });
  // F-row
  for (let i = 0; i < 12; i++) k.taper(modM, u - 0.004, u * 0.8, 0.008, 0.82, 0.8, x0 + u * (1.5 + i * 1.05), 0.038, zr - 5 * u - 0.02, { uv: false, rot: [HP, 0, 0] });
  // numpad
  for (let r2 = 0; r2 < 5; r2++) for (let c = 0; c < 4; c++) k.taper(c === 3 ? modM : keyM, u - 0.003, u - 0.003, 0.009, 0.82, 0.8, W / 2 - 0.012 - (3.5 - c) * u, 0.024 + (4 - r2) * 0.002 + 0.0045, zr - (4 - r2) * u * 1.02 - 0.012, { uv: false, rot: [HP, 0, 0] });
  for (let i = 0; i < 3; i++) k.box(o.led || M('plastic_green', { color: 0x2a8a3a }), 0.004, 0.002, 0.003, W / 2 - 0.06 + i * 0.012, 0.031, -D / 2 + 0.012);
  k.pop();
}
function b_crt_terminal(o) {
  const k = new Kit('crt_terminal');
  const A = k.useAtlas(512, 256);
  const shell = M('plastic_beige', { color: 0xb3aa8a });
  // monitor
  k.push(-0.06, 0, -0.1);
  const mon = crtMonitor(k, 'main', { sw: 0.28, shell, text: o.text ?? 'R.O.O.M. OS v2.1\nC:\\> LOGIN_\n\nWELCOME, EMPLOYEE', badge: 'R.O.O.M. VISION 14' });
  k.pop();
  const sc = mon.screen.position;
  // sticky notes on the bezel
  const note = A.add(64, 64, (c, w, h) => { c.fillStyle = '#f7e36a'; c.fillRect(0, 0, w, h); txt(c, 'PASSWORD:', w / 2, h * 0.3, 10, { col: '#2a2aa0', f: 'mono' }); txt(c, 'ROOM123', w / 2, h * 0.55, 13, { col: '#2a2aa0', f: 'mono' }); });
  k.label(note, 0.05, 0.05, -0.06 + mon.bw / 2 - 0.035, mon.cy + mon.bh / 2 - 0.06, -0.1 + 0.003, { rot: [0, 0, -0.12] });
  // keyboard
  keyboard(k, -0.06, 0, 0.21, {});
  cable(k, [[-0.06, 0.01, 0.12], [-0.02, 0.006, 0.05], [0.05, 0.006, 0.0], [0.15, 0.006, -0.1], [0.24, 0.02, -0.2]], 0.003, M('plastic_beige', { color: 0xb8b09a }));
  // mouse + pad
  const pad = A.add(128, 112, (c, w, h) => { c.fillStyle = '#1d3a6a'; c.fillRect(0, 0, w, h); drawLogo(c, w * 0.6, h * 0.82, 18, '#8fb0e0'); c.strokeStyle = '#4a6a9a'; c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8); });
  k.box(M('rubber', { color: 0x1a1a1a }), 0.22, 0.003, 0.19, 0.3, 0.0015, 0.2);
  k.label(pad, 0.215, 0.185, 0.3, 0.0032, 0.2, { rot: [-HP, 0, 0] });
  k.box(shell, 0.06, 0.03, 0.1, 0.31, 0.018, 0.21, { r: 0.014 });
  k.box(M('plastic_beige', { color: 0xbdb498 }), 0.027, 0.004, 0.04, 0.296, 0.033, 0.185, { r: 0.002 });
  k.box(M('plastic_beige', { color: 0xbdb498 }), 0.027, 0.004, 0.04, 0.325, 0.033, 0.185, { r: 0.002 });
  cable(k, [[0.31, 0.012, 0.16], [0.3, 0.006, 0.08], [0.33, 0.006, -0.05], [0.34, 0.03, -0.12]], 0.0025, M('plastic_beige', { color: 0xb8b09a }));
  // tower
  const tx = 0.4, tz = -0.12, tw = 0.18, th = 0.42, td = 0.42;
  k.box(shell, tw, th, td, tx, th / 2 + 0.01, tz, { r: 0.008 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('rubber', 0.03, 0.01, 0.03, tx + x * 0.06, 0.005, tz + z * 0.17);
  const fz = tz + td / 2;
  k.box(M('plastic_beige', { color: 0xc4bb9c }), tw - 0.02, th - 0.03, 0.01, tx, th / 2 + 0.01, fz + 0.002, { r: 0.004 });
  for (let i = 0; i < 2; i++) {
    k.box(M('plastic_beige', { color: 0xd8d0b4 }), 0.148, 0.042, 0.006, tx, 0.37 - i * 0.05, fz + 0.008, { r: 0.002 });
    k.box('plastic_black', 0.1, 0.004, 0.004, tx, 0.37 - i * 0.05, fz + 0.011);
  }
  k.box(M('plastic_beige', { color: 0xd8d0b4 }), 0.11, 0.028, 0.006, tx, 0.26, fz + 0.008, { r: 0.002 });
  k.box('plastic_black', 0.09, 0.003, 0.004, tx, 0.265, fz + 0.011);
  k.box('plastic_grey', 0.016, 0.008, 0.004, tx + 0.04, 0.253, fz + 0.011);
  pushButton(k, tx, 0.12, fz + 0.006, 0.014, { mat: M('plastic_grey', { color: 0x8a8678 }), ring: shell, name: 'power' });
  k.box(M('plastic_grey', { color: 0x8a8678 }), 0.02, 0.012, 0.008, tx - 0.05, 0.19, fz + 0.01, { r: 0.002 });
  k.cyl('chrome', 0.007, 0.008, tx + 0.05, 0.19, fz + 0.01, { axis: 'z', seg: 12 });
  k.parts.leds = [lamp(k, tx - 0.03, 0.155, fz + 0.007, 0.003, 'green', { name: 'ledPower', bezel: 'plastic_black' }), lamp(k, tx + 0.03, 0.155, fz + 0.007, 0.003, 'amber', { name: 'ledDisk', bezel: 'plastic_black' })];
  const tb = A.add(160, 40, (c, w, h) => { c.fillStyle = '#2a2a2a'; rrect(c, 0, 0, w, h, 6); c.fill(); txt(c, 'R.O.O.M. 486DX', w / 2, h * 0.4, h * 0.36, { col: '#e8c860' }); txt(c, 'TURBO 66MHz', w / 2, h * 0.76, h * 0.2, { col: '#bbb', f: 'mono' }); });
  k.label(tb, 0.1, 0.025, tx, 0.06, fz + 0.0075);
  slots(k, tx, 0.3, tz - td / 2 - 0.001, 0.1, 0.12, 6, {});
  cable(k, [[tx - 0.04, 0.3, tz - td / 2], [tx - 0.08, 0.2, tz - td / 2 - 0.06], [tx - 0.2, 0.02, tz - td / 2 - 0.08], [-0.1, 0.01, -0.5]], 0.004, 'rubber');
  // floppy disk lying on the desk
  const fd = A.add(64, 64, (c, w, h) => { c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#aaa'; c.fillRect(w * 0.3, 0, w * 0.4, h * 0.3); c.fillStyle = '#eee'; c.fillRect(w * 0.15, h * 0.45, w * 0.7, h * 0.5); txt(c, 'BACKUP', w / 2, h * 0.62, 11, { col: '#c00', f: 'mono' }); txt(c, 'DO NOT LOSE', w / 2, h * 0.8, 7, { col: '#333', f: 'mono' }); });
  k.labelBox({ py: fd, side: A.solid('#1a1a1a') }, 0.09, 0.003, 0.094, -0.36, 0.0015, 0.12, { rot: [0, 0.4, 0] });
  const ty0 = mon.cy;
  k.collide(cbox(mon.bw, mon.bh + 0.06, 0.34, -0.06, (mon.bh + 0.06) / 2, -0.24));
  k.collide(cbox(0.46, 0.04, 0.17, -0.06, 0.02, 0.21));
  k.collide(cbox(tw, th + 0.01, td, tx, (th + 0.01) / 2, tz));
  k.anchors.view = V3(sc.x, sc.y, sc.z + 0.55);
  k.anchors.screenCenter = V3(sc.x, sc.y, sc.z);
  k.anchors.keyboard = V3(-0.06, 0.035, 0.21);
  k.parts.powerLed = mon.led;
  return k.done({ mass: 26, material: 'plastic' });
}

// ---------------------------------------------------------------------------
// Dart board (wall-mounted; origin = board center on the wall plane, front +Z)
// ---------------------------------------------------------------------------
let _dartTex = null;
function dartBoardTexture() {
  if (_dartTex) return _dartTex;
  const S = 1024, R = 0.225, px = S / 2 / R;
  _dartTex = labelTexture(S, S, (c) => {
    const cx = S / 2, cy = S / 2;
    c.fillStyle = '#121110'; c.beginPath(); c.arc(cx, cy, S / 2, 0, TAU); c.fill();
    const sector = (r0, r1, a0, a1, col) => {
      c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r1 * px, a0, a1); c.arc(cx, cy, r0 * px, a1, a0, true); c.closePath(); c.fill();
    };
    for (let i = 0; i < 20; i++) {
      const a = (i * 18 - 90) * DEG, a0 = a - 9 * DEG, a1 = a + 9 * DEG;
      const single = i % 2 ? '#c9b98f' : '#141312', ring = i % 2 ? '#1a6a34' : '#a82018';
      sector(0.162, 0.17, a0, a1, ring);
      sector(0.107, 0.162, a0, a1, single);
      sector(0.099, 0.107, a0, a1, ring);
      sector(0.0159, 0.099, a0, a1, single);
    }
    c.fillStyle = '#1d7a3c'; c.beginPath(); c.arc(cx, cy, 0.0159 * px, 0, TAU); c.fill();
    c.fillStyle = '#c4261c'; c.beginPath(); c.arc(cx, cy, 0.00635 * px, 0, TAU); c.fill();
    // sisal fibres
    const r = new RNG(77);
    for (let i = 0; i < 26000; i++) {
      const x = r.next() * S, y = r.next() * S;
      const ang = r.next() * TAU, l = r.range(1, 4);
      c.strokeStyle = r.next() < 0.5 ? `rgba(255,240,210,${r.range(0.03, 0.12)})` : `rgba(0,0,0,${r.range(0.05, 0.18)})`;
      c.lineWidth = r.range(0.5, 1.4);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); c.stroke();
    }
    // dart holes (mostly around T20, D20 and the bull)
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 260; i++) {
      const pick = r.next();
      let rr, aa;
      if (pick < 0.4) { rr = r.range(0.095, 0.112); aa = -HP + r.range(-0.18, 0.18); } else if (pick < 0.6) { rr = r.range(0, 0.03); aa = r.next() * TAU; } else { rr = r.range(0.02, 0.17); aa = r.next() * TAU; }
      c.beginPath(); c.arc(cx + Math.cos(aa) * rr * px, cy + Math.sin(aa) * rr * px, r.range(0.8, 1.6), 0, TAU); c.fill();
    }
    // numbers (upright, white, on the black outer band)
    DART_ORDER.forEach((n, i) => {
      const a = (i * 18 - 90) * DEG;
      txt(c, String(n), cx + Math.cos(a) * 0.196 * px, cy + Math.sin(a) * 0.196 * px, 0.024 * px, { col: '#f2efe6', f: 'bold', w: 'bold' });
    });
    // subtle radial vignette
    const g = c.createRadialGradient(cx, cy, S * 0.3, cx, cy, S * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
  });
  return _dartTex;
}
function b_dart_board(o) {
  const k = new Kit('dart_board');
  const A = k.useAtlas(512, 512);
  const wood = M('wood_dark', { color: 0x7a4a2c });
  const CW = 0.62, CH = 0.66, CD = 0.1, R = 0.225, BT = 0.038;
  // cabinet (back, sides, top/bottom), dark felt surround
  k.box(wood, CW, CH, 0.015, 0, 0, 0.0075);
  k.box(M('fabric_grey', { color: 0x1c1d1f }), CW - 0.04, CH - 0.04, 0.004, 0, 0, 0.017);
  for (const sx of [-1, 1]) k.box(wood, 0.02, CH, CD, sx * (CW / 2 - 0.01), 0, CD / 2, { r: 0.004 });
  for (const sy of [-1, 1]) k.box(wood, CW, 0.02, CD, 0, sy * (CH / 2 - 0.01), CD / 2, { r: 0.004 });
  k.box(wood, CW + 0.02, 0.025, CD + 0.02, 0, CH / 2 + 0.0125, CD / 2, { r: 0.006 });
  const plate = A.add(200, 40, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f0d488'); g.addColorStop(1, '#9a7a32');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    txt(c, 'R.O.O.M. RECREATION DEPT.', w / 2, h / 2, h * 0.42, { col: '#3a2808', f: 'serif', maxW: w * 0.92 });
  });
  k.label(plate, 0.2, 0.04, 0, CH / 2 - 0.045, CD + 0.001, { metal: 0.6, rough: 0.45 });
  // board
  const bz = 0.019;
  k.cyl(M('plastic_black', { color: 0x121212, roughness: 0.8 }), R, BT, 0, 0, bz + BT / 2, { axis: 'z', seg: 64 });
  k.cyl(M('metal_dark', { roughness: 0.5 }), 0.03, 0.012, 0, 0, bz + 0.004, { axis: 'z', seg: 16 });
  const face = new THREE.MeshStandardMaterial({ map: dartBoardTexture(), roughness: 0.95, metalness: 0 });
  face.name = 'dart_face';
  const zf = bz + BT;
  k.disc(face, R, 0, 0, zf + 0.0002, { seg: 72, uv: false });
  // wire spider
  const wire = M('chrome', { roughness: 0.35, color: 0xb8bcc0 });
  for (const rr of [0.00635, 0.0159, 0.099, 0.107, 0.162, 0.17]) k.tor(wire, rr, 0.0006, 0, 0, zf + 0.0006, { rs: 3, ts: rr < 0.02 ? 16 : 72 });
  for (let i = 0; i < 20; i++) {
    const a = (90 - i * 18 + 9) * DEG, r0 = 0.0159, r1 = 0.17;
    k.box(wire, r1 - r0, 0.0011, 0.0011, Math.cos(a) * (r0 + r1) / 2, Math.sin(a) * (r0 + r1) / 2, zf + 0.0006, { rot: [0, 0, a], uv: false });
  }
  k.tor(wire, 0.212, 0.0008, 0, 0, zf + 0.0006, { rs: 3, ts: 72 });
  // doors (open, showing chalkboard scoreboards)
  const chalk = A.add(150, 330, (c, w, h) => {
    c.fillStyle = '#1e2a24'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 30; i++) c.fillRect(Math.random() * w, Math.random() * h, 30, 4);
    c.strokeStyle = 'rgba(240,240,230,0.8)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(w / 2, 40); c.lineTo(w / 2, h - 20); c.moveTo(10, 40); c.lineTo(w - 10, 40); c.stroke();
    txt(c, 'CLONE A', w * 0.27, 24, 15, { col: '#eee', f: 'mono' }); txt(c, 'CLONE B', w * 0.74, 24, 15, { col: '#eee', f: 'mono' });
    const a = ['501', '441', '380', '301', '245', '180', '121'], b = ['501', '461', '401', '357', '297', '☠'];
    a.forEach((s, i) => txt(c, s, w * 0.27, 62 + i * 30, 17, { col: i < a.length - 1 ? 'rgba(230,230,220,0.55)' : '#f4f4ea', f: 'mono' }));
    b.forEach((s, i) => txt(c, s, w * 0.74, 62 + i * 30, 17, { col: i < b.length - 1 ? 'rgba(230,230,220,0.55)' : '#f4f4ea', f: 'mono' }));
  });
  const DW = CW / 2;
  k.parts.doors = [];
  for (const sx of [-1, 1]) {
    const hinge = k.grp(sx * CW / 2, 0, CD, { name: sx < 0 ? 'doorLeft' : 'doorRight' });
    k.inside(hinge, () => {
      k.box(wood, DW, CH, 0.018, -sx * DW / 2, 0, 0.009, { r: 0.004 });
      k.box(M('wood_dark', { color: 0x5e3820 }), DW - 0.05, CH - 0.06, 0.006, -sx * DW / 2, 0, 0.019, { r: 0.003 });
      k.label(chalk, DW - 0.04, CH - 0.05, -sx * DW / 2, 0, -0.0005, { rot: [0, PI, 0] });
      k.sph('brass', 0.008, -sx * (DW - 0.03), 0, 0.024, { ws: 10, hs: 8 });
      for (const y of [-0.22, 0.22]) k.cyl('brass', 0.005, 0.05, 0, y, 0.0, { seg: 8 });
    });
    hinge.rotation.y = sx * 165 * DEG;
    k.parts.doors.push(hinge);
  }
  k.parts.doorLeft = k.parts.doors[0];
  k.parts.doorRight = k.parts.doors[1];
  k.collide(cbox(CW, CH, 0.02, 0, 0, 0.01));
  k.collide(ccyl(R, BT, 0, 0, bz + BT / 2, [HP, 0, 0]));
  for (const sx of [-1, 1]) k.collide(cbox(0.02, CH, CD, sx * (CW / 2 - 0.01), 0, CD / 2));
  k.anchors.center = V3(0, 0, zf);
  k.params.boardRadius = R;
  k.params.faceZ = zf;
  return k.done({ mass: 7, material: 'wood' });
}

// ---------------------------------------------------------------------------
// Lockers
// ---------------------------------------------------------------------------
function hazmatSuit(k, x, y, z, s = 1) {
  const yel = M('hazmat_yellow');
  const blk = M('rubber', { color: 0x1b1b1b });
  const refl = M('metal', { color: 0x9a9a9a, roughness: 0.5 });
  k.push(x, y, z, null, s);
  // hanger
  k.tube('chrome', [[-0.16, -0.08, 0], [0, 0, 0], [0.16, -0.08, 0]], 0.003, { rs: 4, ts: 10, ct: 'centripetal' });
  k.tor('chrome', 0.02, 0.003, 0, 0.02, 0, { arc: PI * 1.3, rs: 4, ts: 10 });
  // hood (empty, flopped back) + visor
  k.sph(yel, 0.13, 0, 0.0, -0.06, { ws: 14, hs: 10, s: [1, 0.85, 0.75] });
  k.sph(M('visor', { color: 0x26323a, opacity: 0.85 }), 0.1, 0, 0.0, 0.0, { ws: 12, hs: 8, p0: -0.7, pl: 1.4, t0: 0.9, tl: 1.0, s: [1, 0.7, 0.8], rot: [0, 0, 0] });
  // torso (chubby)
  k.lathe(yel, [[0.05, -0.62], [0.14, -0.6], [0.175, -0.48], [0.18, -0.3], [0.165, -0.14], [0.11, -0.08], [0.05, -0.06]], 0, 0, 0, { seg: 14, s: [1, 1, 0.6] });
  k.box(blk, 0.355, 0.04, 0.22, 0, -0.5, 0, { r: 0.015 });
  // sleeves hanging down
  for (const sx of [-1, 1]) {
    k.tube(yel, [[sx * 0.14, -0.12, 0], [sx * 0.17, -0.3, 0.01], [sx * 0.17, -0.5, 0.02], [sx * 0.165, -0.6, 0.02]], 0.045, { rs: 8, ts: 8 });
    k.cyl(blk, 0.038, 0.06, sx * 0.165, -0.64, 0.02, { seg: 10 });
    k.cyl(refl, 0.048, 0.02, sx * 0.17, -0.54, 0.02, { seg: 10 });
  }
  // legs
  for (const sx of [-1, 1]) {
    k.tube(yel, [[sx * 0.08, -0.58, 0], [sx * 0.09, -0.85, 0.01], [sx * 0.09, -1.08, 0.0]], 0.07, { rs: 8, ts: 8 });
    k.cyl(blk, 0.06, 0.12, sx * 0.09, -1.14, 0.0, { seg: 10 });
    k.cyl(refl, 0.072, 0.025, sx * 0.09, -1.0, 0.0, { seg: 10 });
  }
  k.pop();
}
function lockerInto(k, A, x0, idx, o, mats) {
  const W = 0.45, H = 1.9, D = 0.5, t = 0.012;
  const { body, inner } = mats;
  k.push(x0, 0, 0);
  // shell (sides / top / bottom / back) so the interior is real
  k.box('plastic_black', W - 0.02, 0.08, D - 0.04, 0, 0.04, -0.01);
  k.box(body, t, H - 0.08, D, -W / 2 + t / 2, 0.08 + (H - 0.08) / 2, 0);
  k.box(body, t, H - 0.08, D, W / 2 - t / 2, 0.08 + (H - 0.08) / 2, 0);
  k.box(body, W, t, D, 0, H - t / 2, 0, { r: 0.003 });
  k.box(body, W - 2 * t, t, D - t, 0, 0.08 + t / 2, 0);
  k.box(inner, W - 2 * t, H - 0.08, t, 0, 0.08 + (H - 0.08) / 2, -D / 2 + t / 2);
  // front frame strips
  k.box(body, W, 0.02, 0.01, 0, H - 0.01, D / 2 - 0.005);
  k.box(body, W, 0.02, 0.01, 0, 0.09, D / 2 - 0.005);
  // interior: shelf + hook
  k.box(inner, W - 2 * t, 0.012, D - 0.06, 0, 1.6, -0.02);
  k.box(inner, W - 0.06, 0.02, 0.012, 0, 1.585, D / 2 - 0.04);
  k.tube('chrome', [[0, 1.594, -0.03], [0, 1.57, -0.03], [0, 1.555, 0.0], [0, 1.565, 0.02]], 0.004, { rs: 5, ts: 8 });
  if (o.suit !== false && (idx + (o.suitOffset || 0)) % (o.suitEvery || 1) === 0) hazmatSuit(k, 0, 1.56, -0.02, 0.92);
  // hinges (body side)
  for (const y of [0.3, 1.0, 1.7]) k.cyl('chrome', 0.006, 0.07, -W / 2 + 0.006, y, D / 2 + 0.006, { seg: 8 });
  k.pop();
  // door (pivot at the hinge, left edge)
  const DW = W - 0.016, DH = H - 0.13, dy0 = 0.105;
  const door = k.grp(x0 - W / 2 + 0.008, 0, D / 2 + 0.002, { name: `door_${idx}` });
  let label = null;
  k.inside(door, () => {
    const cx = DW / 2;
    // door leaf with louver openings
    const ds = rrShape(DW, DH, 0.006, cx, dy0 + DH / 2);
    for (const ly of [dy0 + DH - 0.24, dy0 + 0.12]) for (let i = 0; i < 6; i++) ds.holes.push(rrHole(0.22, 0.012, 0.005, cx, ly + (i - 2.5) * 0.024));
    k.ext(body, ds, 0.016, 0, 0, 0, { bev: 0.002, cs: 2 });
    for (const ly of [dy0 + DH - 0.24, dy0 + 0.12]) {
      for (let i = 0; i < 6; i++) k.box(body, 0.22, 0.016, 0.003, cx, ly + (i - 2.5) * 0.024 + 0.002, 0.009, { rot: [-0.9, 0, 0], uv: false });
      k.box(M('plastic_black', { color: 0x0b0b0b }), 0.23, 0.16, 0.002, cx, ly, 0.002);
    }
    // inner stiffener + taped photo inside the door
    k.box(body, 0.05, DH - 0.3, 0.02, cx, dy0 + DH / 2, -0.008);
    const photo = A.add(64, 80, (c, w, h) => { c.fillStyle = '#eee'; c.fillRect(0, 0, w, h); const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#7a9ab0'); g.addColorStop(1, '#4a5a3a'); c.fillStyle = g; c.fillRect(4, 4, w - 8, h - 20); drawClone(c, w / 2, h * 0.55, w * 0.6, { wave: true }); txt(c, 'MOM?', w / 2, h - 8, 10, { col: '#333', f: 'mono' }); c.fillStyle = 'rgba(240,230,170,0.7)'; c.fillRect(w * 0.3, 0, w * 0.4, 8); });
    k.label(photo, 0.08, 0.1, cx + 0.07, 1.3, -0.0005, { rot: [0, PI, -0.08] });
    // name card holder + card (screen)
    k.ext('chrome', frameShape(0.12, 0.045, 0.004, 0.104, 0.032, 0.002), 0.004, cx, 1.56, 0.017, { cs: 2 });
    label = k.screen(`label_${idx}`, 0.104, 0.032, cx, 1.56, 0.0175, { style: 'card', text: o.labelText ?? 'EMPLOYEE', glow: 0.08, rough: 0.6 });
    // number plate
    const num = String((o.start ?? 1) + idx).padStart(3, '0');
    const np = A.add(64, 36, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f0d488'); g.addColorStop(1, '#9a7a32'); c.fillStyle = g; rrect(c, 0, 0, w, h, h / 2); c.fill(); txt(c, num, w / 2, h / 2 + 1, h * 0.62, { col: '#2a1a04', f: 'bold' }); });
    k.label(np, 0.06, 0.034, cx, 1.66, 0.0172, { metal: 0.7, rough: 0.35 });
    // handle: recessed cup + lift lever + padlock hasp
    const hx = DW - 0.06;
    k.box(M('chrome', { roughness: 0.4 }), 0.05, 0.13, 0.008, hx, 1.0, 0.018, { r: 0.004 });
    k.box('plastic_black', 0.034, 0.08, 0.004, hx, 1.0, 0.022);
    k.box(M('chrome', { roughness: 0.35 }), 0.024, 0.06, 0.012, hx, 1.0, 0.026, { r: 0.004 });
    k.box('chrome', 0.012, 0.03, 0.004, hx, 0.91, 0.022, { r: 0.002 });
    k.cyl('steel', 0.004, 0.012, hx, 0.91, 0.026, { axis: 'z', seg: 8 });
    k.box(body, 0.006, DH - 0.02, 0.02, DW - 0.003, dy0 + DH / 2, -0.004);
  });
  return { door, label };
}
function lockerMats(o) {
  return { body: PAINT(o.color ?? 0x5f7a72, 0.35), inner: PAINT(o.inner ?? 0x3e4a46, 0.2) };
}
function b_locker(o) {
  const k = new Kit('locker');
  const A = k.useAtlas(256, 256);
  const { door, label } = lockerInto(k, A, 0, 0, o, lockerMats(o));
  k.parts.door = door;
  k.screens.label = k.screens.label_0; delete k.screens.label_0;
  k.collide(cbox(0.45, 1.9, 0.5, 0, 0.95, 0));
  k.params.doorOpenSign = -1;
  k.params.doorCollider = cbox(0.434, 1.77, 0.018, 0.217, 0.99, 0.01);
  k.anchors.inside = V3(0, 0.6, 0);
  k.anchors.shelf = V3(0, 1.61, -0.02);
  return k.done({ mass: 55, material: 'metal' });
}
function b_locker_bank(o) {
  const n = Math.max(1, Math.min(12, o.count ?? 4));
  const k = new Kit('locker_bank');
  const A = k.useAtlas(512, 256);
  const mats = lockerMats(o);
  const W = 0.45;
  k.parts.doors = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * W;
    const { door, label } = lockerInto(k, A, x, i, { suitEvery: 2, ...o }, mats);
    k.parts.doors.push(door);
    labels.push(label);
  }
  // crown + bench plinth across the bank
  k.box(mats.body, n * W + 0.02, 0.03, 0.52, 0, 1.915, 0, { r: 0.005 });
  k.collide(cbox(n * W, 1.93, 0.5, 0, 0.965, 0));
  k.params.count = n;
  k.params.lockerWidth = W;
  k.params.doorOpenSign = -1;
  k.params.doorCollider = cbox(0.434, 1.77, 0.018, 0.217, 0.99, 0.01);
  return k.done({ mass: 55 * n, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Wall plaques / clock / poster / mirror
// ---------------------------------------------------------------------------
function brassGrad(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f6dc94'); g.addColorStop(0.45, '#c9a24e'); g.addColorStop(1, '#8a6a28');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function b_employee_of_month(o) {
  const k = new Kit('employee_of_month');
  const A = k.useAtlas(512, 128);
  const W = 0.42, H = 0.58, T = 0.028;
  const wood = M('wood_dark', { color: 0x6a3a22 });
  k.ext(wood, frameShape(W, H, 0.01, W - 0.07, H - 0.07, 0.004), T - 0.008, 0, 0, 0.004, { bev: 0.004, cs: 2 });
  k.box(M('fabric_green', { color: 0x1d3a2a }), W - 0.06, H - 0.06, 0.006, 0, 0, 0.004);
  // header plate
  const hdr = A.add(400, 60, (c, w, h) => {
    brassGrad(c, w, h);
    c.strokeStyle = 'rgba(60,40,8,0.7)'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    txt(c, 'EMPLOYEE OF THE MONTH', w / 2, h / 2 + 1, h * 0.42, { col: '#2e1e04', f: 'serif', maxW: w * 0.9 });
  });
  k.box('brass', 0.33, 0.052, 0.004, 0, H / 2 - 0.075, 0.009, { r: 0.002 });
  k.label(hdr, 0.326, 0.049, 0, H / 2 - 0.075, 0.0112, { metal: 0.85, rough: 0.3 });
  // portrait with gilt inner frame (3:4)
  const pw = 0.21, ph = 0.28, py = 0.0;
  k.ext(M('brass', { roughness: 0.35 }), frameShape(pw + 0.03, ph + 0.03, 0.004, pw, ph, 0.002), 0.008, 0, py, 0.007, { bev: 0.002, cs: 2 });
  k.screen('portrait', pw, ph, 0, py, 0.0075, { style: 'photo', text: 'EMPLOYEE #0042', aspect: 3 / 4 });
  // name plate
  k.box('brass', 0.27, 0.05, 0.004, 0, -H / 2 + 0.07, 0.009, { r: 0.002 });
  k.screen('name', 0.25, 0.04, 0, -H / 2 + 0.07, 0.0112, { style: 'brass', text: 'CLONE #0042', metal: 0.6, rough: 0.35 });
  // screws
  k.bolts([[-W / 2 + 0.05, H / 2 - 0.05, 0.007], [W / 2 - 0.05, H / 2 - 0.05, 0.007], [-W / 2 + 0.05, -H / 2 + 0.05, 0.007], [W / 2 - 0.05, -H / 2 + 0.05, 0.007]], { r: 0.004, mat: 'brass' });
  k.collide(cbox(W, H, T, 0, 0, T / 2));
  k.anchors.center = V3(0, 0, T);
  return k.done({ mass: 2.5, material: 'wood' });
}
function b_wall_clock(o) {
  const k = new Kit('wall_clock');
  const A = k.useAtlas(512, 512);
  const R = 0.16, D = 0.045;
  const rim = M('plastic_black', { color: 0x1a1a1a, roughness: 0.85 });
  k.lathe(rim, [[R - 0.02, 0], [R + 0.002, 0.0], [R + 0.012, 0.01], [R + 0.014, D - 0.012], [R + 0.004, D], [R - 0.012, D - 0.004], [R - 0.014, D - 0.01]], 0, 0, 0, { seg: 48, rot: [HP, 0, 0] });
  k.cyl(M('plastic_white', { color: 0x6a6a6a }), R - 0.01, 0.01, 0, 0, 0.005, { axis: 'z', seg: 40 });
  const face = A.add(500, 500, (c, w, h) => {
    const cx = w / 2, cy = h / 2, r = w / 2;
    c.fillStyle = '#bdb5a0'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU, maj = i % 5 === 0;
      c.strokeStyle = '#151515'; c.lineWidth = maj ? 7 : 2.5;
      const r0 = r * (maj ? 0.8 : 0.86), r1 = r * 0.93;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); c.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); c.stroke();
    }
    for (let i = 1; i <= 12; i++) { const a = (i / 12) * TAU; txt(c, String(i), cx + Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66 + 3, r * 0.17, { col: '#151515', f: 'bold', w: 'bold' }); }
    drawLogo(c, cx + r * 0.12, cy - r * 0.32, r * 0.1, '#333');
    txt(c, 'TIME IS PROPERTY', cx, cy + r * 0.3, r * 0.065, { col: '#7a1a14', f: 'bold' });
    txt(c, 'QUARTZ', cx, cy + r * 0.4, r * 0.05, { col: '#555', f: 'mono' });
    const g = c.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,40,0,0.18)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  k.dlabel(face, R - 0.012, 0, 0, 0.0105, { seg: 48 });
  const hand = (name, len, wid, mat, z, tail = 0.02) => {
    const g = k.grp(0, 0, z, { name });
    k.inside(g, () => {
      const s = new THREE.Shape();
      s.moveTo(-wid / 2, -tail); s.lineTo(wid / 2, -tail); s.lineTo(wid * 0.35, len * 0.85); s.lineTo(0, len); s.lineTo(-wid * 0.35, len * 0.85); s.closePath();
      k.ext(mat, s, 0.0015, 0, 0, 0);
    });
    return g;
  };
  k.parts.hour = hand('hour', 0.075, 0.011, M('plastic_black', { color: 0x111111 }), 0.013);
  k.parts.minute = hand('minute', 0.115, 0.008, M('plastic_black', { color: 0x111111 }), 0.0148);
  k.parts.second = hand('second', 0.125, 0.0025, M('plastic_red', { color: 0xc0201a }), 0.0166, 0.035);
  k.cyl(M('plastic_red', { color: 0xc0201a }), 0.006, 0.004, 0, 0, 0.019, { axis: 'z', seg: 12 });
  k.sph(CLEAR({ env: 0.8, rough: 0.1 }), R - 0.008, 0, 0, 0.022, { ws: 32, hs: 6, tl: HP, axis: 'z', s: [1, 1, 0.12] });
  k.parts.hour.rotation.z = -1.2; k.parts.minute.rotation.z = -3.9; k.parts.second.rotation.z = -0.5;
  k.collide(ccyl(R + 0.014, D, 0, 0, D / 2, [HP, 0, 0]));
  k.params.clockwise = -1;
  return k.done({ mass: 1.2, material: 'plastic' });
}
function b_poster(o) {
  const k = new Kit('poster');
  const asp = o.aspect ?? 0.7;
  const W = o.width ?? 0.6, H = W / asp, T = 0.02, f = 0.022;
  const fm = o.frame === 'wood' ? M('wood_dark', { color: 0x5a3a22 }) : M('metal_dark', { color: 0x2a2b2e, roughness: 0.45, metalMap: false, metalness: 0.7 });
  k.ext(fm, frameShape(W + 2 * f, H + 2 * f, 0.003, W, H, 0.001), T - 0.004, 0, 0, 0.002, { bev: 0.002, cs: 2 });
  k.box(M('cardboard', { color: 0x9a8a70 }), W, H, 0.004, 0, 0, 0.004);
  k.screen('main', W, H, 0, 0, 0.0065, { style: 'poster', text: o.text ?? '', aspect: asp, rough: 0.5 });
  if (o.glass !== false) k.plane(CLEAR({ env: 0.8, rough: 0.1 }), W, H, 0, 0, T - 0.006);
  k.collide(cbox(W + 2 * f, H + 2 * f, T, 0, 0, T / 2));
  k.params.size = [W, H];
  return k.done({ mass: 2, material: 'wood' });
}
function b_mirror(o) {
  const k = new Kit('mirror');
  const W = o.width ?? 0.6, H = o.height ?? 0.9, f = o.border ?? 0.035, T = 0.03;
  const fm = o.frame === 'wood' ? M('wood_dark', { color: 0x5a3a22 }) : M('chrome', { roughness: 0.25 });
  k.ext(fm, frameShape(W + 2 * f, H + 2 * f, 0.012, W, H, 0.004), T - 0.012, 0, 0, 0.006, { bev: 0.006, cs: 3 });
  k.box(M('plastic_black', { color: 0x0d0f10, roughness: 0.15 }), W + 0.004, H + 0.004, 0.006, 0, 0, 0.004);
  // corner clips
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl('chrome', 0.006, 0.004, sx * (W / 2 + f / 2), sy * (H / 2 + f / 2), T + 0.002, { axis: 'z', seg: 10 });
  if (o.shelf !== false) {
    const sy = -H / 2 - f - 0.06;
    k.box(GLASS(), W * 0.8, 0.008, 0.11, 0, sy, 0.065);
    k.box(M('chrome', { roughness: 0.3 }), W * 0.8 + 0.01, 0.012, 0.012, 0, sy, 0.12, { r: 0.004 });
    for (const sx of [-1, 1]) {
      k.box('chrome', 0.02, 0.05, 0.01, sx * W * 0.35, sy + 0.015, 0.005, { r: 0.003 });
      k.box('chrome', 0.012, 0.012, 0.11, sx * W * 0.35, sy - 0.008, 0.06, { r: 0.003 });
    }
    k.collide(cbox(W * 0.8, 0.02, 0.12, 0, sy, 0.06));
  }
  k.collide(cbox(W + 2 * f, H + 2 * f, T, 0, 0, T / 2));
  k.anchors.glassCenter = V3(0, 0, 0.0075);
  k.params.glassSize = [W, H];
  return k.done({ mass: 6, material: 'glass' });
}

// ---------------------------------------------------------------------------
// Vents, fuse box, fire alarm, signs
// ---------------------------------------------------------------------------
function b_ceiling_vent(o) {
  // origin = ceiling surface center; the diffuser hangs down (-Y) and faces the floor
  const k = new Kit('ceiling_vent');
  const S = o.size ?? 0.6;
  const m = PAINT(0xc9c6bc, 0.3);
  k.box('plastic_black', S - 0.06, 0.12, S - 0.06, 0, 0.04, 0);
  const grille = k.grp(0, 0, 0, { name: 'grille' });
  k.inside(grille, () => {
    k.push(0, 0, 0, [HP, 0, 0]);
    k.ext(m, frameShape(S, S, 0.006, S - 0.07, S - 0.07, 0.003), 0.012, 0, 0, 0, { bev: 0.003, cs: 2 });
    const rings = 4;
    for (let i = 0; i < rings; i++) {
      const so = S - 0.07 - i * ((S - 0.18) / rings), si = so - (S - 0.18) / rings * 0.62;
      k.ext(m, frameShape(so, so, 0.004, si, si, 0.003), 0.006, 0, 0, 0.012 + i * 0.012);
    }
    k.box(m, 0.08, 0.08, 0.01, 0, 0, 0.06, { r: 0.004 });
    k.bolts([[-S / 2 + 0.018, -S / 2 + 0.018, 0.013], [S / 2 - 0.018, -S / 2 + 0.018, 0.013], [-S / 2 + 0.018, S / 2 - 0.018, 0.013], [S / 2 - 0.018, S / 2 - 0.018, 0.013]], { r: 0.005, mat: 'steel' });
    k.pop();
  });
  k.collide(cbox(S, 0.03, S, 0, -0.015, 0));
  k.anchors.mouth = V3(0, -0.08, 0);
  k.parts.grille = grille;
  return k.done({ mass: 4, material: 'metal' });
}
function b_wall_vent(o) {
  // origin = wall-mount center (vent center on the wall plane); suggested height y≈0.2
  const k = new Kit('wall_vent');
  const W = o.width ?? 0.5, H = o.height ?? 0.3, Dp = 0.05;
  const m = WORN(0xa8a49a, 0.6);
  // duct box (dark inside) protruding from the wall
  k.box(M('plastic_black', { color: 0x050505 }), W - 0.02, H - 0.02, 0.004, 0, 0, 0.004);
  for (const sx of [-1, 1]) k.box(m, 0.01, H, Dp, sx * (W / 2 - 0.005), 0, Dp / 2);
  for (const sy of [-1, 1]) k.box(m, W, 0.01, Dp, 0, sy * (H / 2 - 0.005), Dp / 2);
  k.ext(m, frameShape(W + 0.05, H + 0.05, 0.006, W - 0.01, H - 0.01, 0.003), 0.008, 0, 0, Dp - 0.004, { bev: 0.002, cs: 2 });
  // grille hinged at its top edge (rotate +X to swing out)
  const grille = k.grp(0, H / 2 - 0.01, Dp + 0.006, { name: 'grille' });
  k.inside(grille, () => {
    k.ext(m, frameShape(W - 0.012, H - 0.012, 0.004, W - 0.05, H - 0.05, 0.002), 0.006, 0, -(H / 2 - 0.01), 0);
    const n = Math.round((H - 0.05) / 0.025);
    for (let i = 0; i < n; i++) k.box(m, W - 0.05, 0.022, 0.003, 0, -(H / 2 - 0.01) - (H - 0.05) / 2 + (i + 0.5) * ((H - 0.05) / n), 0.003, { rot: [0.75, 0, 0] });
  });
  k.bolts([[-W / 2 - 0.006, H / 2 + 0.006, Dp + 0.006], [W / 2 + 0.006, H / 2 + 0.006, Dp + 0.006], [-W / 2 - 0.006, -H / 2 - 0.006, Dp + 0.006]], { r: 0.006, mat: 'rust' });
  k.cyl('plastic_black', 0.003, 0.004, W / 2 + 0.006, -H / 2 - 0.006, Dp + 0.005, { axis: 'z', seg: 8 });
  k.collide(cbox(W + 0.05, H + 0.05, Dp + 0.01, 0, 0, (Dp + 0.01) / 2));
  k.anchors.mouth = V3(0, 0, Dp + 0.15);
  k.anchors.inside = V3(0, 0, 0.02);
  k.parts.grille = grille;
  return k.done({ mass: 3, material: 'metal' });
}
function b_fuse_box(o) {
  const k = new Kit('fuse_box');
  const A = k.useAtlas(512, 512);
  const W = 0.36, H = 0.48, D = 0.12;
  const m = WORN(0x8a8f8c, 0.5);
  k.box(m, W, H, 0.012, 0, 0, 0.006);
  for (const sx of [-1, 1]) k.box(m, 0.012, H, D, sx * (W / 2 - 0.006), 0, D / 2);
  for (const sy of [-1, 1]) k.box(m, W, 0.012, D, 0, sy * (H / 2 - 0.006), D / 2);
  // inner panel with breakers
  k.box(M('metal_dark', { metalMap: false, metalness: 0.4 }), W - 0.04, H - 0.04, 0.01, 0, 0, 0.05);
  const lbl = A.add(260, 30, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); for (let i = 0; i < 12; i++) txt(c, String(i + 1), (i + 0.5) * (w / 12), h / 2, h * 0.5, { col: '#222', f: 'mono' }); });
  k.parts.breakers = [];
  for (let col = 0; col < 2; col++) for (let r = 0; r < 6; r++) {
    const x = (col ? 1 : -1) * 0.06, y = 0.13 - r * 0.045;
    k.box('plastic_black', 0.07, 0.036, 0.02, x, y, 0.065, { r: 0.003 });
    const t = k.grp(x, y, 0.075, { name: `breaker_${col * 6 + r}` });
    k.inside(t, () => k.box(M('plastic_white', { color: 0xd8d4c8 }), 0.018, 0.012, 0.02, 0, 0, 0.008, { r: 0.002 }));
    t.rotation.y = (r === 3 && col === 1) ? -0.5 : 0.5;
    k.parts.breakers.push(t);
  }
  k.label(lbl, 0.26, 0.03, 0, 0.19, 0.056);
  k.box('plastic_black', 0.1, 0.07, 0.03, 0, -0.17, 0.07, { r: 0.004 });
  const main = k.grp(0, -0.17, 0.085, { name: 'mainBreaker' });
  k.inside(main, () => k.box(M('plastic_red', { color: 0xb02a20 }), 0.03, 0.05, 0.02, 0, 0, 0.008, { r: 0.004 }));
  main.rotation.x = -0.4;
  // door
  const door = k.grp(-W / 2, 0, D, { name: 'door' });
  k.inside(door, () => {
    k.box(m, W, H, 0.012, W / 2, 0, 0.006, { r: 0.003 });
    const front = A.add(240, 300, (c, w, h) => {
      c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, w, h);
      c.fillStyle = '#e8e2cc'; rrect(c, 10, 10, w - 20, 120, 8); c.fill();
      hazardTri(c, w * 0.22, 70, 80, 'bolt');
      txt(c, 'DANGER', w * 0.64, 42, 30, { col: '#c0201a' });
      txt(c, '240 VOLTS', w * 0.64, 78, 22, { col: '#111' });
      txt(c, 'AUTHORIZED', w * 0.64, 104, 14, { col: '#111', f: 'mono' });
      txt(c, 'CLONES ONLY', w * 0.64, 120, 14, { col: '#111', f: 'mono' });
      c.fillStyle = '#1a1a1a'; rrect(c, 30, 200, w - 60, 50, 6); c.fill();
      txt(c, 'PANEL B-7', w / 2, 225, 26, { col: '#e8c860', f: 'mono' });
    });
    k.label(front, 0.3, 0.375, W / 2, 0.02, 0.0125);
    k.box('chrome', 0.03, 0.06, 0.012, W - 0.04, 0, 0.018, { r: 0.004 });
    k.cyl('steel', 0.006, 0.006, W - 0.04, -0.015, 0.025, { axis: 'z', seg: 10 });
  });
  door.rotation.y = 0;
  for (const y of [-0.15, 0.15]) k.cyl('chrome', 0.006, 0.05, -W / 2, y, D, { seg: 8 });
  // conduits up to the ceiling
  for (const x of [-0.1, 0.0, 0.1]) k.cyl(WORN(0x8a8f8c, 0.7), 0.012, 0.6, x, H / 2 + 0.3, 0.05, { seg: 10 });
  k.collide(cbox(W, H, D, 0, 0, D / 2));
  k.parts.door = door;
  k.parts.main = main;
  k.params.doorOpenSign = -1;
  return k.done({ mass: 12, material: 'metal' });
}
function b_fire_alarm(o) {
  const k = new Kit('fire_alarm');
  const A = k.useAtlas(256, 256);
  const red = PAINT(0xb3221a, 0.2);
  // pull station (origin = its back center)
  k.box(red, 0.1, 0.135, 0.045, 0, 0, 0.0225, { r: 0.008 });
  const ft = A.add(120, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'FIRE', w / 2, h * 0.5, h * 0.7, { col: '#f4f0e6' }); });
  k.label(ft, 0.07, 0.035, 0, 0.04, 0.0455);
  const pd = A.add(120, 40, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'PULL DOWN', w / 2, h / 2, h * 0.5, { col: '#f4f0e6' }); });
  k.label(pd, 0.07, 0.023, 0, -0.05, 0.0455);
  k.box(M('plastic_black', { color: 0x200606 }), 0.06, 0.035, 0.004, 0, -0.008, 0.045);
  const handle = k.grp(0, 0.01, 0.046, { name: 'handle' });
  k.inside(handle, () => {
    k.box(M('plastic_white', { color: 0xe0dcd0 }), 0.05, 0.03, 0.016, 0, -0.018, 0.008, { r: 0.005 });
    k.box(red, 0.054, 0.008, 0.02, 0, -0.002, 0.008, { r: 0.003 });
  });
  // bell + strobe above
  const by = 0.33;
  k.box(red, 0.12, 0.12, 0.03, 0, by, 0.015, { r: 0.01 });
  k.lathe(PAINT(0xc22a20, 0.5), [[0.004, 0.0], [0.075, 0.0], [0.078, 0.008], [0.07, 0.02], [0.05, 0.03], [0.0, 0.034]], 0, by, 0.03, { seg: 32, rot: [HP, 0, 0] });
  k.cyl('chrome', 0.01, 0.012, 0, by, 0.07, { axis: 'z', seg: 10 });
  k.box(M('plastic_white', { color: 0xd8d4c8 }), 0.09, 0.06, 0.04, 0, by - 0.13, 0.02, { r: 0.008 });
  const strobe = k.box(own('emissive_white', { emissiveIntensity: 0.15, color: 0xdddddd }), 0.07, 0.035, 0.012, 0, by - 0.13, 0.045, { r: 0.005, sep: true, name: 'strobe' });
  k.collide(cbox(0.1, 0.135, 0.045, 0, 0, 0.0225));
  k.collide(cbox(0.16, 0.2, 0.08, 0, by - 0.03, 0.04));
  k.parts.handle = handle;
  k.parts.strobe = strobe;
  k.anchors.bell = V3(0, by, 0.08);
  return k.done({ mass: 2, material: 'metal' });
}
function b_exit_sign(o) {
  const k = new Kit('exit_sign');
  const A = k.useAtlas(512, 256);
  const W = 0.36, H = 0.2, D = 0.06;
  const col = o.color === 'green' ? ['#1aff6a', '#03200c'] : ['#ff2a1a', '#200402'];
  const housing = PAINT(0xd8d4c8, 0.3);
  k.box(housing, W, H, D, 0, 0, D / 2, { r: 0.01 });
  k.box(housing, 0.12, 0.02, 0.03, 0, H / 2 + 0.01, 0.015);
  const art = A.add(360, 200, (c, w, h) => {
    c.fillStyle = col[1]; c.fillRect(0, 0, w, h);
    txt(c, 'EXIT', w * 0.47, h * 0.47, h * 0.62, { col: col[0], maxW: w * 0.66 });
    c.fillStyle = col[0];
    c.beginPath(); c.moveTo(w * 0.86, h * 0.47); c.lineTo(w * 0.78, h * 0.32); c.lineTo(w * 0.78, h * 0.62); c.closePath(); c.fill();
    c.fillRect(w * 0.12, h * 0.82, w * 0.76, h * 0.03);
  });
  const face = new THREE.MeshStandardMaterial({ map: A.tex, emissiveMap: A.tex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.3 });
  face.userData.unique = true; face.userData.noShadow = true; face.name = 'exit_face';
  const g = mapUV(new THREE.PlaneGeometry(W - 0.03, H - 0.03), art);
  const panel = k.mesh(face, g, 0, 0, D + 0.0012, { name: 'panel', shadow: false });
  k.ext(housing, frameShape(W, H, 0.01, W - 0.03, H - 0.03, 0.004), 0.004, 0, 0, D - 0.002);
  k.collide(cbox(W, H, D, 0, 0, D / 2));
  k.parts.panel = panel;
  return k.done({ mass: 2, material: 'plastic' });
}
const HAZARDS = {
  electric: ['DANGER', '#c0201a', 'bolt', ['HIGH VOLTAGE', 'KEEP OUT']],
  radiation: ['CAUTION', '#e8b417', 'rad', ['RADIATION AREA', 'DOSIMETER REQUIRED']],
  dimensional: ['WARNING', '#e8661c', '!', ['DIMENSIONAL INSTABILITY', 'DO NOT STARE INTO RIFT']],
  biohazard: ['CAUTION', '#e8b417', '!', ['BIOHAZARD', 'CLONE MATERIAL IN USE']],
  general: ['NOTICE', '#1d5fbf', '!', ['HARD HAT AREA', 'R.O.O.M. IS WATCHING']],
};
function b_hazard_sign(o) {
  const k = new Kit('hazard_sign');
  const A = k.useAtlas(512, 512);
  const [head, hc, sym, lines] = HAZARDS[o.kind || 'dimensional'] || HAZARDS.dimensional;
  const text = o.text ? String(o.text).split('\n') : lines;
  const W = o.width ?? 0.4, H = W * 0.75;
  const art = A.add(400, 300, (c, w, h) => {
    c.fillStyle = '#ece6d4'; c.fillRect(0, 0, w, h);
    c.fillStyle = hc === '#e8b417' ? '#111' : hc; c.fillRect(10, 10, w - 20, h * 0.24);
    if (hc === '#e8b417') { c.fillStyle = hc; c.fillRect(16, 16, w - 32, h * 0.24 - 12); }
    txt(c, head, w / 2, 10 + h * 0.12, h * 0.16, { col: hc === '#e8b417' ? '#111' : '#fff' });
    hazardTri(c, w * 0.2, h * 0.62, h * 0.4, sym);
    text.forEach((s, i) => txt(c, s, w * 0.62, h * (0.52 + i * 0.16), h * 0.085, { col: '#111', maxW: w * 0.6 }));
    c.strokeStyle = '#111'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12);
    grime(c, w, h, 0.8, 13);
  });
  k.box(M('metal', { color: 0xb0b0b0, metalMap: false, metalness: 0.6 }), W, H, 0.003, 0, 0, 0.0015, { r: 0.0012 });
  k.label(art, W - 0.004, H - 0.004, 0, 0, 0.0032);
  k.bolts([[-W / 2 + 0.015, H / 2 - 0.015, 0.0035], [W / 2 - 0.015, H / 2 - 0.015, 0.0035], [-W / 2 + 0.015, -H / 2 + 0.015, 0.0035], [W / 2 - 0.015, -H / 2 + 0.015, 0.0035]], { r: 0.005, mat: 'steel' });
  k.collide(cbox(W, H, 0.006, 0, 0, 0.003));
  return k.done({ mass: 1, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Reception desk (curved, convex toward +Z)
// ---------------------------------------------------------------------------
function b_reception_desk(o) {
  const k = new Kit('reception_desk');
  const A = k.useAtlas(1024, 512);
  const R = 1.8, a0 = -38 * DEG, a1 = 38 * DEG, zc = -R + 0.45;
  const veneer = M('wood', { color: 0xc89060 });
  const darkWood = M('wood_dark', { color: 0x5a3a24 });
  const beige = PAINT(0xa49a7c, 0.05);
  const lam = PAINT(0x8f8670, 0.05);
  const brass = M('brass', { roughness: 0.35 });
  const slab = (mat, r0, r1, y0, y1, aa = a0, ab = a1, seg = 28) => k.put(mat, gArcSlab(r0, r1, aa, ab, y0, y1, seg), 0, 0, zc);
  slab(M('plastic_black', { color: 0x151515 }), R - 0.13, R - 0.09, 0, 0.1);
  slab(veneer, R - 0.04, R, 0.1, 0.9);
  slab(brass, R - 0.03, R + 0.004, 0.9, 0.912);
  slab(beige, R - 0.035, R + 0.002, 0.912, 1.04);
  slab(darkWood, R - 0.34, R + 0.065, 1.04, 1.075);
  slab(brass, R + 0.064, R + 0.069, 1.044, 1.071);
  // vertical reveals on the veneer
  for (let i = 1; i < 8; i++) { const a = a0 + ((a1 - a0) * i) / 8; slab(darkWood, R - 0.01, R + 0.003, 0.1, 0.9, a - 0.004, a + 0.004, 1); }
  // end caps closing the hollow counter at both ends
  const ends = [];
  for (const s2 of [-1, 1]) {
    const aa = s2 > 0 ? a1 - 0.012 : a0, ab = s2 > 0 ? a1 : a0 + 0.012;
    slab(veneer, R - 0.36, R - 0.002, 0.1, 1.04, aa, ab, 1);
    slab(M('plastic_black', { color: 0x151515 }), R - 0.36, R - 0.09, 0, 0.1, aa, ab, 1);
    const am = (aa + ab) / 2;
    ends.push([am, (R - 0.18) * Math.sin(am), zc + (R - 0.18) * Math.cos(am)]);
  }
  // inner work surface (0.74 m) + modesty panel
  slab(lam, R - 1.0, R - 0.34, 0.72, 0.75, a0 + 0.02, a1 - 0.02);
  slab(darkWood, R - 1.005, R - 0.995, 0.70, 0.75, a0 + 0.02, a1 - 0.02);
  slab(M('wood_dark', { color: 0x4a3020 }), R - 0.36, R - 0.34, 0.1, 1.04);
  // left support panel under the work surface
  k.put(lam, gArcSlab(R - 0.98, R - 0.36, a0 + 0.06, a0 + 0.075, 0.0, 0.72, 1), 0, 0, zc);
  // drawer pedestal (right, behind)
  const px = 0.62, pz = zc + R - 0.75;
  k.box(beige, 0.42, 0.7, 0.55, px, 0.36, pz, { r: 0.006, rot: [0, 0.2, 0] });
  for (let i = 0; i < 3; i++) {
    k.push(px, 0.15 + i * 0.22, pz, [0, 0.2, 0]);
    k.box(lam, 0.39, 0.2, 0.01, 0, 0, -0.28, { r: 0.004 });
    k.box('chrome', 0.12, 0.014, 0.02, 0, 0.06, -0.295, { r: 0.006 });
    k.pop();
  }
  // brass lettering following the curve (with a dark offset shadow for a raised look)
  const sign = A.add(1000, 120, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fbe6a0'); g.addColorStop(0.5, '#caa04c'); g.addColorStop(1, '#8a6420');
    c.font = `900 ${h * 0.62}px ${FONT.serif}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = g; c.fillText('R.O.O.M.  RECEPTION', w / 2, h * 0.55);
  });
  const shadow = A.add(1000, 120, (c, w, h) => { c.font = `900 ${h * 0.62}px ${FONT.serif}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#1a0e04'; c.fillText('R.O.O.M.  RECEPTION', w / 2, h * 0.55); });
  const arc = 1.5 / R;
  k.clabel(shadow, R + 0.004, 0.16, arc, 0, 0.64, zc, { seg: 24, a: 0.004 });
  k.clabel(sign, R + 0.012, 0.16, arc, 0, 0.645, zc, { seg: 24, metal: 0.75, rough: 0.35 });
  // logo medallion above lettering
  const logo = A.add(160, 160, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); g.addColorStop(0, '#fbe6a0'); g.addColorStop(1, '#8a6420'); c.fillStyle = g; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); c.fill(); drawLogo(c, w / 2, h / 2, w * 0.55, '#3a2808', { text: false }); });
  k.dlabel(logo, 0.07, 0, 0.81, zc + R + 0.012, { metal: 0.75, rough: 0.35 });
  // counter-top props: forms tray, pen cup, "please ring" placard
  const fz = zc + R - 0.12;
  k.box(M('plastic_black', { color: 0x222222 }), 0.24, 0.04, 0.3, -0.5, 1.095, fz - 0.06, { rot: [0, 0.2, 0], r: 0.004 });
  k.box(M('paper', { color: 0xcfcab8 }), 0.215, 0.02, 0.28, -0.5, 1.1, fz - 0.06, { rot: [0, 0.22, 0] });
  k.cyl(M('plastic_black', { color: 0x1d1d1d }), 0.035, 0.1, -0.22, 1.125, fz - 0.05, { seg: 14 });
  for (let i = 0; i < 4; i++) k.cyl([M('plastic_blue'), M('plastic_red'), M('plastic_black'), M('plastic_yellow')][i], 0.004, 0.15, -0.22 + Math.cos(i * 1.6) * 0.015, 1.16, fz - 0.05 + Math.sin(i * 1.6) * 0.015, { seg: 6, rot: [Math.sin(i) * 0.2, 0, Math.cos(i) * 0.2] });
  const ring = A.add(200, 90, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a1a14'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12); txt(c, 'PLEASE RING', w / 2, h * 0.36, h * 0.24, { col: '#7a1a14', f: 'serif' }); txt(c, 'FOR SERVICE', w / 2, h * 0.68, h * 0.24, { col: '#7a1a14', f: 'serif' }); });
  for (const s of [-1, 1]) k.label(ring, 0.15, 0.067, 0.18, 1.105, fz - 0.06 + s * 0.012, { rot: [s * 0.35, s > 0 ? 0 : PI, 0] });
  // work surface props: phone, CRT facing the receptionist
  const seatZ = zc + R - 1.25;
  const phoneM = M('plastic_beige', { color: 0xb3aa8a });
  k.box(phoneM, 0.2, 0.06, 0.2, -0.55, 0.78, seatZ + 0.55, { r: 0.02, rot: [0, 0.5, 0] });
  k.box(phoneM, 0.22, 0.04, 0.05, -0.55, 0.825, seatZ + 0.55, { r: 0.015, rot: [0, 0.5, 0] });
  cable(k, [[-0.5, 0.79, seatZ + 0.5], [-0.42, 0.76, seatZ + 0.46], [-0.38, 0.755, seatZ + 0.55], [-0.45, 0.755, seatZ + 0.6]], 0.004, phoneM, { ts: 20 });
  k.push(0.15, 0.75, seatZ + 0.48, [0, PI - 0.25, 0]);
  const mon = crtMonitor(k, 'main', { sw: 0.26, shell: phoneM, text: 'VISITOR LOG\n> NO VISITORS_', badge: 'R.O.O.M. VISION 14', cables: false });
  k.pop();
  k.push(0.1, 0.75, seatZ + 0.33, [0, PI, 0]);
  keyboard(k, 0, 0, 0, {});
  k.pop();
  // colliders: arc approximated with rotated boxes
  const nseg = 6;
  for (let i = 0; i < nseg; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / nseg, rr = R - 0.12;
    const len = (2 * R * Math.sin((a1 - a0) / nseg / 2)) + 0.02;
    k.collide(cbox(len, 1.075, 0.26, rr * Math.sin(a), 0.5375, zc + rr * Math.cos(a), [0, a, 0]));
  }
  k.collide(cbox(1.9, 0.05, 0.6, 0, 0.735, zc + R - 0.65));
  k.anchors.bell = V3((R - 0.14) * Math.sin(0.18), 1.075, zc + (R - 0.14) * Math.cos(0.18));
  k.anchors.top = V3(0, 1.075, zc + R - 0.14);
  k.anchors.receptionist = V3(0, 0.47, seatZ);
  k.anchors.workSurface = V3(-0.2, 0.75, seatZ + 0.45);
  k.anchors.screenView = mon.screen.position.clone().addScaledVector(new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), PI - 0.25), 0.55);
  k.params.receptionistFacing = '+Z';
  return k.done({ mass: 420, material: 'wood' });
}

// ---------------------------------------------------------------------------
// Cloning lab: tube, console, portable pad
// ---------------------------------------------------------------------------
function b_clone_tube(o) {
  const k = new Kit('clone_tube');
  const A = k.useAtlas(512, 256);
  const iron = WORN(0x3b4046, 0.6);
  const steel = STEEL();
  const GR = 0.45, gy0 = 0.36, gy1 = 1.92;
  // base plinth
  k.lathe(iron, [[0.0, 0.0], [0.63, 0.0], [0.64, 0.015], [0.64, 0.05], [0.61, 0.07], [0.6, 0.27], [0.56, 0.31], [0.52, 0.33], [0.52, gy0], [0.0, gy0]], 0, 0, 0, { seg: 40 });
  k.cyl(hazardMat(), 0.603, 0.1, 0, 0.17, 0, { seg: 40, open: true });
  k.tor(steel, 0.47, 0.018, 0, gy0 + 0.005, 0, { axis: 'y', ts: 40, rs: 6 });
  const bp = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; bp.push([Math.sin(a) * 0.56, 0.3, Math.cos(a) * 0.56]); }
  k.bolts(bp.map((p) => [p[0], p[1] + 0.012, p[2]]), { r: 0.012, axis: 'y', mat: steel });
  // inner glow ring at the bottom of the vat
  const ringLight = k.tor(own('emissive_green', { emissiveIntensity: 1.8 }), 0.4, 0.012, 0, gy0 + 0.012, 0, { axis: 'y', ts: 40, rs: 6, sep: true, name: 'ringLight' });
  // glass: back faces then (fluid) then front faces
  const gm = CLEAR({ env: 1.5, rough: 0.04, tint: 0x010302 });
  const gmb = CLEAR({ env: 0.8, rough: 0.04, side: THREE.BackSide });
  const glass = k.cyl(gm, GR, gy1 - gy0, 0, (gy0 + gy1) / 2, 0, { seg: 48, open: true, sep: true, name: 'glass' });
  glass.renderOrder = 3;
  const gback = new THREE.Mesh(glass.geometry, gmb);
  gback.renderOrder = 1; gback.name = 'glass_back';
  glass.add(gback);
  // fluid (origin at its bottom so scale.y drains it)
  const fh = 1.48, fy = gy0 + 0.02;
  const fluid = k.mesh(volumeMat({ shape: 'cyl', min: [0, 0, 0], max: [0, fh, 0], radius: GR - 0.01, tint: 0x0b4a1e, deep: 0x02240c, glow: new THREE.Color(0.12, 1.25, 0.38), density: 2.2, a0: 0.3, a1: 0.72, swirl: true, rough: 0.35, env: 0.25 }),
    new THREE.CylinderGeometry(GR - 0.01, GR - 0.01, fh, 40, 1).translate(0, fh / 2, 0), 0, fy, 0, { name: 'fluid', shadow: false });
  fluid.renderOrder = 2;
  // meniscus disc on top of the fluid
  // ribs + clamps
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2, x = Math.sin(a) * (GR + 0.035), z = Math.cos(a) * (GR + 0.035);
    k.box(steel, 0.04, gy1 - gy0 + 0.06, 0.03, x, (gy0 + gy1) / 2, z, { rot: [0, a, 0], r: 0.006 });
    for (const y of [gy0 + 0.25, (gy0 + gy1) / 2, gy1 - 0.25]) k.box(iron, 0.07, 0.05, 0.05, x, y, z, { rot: [0, a, 0], r: 0.008 });
  }
  // cap
  k.lathe(iron, [[0.52, gy1 - 0.02], [0.56, gy1], [0.57, gy1 + 0.07], [0.53, gy1 + 0.1], [0.44, gy1 + 0.18], [0.3, gy1 + 0.24], [0.16, gy1 + 0.27], [0.0, gy1 + 0.28]], 0, 0, 0, { seg: 40 });
  k.tor(steel, 0.47, 0.018, 0, gy1 - 0.005, 0, { axis: 'y', ts: 40, rs: 6 });
  k.disc(iron, 0.53, 0, gy1 - 0.019, 0, { seg: 40, rot: [HP, 0, 0] });
  k.cyl(hazardMat(), 0.572, 0.05, 0, gy1 + 0.04, 0, { seg: 40, open: true });
  const cb = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; cb.push([Math.sin(a) * 0.5, gy1 + 0.13, Math.cos(a) * 0.5]); }
  k.bolts(cb, { r: 0.01, axis: 'y', mat: steel });
  k.box(iron, 0.3, 0.16, 0.24, 0, gy1 + 0.33, -0.05, { r: 0.02 });
  k.cyl(steel, 0.08, 0.2, 0.0, gy1 + 0.33, 0.12, { axis: 'z', seg: 16 });
  slots(k, 0, gy1 + 0.33, 0.071, 0.2, 0.1, 5, {});
  // pipes out of the cap and down the back
  const pipe = M('metal', { color: 0x8a6a4a, metalMap: false, metalness: 0.8, roughness: 0.5 });
  k.tube(pipe, pipePath([[0.2, gy1 + 0.2, -0.2], [0.2, gy1 + 0.55, -0.2], [0.2, gy1 + 0.55, -0.7], [0.2, 2.8, -0.7]], 0.1), 0.045, { rs: 10, ts: 40 });
  k.tube(pipe, pipePath([[-0.2, gy1 + 0.2, -0.2], [-0.2, gy1 + 0.45, -0.2], [-0.2, gy1 + 0.45, -0.65], [-0.2, 0.05, -0.65], [-0.2, 0.05, -0.4]], 0.1), 0.035, { rs: 10, ts: 60 });
  for (const [x, y, z] of [[0.2, gy1 + 0.4, -0.2], [-0.2, gy1 + 0.35, -0.2], [-0.2, 0.9, -0.65]]) k.cyl(steel, 0.065, 0.03, x, y, z, { seg: 12 });
  // cables from base to the floor/back
  for (let i = 0; i < 3; i++) cable(k, [[-0.3 + i * 0.12, 0.2, -0.5], [-0.32 + i * 0.12, 0.08, -0.7], [-0.4 + i * 0.15, 0.015, -1.0], [-0.6 + i * 0.3, 0.015, -1.4]], 0.018, M('rubber', { color: [0x1a1a1a, 0x7a1a14, 0x1a3a7a][i] }), { ts: 24 });
  // label screen + lamps on the base front
  k.push(0, 0.2, 0.58, [-0.25, 0, 0]);
  k.box(iron, 0.3, 0.16, 0.12, 0, 0, -0.04, { r: 0.012 });
  k.box('plastic_black', 0.25, 0.11, 0.01, 0, 0.005, 0.02, { r: 0.006 });
  k.screen('label', 0.22, 0.09, 0, 0.005, 0.0255, { style: 'crt', text: 'SPECIMEN #0042\nGESTATION 87%\nSTATUS: DREAMING', bulge: 0.004 });
  k.parts.lamps = [lamp(k, -0.1, -0.062, 0.02, 0.006, 'green', { name: 'lamp_ok' }), lamp(k, 0, -0.062, 0.02, 0.006, 'amber', { name: 'lamp_busy' }), lamp(k, 0.1, -0.062, 0.02, 0.006, 'red', { name: 'lamp_fail' })];
  k.pop();
  const plate = A.add(300, 60, (c, w, h) => { c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, w, h); txt(c, 'GENESIS-9 GROWTH VAT', w / 2, h * 0.35, h * 0.3, { col: '#111' }); txt(c, 'R.O.O.M. BIOLOGICAL DIVISION', w / 2, h * 0.72, h * 0.18, { col: '#333', f: 'mono' }); });
  k.clabel(plate, 0.6005, 0.05, 0.5, 0, 0.245, 0, { a: PI * 0.32 });
  k.clabel(plate, 0.6005, 0.05, 0.5, 0, 0.245, 0, { a: -PI * 0.32 });
  const bub = k.grp(0, fy + 0.04, 0, { name: 'bubbleOrigin' });
  k.collide(ccyl(0.64, gy0, 0, gy0 / 2, 0));
  k.collide(ccyl(GR + 0.05, gy1 - gy0, 0, (gy0 + gy1) / 2, 0));
  k.collide(ccyl(0.57, 0.3, 0, gy1 + 0.13, 0));
  k.anchors.specimen = V3(0, fy + fh * 0.5, 0);
  k.anchors.fluidTop = V3(0, fy + fh, 0);
  k.parts.fluid = fluid;
  k.parts.glass = glass;
  k.parts.bubbleOrigin = bub;
  k.parts.ringLight = ringLight;
  k.params.fluidRadius = GR - 0.01;
  k.params.fluidHeight = fh;
  return k.done({ mass: 900, material: 'metal' });
}

function b_clone_console(o) {
  const k = new Kit('clone_console');
  const A = k.useAtlas(512, 512);
  const shell = PAINT(0x9c9a8a, 0.3);
  const panelM = PAINT(0x3a3e42, 0.4);
  const W = 1.3;
  // base cabinet
  k.box(shell, W, 0.72, 0.62, 0, 0.36 + 0.04, -0.02, { r: 0.01 });
  k.box('plastic_black', W - 0.06, 0.06, 0.56, 0, 0.03, -0.04);
  for (const sx of [-1, 1]) slots(k, sx * 0.4, 0.4, 0.291, 0.3, 0.25, 7, {});
  // sloped desk (side profile extruded along X)
  const prof = new THREE.Shape();
  prof.moveTo(-0.33, 0.76); prof.lineTo(-0.33, 0.8); prof.lineTo(0.12, 1.0); prof.lineTo(0.33, 1.0); prof.lineTo(0.33, 0.76); prof.closePath();
  k.ext(shell, prof, W, -W / 2, 0, 0, { rot: [0, HP, 0], bev: 0.008, cs: 2 });
  // upper instrument panel
  k.box(shell, W, 0.5, 0.2, 0, 1.25, -0.23, { r: 0.012 });
  k.box(panelM, W - 0.06, 0.44, 0.01, 0, 1.25, -0.125);
  // oscilloscope
  k.box(shell, 0.3, 0.26, 0.04, -0.38, 1.27, -0.11, { r: 0.012 });
  k.ext('plastic_black', frameShape(0.24, 0.19, 0.03, 0.2, 0.15, 0.025), 0.012, -0.38, 1.285, -0.095, { bev: 0.004, cs: 4 });
  k.screen('main', 0.2, 0.15, -0.38, 1.285, -0.093, { style: 'scope', bulge: 0.008, aspect: 4 / 3 });
  for (let i = 0; i < 3; i++) knob(k, -0.47 + i * 0.09, 1.165, -0.09, 0.012, { name: 'scopeKnob_' + i });
  // gauges
  k.parts.needles = [
    gauge(k, -0.05, 1.31, -0.115, 0.06, { label: 'DNA %', max: 100, red: 0.85, value: 0.6, name: 'needle_dna' }),
    gauge(k, 0.12, 1.31, -0.115, 0.06, { label: 'PSI', max: 50, red: 0.8, value: 0.35, name: 'needle_psi' }),
  ];
  // lamp row + header
  k.parts.lamps = ['green', 'green', 'amber', 'amber', 'red', 'blue'].map((c, i) => lamp(k, 0.29 + (i % 3) * 0.07, 1.36 - Math.floor(i / 3) * 0.08, -0.12, 0.012, c, { name: 'lamp_' + i }));
  const hdr = A.add(480, 48, (c, w, h) => { c.fillStyle = '#1b1d20'; c.fillRect(0, 0, w, h); txt(c, 'GENESIS-9  CLONE CONTROL', w * 0.42, h / 2, h * 0.5, { col: '#e8c860' }); drawLogo(c, w * 0.9, h / 2, h * 0.3, '#e8c860', { text: false }); });
  k.label(hdr, 0.62, 0.062, -0.1, 1.455, -0.119);
  // sloped control surface (frame aligned to the slope; local +Z = surface normal)
  const slope = Math.atan2(0.2, 0.45);
  const sy = 0.9, sz = 0.1;
  k.push(0, sy + 0.0, sz + 0.0, [-(HP - slope), 0, 0]);
  const pz = 0.009;
  k.box(panelM, W - 0.08, 0.44, 0.004, 0, 0, pz);
  const sl = A.add(300, 40, (c, w, h) => { ['NUTRIENT', 'GROWTH', 'MEMORY', 'OBEDIENCE'].forEach((s, i) => txt(c, s, (i + 0.5) * (w / 4), h / 2, h * 0.38, { col: '#ddd', f: 'mono', maxW: w / 4 - 6 })); });
  k.label(sl, 0.36, 0.048, -0.4, 0.17, pz + 0.003);
  k.parts.sliders = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.535 + i * 0.09;
    k.box('plastic_black', 0.014, 0.16, 0.004, x, 0.03, pz + 0.003);
    for (let t = 0; t < 5; t++) k.box(M('plastic_white', { color: 0xbbbbbb }), 0.02, 0.002, 0.001, x + 0.022, -0.045 + t * 0.038, pz + 0.0026);
    const track = k.grp(x, 0.03, pz + 0.005, { name: 'sliderTrack_' + i });
    const s = k.grp(0, 0, 0, { to: track, name: 'slider_' + i });
    k.inside(s, () => { k.box(M('plastic_grey', { color: 0x9a9a9a }), 0.04, 0.022, 0.018, 0, 0, 0.009, { r: 0.004 }); k.box('plastic_black', 0.04, 0.003, 0.0185, 0, 0, 0.009); });
    s.position.y = [0.02, -0.03, 0.05, -0.01][i];
    k.parts.sliders.push(s);
  }
  k.params.sliderTravel = 0.14;
  k.parts.knobs = [];
  const kl = A.add(300, 30, (c, w, h) => { ['TEMP', 'pH', 'FLOW', 'VOLT'].forEach((s, i) => txt(c, s, (i + 0.5) * (w / 4), h / 2, h * 0.5, { col: '#ddd', f: 'mono' })); });
  k.label(kl, 0.34, 0.034, -0.0, 0.17, pz + 0.003);
  for (let i = 0; i < 4; i++) k.parts.knobs.push(knob(k, -0.13 + i * 0.087, 0.09, pz + 0.002, 0.022, { name: 'knob_' + i, mat: M('plastic_black', { color: 0x1a1a1a }), skirt: 'chrome' }));
  k.parts.switches = [];
  for (let i = 0; i < 6; i++) k.parts.switches.push(toggle(k, -0.14 + i * 0.058, -0.05, pz + 0.002, { on: i % 3 === 0, name: 'switch_' + i }));
  const warn = A.add(260, 60, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(4, 4, w - 8, h - 8); c.fillStyle = '#e8b417'; c.fillRect(8, 8, w - 16, h - 16); txt(c, 'DO NOT PRESS TWICE', w / 2, h / 2, h * 0.36, { col: '#111', maxW: w * 0.9 }); });
  k.label(warn, 0.26, 0.06, 0.0, -0.15, pz + 0.003);
  // paper printout slot
  k.box('plastic_black', 0.2, 0.012, 0.01, 0.4, 0.17, pz + 0.006);
  k.pop();
  // printout curling out of the slot
  k.tube(M('paper', { color: 0xd8d4c4 }), [[0.4, 1.0, -0.0], [0.4, 1.06, 0.02], [0.4, 1.07, 0.09], [0.4, 1.02, 0.12]], 0.001, { rs: 3, ts: 12 });
  // big red button on its own pedestal (press = move -Y), flip-up safety cover (rotate +X... see params)
  const bx = 0.43, bz = 0.15, by = 0.98;
  k.box(M('plastic_yellow', { color: 0xd9a92a }), 0.2, 0.1, 0.2, bx, by - 0.04, bz, { r: 0.012 });
  k.cyl(hazardMat(), 0.085, 0.012, bx, by + 0.016, bz, { seg: 24 });
  k.cyl('plastic_black', 0.065, 0.006, bx, by + 0.025, bz, { seg: 24 });
  const btn = k.grp(bx, by + 0.028, bz, { name: 'button' });
  k.inside(btn, () => {
    k.cyl(M('plastic_red', { color: 0xc8231b, roughness: 0.35 }), 0.05, 0.035, 0, 0.0175, 0, { seg: 24, r2: 0.052 });
    k.sph(M('plastic_red', { color: 0xc8231b, roughness: 0.35 }), 0.05, 0, 0.035, 0, { ws: 24, hs: 6, tl: 0.6, s: [1, 0.35, 1] });
  });
  const cover = k.grp(bx, by + 0.03, bz - 0.075, { name: 'cover' });
  k.inside(cover, () => {
    k.box(M('glass', { color: 0xff9a80, opacity: 0.3, roughness: 0.1 }), 0.15, 0.07, 0.15, 0, 0.035, 0.075, { r: 0.008 });
  });
  cover.rotation.x = -1.9;
  k.cyl('chrome', 0.006, 0.16, bx, by + 0.03, bz - 0.075, { axis: 'x', seg: 8 });
  k.collide(cbox(W, 1.0, 0.66, 0, 0.5, 0));
  k.collide(cbox(W, 0.5, 0.2, 0, 1.25, -0.23));
  k.parts.button = btn;
  k.parts.cover = cover;
  k.anchors.view = V3(-0.38, 1.285, 0.45);
  k.anchors.operator = V3(0, 0, 0.75);
  return k.done({ mass: 260, material: 'metal' });
}

function b_clone_pad(o) {
  const k = new Kit('clone_pad');
  const A = k.useAtlas(512, 256);
  const body = WORN(0x4a5058, 0.6);
  const steel = STEEL();
  const R = 0.65, H = 0.25;
  // disk body
  k.lathe(M('rubber', { color: 0x141414 }), [[0, 0], [R - 0.03, 0], [R - 0.02, 0.025], [0, 0.025]], 0, 0, 0, { seg: 48 });
  k.lathe(body, [[R - 0.03, 0.02], [R, 0.05], [R, 0.18], [R - 0.03, H - 0.02], [R - 0.08, H], [R - 0.09, H - 0.012], [0.0, H - 0.012]], 0, 0, 0, { seg: 56 });
  k.cyl(hazardMat(), R + 0.002, 0.07, 0, 0.115, 0, { seg: 56, open: true });
  // grated deck
  const deck = canvasMat('pad_grate', 256, 256, (c, w, h) => {
    c.fillStyle = '#2a2e33'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0d0f11';
    const s = w / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.beginPath(); c.arc((x + 0.5 + (y % 2) * 0.5) * s, (y + 0.5) * s, s * 0.32, 0, TAU); c.fill(); }
    grime(c, w, h, 0.6, 3);
  }, { roughness: 0.6, metalness: 0.7 }, 4, 'metal');
  k.disc(deck, R - 0.1, 0, H - 0.008, 0, { seg: 48, rot: [-HP, 0, 0] });
  // emitter ring (own material) + center lens
  const ringMat = lampMat('cyan', { emissiveIntensity: 1.6 });
  const ring = k.mesh(ringMat, new THREE.RingGeometry(0.44, 0.49, 56, 1).rotateX(-HP), 0, H - 0.004, 0, { name: 'ring', shadow: false });
  k.tor(steel, 0.435, 0.008, 0, H - 0.006, 0, { axis: 'y', ts: 56, rs: 5 });
  k.tor(steel, 0.497, 0.008, 0, H - 0.006, 0, { axis: 'y', ts: 56, rs: 5 });
  k.cyl(steel, 0.12, 0.02, 0, H, 0, { seg: 24 });
  const lens = k.sph(lampMat('cyan', { emissiveIntensity: 1.2 }), 0.09, 0, H + 0.008, 0, { ws: 24, hs: 8, tl: HP, s: [1, 0.35, 1], sep: true, name: 'lens' });
  const tb = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; tb.push([Math.sin(a) * (R - 0.055), H - 0.012, Math.cos(a) * (R - 0.055)]); }
  k.bolts(tb, { r: 0.008, axis: 'y', mat: steel });
  // carry handles (4) — chunky U bars with rubber grips
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2;
    k.push(Math.sin(a) * R, 0.15, Math.cos(a) * R, [0, a, 0]);
    k.box(steel, 0.05, 0.06, 0.03, -0.11, 0, 0.0, { r: 0.008 });
    k.box(steel, 0.05, 0.06, 0.03, 0.11, 0, 0.0, { r: 0.008 });
    k.tube(steel, pipePath([[-0.11, 0, 0.0], [-0.11, 0, 0.08], [0.11, 0, 0.08], [0.11, 0, 0.0]], 0.03), 0.014, { rs: 8, ts: 30 });
    k.cyl(M('rubber', { color: 0x1d1d1d }), 0.018, 0.14, 0, 0, 0.08, { axis: 'x', seg: 10 });
    k.pop();
  }
  // pole with screen and handle bar (back)
  const pz = -R + 0.08;
  k.box(steel, 0.12, 0.05, 0.12, 0, H + 0.02, pz, { r: 0.01 });
  k.box(body, 0.05, 0.9, 0.05, 0, H + 0.45, pz, { r: 0.008 });
  k.push(0, H + 0.82, pz + 0.02, [-0.35, 0, 0]);
  k.box(body, 0.22, 0.18, 0.08, 0, 0, 0, { r: 0.015 });
  k.box('plastic_black', 0.18, 0.14, 0.01, 0, 0.005, 0.04, { r: 0.006 });
  k.screen('main', 0.16, 0.12, 0, 0.005, 0.0455, { style: 'crt', text: 'CLONE PAD MK.II\nCHARGE 100%\nREADY_', bulge: 0.004, aspect: 4 / 3 });
  k.parts.leds = [lamp(k, -0.08, -0.07, 0.04, 0.005, 'green', { name: 'led_power' }), lamp(k, 0.08, -0.07, 0.04, 0.005, 'red', { name: 'led_busy' })];
  k.pop();
  // T handle bar
  k.box(body, 0.05, 0.1, 0.05, 0, H + 1.0, pz, { r: 0.008 });
  k.cyl(steel, 0.016, 0.46, 0, H + 1.06, pz, { axis: 'x', seg: 12 });
  for (const sx of [-1, 1]) k.cyl(M('rubber', { color: 0x1d1d1d }), 0.022, 0.14, sx * 0.16, H + 1.06, pz, { axis: 'x', seg: 12 });
  // battery pack + cable
  k.box(M('plastic_yellow', { color: 0xd9a92a }), 0.2, 0.12, 0.12, 0.25, H + 0.06, pz + 0.12, { r: 0.012, rot: [0, -0.4, 0] });
  k.box('plastic_black', 0.06, 0.02, 0.04, 0.25, H + 0.13, pz + 0.12, { r: 0.006 });
  cable(k, [[0.2, H + 0.1, pz + 0.1], [0.12, H + 0.2, pz + 0.02], [0.03, H + 0.35, pz + 0.0]], 0.008, 'rubber');
  const lbl = A.add(300, 60, (c, w, h) => { c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, w, h); txt(c, 'PORTABLE CLONING PAD', w / 2, h * 0.36, h * 0.28, { col: '#111', maxW: w * 0.95 }); txt(c, 'TEAM LIFT • 95 KG • KEEP LEVEL', w / 2, h * 0.74, h * 0.2, { col: '#a01a14', f: 'mono', maxW: w * 0.95 }); });
  k.clabel(lbl, R + 0.004, 0.04, 0.42, 0, 0.18, 0, { a: 0 });
  k.collide(ccyl(R, H, 0, H / 2, 0));
  k.collide(cbox(0.08, 0.95, 0.08, 0, H + 0.47, pz));
  k.collide(cbox(0.46, 0.05, 0.05, 0, H + 1.06, pz));
  k.anchors.spawn = V3(0, H, 0);
  k.anchors.handles = [0, 1, 2, 3].map((i) => { const a = PI / 4 + (i * PI) / 2; return V3(Math.sin(a) * (R + 0.08), 0.15, Math.cos(a) * (R + 0.08)); });
  k.anchors.handleBar = V3(0, H + 1.06, pz);
  k.parts.ring = ring;
  k.parts.lens = lens;
  return k.done({ mass: 95, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Dimensional dispatch door + lever
// ---------------------------------------------------------------------------
function beacon(k, x, y, z, i) {
  const g = k.grp(x, y, z, { name: 'beacon_' + i });
  let lampMesh, refl;
  k.inside(g, () => {
    k.cyl(M('plastic_black', { color: 0x1a1a1a }), 0.1, 0.06, 0, 0.03, 0, { seg: 20, r2: 0.11 });
    k.cyl('chrome', 0.085, 0.01, 0, 0.065, 0, { seg: 20 });
    const dm = new THREE.MeshStandardMaterial({ color: 0xff8a20, emissive: 0xff5a00, emissiveIntensity: 1.6, transparent: true, opacity: 0.72, roughness: 0.2, depthWrite: false });
    dm.userData.unique = true; dm.userData.noShadow = true; dm.name = 'beacon_dome';
    lampMesh = k.mesh(dm, gLathe([[0.08, 0], [0.08, 0.1], [0.07, 0.14], [0.045, 0.165], [0.0, 0.175]], { seg: 20 }), 0, 0.07, 0, { name: 'beaconLamp_' + i, shadow: false });
    lampMesh.renderOrder = 4;
    refl = k.grp(0, 0.07, 0, { name: 'beaconReflector_' + i });
    k.inside(refl, () => {
      k.cyl(M('chrome', { roughness: 0.15 }), 0.06, 0.11, 0, 0.06, -0.01, { seg: 12, open: true, t0: HP, tl: PI, uv: false });
      k.sph(own('emissive_amber', { emissiveIntensity: 3 }), 0.022, 0, 0.06, 0.012, { ws: 10, hs: 8 });
    });
  });
  return { g, lampMesh, refl };
}
function b_dispatch_door(o) {
  const k = new Kit('dispatch_door');
  const A = k.useAtlas(1024, 512);
  const OW = 3.0, OH = 2.6, travel = 1.55;
  const plateM = WORN(0x575d63, 0.55);
  const frameM = WORN(0x2f3338, 0.6);
  const leafM = WORN(0x6b7178, 0.55);
  const steel = STEEL();
  const haz = hazardMat();
  // bulkhead plates front (z 0..0.04) and back (z -0.3..-0.26) with the opening cut out
  const bw = 6.8, bh = 3.4;
  for (const zc of [0.02, -0.28]) {
    k.box(plateM, (bw - OW) / 2, bh, 0.04, -(OW / 2 + (bw - OW) / 4), bh / 2, zc, { uv: 0.5 });
    k.box(plateM, (bw - OW) / 2, bh, 0.04, OW / 2 + (bw - OW) / 4, bh / 2, zc, { uv: 0.5 });
    k.box(plateM, OW, bh - OH, 0.04, 0, OH + (bh - OH) / 2, zc, { uv: 0.5 });
  }
  // plate seams + rivets
  const rv = [];
  for (const sx of [-1, 1]) for (const px of [2.35, 3.25]) {
    k.box(frameM, 0.04, bh, 0.012, sx * px, bh / 2, 0.046);
    for (let i = 0; i < 9; i++) rv.push([sx * px, 0.2 + i * 0.42, 0.052]);
  }
  k.bolts(rv, { r: 0.013, axis: 'z', mat: steel });
  // frame (posts + lintel) protruding in front, hazard faces toward the opening
  const fw = 0.42, fd = 0.28, ly = OH, lh = 0.5;
  for (const sx of [-1, 1]) {
    const x = sx * (OW / 2 + fw / 2);
    k.box(frameM, fw, OH + lh, fd, x, (OH + lh) / 2, 0.04 + fd / 2, { r: 0.02, uv: 0.5 });
    k.box(haz, 0.012, OH, fd - 0.04, sx * (OW / 2 + 0.004), OH / 2, 0.04 + fd / 2, {});
    k.box(haz, 0.08, OH + lh, 0.012, x - sx * (fw / 2 - 0.06), (OH + lh) / 2, 0.04 + fd + 0.004);
    // hydraulic piston on each post
    k.cyl(steel, 0.05, 1.1, x + sx * 0.06, 1.3, 0.04 + fd + 0.07, { seg: 14 });
    k.cyl('chrome', 0.03, 0.9, x + sx * 0.06, 2.2, 0.04 + fd + 0.07, { seg: 12 });
    k.box(frameM, 0.14, 0.08, 0.12, x + sx * 0.06, 0.72, 0.04 + fd + 0.04, { r: 0.01 });
    k.box(frameM, 0.14, 0.08, 0.12, x + sx * 0.06, OH + 0.1, 0.04 + fd + 0.04, { r: 0.01 });
  }
  k.box(frameM, OW + 2 * fw, lh, fd, 0, ly + lh / 2, 0.04 + fd / 2, { r: 0.02, uv: 0.5 });
  k.box(haz, OW, 0.012, fd - 0.04, 0, OH + 0.004, 0.04 + fd / 2);
  // threshold track
  k.box(steel, OW + 0.2, 0.012, 0.6, 0, 0.006, -0.12);
  k.box(haz, OW, 0.004, 0.18, 0, 0.013, 0.2);
  k.box('plastic_black', OW + 0.2, 0.01, 0.04, 0, 0.012, -0.12);
  // sign on the lintel
  const sign = A.add(1000, 130, (c, w, h) => {
    c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, 8); c.fillRect(0, h - 8, w, 8);
    txt(c, 'DIMENSIONAL DISPATCH', w / 2, h * 0.4, h * 0.42, { col: '#e8b417', maxW: w * 0.9 });
    txt(c, '— AUTHORIZED CLONES ONLY —', w / 2, h * 0.78, h * 0.2, { col: '#d8d0bc', f: 'mono', maxW: w * 0.9 });
    grime(c, w, h, 0.8, 41);
  });
  k.box(M('metal_dark', { metalMap: false, metalness: 0.5 }), 3.3, 0.42, 0.03, 0, ly + lh / 2, 0.04 + fd + 0.015, { r: 0.01 });
  k.label(sign, 3.24, 0.42 * 3.24 / 3.3 * 0.96, 0, ly + lh / 2, 0.04 + fd + 0.0312, { glow: 0.22 });
  k.bolts([[-1.6, ly + lh / 2 + 0.17, 0.04 + fd + 0.032], [1.6, ly + lh / 2 + 0.17, 0.04 + fd + 0.032], [-1.6, ly + lh / 2 - 0.17, 0.04 + fd + 0.032], [1.6, ly + lh / 2 - 0.17, 0.04 + fd + 0.032]], { r: 0.012, mat: steel });
  // conduit along the top + cable tray
  k.cyl(steel, 0.035, bw - 0.3, 0, bh - 0.12, 0.1, { axis: 'x', seg: 10 });
  k.cyl(steel, 0.025, bw - 0.3, 0, bh - 0.22, 0.09, { axis: 'x', seg: 10 });
  // beacons
  k.parts.beacons = []; k.parts.beaconLamps = []; k.parts.beaconReflectors = [];
  [-1.25, 1.25].forEach((x, i) => {
    const b = beacon(k, x, ly + lh, 0.04 + fd / 2, i);
    k.parts.beacons.push(b.g); k.parts.beaconLamps.push(b.lampMesh); k.parts.beaconReflectors.push(b.refl);
  });
  // door leaves
  const LW = OW / 2 + 0.05, LH = OH + 0.02, LD = 0.16, lz = -0.12;
  const leaf = (sx) => {
    const g = k.grp(sx * LW / 2, 0, lz, { name: sx < 0 ? 'left' : 'right' });
    g.userData.x0 = g.position.x;
    k.inside(g, () => {
      // main slab with interlocking teeth on the meeting edge
      const s = new THREE.Shape();
      const e = -sx * LW / 2; // meeting edge x
      const out = sx * LW / 2;
      s.moveTo(out, 0); s.lineTo(e + sx * 0.05, 0);
      const teeth = 6;
      for (let i = 0; i < teeth; i++) {
        const y0 = (i / teeth) * LH, y1 = ((i + 0.5) / teeth) * LH, y2 = ((i + 1) / teeth) * LH;
        const inX = e + sx * 0.05, outX = e - sx * 0.05;
        if (sx < 0) { s.lineTo(i % 2 ? inX : outX, y0); s.lineTo(i % 2 ? inX : outX, y1); s.lineTo(i % 2 ? outX : inX, y1); s.lineTo(i % 2 ? outX : inX, y2); }
        else { s.lineTo(i % 2 ? outX : inX, y0); s.lineTo(i % 2 ? outX : inX, y1); s.lineTo(i % 2 ? inX : outX, y1); s.lineTo(i % 2 ? inX : outX, y2); }
      }
      s.lineTo(out, LH); s.closePath();
      k.ext(leafM, s, LD, 0, 0, -LD / 2, { bev: 0.01, cs: 1, uv: 0.6 });
      // ribs + rivets on the front face
      const rib = [];
      for (let i = 0; i < 4; i++) {
        const y = 0.55 + i * 0.6;
        k.box(frameM, LW - 0.25, 0.06, 0.03, sx * 0.05, y, LD / 2 + 0.015, { r: 0.008 });
        for (let j = 0; j < 6; j++) rib.push([sx * 0.05 - (LW - 0.35) / 2 + j * ((LW - 0.35) / 5), y, LD / 2 + 0.031]);
      }
      k.bolts(rib, { r: 0.01, mat: steel });
      // hazard band at the bottom
      k.box(haz, LW - 0.06, 0.32, 0.01, sx * 0.0, 0.2, LD / 2 + 0.006);
      // porthole
      const px = sx * 0.25, py = 1.75;
      k.tor(steel, 0.14, 0.022, px, py, LD / 2 + 0.008, { rs: 8, ts: 24 });
      k.disc(M('glass_tint', { color: 0x1a2a2a, opacity: 0.85, roughness: 0.1 }), 0.13, px, py, LD / 2 + 0.005, { seg: 24 });
      for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU; k.cyl(steel, 0.01, 0.012, px + Math.cos(a) * 0.14, py + Math.sin(a) * 0.14, LD / 2 + 0.028, { axis: 'z', seg: 6 }); }
      // big stencil
      const st = A.add(300, 160, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, sx < 0 ? 'D-0' : '01', w / 2, h / 2, h * 0.8, { col: 'rgba(230,220,200,0.85)', f: 'stencil' }); });
      k.label(st, 0.6, 0.32, sx * 0.1, 1.15, LD / 2 + 0.0055);
      // back face: plain ribs
      for (let i = 0; i < 3; i++) k.box(frameM, LW - 0.25, 0.06, 0.03, sx * 0.05, 0.7 + i * 0.7, -LD / 2 - 0.015);
    });
    return g;
  };
  k.parts.left = leaf(-1);
  k.parts.right = leaf(1);
  // static colliders: posts, lintel, plates
  for (const sx of [-1, 1]) {
    k.collide(cbox(fw, OH + lh, fd, sx * (OW / 2 + fw / 2), (OH + lh) / 2, 0.04 + fd / 2));
    k.collide(cbox((bw - OW) / 2, bh, 0.36, sx * (OW / 2 + (bw - OW) / 4), bh / 2, -0.12));
  }
  k.collide(cbox(OW + 2 * fw, bh - OH, 0.36, 0, OH + (bh - OH) / 2, -0.06));
  k.params.travel = travel;
  k.params.opening = [OW, OH];
  k.params.leafCollider = cbox(LW, LH, LD, 0, LH / 2, 0);
  k.anchors.threshold = V3(0, 0, 0.3);
  k.anchors.through = V3(0, 0, -1.0);
  return k.done({ mass: 6000, material: 'metal' });
}

function b_dispatch_lever(o) {
  const k = new Kit('dispatch_lever');
  const A = k.useAtlas(512, 256);
  const body = WORN(0x3b4046, 0.5);
  const steel = STEEL();
  k.box(steel, 0.5, 0.04, 0.45, 0, 0.02, 0, { r: 0.008 });
  k.bolts([[-0.21, 0.042, -0.18], [0.21, 0.042, -0.18], [-0.21, 0.042, 0.18], [0.21, 0.042, 0.18]], { r: 0.012, axis: 'y', mat: steel });
  k.box(body, 0.24, 0.72, 0.22, 0, 0.4, 0, { r: 0.015 });
  k.box(hazardMat(), 0.245, 0.18, 0.225, 0, 0.14, 0);
  // housing
  k.box(body, 0.36, 0.22, 0.3, 0, 0.87, 0, { r: 0.025 });
  k.box('plastic_black', 0.06, 0.012, 0.24, 0, 0.98, 0);
  for (const sx of [-1, 1]) k.cyl(steel, 0.05, 0.03, sx * 0.165, 0.9, 0, { axis: 'x', seg: 16 });
  // lever (pivot = axle; rotation.x: -0.6 armed/back .. +0.6 pulled toward +Z)
  const handle = k.grp(0, 0.9, 0, { name: 'handle' });
  k.inside(handle, () => {
    k.cyl(steel, 0.025, 0.08, 0, 0, 0, { axis: 'x', seg: 14 });
    k.cyl(steel, 0.016, 0.5, 0, 0.25, 0, { seg: 12 });
    k.cyl(M('rubber', { color: 0xb3221a, roughness: 0.6 }), 0.032, 0.14, 0, 0.53, 0, { seg: 14 });
    k.sph(M('plastic_red', { color: 0xc8231b, roughness: 0.35 }), 0.045, 0, 0.62, 0, { ws: 18, hs: 12 });
  });
  handle.rotation.x = -0.6;
  // status CRT on an arm (right side), tilted toward the operator
  k.box(steel, 0.06, 0.05, 0.05, 0.2, 0.92, 0.06, { r: 0.008 });
  k.push(0.29, 1.0, 0.1, [-0.25, -0.35, 0]);
  k.box(body, 0.2, 0.17, 0.14, 0, 0, -0.05, { r: 0.015 });
  k.ext('plastic_black', frameShape(0.18, 0.15, 0.015, 0.14, 0.105, 0.01), 0.01, 0, 0, 0.018, { bev: 0.003, cs: 3 });
  k.screen('main', 0.14, 0.105, 0, 0, 0.02, { style: 'amber', text: 'DISPATCH STATUS\nTARGET: LEVEL 0\nCREW: 4/4\nAWAITING LEVER_', bulge: 0.006, aspect: 4 / 3 });
  k.pop();
  // lamps + labels on the housing front
  k.parts.lamps = [lamp(k, -0.1, 0.84, 0.15, 0.012, 'green', { name: 'lamp_ready' }), lamp(k, 0.1, 0.84, 0.15, 0.012, 'red', { name: 'lamp_armed' })];
  const lb = A.add(300, 70, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'DISPATCH', w / 2, h * 0.36, h * 0.38, { col: '#e8b417' }); txt(c, 'PULL TO SEND', w / 2, h * 0.76, h * 0.22, { col: '#d8d0bc', f: 'mono' }); });
  k.label(lb, 0.2, 0.047, 0, 0.91, 0.1505);
  const rd = A.add(160, 30, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'READY', w * 0.25, h / 2, h * 0.5, { col: '#8f8', f: 'mono' }); txt(c, 'ARMED', w * 0.75, h / 2, h * 0.5, { col: '#f88', f: 'mono' }); });
  k.label(rd, 0.26, 0.03, 0, 0.8, 0.1505);
  const wl = A.add(200, 120, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); hazardTri(c, w * 0.2, h * 0.5, h * 0.55); ['ONE PULL', 'PER CREW', 'NO REFUNDS'].forEach((s, i) => txt(c, s, w * 0.62, h * (0.28 + i * 0.24), h * 0.16, { col: '#111', f: 'mono' })); grime(c, w, h, 0.6, 2); });
  k.label(wl, 0.16, 0.096, 0, 0.55, 0.1105);
  cable(k, [[0.0, 0.3, -0.11], [0.0, 0.1, -0.2], [0.05, 0.015, -0.4], [0.3, 0.015, -0.9]], 0.02, 'rubber', { ts: 20 });
  k.collide(cbox(0.5, 0.04, 0.45, 0, 0.02, 0));
  k.collide(cbox(0.24, 0.72, 0.22, 0, 0.4, 0));
  k.collide(cbox(0.36, 0.22, 0.3, 0, 0.87, 0));
  k.parts.handle = handle;
  k.anchors.grip = V3(0, 0.9 + 0.53 * Math.cos(-0.6), 0.53 * Math.sin(-0.6));
  k.params.handleRange = [-0.6, 0.6];
  return k.done({ mass: 180, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Mission generators
// ---------------------------------------------------------------------------
function sticker(k, A, w, h, draw, x, y, z, o = NO) {
  const reg = A.add(Math.round(w * 800), Math.round(h * 800), draw);
  return k.label(reg, w, h, x, y, z, o);
}
function b_generator_diesel(o) {
  const k = new Kit('generator_diesel');
  const A = k.useAtlas(512, 512);
  const W = 1.4, D = 0.8;
  const skid = WORN(0x34383c, 0.6);
  const cage = WORN(0xd9a21f, 0.4);
  const engine = WORN(0x4c5a48, 0.45);
  const alt = WORN(0x2f4f7a, 0.4);
  const tankM = WORN(0xa8261c, 0.35);
  const steel = STEEL();
  // skid rails + cross members
  for (const sz of [-1, 1]) {
    k.box(skid, W, 0.08, 0.06, 0, 0.04, sz * (D / 2 - 0.03));
    k.box(skid, W, 0.012, 0.1, 0, 0.074, sz * (D / 2 - 0.05));
  }
  for (const x of [-0.55, 0, 0.55]) k.box(skid, 0.06, 0.05, D - 0.06, x, 0.055, 0);
  // fork pockets
  for (const x of [-0.35, 0.35]) for (const sz of [-1, 1]) k.box('plastic_black', 0.16, 0.05, 0.012, x, 0.04, sz * (D / 2 + 0.001));
  // roll cage
  const cr = 0.022, ch = 0.98;
  for (const sz of [-1, 1]) k.tube(cage, pipePath([[-W / 2 + 0.03, 0.08, sz * (D / 2 - 0.03)], [-W / 2 + 0.03, ch, sz * (D / 2 - 0.03)], [W / 2 - 0.03, ch, sz * (D / 2 - 0.03)], [W / 2 - 0.03, 0.08, sz * (D / 2 - 0.03)]], 0.08), cr, { rs: 8, ts: 50 });
  for (const sx of [-1, 1]) k.cyl(cage, cr, D - 0.06, sx * (W / 2 - 0.03), ch, 0, { axis: 'z', seg: 8 });
  k.cyl(cage, cr * 1.1, D - 0.06, 0, ch, 0, { axis: 'z', seg: 8 });
  k.box(steel, 0.1, 0.02, 0.1, 0, ch + 0.02, 0, { r: 0.006 });
  k.tor(steel, 0.04, 0.008, 0, ch + 0.065, 0, { ts: 14, rs: 5 });
  // engine block (left)
  const ex = -0.3;
  k.box(engine, 0.5, 0.42, 0.46, ex, 0.32, 0, { r: 0.02 });
  k.box(engine, 0.42, 0.06, 0.4, ex, 0.56, 0, { r: 0.01 });
  for (let i = 0; i < 8; i++) k.box(engine, 0.36, 0.006, 0.36, ex - 0.02, 0.6 + i * 0.018, -0.02);
  k.box(engine, 0.3, 0.05, 0.3, ex - 0.02, 0.76, -0.02, { r: 0.012 });
  // air filter
  k.cyl(M('metal_dark', { metalMap: false, metalness: 0.6 }), 0.09, 0.08, ex - 0.15, 0.83, -0.05, { seg: 20 });
  k.cyl(steel, 0.02, 0.012, ex - 0.15, 0.876, -0.05, { seg: 10 });
  // recoil starter on the engine front (+Z)
  const rs = [ex - 0.02, 0.38, 0.23];
  k.lathe(engine, [[0.0, 0.0], [0.13, 0.0], [0.14, 0.02], [0.13, 0.055], [0.08, 0.075], [0.0, 0.08]], rs[0], rs[1], rs[2], { seg: 28, rot: [HP, 0, 0] });
  slots(k, rs[0], rs[1] - 0.02, rs[2] + 0.081, 0.12, 0.06, 4, {});
  const exit = [rs[0] + 0.08, rs[1] + 0.07, rs[2] + 0.07];
  k.cyl('chrome', 0.012, 0.02, exit[0], exit[1], exit[2], { axis: 'z', seg: 10 });
  const cord = k.grp(exit[0], exit[1], exit[2] + 0.03, { name: 'cordHandle' });
  cord.userData.z0 = cord.position.z;
  k.inside(cord, () => {
    k.cyl(M('rubber', { color: 0x151515 }), 0.016, 0.11, 0, 0, 0.0, { axis: 'x', seg: 10 });
    k.cyl(M('plastic_red', { color: 0xb3221a }), 0.006, 0.03, 0, 0, -0.016, { axis: 'z', seg: 6 });
  });
  // alternator (right)
  const axx = 0.28;
  k.cyl(alt, 0.2, 0.42, axx, 0.36, 0, { axis: 'x', seg: 24 });
  k.cyl(alt, 0.17, 0.06, axx + 0.24, 0.36, 0, { axis: 'x', seg: 24 });
  for (let i = 0; i < 5; i++) k.tor(alt, 0.2, 0.008, axx - 0.16 + i * 0.08, 0.36, 0, { axis: 'x', ts: 24, rs: 4 });
  k.box(skid, 0.4, 0.14, 0.3, axx, 0.12, 0, { r: 0.01 });
  // fuel tank across the top
  k.box(tankM, 0.8, 0.17, 0.44, 0.08, 0.89, 0, { r: 0.04 });
  k.box(steel, 0.82, 0.012, 0.03, 0.08, 0.85, -0.1);
  k.box(steel, 0.82, 0.012, 0.03, 0.08, 0.85, 0.1);
  k.cyl(steel, 0.06, 0.012, 0.22, 0.98, 0.08, { seg: 20 });
  const cap = k.grp(0.22, 0.986, 0.08, { name: 'fuelCap' });
  k.inside(cap, () => {
    k.cyl(M('plastic_black', { color: 0x161616 }), 0.045, 0.03, 0, 0.015, 0, { seg: 16 });
    k.box(M('plastic_black', { color: 0x161616 }), 0.08, 0.018, 0.016, 0, 0.035, 0, { r: 0.005 });
  });
  k.box('plastic_black', 0.09, 0.008, 0.05, -0.05, 0.977, 0.14, { r: 0.003 });
  sticker(k, A, 0.22, 0.06, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); txt(c, 'DIESEL ONLY', w / 2, h / 2, h * 0.55, { col: '#111' }); }, -0.15, 0.9, 0.2205);
  sticker(k, A, 0.3, 0.075, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'R.O.O.M. FIELD POWER', w / 2, h * 0.38, h * 0.32, { col: '#e8c860', maxW: w * 0.92 }); txt(c, 'UNIT FPU-3 • 7.5 kVA', w / 2, h * 0.76, h * 0.22, { col: '#ccc', f: 'mono' }); }, 0.27, 0.9, 0.2205);
  // exhaust: muffler + bent pipe (anchor at outlet)
  const rust = M('rust');
  k.cyl(rust, 0.07, 0.3, -0.5, 0.62, -0.3, { axis: 'x', seg: 16 });
  k.tube(rust, pipePath([[-0.35, 0.62, -0.3], [-0.3, 0.62, -0.3], [-0.3, 0.6, -0.2]], 0.04), 0.025, { rs: 8, ts: 12 });
  k.tube(rust, pipePath([[-0.65, 0.62, -0.3], [-0.72, 0.62, -0.3], [-0.72, 1.12, -0.3], [-0.66, 1.18, -0.3]], 0.05), 0.03, { rs: 8, ts: 30 });
  k.anchors.exhaust = V3(-0.65, 1.18, -0.3);
  // battery
  k.box(M('plastic_black', { color: 0x1a1a1a }), 0.2, 0.16, 0.13, 0.55, 0.16, -0.2, { r: 0.008 });
  k.cyl(M('plastic_red', { color: 0xb3221a }), 0.012, 0.02, 0.5, 0.25, -0.2, { seg: 8 });
  k.cyl('plastic_black', 0.012, 0.02, 0.6, 0.25, -0.2, { seg: 8 });
  cable(k, [[0.5, 0.26, -0.2], [0.45, 0.32, -0.15], [0.35, 0.3, -0.1]], 0.008, M('rubber', { color: 0x8a1a14 }));
  // control panel (front, right) — gauges, lamp, small LCD
  k.push(0.33, 0.6, 0.27, [-0.25, 0, 0]);
  const pm = M('metal_dark', { metalMap: false, metalness: 0.5, color: 0x2a2d30 });
  k.box(pm, 0.44, 0.27, 0.06, 0, 0, -0.03, { r: 0.012 });
  k.box(steel, 0.05, 0.25, 0.02, 0, -0.17, -0.06);
  const pz = 0.0;
  k.parts.needles = [
    gauge(k, -0.14, 0.05, pz, 0.045, { label: 'OIL', max: 80, red: 0.85, value: 0.1, name: 'needle_oil' }),
    gauge(k, -0.03, 0.05, pz, 0.045, { label: 'TEMP', labels: ['C', '', '', '', '', 'H'], red: 0.8, value: 0.05, name: 'needle_temp' }),
    gauge(k, 0.08, 0.05, pz, 0.045, { label: 'VOLTS', max: 300, green: [0.6, 0.85], value: 0.0, name: 'needle_volts' }),
  ];
  k.parts.lamp = lamp(k, 0.17, 0.07, pz, 0.014, 'red', { name: 'lamp' });
  k.box('plastic_black', 0.15, 0.05, 0.01, -0.06, -0.06, pz + 0.004, { r: 0.004 });
  k.screen('main', 0.13, 0.04, -0.06, -0.06, pz + 0.0095, { style: 'lcd', text: 'HRS 0042.7', bulge: 0, aspect: 0.13 / 0.04 });
  k.parts.switches = [toggle(k, 0.07, -0.06, pz, { name: 'switch_run' }), toggle(k, 0.12, -0.06, pz, { name: 'switch_choke', on: true })];
  for (const x of [-0.12, 0.0]) {
    k.box(M('plastic_yellow', { color: 0xd9a92a }), 0.07, 0.05, 0.012, x + 0.06, -0.105, pz + 0.006, { r: 0.006 });
    k.box('plastic_black', 0.006, 0.014, 0.004, x + 0.05, -0.105, pz + 0.013);
    k.box('plastic_black', 0.006, 0.014, 0.004, x + 0.07, -0.105, pz + 0.013);
  }
  pushButton(k, 0.17, -0.07, pz, 0.016, { mat: M('plastic_green', { color: 0x2a8a3a }), name: 'startButton' });
  k.pop();
  sticker(k, A, 0.16, 0.12, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); hazardTri(c, w * 0.25, h * 0.45, h * 0.6); txt(c, 'CO', w * 0.7, h * 0.32, h * 0.3, { col: '#c0201a' }); txt(c, 'DO NOT RUN', w * 0.68, h * 0.62, h * 0.12, { col: '#111', f: 'mono' }); txt(c, 'INDOORS*', w * 0.68, h * 0.78, h * 0.12, { col: '#111', f: 'mono' }); grime(c, w, h, 0.5, 5); }, ex + 0.1, 0.3, 0.2305);
  k.bolts([[ex - 0.2, 0.15, 0.231], [ex + 0.2, 0.15, 0.231], [ex - 0.2, 0.49, 0.231], [ex + 0.2, 0.49, 0.231]], { r: 0.01, mat: steel });
  k.collide(cbox(W, ch + 0.04, D, 0, (ch + 0.04) / 2, 0));
  k.anchors.fuelCap = V3(0.22, 1.0, 0.08);
  k.anchors.cordRest = cord.position.clone();
  k.anchors.cordExit = V3(...exit);
  k.anchors.panel = V3(0.33, 0.6, 0.35);
  k.parts.fuelCap = cap;
  k.parts.cordHandle = cord;
  return k.done({ mass: 230, material: 'metal' });
}

const WIRE_COL = { red: 0xc8231b, blue: 0x2a5fc0, green: 0x2a9a3a, yellow: 0xe8c020 };
function b_generator_electric(o) {
  const k = new Kit('generator_electric');
  const A = k.useAtlas(512, 512);
  const W = 1.0, H = 1.7, D = 0.7, t = 0.02;
  const body = WORN(0x7b8086, 0.45);
  const inner = WORN(0xa9a69a, 0.3);
  const steel = STEEL();
  // shell
  k.box('plastic_black', W - 0.04, 0.08, D - 0.04, 0, 0.04, 0);
  k.box(body, t, H - 0.08, D, -W / 2 + t / 2, 0.08 + (H - 0.08) / 2, 0, { r: 0.004 });
  k.box(body, t, H - 0.08, D, W / 2 - t / 2, 0.08 + (H - 0.08) / 2, 0, { r: 0.004 });
  k.box(body, W + 0.02, 0.03, D + 0.02, 0, H - 0.015, 0, { r: 0.006 });
  k.box(body, W, t, D, 0, 0.09, 0);
  k.box(body, W, H - 0.08, t, 0, 0.08 + (H - 0.08) / 2, -D / 2 + t / 2);
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) k.box('plastic_black', 0.004, 0.012, 0.3, sx * (W / 2 + 0.001), 1.2 + i * 0.03, -0.05);
  // header (fixed) above the door: screen + status lamp + plate
  const hy = 1.53;
  k.box(body, W - 0.04, 0.3, 0.02, 0, hy, D / 2 - 0.01);
  k.box('plastic_black', 0.3, 0.2, 0.02, -0.2, hy, D / 2 + 0.005, { r: 0.01 });
  k.screen('main', 0.26, 0.17, -0.2, hy, D / 2 + 0.0155, { style: 'crt', text: 'GRID UNIT GU-7\nPHASE: --\nFUSE: MISSING\nBREAKER: OFF', bulge: 0.006, aspect: 0.26 / 0.17 });
  k.parts.lamp = lamp(k, 0.33, hy + 0.05, D / 2, 0.025, 'red', { name: 'lamp' });
  sticker(k, A, 0.28, 0.08, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'R.O.O.M. GRID UNIT', w / 2, h * 0.38, h * 0.32, { col: '#e8c860', maxW: w * 0.92 }); txt(c, 'GU-7 • 480V 3Ø', w / 2, h * 0.76, h * 0.22, { col: '#ccc', f: 'mono' }); }, 0.22, hy - 0.07, D / 2 + 0.0005);
  // inner back plate (mounting panel)
  k.box(inner, W - 0.12, 1.2, 0.012, 0, 0.75, -D / 2 + 0.03);
  // terminals 4x2
  const left = o.leftOrder ?? ['red', 'blue', 'green', 'yellow'];
  const right = o.rightOrder ?? ['yellow', 'red', 'blue', 'green'];
  k.anchors.terminals = [];
  k.params.terminalColors = [];
  k.params.terminalSides = [];
  const tz = -D / 2 + 0.036;
  const rows = [1.18, 1.04, 0.9, 0.76];
  [[left, -0.22, 'left'], [right, 0.22, 'right']].forEach(([cols, x, side]) => {
    k.box(M('plastic_black', { color: 0x1a1a1a }), 0.12, 0.56, 0.02, x, 0.97, tz + 0.01, { r: 0.004 });
    cols.forEach((col, i) => {
      const y = rows[i];
      k.box(M('plastic_white', { color: WIRE_COL[col] }), 0.07, 0.07, 0.05, x, y, tz + 0.045, { r: 0.008 });
      k.cyl('brass', 0.011, 0.04, x, y, tz + 0.085, { axis: 'z', seg: 12 });
      k.cyl('brass', 0.018, 0.006, x, y, tz + 0.07, { axis: 'z', seg: 6 });
      k.anchors.terminals.push(V3(x, y, tz + 0.105));
      k.params.terminalColors.push(col);
      k.params.terminalSides.push(side);
    });
  });
  sticker(k, A, 0.2, 0.26, (c, w, h) => {
    c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h);
    txt(c, 'PHASE MATCH', w / 2, h * 0.08, h * 0.07, { col: '#111' });
    ['red', 'blue', 'green', 'yellow'].forEach((col, i) => { c.strokeStyle = '#' + WIRE_COL[col].toString(16).padStart(6, '0'); c.lineWidth = 6; c.beginPath(); c.moveTo(w * 0.12, h * (0.22 + i * 0.18)); c.bezierCurveTo(w * 0.5, h * (0.22 + i * 0.18), w * 0.5, h * (0.22 + ((i + 1) % 4) * 0.18), w * 0.88, h * (0.22 + ((i + 1) % 4) * 0.18)); c.stroke(); });
    txt(c, 'COLOR TO COLOR. ALWAYS.', w / 2, h * 0.94, h * 0.05, { col: '#a01a14', f: 'mono', maxW: w * 0.95 });
  }, 0, 1.0, tz + 0.001);
  // fuse socket (ceramic holder with brass clips)
  const fy = 0.5;
  k.box(M('plastic_white', { color: 0xd4cfc0, roughness: 0.4 }), 0.22, 0.08, 0.05, 0, fy, tz + 0.025, { r: 0.01 });
  for (const sx of [-1, 1]) {
    k.box('brass', 0.02, 0.05, 0.03, sx * 0.07, fy, tz + 0.06, { r: 0.004 });
    k.tor('brass', 0.016, 0.004, sx * 0.07, fy, tz + 0.078, { axis: 'x', ts: 12, rs: 4, arc: PI });
  }
  const fuseSlot = k.grp(0, fy, tz + 0.08, { name: 'fuseSlot' });
  sticker(k, A, 0.16, 0.035, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'FUSE 200A', w / 2, h / 2, h * 0.6, { col: '#e8c860', f: 'mono' }); }, 0, fy - 0.07, tz + 0.001);
  // big breaker (lever along +Z; rotation.x -0.7 = ON/up, +0.7 = OFF/down)
  const bx = 0.3, by = 0.4;
  k.box(M('metal_dark', { metalMap: false, metalness: 0.5 }), 0.14, 0.24, 0.1, bx, by, tz + 0.05, { r: 0.01 });
  for (const sx of [-1, 1]) k.box(steel, 0.012, 0.1, 0.04, bx + sx * 0.04, by, tz + 0.115);
  const breaker = k.grp(bx, by, tz + 0.12, { name: 'breaker' });
  k.inside(breaker, () => {
    k.cyl(steel, 0.016, 0.08, 0, 0, 0, { axis: 'x', seg: 12 });
    k.box(steel, 0.03, 0.025, 0.16, 0, 0, 0.08, { r: 0.006 });
    k.cyl(M('plastic_red', { color: 0xb3221a }), 0.022, 0.1, 0, 0, 0.19, { axis: 'z', seg: 14 });
  });
  breaker.rotation.x = 0.7;
  sticker(k, A, 0.12, 0.06, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'ON ▲', w / 2, h * 0.3, h * 0.28, { col: '#8f8', f: 'mono' }); txt(c, 'OFF ▼', w / 2, h * 0.72, h * 0.28, { col: '#f88', f: 'mono' }); }, bx - 0.13, by, tz + 0.001);
  // cable bundles
  for (let i = 0; i < 4; i++) cable(k, [[-0.42 + i * 0.03, 1.32, tz + 0.02], [-0.42 + i * 0.03, 0.3, tz + 0.02], [-0.4 + i * 0.03, 0.12, tz + 0.04]], 0.008, M('rubber', { color: WIRE_COL[['red', 'blue', 'green', 'yellow'][i]] }), { ts: 8 });
  // door (pivot on the left edge; negative rotation.y opens)
  const DW = W - 0.02, DH = 1.3, dy0 = 0.1;
  const door = k.grp(-W / 2 + 0.01, 0, D / 2, { name: 'door' });
  k.inside(door, () => {
    const cx = DW / 2;
    k.box(body, DW, DH, 0.025, cx, dy0 + DH / 2, 0.0125, { r: 0.006 });
    louvers(k, cx, dy0 + 0.2, 0.026, 0.5, 0.18, 6, { mat: body });
    louvers(k, cx, dy0 + DH - 0.15, 0.026, 0.5, 0.12, 4, { mat: body });
    sticker(k, A, 0.3, 0.22, (c, w, h) => {
      c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c0201a'; c.fillRect(0, 0, w, h * 0.28);
      txt(c, 'DANGER', w / 2, h * 0.15, h * 0.2, { col: '#fff' });
      hazardTri(c, w * 0.2, h * 0.62, h * 0.4, 'bolt');
      ['HIGH VOLTAGE', 'INSIDE. WEAR', 'YOUR GLOVES.'].forEach((s, i) => txt(c, s, w * 0.64, h * (0.45 + i * 0.16), h * 0.1, { col: '#111', maxW: w * 0.6 }));
      grime(c, w, h, 0.6, 17);
    }, cx, 0.95, 0.0255);
    k.box('chrome', 0.04, 0.2, 0.02, DW - 0.06, 0.75, 0.035, { r: 0.006 });
    k.box(M('plastic_black', { color: 0x151515 }), 0.03, 0.12, 0.03, DW - 0.06, 0.75, 0.05, { r: 0.008 });
    sticker(k, A, 0.24, 0.3, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); txt(c, 'WIRING DIAGRAM', w / 2, 14, 12, { col: '#111' }); c.strokeStyle = '#333'; c.lineWidth = 1.5; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(20, 40 + i * 22); c.lineTo(w - 20, 40 + i * 22 + (i % 3) * 8); c.stroke(); c.strokeRect(10, 34 + i * 22, 12, 12); } }, cx, 0.8, -0.0005, { rot: [0, PI, 0] });
  });
  for (const y of [0.3, 0.75, 1.2]) k.cyl('chrome', 0.008, 0.08, -W / 2 + 0.01, y, D / 2 + 0.01, { seg: 8 });
  // conduits out of the top
  for (const x of [-0.3, -0.15]) k.cyl(WORN(0x8a8f8c, 0.7), 0.025, 0.8, x, H + 0.4, -0.1, { seg: 12 });
  k.collide(cbox(W, H, D, 0, H / 2, 0));
  k.anchors.fuseSocket = V3(0, fy, tz + 0.08);
  k.parts.door = door;
  k.parts.fuseSlot = fuseSlot;
  k.parts.breaker = breaker;
  k.params.doorOpenSign = -1;
  k.params.breakerOn = -0.7;
  k.params.breakerOff = 0.7;
  k.params.doorCollider = cbox(DW, DH, 0.025, DW / 2, dy0 + DH / 2, 0.0125);
  return k.done({ mass: 320, material: 'metal' });
}

function b_generator_mech(o) {
  const k = new Kit('generator_mech');
  const A = k.useAtlas(512, 512);
  const iron = WORN(0x2e3134, 0.6);
  const copper = M('brass', { color: 0xc8784a, roughness: 0.4 });
  const brass = M('brass', { roughness: 0.35 });
  const steel = STEEL();
  const rust = M('rust');
  // riveted skid
  k.box(iron, 1.6, 0.12, 0.9, 0, 0.06, 0, { r: 0.01 });
  const rv = [];
  for (let i = 0; i < 12; i++) { rv.push([-0.75 + i * 0.136, 0.08, 0.452]); rv.push([-0.75 + i * 0.136, 0.08, -0.452]); }
  k.bolts(rv, { r: 0.01, mat: iron });
  for (const [x, z] of [[-0.72, -0.38], [0.72, -0.38], [-0.72, 0.38], [0.72, 0.38]]) k.cyl(iron, 0.05, 0.03, x, 0.015, z, { seg: 8 });
  // boiler drum (horizontal, along X)
  const dx = -0.22, dy = 0.6, dr = 0.3, dl = 0.95;
  k.cyl(copper, dr, dl, dx, dy, 0, { axis: 'x', seg: 32 });
  for (const s of [-1, 1]) k.lathe(iron, [[dr + 0.012, 0], [dr + 0.01, 0.03], [dr * 0.75, 0.09], [0.0, 0.12]], dx + s * dl / 2, dy, 0, { seg: 32, rot: [0, 0, s > 0 ? -HP : HP] });
  for (let i = 0; i < 4; i++) k.tor(iron, dr + 0.004, 0.014, dx - dl / 2 + 0.1 + i * 0.25, dy, 0, { axis: 'x', ts: 32, rs: 5 });
  const drv = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 14; j++) { const a = (j / 14) * TAU; drv.push([dx - dl / 2 + 0.1 + i * 0.25, dy + Math.sin(a) * (dr + 0.016), Math.cos(a) * (dr + 0.016)]); }
  for (const p of drv) k.sph(iron, 0.008, p[0], p[1], p[2], { ws: 5, hs: 4, uv: false });
  // cradles
  for (const x of [dx - 0.3, dx + 0.3]) k.box(iron, 0.1, 0.32, 0.5, x, 0.27, 0, { r: 0.01 });
  // flywheel (rotates around X) on an A-frame bearing pedestal
  const fx = 0.62, fy = 0.62, FR = 0.42;
  for (const sz of [-1, 1]) k.box(iron, 0.08, 0.6, 0.06, fx + 0.12, 0.38, sz * 0.12, { rot: [sz * 0.25, 0, 0], r: 0.008 });
  k.box(iron, 0.12, 0.12, 0.14, fx + 0.12, fy, 0, { r: 0.015 });
  k.cyl(steel, 0.035, 0.42, fx + 0.06, fy, 0, { axis: 'x', seg: 14 });
  const fly = k.grp(fx, fy, 0, { name: 'flywheel' });
  k.inside(fly, () => {
    k.lathe(iron, [[FR - 0.06, -0.05], [FR, -0.05], [FR + 0.006, 0], [FR, 0.05], [FR - 0.06, 0.05], [FR - 0.065, 0], [FR - 0.06, -0.05]], 0, 0, 0, { seg: 48, rot: [0, 0, HP] });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.box(iron, 0.05, FR - 0.08, 0.035, 0, Math.cos(a) * (FR / 2), Math.sin(a) * (FR / 2), { rot: [a, 0, 0], r: 0.008 }); }
    k.cyl(iron, 0.09, 0.12, 0, 0, 0, { axis: 'x', seg: 16 });
    k.cyl(brass, 0.05, 0.13, 0, 0, 0, { axis: 'x', seg: 12 });
    k.box(M('paint', { color: 0xc8231b }), 0.01, 0.06, 0.03, -0.055, FR - 0.03, 0);
  });
  // belt to the dynamo pulley (static)
  const py = 1.22, pr = 0.07;
  const belt = [];
  for (let i = 0; i <= 24; i++) { const a = HP + (i / 24) * PI; belt.push([fx - 0.04, fy + Math.cos(a) * (FR + 0.01), Math.sin(a) * (FR + 0.01)]); }
  for (let i = 1; i < 12; i++) { const a = -HP + (i / 12) * PI; belt.push([fx - 0.04, py + Math.cos(a) * (pr + 0.008), Math.sin(a) * (pr + 0.008)]); }
  k.tube(M('rubber', { color: 0x2a1a10 }), belt.map((p) => V3(...p)), 0.008, { closed: true, ts: 80, rs: 4, ct: 'centripetal' });
  // dynamo on top of the drum
  const dyx = 0.33;
  k.cyl(iron, 0.12, 0.34, dyx, py, 0, { axis: 'x', seg: 20 });
  for (let i = 0; i < 6; i++) k.tor(copper, 0.12, 0.012, dyx - 0.14 + i * 0.056, py, 0, { axis: 'x', ts: 20, rs: 5 });
  k.cyl(steel, pr, 0.05, fx - 0.04, py, 0, { axis: 'x', seg: 16 });
  k.cyl(steel, 0.015, 0.12, fx - 0.1, py, 0, { axis: 'x', seg: 8 });
  k.box(iron, 0.32, 0.26, 0.16, dyx, 0.98, 0, { r: 0.01 });
  // smokestack
  k.cyl(rust, 0.07, 0.75, -0.52, 1.25, -0.2, { seg: 16 });
  k.cyl(iron, 0.1, 0.05, -0.52, 1.63, -0.2, { seg: 16, r2: 0.08 });
  k.cyl(iron, 0.09, 0.05, -0.52, 0.89, -0.2, { seg: 16 });
  // pressure gauge on a stem (parts.needle)
  k.cyl(brass, 0.012, 0.28, 0.02, 1.02, 0.12, { seg: 8 });
  k.parts.needle = gauge(k, 0.02, 1.2, 0.16, 0.07, { label: 'PSI', max: 200, red: 0.8, value: 0.15, bezel: brass, cup: brass, name: 'needle' });
  k.box(brass, 0.04, 0.04, 0.05, 0.02, 1.2, 0.13);
  // cracked pipe section along X at the front (3 crack anchors)
  const cy = 1.04, cz = 0.24, cpr = 0.05;
  k.tube(copper, pipePath([[-0.62, dy + dr - 0.02, 0.1], [-0.62, cy, 0.1], [-0.62, cy, cz]], 0.06), cpr, { rs: 12, ts: 20 });
  k.tube(copper, pipePath([[0.12, cy, cz], [0.18, cy, cz], [0.18, cy, 0.1], [0.18, 0.95, 0.1]], 0.05), cpr, { rs: 12, ts: 20 });
  k.cyl(M('metal', { color: 0x8a5a3a, metalMap: false, metalness: 0.7 }), cpr, 0.74, -0.25, cy, cz, { axis: 'x', seg: 16 });
  for (const x of [-0.62, 0.12]) k.cyl(iron, cpr + 0.025, 0.03, x, cy, cz, { axis: 'x', seg: 16 });
  const crackArt = A.add(96, 96, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(40,20,10,0.8)'); g.addColorStop(0.5, 'rgba(90,50,20,0.5)'); g.addColorStop(1, 'rgba(90,50,20,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#0a0503'; c.lineWidth = 3; c.lineJoin = 'miter';
    c.beginPath(); c.moveTo(w * 0.1, h * 0.5); c.lineTo(w * 0.3, h * 0.42); c.lineTo(w * 0.45, h * 0.56); c.lineTo(w * 0.6, h * 0.44); c.lineTo(w * 0.75, h * 0.58); c.lineTo(w * 0.9, h * 0.5); c.stroke();
    c.lineWidth = 1.5; c.beginPath(); c.moveTo(w * 0.45, h * 0.56); c.lineTo(w * 0.5, h * 0.75); c.moveTo(w * 0.6, h * 0.44); c.lineTo(w * 0.62, h * 0.25); c.stroke();
  });
  k.anchors.cracks = [];
  [-0.48, -0.26, -0.04].forEach((x, i) => {
    k.push(x, cy, cz, [0, 0, HP]);
    k.clabel(crackArt, cpr + 0.0012, 0.08, 1.6, 0, 0, 0, { a: i * 0.25 - 0.25, seg: 8 });
    k.pop();
    const a = i * 0.25 - 0.25;
    k.anchors.cracks.push(V3(x, cy - Math.sin(a) * cpr, cz + Math.cos(a) * cpr));
  });
  // flange stub out of the drum front with a blind cover held by 4 loose bolts (axis +Z)
  const bx0 = -0.42, by0 = 0.5;
  k.cyl(copper, 0.07, 0.16, bx0, by0, dr * Math.cos(0.33) + 0.06, { axis: 'z', seg: 16 });
  k.cyl(iron, 0.12, 0.025, bx0, by0, 0.42, { axis: 'z', seg: 24 });
  k.cyl(iron, 0.12, 0.022, bx0, by0, 0.4455, { axis: 'z', seg: 24 });
  k.parts.bolts = [];
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2, x = bx0 + Math.cos(a) * 0.088, y = by0 + Math.sin(a) * 0.088;
    const b = k.grp(x, y, 0.4565, { name: 'bolt_' + i });
    b.userData.z0 = b.position.z;
    k.inside(b, () => {
      k.cyl(steel, 0.016, 0.004, 0, 0, 0.002, { axis: 'z', seg: 12 });
      k.cyl(steel, 0.014, 0.012, 0, 0, 0.01, { axis: 'z', seg: 6 });
      k.cyl(M('metal_dark', { metalMap: false, metalness: 0.8 }), 0.007, 0.07, 0, 0, -0.035, { axis: 'z', seg: 8 });
    });
    b.position.z += [0.0, 0.012, 0.004, 0.02][i];
    b.rotation.z = i * 0.4;
    k.parts.bolts.push(b);
  }
  k.anchors.boltFlange = V3(bx0, by0, 0.457);
  // hand crank on the flywheel axle end (rotates around X)
  const crank = k.grp(fx + 0.27, fy, 0, { name: 'crank' });
  k.inside(crank, () => {
    k.cyl(iron, 0.04, 0.05, 0, 0, 0, { axis: 'x', seg: 12 });
    k.box(iron, 0.03, 0.26, 0.05, 0.02, 0.12, 0, { r: 0.01 });
    k.cyl(steel, 0.012, 0.08, 0.06, 0.24, 0, { axis: 'x', seg: 8 });
    k.cyl(M('wood_dark', { color: 0x5a3a22 }), 0.022, 0.12, 0.13, 0.24, 0, { axis: 'x', seg: 12 });
  });
  // status lamp on a junction box
  k.box(iron, 0.14, 0.14, 0.1, 0.4, 0.3, 0.36, { r: 0.01 });
  k.parts.lamp = lamp(k, 0.4, 0.32, 0.41, 0.025, 'amber', { name: 'lamp', bezel: brass });
  // valve wheel + nameplate
  k.tor(M('paint', { color: 0xa8261c }), 0.07, 0.01, -0.62, cy + 0.12, 0.1, { axis: 'y', ts: 20, rs: 6 });
  for (let i = 0; i < 3; i++) k.box(M('paint', { color: 0xa8261c }), 0.14, 0.012, 0.012, -0.62, cy + 0.12, 0.1, { rot: [0, (i / 3) * PI, 0] });
  k.cyl(steel, 0.012, 0.12, -0.62, cy + 0.06, 0.1, { seg: 8 });
  sticker(k, A, 0.3, 0.07, (c, w, h) => { brassGrad(c, w, h); c.strokeStyle = 'rgba(60,40,8,0.7)'; c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8); txt(c, 'R.O.O.M. MECHANO-DYNAMO Mk.I', w / 2, h / 2 + 1, h * 0.36, { col: '#2e1e04', f: 'serif', maxW: w * 0.92 }); }, dx, dy - 0.1, dr + 0.002, { metal: 0.8, rough: 0.35 });
  k.collide(cbox(1.6, 0.12, 0.9, 0, 0.06, 0));
  k.collide(ccyl(dr + 0.02, dl + 0.2, dx, dy, 0, [0, 0, HP]));
  k.collide(ccyl(FR + 0.01, 0.1, fx, fy, 0, [0, 0, HP]));
  k.collide(cbox(0.4, 0.6, 0.3, dyx, 1.05, 0));
  k.collide(ccyl(0.08, 0.8, -0.52, 1.25, -0.2));
  k.parts.flywheel = fly;
  k.parts.crank = crank;
  return k.done({ mass: 650, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Field radio (physics prop; origin = center)
// ---------------------------------------------------------------------------
function b_radio(o) {
  const k = new Kit('radio');
  const A = k.useAtlas(512, 256);
  const W = 0.55, H = 0.42, D = 0.3, hh = 0.225;
  const olive = WORN(0x55603e, 0.25);
  const dark = WORN(0x2c2f2a, 0.4);
  const rub = M('rubber', { color: 0x151515 });
  const steel = STEEL();
  const y0 = -hh + 0.015; // case bottom (feet below)
  k.box(olive, W, H, D, 0, y0 + H / 2, 0, { r: 0.025 });
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) k.box(olive, 0.012, H - 0.08, 0.02, sx * (W / 2 + 0.004), y0 + H / 2, -0.09 + i * 0.06, { r: 0.004 });
  // corner guards + feet
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) k.box(rub, 0.06, 0.06, 0.06, sx * (W / 2 - 0.02), y0 + (sy ? H - 0.02 : 0.02), sz * (D / 2 - 0.02), { r: 0.012 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(rub, 0.02, 0.015, sx * 0.2, -hh + 0.0075, sz * 0.1, { seg: 10 });
  // front panel
  const fz = D / 2;
  k.box(dark, W - 0.08, H - 0.07, 0.012, 0, y0 + H / 2, fz + 0.002, { r: 0.006 });
  const pz = fz + 0.008;
  k.ext('plastic_black', frameShape(0.25, 0.195, 0.012, 0.205, 0.155, 0.008), 0.012, -0.1, y0 + 0.29, pz, { bev: 0.003, cs: 3 });
  k.screen('main', 0.2, 0.15, -0.1, y0 + 0.29, pz + 0.004, { style: 'amber', text: 'FR-90 LINK\nFREQ 104.7\nSIGNAL ▮▮▮▯▯\nSAMPLES 0/3', bulge: 0.006, aspect: 4 / 3 });
  const grill = A.add(160, 120, (c, w, h) => drawPerforation(c, w, h, 9, 3, '#2a2c28', '#050505'));
  k.box('plastic_black', 0.17, 0.13, 0.008, 0.15, y0 + 0.3, pz + 0.002, { r: 0.006 });
  k.label(grill, 0.16, 0.12, 0.15, y0 + 0.3, pz + 0.0065);
  k.parts.knobs = [];
  const kl = A.add(300, 28, (c, w, h) => { ['VOL', 'FREQ', 'SQL'].forEach((s, i) => txt(c, s, (i + 0.5) * (w / 3), h / 2, h * 0.6, { col: '#d8d0b8', f: 'mono' })); });
  k.label(kl, 0.3, 0.028, -0.06, y0 + 0.155, pz + 0.001);
  for (let i = 0; i < 3; i++) k.parts.knobs.push(knob(k, -0.16 + i * 0.1, y0 + 0.1, pz, 0.026, { name: 'knob_' + i, mat: M('plastic_black', { color: 0x141414 }), skirt: steel, h: 0.025 }));
  k.parts.leds = [['green', 0.13], ['amber', 0.17], ['red', 0.21]].map(([c, x]) => lamp(k, x, y0 + 0.145, pz, 0.006, c, { name: 'led_' + c, bezel: 'plastic_black' }));
  k.parts.switches = [toggle(k, 0.14, y0 + 0.08, pz, { name: 'switch_power', on: true }), toggle(k, 0.2, y0 + 0.08, pz, { name: 'switch_band' })];
  const brand = A.add(260, 40, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. FIELD COMMS FR-90', w / 2, h / 2, h * 0.5, { col: '#d8d0b8', f: 'stencil', maxW: w * 0.96 }); });
  k.label(brand, 0.18, 0.028, 0.15, y0 + 0.2, pz + 0.001);
  // top: carry handle
  for (const sx of [-1, 1]) k.box(steel, 0.03, 0.03, 0.05, sx * 0.13, y0 + H + 0.012, 0, { r: 0.006 });
  k.tube(steel, pipePath([[-0.13, y0 + H + 0.02, 0], [-0.13, y0 + H + 0.07, 0], [0.13, y0 + H + 0.07, 0], [0.13, y0 + H + 0.02, 0]], 0.03), 0.009, { rs: 8, ts: 30 });
  k.cyl(rub, 0.016, 0.16, 0, y0 + H + 0.07, 0, { axis: 'x', seg: 12 });
  // telescopic antenna (scale.y: 1 = fully extended 0.8 m, ~0.2 = collapsed)
  const ax = -W / 2 + 0.05, az = -D / 2 + 0.05;
  k.cyl(rub, 0.022, 0.03, ax, y0 + H + 0.015, az, { seg: 12 });
  const ant = k.grp(ax, y0 + H + 0.03, az, { name: 'antenna' });
  k.inside(ant, () => {
    const segs = [[0.008, 0.0, 0.22], [0.0065, 0.2, 0.22], [0.005, 0.4, 0.22], [0.0035, 0.6, 0.2]];
    for (const [r, y, l] of segs) k.cyl('chrome', r, l, 0, y + l / 2, 0, { seg: 8 });
    k.sph('chrome', 0.007, 0, 0.8, 0, { ws: 8, hs: 6 });
  });
  // sample intake hatch (top, right) + cable port (right side)
  const ix = 0.15, iz = 0.0, iy = y0 + H;
  k.cyl(steel, 0.05, 0.012, ix, iy + 0.006, iz, { seg: 20 });
  k.cyl(M('plastic_black', { color: 0x050505 }), 0.032, 0.014, ix, iy + 0.007, iz, { seg: 16 });
  const hatch = k.grp(ix, iy + 0.013, iz - 0.045, { name: 'intakeHatch' });
  k.inside(hatch, () => { k.cyl(dark, 0.045, 0.008, 0, 0.004, 0.045, { seg: 20 }); k.box(steel, 0.02, 0.008, 0.012, 0, 0.006, 0.09, { r: 0.003 }); });
  hatch.rotation.x = -1.3;
  const il = A.add(140, 30, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); txt(c, 'SAMPLE INTAKE', w / 2, h / 2, h * 0.55, { col: '#111', f: 'mono' }); });
  k.label(il, 0.11, 0.024, ix, iy + 0.0005, iz + 0.075, { rot: [-HP, 0, 0] });
  k.cyl(steel, 0.022, 0.025, W / 2 + 0.012, y0 + 0.12, 0.06, { axis: 'x', seg: 14 });
  k.cyl(M('brass', { roughness: 0.3 }), 0.012, 0.03, W / 2 + 0.02, y0 + 0.12, 0.06, { axis: 'x', seg: 10 });
  // side stencil
  const st = A.add(300, 90, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'PROPERTY OF', w / 2, h * 0.3, h * 0.24, { col: 'rgba(225,215,190,0.85)', f: 'stencil' }); txt(c, 'R.O.O.M.', w / 2, h * 0.72, h * 0.42, { col: 'rgba(225,215,190,0.85)', f: 'stencil' }); });
  k.label(st, 0.2, 0.06, -W / 2 - 0.011, y0 + 0.26, 0.02, { rot: [0, -HP, 0] });
  // handset clipped on the left side with coiled cord
  k.box(rub, 0.04, 0.16, 0.05, -W / 2 - 0.025, y0 + 0.2, -0.06, { r: 0.015 });
  const coil = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * TAU * 9; coil.push(V3(-W / 2 - 0.03 + Math.cos(a) * 0.01, y0 + 0.11 - t * 0.05 + Math.sin(a) * 0.01, -0.06 + t * 0.12)); }
  k.tube(rub, coil, 0.003, { ts: 120, rs: 4 });
  k.collide(cbox(W, H + 0.03, D, 0, 0, 0));
  k.anchors.intake = V3(ix, iy + 0.015, iz);
  k.anchors.cable = V3(W / 2 + 0.035, y0 + 0.12, 0.06);
  k.anchors.handle = V3(0, y0 + H + 0.07, 0);
  k.parts.antenna = ant;
  k.parts.intakeHatch = hatch;
  return k.done({ mass: 22, material: 'metal', halfHeight: hh });
}

// ---------------------------------------------------------------------------
// Supply crate + starter box (physics props; origin = center)
// ---------------------------------------------------------------------------
function b_supply_crate(o) {
  const k = new Kit('supply_crate');
  const A = k.useAtlas(512, 512);
  const W = 0.9, H = 0.6, D = 0.6, hh = H / 2, lidH = 0.14;
  const green = WORN(0x4b5a3c, 0.3);
  const steel = STEEL();
  const by = -hh, ty = hh - lidH; // body bottom, lid seam
  // body shell (hollow so the open crate shows its foam)
  k.box(green, W, 0.03, D, 0, by + 0.015, 0, { r: 0.01 });
  for (const sx of [-1, 1]) k.box(green, 0.025, ty - by, D, sx * (W / 2 - 0.0125), (by + ty) / 2, 0, { r: 0.006 });
  for (const sz of [-1, 1]) k.box(green, W, ty - by, 0.025, 0, (by + ty) / 2, sz * (D / 2 - 0.0125), { r: 0.006 });
  k.box(M('fabric_grey', { color: 0x262626 }), W - 0.05, 0.12, D - 0.05, 0, by + 0.09, 0);
  for (const [x, z, w, d] of [[-0.2, -0.05, 0.3, 0.35], [0.22, 0.08, 0.25, 0.18]]) k.box(M('plastic_black', { color: 0x0b0b0b }), w, 0.004, d, x, by + 0.152, z);
  // reinforcing ribs + corners
  for (const y of [by + 0.12, ty - 0.08]) {
    k.box(green, W + 0.012, 0.03, D + 0.012, 0, y, 0, { r: 0.008 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(steel, 0.05, H - 0.02, 0.05, sx * (W / 2 - 0.02), 0, sz * (D / 2 - 0.02), { r: 0.012 });
  // side handles
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.box(steel, 0.02, 0.04, 0.03, sx * (W / 2 + 0.01), ty - 0.06, sz * 0.12, { r: 0.004 });
    k.tube(steel, pipePath([[sx * (W / 2 + 0.015), ty - 0.06, -0.12], [sx * (W / 2 + 0.045), ty - 0.09, -0.1], [sx * (W / 2 + 0.045), ty - 0.09, 0.1], [sx * (W / 2 + 0.015), ty - 0.06, 0.12]], 0.02), 0.008, { rs: 6, ts: 24 });
  }
  // stencils + hazard tape
  const front = A.add(420, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    txt(c, 'R.O.O.M. SUPPLY', w / 2, h * 0.32, h * 0.3, { col: 'rgba(232,222,196,0.92)', f: 'stencil', maxW: w * 0.95 });
    txt(c, 'NSN 8465-01-ROOM-0042', w / 2, h * 0.62, h * 0.11, { col: 'rgba(232,222,196,0.85)', f: 'mono' });
    txt(c, 'QTY 1  •  DIMENSIONAL DROP  •  32 KG', w / 2, h * 0.8, h * 0.09, { col: 'rgba(232,222,196,0.85)', f: 'mono', maxW: w * 0.95 });
  });
  k.label(front, 0.62, 0.236, 0, (by + ty) / 2 + 0.02, D / 2 + 0.0005);
  k.label(front, 0.62, 0.236, 0, (by + ty) / 2 + 0.02, -D / 2 - 0.0005, { rot: [0, PI, 0] });
  const arrows = A.add(200, 120, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(232,222,196,0.9)'; for (const x of [0.3, 0.7]) { c.beginPath(); c.moveTo(w * x, h * 0.1); c.lineTo(w * (x + 0.12), h * 0.4); c.lineTo(w * (x + 0.05), h * 0.4); c.lineTo(w * (x + 0.05), h * 0.75); c.lineTo(w * (x - 0.05), h * 0.75); c.lineTo(w * (x - 0.05), h * 0.4); c.lineTo(w * (x - 0.12), h * 0.4); c.closePath(); c.fill(); } txt(c, 'THIS SIDE UP', w / 2, h * 0.9, h * 0.14, { col: 'rgba(232,222,196,0.9)', f: 'stencil' }); });
  for (const sx of [-1, 1]) k.label(arrows, 0.25, 0.15, sx * (W / 2 + 0.0005), (by + ty) / 2, 0, { rot: [0, sx * HP, 0] });
  // latches on the front (over-center clamps)
  for (const sx of [-1, 1]) {
    k.box(steel, 0.07, 0.05, 0.015, sx * 0.25, ty - 0.03, D / 2 + 0.008, { r: 0.004 });
    k.box(steel, 0.05, 0.07, 0.012, sx * 0.25, ty + 0.0, D / 2 + 0.02, { r: 0.004, rot: [0.15, 0, 0] });
  }
  // lid (pivot on the back top edge; negative rotation.x opens)
  const lid = k.grp(0, ty, -D / 2, { name: 'lid' });
  k.inside(lid, () => {
    k.box(green, W + 0.01, lidH, D + 0.01, 0, lidH / 2, D / 2, { r: 0.015 });
    k.box(hazardMat(), W + 0.014, 0.04, D + 0.014, 0, 0.05, D / 2);
    for (let i = 0; i < 3; i++) k.box(green, W - 0.1, 0.012, 0.05, 0, lidH + 0.006, 0.1 + i * 0.2, { r: 0.004 });
    const top = A.add(400, 220, (c, w, h) => { c.clearRect(0, 0, w, h); drawLogo(c, w / 2, h * 0.3, h * 0.26, 'rgba(232,222,196,0.9)', { f: 'stencil' }); txt(c, 'SUPPLY DROP', w / 2, h * 0.7, h * 0.18, { col: 'rgba(232,222,196,0.9)', f: 'stencil' }); });
    k.label(top, 0.5, 0.275, 0, lidH + 0.0125, D / 2, { rot: [-HP, 0, 0] });
    k.box(M('fabric_grey', { color: 0x262626 }), W - 0.06, 0.01, D - 0.06, 0, 0.004, D / 2);
  });
  k.collide(cbox(W, H, D, 0, 0, 0));
  k.parts.lid = lid;
  k.anchors.inside = V3(0, by + 0.17, 0);
  k.params.lidOpenSign = -1;
  return k.done({ mass: 32, material: 'metal', halfHeight: hh });
}

function b_starter_box(o) {
  const k = new Kit('starter_box');
  const A = k.useAtlas(1024, 512);
  const W = 0.6, H = 0.35, D = 0.45, hh = H / 2, t = 0.006;
  const cb = M('cardboard', { color: 0xd8c09a });
  const cbIn = M('cardboard', { color: 0xa88e68 });
  // shell (open top)
  k.box(cb, W, t, D, 0, -hh + t / 2, 0, { uv: 1.3 });
  for (const sx of [-1, 1]) k.box(cb, t, H, D, sx * (W / 2 - t / 2), 0, 0, { uv: 1.3 });
  for (const sz of [-1, 1]) k.box(cb, W, H, t, 0, 0, sz * (D / 2 - t / 2), { uv: 1.3 });
  k.box(cbIn, W - 2 * t - 0.002, 0.002, D - 2 * t - 0.002, 0, -hh + t + 0.001, 0);
  // print
  const front = A.add(600, 340, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(30,40,90,0.9)'; c.lineWidth = 5; c.strokeRect(14, 14, w - 28, h - 28);
    drawClone(c, w * 0.18, h * 0.52, h * 0.5, { wave: true, ink: '#1e285a', col: 'rgba(242,196,24,0.9)' });
    txt(c, 'EMPLOYEE', w * 0.62, h * 0.22, h * 0.13, { col: '#1e285a', maxW: w * 0.6 });
    txt(c, 'STARTER KIT', w * 0.62, h * 0.37, h * 0.13, { col: '#1e285a', maxW: w * 0.6 });
    txt(c, 'WELCOME TO YOUR', w * 0.62, h * 0.55, h * 0.075, { col: '#a0281c', maxW: w * 0.6 });
    txt(c, 'FIRST DAY!', w * 0.62, h * 0.66, h * 0.1, { col: '#a0281c', maxW: w * 0.6 });
    txt(c, 'Contents: 1x Optimism (Unverified)', w * 0.62, h * 0.8, h * 0.045, { col: '#1e285a', f: 'mono', maxW: w * 0.62 });
    drawLogo(c, w * 0.72, h * 0.9, h * 0.05, '#1e285a');
  });
  k.label(front, W - 0.04, (W - 0.04) * 340 / 600, 0, 0.0, D / 2 + 0.0005);
  k.label(front, W - 0.04, (W - 0.04) * 340 / 600, 0, 0.0, -D / 2 - 0.0005, { rot: [0, PI, 0] });
  const side = A.add(300, 230, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(30,40,90,0.9)';
    for (const x of [0.32, 0.68]) { c.beginPath(); c.moveTo(w * x, h * 0.08); c.lineTo(w * (x + 0.1), h * 0.3); c.lineTo(w * (x + 0.04), h * 0.3); c.lineTo(w * (x + 0.04), h * 0.5); c.lineTo(w * (x - 0.04), h * 0.5); c.lineTo(w * (x - 0.04), h * 0.3); c.lineTo(w * (x - 0.1), h * 0.3); c.closePath(); c.fill(); }
    txt(c, 'THIS SIDE UP', w / 2, h * 0.6, h * 0.1, { col: '#1e285a' });
    c.strokeStyle = '#a0281c'; c.lineWidth = 3; c.strokeRect(w * 0.12, h * 0.7, w * 0.76, h * 0.22);
    txt(c, 'FRAGILE: CONTAINS HOPE', w / 2, h * 0.81, h * 0.07, { col: '#a0281c', maxW: w * 0.72 });
  });
  for (const sx of [-1, 1]) k.label(side, D - 0.06, (D - 0.06) * 230 / 300, sx * (W / 2 + 0.0005), -0.01, 0, { rot: [0, sx * HP, 0] });
  const tapeTex = A.add(64, 64, (c, w, h) => { c.fillStyle = 'rgba(200,170,110,0.75)'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, h * 0.2, w, h * 0.1); });
  k.label(tapeTex, 0.06, 0.1, 0, hh - 0.05, D / 2 + 0.0008);
  k.label(tapeTex, 0.06, 0.1, 0, hh - 0.05, -D / 2 - 0.0008, { rot: [0, PI, 0] });
  // flaps: mount (static, faces outward) -> hinge (rotation.x > 0 opens, ~2.6 = fully folded down outside)
  k.parts.flaps = [];
  const flap = (name, ry, px, pz, len, wid, lift) => {
    const mount = k.grp(px, hh - t / 2 + lift, pz, { name: name + 'Mount', rot: [0, ry, 0] });
    const hinge = k.grp(0, 0, 0, { to: mount, name });
    k.inside(hinge, () => {
      k.box(cb, wid, t, len, 0, 0, -len / 2, { uv: 1.3 });
      if (name === 'flapFront' || name === 'flapBack') k.label(tapeTex, 0.06, len - 0.005, 0, t / 2 + 0.0006, -len / 2, { rot: [-HP, 0, 0] });
    });
    k.parts.flaps.push(hinge);
    return hinge;
  };
  flap('flapFront', 0, 0, D / 2 - t / 2, D / 2 - 0.004, W - 0.004, t);
  flap('flapBack', PI, 0, -D / 2 + t / 2, D / 2 - 0.004, W - 0.004, t);
  flap('flapLeft', -HP, -W / 2 + t / 2, 0, D / 2 - 0.02, D - 0.02, 0);
  flap('flapRight', HP, W / 2 - t / 2, 0, D / 2 - 0.02, D - 0.02, 0);
  k.collide(cbox(W, H, D, 0, 0, 0));
  k.anchors.inside = V3(0, -hh + 0.05, 0);
  return k.done({ mass: 3, material: 'cardboard', halfHeight: hh });
}

// ---------------------------------------------------------------------------
// Exit door + decontamination room shell
// ---------------------------------------------------------------------------
let _spillTex = null;
function spillTexture() {
  if (_spillTex) return _spillTex;
  _spillTex = labelTexture(128, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const s = c.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.15, 'rgba(0,0,0,0)'); s.addColorStop(0.85, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = s; c.fillRect(0, 0, w, h);
  });
  return _spillTex;
}
function b_exit_door(o) {
  const k = new Kit('exit_door');
  const A = k.useAtlas(512, 256);
  const OW = 0.95, OH = 2.1, fw = 0.06, z0 = -0.12, z1 = 0.04;
  const frameM = WORN(0x3f4a44, 0.5);
  const leafM = WORN(0x55665c, 0.45);
  const steel = STEEL();
  const glowCol = o.glowColor ?? 0xfff0c8;
  // frame (jambs + head), proud of the wall by 4 cm
  for (const sx of [-1, 1]) k.box(frameM, fw, OH + fw, z1 - z0, sx * (OW / 2 + fw / 2), (OH + fw) / 2, (z0 + z1) / 2, { r: 0.006 });
  k.box(frameM, OW + 2 * fw, fw, z1 - z0, 0, OH + fw / 2, (z0 + z1) / 2, { r: 0.006 });
  // door stop strips inside the frame + threshold
  for (const sx of [-1, 1]) k.box(frameM, 0.012, OH, 0.03, sx * (OW / 2 - 0.006), OH / 2, -0.065);
  k.box(frameM, OW, 0.012, 0.03, 0, OH - 0.006, -0.065);
  k.box(steel, OW + 0.1, 0.014, 0.2, 0, 0.007, -0.04);
  // light leaking through the gaps around the leaf (one mesh, own material)
  const gm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glowCol, emissiveIntensity: 2.4, roughness: 1 });
  gm.userData.unique = true; gm.userData.noShadow = true; gm.name = 'exit_glow';
  const gg = mergeGeometries([
    prepGeo(new THREE.PlaneGeometry(0.018, OH).translate(-OW / 2 + 0.009, OH / 2, -0.05)),
    prepGeo(new THREE.PlaneGeometry(0.018, OH).translate(OW / 2 - 0.009, OH / 2, -0.05)),
    prepGeo(new THREE.PlaneGeometry(OW, 0.018).translate(0, OH - 0.009, -0.05)),
    prepGeo(new THREE.PlaneGeometry(OW, 0.016).translate(0, 0.022, -0.05)),
    prepGeo(new THREE.PlaneGeometry(OW, 0.03).rotateX(-HP).translate(0, 0.0145, -0.035)),
  ]);
  const glow = k.mesh(gm, gg, 0, 0, 0, { name: 'glow', shadow: false });
  // light spill on the floor in front of the door (additive)
  const sm = new THREE.MeshBasicMaterial({ map: spillTexture(), color: glowCol, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  sm.userData.unique = true; sm.name = 'exit_spill';
  const spill = k.mesh(sm, new THREE.PlaneGeometry(OW + 0.3, 0.7).rotateX(-HP).translate(0, 0.003, 0.33), 0, 0, 0, { name: 'glowFloor', shadow: false });
  spill.renderOrder = 5;
  // door leaf (pivot on the left edge, opens inward: rotation.y > 0)
  const LW = OW - 0.024, LH = OH - 0.042, LT = 0.045;
  const door = k.grp(-OW / 2 + 0.008, 0.03, -0.025, { name: 'door' });
  let win;
  k.inside(door, () => {
    const cx = LW / 2;
    const s = rrShape(LW, LH, 0.004, cx, LH / 2);
    s.holes.push(rrHole(0.26, 0.36, 0.01, cx, 1.55));
    k.ext(leafM, s, LT, 0, 0, -LT / 2, { bev: 0.003, cs: 2 });
    // wired-glass window glowing from behind
    k.ext(steel, frameShape(0.3, 0.4, 0.012, 0.26, 0.36, 0.01), 0.012, cx, 1.55, LT / 2 - 0.002, { cs: 2 });
    const wt = A.add(130, 180, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.7);
      g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#d8c89a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(60,60,60,0.55)'; c.lineWidth = 1.5;
      for (let i = -h; i < w + h; i += 14) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); }
    });
    const wm = new THREE.MeshStandardMaterial({ map: A.tex, emissiveMap: A.tex, emissive: glowCol, emissiveIntensity: 1.6, roughness: 0.15 });
    wm.userData.unique = true; wm.userData.noShadow = true; wm.name = 'exit_window';
    win = k.mesh(wm, mapUV(new THREE.PlaneGeometry(0.26, 0.36), wt), cx, 1.55, 0, { name: 'window', shadow: false });
    // lever handle + lock, kick plate, push plate
    const hx = LW - 0.07;
    k.box(steel, 0.05, 0.16, 0.012, hx, 1.0, LT / 2 + 0.006, { r: 0.004 });
    k.cyl(steel, 0.012, 0.03, hx, 1.03, LT / 2 + 0.025, { axis: 'z', seg: 10 });
    k.box(steel, 0.13, 0.022, 0.022, hx - 0.06, 1.03, LT / 2 + 0.042, { r: 0.008 });
    k.cyl('brass', 0.011, 0.012, hx, 0.95, LT / 2 + 0.014, { axis: 'z', seg: 12 });
    k.box(steel, LW - 0.04, 0.25, 0.003, cx, 0.15, LT / 2 + 0.0015);
    k.box(steel, 0.1, 0.3, 0.003, hx, 1.25, LT / 2 + 0.0015);
    const pl = A.add(240, 100, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a1a14'; c.lineWidth = 4; c.strokeRect(5, 5, w - 10, h - 10); txt(c, 'EMPLOYEES MUST', w / 2, h * 0.3, h * 0.16, { col: '#111' }); txt(c, 'EXIT WITH ALL LIMBS', w / 2, h * 0.52, h * 0.16, { col: '#111', maxW: w * 0.9 }); txt(c, '— MANAGEMENT', w * 0.62, h * 0.76, h * 0.12, { col: '#7a1a14', f: 'mono' }); grime(c, w, h, 0.6, 31); });
    k.label(pl, 0.24, 0.1, cx, 1.2, LT / 2 + 0.003);
    // back side: push bar
    k.box(steel, LW - 0.2, 0.06, 0.05, cx, 1.0, -LT / 2 - 0.03, { r: 0.012 });
  });
  for (const y of [0.25, 1.05, 1.85]) k.cyl(steel, 0.009, 0.1, -OW / 2 + 0.008, y + 0.03, -0.025, { seg: 10 });
  // EXIT sign above (screens.sign)
  k.box(PAINT(0xc9c6bc, 0.3), 0.4, 0.18, 0.08, 0, OH + 0.3, 0.04, { r: 0.012 });
  k.screen('sign', 0.36, 0.14, 0, OH + 0.3, 0.0805, { style: 'sign', text: 'EXIT', bulge: 0, glow: 1.7 });
  k.box(steel, 0.04, 0.12, 0.04, 0, OH + 0.15, 0.02);
  // countdown display (right of the door, eye level)
  k.box(M('plastic_black', { color: 0x161616 }), 0.26, 0.13, 0.05, OW / 2 + 0.3, 1.5, 0.025, { r: 0.01 });
  k.box(steel, 0.27, 0.14, 0.01, OW / 2 + 0.3, 1.5, 0.005, { r: 0.006 });
  k.screen('countdown', 0.22, 0.088, OW / 2 + 0.3, 1.5, 0.0505, { style: 'led', text: '05:00', bulge: 0 });
  const cl = A.add(200, 30, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'EXTRACTION WINDOW', w / 2, h / 2, h * 0.55, { col: '#e8b417', f: 'mono' }); });
  k.label(cl, 0.22, 0.033, OW / 2 + 0.3, 1.6, 0.0505);
  cable(k, [[OW / 2 + 0.3, 1.43, 0.0], [OW / 2 + 0.3, 1.3, 0.008], [OW / 2 + 0.32, 0.3, 0.008], [OW / 2 + 0.34, 0.01, 0.01]], 0.006, 'rubber', { ts: 12 });
  for (const sx of [-1, 1]) k.collide(cbox(fw, OH + fw, z1 - z0, sx * (OW / 2 + fw / 2), (OH + fw) / 2, (z0 + z1) / 2));
  k.collide(cbox(OW + 2 * fw, fw, z1 - z0, 0, OH + fw / 2, (z0 + z1) / 2));
  k.parts.door = door;
  k.parts.glow = glow;
  k.parts.glowFloor = spill;
  k.parts.window = win;
  k.params.doorOpenSign = 1;
  k.params.doorCollider = cbox(LW, LH, LT, LW / 2, LH / 2, 0);
  k.params.opening = [OW, OH];
  k.anchors.threshold = V3(0, 0, 0.3);
  k.anchors.through = V3(0, 0, -0.8);
  return k.done({ mass: 2000, material: 'metal' });
}

function b_exit_room_shell(o) {
  const k = new Kit('exit_room_shell');
  const A = k.useAtlas(1024, 512);
  const W = 3, Dp = 3, H = 2.6, T = 0.1;
  const tile = M('tile');
  const floorM = M('tile', { color: 0xc8ccc8 });
  const ceil = PAINT(0xd0d0cc, 0.05);
  const steel = STEEL();
  k.box(floorM, W + 2 * T, T, Dp, 0, -T / 2 + 0.002, -Dp / 2);
  k.box(ceil, W + 2 * T, T, Dp, 0, H + T / 2, -Dp / 2);
  k.box(tile, W + 2 * T, H, T, 0, H / 2, -Dp - T / 2);
  for (const sx of [-1, 1]) k.box(tile, T, H, Dp, sx * (W / 2 + T / 2), H / 2, -Dp / 2);
  // skirting + hazard border on the floor
  for (const sx of [-1, 1]) k.box(steel, 0.01, 0.1, Dp, sx * (W / 2 - 0.005), 0.05, -Dp / 2);
  k.box(steel, W, 0.1, 0.01, 0, 0.05, -Dp + 0.005);
  const haz = hazardMat();
  for (const sx of [-1, 1]) k.box(haz, 0.1, 0.004, Dp - 0.2, sx * (W / 2 - 0.12), 0.002, -Dp / 2 - 0.1);
  k.box(haz, W - 0.14, 0.004, 0.1, 0, 0.002, -Dp + 0.12);
  // floor drain
  k.cyl(steel, 0.15, 0.006, 0, 0.003, -Dp / 2, { seg: 24 });
  for (let i = 0; i < 7; i++) k.box(M('plastic_black', { color: 0x0a0a0a }), 0.2, 0.002, 0.012, 0, 0.0065, -Dp / 2 - 0.09 + i * 0.03);
  // bench (left wall)
  const bx = -W / 2 + 0.22;
  k.box(steel, 0.4, 0.04, 1.6, bx, 0.46, -Dp / 2, { r: 0.008 });
  for (const z of [-Dp / 2 - 0.65, -Dp / 2 + 0.65]) {
    k.box(steel, 0.05, 0.44, 0.05, bx + 0.12, 0.22, z);
    k.box(steel, 0.3, 0.04, 0.05, bx, 0.06, z);
  }
  k.box(steel, 0.02, 0.4, 1.6, -W / 2 + 0.01, 0.75, -Dp / 2);
  // decon nozzles + ceiling light panel
  for (const [x, z] of [[-0.7, -0.8], [0.7, -0.8], [-0.7, -2.2], [0.7, -2.2]]) {
    k.cyl('chrome', 0.03, 0.04, x, H - 0.02, z, { seg: 12 });
    k.cyl('chrome', 0.012, 0.03, x, H - 0.055, z, { seg: 8, r2: 0.02 });
  }
  k.box(steel, 0.66, 0.03, 1.26, 0, H - 0.015, -Dp / 2, { r: 0.006 });
  const panel = k.box(own('emissive_white', { color: 0xeef4ff, emissive: 0xe8f0ff, emissiveIntensity: 1.2 }), 0.6, 0.012, 1.2, 0, H - 0.032, -Dp / 2, { sep: true, name: 'ceilingLight' });
  // red emergency lights (caged domes)
  k.parts.lights = [];
  for (const [x, z, ry] of [[-W / 2, -0.7, HP], [-W / 2, -2.3, HP], [W / 2, -0.7, -HP], [W / 2, -2.3, -HP], [0, -Dp, 0]]) {
    k.push(x, H - 0.25, z, [0, ry, 0]);
    k.box(steel, 0.14, 0.14, 0.03, 0, 0, 0.015, { r: 0.006 });
    const l = k.sph(lampMat('red', { emissiveIntensity: 2.4 }), 0.055, 0, 0, 0.03, { ws: 14, hs: 8, tl: HP, axis: 'z', sep: true, name: 'emergencyLight' });
    for (let i = 0; i < 4; i++) k.tor(steel, 0.062, 0.003, 0, 0, 0.03, { axis: 'y', arc: PI, ts: 10, rs: 3, rot: [0, 0, (i / 4) * PI] });
    k.pop();
    k.parts.lights.push(l);
  }
  // sealed hatch on the back wall (the way out)
  const hz = -Dp + 0.005;
  k.tor(steel, 0.55, 0.06, 0, 1.1, hz + 0.04, { rs: 10, ts: 40 });
  k.cyl(WORN(0x6a7076, 0.6), 0.52, 0.06, 0, 1.1, hz + 0.05, { axis: 'z', seg: 40 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; k.cyl(steel, 0.016, 0.03, Math.cos(a) * 0.55, 1.1 + Math.sin(a) * 0.55, hz + 0.1, { axis: 'z', seg: 6 }); }
  k.tor(M('paint', { color: 0xb3221a }), 0.18, 0.018, 0, 1.1, hz + 0.14, { rs: 8, ts: 24 });
  for (let i = 0; i < 3; i++) k.box(M('paint', { color: 0xb3221a }), 0.36, 0.024, 0.024, 0, 1.1, hz + 0.14, { rot: [0, 0, (i / 3) * PI] });
  k.cyl(steel, 0.04, 0.08, 0, 1.1, hz + 0.1, { axis: 'z', seg: 12 });
  // signage
  const sign = A.add(860, 150, (c, w, h) => {
    c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b3221a'; c.fillRect(0, 0, w, h * 0.3);
    txt(c, 'DECONTAMINATION', w / 2, h * 0.16, h * 0.22, { col: '#fff' });
    txt(c, 'PLEASE REMAIN CALM. SCANNING FOR DIMENSIONAL RESIDUE.', w / 2, h * 0.52, h * 0.13, { col: '#111', maxW: w * 0.94 });
    txt(c, 'Do not touch the walls. The walls are touching you back.', w / 2, h * 0.78, h * 0.1, { col: '#555', f: 'mono', maxW: w * 0.94 });
  });
  k.label(sign, 1.6, 0.279, 0, 2.05, -Dp + 0.002);
  const rules = A.add(250, 300, (c, w, h) => {
    c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, w, h);
    txt(c, 'EXTRACTION', w / 2, 26, 24, { col: '#111' });
    ['1. SIT ON BENCH', '2. CLOSE EYES', '3. DO NOT COUNT', '   THE OTHERS', '4. AWAIT HATCH', '5. FILL OUT FORM', '   EX-7B (BLUE)'].forEach((s, i) => txt(c, s, 16, 66 + i * 32, 18, { col: '#222', f: 'mono', al: 'left' }));
    grime(c, w, h, 0.5, 8);
  });
  k.label(rules, 0.4, 0.48, W / 2 - 0.002, 1.45, -1.5, { rot: [0, -HP, 0] });
  // optional inner front wall with the exit_door cutout (0.95 x 2.1 + frame)
  if (o.frontWall) {
    const ow = 1.07, oh = 2.16;
    k.box(tile, (W - ow) / 2, H, T, -(ow / 2 + (W - ow) / 4), H / 2, -0.13 - T / 2);
    k.box(tile, (W - ow) / 2, H, T, ow / 2 + (W - ow) / 4, H / 2, -0.13 - T / 2);
    k.box(tile, ow, H - oh, T, 0, oh + (H - oh) / 2, -0.13 - T / 2);
  }
  k.collide(cbox(W + 2 * T, T, Dp, 0, -T / 2, -Dp / 2));
  k.collide(cbox(W + 2 * T, T, Dp, 0, H + T / 2, -Dp / 2));
  k.collide(cbox(W + 2 * T, H, T, 0, H / 2, -Dp - T / 2));
  for (const sx of [-1, 1]) k.collide(cbox(T, H, Dp, sx * (W / 2 + T / 2), H / 2, -Dp / 2));
  k.collide(cbox(0.4, 0.48, 1.6, bx, 0.24, -Dp / 2));
  k.anchors.bench = V3(bx, 0.48, -Dp / 2);
  k.anchors.center = V3(0, 0, -Dp / 2);
  k.anchors.hatch = V3(0, 1.1, -Dp + 0.15);
  k.parts.ceilingLight = panel;
  return k.done({ mass: 10000, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Workbench
// ---------------------------------------------------------------------------
function b_workbench(o) {
  const k = new Kit('workbench');
  const A = k.useAtlas(512, 512);
  const W = 1.8, D = 0.75, TY = 0.92;
  const top = M('plank', { color: 0xd8b888 });
  const wood = M('wood', { color: 0xa87a50 });
  const steel = STEEL();
  // butcher-block top (strips) + apron
  for (let i = 0; i < 8; i++) k.box(top, W, 0.07, D / 8 - 0.002, 0, TY - 0.035, -D / 2 + (i + 0.5) * (D / 8), { uv: 0.8 });
  k.box(wood, W - 0.06, 0.1, 0.03, 0, TY - 0.12, D / 2 - 0.05);
  for (const [x, z] of [[-W / 2 + 0.07, -D / 2 + 0.07], [W / 2 - 0.07, -D / 2 + 0.07], [-W / 2 + 0.07, D / 2 - 0.07], [W / 2 - 0.07, D / 2 - 0.07]]) k.box(wood, 0.08, TY - 0.07, 0.08, x, (TY - 0.07) / 2, z);
  for (const sz of [-1, 1]) k.box(wood, W - 0.1, 0.06, 0.04, 0, 0.18, sz * (D / 2 - 0.07));
  k.box(M('plank', { color: 0xc8a878 }), W - 0.12, 0.025, D - 0.12, 0, 0.21, 0);
  // shelf clutter: toolbox + paint cans
  k.box(M('metal_red', { color: 0xa8261c, metalMap: false, metalness: 0.4 }), 0.5, 0.2, 0.22, -0.4, 0.323, 0, { r: 0.012 });
  k.cyl(steel, 0.012, 0.3, -0.4, 0.44, 0, { axis: 'x', seg: 8 });
  for (const [x, c] of [[0.3, 0x2a5fc0], [0.48, 0xd9a92a]]) { k.cyl(M('metal', { color: 0xc0c0c0, metalMap: false }), 0.085, 0.18, x, 0.313, 0.05, { seg: 18 }); k.clabel(A.solid('#' + c.toString(16).padStart(6, '0')), 0.0855, 0.1, PI * 1.4, x, 0.31, 0.05); }
  // vise (front-left corner)
  const vx = -W / 2 + 0.25, vz = D / 2 + 0.02, vy = TY;
  const vm = WORN(0x3d5a7a, 0.5);
  k.box(vm, 0.16, 0.05, 0.22, vx, vy + 0.025, vz - 0.1, { r: 0.01 });
  k.box(vm, 0.14, 0.12, 0.06, vx, vy + 0.09, vz - 0.12, { r: 0.01 });
  k.box(vm, 0.14, 0.11, 0.06, vx, vy + 0.085, vz + 0.0, { r: 0.01 });
  for (const z of [vz - 0.088, vz - 0.032]) k.box(steel, 0.14, 0.035, 0.008, vx, vy + 0.13, z);
  k.box(vm, 0.06, 0.05, 0.16, vx, vy + 0.045, vz - 0.05, { r: 0.006 });
  k.cyl(steel, 0.012, 0.2, vx, vy + 0.07, vz + 0.05, { axis: 'z', seg: 10 });
  k.cyl(steel, 0.008, 0.22, vx, vy + 0.07, vz + 0.14, { axis: 'x', seg: 8 });
  for (const sx of [-1, 1]) k.sph(steel, 0.014, vx + sx * 0.11, vy + 0.07, vz + 0.14, { ws: 8, hs: 6 });
  // pegboard with tool silhouettes
  const pegM = canvasMat('pegboard', 256, 256, (c, w, h) => {
    c.fillStyle = '#8a6a48'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2a1e12';
    const s = w / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.beginPath(); c.arc((x + 0.5) * s, (y + 0.5) * s, s * 0.14, 0, TAU); c.fill(); }
  }, { roughness: 0.9 }, 4.9);
  const PB = { y0: TY + 0.05, h: 0.95, z: -D / 2 + 0.02 };
  k.box(wood, W, PB.h + 0.04, 0.03, 0, PB.y0 + PB.h / 2, PB.z - 0.02);
  k.plane(pegM, W - 0.06, PB.h - 0.04, 0, PB.y0 + PB.h / 2, PB.z - 0.0045);
  for (const sx of [-1, 1]) k.box(wood, 0.06, PB.h + 0.04, 0.05, sx * (W / 2 - 0.03), PB.y0 + PB.h / 2, PB.z - 0.01);
  k.box(wood, W, 0.06, 0.05, 0, PB.y0 + PB.h + 0.01, PB.z - 0.01);
  const sil = A.add(512, 260, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(240,235,220,0.8)'; c.lineWidth = 4;
    c.strokeRect(20, 20, 30, 150); c.strokeRect(10, 20, 50, 30); // hammer
    for (let i = 0; i < 3; i++) c.strokeRect(90 + i * 40, 30, 16, 120 - i * 20);
    c.strokeRect(240, 20, 200, 60); c.beginPath(); c.arc(470, 200, 30, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(240,235,220,0.8)'; c.font = 'bold 18px monospace'; c.fillText('IF FOUND MISSING, SO ARE YOU', 120, 240);
  });
  k.label(sil, 1.2, 0.61, -0.2, PB.y0 + 0.48, PB.z - 0.002);
  // tools hung on the board
  const toolM = M('metal_dark', { metalMap: false, metalness: 0.7 });
  const handleR = M('plastic_red', { color: 0xb3221a });
  const tz = PB.z + 0.02;
  // hammer
  k.cyl(M('wood', { color: 0xc89a60 }), 0.014, 0.3, -0.75, PB.y0 + 0.58, tz, { seg: 8 });
  k.box(toolM, 0.12, 0.035, 0.03, -0.75, PB.y0 + 0.73, tz, { r: 0.006 });
  // screwdrivers
  for (let i = 0; i < 3; i++) {
    const x = -0.55 + i * 0.08, y = PB.y0 + 0.62 - i * 0.03;
    k.cyl([handleR, M('plastic_yellow'), M('plastic_blue')][i], 0.014, 0.1, x, y + 0.05, tz, { seg: 10 });
    k.cyl(steel, 0.004, 0.13 - i * 0.02, x, y - 0.06, tz, { seg: 6 });
  }
  // wrenches
  for (let i = 0; i < 3; i++) {
    const x = -0.15 + i * 0.13, y = PB.y0 + 0.62;
    k.box(steel, 0.022, 0.18 + i * 0.03, 0.006, x, y, tz, { r: 0.003 });
    k.tor(steel, 0.022, 0.007, x, y + 0.1 + i * 0.015, tz, { arc: PI * 1.4, ts: 12, rs: 4, rot: [0, 0, -0.5] });
  }
  // saw
  const saw = new THREE.Shape(); saw.moveTo(0, 0); saw.lineTo(0.42, 0.02); saw.lineTo(0.42, 0.1); saw.lineTo(0, 0.12); saw.closePath();
  k.ext(steel, saw, 0.002, 0.2, PB.y0 + 0.82, tz - 0.005);
  k.box(M('wood', { color: 0xa87048 }), 0.12, 0.1, 0.025, 0.16, PB.y0 + 0.88, tz, { r: 0.01 });
  // tape measure + pliers
  k.cyl(M('plastic_yellow', { color: 0xd9a92a }), 0.035, 0.03, 0.75, PB.y0 + 0.43, tz, { axis: 'z', seg: 16 });
  k.box(handleR, 0.016, 0.12, 0.012, 0.58, PB.y0 + 0.5, tz, { rot: [0, 0, 0.15], r: 0.005 });
  k.box(handleR, 0.016, 0.12, 0.012, 0.61, PB.y0 + 0.5, tz, { rot: [0, 0, -0.15], r: 0.005 });
  k.box(steel, 0.02, 0.05, 0.01, 0.595, PB.y0 + 0.58, tz);
  // small CRT (right)
  k.push(0.58, TY, -0.12, [0, -0.3, 0]);
  const mon = crtMonitor(k, 'main', { sw: 0.2, shell: M('plastic_beige', { color: 0xb3aa8a }), text: 'DIAG.EXE\n> ALL TOOLS PRESENT?\n> Y/N_', badge: 'R.O.O.M. VISION 9', cables: false });
  k.pop();
  // articulated desk lamp (back-left)
  const lx = -0.55, lz = -0.22;
  k.cyl(M('metal_dark', { metalMap: false, metalness: 0.5 }), 0.08, 0.025, lx, TY + 0.0125, lz, { seg: 18 });
  k.tube(steel, [[lx, TY + 0.02, lz], [lx + 0.02, TY + 0.2, lz + 0.05], [lx + 0.05, TY + 0.38, lz + 0.1]], 0.008, { rs: 6, ts: 12 });
  k.tube(steel, [[lx + 0.05, TY + 0.38, lz + 0.1], [lx + 0.18, TY + 0.42, lz + 0.18], [lx + 0.28, TY + 0.38, lz + 0.26]], 0.008, { rs: 6, ts: 12 });
  k.sph(steel, 0.018, lx + 0.05, TY + 0.38, lz + 0.1, { ws: 8, hs: 6 });
  k.push(lx + 0.3, TY + 0.36, lz + 0.28, [0.7, 0.2, 0]);
  k.lathe(M('metal_green', { color: 0x2f5a3a, metalMap: false, metalness: 0.4 }), [[0.075, -0.09], [0.06, -0.04], [0.035, 0.0], [0.02, 0.02], [0.0, 0.025]], 0, 0, 0, { seg: 18, rot: [PI, 0, 0] });
  const bulb = k.sph(own('emissive_white', { color: 0xfff4dc, emissive: 0xffe2a8, emissiveIntensity: 2 }), 0.03, 0, 0.045, 0, { ws: 10, hs: 8, sep: true, name: 'lamp' });
  k.pop();
  // mug + screws box
  k.cyl(M('plastic_white', { color: 0xb8b2a2 }), 0.04, 0.095, 0.15, TY + 0.0475, -0.25, { seg: 16 });
  k.cyl(M('plastic_black', { color: 0x1e1208 }), 0.036, 0.002, 0.15, TY + 0.09, -0.25, { seg: 16 });
  k.tor(M('plastic_white', { color: 0xb8b2a2 }), 0.025, 0.007, 0.195, TY + 0.05, -0.25, { ts: 10, rs: 5 });
  k.box(M('plastic_blue', { color: 0x2a4a7a }), 0.18, 0.05, 0.1, 0.25, TY + 0.025, 0.25, { r: 0.006 });
  k.collide(cbox(W, 0.07, D, 0, TY - 0.035, 0));
  k.collide(cbox(W - 0.06, TY - 0.07, D - 0.06, 0, (TY - 0.07) / 2, 0));
  k.collide(cbox(W, PB.h + 0.06, 0.06, 0, PB.y0 + PB.h / 2, PB.z - 0.02));
  k.anchors.surfaceMin = V3(-0.5, TY, -0.15);
  k.anchors.surfaceMax = V3(0.3, TY, D / 2 - 0.05);
  k.anchors.vise = V3(vx, vy + 0.13, vz - 0.06);
  k.parts.lamp = bulb;
  return k.done({ mass: 140, material: 'wood' });
}

// ---------------------------------------------------------------------------
// Coffee machine
// ---------------------------------------------------------------------------
function carafe(k, x, y, z, fill = 0.6) {
  const g = k.grp(x, y, z, { name: 'carafe' });
  k.inside(g, () => {
    const prof = [[0.0, 0.0], [0.06, 0.0], [0.075, 0.02], [0.08, 0.06], [0.075, 0.1], [0.05, 0.13], [0.045, 0.15], [0.05, 0.165]];
    k.lathe(CLEAR({ env: 1.4, rough: 0.05, tint: 0x030303 }), prof, 0, 0, 0, { seg: 22, sep: true, name: 'carafeGlass' }).renderOrder = 2;
    const fh = 0.11 * fill;
    k.lathe(M('plastic_black', { color: 0x1a0c04, roughness: 0.1 }), [[0.0, 0.004], [0.056, 0.004], [0.072, 0.022], [0.077, Math.min(0.06, fh)], [0.075, fh], [0.0, fh]].filter(([r, yy], i, a) => i === 0 || yy >= a[i - 1][1]), 0, 0, 0, { seg: 20 });
    k.cyl(M('plastic_orange', { color: 0xe8661c }), 0.052, 0.025, 0, 0.16, 0, { seg: 18 });
    k.box(M('plastic_black', { color: 0x151515 }), 0.025, 0.1, 0.02, 0.095, 0.1, 0, { r: 0.008 });
    k.box(M('plastic_black', { color: 0x151515 }), 0.04, 0.015, 0.02, 0.08, 0.15, 0, { r: 0.005 });
    k.box(M('plastic_black', { color: 0x151515 }), 0.04, 0.015, 0.02, 0.08, 0.05, 0, { r: 0.005 });
  });
  return g;
}
function b_coffee_machine(o) {
  const k = new Kit('coffee_machine');
  const A = k.useAtlas(512, 256);
  const body = M('plastic_black', { color: 0x1c1c1e, roughness: 0.4 });
  const ss = M('steel', { color: 0xa0a4a8, metalness: 0.85 });
  const W = 0.4, D = 0.42;
  k.box(body, W, 0.04, D, 0, 0.02, 0, { r: 0.01 });
  k.box(ss, 0.18, 0.012, 0.18, -0.08, 0.046, 0.06, { r: 0.004 });
  k.cyl(M('metal_dark', { metalMap: false }), 0.075, 0.006, -0.08, 0.052, 0.06, { seg: 20 });
  k.box(body, W, 0.55, 0.12, 0, 0.275 + 0.04, -D / 2 + 0.06, { r: 0.012 });
  k.box(ss, W, 0.12, D, 0, 0.53, 0, { r: 0.012 });
  k.box(body, W - 0.02, 0.02, D - 0.02, 0, 0.6, 0, { r: 0.006 });
  // top warmer
  k.cyl(M('metal_dark', { metalMap: false }), 0.075, 0.006, 0.0, 0.613, 0.05, { seg: 20 });
  // brew funnel under the head
  k.lathe(body, [[0.025, 0.0], [0.06, 0.04], [0.085, 0.07], [0.085, 0.075]], -0.08, 0.375, 0.06, { seg: 20 });
  k.box(body, 0.03, 0.02, 0.14, -0.08, 0.448, 0.17, { r: 0.006 });
  // carafes
  const c1 = carafe(k, -0.08, 0.055, 0.06, 0.6);
  carafe(k, 0.0, 0.616, 0.05, 0.3);
  // switches + lamp + labels on the right front column
  k.box(body, 0.12, 0.33, 0.04, 0.13, 0.27, D / 2 - 0.02, { r: 0.008 });
  for (let i = 0; i < 2; i++) k.box(M('plastic_black', { color: 0x333333 }), 0.03, 0.045, 0.012, 0.13, 0.3 - i * 0.07, D / 2 + 0.006, { r: 0.004, rot: [i ? 0.2 : -0.2, 0, 0] });
  k.parts.lamp = lamp(k, 0.13, 0.38, D / 2, 0.007, 'red', { name: 'lamp', bezel: 'plastic_black' });
  const lb = A.add(300, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. BREW-MASTER 3000', w / 2, h * 0.35, h * 0.28, { col: '#e8c860', maxW: w * 0.95 }); txt(c, 'FRESH POT = PRODUCTIVE CLONE', w / 2, h * 0.75, h * 0.18, { col: '#bbb', f: 'mono', maxW: w * 0.95 }); });
  k.label(lb, 0.36, 0.072, 0, 0.53, D / 2 + 0.0005);
  const sl = A.add(100, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'BREW', w / 2, h * 0.25, h * 0.22, { col: '#ddd', f: 'mono' }); txt(c, 'WARM', w / 2, h * 0.75, h * 0.22, { col: '#ddd', f: 'mono' }); });
  k.label(sl, 0.06, 0.12, 0.13, 0.17, D / 2 + 0.0005);
  // water lid on top
  k.box(body, 0.16, 0.012, 0.12, 0.0, 0.596, -0.13, { r: 0.004 });
  cable(k, [[0.1, 0.06, -D / 2], [0.12, 0.02, -D / 2 - 0.06], [0.2, 0.006, -D / 2 - 0.2]], 0.004, 'rubber');
  k.collide(cbox(W, 0.62, D, 0, 0.31, 0));
  k.anchors.spout = V3(-0.08, 0.37, 0.06);
  k.anchors.cup = V3(-0.08, 0.052, 0.06);
  k.parts.carafe = c1;
  return k.done({ mass: 9, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Fridge (doors hinge on the right edge; positive rotation.y opens)
// ---------------------------------------------------------------------------
function b_fridge(o) {
  const k = new Kit('fridge');
  const A = k.useAtlas(512, 512);
  const W = 0.65, H = 1.75, D = 0.68, t = 0.03;
  const shell = PAINT(0xbdb7a5, 0.15);
  const liner = M('plastic_white', { color: 0xb8b8b2 });
  const z0 = D / 2 - 0.05; // front of the cabinet (doors in front)
  k.box('plastic_black', W - 0.04, 0.06, D - 0.1, 0, 0.03, -0.03);
  louvers(k, 0, 0.035, z0 + 0.002, W - 0.12, 0.05, 3, { mat: M('plastic_black', { color: 0x222222 }), frame: false });
  k.box(shell, t, H - 0.06, D - 0.05, -W / 2 + t / 2, 0.06 + (H - 0.06) / 2, -0.025, { r: 0.006 });
  k.box(shell, t, H - 0.06, D - 0.05, W / 2 - t / 2, 0.06 + (H - 0.06) / 2, -0.025, { r: 0.006 });
  k.box(shell, W, t, D - 0.05, 0, H - t / 2, -0.025, { r: 0.006 });
  k.box(shell, W, t, D - 0.05, 0, 0.06 + t / 2, -0.025);
  k.box(shell, W, H - 0.06, t, 0, 0.06 + (H - 0.06) / 2, -D / 2 + t / 2);
  // liner + shelves + divider
  k.box(liner, W - 2 * t, 1.12, 0.005, 0, 0.66, -D / 2 + t + 0.003);
  k.box(shell, W - 2 * t, 0.04, D - 0.1, 0, 1.24, -0.04);
  for (const y of [0.45, 0.78, 1.02]) k.box(CLEAR({ env: 1, rough: 0.1, tint: 0x040606 }), W - 2 * t - 0.01, 0.006, D - 0.14, 0, y, -0.06);
  k.box(M('plastic_white', { color: 0xa8b0b0 }), W - 2 * t - 0.02, 0.15, D - 0.16, 0, 0.17, -0.06, { r: 0.01 });
  // contents
  k.box(M('paper', { color: 0xd8d2c4 }), 0.075, 0.2, 0.075, -0.18, 0.555, -0.12);
  k.box(M('plastic_blue', { color: 0x2a5fc0 }), 0.076, 0.04, 0.076, -0.18, 0.62, -0.12);
  k.box(M('paper', { color: 0xc8b898 }), 0.16, 0.08, 0.13, 0.08, 0.5, -0.05, { r: 0.006 });
  k.cyl(GLASS(), 0.05, 0.12, -0.05, 0.84, -0.18, { seg: 14 });
  k.cyl(lampMat('green', { emissiveIntensity: 0.7 }), 0.044, 0.08, -0.05, 0.825, -0.18, { seg: 14, sep: true, name: 'mysteryJar' });
  for (let i = 0; i < 4; i++) k.cyl(M('metal_red', { color: 0xb3221a, metalMap: false, metalness: 0.7, roughness: 0.3 }), 0.033, 0.12, 0.1 + (i % 2) * 0.07, 1.08, -0.15 + Math.floor(i / 2) * 0.08, { seg: 12 });
  k.box(M('paper', { color: 0x9a7a52 }), 0.2, 0.22, 0.12, -0.12, 1.13, -0.08, { r: 0.02 });
  const light = k.box(own('emissive_white', { emissiveIntensity: 1.0 }), 0.12, 0.012, 0.04, 0, 1.214, -0.15, { sep: true, name: 'light' });
  // doors
  const door = (name, y0, h) => {
    const g = k.grp(W / 2, 0, z0, { name });
    k.inside(g, () => {
      const cx = -W / 2;
      k.box(shell, W, h, 0.05, cx, y0 + h / 2, 0.025, { r: 0.02 });
      k.box(liner, W - 0.08, h - 0.08, 0.02, cx, y0 + h / 2, -0.01, { r: 0.01 });
      k.box('plastic_black', W - 0.02, h - 0.02, 0.006, cx, y0 + h / 2, -0.001);
      // handle on the left edge
      k.box(M('chrome', { roughness: 0.35 }), 0.025, Math.min(0.4, h * 0.6), 0.03, -W + 0.04, y0 + h / 2, 0.065, { r: 0.008 });
      for (const sy of [-1, 1]) k.box(M('chrome', { roughness: 0.35 }), 0.025, 0.025, 0.04, -W + 0.04, y0 + h / 2 + sy * Math.min(0.18, h * 0.28), 0.045, { r: 0.006 });
      if (h > 0.8) for (const y of [y0 + 0.25, y0 + 0.6, y0 + 0.9]) k.box(liner, W - 0.12, 0.06, 0.08, cx, y, -0.05);
    });
    return g;
  };
  const main = door('door', 0.08, 1.15);
  const frz = door('freezerDoor', 1.25, 0.48);
  // notes + magnets on the main door
  const notes = [
    ['WHO TOOK MY\nYOGURT??', '#f7e36a', -0.12, 0.92, -0.06],
    ['CLEAN OUT\nFRIDAY.\n-HR', '#f2a6c0', -0.38, 0.85, 0.08],
    ['LABEL YOUR\nFOOD OR IT\nBECOMES\nCOMPANY\nPROPERTY', '#e8e4d8', -0.3, 0.55, -0.04],
    ['DO NOT EAT\nTHE GREEN\nJAR', '#a8e0a0', -0.14, 0.38, 0.1],
  ];
  k.inside(main, () => {
    for (const [s, col, x, y, r] of notes) {
      const reg = A.add(120, 120, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); const L = s.split('\n'); L.forEach((l, i) => txt(c, l, w / 2, h * (0.5 + (i - (L.length - 1) / 2) * 0.17), h * 0.13, { col: '#1a1a6a', f: 'mono', maxW: w * 0.9 })); });
      k.label(reg, 0.11, 0.11, x, y, 0.0505 + Math.abs(r) * 0.001, { rot: [0, 0, r] });
      k.box([M('plastic_red'), M('plastic_blue'), M('plastic_yellow'), M('plastic_green')][Math.round(Math.abs(x * 13)) % 4], 0.025, 0.025, 0.01, x, y + 0.05, 0.056, { r: 0.004 });
    }
  });
  const brand = A.add(200, 40, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. FROST-KING', w / 2, h / 2, h * 0.55, { col: '#6a6458', f: 'serif', i: true }); });
  k.inside(frz, () => k.label(brand, 0.24, 0.048, -W / 2, 1.62, 0.0505));
  k.collide(cbox(W, H, D, 0, H / 2, 0));
  k.parts.door = main;
  k.parts.freezerDoor = frz;
  k.parts.light = light;
  k.params.doorOpenSign = 1;
  k.params.doorCollider = cbox(W, 1.15, 0.05, -W / 2, 0.08 + 0.575, 0.025);
  k.anchors.inside = V3(0, 0.5, -0.05);
  k.anchors.shelves = [0.45, 0.78, 1.02].map((y) => V3(0, y + 0.004, -0.06));
  return k.done({ mass: 75, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Server rack (LED groups in parts.leds[], each with its own material)
// ---------------------------------------------------------------------------
function b_server_rack(o) {
  const k = new Kit('server_rack');
  const A = k.useAtlas(512, 256);
  const W = 0.6, H = 2.0, D = 1.0, U = 0.0445;
  const frame = M('metal_dark', { color: 0x1a1b1d, metalMap: false, metalness: 0.6 });
  const face = M('metal_dark', { color: 0x2c2e31, metalMap: false, metalness: 0.5 });
  const face2 = M('plastic_black', { color: 0x1d1e20 });
  const perf = A.add(64, 64, (c, w, h) => drawPerforation(c, w, h, 8, 2.5, '#1d1e20', '#030303'));
  // frame + side panels + perforated back
  for (const sx of [-1, 1]) {
    k.box(frame, 0.02, H, D, sx * (W / 2 - 0.01), H / 2, 0);
    for (const sz of [-1, 1]) k.box(frame, 0.04, H, 0.03, sx * (W / 2 - 0.04), H / 2, sz * (D / 2 - 0.03));
  }
  k.box(frame, W, 0.04, D, 0, H - 0.02, 0);
  k.box(frame, W, 0.08, D, 0, 0.04, 0);
  k.box(frame, W - 0.04, H - 0.12, 0.01, 0, H / 2, -D / 2 + 0.005);
  for (let i = 0; i < 6; i++) k.label(perf, 0.12, 0.12, 0, 0.3 + i * 0.25, -D / 2 - 0.0005, { rot: [0, PI, 0] });
  // LED groups (own materials)
  const ledCols = ['green', 'green', 'green', 'green', 'amber', 'amber', 'green', 'blue', 'red', 'green'];
  const ledGeo = ledCols.map(() => []);
  let li = 0;
  const led = (x, y, z) => { ledGeo[li % ledGeo.length].push(new THREE.BoxGeometry(0.004, 0.003, 0.002).translate(x, y, z)); li++; };
  // units from the bottom
  let y = 0.08;
  const fz = D / 2 - 0.035;
  const unit = (n, kind) => {
    const h = n * U - 0.002, cy = y + n * U / 2;
    k.box(kind === 'blank' ? face2 : face, W - 0.06, h, 0.02, 0, cy, fz);
    if (kind === 'ups') {
      k.box(face2, W - 0.1, h - 0.03, 0.006, 0, cy, fz + 0.012, { r: 0.004 });
      k.screen('ups', 0.08, 0.03, 0.15, cy + 0.03, fz + 0.016, { style: 'lcd', text: 'UPS 87%', bulge: 0, aspect: 0.08 / 0.03 });
      slots(k, -0.1, cy, fz + 0.016, 0.24, h - 0.06, 8, {});
      for (let i = 0; i < 4; i++) led(0.12 + i * 0.012, cy - 0.02, fz + 0.016);
    } else if (kind === 'server') {
      for (let b = 0; b < 6; b++) {
        k.box(M('plastic_grey', { color: 0x4a4c50 }), 0.06, h - 0.01, 0.006, -0.2 + b * 0.065, cy, fz + 0.013, { r: 0.002 });
        led(-0.22 + b * 0.065, cy + h / 2 - 0.01, fz + 0.017);
      }
      k.box('chrome', 0.02, h - 0.01, 0.01, W / 2 - 0.06, cy, fz + 0.016, { r: 0.002 });
      led(W / 2 - 0.09, cy, fz + 0.012);
    } else if (kind === 'switch') {
      for (let p = 0; p < 16; p++) { k.box('plastic_black', 0.012, 0.01, 0.004, -0.2 + p * 0.016, cy, fz + 0.011); led(-0.2 + p * 0.016, cy + 0.012, fz + 0.011); }
    } else if (kind === 'tape') {
      k.box(face2, 0.3, h - 0.03, 0.006, -0.05, cy, fz + 0.012, { r: 0.004 });
      k.box('plastic_black', 0.18, 0.012, 0.006, -0.05, cy + 0.01, fz + 0.016);
      k.screen('tape', 0.07, 0.025, 0.18, cy + 0.02, fz + 0.011, { style: 'lcd', text: 'TAPE 3', bulge: 0, aspect: 0.07 / 0.025 });
      led(0.18, cy - 0.02, fz + 0.012);
    }
    y += n * U;
  };
  unit(4, 'ups'); unit(1, 'blank');
  for (let i = 0; i < 3; i++) unit(2, 'server');
  unit(3, 'tape'); unit(1, 'blank');
  for (let i = 0; i < 3; i++) unit(1, 'switch');
  unit(2, 'blank');
  for (let i = 0; i < 4; i++) unit(2, 'server');
  unit(1, 'switch'); unit(2, 'blank');
  for (let i = 0; i < 3; i++) unit(2, 'server');
  while (y < H - 0.1) unit(1, 'blank');
  // patch cables looping from switches to the side
  const cols = [0x2a5fc0, 0xd9a92a, 0xc8231b, 0x2a9a3a, 0xdddddd];
  for (let i = 0; i < 10; i++) {
    const sy = 0.08 + (4 + 1 + 6 + 3 + 1) * U + (i % 3) * U + U / 2, sx = -0.2 + (i * 3 % 16) * 0.016;
    cable(k, [[sx, sy, fz + 0.012], [sx, sy - 0.03, fz + 0.06], [W / 2 - 0.07, sy - 0.06 - i * 0.004, fz + 0.06], [W / 2 - 0.05, sy - 0.3, fz + 0.03]], 0.0025, M('rubber', { color: cols[i % cols.length], roughness: 0.5 }), { ts: 16, rs: 4 });
  }
  k.parts.leds = ledGeo.map((list, i) => {
    const m = k.mesh(lampMat(ledCols[i], { emissiveIntensity: 2.2 }), mergeGeometries(list.map(prepGeo)), 0, 0, 0, { name: 'leds_' + i, shadow: false });
    return m;
  });
  const lab = A.add(300, 40, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); txt(c, 'CLONE BACKUP ARRAY — DO NOT UNPLUG', w / 2, h / 2, h * 0.36, { col: '#a01a14', f: 'mono', maxW: w * 0.95 }); });
  k.label(lab, 0.4, 0.053, 0, H - 0.07, D / 2 - 0.001);
  k.collide(cbox(W, H, D, 0, H / 2, 0));
  return k.done({ mass: 420, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Photocopier
// ---------------------------------------------------------------------------
function b_photocopier(o) {
  const k = new Kit('photocopier');
  const A = k.useAtlas(512, 512);
  const W = 1.1, D = 0.68;
  const beige = M('plastic_beige', { color: 0xb3aa8a });
  const grey = M('plastic_grey', { color: 0x6e6c66 });
  // base cabinet + drawers
  k.box(grey, W - 0.04, 0.06, D - 0.06, 0, 0.03, 0);
  k.box(beige, W, 0.46, D, 0, 0.29, 0, { r: 0.012 });
  for (let i = 0; i < 3; i++) {
    const y = 0.15 + i * 0.13;
    k.box(beige, W - 0.06, 0.115, 0.012, 0, y, D / 2 + 0.006, { r: 0.004 });
    k.box(grey, 0.2, 0.025, 0.02, 0, y + 0.02, D / 2 + 0.016, { r: 0.008 });
    const lb = A.add(80, 30, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); txt(c, ['A3', 'A4', 'LTR'][i], w / 2, h / 2, h * 0.6, { col: '#111', f: 'mono' }); });
    k.label(lb, 0.06, 0.022, -0.35, y + 0.02, D / 2 + 0.0125);
  }
  // main body
  k.box(beige, W, 0.42, D, 0, 0.73, 0, { r: 0.015 });
  k.box(grey, W - 0.2, 0.2, 0.012, -0.05, 0.68, D / 2 + 0.002, { r: 0.006 });
  const jam = A.add(200, 120, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); txt(c, 'PAPER JAM?', w / 2, h * 0.2, h * 0.16, { col: '#a01a14' }); c.strokeStyle = '#333'; c.lineWidth = 2; c.strokeRect(30, 40, w - 60, 50); c.beginPath(); c.moveTo(50, 65); c.lineTo(w - 50, 65); c.stroke(); txt(c, 'Pull lever A. Pray.', w / 2, h * 0.88, h * 0.11, { col: '#111', f: 'mono' }); });
  k.label(jam, 0.18, 0.108, -0.3, 0.68, D / 2 + 0.009);
  // output tray (left) with paper
  k.box(grey, 0.26, 0.01, 0.36, -W / 2 - 0.12, 0.62, 0, { rot: [0, 0, 0.18] });
  k.box(M('paper', { color: 0xd8d4c8 }), 0.21, 0.02, 0.3, -W / 2 - 0.12, 0.64, 0, { rot: [0, 0, 0.18] });
  // platen glass + lid
  k.box(M('glass_tint', { color: 0x223030, opacity: 0.9, roughness: 0.08 }), 0.62, 0.004, 0.44, -0.1, 0.942, 0.02);
  const lid = k.grp(-0.1, 0.945, -D / 2 + 0.05, { name: 'lid' });
  k.inside(lid, () => {
    k.box(beige, 0.72, 0.035, 0.54, 0, 0.0175, 0.27, { r: 0.01 });
    k.box(grey, 0.1, 0.012, 0.02, 0, 0.02, 0.54, { r: 0.004 });
    k.box(M('plastic_white', { color: 0xc8c8c4 }), 0.66, 0.002, 0.48, 0, -0.001, 0.27);
  });
  // control panel (front right, sloped)
  k.push(0.38, 0.95, D / 2 - 0.12, [-0.35, 0, 0]);
  k.box(grey, 0.3, 0.025, 0.22, 0, 0, 0, { r: 0.008 });
  k.box('plastic_black', 0.15, 0.06, 0.006, -0.05, 0.015, -0.04, { rot: [-HP, 0, 0] });
  k.screen('main', 0.13, 0.045, -0.05, 0.0185, -0.04, { style: 'lcd', text: 'READY\nCOPIES: 1', bulge: 0, rot: [-HP, 0, 0], aspect: 0.13 / 0.045 });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) k.box(M('plastic_white', { color: 0xc8c4b4 }), 0.025, 0.012, 0.02, -0.1 + c * 0.032, 0.018, 0.02 + r * 0.025, { r: 0.004 });
  k.box(M('plastic_green', { color: 0x2a9a3a }), 0.07, 0.016, 0.05, 0.09, 0.02, 0.05, { r: 0.01 });
  const cl = A.add(80, 24, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'COPY', w / 2, h / 2, h * 0.7, { col: '#fff' }); });
  k.label(cl, 0.05, 0.015, 0.09, 0.0285, 0.05, { rot: [-HP, 0, 0] });
  k.push(0.09, 0.014, -0.06, [-HP, 0, 0]);
  k.parts.lamp = lamp(k, 0, 0, 0, 0.007, 'red', { name: 'jamLamp', bezel: 'plastic_black', ov: { emissiveIntensity: 0.3 } });
  k.pop();
  k.pop();
  const br = A.add(300, 50, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. XEROGRAPH 9000', w / 2, h / 2, h * 0.45, { col: '#4a4436', maxW: w * 0.95 }); });
  k.label(br, 0.36, 0.06, -0.3, 0.88, D / 2 + 0.0005);
  slots(k, W / 2 + 0.001, 0.75, 0, 0.3, 0.2, 7, { vertical: false });
  cable(k, [[0.3, 0.2, -D / 2], [0.32, 0.05, -D / 2 - 0.05], [0.4, 0.008, -D / 2 - 0.3]], 0.006, 'rubber');
  k.collide(cbox(W, 0.96, D, 0, 0.48, 0));
  k.parts.lid = lid;
  k.anchors.output = V3(-W / 2 - 0.12, 0.66, 0);
  k.anchors.platen = V3(-0.1, 0.945, 0.02);
  k.params.lidOpenSign = -1;
  return k.done({ mass: 140, material: 'plastic' });
}

// ---------------------------------------------------------------------------
// Pipe cluster (wall-mounted maintenance pipes; origin at floor on the wall plane)
// ---------------------------------------------------------------------------
function b_pipe_cluster(o) {
  const k = new Kit('pipe_cluster');
  const A = k.useAtlas(512, 256);
  const W = o.width ?? 2.0, H = o.height ?? 2.6;
  const steel = STEEL();
  const pipeA = WORN(0x5a6a5e, 0.6);
  const pipeB = WORN(0x8a3a2a, 0.5);
  const pipeC = WORN(0x9a9890, 0.7);
  const rust = M('rust');
  const clamp = (x, y, z, r, horiz) => {
    k.tor(steel, r + 0.008, 0.008, x, y, z, { arc: PI, ts: 12, rs: 4, rot: horiz ? [0, -HP, -HP] : [HP, 0, 0] });
    for (const s of [-1, 1]) k.box(steel, 0.016, 0.016, z, horiz ? x : x + s * (r + 0.008), horiz ? y + s * (r + 0.008) : y, z / 2);
    if (horiz) { k.box(steel, 0.03, r * 2 + 0.06, 0.012, x, y, 0.006); k.bolts([[x, y - r - 0.02, 0.013], [x, y + r + 0.02, 0.013]], { r: 0.006 }); }
    else { k.box(steel, r * 2 + 0.06, 0.03, 0.012, x, y, 0.006); k.bolts([[x - r - 0.02, y, 0.013], [x + r + 0.02, y, 0.013]], { r: 0.006 }); }
  };
  // vertical risers
  const risers = [[-0.75, 0.09, pipeA, 0.12], [-0.45, 0.06, pipeB, 0.1], [0.55, 0.075, pipeC, 0.11]];
  for (const [x, r, m, z] of risers) {
    k.cyl(m, r, H, x, H / 2, z, { seg: 16 });
    for (const y of [0.9, 1.8]) { k.cyl(steel, r + 0.03, 0.035, x, y, z, { seg: 16 }); const bp = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; bp.push([x + Math.cos(a) * (r + 0.018), y + 0.02, z + Math.sin(a) * (r + 0.018)]); } k.bolts(bp, { r: 0.006, axis: 'y' }); }
    for (const y of [0.5, 1.4, 2.3]) clamp(x, y, z, r);
  }
  // horizontal runs with elbows into the risers
  k.tube(pipeA, pipePath([[-0.75, 2.05, 0.12], [-0.6, 2.2, 0.12], [0.4, 2.2, 0.12], [0.55, 2.05, 0.11]], 0.12), 0.06, { rs: 14, ts: 60 });
  k.tube(pipeB, pipePath([[-0.45, 1.1, 0.1], [-0.3, 1.25, 0.1], [0.35, 1.25, 0.1], [0.55, 1.25, 0.11]], 0.1), 0.045, { rs: 12, ts: 50 });
  for (const x of [-0.2, 0.2]) clamp(x, 1.25, 0.1, 0.045, true);
  for (const x of [-0.3, 0.25]) clamp(x, 2.2, 0.12, 0.06, true);
  // gate valves with wheels (parts.valves rotate around local Z, facing +Z)
  k.parts.valves = [];
  for (const [x, y, z, r] of [[0.0, 2.2, 0.12, 0.06], [0.1, 1.25, 0.1, 0.045], [-0.75, 0.7, 0.12, 0.09]]) {
    k.box(steel, 0.12, 0.12, 0.12, x, y, z, { r: 0.015 });
    k.cyl(steel, 0.014, 0.12, x, y, z + 0.1, { axis: 'z', seg: 8 });
    const v = k.grp(x, y, z + 0.17, { name: 'valve' });
    k.inside(v, () => {
      k.tor(M('paint', { color: 0xb3221a }), 0.08, 0.011, 0, 0, 0, { ts: 20, rs: 6 });
      for (let i = 0; i < 3; i++) k.box(M('paint', { color: 0xb3221a }), 0.16, 0.014, 0.012, 0, 0, 0, { rot: [0, 0, (i / 3) * PI] });
      k.cyl(steel, 0.02, 0.03, 0, 0, 0, { axis: 'z', seg: 10 });
    });
    k.parts.valves.push(v);
  }
  // pressure gauge on a tee
  k.cyl(steel, 0.012, 0.12, 0.3, 2.31, 0.12, { seg: 8 });
  k.parts.needle = gauge(k, 0.3, 2.42, 0.13, 0.06, { label: 'BAR', max: 16, red: 0.8, value: 0.7, name: 'needle' });
  // pipe markers
  const marker = (txtS, col, x, y, z, r) => {
    const reg = A.add(200, 40, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); txt(c, txtS + '  ➜', w / 2, h / 2, h * 0.55, { col: '#111', maxW: w * 0.92 }); });
    k.push(x, y, z, [0, 0, HP]);
    k.clabel(reg, r + 0.002, 0.05, 2.2, 0, 0, 0, { a: 0 });
    k.pop();
  };
  marker('STEAM', '#e8b417', -0.1, 2.2, 0.12, 0.06);
  marker('COOLANT', '#3a9a5a', -0.05, 1.25, 0.1, 0.045);
  const vm = A.add(160, 40, (c, w, h) => { c.fillStyle = '#c8c4b4'; c.fillRect(0, 0, w, h); txt(c, '??? ⬆', w / 2, h / 2, h * 0.6, { col: '#111' }); });
  k.clabel(vm, 0.077, 0.05, 2.0, 0.55, 1.6, 0.11, { a: 0 });
  // junction box
  k.box(WORN(0x7b8086, 0.4), 0.22, 0.3, 0.12, 0.15, 0.65, 0.06, { r: 0.01 });
  k.cyl(steel, 0.015, 0.4, 0.15, 0.95, 0.06, { seg: 8 });
  const jb = A.add(120, 60, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); hazardTri(c, w * 0.22, h * 0.5, h * 0.7, 'bolt'); txt(c, '480V', w * 0.65, h / 2, h * 0.4, { col: '#111' }); });
  k.label(jb, 0.12, 0.06, 0.15, 0.7, 0.1205);
  // big open duct near the floor (critter exit): elbow out of the wall, mouth facing +Z
  const dR = 0.17, dy = 0.24, dx = -0.1;
  k.cyl(rust, dR, 0.14, dx, dy, 0.07, { axis: 'z', seg: 20, open: true });
  k.cyl(steel, dR + 0.03, 0.03, dx, dy, 0.02, { axis: 'z', seg: 20 });
  k.tor(steel, dR + 0.01, 0.02, dx, dy, 0.14, { rs: 6, ts: 24 });
  k.cyl(M('plastic_black', { color: 0x020202, side: THREE.BackSide }), dR - 0.005, 0.14, dx, dy, 0.07, { axis: 'z', seg: 18, open: true });
  k.disc(M('plastic_black', { color: 0x000000 }), dR, dx, dy, 0.004, { seg: 18 });
  // bent grate hanging off the mouth
  k.push(dx + 0.05, dy - dR, 0.16, [0.9, 0.3, 0.2]);
  k.tor(rust, dR - 0.01, 0.006, 0, dR, 0, { rs: 4, ts: 20 });
  for (let i = -3; i <= 3; i++) k.box(rust, 0.006, Math.sqrt(Math.max(0, (dR - 0.01) ** 2 - (i * 0.04) ** 2)) * 2, 0.006, i * 0.04, dR, 0);
  k.pop();
  k.bolts([[dx - dR - 0.015, dy, 0.036], [dx + dR + 0.015, dy, 0.036], [dx, dy + dR + 0.015, 0.036]], { r: 0.008, mat: rust });
  // drip stains on the wall-side bracket plate
  k.box(WORN(0x4a4e52, 0.6), W, 0.08, 0.02, 0, 0.04, 0.01);
  k.collide(cbox(1.6, H, 0.26, -0.1, H / 2, 0.13));
  k.anchors.mouth = V3(dx, dy, 0.3);
  k.anchors.inside = V3(dx, dy, 0.02);
  return k.done({ mass: 800, material: 'metal' });
}


// ===========================================================================
// Registry, template cache & cloning
// ===========================================================================
const BUILDERS = {
  vending_snack: b_vending_snack,
  vending_drink: b_vending_drink,
  water_cooler: b_water_cooler,
  aquarium: b_aquarium,
  service_bell: b_service_bell,
  crt_terminal: b_crt_terminal,
  dart_board: b_dart_board,
  locker: b_locker,
  locker_bank: b_locker_bank,
  employee_of_month: b_employee_of_month,
  wall_clock: b_wall_clock,
  poster: b_poster,
  mirror: b_mirror,
  ceiling_vent: b_ceiling_vent,
  wall_vent: b_wall_vent,
  fuse_box: b_fuse_box,
  fire_alarm: b_fire_alarm,
  exit_sign: b_exit_sign,
  hazard_sign: b_hazard_sign,
  reception_desk: b_reception_desk,
  clone_tube: b_clone_tube,
  clone_console: b_clone_console,
  clone_pad: b_clone_pad,
  dispatch_door: b_dispatch_door,
  dispatch_lever: b_dispatch_lever,
  generator_diesel: b_generator_diesel,
  generator_electric: b_generator_electric,
  generator_mech: b_generator_mech,
  radio: b_radio,
  supply_crate: b_supply_crate,
  starter_box: b_starter_box,
  exit_door: b_exit_door,
  exit_room_shell: b_exit_room_shell,
  workbench: b_workbench,
  coffee_machine: b_coffee_machine,
  fridge: b_fridge,
  server_rack: b_server_rack,
  photocopier: b_photocopier,
  pipe_cluster: b_pipe_cluster,
};

function stable(o) {
  if (o === undefined || o === null) return '';
  if (typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => k + ':' + stable(o[k])).join(',') + '}';
}
function computeBounds(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true);
  return { min: b.min.toArray(), max: b.max.toArray() };
}
function remapper(map) {
  const f = (v) => {
    if (v === null || v === undefined) return v;
    if (v.isObject3D) return map.get(v) || v;
    if (v.isVector3) return v.clone();
    if (Array.isArray(v)) return v.map(f);
    if (typeof v === 'object' && (v.constructor === Object || v.constructor === undefined)) {
      const o = {};
      for (const k in v) o[k] = f(v[k]);
      return o;
    }
    return v;
  };
  return f;
}
function instantiate(tpl) {
  const obj = tpl.object.clone(true);
  const a = [], b = [];
  tpl.object.traverse((o) => a.push(o));
  obj.traverse((o) => b.push(o));
  const map = new Map();
  a.forEach((o, i) => map.set(o, b[i]));
  const mats = new Map();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.userData.unique) {
      if (!mats.has(m)) mats.set(m, m.clone());
      o.material = mats.get(m);
    }
  });
  const f = remapper(map);
  const out = {};
  for (const k in tpl) out[k] = k === 'object' ? obj : k === 'colliders' ? JSON.parse(JSON.stringify(tpl.colliders)) : f(tpl[k]);
  return out;
}

const TEMPLATES = new Map();
export function buildDevice(name, opts = {}) {
  const b = BUILDERS[name];
  if (!b) throw new Error(`[models_devices] unknown device '${name}'`);
  const key = name + '|' + stable(opts || {});
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    tpl = b(opts || {});
    tpl.object.name = name;
    tpl.object.userData.device = name;
    if (!tpl.bounds) tpl.bounds = computeBounds(tpl.object);
    TEMPLATES.set(key, tpl);
  }
  return instantiate(tpl);
}
export const DEVICES = Object.fromEntries(Object.keys(BUILDERS).map((n) => [n, (opts) => buildDevice(n, opts)]));
export const DEVICE_NAMES = Object.keys(BUILDERS);
export function clearDeviceCache() { TEMPLATES.clear(); }

// ---------------------------------------------------------------------------
// Dart scoring (board-local meters, board center = origin, +Y = up / the "20")
// ---------------------------------------------------------------------------
export const DART_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const DART_RADII = { bull: 0.00635, outerBull: 0.0159, tripleIn: 0.099, tripleOut: 0.107, doubleIn: 0.162, doubleOut: 0.17, board: 0.225 };
export function scoreDart(localX, localY) {
  const r = Math.hypot(localX, localY);
  if (r <= DART_RADII.bull) return { score: 50, label: 'BULL', ring: 'bull', number: 50, mult: 1 };
  if (r <= DART_RADII.outerBull) return { score: 25, label: '25', ring: 'outerBull', number: 25, mult: 1 };
  if (r > DART_RADII.doubleOut) return { score: 0, label: 'MISS', ring: r <= DART_RADII.board ? 'outer' : 'off', number: 0, mult: 0 };
  const ang = Math.atan2(localY, localX) * 180 / Math.PI; // CCW from +X
  const idx = (((Math.round((90 - ang) / 18) % 20) + 20) % 20);
  const n = DART_ORDER[idx];
  if (r >= DART_RADII.tripleIn && r <= DART_RADII.tripleOut) return { score: n * 3, label: 'T' + n, ring: 'triple', number: n, mult: 3 };
  if (r >= DART_RADII.doubleIn) return { score: n * 2, label: 'D' + n, ring: 'double', number: n, mult: 2 };
  return { score: n, label: String(n), ring: 'single', number: n, mult: 1 };
}
