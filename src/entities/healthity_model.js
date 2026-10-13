// R.O.O.M. — Healthity: a cute floating spherical medical robot (~0.28 m) with an LED
// pixel face on a dark glass screen, a red-cross badge, blinking antenna, a hover
// thruster ring and two little floating stubby arms.
//
// buildHealthity() -> { root, setFace(expr), setTalking(bool), update(dt) }
//   expressions: happy neutral worried alarmed sleepy dead love glitch wink angry
//   root origin = centre of the sphere (the hover point). The body bobs/tilts inside root.
import * as THREE from 'three';
import { G, paint, cached, clamp, lerp, damp } from './avatar.js';
import { labelTexture } from '../gfx/textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const PI = Math.PI, TAU = PI * 2;
export const HEALTHITY_FACES = ['happy', 'neutral', 'worried', 'alarmed', 'sleepy', 'dead', 'love', 'glitch', 'wink', 'angry'];
const R0 = 0.14;
const GW = 32, GH = 24, CELL = 8;
const FACE_COL = { happy: '#59f7e6', neutral: '#59f7e6', worried: '#7fd8ff', alarmed: '#ffd84a', sleepy: '#4fb8c8', dead: '#6a8d8a', love: '#ff78b8', glitch: '#59f7e6', wink: '#59f7e6', angry: '#ff5a46' };

const shellMat = () => cached('hl_shell', () => new THREE.MeshPhysicalMaterial({ name: 'hl_shell', color: 0xffffff, vertexColors: true, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }));
const metalMat = () => cached('hl_metal', () => new THREE.MeshStandardMaterial({ name: 'hl_metal', color: 0xc8cdd2, roughness: 0.25, metalness: 1 }));

// --- pixel painter -------------------------------------------------------------
class Pix {
  constructor() { this.g = new Uint8Array(GW * GH); }
  clear() { this.g.fill(0); }
  set(x, y, v = 1) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < GW && y < GH) this.g[y * GW + x] = v; }
  rect(x0, y0, w, h) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.set(x0 + x, y0 + y); }
  oval(cx, cy, rx, ry) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx + 0.6) + (y * y) / (ry * ry + 0.6) <= 1) this.set(cx + x, cy + y); }
  ring(cx, cy, r) { for (let a = 0; a < TAU; a += 0.12) this.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  line(x0, y0, x1, y1) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) this.set(lerp(x0, x1, i / n), lerp(y0, y1, i / n)); }
  arc(cx, cy, r, a0, a1, sy = 1) { const n = Math.ceil(r * Math.abs(a1 - a0) * 1.5) + 2; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); this.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy); } }
  heart(cx, cy) { const H = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']; H.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') this.set(cx - 3 + x, cy - 3 + y); })); }
  x(cx, cy, r) { this.line(cx - r, cy - r, cx + r, cy + r); this.line(cx - r, cy + r, cx + r, cy - r); }
}

