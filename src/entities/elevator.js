// R.O.O.M. DIMENSIONAL LIFT: the elevator car used at HQ (Sublevel B4), during the ride between dimensions
// and as the arrival car standing in Level 0. Also the landing doors, the brass lazy-tong scissor gate and
// the floor-indicator dial.
//
// Car space: origin at the centre of the car floor, the gate (front) faces +Z, y up. Interior 2.4 x 2.2 m,
// 2.45 m high. Geometry is merged per material (walnut veneer, brushed steel, brass, rubber floor, labels,
// glow) and the gate is two InstancedMeshes, so a car costs ~10 draw calls. Every car has its own light rig
// (vlights.js): its ceiling panel lights the interior without adding a real THREE light to the scene.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as Mat from '../gfx/materials.js';
import { VLRig, vlPatch } from './vlights.js';
import { font } from '../ui/fonts.js';

export const CAR = { W: 2.4, D: 2.2, H: 2.45, GW: 2.1, GH: 2.2, GATE_Z: 1.13, FRONT: 1.16 };
const HW = CAR.W / 2, HD = CAR.D / 2;
const PI = Math.PI;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

// ------------------------------------------------------------------------------------------ geometry bin
// Collects primitives (position/normal/uv/colour), optional metric UVs (box projection, metres * k) and a
// baked AO function, then merges them into one mesh.
export class GBin {
  constructor(opts = {}) { this.geos = []; this.ao = opts.ao || null; this.uvk = opts.uvk ?? 1; this.metricAll = opts.metricAll || 0; }
  add(geo, color = 0xffffff, m = null, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose?.();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (m) g.applyMatrix4(m);
    if (o.metric || this.metricAll) metricUV(g, o.metric === true ? this.uvk : (o.metric || this.metricAll), o.uvOff);
    const n = g.attributes.position.count, pos = g.attributes.position.array, col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      let k = o.shade ? o.shade(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : 1;
      if (this.ao && !o.noAO) k *= this.ao(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return g;
  }
  box(w, h, d, color, m, o = {}) {
    const g = o.r ? new RoundedBoxGeometry(w, h, d, o.seg ?? 2, o.r) : new THREE.BoxGeometry(w, h, d);
    return this.add(g, color, m, o);
  }
  // axis-aligned box from min/max corners (car space)
  span(x0, y0, z0, x1, y1, z1, color, o = {}) {
    return this.box(x1 - x0, y1 - y0, z1 - z0, color, T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), o);
  }
  cyl(r0, r1, h, color, m, o = {}) { return this.add(new THREE.CylinderGeometry(r0, r1, h, o.seg ?? 16, 1, !!o.open), color, m, o); }
  sphere(r, color, m, o = {}) { return this.add(new THREE.SphereGeometry(r, o.seg ?? 16, o.rings ?? 10, 0, PI * 2, 0, o.theta ?? PI), color, m, o); }
  tube(points, r, color, o = {}) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
    return this.add(new THREE.TubeGeometry(curve, o.seg ?? Math.max(8, points.length * 8), r, o.radial ?? 10, false), color, null, o);
  }
  plane(w, h, color, m, o = {}) { return this.add(new THREE.PlaneGeometry(w, h), color, m, o); }
  mesh(mat, parent, o = {}) {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    this.geos = [];
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = o.shadow ?? false;
    mesh.receiveShadow = o.receive ?? true;
    if (o.name) mesh.name = o.name;
    parent?.add(mesh);
    return mesh;
  }
}

// box-projected UVs in metres (k = texture repeats per metre); uvOff shifts them
export function metricUV(g, k = 1, off = null) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
  for (let i = 0; i < p.length / 3; i++) {
    const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]), az = Math.abs(n[i * 3 + 2]);
    let u, v;
    if (ay >= ax && ay >= az) { u = p[i * 3]; v = p[i * 3 + 2]; } else if (ax >= az) { u = p[i * 3 + 2]; v = p[i * 3 + 1]; } else { u = p[i * 3]; v = p[i * 3 + 1]; }
    uv[i * 2] = u * k + (off ? off[0] : 0);
    uv[i * 2 + 1] = v * k + (off ? off[1] : 0);
  }
  g.attributes.uv.needsUpdate = true;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// interior AO: darker into the floor / ceiling joints and the vertical corners
function carAO(x, y, z) {
  const fl = 0.62 + 0.38 * sstep(0, 0.42, y);
  const ce = 0.7 + 0.3 * sstep(CAR.H, CAR.H - 0.35, y);
  const cx = HW - Math.abs(x), cz = HD - Math.abs(z);
  const corner = 0.72 + 0.28 * sstep(0, 0.35, Math.min(cx + 0.02, 0.6) + Math.min(cz + 0.02, 0.6) - 0.02);
  return fl * ce * corner;
}

// ------------------------------------------------------------------------------------------ textures
let TEX = null;
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, srgb = true, rep = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
// tangent-space normal map from a greyscale height canvas
function normalFrom(hc, strength = 2) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), oc = out.getContext('2d'), img = oc.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  oc.putImageData(img, 0, 0);
  return out;
}

