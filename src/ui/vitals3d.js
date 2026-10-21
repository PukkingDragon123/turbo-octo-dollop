// The only HUD: two little machines hanging at the top of the view, drawn in the viewmodel layer.
//   MECHANICAL HEART (health): brass valves and pipes, a steel band, a pressure gauge and a glass chamber of
//     sloshing green plasma that beats with the clone's heart rate. Damage cracks the glass (more cracks the
//     lower the health), cracks leak dripping plasma while bleeding, the pressure needle sags.
//   MECHANICAL BRAIN "SANITY": a steel cage holding two glass hemispheres full of glowing filaments and gears.
//     Calm = steady cyan glow and smooth gears; losing it = violet then red, flicker, stuttering gears,
//     sparks; at zero the whole thing shakes itself apart (death by insanity).
// Healing items play a first-person patch-up: the clone reaches into its chest, pulls the heart out into
// both hands, tapes the cracks and/or injects plasma, and pushes it back in (startPatch / patch* weights
// drive the arms in fparms).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';
import { clamp, damp } from '../core/rng.js';

export const VITALS = { depth: 0.3, size: 1.3, landscapeX: 0.12, topY: 0.8, portraitX: [-0.72, -0.4], cradle: [0, -0.07, -0.25], cradleScale: 1.35 };
const R = 0.019;
const PI = Math.PI;
const ease = (t) => t * t * (3 - 2 * t);
const easeOutBack = (t) => { const c = 1.8; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const _v = new THREE.Vector3(), _c = new THREE.Color();
const LOW_COL = new THREE.Color(0x9cff2a), CALM = new THREE.Color(0x5ff8ff), MID = new THREE.Color(0xb050ff), BAD = new THREE.Color(0xff2a2a), _col = new THREE.Color();

// heart shape: a deformed sphere (two lobes and a cleft on top, a point at the bottom, flattened front-back)
function deform(p) {
  let { x, y, z } = p;
  if (y < 0) { const k = 1 + y * 0.8; x *= k * (1 + 0.15 * (1 + y)); z *= k; y *= 1.3; } else { x *= 1 + 0.45 * y; y -= 0.55 * y * Math.exp(-x * x * 12); }
  z *= 0.78;
  return p.set(x, y, z);
}
function heartGeo(r, ws = 40, hs = 28) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { _v.fromBufferAttribute(P, i); deform(_v).multiplyScalar(r); P.setXYZ(i, _v.x, _v.y, _v.z); }
  g.computeVertexNormals();
  return g;
}
// a point on the heart surface from sphere UVs (same mapping as SphereGeometry)
function heartPoint(u, v, r, out = new THREE.Vector3()) {
  const phi = u * PI * 2, th = v * PI;
  out.set(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
  return deform(out).multiplyScalar(r);
}
function gearGeo(r, teeth, depth, hole = 0.3) {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 4; i++) {
    const a = (i / (teeth * 4)) * PI * 2, k = i % 4 < 2 ? 1 : 0.8;
    const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const h = new THREE.Path(); h.absarc(0, 0, r * hole, 0, PI * 2, true); s.holes.push(h);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -depth / 2);
}
function labelTex(text, w = 256, h = 64, fg = '#2a1a08', bg = '#c8a050') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 4; x.strokeRect(3, 3, w - 6, h - 6);
  x.fillStyle = fg; x.font = `bold ${Math.round(h * 0.62)}px "IBM Plex Mono", monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 2);
  for (const sx of [12, w - 12]) { x.fillStyle = '#6a5020'; x.beginPath(); x.arc(sx, h / 2, 5, 0, PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const LIQUID_VS = `