function drawFace(P, expr, st) {
  P.clear();
  const ex = [9, 22], ey = 9;
  const blink = st.blink > 0;
  const eyeOval = (i, rx = 3, ry = 4) => { if (blink) { P.line(ex[i] - 3, ey + 1, ex[i] + 3, ey + 1); P.line(ex[i] - 3, ey + 2, ex[i] + 3, ey + 2); } else P.oval(ex[i], ey, rx, ry); };
  const mouthTalk = () => { const o = st.talkOpen; if (o < 0.2) P.rect(12, 17, 8, 2); else P.oval(15.5, 18, 2 + Math.round(o * 2), Math.max(1, Math.round(o * 3.5))); };
  switch (expr) {
    case 'happy':
      for (const i of [0, 1]) { P.arc(ex[i], ey + 3, 4, PI * 1.1, PI * 1.9); P.arc(ex[i], ey + 4, 4, PI * 1.15, PI * 1.85); }
      if (st.talking) mouthTalk(); else { P.arc(15.5, 13, 6, PI * 0.15, PI * 0.85); P.arc(15.5, 14, 6, PI * 0.2, PI * 0.8); }
      P.rect(3, 14, 3, 2); P.rect(26, 14, 3, 2);
      break;
    case 'neutral':
      eyeOval(0); eyeOval(1);
      if (st.talking) mouthTalk(); else P.rect(12, 17, 8, 2);
      break;
    case 'worried':
      eyeOval(0, 2, 2); eyeOval(1, 2, 2);
      P.line(7, 5, 11, 4); P.line(20, 4, 24, 5);
      if (st.talking) mouthTalk(); else for (let x = 11; x <= 20; x++) P.set(x, 18 + Math.round(Math.sin(x * 1.3) * 0.7));
      break;
    case 'alarmed':
      for (const i of [0, 1]) { P.ring(ex[i], ey, 3.4); P.set(ex[i], ey); }
      if (st.talking) mouthTalk(); else P.oval(15.5, 18, 2, 2);
      if (Math.floor(st.t * 4) % 2) { P.line(29, 3, 29, 7); P.set(29, 9); }
      break;
    case 'sleepy': {
      P.line(7, ey + 2, 13, ey + 2); P.line(18, ey + 2, 24, ey + 2);
      P.oval(15.5, 18, 1, 1);
      const z = (st.t * 0.8) % 1, zx = 24 + Math.round(z * 4), zy = 6 - Math.round(z * 5);
      P.line(zx, zy, zx + 2, zy); P.line(zx + 2, zy, zx, zy + 2); P.line(zx, zy + 2, zx + 2, zy + 2);
      break;
    }
    case 'dead':
      P.x(ex[0], ey, 2); P.x(ex[1], ey, 2);
      for (let x = 11; x <= 20; x++) P.set(x, 17 + (x % 2));
      break;
    case 'love':
      P.heart(ex[0], ey); P.heart(ex[1], ey);
      if (st.talking) mouthTalk(); else P.arc(15.5, 14, 4, PI * 0.2, PI * 0.8);
      { const k = (st.t * 0.6) % 1; P.heart(27 + Math.round(Math.sin(k * 9)), 20 - Math.round(k * 16)); }
      break;
    case 'wink':
      P.arc(ex[0], ey + 3, 4, PI * 1.1, PI * 1.9); P.arc(ex[0], ey + 4, 4, PI * 1.15, PI * 1.85);
      eyeOval(1);
      if (st.talking) mouthTalk(); else { P.arc(15.5, 13, 6, PI * 0.15, PI * 0.85); P.arc(15.5, 14, 6, PI * 0.2, PI * 0.8); }
      break;
    case 'angry':
      P.line(6, 4, 13, 7); P.line(18, 7, 25, 4);
      for (const i of [0, 1]) P.rect(ex[i] - 2, ey, 5, 3);
      if (st.talking) mouthTalk(); else P.arc(15.5, 21, 4, PI * 1.2, PI * 1.8);
      break;
    case 'glitch':
    default:
      eyeOval(0); eyeOval(1); P.line(12, 17, 19, 17);
      break;
  }
  // glitch scramble (expression 'glitch' or a burst on face change)
  const gl = expr === 'glitch' ? 0.55 + 0.45 * Math.sin(st.t * 13) : st.glitch;
  if (gl > 0.02) {
    const rnd = st.rnd;
    for (let y = 0; y < GH; y++) {
      if (rnd() < gl * 0.35) { const sh = Math.round((rnd() - 0.5) * 8 * gl); const row = P.g.slice(y * GW, y * GW + GW); for (let x = 0; x < GW; x++) P.g[y * GW + x] = row[(x - sh + GW) % GW]; }
    }
    for (let i = 0; i < 40 * gl; i++) P.g[Math.floor(rnd() * GW * GH)] = rnd() < 0.5 ? 1 : 2;
  }
}

function makeScreenTexture() {
  const tex = labelTexture(GW * CELL, GH * CELL, (ctx, w, h) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}
function paintScreen(tex, P, col) {
  const ctx = tex.userData.ctx, w = GW * CELL, h = GH * CELL;
  ctx.fillStyle = '#020606'; ctx.fillRect(0, 0, w, h);
  // unlit LED matrix
  ctx.fillStyle = 'rgba(40,90,90,0.16)';
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
  // glow pass
  ctx.globalAlpha = 0.28; ctx.fillStyle = col;
  for (let i = 0; i < P.g.length; i++) if (P.g[i]) { const x = i % GW, y = (i / GW) | 0; ctx.fillRect(x * CELL - 2, y * CELL - 2, CELL + 4, CELL + 4); }
  ctx.globalAlpha = 1;
  for (let i = 0; i < P.g.length; i++) if (P.g[i]) {
    const x = i % GW, y = (i / GW) | 0;
    ctx.fillStyle = P.g[i] === 2 ? '#ff4fd8' : col;
    ctx.fillRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x * CELL + 2, y * CELL + 2, 3, 3);
  }
  tex.needsUpdate = true;
}