function textures() {
  if (TEX) return TEX;
  const r = rng(90210);
  // --- walnut veneer (book-matched flitches, 1 tile = 1 m)
  const V = canvas(512, 512), v = V.getContext('2d');
  v.fillStyle = '#4a2c1a'; v.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, w = 1 + r() * 5, a = 0.05 + r() * 0.16;
    v.strokeStyle = r() < 0.5 ? `rgba(28,14,6,${a})` : `rgba(122,78,44,${a})`;
    v.lineWidth = w;
    v.beginPath();
    for (let y = -10; y <= 522; y += 16) { const xx = x + Math.sin(y * 0.012 + i) * 6 + Math.sin(y * 0.05 + i * 3) * 1.5; if (y < 0) v.moveTo(xx, y); else v.lineTo(xx, y); }
    v.stroke();
  }
  for (let i = 0; i < 9; i++) { // cathedral figure
    const cx = r() * 512, cy = r() * 512;
    v.strokeStyle = 'rgba(30,15,6,0.18)'; v.lineWidth = 2;
    for (let k = 0; k < 6; k++) { v.beginPath(); v.ellipse(cx, cy, 6 + k * 7, 40 + k * 26, 0, 0, PI * 2); v.stroke(); }
  }
  for (let i = 0; i < 4000; i++) { v.fillStyle = `rgba(20,10,4,${0.1 + r() * 0.2})`; v.fillRect(r() * 512, r() * 512, 1, 2 + r() * 3); }
  const veneer = ctex(V, true, true);
  // --- rubber coin floor + front hazard strip (whole floor = one image, u: x, v: z)
  const F = canvas(512, 512), f = F.getContext('2d'), FH = canvas(512, 512), fh = FH.getContext('2d');
  f.fillStyle = '#2a2a2b'; f.fillRect(0, 0, 512, 512);
  fh.fillStyle = '#404040'; fh.fillRect(0, 0, 512, 512);
  const strip = 512 * 0.13; // front edge (v -> 1 at the gate)
  for (let y = 14; y < 512 - strip; y += 26) for (let x = 14; x < 512; x += 26) {
    const g = fh.createRadialGradient(x, y, 1, x, y, 8); g.addColorStop(0, '#b0b0b0'); g.addColorStop(0.75, '#909090'); g.addColorStop(1, '#404040');
    fh.fillStyle = g; fh.beginPath(); fh.arc(x, y, 8, 0, PI * 2); fh.fill();
    f.fillStyle = '#323233'; f.beginPath(); f.arc(x, y, 8, 0, PI * 2); f.fill();
    f.fillStyle = 'rgba(255,255,255,0.05)'; f.beginPath(); f.arc(x - 2, y - 2, 4, 0, PI * 2); f.fill();
  }
  // scuffs and a worn traffic path towards the gate
  for (let i = 0; i < 160; i++) { f.strokeStyle = `rgba(${r() < 0.5 ? '15,15,15' : '70,68,64'},${0.05 + r() * 0.1})`; f.lineWidth = 1 + r() * 4; const x = r() * 512, y = r() * 512; f.beginPath(); f.moveTo(x, y); f.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 30); f.stroke(); }
  const wear = f.createLinearGradient(140, 0, 372, 0); wear.addColorStop(0, 'rgba(90,88,84,0)'); wear.addColorStop(0.5, 'rgba(90,88,84,0.12)'); wear.addColorStop(1, 'rgba(90,88,84,0)');
  f.fillStyle = wear; f.fillRect(0, 0, 512, 512 - strip);
  // hazard chevrons at the front (canvas y grows to the gate: v = 1 - y/512 ... flipY keeps canvas top = v 1)
  f.save(); f.beginPath(); f.rect(0, 0, 512, strip); f.clip();
  f.fillStyle = '#141414'; f.fillRect(0, 0, 512, strip);
  for (let i = -80; i < 600; i += 44) { f.fillStyle = '#d6a31c'; f.beginPath(); f.moveTo(i, 0); f.lineTo(i + 22, 0); f.lineTo(i + 22 - strip, strip); f.lineTo(i - strip, strip); f.fill(); }
  for (let i = 0; i < 900; i++) { f.fillStyle = `rgba(20,20,20,${0.4 + r() * 0.6})`; f.fillRect(r() * 512, r() * strip, 1 + r() * 3, 1 + r() * 2); }
  f.restore();
  f.fillStyle = '#d6a31c'; f.font = font('sign', 15); f.textAlign = 'center';
  f.fillText('ANYTHING IN THIS CAR TRAVELS WITH YOU', 256, strip + 22);
  fh.fillStyle = '#404040'; fh.fillRect(0, 0, 512, strip + 4);
  const floor = ctex(F), floorN = ctex(normalFrom(FH, 3), false);
  // --- label atlas: button panel face, plaques, certificate (1024 x 512)
  const A = canvas(1024, 512), a = A.getContext('2d');
  // button panel face 0..256 x 0..512 (brushed steel with engraved labels)
  const bg = a.createLinearGradient(0, 0, 256, 0); bg.addColorStop(0, '#9a9da0'); bg.addColorStop(0.5, '#c4c7ca'); bg.addColorStop(1, '#8e9194');
  a.fillStyle = bg; a.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 700; i++) { a.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,40,40'},${0.04 + r() * 0.06})`; a.fillRect(r() * 256, r() * 512, 1, 6 + r() * 30); }
  a.fillStyle = '#1a1a1a'; a.font = font('receipt', 22); a.textAlign = 'center';
  a.fillText('R.O.O.M.', 128, 34);
  a.font = font('receipt', 11); a.fillText('DIMENSIONAL LIFT CO.', 128, 50);
  const LBL = [['B4', 'B5'], ['B6', 'B7'], ['B9', 'B13'], ['0', '37'], ['1.1', '5'], ['∞', '?'], ['—', 'HQ']];
  a.font = font('receipt', 17);
  LBL.forEach((row, i) => row.forEach((s, j) => { a.textAlign = j ? 'left' : 'right'; a.fillText(s, j ? 190 : 66, 98 + i * 50); }));
  a.font = font('receipt', 12); a.textAlign = 'center';
  a.fillText('ALARM', 76, 462); a.fillText('STOP', 180, 462);
  a.strokeStyle = 'rgba(20,20,20,0.6)'; a.lineWidth = 2; a.strokeRect(8, 8, 240, 496);
  // capacity plaque 256..640 x 0..120
  a.fillStyle = '#2b2416'; a.fillRect(256, 0, 384, 120);
  const pg = a.createLinearGradient(256, 0, 256, 120); pg.addColorStop(0, '#e9cf86'); pg.addColorStop(1, '#a8833a');
  a.fillStyle = pg; a.fillRect(262, 6, 372, 108);
  a.fillStyle = '#2b2416'; a.font = font('poster', 30); a.textAlign = 'center'; a.fillText('R.O.O.M. LIFT No. 4', 448, 44);
  a.font = font('receipt', 17); a.fillText('CAPACITY: 4 CLONES / 2000 KG', 448, 74);
  a.font = font('receipt', 13); a.fillText('DO NOT HOLD THE GATE  ·  DO NOT FEED THE GATE', 448, 100);
  // inspection certificate 640..1024 x 0..300
  a.fillStyle = '#3a3226'; a.fillRect(640, 0, 384, 300);
  a.fillStyle = '#efe8d4'; a.fillRect(652, 12, 360, 276);
  a.fillStyle = '#2a2620'; a.font = font('poster', 22); a.fillText('CERTIFICATE OF OPERATION', 832, 52);
  a.font = font('receipt', 14);
  ['LIFT No. 4  ·  SUBLEVEL B4', 'TRAVEL: B4 → ∞', 'LAST INSPECTED: 03/07/1996', 'INSPECTOR: ________', 'STATUS: OPERATIONAL (MOSTLY)'].forEach((s, i) => a.fillText(s, 832, 92 + i * 30));
  a.save(); a.translate(930, 245); a.rotate(-0.2); a.strokeStyle = 'rgba(160,30,24,0.8)'; a.lineWidth = 3; a.strokeRect(-70, -18, 140, 36); a.fillStyle = 'rgba(160,30,24,0.8)'; a.font = font('sign', 20); a.fillText('APPROVED', 0, 8); a.restore();
  // "STAND CLEAR" sticker 256..640 x 120..200 and a CCTV warning 256..640 x 200..280
  a.fillStyle = '#d6a31c'; a.fillRect(256, 124, 384, 72); a.fillStyle = '#141414'; a.font = font('sign', 26); a.fillText('MIND THE GATE', 448, 170);
  a.fillStyle = '#e4e0d6'; a.fillRect(256, 204, 384, 72); a.fillStyle = '#9a1c18'; a.font = font('sign', 18); a.fillText('THIS CAR IS MONITORED', 448, 234); a.fillStyle = '#222'; a.font = '14px Arial'; a.fillText('FOR YOUR SAFETY AND OURS', 448, 258);
  const atlas = ctex(A);
  TEX = { veneer, floor, floorN, atlas };
  return TEX;
}
// atlas region (px) -> uv rect for PlaneGeometry
function atlasPlane(w, h, x0, y0, x1, y1) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / 1024, 1 - (y1 - uv.getY(i) * (y1 - y0)) / 512);
  return g;
}