varying vec3 vPos; varying vec3 vN; varying vec3 vView;
void main() { vPos = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const LIQUID_FS = `
uniform float uLevel; uniform vec2 uTilt; uniform float uTime; uniform vec3 uColor; uniform float uGlow; uniform float uBubble; uniform float uR;
varying vec3 vPos; varying vec3 vN; varying vec3 vView;
float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 q = vPos / uR;
  float surf = uLevel + uTilt.x * q.x + uTilt.y * q.z + sin(q.x * 9.0 + uTime * 5.0) * 0.025 + sin(q.z * 8.0 - uTime * 4.3) * 0.02;
  if (q.y > surf) discard;
  float depth = clamp((surf - q.y) / 1.6, 0.0, 1.0);
  vec3 col = uColor * mix(1.35, 0.45, depth);
  if (!gl_FrontFacing) col = uColor * 1.7 + 0.08;
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
  col += uColor * fres * 0.9;
  vec3 bp = q * 6.0 + vec3(0.0, -uTime * 1.6, 0.0);
  vec3 cell = fract(bp) - 0.5;
  float b = smoothstep(0.2, 0.06, length(cell)) * step(0.86, h31(floor(bp)));
  col += vec3(0.7, 1.0, 0.75) * b * uBubble;
  gl_FragColor = vec4(col * uGlow, 1.0);
}`;

export class VitalsHUD {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'vitalsHUD';
    engine.vmCamera.add(this.root);
    // the glow lights live outside the hideable root: a changing light count would recompile every
    // viewmodel material, so they stay in the scene and just go dark
    this.lightRig = new THREE.Group();
    engine.vmCamera.add(this.lightRig);
    this.t = 0;
    this.visible = true;
    this.disp = { health: 100, sanity: 100 };
    this.beat = 0;
    this.lastHealth = 100;
    this.cracks = 0;
    this.tapes = 0;
    this.fakeCracks = 0;
    this.drawnKey = '';
    this.tilt = new THREE.Vector2(); this.tiltV = new THREE.Vector2();
    this.patch = null;           // { kind, t, dur, injected }
    this.patchCradle = 0; this.patchReach = 0;
    this.bottomPx = 0;
    this._buildHeart();
    this._buildBrain();
    this._buildDrips();
  }

  // ---------------- heart ----------------
  _buildHeart() {
    const H = (this.heart = new THREE.Group());
    this.heartBeat = new THREE.Group();
    H.add(this.heartBeat);
    this.root.add(H);
    const B = this.heartBeat;
    const brass = (this.brass = new THREE.MeshStandardMaterial({ color: 0xc89a48, metalness: 0.9, roughness: 0.32, emissive: 0x2a1a06, emissiveIntensity: 0.6 }));
    const steel = (this.steel = new THREE.MeshStandardMaterial({ color: 0xaeb4bc, metalness: 0.85, roughness: 0.3, emissive: 0x141618, emissiveIntensity: 0.6 }));
    const geo = heartGeo(R);
    this.liquidMat = new THREE.ShaderMaterial({
      uniforms: { uLevel: { value: 0.5 }, uTilt: { value: new THREE.Vector2() }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0x2dff6a) }, uGlow: { value: 1 }, uBubble: { value: 1 }, uR: { value: R * 0.9 } },
      vertexShader: LIQUID_VS, fragmentShader: LIQUID_FS, side: THREE.DoubleSide, toneMapped: false,
    });
    const liquid = new THREE.Mesh(heartGeo(R * 0.9), this.liquidMat);
    liquid.renderOrder = 1;
    B.add(liquid);
    // dark inner backing so the glass reads when the chamber is empty
    B.add(new THREE.Mesh(heartGeo(R * 0.93, 24, 16), new THREE.MeshStandardMaterial({ color: 0x0a120c, roughness: 0.6, metalness: 0.2, side: THREE.BackSide })));
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f0e8, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.24, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, envMapIntensity: 1.6 });
    const glass = new THREE.Mesh(geo, this.glassMat);
    glass.renderOrder = 2;
    B.add(glass);
    // crack + tape overlay (canvas drawn on demand)
    this.crackCv = document.createElement('canvas'); this.crackCv.width = 512; this.crackCv.height = 256;
    this.crackTex = new THREE.CanvasTexture(this.crackCv); this.crackTex.colorSpace = THREE.SRGBColorSpace;
    const crack = new THREE.Mesh(heartGeo(R * 1.006), new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, toneMapped: false }));
    crack.renderOrder = 3;
    B.add(crack);
    // steel band with rivets round the middle
    const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.0011, 6, 48).rotateX(PI / 2), steel);
    band.scale.set(1, 1, 0.8);
    band.position.y = R * 0.05;
    B.add(band);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      const rv = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 6, 4), brass);
      rv.position.set(Math.cos(a) * R * 1.03, R * 0.05, Math.sin(a) * R * 0.83);
      B.add(rv);
    }
    // aorta + vena pipes with flanges, a valve wheel, a back pipe
    for (const [x, h, r] of [[-0.0075, 0.012, 0.0034], [0.0065, 0.009, 0.0028]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 12), brass);
      pipe.position.set(x, R * 0.62 + h / 2, -0.001);
      B.add(pipe);
      const fl = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, 0.0011, 6, 16).rotateX(PI / 2), steel);
      fl.position.set(x, R * 0.62 + h, -0.001);
      B.add(fl);
    }
    this.valve = new THREE.Group();
    this.valve.position.set(-0.0075, R * 0.62 + 0.007, 0.0036);
    this.valve.add(new THREE.Mesh(new THREE.TorusGeometry(0.0034, 0.0008, 6, 16), steel));
    for (const a of [0, PI / 2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.0068, 0.0007, 0.0007), steel); sp.rotation.z = a; this.valve.add(sp); }
    B.add(this.valve);
    const back = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0018, 8, 16, PI), brass);
    back.position.set(0.001, R * 0.7, -0.008); back.rotation.y = PI / 2;
    B.add(back);
    // pressure gauge on the front-right
    const gc = document.createElement('canvas'); gc.width = gc.height = 128;
    const x = gc.getContext('2d');
    x.fillStyle = '#efe6cf'; x.beginPath(); x.arc(64, 64, 62, 0, PI * 2); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 3;
    for (let i = 0; i <= 10; i++) { const a = PI * 0.75 + (i / 10) * PI * 1.5; x.beginPath(); x.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); x.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); x.stroke(); }
    x.strokeStyle = '#c02010'; x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 50, PI * 0.75, PI * 1.05); x.stroke();
    x.fillStyle = '#222'; x.font = 'bold 18px monospace'; x.textAlign = 'center'; x.fillText('PSI', 64, 96);
    const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace;
    const gauge = new THREE.Group();
    gauge.position.set(R * 0.62, R * 0.08, R * 0.62);
    gauge.rotation.y = 0.55;
    gauge.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0022, 20).rotateX(PI / 2), brass));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.0052, 20), new THREE.MeshBasicMaterial({ map: gt, toneMapped: false }));
    face.position.z = 0.00115;
    gauge.add(face);
    this.needle = new THREE.Mesh(new THREE.BoxGeometry(0.0006, 0.0044, 0.0004).translate(0, 0.002, 0), new THREE.MeshBasicMaterial({ color: 0xd01808 }));
    this.needle.position.z = 0.0014;
    gauge.add(this.needle);
    B.add(gauge);
    // hoses that only show while the heart is out of the chest
    this.hoses = new THREE.Group();
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7, metalness: 0.1 });
    for (const sx of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.006, -R * 0.9, -0.002), new THREE.Vector3(sx * 0.012, -R * 2.2, 0.004), new THREE.Vector3(sx * 0.02, -R * 4.5, 0.03), new THREE.Vector3(sx * 0.03, -R * 9, 0.08)]);
      this.hoses.add(new THREE.Mesh(new THREE.TubeGeometry(c, 16, 0.0022, 6), hoseMat));
    }
    this.hoses.visible = false;
    B.add(this.hoses);
    // local glow so the HUD reads in the dark
    this.heartLight = new THREE.PointLight(0x40ff70, 0.02, 0.09, 2);
    this.lightRig.add(this.heartLight);
    // patch-up props: tape roll strips are drawn on the crack canvas; the syringe is a small model
    this.syringe = this._syringe();
    this.syringe.visible = false;
    H.add(this.syringe);
  }

  _syringe() {
    const g = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0xd8f0e8, transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false });
    const plasma = new THREE.MeshStandardMaterial({ color: 0x3cff6a, emissive: 0x2dff5a, emissiveIntensity: 1.5 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.034, 12, 1, true), glass));
    this.syrPlasma = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.03, 10).translate(0, -0.015, 0), plasma);
    this.syrPlasma.position.y = 0.015;
    g.add(this.syrPlasma);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0003, 0.016, 5), this.steel);
    n.position.y = -0.025; g.add(n);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.02, 6), this.steel);
    rod.position.y = 0.026; g.add(rod);
    this.syrRod = rod;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.0015, 10), this.brass);
    cap.position.y = 0.036; g.add(cap);
    this.syrCap = cap;
    return g;
  }

  _drawCracks(n, tapes, fake) {
    const key = `${n}|${tapes}|${fake}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const c = this.crackCv.getContext('2d'), W = this.crackCv.width, Hh = this.crackCv.height;
    c.clearRect(0, 0, W, Hh);
    const spots = [[0.2, 0.42], [0.31, 0.58], [0.25, 0.3], [0.16, 0.62], [0.34, 0.38]];
    const total = Math.min(spots.length, n + fake);
    for (let i = 0; i < total; i++) {
      const [u, v] = spots[i];
      let rs = 1 + i * 7;
      const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
      const cx = u * W, cy = v * Hh;
      c.lineCap = 'round';
      const legs = 5 + Math.floor(rnd() * 3);
      for (let l = 0; l < legs; l++) {
        let a = (l / legs) * PI * 2 + rnd() * 0.6, x = cx, y = cy;
        const len = 8 + rnd() * 14;
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < len; s++) {
          a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * 3; y += Math.sin(a) * 2.2;
          c.lineTo(x, y);
          if (rnd() < 0.12) { c.moveTo(x, y); c.lineTo(x + Math.cos(a + 1.2) * 9, y + Math.sin(a + 1.2) * 7); c.moveTo(x, y); }
        }
        c.strokeStyle = 'rgba(10,30,18,0.75)'; c.lineWidth = 3.2; c.stroke();
        c.strokeStyle = i >= n ? 'rgba(255,120,120,0.85)' : 'rgba(225,255,235,0.95)'; c.lineWidth = 1.4; c.stroke();
      }
      c.fillStyle = 'rgba(235,255,240,0.9)'; c.beginPath(); c.arc(cx, cy, 3.5, 0, PI * 2); c.fill();
      if (i < tapes && i < n) {
        // duct tape cross over the crack
        for (const rot of [0.5, -0.6]) {
          c.save(); c.translate(cx, cy); c.rotate(rot);
          c.fillStyle = 'rgba(176,172,160,0.96)'; c.fillRect(-26, -7, 52, 14);
          c.strokeStyle = 'rgba(90,86,78,0.9)'; c.lineWidth = 1.5; c.strokeRect(-26, -7, 52, 14);
          c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(-26, -7, 52, 4);
          c.restore();
        }
      }
    }
    this.crackTex.needsUpdate = true;
    this.crackSpots = spots.slice(0, Math.min(n, spots.length)).map(([u, v]) => heartPoint(u, v, R * 1.01));
  }

  // ---------------- brain ----------------
  _buildBrain() {
    const Bg = (this.brain = new THREE.Group());
    this.brainJit = new THREE.Group();
    Bg.add(this.brainJit);
    this.root.add(Bg);
    const J = this.brainJit;
    const BR = R * 0.95;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ff, roughness: 0.06, transparent: true, opacity: 0.2, clearcoat: 1, depthWrite: false, envMapIntensity: 1.6 });
    this.filMats = [];
    for (const sx of [-1, 1]) {
      const hemi = new THREE.Mesh(new THREE.SphereGeometry(BR, 28, 18, 0, PI).rotateY(sx > 0 ? PI / 2 : -PI / 2), glass);
      hemi.scale.set(1, 0.82, 1.15);
      hemi.position.x = sx * 0.0016;
      hemi.renderOrder = 2;
      J.add(hemi);
      // dark lobe core
      const core = new THREE.Mesh(new THREE.SphereGeometry(BR * 0.8, 18, 12, 0, PI).rotateY(sx > 0 ? PI / 2 : -PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
      core.scale.set(0.85, 0.75, 1.05);
      core.position.x = sx * 0.002;
      J.add(core);
      // glowing filaments: random loops inside the hemisphere
      const mat = new THREE.MeshBasicMaterial({ color: 0x5ff8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.filMats.push(mat);
      let rs = sx > 0 ? 11 : 23;
      const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
      for (let f = 0; f < 6; f++) {
        const pts = [];
        for (let k = 0; k < 6; k++) {
          const a = rnd() * PI * 2, b = rnd() * PI, rr = BR * (0.55 + rnd() * 0.35);
          pts.push(new THREE.Vector3(sx * (0.003 + Math.abs(Math.cos(a) * Math.sin(b)) * rr * 0.85), Math.cos(b) * rr * 0.75, Math.sin(a) * Math.sin(b) * rr * 1.05));
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.0007, 4, true), mat);
        tube.renderOrder = 1;
        J.add(tube);
      }
    }
    // gears in the gap between the lobes
    this.gears = [];
    for (const [r, t, y, z, sp] of [[0.0075, 12, 0.002, 0.003, 1], [0.0045, 8, -0.0062, -0.0068, -1.6]]) {
      const g = new THREE.Mesh(gearGeo(r, t, 0.0016), this.brass);
      g.rotation.y = PI / 2;
      const piv = new THREE.Group(); piv.position.set(0, y, z); piv.add(g);
      J.add(piv);
      this.gears.push({ piv, sp });
    }
    // steel cage: meridian straps over the top + an equator ring + a neck and a brass base with a name plate
    for (const ang of [-0.5, 0, 0.5]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(BR * 1.05, 0.0008, 5, 28, PI), this.steel);
      arc.rotation.set(0, PI / 2, 0);
      const holder = new THREE.Group(); holder.rotation.z = ang; holder.add(arc);
      holder.scale.set(1, 0.85, 1.18);
      J.add(holder);
    }
    const eq = new THREE.Mesh(new THREE.TorusGeometry(BR * 1.04, 0.001, 6, 40).rotateX(PI / 2), this.steel);
    eq.scale.set(1, 1, 1.18);
    J.add(eq);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.0045, 0.008, 10), this.steel);
    neck.position.y = -BR * 0.82 - 0.003;
    J.add(neck);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.0035, 16), this.brass);
    base.position.y = -BR * 0.82 - 0.0085;
    J.add(base);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.0055), new THREE.MeshBasicMaterial({ map: labelTex('SANITY'), toneMapped: false }));
    plate.position.set(0, -BR * 0.82 - 0.0085, 0.0102);
    J.add(plate);
    this.brainLight = new THREE.PointLight(0x5ff8ff, 0.02, 0.09, 2);
    this.lightRig.add(this.brainLight);
  }

  // ---------------- drips / sparks ----------------
  _buildDrips() {
    this.drips = [];
    const geo = new THREE.SphereGeometry(0.0011, 6, 4);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x40ff70, transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false;
      this.root.add(m);
      this.drips.push({ m, v: new THREE.Vector3(), life: 0 });
    }
    this.dripT = 0;
  }

  _spawnDrip(from, spark = false) {
    const d = this.drips.find((x) => x.life <= 0);
    if (!d) return;
    d.m.position.copy(from);
    d.v.set((Math.random() - 0.5) * (spark ? 0.08 : 0.004), spark ? Math.random() * 0.05 : -0.002, 0);
    d.life = spark ? 0.35 : 1.4;
    d.spark = spark;
    d.m.material.color.setHex(spark ? (Math.random() < 0.5 ? 0xff60ff : 0xffd040) : 0x40ff70);
    d.m.scale.set(1, spark ? 1 : 1.6, 1);
    d.m.visible = true;
  }

  // ---------------- patch-up animation ----------------
  startPatch(kind, dur) {
    this.patch = { kind, t: 0, dur: Math.max(1.2, dur), taped: 0, thump: false, inj: 0 };
    audio.play('android_servo', { volume: 0.5 });
  }
  cancelPatch() { if (this.patch) this.patch.t = Math.max(this.patch.t, this.patch.dur * 0.8); }
  get busy() { return !!this.patch; }

  _updatePatch(dt, hudPos, hudScale) {
    const P = this.patch;
    const H = this.heart;
    if (!P) { this.patchCradle = damp(this.patchCradle, 0, 10, dt); this.patchReach = damp(this.patchReach, 0, 10, dt); this.hoses.visible = false; this.syringe.visible = false; return false; }
    P.t += dt;
    const u = Math.min(1, P.t / P.dur);
    const cr = (this._cr ||= new THREE.Vector3()).fromArray(VITALS.cradle);
    const below = (this._below ||= new THREE.Vector3()).copy(cr).setY(-0.32);
    const hs = hudScale * VITALS.cradleScale;
    let reach = 0, cradle = 0;
    this.hoses.visible = false;
    if (u < 0.16) {
      const k = ease(u / 0.16);
      H.position.copy(hudPos); H.scale.setScalar(hudScale * (1 - k));
      reach = k;
    } else if (u < 0.3) {
      const k = ease((u - 0.16) / 0.14);
      H.position.lerpVectors(below, cr, k); H.scale.setScalar(hs);
      reach = 1 - k; cradle = k;
      this.hoses.visible = true;
    } else if (u < 0.78) {
      H.position.copy(cr).add(_v.set(Math.sin(P.t * 23) * 0.0012, Math.sin(P.t * 17) * 0.001, 0));
      H.scale.setScalar(hs);
      cradle = 1;
      this.hoses.visible = true;
      const w = (u - 0.3) / 0.48;
      const tapeKind = P.kind !== 'plasma_syringe';
      const injKind = P.kind !== 'bandage';
      // tape the cracks one by one
      if (tapeKind) {
        const want = Math.min(Math.max(1, this.cracks), Math.floor((injKind ? w * 2 : w) * 3.2) + 1);
        if (want > P.taped && (injKind ? w < 0.5 : true)) { P.taped = want; this.tapes = Math.max(this.tapes, want); audio.play('bandage', { volume: 0.35 }); }
      }
      // inject plasma: the syringe slides in, the plunger goes down, the chamber fills
      const s0 = injKind ? (tapeKind ? 0.45 : 0.05) : 2;
      if (w > s0) {
        const k = clamp((w - s0) / (1 - s0), 0, 1);
        this.syringe.visible = true;
        const inK = ease(clamp(k / 0.25, 0, 1)), push = ease(clamp((k - 0.3) / 0.6, 0, 1));
        this.syringe.position.set(0.032 - inK * 0.012, 0.012, 0.012);
        this.syringe.rotation.set(0, 0, 0.9);
        this.syrRod.position.y = 0.026 - push * 0.02; this.syrCap.position.y = 0.036 - push * 0.02;
        this.syrPlasma.scale.y = Math.max(0.02, 1 - push);
        P.inj = push;
        if (push > 0 && !P.hiss) { P.hiss = true; audio.play('pipe_hiss', { volume: 0.35 }); }
      }
    } else if (u < 0.92) {
      const k = ease((u - 0.78) / 0.14);
      H.position.lerpVectors(cr, below, k); H.scale.setScalar(hs);
      cradle = 1 - k; reach = k;
      this.hoses.visible = true;
      this.syringe.visible = false;
      if (k > 0.85 && !P.thump) { P.thump = true; audio.play('robo_clunk', { volume: 0.7 }); juice.shake(0.3); }
    } else {
      const k = clamp((u - 0.92) / 0.08, 0, 1);
      H.position.copy(hudPos); H.scale.setScalar(hudScale * Math.max(0.01, easeOutBack(k)));
      reach = 1 - k;
    }
    this.patchCradle = cradle; this.patchReach = reach;
    H.rotation.set(cradle * 0.25, Math.sin(this.t * 0.6) * 0.2 * cradle, 0);
    if (u >= 1) this.patch = null;
    return true;
  }

  // ---------------- per frame ----------------
  // ctx: { survival, visible, sway:{x,y}, accel:{x,z}, dead, insaneT }
  update(dt, ctx) {
    this.t += dt;
    const s = ctx.survival;
    const cam = engine.vmCamera;
    const show = ctx.visible !== false;
    this.root.visible = show;
    if (!show) { this.heartLight.intensity = 0; this.brainLight.intensity = 0; return; }
    // pin to the top of the screen whatever the viewmodel fov (it zooms when the watch is raised)
    const z = VITALS.depth;
    const halfH = z * Math.tan((cam.fov * PI) / 360), halfW = halfH * cam.aspect;
    const k = halfH / (0.3 * Math.tan(PI / 6)) * VITALS.size;
    const portrait = cam.aspect < 1;
    const yN = VITALS.topY - (portrait ? 0.02 : 0);
    const hx = portrait ? VITALS.portraitX[0] : -VITALS.landscapeX / Math.max(1, cam.aspect / 1.6);
    const bx = portrait ? VITALS.portraitX[1] : VITALS.landscapeX / Math.max(1, cam.aspect / 1.6);
    const hudPos = (this._hud ||= new THREE.Vector3()).set(hx * halfW, yN * halfH, -z);
    this.brain.position.set(bx * halfW, yN * halfH, -z);
    this.brain.scale.setScalar(k);
    this.bottomPx = portrait ? ((1 - (yN * halfH - R * 2 * k) / halfH) / 2) * window.innerHeight : 0;
    // ---- heart
    const health = ctx.dead ? 0 : s.health;
    this.disp.health = damp(this.disp.health, health, health < this.disp.health ? 8 : 2.5, dt);
    if (health < this.lastHealth - 4) { audio.play('glass_crack', { volume: 0.5 }); this.tiltV.x += (Math.random() - 0.5) * 2; this.kick = 1; }
    this.lastHealth = health;
    this.cracks = health >= 88 ? 0 : health >= 68 ? 1 : health >= 48 ? 2 : health >= 28 ? 3 : health >= 12 ? 4 : 5;
    if (health >= 92) this.tapes = 0;
    this.tapes = Math.min(this.tapes, this.cracks);
    // low sanity: the heart sometimes shows cracks that aren't there
    if (s.sanity < 30 && Math.random() < dt * 0.6) this.fakeCracks = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 2) : 0;
    if (s.sanity >= 30) this.fakeCracks = 0;
    this._drawCracks(this.cracks, this.tapes, this.fakeCracks);
    const patching = this._updatePatch(dt, hudPos, k);
    if (!patching) { this.heart.position.copy(hudPos); this.heart.scale.setScalar(k); this.heart.rotation.set(0, Math.sin(this.t * 0.5) * 0.18, 0); }
    // beat: lub-dub at the heart rate (frantic when low)
    const hr = ctx.dead ? 0 : clamp(s.heartRate || 72, 40, 190);
    this.beat += dt * hr / 60;
    const ph = this.beat % 1;
    const lub = Math.exp(-((ph - 0.05) ** 2) / 0.0025), dub = Math.exp(-((ph - 0.3) ** 2) / 0.003) * 0.6;
    this.kick = Math.max(0, (this.kick || 0) - dt * 3);
    this.heartBeat.scale.setScalar(1 + (lub + dub) * 0.07 + this.kick * 0.08 * Math.sin(this.t * 60));
    this.valve.rotation.z += dt * (0.5 + (lub + dub) * 4);
    // plasma level, slosh (spring driven by look sway / movement / beats)
    let fill = this.disp.health / 100;
    if (this.patch && this.patch.inj > 0) fill = Math.min(1, fill + this.patch.inj * 0.25);
    const sway = ctx.sway || { x: 0, y: 0 };
    this.tiltV.x += (-clamp(sway.x, -0.2, 0.2) * 6 + (ctx.accel?.x || 0) * 0.03 + (lub > 0.9 ? (Math.random() - 0.5) * 0.3 : 0)) ;
    this.tiltV.y += (clamp(sway.y, -0.2, 0.2) * 3 + (ctx.accel?.z || 0) * 0.03);
    this.tiltV.addScaledVector(this.tilt, -60 * dt).multiplyScalar(Math.exp(-3.5 * dt));
    this.tilt.addScaledVector(this.tiltV, dt).clampLength(0, 0.8);
    const L = this.liquidMat.uniforms;
    L.uLevel.value = -1.28 + fill * 2.05 + (lub + dub) * 0.04;
    L.uTilt.value.copy(this.tilt);
    L.uTime.value = this.t;
    const low = 1 - fill;
    _c.setHex(0x2dff6a).lerp(LOW_COL, low * 0.5);
    if (this.fakeCracks && Math.random() < 0.3) _c.setHex(0xff3030);
    L.uColor.value.copy(_c);
    L.uGlow.value = 0.85 + lub * 0.35;
    L.uBubble.value = 0.6 + low;
    this.needle.rotation.z = (1 - fill) * 2.3 - 1.15 + (fill < 0.3 ? (Math.random() - 0.5) * 0.25 : 0) - (lub + dub) * 0.08;
    this.heartLight.intensity = (0.0004 + fill * 0.0006 + lub * 0.0003) * k * k;
    this.heartLight.position.copy(this.heart.position).add(_v.set(0, 0, 0.03 * this.heart.scale.x));
    // leaking plasma from the cracks while bleeding (or badly hurt)
    this.dripT -= dt;
    const leak = (s.bleed || 0) * 1.2 + (this.cracks >= 4 ? 0.6 : 0);
    if (!ctx.dead && leak > 0 && this.crackSpots?.length && this.dripT <= 0) {
      this.dripT = 0.5 / leak + Math.random() * 0.3;
      const sp = this.crackSpots[Math.floor(Math.random() * this.crackSpots.length)];
      this.heartBeat.localToWorld(_v.copy(sp));
      this.root.worldToLocal(_v);
      this._spawnDrip(_v);
      if (Math.random() < 0.3) audio.play('drip', { volume: 0.15 });
    }
    // ---- brain (sanity)
    const san = ctx.dead ? 0 : s.sanity;
    this.disp.sanity = damp(this.disp.sanity, san, 3, dt);
    const sv = clamp(this.disp.sanity / 100, 0, 1);
    const insane = (ctx.insaneT || 0) > 0;
    const col = sv > 0.5 ? _col.copy(MID).lerp(CALM, (sv - 0.5) * 2) : _col.copy(BAD).lerp(MID, sv * 2);
    const flick = Math.random() < (1 - sv) ** 2 * 0.35 || (insane && Math.random() < 0.5);
    const glow = flick ? 0.15 : 0.75 + Math.sin(this.t * (2 + (1 - sv) * 9)) * 0.25 * (1 - sv * 0.5);
    for (const m of this.filMats) { m.color.copy(col).multiplyScalar(glow * 2.2); }
    this.brainLight.color.copy(col);
    this.brainLight.intensity = (0.0004 + 0.0006 * glow) * (flick ? 0.3 : 1) * k * k;
    this.brainLight.position.copy(this.brain.position).add(_v.set(0, 0, 0.03 * k));
    const stutter = sv < 0.4 && Math.sin(this.t * 7.3) > 0.6 ? -0.6 : 1;
    for (const g of this.gears) g.piv.rotation.x += dt * g.sp * (0.6 + sv * 2.4) * stutter;
    const jit = (sv < 0.25 ? (0.25 - sv) * 0.03 : 0) + (insane ? 0.02 : 0);
    this.brainJit.position.set((Math.random() - 0.5) * jit, (Math.random() - 0.5) * jit, 0);
    this.brainJit.rotation.set(0, Math.sin(this.t * 0.4) * 0.25 + (Math.random() - 0.5) * jit * 8, (Math.random() - 0.5) * jit * 4);
    this.brainJit.scale.setScalar(1 + Math.sin(this.t * 1.3) * 0.015);
    if ((sv < 0.2 || insane) && Math.random() < dt * (insane ? 14 : 3)) {
      this.brain.localToWorld(_v.set((Math.random() - 0.5) * 0.02, (Math.random() - 0.2) * 0.02, 0.01));
      this.root.worldToLocal(_v);
      this._spawnDrip(_v, true);
    }
    // drips & sparks
    for (const d of this.drips) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= dt * (d.spark ? 0.15 : 0.05);
      d.m.position.addScaledVector(d.v, dt);
      d.m.material.opacity = Math.min(1, d.life * 2);
      if (d.life <= 0) d.m.visible = false;
    }
  }

  dispose() { this.root.removeFromParent(); this.lightRig.removeFromParent(); }
}