export function buildHealthity() {
  const root = new THREE.Group(); root.name = 'Healthity';
  const body = new THREE.Group(); root.add(body);
  // --- shell: white top, mint lower band, seam groove, side speaker discs
  const shell = new THREE.SphereGeometry(R0, 40, 28);
  paint(shell, (x, y) => (y < -0.035 ? 0x8fe3cf : 0xf4f6f4));
  const groove = G.xf(G.torus(R0 * 0.985, 0.0045, 6, 48), [0, -0.035, 0], [PI / 2, 0, 0], [1, 1, 1]);
  paint(groove, () => 0x3a5a54);
  const parts = [shell, groove];
  for (const s of [-1, 1]) {
    const disc = G.xf(G.cyl(0.042, 0.046, 0.016, 24), [s * (R0 - 0.004), 0.005, 0.0], [0, 0, PI / 2]); paint(disc, () => 0x8fe3cf);
    const cap = G.xf(G.cyl(0.03, 0.03, 0.006, 20), [s * (R0 + 0.006), 0.005, 0.0], [0, 0, PI / 2]); paint(cap, () => 0xe8ecea);
    parts.push(disc, cap);
    for (let i = -1; i <= 1; i++) { const sl = G.xf(G.box(0.004, 0.004, 0.034), [s * (R0 + 0.009), 0.005 + i * 0.01, 0]); paint(sl, () => 0x3a5a54); parts.push(sl); }
  }
  // red cross badge on the top-back
  const badgeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0));
  const bp = new THREE.Vector3(0, R0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0)));
  const badge = G.xf(G.cyl(0.032, 0.032, 0.006, 24)); badge.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0))); badge.translate(bp.x, bp.y, bp.z); paint(badge, () => 0xffffff);
  const cr1 = G.box(0.036, 0.004, 0.012), cr2 = G.box(0.012, 0.004, 0.036);
  for (const c of [cr1, cr2]) { c.translate(0, 0.004, 0); c.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0))); c.translate(bp.x, bp.y, bp.z); paint(c, () => 0xe02a2a); parts.push(c); }
  parts.push(badge);
  // antenna base
  const ab = G.xf(G.cyl(0.012, 0.016, 0.012, 12), [0.05, R0 * 0.93, -0.02], [0, 0, -0.35]); paint(ab, () => 0x8fe3cf); parts.push(ab);
  // screen bezel (dark rim around the face window)
  const bez = new THREE.SphereGeometry(R0 + 0.0015, 32, 16, PI * 1.5 - 0.9, 1.8, PI / 2 - 0.63, 1.21); paint(bez, () => 0x1f2a2a);
  parts.push(bez);
  const shellMesh = new THREE.Mesh(mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); } return g; })), shellMat());
  shellMesh.castShadow = true; shellMesh.receiveShadow = true;
  body.add(shellMesh);
  // --- face screen (emissive LED canvas on a dark glass patch)
  const tex = makeScreenTexture();
  const screenMat = new THREE.MeshPhysicalMaterial({ name: 'hl_screen', color: 0x050a0a, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.6, envMapIntensity: 1.0 });
  const scr = new THREE.Mesh(new THREE.SphereGeometry(R0 + 0.003, 32, 16, PI * 1.5 - 0.8, 1.6, PI / 2 - 0.55, 1.05), screenMat);
  scr.name = 'screen';
  body.add(scr);
  // --- antenna with blinking tip
  const ant = new THREE.Group(); ant.position.set(0.05, R0 * 0.93, -0.02); ant.rotation.z = -0.35; body.add(ant);
  const stalk = new THREE.Mesh(G.capY(0.003, 0, 0.06, 2, 6), metalMat()); ant.add(stalk);
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3030, emissiveIntensity: 2.5, roughness: 0.3 });
  const tip = new THREE.Mesh(G.sphere(0.009, 12, 8), tipMat); tip.position.y = 0.065; ant.add(tip);
  // --- hover thruster ring + soft glow cone
  const ring = new THREE.Mesh(G.xf(G.torus(0.05, 0.008, 8, 32), [0, -R0 * 0.93, 0], [PI / 2, 0, 0]), new THREE.MeshStandardMaterial({ color: 0x0a2020, emissive: 0x4ff5ff, emissiveIntensity: 2.2, roughness: 0.3 }));
  body.add(ring);
  const nozzle = G.xf(G.cyl(0.055, 0.042, 0.018, 24), [0, -R0 * 0.9, 0]); paint(nozzle, () => 0xd8dedb);
  const nozzleMesh = new THREE.Mesh(nozzle, shellMat()); body.add(nozzleMesh);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x4ff5ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.012, 0.14, 20, 1, true), coneMat);
  cone.position.y = -R0 - 0.07; cone.renderOrder = 3; body.add(cone);
  // --- floating stubby arms
  const arms = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const a = G.capY(0.022, 0, -0.05, 4, 12); paint(a, () => 0x8fe3cf);
    const h = G.xf(G.sphere(0.026, 14, 10), [0, -0.062, 0]); paint(h, () => 0xf4f6f4);
    const m = new THREE.Mesh(mergeGeometries([a, h]), shellMat()); m.castShadow = true;
    g.add(m); g.position.set(s * (R0 + 0.045), -0.01, 0); g.rotation.z = s * 0.35;
    body.add(g); arms.push(g);
  }

  const P = new Pix();
  let seed = 12345;
  const st = {
    t: 0, expr: 'happy', talking: false, talkOpen: 0, blink: 0, blinkT: 2, glitch: 0, dirty: true, frameT: 0, prevKey: '',
    rnd: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; },
  };
  function redraw() {
    drawFace(P, st.expr, st);
    paintScreen(tex, P, FACE_COL[st.expr] || FACE_COL.neutral);
  }
  function setFace(expr) {
    if (!FACE_COL[expr]) expr = 'neutral';
    if (expr !== st.expr) { st.expr = expr; st.glitch = 0.6; st.dirty = true; }
  }
  function setTalking(v) { st.talking = !!v; st.dirty = true; }
  function update(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    const t = st.t, dead = st.expr === 'dead', sleepy = st.expr === 'sleepy';
    // hover bob + tilt
    const amp = dead ? 0.004 : sleepy ? 0.01 : 0.018;
    body.position.y = Math.sin(t * 2.1) * amp + (dead ? -0.03 : 0);
    body.rotation.z = Math.sin(t * 1.3) * 0.06 + (dead ? 0.35 : 0);
    body.rotation.x = Math.sin(t * 1.7 + 1) * 0.04 + (sleepy ? 0.18 : 0) + (st.expr === 'alarmed' ? Math.sin(t * 40) * 0.02 : 0);
    // arms float out of phase
    arms.forEach((a, i) => {
      const s = i ? 1 : -1;
      a.position.y = -0.01 + Math.sin(t * 2.6 + i * 1.9) * 0.012 + (st.expr === 'happy' || st.expr === 'love' ? Math.max(0, Math.sin(t * 5 + i * PI)) * 0.02 : 0);
      a.rotation.z = s * (0.35 + Math.sin(t * 1.9 + i) * 0.12) + (st.expr === 'alarmed' ? s * 0.8 : 0) + (dead ? s * -0.3 : 0);
      a.rotation.x = Math.sin(t * 1.4 + i * 2) * 0.15;
    });
    // antenna blink + thruster flicker
    const on = dead ? 0 : (Math.floor(t * 1.5) % 2 === 0 ? 1 : 0.15);
    tipMat.emissiveIntensity = 2.5 * on;
    tipMat.emissive.setHex(st.expr === 'happy' || st.expr === 'love' ? 0x40ff70 : 0xff3030);
    ring.material.emissiveIntensity = dead ? 0.2 : 1.8 + Math.sin(t * 31) * 0.25;
    coneMat.opacity = dead ? 0.02 : 0.14 + Math.sin(t * 23) * 0.03;
    // face animation: blink, talking, glitch decay; redraw at most ~15 fps when changed
    st.blinkT -= dt;
    if (st.blinkT <= 0 && !dead) { st.blink = 0.13; st.blinkT = 2 + st.rnd() * 3.5; }
    if (st.blink > 0) st.blink -= dt;
    if (st.talking) st.talkOpen = 0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 7.3);
    else st.talkOpen = damp(st.talkOpen, 0, 20, dt);
    st.glitch = Math.max(0, st.glitch - dt * 2.5);
    const animated = st.expr === 'glitch' || st.expr === 'sleepy' || st.expr === 'love' || st.expr === 'alarmed';
    const key = `${st.expr}|${st.blink > 0}|${st.talking ? Math.round(st.talkOpen * 4) : -1}|${st.glitch > 0.02 ? Math.floor(t * 15) : 0}|${animated ? Math.floor(t * 10) : 0}`;
    if (key !== st.prevKey || st.dirty) { st.prevKey = key; st.dirty = false; redraw(); }
  }
  setFace('happy');
  update(0);
  return { root, setFace, setTalking, update, screen: scr };
}