// ------------------------------------------------------------------------------------------ materials
// One set per car (each car has its own light rig).
export function carMaterials(rig) {
  const tx = textures();
  const wood = new THREE.MeshStandardMaterial({ map: tx.veneer, color: 0xffffff, roughness: 0.38, metalness: 0, vertexColors: true, envMapIntensity: 0.9 });
  const steel = Mat.make('stainless');
  steel.vertexColors = true; steel.roughness = 0.42; steel.envMapIntensity = 1.2;
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8954f, roughness: 0.36, metalness: 1, vertexColors: true, envMapIntensity: 1.1 });
  const floor = new THREE.MeshStandardMaterial({ map: tx.floor, normalMap: tx.floorN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.72, vertexColors: true });
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, vertexColors: true });
  const label = new THREE.MeshStandardMaterial({ map: tx.atlas, roughness: 0.45, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  glow.color.setScalar(1);
  const m = { wood, steel, brass, floor, paint, label, glow };
  for (const k of ['wood', 'steel', 'brass', 'floor', 'paint', 'label']) { vlPatch(m[k], rig); m[k].name = 'lift_' + k; }
  glow.name = 'lift_glow';
  return m;
}

// ------------------------------------------------------------------------------------------ dial
// Brass floor-indicator dial: cream enamel face with floor numerals on an arc, a needle and a small amber
// LED window below the hub (countdowns, floor names).
const DIAL_FLOORS = ['B9', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'L'];
export function dialAngle(i) { return PI * 0.85 - (i / (DIAL_FLOORS.length - 1)) * PI * 0.7; } // radians from +x
export class Dial {
  constructor(r, mats, opts = {}) {
    this.r = r;
    this.group = new THREE.Group();
    const c = canvas(256, 160); this.c = c; this.ctx = c.getContext('2d');
    this.tex = ctex(c);
    this.led = ''; this.ledCol = '#ffae3a';
    this._drawFace();
    const face = new THREE.Mesh(this._faceGeo(r), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: opts.glow ?? 0.18 }));
    if (mats.rig) vlPatch(face.material, mats.rig);
    face.position.z = 0.004;
    this.group.add(face);
    this.faceMesh = face;
    const b = new GBin();
    // bezel: half ring + base bar + a little crown ornament
    b.add(new THREE.TorusGeometry(r * 1.02, r * 0.07, 8, 36, PI), 0xffffff, T(0, 0, 0.01));
    b.box(r * 2.24, r * 0.14, 0.03, 0xffffff, T(0, -r * 0.38, 0.006));
    for (const s of [-1, 1]) b.box(r * 0.14, r * 0.38, 0.03, 0xffffff, T(s * r * 1.02, -r * 0.19, 0.008));
    b.add(new THREE.ConeGeometry(r * 0.09, r * 0.22, 4), 0xffffff, T(0, r * 1.16, 0.012));
    b.cyl(r * 0.07, r * 0.07, 0.02, 0x666666, T(0, 0, 0.018, PI / 2, 0, 0));
    this.bezel = b.mesh(mats.brass, this.group);
    const n = new GBin();
    n.box(r * 0.84, r * 0.035, 0.004, 0x151515, T(r * 0.42 - r * 0.08, 0, 0));
    n.add(new THREE.ConeGeometry(r * 0.045, r * 0.12, 3), 0x151515, T(r * 0.82, 0, 0, 0, 0, -PI / 2, 1, 1, 0.2));
    this.needle = new THREE.Group();
    this.needle.position.set(0, 0, 0.012);
    n.mesh(mats.paint, this.needle);
    this.group.add(this.needle);
    this.angle = dialAngle(5);
    this.target = this.angle;
    this.setNeedle(this.angle, true);
  }
  _faceGeo(r) {
    // "D": half disc over a strip below the hub (LED window); uv onto the 256x160 canvas, hub at (128, 100), 100 px = r
    const s = new THREE.Shape();
    s.moveTo(-r, -0.36 * r); s.lineTo(-r, 0); s.absarc(0, 0, r, PI, 0, true); s.lineTo(r, -0.36 * r); s.closePath();
    const g = new THREE.ShapeGeometry(s, 24), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + (p.getX(i) / r) * (100 / 256), 0.375 + (p.getY(i) / r) * (100 / 160));
    return g;
  }
  _drawFace() {
    const x = this.ctx, w = 256, h = 160, cx = 128, cy = 100;
    const g = x.createRadialGradient(cx, cy, 10, cx, cy, 130); g.addColorStop(0, '#f6eed8'); g.addColorStop(1, '#c9bb96');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#3a2e1c'; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, 90, PI * 1.12, PI * 1.88); x.stroke();
    x.fillStyle = '#2a2014'; x.font = font('sign', 14); x.textAlign = 'center'; x.textBaseline = 'middle';
    DIAL_FLOORS.forEach((s, i) => {
      const a = dialAngle(i);
      x.fillText(s, cx + Math.cos(a) * 72, cy - Math.sin(a) * 72);
      x.beginPath(); x.moveTo(cx + Math.cos(a) * 85, cy - Math.sin(a) * 85); x.lineTo(cx + Math.cos(a) * 95, cy - Math.sin(a) * 95); x.stroke();
    });
    x.fillStyle = '#3a2e1c'; x.font = font('receipt', 9); x.fillText('R.O.O.M. LIFT CO.', cx, cy - 34);
    // LED window under the hub
    x.fillStyle = '#100604'; x.fillRect(cx - 34, cy + 9, 68, 26);
    x.strokeStyle = '#5a4a30'; x.lineWidth = 2; x.strokeRect(cx - 34, cy + 9, 68, 26);
    if (this.led) {
      x.fillStyle = this.ledCol; x.shadowColor = this.ledCol; x.shadowBlur = 8;
      x.font = font('terminal', 26); x.fillText(this.led, cx, cy + 23);
      x.shadowBlur = 0;
    }
    this.tex.needsUpdate = true;
  }
  setLed(text, col = '#ffae3a') {
    if (text === this.led && col === this.ledCol) return;
    this.led = text; this.ledCol = col;
    this._drawFace();
  }
  setFloor(i) { this.target = dialAngle(i); }
  setNeedle(a, snap = false) { this.target = a; if (snap) { this.angle = a; this.needle.rotation.z = a; } }
  update(dt, speed = 3) {
    const d = this.target - this.angle;
    this.angle += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    this.needle.rotation.z = this.angle;
  }
  dispose() { this.tex.dispose(); this.faceMesh.material.dispose(); }
}

