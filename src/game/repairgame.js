// Repair minigame: the camera zooms first-person into the broken Healthity's opened chassis (a dedicated
// scene rendered through the post stack with engine.setView). A burnt 1979 logic board with loose coloured
// wires: drag each wire end onto the terminal of its colour (wrong colour = short circuit: sparks, buzz,
// the wire springs back), then hold on every joint to zap / solder it with the multitool (sparks + arc).
// When the last joint takes, the board powers up and onDone() fires.
//   Mouse: pointer-locked deltas drive a virtual cursor (LMB / RMB = grab / zap). Touch / unlocked mouse:
//   a full-screen capture layer maps the pointer onto the board. [Esc] / [G] / [Backspace] / LEAVE tag quit.
//   repair.open({ onDone, onCancel, title }), repair.close(), repair.update(dt), repair.active
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';

const BW = 0.38, BH = 0.25;             // board size (m)
const RING = 0.235;                     // chassis opening radius
const WIRES = [
  { col: '#d8382c', name: 'RED' }, { col: '#e9c02a', name: 'YELLOW' }, { col: '#2f6fd8', name: 'BLUE' }, { col: '#3aa856', name: 'GREEN' },
];
const ROWS = [0.072, 0.024, -0.024, -0.072];
const XL = -0.145, XR = 0.145;
const SNAP = 0.03, GRAB = 0.028, ZAP_TIME = 0.85;
const _v = new THREE.Vector3(), _ray = new THREE.Raycaster(), _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), _ndc = new THREE.Vector2();
const ease = (k) => 1 - (1 - k) ** 3;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- textures
function boardCanvas(rowOf, rnd) {
  const W = 1024, H = Math.round((W * BH) / BW), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const px = (m) => ((m + BW / 2) / BW) * W, py = (m) => ((BH / 2 - m) / BH) * H;
  x.fillStyle = '#173521'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '40,80,50' : '8,22,12'},0.35)`; x.fillRect(rnd() * W, rnd() * H, 2, 2); }
  // ground pour hatching
  x.strokeStyle = 'rgba(60,110,70,0.25)'; x.lineWidth = 2;
  for (let i = -H; i < W; i += 14) { x.beginPath(); x.moveTo(i, H); x.lineTo(i + H, 0); x.stroke(); }
  x.fillStyle = '#173521'; x.fillRect(px(-0.17), py(0.1), px(0.17) - px(-0.17), py(-0.1) - py(0.1));
  // traces: each wire's bus runs from its left post to the matching right post, burnt through in the middle
  const trace = (pts, w, col) => { x.strokeStyle = col; x.lineWidth = w; x.lineJoin = 'round'; x.lineCap = 'round'; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(px(a), py(b)) : x.moveTo(px(a), py(b)))); x.stroke(); };
  for (let i = 0; i < 4; i++) {
    const yl = ROWS[i], yr = ROWS[rowOf[i]];
    const mid = -0.01 + i * 0.012;
    const pts = [[XL, yl], [XL + 0.04, yl], [mid - 0.02, yl], [mid + 0.02, yr], [XR - 0.04, yr], [XR, yr]];
    trace(pts, 13, '#2e6a3c');
    trace(pts, 7, '#4f8f55');
  }
  // misc thin traces + vias
  for (let i = 0; i < 26; i++) {
    const a = [(rnd() - 0.5) * BW * 0.9, (rnd() < 0.5 ? 1 : -1) * (0.1 + rnd() * 0.015)];
    trace([a, [a[0] + (rnd() - 0.5) * 0.08, a[1]], [a[0] + (rnd() - 0.5) * 0.08, a[1] + (rnd() - 0.5) * 0.02]], 3, '#3f7f49');
  }
  for (let i = 0; i < 60; i++) { const vx = rnd() * W, vy = rnd() * H; x.fillStyle = '#b8a560'; x.beginPath(); x.arc(vx, vy, 4, 0, 7); x.fill(); x.fillStyle = '#0c1a10'; x.beginPath(); x.arc(vx, vy, 1.6, 0, 7); x.fill(); }
  // pads under the terminals
  for (let i = 0; i < 4; i++) for (const X of [XL, XR]) { x.fillStyle = '#c9b46a'; x.beginPath(); x.arc(px(X), py(ROWS[i]), 22, 0, 7); x.fill(); x.fillStyle = '#5b5130'; x.beginPath(); x.arc(px(X), py(ROWS[i]), 9, 0, 7); x.fill(); }
  // burnt patches: char, blistered mask, brown halo
  for (let i = 0; i < 4; i++) {
    const bx = px(-0.01 + i * 0.012 + (rnd() - 0.5) * 0.03), by = py((ROWS[i] + ROWS[rowOf[i]]) / 2), r = 30 + rnd() * 22;
    let g = x.createRadialGradient(bx, by, 0, bx, by, r * 1.9);
    g.addColorStop(0, 'rgba(70,45,15,0.9)'); g.addColorStop(0.5, 'rgba(80,60,20,0.45)'); g.addColorStop(1, 'rgba(80,60,20,0)');
    x.fillStyle = g; x.fillRect(bx - r * 2, by - r * 2, r * 4, r * 4);
    g = x.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0, '#050403'); g.addColorStop(0.7, '#14100a'); g.addColorStop(1, 'rgba(20,16,10,0)');
    x.fillStyle = g; x.beginPath();
    for (let a = 0; a < 6.3; a += 0.4) { const rr = r * (0.7 + rnd() * 0.4); x.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.8); }
    x.fill();
    for (let k = 0; k < 8; k++) { x.fillStyle = 'rgba(200,170,110,0.25)'; x.beginPath(); x.arc(bx + (rnd() - 0.5) * r * 1.6, by + (rnd() - 0.5) * r, 2 + rnd() * 4, 0, 7); x.fill(); }
  }
  // silkscreen
  x.fillStyle = 'rgba(235,235,220,0.85)'; x.font = 'bold 22px "Courier New", monospace'; x.textBaseline = 'middle';
  x.fillText('HEALTHITY MK-VII  MAIN LOGIC  REV.C', px(-0.17), py(0.112));
  x.font = '16px "Courier New", monospace';
  x.fillText('(C) 1979 R.O.O.M. MEDICAL DIV.   DO NOT SERVICE', px(-0.17), py(-0.113));
  x.fillText('IC1', px(-0.115), py(0.083)); x.fillText('C14', px(0.06), py(0.095)); x.fillText('R7', px(0.115), py(-0.095)); x.fillText('Q3', px(-0.06), py(-0.095));
  WIRES.forEach((w, i) => { x.fillStyle = w.col; x.fillRect(px(XL) - 52, py(ROWS[i]) - 8, 16, 16); x.fillRect(px(XR) + 36, py(ROWS[rowOf[i]]) - 8, 16, 16); });
  x.strokeStyle = 'rgba(235,235,220,0.7)'; x.lineWidth = 2; x.strokeRect(px(0.11), py(0.118), 70, 26);
  x.fillStyle = 'rgba(235,235,220,0.7)'; x.font = 'bold 14px monospace'; x.fillText('QC  OK', px(0.11) + 8, py(0.118) + 13);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function labelTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.userData.paint = (...a) => { const x = c.getContext('2d'); x.clearRect(0, 0, w, h); draw(x, w, h, ...a); t.needsUpdate = true; };
  return t;
}

// ---------------------------------------------------------------- the minigame
export class RepairGame {
  constructor(game) {
    this.game = game;
    this.active = false;
  }

  open(o = {}) {
    if (this.active) return;
    const g = this.game, l = g.local;
    if (l.terminal || l.dead) return;
    this.o = o;
    this.active = true;
    this.t = 0;
    this.done = 0;
    this.doneT = 0;
    this.shorts = 0;
    this.hint = 0;
    this.session = { kind: 'repair' };
    l.releaseGrab?.(false);
    l.terminal = this.session;
    g.ui?.setPrompt?.(null);
    this._build(o.seed ?? (Math.random() * 1e9) | 0);
    this.cursor = new THREE.Vector3(0.05, -0.06, 0);
    this.ptr = { down: false, x: 0, y: 0, abs: false };
    this.drag = null;
    this.zap = null;
    this.prevView = engine.view;
    engine.setView(this.scene, this.camera);
    juice.punch(0.12);
    audio.play('ui_boot', { volume: 0.35, bus: 'ui' });
    audio.play('spark', { volume: 0.6, bus: 'ui' });
    this._overlay(true);
    this.notes = [];
    this.notice = this._note('RECONNECT THE WIRES. DRAG EACH END TO THE POST OF ITS COLOUR.', { color: '#ffe7a8', speaker: 'REPAIR', duration: 6 });
  }

  close(ok = false) {
    if (!this.active) return;
    this.active = false;
    const l = this.game.local;
    if (l.terminal === this.session) l.terminal = null;
    this._overlay(false);
    if (engine.view?.scene === this.scene) { if (this.prevView && this.prevView.scene !== this.scene) engine.setView(this.prevView.scene, this.prevView.camera); else engine.resetView(); }
    for (const n of this.notes || []) n.close();
    this.notes = [];
    this._dispose();
    if (ok) this.o.onDone?.(); else this.o.onCancel?.();
  }

  _note(text, o) { const h = floatText.notice(text, { ...o, scene: this.scene }); this.notes.push(h); return h; }

  // ---------------------------------------------------------------- scene
  _build(seed) {
    const rnd = rng(seed);
    const sc = (this.scene = new THREE.Scene());
    sc.background = new THREE.Color(0x030302);
    sc.environment = engine.defaultEnv || null;
    sc.environmentIntensity = 0.25;
    const cam = (this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 5));
    sc.add(cam);
    this.disposables = [];
    const keep = (o) => { this.disposables.push(o); return o; };
    // lights: the clone's flashlight (warm spot from the camera side) + dim fill + a red glow from inside
    sc.add(new THREE.HemisphereLight(0x8a8f80, 0x15100a, 0.5));
    const spot = new THREE.SpotLight(0xfff0d0, 7, 3, 0.55, 0.5, 1.2);
    spot.position.set(0.12, 0.16, 0.7); spot.target.position.set(0, -0.02, 0); spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004;
    sc.add(spot, spot.target);
    this.spark = new THREE.PointLight(0x9fd0ff, 0, 0.6, 2); sc.add(this.spark);
    // right column: each colour's target post, shuffled
    const right = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [right[i], right[j]] = [right[j], right[i]]; }
    if (right.every((v, i) => v === i)) right.reverse();
    this.right = right; // right[row] = wire index whose post sits on that row
    // board
    this.rowOf = [0, 1, 2, 3].map((wi) => right.indexOf(wi)); // wire -> row of its target post
    const board = new THREE.Mesh(keep(new THREE.BoxGeometry(BW, BH, 0.004)), keep(new THREE.MeshStandardMaterial({ map: keep(boardCanvas(this.rowOf, rnd)), roughness: 0.55, metalness: 0.1 })));
    board.position.z = -0.002; board.receiveShadow = true; sc.add(board);
    // dark cavity behind
    const cav = new THREE.Mesh(keep(new THREE.CylinderGeometry(RING + 0.02, RING * 0.7, 0.12, 40, 1, true)), keep(new THREE.MeshStandardMaterial({ color: 0x0b0906, roughness: 0.9, side: THREE.BackSide })));
    cav.rotation.x = Math.PI / 2; cav.position.z = -0.06; sc.add(cav);
    // the yellowed shell around the opening, with screw holes, the removed panel hanging at the side
    const shellMat = keep(new THREE.MeshStandardMaterial({ color: 0xd2c194, roughness: 0.55 }));
    const prof = [[RING, 0.03], [RING + 0.008, 0.036], [RING + 0.03, 0.034], [RING + 0.12, 0.0], [RING + 0.22, -0.09]].map(([r, h]) => new THREE.Vector2(r, h));
    const shell = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 64)), shellMat);
    shell.rotation.x = Math.PI / 2; shell.receiveShadow = true; shell.castShadow = true; sc.add(shell);
    const metal = keep(new THREE.MeshStandardMaterial({ color: 0xb0aa9a, roughness: 0.35, metalness: 0.9 }));
    const screwGeo = keep(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2, s = new THREE.Mesh(screwGeo, metal);
      s.rotation.x = Math.PI / 2; s.position.set(Math.cos(a) * (RING + 0.018), Math.sin(a) * (RING + 0.018), 0.037); sc.add(s);
    }
    const panel = new THREE.Mesh(keep(new THREE.CylinderGeometry(RING + 0.012, RING + 0.012, 0.008, 40, 1, false, 0, Math.PI * 2)), shellMat);
    panel.rotation.set(Math.PI / 2, 0, 0); panel.position.set(-RING - 0.17, -0.05, -0.06); panel.rotateZ(0.6); panel.rotateX(-1.1); sc.add(panel);
    // components: DIP chips, caps (one burst), resistors, a coil
    const chip = keep(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45 }));
    const pin = keep(new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.3, metalness: 1 }));
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(keep(geo), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; sc.add(m); return m; };
    for (const [x, y, w] of [[-0.115, 0.095, 0.06], [-0.04, 0.095, 0.045], [0.12, 0.0, 0.04]]) {
      const vert = x > 0.1;
      add(new THREE.BoxGeometry(vert ? 0.014 : w, vert ? w : 0.014, 0.006), chip, x, y, 0.004);
      for (let k = 0; k < 6; k++) { const o = (k / 5 - 0.5) * (w - 0.008); if (vert) { add(new THREE.BoxGeometry(0.004, 0.0015, 0.002), pin, x - 0.009, y + o, 0.002); add(new THREE.BoxGeometry(0.004, 0.0015, 0.002), pin, x + 0.009, y + o, 0.002); } else { add(new THREE.BoxGeometry(0.0015, 0.004, 0.002), pin, x + o, y - 0.009, 0.002); add(new THREE.BoxGeometry(0.0015, 0.004, 0.002), pin, x + o, y + 0.009, 0.002); } }
    }
    const capMat = keep(new THREE.MeshStandardMaterial({ color: 0x1d3f7a, roughness: 0.4 })), capTop = keep(new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 0.9 }));
    for (const [x, y, r, burst] of [[0.03, 0.098, 0.009, false], [0.06, 0.1, 0.011, true], [0.085, -0.1, 0.008, false], [-0.09, -0.1, 0.01, false]]) {
      add(new THREE.CylinderGeometry(r, r, 0.024, 16), capMat, x, y, 0.012, Math.PI / 2);
      const top = add(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.002, 16), capTop, x, y, burst ? 0.027 : 0.0245, Math.PI / 2 + (burst ? 0.4 : 0));
      if (burst) { top.position.x += 0.003; add(new THREE.SphereGeometry(0.008, 10, 6), keep(new THREE.MeshStandardMaterial({ color: 0x4a3010, roughness: 0.2 })), x - 0.006, y - 0.004, 0.003).scale.set(1.4, 1, 0.3); }
    }
    const resMat = keep(new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.6 }));
    for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.016, 8), resMat, -0.05 + i * 0.022, -0.1, 0.004, 0, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.014, 0.006, 10, 20), keep(new THREE.MeshStandardMaterial({ color: 0xb06a30, roughness: 0.35, metalness: 0.8 })), 0.0, -0.1, 0.007);
    // status LEDs (light up green when the board works)
    this.leds = [];
    for (let i = 0; i < 4; i++) {
      const m = keep(new THREE.MeshStandardMaterial({ color: 0x220806, emissive: 0xff2010, emissiveIntensity: 0.0, roughness: 0.3 }));
      add(new THREE.SphereGeometry(0.0035, 10, 6), m, 0.155 - i * 0.012, 0.112, 0.003);
      this.leds.push(m);
    }
    // posts + wires
    const postGeo = keep(new THREE.CylinderGeometry(0.0055, 0.0065, 0.012, 6)), collarGeo = keep(new THREE.CylinderGeometry(0.0105, 0.0105, 0.004, 18));
    const brass = keep(new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.3, metalness: 1 }));
    this.wires = [];
    this.posts = [];
    const mkPost = (x, y, wi) => {
      const collar = add(collarGeo, keep(new THREE.MeshStandardMaterial({ color: WIRES[wi].col, roughness: 0.5 })), x, y, 0.002, Math.PI / 2);
      add(postGeo, brass, x, y, 0.008, Math.PI / 2);
      return collar;
    };
    for (let row = 0; row < 4; row++) this.posts.push({ x: XR, y: ROWS[row], wire: this.right[row], taken: -1, collar: mkPost(XR, ROWS[row], this.right[row]) });
    const ferruleGeo = keep(new THREE.CylinderGeometry(0.0035, 0.0035, 0.012, 10)), bootGeo = keep(new THREE.CylinderGeometry(0.0055, 0.0045, 0.014, 12));
    const blobGeo = keep(new THREE.SphereGeometry(0.0085, 14, 10)), solder = keep(new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.12, metalness: 1 }));
    const glowGeo = keep(new THREE.RingGeometry(0.012, 0.016, 32));
    WIRES.forEach((w, i) => {
      mkPost(XL, ROWS[i], i);
      const mat = keep(new THREE.MeshStandardMaterial({ color: w.col, roughness: 0.45, emissive: w.col, emissiveIntensity: 0 }));
      const tube = new THREE.Mesh(new THREE.BufferGeometry(), mat); tube.castShadow = true; sc.add(tube);
      const end = new THREE.Group(); sc.add(end);
      const boot = new THREE.Mesh(bootGeo, mat); boot.rotation.x = Math.PI / 2; boot.position.z = 0; end.add(boot);
      const fer = new THREE.Mesh(ferruleGeo, brass); fer.rotation.x = Math.PI / 2; fer.position.z = -0.011; end.add(fer);
      end.traverse((o) => { o.castShadow = true; });
      const blob = new THREE.Mesh(blobGeo, solder); blob.scale.set(1, 1, 0.55); blob.visible = false; sc.add(blob);
      const glow = new THREE.Mesh(glowGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))); glow.visible = false; sc.add(glow);
      // loose ends lie scattered in the middle of the board
      const rest = new THREE.Vector3(-0.065 + rnd() * 0.12, -0.085 + rnd() * 0.17, 0.006);
      this.wires.push({ i, mat, tube, end, blob, glow, rest, pos: rest.clone(), vel: new THREE.Vector3(), lift: 0, post: -1, solder: 0, soldered: false, dirty: true, hover: 0 });
    });
    // tool probe (follows the cursor), the zap arc, smoke wisps, sparks
    const probe = (this.probe = new THREE.Group());
    const handle = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.009, 0.011, 0.11, 12)), keep(new THREE.MeshStandardMaterial({ color: 0xd9a51e, roughness: 0.5 })));
    handle.position.y = 0.075; probe.add(handle);
    const band = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0115, 0.0115, 0.02, 12)), keep(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })));
    band.position.y = 0.05; probe.add(band);
    const tip = new THREE.Mesh(keep(new THREE.ConeGeometry(0.006, 0.03, 10)), keep(new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.3, metalness: 1 })));
    tip.rotation.x = Math.PI; tip.position.y = 0.025; probe.add(tip);
    probe.traverse((o) => { o.castShadow = true; });
    sc.add(probe);
    this.arc = new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(new Array(9).fill(0).map(() => new THREE.Vector3()))), keep(new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, toneMapped: false })));
    this.arc.frustumCulled = false; sc.add(this.arc);
    const N = 160;
    this.parts = { n: N, pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), col: new Float32Array(N * 3), i: 0 };
    const pg = keep(new THREE.BufferGeometry());
    pg.setAttribute('position', new THREE.BufferAttribute(this.parts.pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.parts.col, 3));
    this.points = new THREE.Points(pg, keep(new THREE.PointsMaterial({ size: 0.004, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.points.frustumCulled = false; sc.add(this.points);
    this.smoke = [];
    const smokeMat = keep(new THREE.MeshBasicMaterial({ color: 0x8a8578, transparent: true, opacity: 0, depthWrite: false }));
    const smokeGeo = keep(new THREE.PlaneGeometry(0.03, 0.03));
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(smokeGeo, smokeMat.clone()); keep(m.material); m.userData.t = rnd() * 3; sc.add(m); this.smoke.push(m); }
    // camera-attached tags: title / progress (top-left) and LEAVE (top-right)
    this.title = labelTex(512, 96, (x, w, h, txt, sub) => {
      x.fillStyle = 'rgba(8,10,8,0.62)'; x.beginPath(); x.roundRect(4, 4, w - 8, h - 8, 12); x.fill();
      x.strokeStyle = 'rgba(255,231,168,0.4)'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#ffe7a8'; x.font = 'bold 30px "Courier New", monospace'; x.textBaseline = 'middle'; x.fillText(txt, 22, 34);
      x.fillStyle = 'rgba(255,231,168,0.75)'; x.font = '22px "Courier New", monospace'; x.fillText(sub, 22, 68);
    });
    this.leaveTex = labelTex(256, 80, (x, w, h, hot) => {
      x.fillStyle = hot ? 'rgba(120,30,20,0.85)' : 'rgba(8,10,8,0.62)'; x.beginPath(); x.roundRect(4, 4, w - 8, h - 8, 12); x.fill();
      x.strokeStyle = 'rgba(255,140,110,0.6)'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#ffb59a'; x.font = 'bold 28px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(input.touch ? 'X  LEAVE' : 'X  LEAVE [G]', w / 2, h / 2 + 1);
    });
    keep(this.title); keep(this.leaveTex);
    this.titleMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 96 / 512)), keep(new THREE.MeshBasicMaterial({ map: this.title, transparent: true, depthTest: false, toneMapped: false })));
    this.leaveMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 80 / 256)), keep(new THREE.MeshBasicMaterial({ map: this.leaveTex, transparent: true, depthTest: false, toneMapped: false })));
    this.titleMesh.renderOrder = this.leaveMesh.renderOrder = 998;
    cam.add(this.titleMesh, this.leaveMesh);
    this._paintTitle();
    this.leaveTex.userData.paint(false);
    for (const w of this.wires) this._shapeWire(w);
  }

  _paintTitle() {
    const n = this.wires.filter((w) => w.soldered).length;
    const c = this.wires.filter((w) => w.post >= 0).length;
    this.title.userData.paint(this.o.title || 'HEALTHITY MK-VII // MAIN LOGIC', n >= 4 ? 'POWER RESTORED' : `WIRES ${c}/4   JOINTS ZAPPED ${n}/4`);
  }

  _dispose() {
    for (const o of this.disposables || []) o.dispose?.();
    for (const w of this.wires || []) w.tube.geometry.dispose();
    this.disposables = [];
    this.scene = null;
  }

  // ---------------------------------------------------------------- input
  _overlay(on) {
    if (on && !this.ov) {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:13;touch-action:none;cursor:none;';
      const set = (e) => { this.ptr.x = e.clientX; this.ptr.y = e.clientY; this.ptr.abs = true; };
      d.addEventListener('pointerdown', (e) => { e.preventDefault(); set(e); this.ptr.down = true; this.ptr.hit = true; d.setPointerCapture?.(e.pointerId); if (e.pointerType === 'touch') input.lastTouch = performance.now(); });
      d.addEventListener('pointermove', (e) => { set(e); });
      const up = (e) => { set(e); this.ptr.down = false; };
      d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
      d.addEventListener('contextmenu', (e) => e.preventDefault());
      document.body.appendChild(d);
      this.ov = d;
    }
    if (this.ov) this.ov.style.display = on ? 'block' : 'none';
    if (!on) { this.ptr && (this.ptr.down = false); }
  }

  _readPointer(dt) {
    const cam = this.camera, ui = this.game.ui;
    if (this.ov) this.ov.style.display = ui?.menuOpen ? 'none' : 'block';
    let down = false, hit = false;
    if (input.locked && !input.touch) {
      // virtual cursor from raw mouse deltas
      const k = 0.00042 * (input.sensitivity || 1);
      this.cursor.x += input.mouse.dx * k;
      this.cursor.y -= input.mouse.dy * k;
      down = input.mouseDown(0) || input.mouseDown(2);
      hit = input.mouseHit(0) || input.mouseHit(2);
      this.ptr.abs = false;
    } else if (this.ptr.abs) {
      _ndc.set((this.ptr.x / window.innerWidth) * 2 - 1, -(this.ptr.y / window.innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, cam);
      if (_ray.ray.intersectPlane(_plane, _v)) this.cursor.set(_v.x, _v.y, 0);
      down = this.ptr.down;
      hit = !!this.ptr.hit;
      this.ptr.hit = false;
    }
    this.cursor.x = THREE.MathUtils.clamp(this.cursor.x, -BW / 2 - 0.03, BW / 2 + 0.03);
    this.cursor.y = THREE.MathUtils.clamp(this.cursor.y, -BH / 2 - 0.02, BH / 2 + 0.02);
    void dt;
    return { down, hit };
  }

  // the LEAVE tag: camera-space top-right; hit test in NDC
  _leaveHot() {
    const cam = this.camera;
    _v.copy(this.cursor).project(cam);
    const r = this._leaveRect;
    return r && _v.x > r[0] && _v.x < r[2] && _v.y > r[1] && _v.y < r[3];
  }

  // ---------------------------------------------------------------- wires
  _shapeWire(w) {
    const a = new THREE.Vector3(XL, ROWS[w.i], 0.012), b = w.pos.clone();
    b.z += 0.006 + w.lift;
    const mid = a.clone().lerp(b, 0.5);
    const len = a.distanceTo(b);
    mid.z += 0.012 + len * 0.18 + w.lift * 0.5;
    const c1 = a.clone().lerp(mid, 0.5); c1.z = mid.z * 0.85 + 0.004;
    const c2 = b.clone().lerp(mid, 0.5); c2.z = mid.z * 0.8 + 0.004;
    const curve = new THREE.CatmullRomCurve3([a, c1, mid, c2, new THREE.Vector3(b.x, b.y, b.z + 0.01), b]);
    w.tube.geometry.dispose();
    w.tube.geometry = new THREE.TubeGeometry(curve, 28, 0.0027, 7);
    w.end.position.copy(b);
    // the boot points back along the wire, ferrule toward the post
    const dir = curve.getTangent(1);
    w.end.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    w.dirty = false;
  }

  _emit(p, n, speed, col = [1, 0.75, 0.35], up = 0.4) {
    const P = this.parts;
    for (let k = 0; k < n; k++) {
      const i = P.i = (P.i + 1) % P.n;
      P.pos[i * 3] = p.x; P.pos[i * 3 + 1] = p.y; P.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      P.vel[i * 3] = Math.cos(a) * s; P.vel[i * 3 + 1] = Math.sin(a) * s; P.vel[i * 3 + 2] = (0.2 + Math.random()) * s * up * 2;
      P.life[i] = 0.25 + Math.random() * 0.45;
      P.col[i * 3] = col[0] * 2.5; P.col[i * 3 + 1] = col[1] * 2.5; P.col[i * 3 + 2] = col[2] * 2.5;
    }
  }

  _short(w, post) {
    this.shorts++;
    _v.set(post.x, post.y, 0.016);
    this._emit(_v, 40, 0.5, [1, 0.6, 0.25]);
    this.spark.position.set(post.x, post.y, 0.04); this.spark.intensity = 5;
    audio.play('hl_short', { volume: 0.9, bus: 'ui' });
    juice.shake(0.35);
    juice.flash(0.18);
    this.flicker = 0.5;
    this._note(`SHORT CIRCUIT! ${WIRES[w.i].name} DOES NOT GO THERE.`, { color: '#ff8a6a', speaker: 'REPAIR', duration: 2.6 });
    w.vel.set((w.rest.x - w.pos.x) * 9, (w.rest.y - w.pos.y) * 9, 0);
    w.spring = 1;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.active) return;
    const g = this.game, l = g.local;
    if (l.dead || g.state !== 'playing' || !g.world || (l.terminal && l.terminal !== this.session) || this.o.abort?.()) { this.close(false); return; }
    this.t += dt;
    const cam = this.camera;
    // camera: dolly in from far ("zoom into first person"), then a tiny handheld sway
    const aspect = window.innerWidth / window.innerHeight;
    cam.aspect = aspect; cam.fov = 45; cam.updateProjectionMatrix(); // juice.punch scales fov every frame
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const fitD = Math.max((BH / 2 + 0.06) / th, (BW / 2 + 0.035) / (th * aspect));
    const k = ease(Math.min(1, this.t / 0.75));
    const d = fitD + (1 - k) * 0.9;
    cam.position.set(Math.sin(this.t * 0.6) * 0.003 + (1 - k) * 0.05, Math.sin(this.t * 0.8) * 0.002 - (1 - k) * 0.08, d);
    cam.lookAt(0, -0.004, 0);
    cam.rotation.z += (1 - k) * 0.12;
    // tags in camera space
    const zt = 0.3, hh = th * zt, hw = hh * aspect, sz = Math.min(0.14, hw * 0.9);
    this.titleMesh.scale.setScalar(sz * 1.4); this.titleMesh.position.set(-hw + sz * 0.72, hh - sz * 0.19, -zt);
    this.leaveMesh.scale.setScalar(sz * 0.62); this.leaveMesh.position.set(hw - sz * 0.33, hh - sz * 0.13, -zt);
    { const x0 = (hw - sz * 0.64) / hw, x1 = 1, y1 = 1, y0 = (hh - sz * 0.26) / hh; this._leaveRect = [x0, y0, x1, y1]; }
    if (this.done) { this._finish(dt); this._fx(dt); return; }
    const ui = g.ui;
    if (ui?.menuOpen) { this._fx(dt); return; }
    if (this.t > 0.3 && (input.hit('drop') || input.hit('Backspace') || input.hit('pause') || input.hit('interact'))) { this.close(false); return; }
    const { down, hit } = this._readPointer(dt);
    const cur = this.cursor;
    const hot = this._leaveHot();
    if (hot !== this._hotWas) { this._hotWas = hot; this.leaveTex.userData.paint(hot); }
    if (hit && hot) { this.close(false); return; }
    // hover: nearest wire end (not soldered) / connected joint
    let near = null, nd = GRAB;
    for (const w of this.wires) { if (w.soldered) continue; const dd = Math.hypot(w.pos.x - cur.x, w.pos.y - cur.y); if (dd < nd) { nd = dd; near = w; } }
    // grab / drag / drop
    // (a plugged-in end is always the right colour: pressing on it zaps instead of unplugging)
    if (hit && !this.drag && near && near.post < 0 && this.t > 0.4) {
      this.drag = near;
      audio.play('grab', { volume: 0.35, bus: 'ui' });
    }
    if (this.drag) {
      const w = this.drag;
      w.pos.x += (cur.x - w.pos.x) * Math.min(1, dt * 25);
      w.pos.y += (cur.y - w.pos.y) * Math.min(1, dt * 25);
      w.lift += (0.02 - w.lift) * Math.min(1, dt * 12);
      w.dirty = true;
      if (!down) {
        this.drag = null;
        let best = null, bd = SNAP;
        for (let pi = 0; pi < this.posts.length; pi++) { const p = this.posts[pi]; const dd = Math.hypot(p.x - w.pos.x, p.y - w.pos.y); if (dd < bd) { bd = dd; best = pi; } }
        if (best != null) {
          const p = this.posts[best];
          if (p.taken >= 0) { w.vel.set((w.rest.x - w.pos.x) * 6, (w.rest.y - w.pos.y) * 6, 0); w.spring = 1; audio.play('ui_error', { volume: 0.4, bus: 'ui' }); }
          else if (p.wire !== w.i) this._short(w, p);
          else {
            p.taken = w.i; w.post = best; w.pos.set(p.x, p.y, 0.006); w.lift = 0;
            audio.play('thunk', { volume: 0.45, bus: 'ui', pitch: 1.6 });
            this._emit(_v.set(p.x, p.y, 0.014), 6, 0.15, [1, 0.9, 0.6]);
            if (!this.hint) { this.hint = 1; this.notice?.close(); this.notice = this._note(input.touch ? 'GOOD. NOW HOLD YOUR FINGER ON THE JOINT TO ZAP IT.' : 'GOOD. NOW HOLD THE MOUSE BUTTON ON THE JOINT TO ZAP IT.', { color: '#ffe7a8', speaker: 'REPAIR', duration: 5 }); }
            this._paintTitle();
          }
        } else w.rest.copy(w.pos).setZ(0.006);
      }
    }
    // zap: hold on a connected, unsoldered joint
    let zapping = null;
    if (!this.drag && down && near && near.post >= 0 && !near.soldered) zapping = near;
    for (const w of this.wires) {
      if (w === zapping) {
        w.solder = Math.min(1, w.solder + dt / ZAP_TIME);
        this._zapT = (this._zapT || 0) - dt;
        if (this._zapT <= 0) { this._zapT = 0.13; audio.play('hl_zap', { volume: 0.55, bus: 'ui' }); }
        _v.set(w.pos.x, w.pos.y, 0.012);
        if (Math.random() < 0.7) this._emit(_v, 3, 0.35, [0.75, 0.9, 1]);
        this.spark.position.set(w.pos.x, w.pos.y, 0.03); this.spark.intensity = 2 + Math.random() * 3;
        if (w.solder >= 1) {
          w.soldered = true; w.blob.visible = true; w.blob.position.set(w.pos.x, w.pos.y, 0.007);
          this._emit(_v, 26, 0.45, [1, 0.85, 0.5]);
          audio.play('spark', { volume: 0.8, bus: 'ui' });
          audio.play('healthity_happy', { volume: 0.25, bus: 'ui', pitch: 0.7 });
          juice.shake(0.08);
          this.leds[this.wires.filter((x) => x.soldered).length - 1].emissiveIntensity = 0.6;
          this._paintTitle();
          if (this.wires.every((x) => x.soldered)) this._complete();
        }
      } else if (!w.soldered && w.solder > 0) w.solder = Math.max(0, w.solder - dt * 0.4);
    }
    this.zap = zapping;
    // springs / settling
    for (const w of this.wires) {
      if (w.spring > 0) {
        w.spring -= dt * 2.5;
        w.pos.x += w.vel.x * dt; w.pos.y += w.vel.y * dt; w.vel.multiplyScalar(Math.exp(-dt * 5));
        if (w.spring <= 0) w.pos.copy(w.rest);
        w.dirty = true;
      }
      if (w !== this.drag && w.lift > 0.0005) { w.lift *= Math.exp(-dt * 10); w.dirty = true; }
      const hv = w === near && !w.soldered ? 1 : 0;
      w.hover += (hv - w.hover) * Math.min(1, dt * 12);
      w.end.scale.setScalar(1 + w.hover * 0.25);
      w.mat.emissiveIntensity = w.soldered ? 0.35 + Math.sin(this.t * 6 + w.i) * 0.15 : w.hover * 0.25;
      // pulsing ring on joints that still need a zap
      const needs = w.post >= 0 && !w.soldered;
      w.glow.visible = needs;
      if (needs) { w.glow.position.set(w.pos.x, w.pos.y, 0.0175); w.glow.material.opacity = 0.45 + Math.sin(this.t * 7) * 0.3; const s = 1 + w.solder * 0.6; w.glow.scale.setScalar(s); w.glow.material.color.setRGB(1, 0.88 - w.solder * 0.4, 0.5 - w.solder * 0.4); }
      if (w.dirty) this._shapeWire(w);
    }
    this._fx(dt);
  }

  _fx(dt) {
    const cur = this.cursor;
    // probe: tip at the cursor (or at the dragged wire end), leaning toward the camera
    const p = this.drag ? this.drag.pos : cur;
    this.probe.position.set(p.x + 0.004, p.y - 0.004, 0.014 + (this.drag ? this.drag.lift : 0) + (this.zap ? Math.sin(this.t * 60) * 0.0008 : 0.004));
    this.probe.rotation.set(0.95, 0, -0.55);
    // zap arc
    const A = this.arc.geometry.attributes.position;
    if (this.zap) {
      const a = new THREE.Vector3(p.x + 0.004, p.y - 0.004, 0.016), b = new THREE.Vector3(this.zap.pos.x, this.zap.pos.y, 0.009);
      for (let i = 0; i < 9; i++) { const k = i / 8; _v.lerpVectors(a, b, k); if (i && i < 8) _v.add(new THREE.Vector3((Math.random() - 0.5) * 0.006, (Math.random() - 0.5) * 0.006, (Math.random() - 0.5) * 0.003)); A.setXYZ(i, _v.x, _v.y, _v.z); }
      A.needsUpdate = true;
      this.arc.material.opacity = 0.6 + Math.random() * 0.4;
    } else this.arc.material.opacity = 0;
    this.spark.intensity *= Math.exp(-dt * 14);
    // particles
    const P = this.parts;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) { P.pos[i * 3 + 2] = -10; continue; }
      P.life[i] -= dt;
      P.vel[i * 3 + 2] -= 0.9 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] = Math.max(0.002, P.pos[i * 3 + 2] + P.vel[i * 3 + 2] * dt);
      const f = Math.max(0, P.life[i] * 2);
      P.col[i * 3] *= 0.985; P.col[i * 3 + 1] *= 0.97; P.col[i * 3 + 2] *= 0.95;
      if (f <= 0) P.pos[i * 3 + 2] = -10;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    // smoke from the burns (until the wire over it is soldered)
    this.smoke.forEach((m, i) => {
      const w = this.wires[i % 4];
      m.userData.t += dt;
      const t = m.userData.t % 3;
      const on = !w.soldered;
      m.position.set(-0.01 + (i % 4) * 0.012 + Math.sin(t * 2 + i) * 0.01, (ROWS[i % 4] + ROWS[this.rowOf[i % 4]]) / 2 + t * 0.01, 0.01 + t * 0.06);
      m.quaternion.copy(this.camera.quaternion);
      m.scale.setScalar(0.6 + t * 0.9);
      m.material.opacity = on ? Math.sin((t / 3) * Math.PI) * 0.12 : 0;
    });
    // board flicker after a short
    if (this.flicker > 0) { this.flicker -= dt; for (const m of this.leds) m.emissiveIntensity = Math.random() < 0.5 ? 1.5 : 0; if (this.flicker <= 0) this.leds.forEach((m, i) => { m.emissiveIntensity = i < this.wires.filter((x) => x.soldered).length ? 0.6 : 0; }); }
  }

  _complete() {
    this.done = 1;
    this.doneT = 0;
    this.notice?.close();
    audio.play('hl_boot', { volume: 0.6, bus: 'ui' });
    juice.flash(0.5);
    juice.shake(0.2);
    for (const m of this.leds) { m.emissive.setHex(0x30ff60); m.emissiveIntensity = 2.2; }
    for (const w of this.wires) this._emit(_v.set(w.pos.x, w.pos.y, 0.012), 14, 0.4, [0.6, 1, 0.7]);
    this._note('POWER RESTORED.', { color: '#9dffd0', speaker: 'REPAIR', duration: 2.4, size: 1.3 });
    this._paintTitle();
  }
  _finish(dt) {
    this.doneT += dt;
    for (const w of this.wires) w.mat.emissiveIntensity = 0.6 + Math.sin(this.doneT * 18 + w.i * 1.7) * 0.4;
    if (this.doneT > 1.6) this.close(true);
  }
}