// ------------------------------------------------------------------------------------------ split-flap board
// Mechanical split-flap display (the HQ floor indicator / shift-code board, the keypad readout). Each cell
// is a static top half, a static bottom half and a flap hinged on the split: set(text) makes every cell
// rattle through the glyph drum to its character (the old flap falls over and shows the next bottom half).
// Glyphs live in one shared atlas, also used for key caps (glyphUV).
// drum order: digits descend (a countdown flips one step per second), '-' sits just before the letters
export const FLAP_GLYPHS = ' 9876543210-ABCDEFGHIJKLMNOPQRSTUVWXYZ?!/:.+#>';
let FLAP = null;
export function flapAtlas() {
  if (FLAP) return FLAP;
  const cols = 8, rows = Math.ceil(FLAP_GLYPHS.length / cols), cw = 64, ch = 96;
  const c = canvas(cols * cw, rows * ch), x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < FLAP_GLYPHS.length; i++) {
    const gx = (i % cols) * cw, gy = Math.floor(i / cols) * ch;
    const g = x.createLinearGradient(0, gy, 0, gy + ch);
    g.addColorStop(0, '#24221f'); g.addColorStop(0.48, '#141312'); g.addColorStop(0.52, '#0c0c0b'); g.addColorStop(1, '#1e1c1a');
    x.fillStyle = g; x.fillRect(gx + 2, gy + 2, cw - 4, ch - 4);
    x.font = font('sign', 76);
    const k = Math.min(1, (cw - 12) / Math.max(1, x.measureText(FLAP_GLYPHS[i]).width));
    x.save(); x.translate(gx + cw / 2, gy + ch / 2 + 4); x.scale(k, 1);
    x.fillStyle = '#efe4c8'; x.fillText(FLAP_GLYPHS[i], 0, 0);
    x.restore();
  }
  const tex = ctex(c);
  tex.anisotropy = 4;
  FLAP = { tex, cols, rows, cw, ch, W: cols * cw, H: rows * ch };
  return FLAP;
}
export function glyphIndex(ch) { const i = FLAP_GLYPHS.indexOf(String(ch || ' ').toUpperCase()); return i < 0 ? 0 : i; }
// uv rect of glyph i on a PlaneGeometry; half: 0 full, 1 top, 2 bottom
export function glyphUV(geo, i, half = 0) {
  const A = flapAtlas();
  const gx = (i % A.cols) * A.cw, gy = Math.floor(i / A.cols) * A.ch;
  const y0 = gy + (half === 2 ? A.ch / 2 : 0), y1 = gy + (half === 1 ? A.ch / 2 : A.ch);
  const u0 = gx / A.W, u1 = (gx + A.cw) / A.W, vt = 1 - y0 / A.H, vb = 1 - y1 / A.H;
  const uv = geo.attributes.uv;
  uv.setXY(0, u0, vt); uv.setXY(1, u1, vt); uv.setXY(2, u0, vb); uv.setXY(3, u1, vb);
  uv.needsUpdate = true;
}
export class FlipBoard {
  // n cells of w x h (m); opts: { gap, glow, rig, flip (s per flap), onFlip(count) }
  constructor(n, w, h, opts = {}) {
    this.n = n; this.w = w; this.h = h;
    this.flipDur = opts.flip ?? 0.055;
    this.onFlip = opts.onFlip || null;
    this.group = new THREE.Group();
    const A = flapAtlas();
    this.mat = new THREE.MeshStandardMaterial({ map: A.tex, emissive: 0xffffff, emissiveMap: A.tex, emissiveIntensity: opts.glow ?? 0.3, roughness: 0.5, metalness: 0.1 });
    if (opts.rig) vlPatch(this.mat, opts.rig);
    const gap = opts.gap ?? w * 0.1, half = h / 2, sp = 0.0012;
    const plane = (y, z, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, half - sp), this.mat); m.position.set(0, y, z); m.rotation.x = rx; return m; };
    this.cells = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.position.x = (i - (n - 1) / 2) * (w + gap);
      const top = plane(half / 2 + sp / 2, 0), bot = plane(-half / 2 - sp / 2, 0);
      const pivot = new THREE.Group();
      pivot.position.z = 0.0015;
      const front = plane(half / 2 + sp / 2, 0.0004), back = plane(half / 2 + sp / 2, -0.0004, PI);
      pivot.add(front, back);
      g.add(top, bot, pivot);
      this.group.add(g);
      const c = { g, top, bot, pivot, front, back, cur: 0, target: 0, t: -1, delay: 0 };
      this._show(c, 0);
      this.cells.push(c);
    }
    this.settled = true;
  }
  _show(c, i) {
    glyphUV(c.top.geometry, i, 1); glyphUV(c.bot.geometry, i, 2); glyphUV(c.front.geometry, i, 1);
    c.pivot.rotation.x = 0; c.back.visible = false;
  }
  // text is centred (or left-aligned with opts.left); stagger makes the cells start one after another
  set(text, opts = {}) {
    let s = String(text ?? '').toUpperCase().slice(0, this.n);
    if (opts.left) s = s.padEnd(this.n, ' ');
    else { const p = Math.floor((this.n - s.length) / 2); s = (' '.repeat(p) + s).padEnd(this.n, ' '); }
    if (s === this.text) return;
    this.text = s;
    this.cells.forEach((c, i) => {
      const tg = glyphIndex(s[i]);
      if (tg === c.target) return;
      c.target = tg;
      if (c.t < 0) c.delay = (opts.stagger ?? 0.035) * i;
    });
    this.settled = false;
  }
  update(dt) {
    if (this.settled) return;
    let busy = false, flips = 0;
    const N = FLAP_GLYPHS.length;
    for (const c of this.cells) {
      if (c.cur === c.target && c.t < 0) continue;
      busy = true;
      if (c.delay > 0) { c.delay -= dt; continue; }
      if (c.t < 0) {
        // start one flap: cur -> next
        const nx = (c.cur + 1) % N;
        c.next = nx;
        glyphUV(c.top.geometry, nx, 1);
        glyphUV(c.front.geometry, c.cur, 1);
        glyphUV(c.back.geometry, nx, 2);
        c.back.visible = true;
        c.t = 0;
      }
      c.t += dt;
      // a long way round the drum rattles faster
      const dist = (c.target - c.cur + N) % N;
      const k = Math.min(1, c.t / (this.flipDur * (dist > 8 ? 0.4 : 1)));
      c.pivot.rotation.x = k * k * PI; // gravity: the flap accelerates over
      if (k >= 1) {
        c.cur = c.next;
        c.t = -1;
        this._show(c, c.cur);
        flips++;
      }
    }
    if (flips && this.onFlip) this.onFlip(flips);
    if (!busy) this.settled = true;
  }
  dispose() { for (const c of this.cells) c.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------ scissor gate
// Brass lazy-tong gate across the car front: 9 channel posts and crossed links in 3 tiers, collapsing to
// the left jamb. Two InstancedMeshes (bars, rivets).
const GATE_POSTS = 9, GATE_TIERS = 4;
export class ScissorGate {
  constructor(mats, w = CAR.GW, h = CAR.GH - 0.06) {
    this.w = w; this.h = h;
    this.group = new THREE.Group();
    const nb = GATE_POSTS + (GATE_POSTS - 1) * GATE_TIERS * 2 + 2;
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.brass, nb);
    const nr = (GATE_POSTS - 1) * GATE_TIERS + GATE_POSTS * (GATE_TIERS + 1);
    const rg = new THREE.CylinderGeometry(1, 1, 1, 10); rg.rotateX(PI / 2);
    const rivets = new THREE.InstancedMesh(rg, mats.steel, nr);
    for (const m of [bars, rivets]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; this.group.add(m); }
    // vertexColors materials need a colour attribute: give the instanced geometries white ones
    for (const m of [bars, rivets]) {
      const n = m.geometry.attributes.position.count;
      m.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    this.bars = bars; this.rivets = rivets;
    this.open = -1;
    this.set(0);
  }
  // f: 0 closed .. 1 open
  set(f) {
    f = Math.min(1, Math.max(0, f));
    if (Math.abs(f - this.open) < 1e-4) return;
    this.open = f;
    const w = this.w, h = this.h, x0 = -w / 2, y0 = 0.03;
    const sp = (w / (GATE_POSTS - 1)) * (1 - f) + 0.032 * f;
    let bi = 0, ri = 0;
    const M = new THREE.Matrix4();
    const put = (mesh, idx, x, y, z, rz, sx, sy, sz) => { M.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, 0, rz)), _s.set(sx, sy, sz)); mesh.setMatrixAt(idx, M); };
    const tierH = h / GATE_TIERS;
    for (let i = 0; i < GATE_POSTS; i++) {
      const x = x0 + i * sp;
      put(this.bars, bi++, x, y0 + h / 2, 0, 0, i === GATE_POSTS - 1 ? 0.03 : 0.016, h, 0.02);
      for (let k = 0; k <= GATE_TIERS; k++) put(this.rivets, ri++, x, y0 + k * tierH, 0.014, 0, 0.008, 0.008, 0.01);
    }
    const len = Math.hypot(sp, tierH), ang = Math.atan2(tierH, sp);
    for (let i = 0; i < GATE_POSTS - 1; i++) {
      const cx = x0 + (i + 0.5) * sp;
      for (let k = 0; k < GATE_TIERS; k++) {
        const cy = y0 + (k + 0.5) * tierH;
        put(this.bars, bi++, cx, cy, 0.01, ang, len, 0.012, 0.004);
        put(this.bars, bi++, cx, cy, -0.01, -ang, len, 0.012, 0.004);
        put(this.rivets, ri++, cx, cy, 0, 0, 0.007, 0.007, 0.03);
      }
    }
    // handle on the leading post + a top rail stub that rides in the track
    const xl = x0 + (GATE_POSTS - 1) * sp;
    put(this.bars, bi++, xl + 0.035, y0 + h * 0.48, 0.04, 0, 0.022, 0.16, 0.022);
    put(this.bars, bi++, x0 + ((GATE_POSTS - 1) * sp) / 2, y0 + h + 0.012, 0, 0, (GATE_POSTS - 1) * sp + 0.04, 0.02, 0.03);
    this.bars.count = bi; this.rivets.count = ri;
    this.bars.instanceMatrix.needsUpdate = true;
    this.rivets.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.bars.geometry.dispose(); this.rivets.geometry.dispose(); this.bars.dispose(); this.rivets.dispose(); }
}

// ------------------------------------------------------------------------------------------ landing doors
// Two centre-opening brushed-steel leaves (+ optional frame) in a landing's front plane. Local +Z is the
// landing (room) side, -Z the shaft side; leaves slide into the wall pockets.
export class LandingDoors {
  constructor(mats, opts = {}) {
    this.group = new THREE.Group();
    const w = opts.w ?? CAR.GW, h = opts.h ?? CAR.GH;
    this.w = w; this.h = h;
    const leaf = (sx) => {
      const b = new GBin();
      const x0 = sx < 0 ? -w / 2 : 0.004, x1 = sx < 0 ? -0.004 : w / 2;
      b.span(x0, 0.01, -0.02, x1, h, 0.02, 0xffffff, { metric: 1 });
      // landing side: kick plate + vertical brushed reveal; shaft side: stiffener ribs + hanger rollers
      b.span(x0 + 0.03, 0.02, 0.02, x1 - 0.03, 0.26, 0.026, 0xd0d0d0, { metric: 1 });
      b.span(sx < 0 ? x1 - 0.06 : x0 + 0.05, 0.3, 0.02, sx < 0 ? x1 - 0.05 : x0 + 0.06, h - 0.05, 0.024, 0x8a8a8a);
      for (const y of [0.55, 1.15, 1.75]) b.span(x0 + 0.04, y, -0.035, x1 - 0.04, y + 0.06, -0.02, 0x9a9a9a, { metric: 1 });
      for (const xx of [x0 + 0.15, x1 - 0.15]) {
        b.cyl(0.045, 0.045, 0.03, 0x555555, T(xx, h + 0.06, -0.04, PI / 2, 0, 0), { seg: 14 });
        b.span(xx - 0.03, h - 0.01, -0.05, xx + 0.03, h + 0.07, -0.03, 0x777777);
      }
      const mesh = b.mesh(mats.steel, this.group);
      mesh.userData.x0 = 0;
      return mesh;
    };
    this.leafL = leaf(-1); this.leafR = leaf(1);
    if (opts.track !== false) {
      const t = new GBin();
      t.span(-w - 0.1, h + 0.1, -0.08, w + 0.1, h + 0.16, -0.02, 0x3a3a3a);
      t.span(-w / 2 - 0.1, -0.02, -0.06, w / 2 + 0.1, 0.008, 0.06, 0x888888, { metric: 2 });
      t.mesh(mats.steel, this.group);
    }
    this.open = 0;
    this.set(0);
  }
  set(f) {
    f = Math.min(1, Math.max(0, f));
    this.open = f;
    const e = f * f * (3 - 2 * f);
    this.leafL.position.x = -e * (this.w / 2 - 0.05);
    this.leafR.position.x = e * (this.w / 2 - 0.05);
  }
}

// ------------------------------------------------------------------------------------------ car
export class ElevatorCar {
  // opts: { exterior: bool (steel shell outside, for a car standing in a level), indicator: bool }
  constructor(opts = {}) {
    this.rig = new VLRig();
    this.mats = carMaterials(this.rig);
    this.root = new THREE.Group();
    this.root.name = 'ElevatorCar';
    this.lightK = 1;
    this.lightCol = new THREE.Color(0xfff0d6);
    this._buildShell(opts);
    this.gate = new ScissorGate(this.mats);
    this.gate.group.position.set(0, 0, CAR.GATE_Z);
    this.root.add(this.gate.group);
    this.dial = new Dial(0.15, { brass: this.mats.brass, paint: this.mats.paint, rig: this.rig });
    this.dial.group.position.set(0, 2.235, HD - 0.005);
    this.dial.group.rotation.y = PI;
    this.root.add(this.dial.group);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.probeOK) o.userData.noProbe = true; });
    this.setLight(1);
  }

  _buildShell(opts) {
    const M = this.mats;
    const H = CAR.H, gw = CAR.GW / 2, gh = CAR.GH;
    const wood = new GBin({ ao: carAO, uvk: 1 }), steel = new GBin({ ao: carAO, uvk: 1 }), brass = new GBin({ ao: carAO });
    const floor = new GBin({ ao: carAO }), paint = new GBin({ ao: carAO }), glow = new GBin(), label = new GBin();
    // ---- floor slab (one image across the floor: u = x, v = z) + gate sill
    {
      const g = floor.box(CAR.W, 0.06, CAR.D, 0xffffff, T(0, -0.03, 0));
      const p = g.attributes.position.array, uv = g.attributes.uv.array;
      for (let i = 0; i < p.length / 3; i++) { uv[i * 2] = (p[i * 3] + HW) / CAR.W; uv[i * 2 + 1] = (p[i * 3 + 2] + HD) / CAR.D; }
      steel.span(-gw - 0.05, 0, HD - 0.04, gw + 0.05, 0.008, CAR.FRONT + 0.02, 0xc8c8c8, { metric: 3 });
      for (let i = 0; i < 4; i++) steel.span(-gw - 0.04, 0.008, HD + 0.005 + i * 0.03, gw + 0.04, 0.011, HD + 0.012 + i * 0.03, 0x707070);
    }
    // ---- walls: back + sides (inner faces at |x| = HW, z = -HD), front returns + transom
    const wallT = 0.06;
    steel.span(-HW - wallT, 0, -HD - wallT, HW + wallT, H, -HD, 0x6a6a6a);
    steel.span(-HW - wallT, 0, -HD, -HW, H, HD + 0.06, 0x6a6a6a);
    steel.span(HW, 0, -HD, HW + wallT, H, HD + 0.06, 0x6a6a6a);
    steel.span(-HW, 0, HD, -gw, H, CAR.FRONT, 0xb8b8b8, { metric: 1 });
    steel.span(gw, 0, HD, HW, H, CAR.FRONT, 0xb8b8b8, { metric: 1 });
    steel.span(-gw, gh, HD, gw, H, CAR.FRONT, 0xb8b8b8, { metric: 1 });
    // gate track under the transom
    steel.span(-gw - 0.02, gh - 0.03, CAR.GATE_Z - 0.035, gw + 0.02, gh + 0.005, CAR.GATE_Z + 0.035, 0x505050);
    // jamb returns (the opening's side faces), brushed
    for (const s of [-1, 1]) steel.span(s * gw - (s > 0 ? 0 : 0.012), 0, HD - 0.01, s * gw + (s > 0 ? 0.012 : 0), gh, CAR.FRONT, 0x9a9a9a, { metric: 2 });
    // ---- interior panelling on back + side walls: steel kick plate, walnut panels with steel reveals, crown
    const wallRuns = [
      { axis: 'x', fixed: -HD, a: -HW, b: HW, n: 1 },      // back wall, normal +z
      { axis: 'z', fixed: -HW, a: -HD, b: HD, n: 1 },      // left wall (x -), normal +x
      { axis: 'z', fixed: HW, a: -HD, b: HD, n: -1 },      // right wall (x +), normal -x
    ];
    const put = (bin, run, a, b, y0, y1, d0, d1, col, o) => {
      if (run.axis === 'x') bin.span(a, y0, run.fixed + d0 * run.n, b, y1, run.fixed + d1 * run.n, col, o);
      else { const x0 = run.fixed + d0 * run.n, x1 = run.fixed + d1 * run.n; bin.span(Math.min(x0, x1), y0, a, Math.max(x0, x1), y1, b, col, o); }
    };
    for (const run of wallRuns) {
      const { a, b } = run;
      put(steel, run, a, b, 0, 0.95, 0, 0.012, 0xe8e8e8, { metric: 1.5 });              // kick plate
      put(steel, run, a, b, 0.95, 0.975, 0, 0.022, 0xa8a8a8, { metric: 2 });            // chair rail reveal
      const panels = run.axis === 'x' ? 3 : 3;
      const L = b - a, pw = L / panels;
      for (let i = 0; i < panels; i++) {
        const p0 = a + i * pw + 0.012, p1 = a + (i + 1) * pw - 0.012;
        put(wood, run, p0, p1, 0.985, 2.3, 0.004, 0.02, 0xffffff, { metric: 1, uvOff: [i * 0.37, 0] });
        // raised field with a thin inlay line
        put(wood, run, p0 + 0.06, p1 - 0.06, 1.06, 2.22, 0.02, 0.026, 0xe6dccd, { metric: 1, uvOff: [i * 0.37 + 0.2, 0.1] });
        put(brass, run, p0 + 0.045, p1 - 0.045, 1.045, 1.052, 0.02, 0.028, 0xffffff);
        put(brass, run, p0 + 0.045, p1 - 0.045, 2.228, 2.235, 0.02, 0.028, 0xffffff);
        if (i > 0) put(steel, run, a + i * pw - 0.012, a + i * pw + 0.012, 0.975, 2.3, 0, 0.012, 0x777777);
      }
      put(steel, run, a, b, 2.3, H, 0, 0.03, 0xbdbdbd, { metric: 1.5 });                 // crown
      put(steel, run, a, b, 0, 0.1, 0.012, 0.018, 0x555555);                             // toe kick
    }
    // ---- handrails (brass tube on brackets) on the back and both side walls
    const yR = 0.93, off = 0.055;
    brass.tube([new THREE.Vector3(-HW + off, yR, HD - 0.42), new THREE.Vector3(-HW + off, yR, -HD + off + 0.12), new THREE.Vector3(-HW + off + 0.04, yR, -HD + off + 0.03), new THREE.Vector3(-HW + off + 0.12, yR, -HD + off),
      new THREE.Vector3(HW - off - 0.12, yR, -HD + off), new THREE.Vector3(HW - off - 0.04, yR, -HD + off + 0.03), new THREE.Vector3(HW - off, yR, -HD + off + 0.12), new THREE.Vector3(HW - off, yR, HD - 0.42)], 0.019, 0xffffff, { seg: 120, radial: 12 });
    for (const s of [-1, 1]) brass.sphere(0.026, 0xffffff, T(s * (HW - off), yR, HD - 0.42));
    for (const z of [0.5, -0.5]) for (const sx of [-1, 1]) brass.cyl(0.009, 0.009, off, 0xffffff, T(sx * (HW - off / 2), yR, z, 0, 0, PI / 2), { seg: 8 });
    for (const x of [-0.6, 0.6]) brass.cyl(0.009, 0.009, off, 0xffffff, T(x, yR, -HD + off / 2, PI / 2, 0, 0), { seg: 8 });
    // ---- ceiling: steel coffer, glowing diffuser, vent grille, CCTV dome
    steel.span(-HW - wallT, H, -HD - wallT, HW + wallT, H + 0.05, CAR.FRONT, 0x8c8c8c);
    steel.span(-HW, H - 0.08, -HD, -0.75, H, HD, 0xbdbdbd, { metric: 1 });
    steel.span(0.75, H - 0.08, -HD, HW, H, HD, 0xbdbdbd, { metric: 1 });
    steel.span(-0.75, H - 0.08, -HD, 0.75, H, -0.55, 0xbdbdbd, { metric: 1 });
    steel.span(-0.75, H - 0.08, 0.55, 0.75, H, HD, 0xbdbdbd, { metric: 1 });
    steel.span(-0.75, H - 0.1, -0.55, 0.75, H - 0.075, -0.52, 0x777777);
    steel.span(-0.75, H - 0.1, 0.52, 0.75, H - 0.075, 0.55, 0x777777);
    steel.span(-0.75, H - 0.1, -0.55, -0.72, H - 0.075, 0.55, 0x777777);
    steel.span(0.72, H - 0.1, -0.55, 0.75, H - 0.075, 0.55, 0x777777);
    this.diffuser = glow.span(-0.72, H - 0.05, -0.52, 0.72, H - 0.045, 0.52, 0xffffff);
    // prism lines across the diffuser (dark grid)
    for (let i = 1; i < 6; i++) paint.span(-0.72 + i * 0.24 - 0.004, H - 0.055, -0.52, -0.72 + i * 0.24 + 0.004, H - 0.05, 0.52, 0x8a8478);
    for (let i = 1; i < 4; i++) paint.span(-0.72, H - 0.055, -0.52 + i * 0.26 - 0.004, 0.72, H - 0.05, -0.52 + i * 0.26 + 0.004, 0x8a8478);
    for (let i = 0; i < 9; i++) paint.span(0.88 + (i % 3) * 0.08, H - 0.085, -0.85 + Math.floor(i / 3) * 0.08, 0.92 + (i % 3) * 0.08, H - 0.08, -0.81 + Math.floor(i / 3) * 0.08, 0x151515);
    paint.add(new THREE.SphereGeometry(0.07, 18, 8, 0, PI * 2, PI / 2, PI / 2), 0x101012, T(-HW + 0.16, H - 0.08, -HD + 0.16));
    paint.cyl(0.085, 0.085, 0.02, 0xd8d4c8, T(-HW + 0.16, H - 0.07, -HD + 0.16));
    glow.sphere(0.008, 0xff2010, T(-HW + 0.16, H - 0.155, -HD + 0.16));
    // ---- button panel on the right wall (looking out: x -), plate + buttons + stop knob + key + speaker
    const bpX = -HW + 0.012, bpZ = 0.62;
    steel.span(bpX, 0.98, bpZ - 0.16, bpX + 0.018, 1.7, bpZ + 0.16, 0xffffff, { metric: 3 });
    {
      const lp = atlasPlane(0.3, 0.68, 4, 4, 252, 508);
      label.add(lp, 0xffffff, T(bpX + 0.0195, 1.34, bpZ, 0, PI / 2, 0));
    }
    this.buttons = [];
    const btnLocal = (i, j) => [1.34 + 0.34 - (98 + i * 50) / 512 * 0.68 + 0.006, bpZ + (j ? 0.035 : -0.035)];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) {
      const [y, z] = btnLocal(i, j);
      brass.cyl(0.019, 0.021, 0.012, 0xffffff, T(bpX + 0.024, y, z, 0, 0, PI / 2), { seg: 18 });
      glow.cyl(0.013, 0.013, 0.004, 0x6a4a20, T(bpX + 0.031, y, z, 0, 0, PI / 2), { seg: 16 });
    }
    // alarm (yellow) + stop (red mushroom)
    paint.cyl(0.02, 0.02, 0.02, 0xd8b020, T(bpX + 0.028, 1.12, bpZ - 0.052, 0, 0, PI / 2));
    paint.cyl(0.03, 0.022, 0.035, 0xb81c16, T(bpX + 0.036, 1.12, bpZ + 0.052, 0, 0, PI / 2), { seg: 20 });
    paint.sphere(0.03, 0xb81c16, T(bpX + 0.052, 1.12, bpZ + 0.052, 0, 0, -PI / 2, 1, 0.45, 1), { theta: PI / 2 });
    // key switch + speaker grille
    brass.cyl(0.016, 0.016, 0.01, 0xffffff, T(bpX + 0.023, 1.04, bpZ, 0, 0, PI / 2));
    paint.span(bpX + 0.026, 1.035, bpZ - 0.002, bpX + 0.034, 1.045, bpZ + 0.002, 0x1a1a1a);
    for (let i = 0; i < 5; i++) paint.span(bpX + 0.018, 1.64 + i * 0.009 - 0.02, bpZ - 0.05, bpX + 0.021, 1.644 + i * 0.009 - 0.02, bpZ + 0.05, 0x1a1a1a);
    // plaques: capacity (back wall), certificate (left wall), sticker on the right jamb, CCTV notice
    label.add(atlasPlane(0.42, 0.13, 256, 0, 640, 120), 0xffffff, T(0, 2.05, -HD + 0.028));
    label.add(atlasPlane(0.3, 0.234, 640, 0, 1024, 300), 0xffffff, T(HW - 0.029, 1.55, -0.45, 0, -PI / 2, 0));
    label.add(atlasPlane(0.2, 0.038, 256, 204, 640, 276), 0xffffff, T(-HW + 0.029, 2.05, -0.62, 0, PI / 2, 0));
    // ---- optional exterior shell (car standing in a level): steel box, crosshead, hoist ropes
    if (opts.exterior) {
      const ex = new GBin();
      const o = 0.08;
      ex.span(-HW - o, -0.02, -HD - o, HW + o, H + 0.1, -HD - wallT + 0.001, 0x9a9a9a, { metric: 1 });
      ex.span(-HW - o, -0.02, -HD - o, -HW - wallT + 0.001, H + 0.1, CAR.FRONT + 0.02, 0x9a9a9a, { metric: 1 });
      ex.span(HW + wallT - 0.001, -0.02, -HD - o, HW + o, H + 0.1, CAR.FRONT + 0.02, 0x9a9a9a, { metric: 1 });
      ex.span(-HW - o, H + 0.05, -HD - o, HW + o, H + 0.12, CAR.FRONT + 0.02, 0x7a7a7a, { metric: 1 });
      // front face outside the returns + header
      ex.span(-HW - o, -0.02, CAR.FRONT, -gw, H + 0.12, CAR.FRONT + 0.02, 0xaaaaaa, { metric: 1 });
      ex.span(gw, -0.02, CAR.FRONT, HW + o, H + 0.12, CAR.FRONT + 0.02, 0xaaaaaa, { metric: 1 });
      ex.span(-gw, gh, CAR.FRONT, gw, H + 0.12, CAR.FRONT + 0.02, 0xaaaaaa, { metric: 1 });
      // vertical stiles + rivet strips
      for (const s of [-1, 1]) for (const z of [-HD - o - 0.01, CAR.FRONT + 0.03]) ex.span(s * (HW + o) - 0.05, -0.02, z - 0.012, s * (HW + o) + 0.05, H + 0.12, z + 0.012, 0x6a6a6a);
      for (const s of [-1, 1]) ex.span(s * (HW + o) - 0.012, -0.02, -HD - o - 0.03, s * (HW + o) + 0.012, H + 0.12, CAR.FRONT + 0.04, 0x6a6a6a);
      // crosshead beam + sheave + ropes up into the ceiling
      ex.span(-HW - 0.05, H + 0.12, -0.12, HW + 0.05, H + 0.3, 0.12, 0x3a3f44);
      ex.cyl(0.16, 0.16, 0.08, 0x2c2c2c, T(0, H + 0.36, 0, PI / 2, 0, 0), { seg: 24 });
      for (const x of [-0.05, 0, 0.05]) ex.cyl(0.008, 0.008, 3.0, 0x4a4a46, T(x, H + 1.8, 0.0), { seg: 6 });
      // plinth / buffer frame at the floor
      ex.span(-HW - o - 0.03, -0.02, -HD - o - 0.03, HW + o + 0.03, 0.06, CAR.FRONT + 0.05, 0x2a2a2a);
      const mat = Mat.make('stainless');
      mat.vertexColors = true; mat.roughness = 0.5;
      this.exterior = ex.mesh(mat, this.root, { shadow: true });
      this.exterior.userData.probeOK = true;
    }
    this.meshes = {
      wood: wood.mesh(M.wood, this.root), steel: steel.mesh(M.steel, this.root), brass: brass.mesh(M.brass, this.root),
      floor: floor.mesh(M.floor, this.root), paint: paint.mesh(M.paint, this.root), glow: glow.mesh(M.glow, this.root), label: label.mesh(M.label, this.root),
    };
    // the light rig: ceiling panel (0), a fill bounce from the floor (1)
    this.rig.set(0, new THREE.Vector3(0, H - 0.25, 0), this.lightCol, 4.2, 6.5);
    this.rig.set(1, new THREE.Vector3(0, 0.25, 0.35), 0xffe2c0, 0.35, 3.2);
    this.rig.ambient(0.035, 0.032, 0.03);
  }

  // place the rig's lights in world space (call after moving the car root)
  syncLights() {
    this.root.updateMatrixWorld(true);
    this.rig.move(0, this.root.localToWorld(_p.set(0, CAR.H - 0.25, 0)));
    this.rig.move(1, this.root.localToWorld(_p.set(0, 0.25, 0.35)));
  }

  // 0..1 brightness of the ceiling light (flicker), optional colour
  setLight(k, color = null) {
    this.lightK = k;
    if (color) { this.lightCol.set(color); this.rig.tint(0, this.lightCol, 4.2); this.rig.tint(1, this.lightCol.clone().multiply(new THREE.Color(0xffe2c0)), 0.35); }
    this.rig.level(0, k);
    this.rig.level(1, k);
    this.mats.glow.color.copy(this.lightCol).multiplyScalar(0.12 + k * 1.75);
  }

  // inside test in car space (with a margin)
  containsLocal(p, margin = 0) { return Math.abs(p.x) < HW - margin && p.z > -HD + margin && p.z < HD + 0.04 - margin && p.y > -0.5 && p.y < CAR.H; }

  // static colliders for walls / floor / ceiling + a switchable gate collider (needs root world transform)
  addColliders(physics, opts = {}) {
    this.root.updateMatrixWorld(true);
    const out = [];
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const ry = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    const box = (x0, y0, z0, x1, y1, z1, ud) => {
      const c = this.root.localToWorld(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
      const col = physics.addStaticBox(c.x, c.y, c.z, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, ud || { kind: 'static', surface: 'metal' }, ry);
      out.push(col);
      return col;
    };
    const w = 0.1;
    if (opts.floor !== false) box(-HW - w, -0.2, -HD - w, HW + w, 0.0, CAR.FRONT + 0.1);
    box(-HW - w, 0, -HD - w, HW + w, CAR.H, -HD);
    box(-HW - w, 0, -HD, -HW, CAR.H, CAR.FRONT);
    box(HW, 0, -HD, HW + w, CAR.H, CAR.FRONT);
    box(-HW, CAR.GH, HD, HW, CAR.H, CAR.FRONT);
    box(-HW, 0, HD, -CAR.GW / 2, CAR.GH, CAR.FRONT);
    box(CAR.GW / 2, 0, HD, HW, CAR.GH, CAR.FRONT);
    box(-HW - w, CAR.H, -HD - w, HW + w, CAR.H + 0.15, CAR.FRONT + 0.05);
    this.gateCollider = box(-CAR.GW / 2, 0, CAR.GATE_Z - 0.05, CAR.GW / 2, CAR.GH, CAR.GATE_Z + 0.05);
    this.colliders = out;
    return out;
  }

  update(dt) { this.dial.update(dt); }

  dispose() {
    this.gate.dispose();
    this.dial.dispose();
    this.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) m.dispose();
    this.exterior?.material.dispose();
    this.root.removeFromParent();
  }
}
