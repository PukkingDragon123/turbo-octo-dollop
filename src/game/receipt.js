// Healthity's mission receipts: a strip of thermal paper that extrudes from the printer slot in its "mouth",
// hangs there for a moment ([E] on Healthity tears it off), then tears and flutters to the floor where it can
// be picked up ([E]). Holding it opens a first-person "read the paper" view (viewmodel layer); [X] re-reads
// it later. The paper lists the current mission tasks with checkboxes that tick as tasks are done, the
// clone's vitals and a tip. Local to each player (every clone has their own Healthity).
//
//   missionTasks(game)        -> [{ text, done }]  (mission.tasks() or the Level 0 fallback)
//   drawReceipt(canvas, data) -> paints the paper; data = { no, tasks, vitals, tip, day, shift, level }
//   new Receipts(healthity): print(data), take(), read(), refresh(data), update(dt), hanging, held, reading
//   new PaperView(game): open(canvas, { width }), close(), update(dt), reading  (the same view for any note)
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Q } from '../physics/physics.js';

const RW = 576;               // canvas width (a 72 mm thermal head at 8 dots/mm)
const PW = 0.058;             // paper width in Healthity model units (the slot is 0.064 wide)
const NSEG = 28;
const PRINT_TIME = 2.4, HANG_TIME = 9;
const INK = '#23232b', PAPER = '#f2eee2';
const FONT = '"Jolly Lodger", Georgia, serif';

export function missionTasks(game) {
  const m = game.world?.level?.mission;
  let t = null;
  try { t = m?.tasks?.(); } catch (e) { t = null; }
  if (Array.isArray(t)) return t.map((x) => ({ text: String(x.text || '').toUpperCase(), done: !!x.done }));
  if (!m || game.isLobby || !('camp' in m)) return [];
  const stage = m.stage, credits = game.run?.credits || 0;
  return [
    { text: 'CONSTRUCT A BASE', done: !!(m.camp?.built || m.state?.built) },
    { text: 'GET FOOD', done: !!stage && stage !== 'camp' && stage !== 'survive' },
    { text: 'EARN $1,000', done: credits >= 1000 },
  ];
}

// ------------------------------------------------------------------ paper
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function wrapWords(c, text, maxW) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
export function drawReceipt(cv, d) {
  const c = cv.getContext('2d');
  const rnd = rng(d.no * 7919 + 13);
  const M = 30, IW = RW - M * 2;
  // layout pass (measure) then paint pass
  const run = (paint) => {
    let y = 34;
    const font = (px, bold = true) => { c.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`; };
    const ink = (a = 1) => { c.fillStyle = INK; c.globalAlpha = (0.8 + rnd() * 0.2) * a; };
    const text = (s, px, o = {}) => {
      font(px, o.bold !== false);
      const lines = wrapWords(c, s, IW - (o.indent || 0));
      for (const ln of lines) {
        if (paint) {
          if (o.invert) { c.globalAlpha = 0.95; c.fillStyle = INK; c.fillRect(M - 6, y - 4, IW + 12, px + 10); c.fillStyle = PAPER; c.globalAlpha = 1; } else ink(o.alpha);
          c.textBaseline = 'top'; c.textAlign = o.align || 'left';
          const x = o.align === 'center' ? RW / 2 : o.align === 'right' ? RW - M : M + (o.indent || 0);
          c.fillText(ln, x, y + (o.invert ? 2 : 0));
        }
        y += px + (o.lead ?? 8);
      }
      c.globalAlpha = 1;
    };
    const pair = (a, b, px = 24) => {
      font(px);
      if (paint) { ink(); c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(a, M, y); c.textAlign = 'right'; c.fillText(b, RW - M, y); c.globalAlpha = 1; }
      y += px + 8;
    };
    const sep = (ch = '-', gap = 10) => { y += gap * 0.5; font(22, false); if (paint) { ink(0.8); c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(ch.repeat(40), M, y); c.globalAlpha = 1; } y += 22 + gap * 0.5; };
    const bar = (label, v) => {
      font(23);
      const n = 12, k = Math.round(Math.max(0, Math.min(1, v)) * n);
      if (paint) {
        ink(); c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(label, M, y);
        for (let i = 0; i < n; i++) { const x = M + 200 + i * 19; if (i < k) c.fillRect(x, y + 3, 15, 18); else { c.strokeStyle = INK; c.lineWidth = 1.5; c.strokeRect(x + 0.5, y + 3.5, 14, 17); } }
        c.textAlign = 'right'; c.fillText(`${Math.round(v * 100)}%`, RW - M, y); c.globalAlpha = 1;
      }
      y += 31;
    };
    // header: a little CRT ball icon + inverted title
    if (paint) {
      ink(); c.beginPath(); c.arc(RW / 2, y + 30, 28, 0, Math.PI * 2); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
      c.beginPath(); c.arc(RW / 2, y + 30, 17, 0, Math.PI * 2); c.fill();
      c.fillStyle = PAPER; for (const s of [-1, 1]) { c.beginPath(); c.arc(RW / 2 + s * 7, y + 28, 4, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = INK; c.fillRect(RW / 2 - 14, y + 60, 28, 7); c.globalAlpha = 1;
    }
    y += 80;
    text('HEALTHITY MK-VII', 40, { align: 'center', invert: true, lead: 14 });
    text('MEDICAL  *  WELLNESS  *  COMPLIANCE', 18, { align: 'center', bold: false });
    text('R.O.O.M. RESEARCH OFFICE FOR OTHERWORLDLY MATTERS', 18, { align: 'center', bold: false });
    text('UNIT SN 07-1979-0042', 18, { align: 'center', bold: false });
    sep('=');
    pair(d.tasks.length ? 'MISSION ORDER' : 'CHECK-UP', `No.${String(d.no).padStart(4, '0')}`, 28);
    pair(`DAY ${d.day || 1}/7`, `SHIFT ${d.shift || '-----'}`);
    text(d.level || 'LEVEL 0', 20, { bold: false });
    text('DATE ??/??/1979   TIME 03:33', 20, { bold: false });
    sep('=');
    if (d.tasks.length) {
      text('TASKS', 30, { lead: 12 });
      for (const t of d.tasks) {
        font(28);
        const lines = wrapWords(c, t.text, IW - 56);
        if (paint) {
          ink(); c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(M + 2, y + 1, 30, 30);
          if (t.done) {
            c.lineWidth = 6; c.beginPath(); c.moveTo(M + 6, y + 15); c.lineTo(M + 15, y + 26); c.lineTo(M + 36, y - 6); c.stroke();
          }
          c.textBaseline = 'top'; c.textAlign = 'left';
          lines.forEach((ln, i) => {
            c.fillText(ln, M + 50, y + 2 + i * 36);
            if (t.done) { const w = c.measureText(ln).width; c.fillRect(M + 48, y + 17 + i * 36, w + 4, 3); }
          });
          c.globalAlpha = 1;
        }
        y += Math.max(1, lines.length) * 36 + 12;
      }
      const left = d.tasks.filter((t) => !t.done).length;
      text(left ? `${left} OF ${d.tasks.length} OUTSTANDING` : 'ALL TASKS COMPLETE. AWAIT ORDERS.', 20, { bold: false, lead: 6 });
    } else text('NO ACTIVE ORDERS. REPORT TO RECEPTION.', 24);
    sep('-');
    text('VITALS', 26, { lead: 10 });
    const v = d.vitals || {};
    bar('HEALTH', v.health ?? 1);
    bar('SANITY', v.sanity ?? 1);
    if (v.hunger != null) bar('HUNGER', v.hunger);
    if (v.thirst != null) bar('THIRST', v.thirst);
    if (v.battery != null) bar('TOOL BATT', v.battery);
    if (d.tip) { sep('-'); text('NOTE:', 22, { lead: 4 }); text(d.tip, 22, { bold: false, lead: 6 }); }
    sep('-');
    // barcode
    if (paint) {
      ink(); let x = M + 40;
      while (x < RW - M - 40) { const w = 2 + Math.floor(rnd() * 3) * 2; if (rnd() < 0.62) c.fillRect(x, y, w, 70); x += w + 2 + Math.floor(rnd() * 3); }
      c.globalAlpha = 1;
      font(16, false); ink(); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(`*07${String(d.no).padStart(4, '0')}1979*`, RW / 2, y + 76); c.globalAlpha = 1;
    }
    y += 104;
    text('THANK YOU FOR YOUR COMPLIANCE', 20, { align: 'center' });
    text('KEEP THIS RECEIPT.', 20, { align: 'center', bold: false });
    text('IT REMEMBERS YOU.', 14, { align: 'center', bold: false, alpha: 0.55 });
    return y + 40;
  };
  const H = Math.ceil(run(false));
  if (cv.height !== H || cv.width !== RW) { cv.width = RW; cv.height = H; }
  // paper with torn top / bottom edges, curled-edge shading, grain and print-head streaks
  c.clearRect(0, 0, RW, H);
  c.save();
  c.beginPath();
  c.moveTo(0, 10);
  for (let x = 0; x <= RW; x += 12) c.lineTo(x, 2 + rnd() * 12);
  c.lineTo(RW, H - 12);
  for (let x = RW; x >= 0; x -= 12) c.lineTo(x, H - 2 - rnd() * 12);
  c.closePath();
  c.fillStyle = PAPER; c.fill();
  c.clip();
  const g = c.createLinearGradient(0, 0, RW, 0);
  g.addColorStop(0, 'rgba(120,105,70,0.16)'); g.addColorStop(0.08, 'rgba(120,105,70,0)'); g.addColorStop(0.92, 'rgba(120,105,70,0)'); g.addColorStop(1, 'rgba(120,105,70,0.16)');
  c.fillStyle = g; c.fillRect(0, 0, RW, H);
  for (let i = 0; i < 900; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(120,110,90,0.12)'; c.fillRect(rnd() * RW, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
  for (let i = 0; i < 4; i++) { c.fillStyle = 'rgba(150,140,120,0.06)'; c.fillRect(rnd() * RW, 0, 1 + rnd() * 2, H); }
  run(true);
  // thermal dropouts in the print
  for (let i = 0; i < 260; i++) { c.fillStyle = 'rgba(242,238,226,0.75)'; c.fillRect(rnd() * RW, rnd() * H, 2 + rnd() * 3, 1 + rnd() * 2); }
  c.restore();
  return H;
}

// ------------------------------------------------------------------ the strip
function stripGeometry() {
  const g = new THREE.BufferGeometry();
  const n = (NSEG + 1) * 2;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const idx = [];
  for (let i = 0; i < NSEG; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  g.setIndex(idx);
  return g;
}
// shape the strip: `len` printed so far (model units) of total `L`; curl(s) -> bend angle at arc length s
function shapeStrip(g, len, L, curl, wave = 0, t = 0) {
  const P = g.attributes.position, U = g.attributes.uv;
  let y = 0, z = 0;
  for (let i = 0; i <= NSEG; i++) {
    const s = (i / NSEG) * len;
    if (i > 0) { const ds = len / NSEG, th = curl(s); y -= Math.sin(th) * ds; z += Math.cos(th) * ds; }
    const w = wave ? Math.sin(s * 70 - t * 3) * wave * (s / Math.max(1e-4, L)) : 0;
    for (let k = 0; k < 2; k++) {
      const x = (k ? 0.5 : -0.5) * PW;
      const j = i * 2 + k;
      P.setXYZ(j, x + w * 0.3, y, z + w);
      U.setXY(j, k, 1 - (len - s) / L);
    }
  }
  P.needsUpdate = true; U.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

export class Receipts {
  constructor(h) {
    this.h = h;
    this.game = h.game;
    this.state = 'none'; // printing | hanging | falling | floor | held
    this.canvas = document.createElement('canvas');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.front = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.82, metalness: 0, side: THREE.FrontSide, alphaTest: 0.5 });
    this.back = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9, metalness: 0, side: THREE.BackSide });
    this.geo = stripGeometry();
    this.obj = new THREE.Group();
    this.obj.add(new THREE.Mesh(this.geo, this.front), new THREE.Mesh(this.geo, this.back));
    this.obj.traverse((o) => { o.castShadow = false; o.frustumCulled = false; });
    this.data = null;
    this.t = 0;
    this.L = 0.1;
    this.reading = false;
  }

  get hanging() { return this.state === 'hanging' || this.state === 'printing'; }
  get held() { return this.state === 'held'; }

  // start printing a new receipt from Healthity's mouth
  print(data) {
    const bot = this.h.bot;
    if (!bot) return false;
    this._dropFloor();
    this.data = data;
    const H = drawReceipt(this.canvas, data);
    this.tex.dispose(); // canvas size may change: re-upload
    this.tex.needsUpdate = true;
    this.L = (PW * H) / RW;
    bot.mouth.add(this.obj);
    this.obj.position.set(0, 0, 0);
    this.obj.quaternion.identity();
    this.obj.scale.setScalar(1);
    this.state = 'printing';
    this.t = 0;
    this._curl = 0.35;
    shapeStrip(this.geo, 0.001, this.L, () => 0.2);
    audio.play('hl_print', { pos: bot.root.position, volume: 0.7 });
    return true;
  }

  // the receipt's tasks / vitals changed while the clone keeps it: re-ink it (checkboxes tick)
  refresh(data) {
    if (!this.data) return;
    this.data = { ...data, no: this.data.no };
    const h0 = this.canvas.height;
    drawReceipt(this.canvas, this.data);
    if (this.canvas.height !== h0) this.tex.dispose();
    this.tex.needsUpdate = true;
    if (this.readMesh) this._fitRead();
  }

  take() {
    if (this.state === 'printing' && this.t < PRINT_TIME * 0.8) return false;
    if (!['printing', 'hanging', 'floor', 'falling'].includes(this.state)) return false;
    if (this.state === 'printing' || this.state === 'hanging') audio.play('hl_tear', { pos: this.h.pos, volume: 0.8 });
    audio.play('paper', { volume: 0.6, bus: 'ui' });
    this._dropFloor();
    this.obj.removeFromParent();
    this.state = 'held';
    this.h.onReceiptTaken?.();
    this.read();
    return true;
  }

  // ---------------------------------------------------------------- first-person reading view
  read() {
    if (!this.data || this.reading) return;
    const l = this.game.local;
    if (l.terminal) return;
    this.reading = true;
    this.readT = 0;
    this.session = { kind: 'receipt' };
    l.releaseGrab?.(false);
    l.terminal = this.session;
    this.game.ui?.setPrompt?.(null);
    if (!this.readGroup) {
      this.readGroup = new THREE.Group();
      const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
      back.position.z = -0.9; back.renderOrder = 50;
      this.readBack = back;
      const mat = new THREE.MeshBasicMaterial({ map: this.tex, alphaTest: 0.5, toneMapped: false, side: THREE.DoubleSide });
      mat.color.setRGB(1.2, 1.18, 1.12); // held up to the light: paper reads bright through the grade
      this.readMat = mat;
      this.readMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 12), mat);
      this.readMesh.renderOrder = 51;
      this.readGroup.add(back, this.readMesh);
      this.readGroup.traverse((o) => { o.frustumCulled = false; });
    }
    this.readMat.map = this.tex; this.readMat.needsUpdate = true;
    this._fitRead();
    engine.vmCamera.add(this.readGroup);
    audio.play('paper', { volume: 0.7, bus: 'ui' });
    // a tap anywhere puts it away (touch); keys / clicks are polled in update
    this._tap = (e) => { if (this.readT > 0.3 && !this.game.ui?.menuOpen) { e.preventDefault?.(); this.closeRead(); } };
    window.addEventListener('pointerdown', this._tap, true);
  }
  _fitRead() {
    const W = 0.08, H = W * (this.canvas.height / RW);
    const g = this.readMesh.geometry, P = g.attributes.position;
    // a gentle curl across the width and along the length (thermal paper never lies flat)
    const base = this._readBase || (this._readBase = Float32Array.from(P.array));
    for (let i = 0; i < P.count; i++) {
      const x = base[i * 3] * W, y = base[i * 3 + 1] * H;
      P.setXYZ(i, x, y, -((x / W) ** 2) * 0.012 - Math.sin((y / H + 0.5) * Math.PI) * 0.004);
    }
    P.needsUpdate = true;
    g.computeBoundingSphere();
    this.readH = H;
  }
  closeRead() {
    if (!this.reading) return;
    this.reading = false;
    this.closingT = 0;
    this.closedAt = performance.now();
    window.removeEventListener('pointerdown', this._tap, true);
    const l = this.game.local;
    if (l.terminal === this.session) l.terminal = null;
    audio.play('paper', { volume: 0.5, bus: 'ui', pitch: 1.2 });
  }

  _updateRead(dt) {
    const cam = engine.vmCamera;
    if (this.reading) {
      this.readT += dt;
      const l = this.game.local;
      const lost = l.dead || this.game.state !== 'playing' || !this.game.world || (l.terminal && l.terminal !== this.session);
      const keys = this.readT > 0.25 && !this.game.ui?.menuOpen && (input.hit('interact') || input.hit('healthity') || input.hit('pause') || input.hit('Backspace') || input.hit('Space') || input.hit('drop') || input.hit('watch') || input.mouseHit(0) || input.mouseHit(2));
      if (lost || keys) this.closeRead();
    }
    const g = this.readGroup;
    if (!g || !g.parent) return;
    const k = this.reading ? Math.min(1, this.readT / 0.35) : Math.max(0, 1 - (this.closingT = (this.closingT || 0) + dt) / 0.25);
    if (!this.reading && k <= 0) { g.removeFromParent(); return; }
    const e = 1 - (1 - k) ** 3;
    const fov = THREE.MathUtils.degToRad(cam.fov / 2), H = this.readH || 0.2;
    const dist = Math.max((H * 0.6) / Math.tan(fov), (0.08 * 0.62) / (Math.tan(fov) * cam.aspect));
    const t = this.readT || 0;
    this.readMesh.position.set(Math.sin(t * 0.7) * 0.002, -0.32 * (1 - e) + Math.sin(t * 1.1) * 0.0015, -dist);
    this.readMesh.rotation.set(-0.9 * (1 - e) - 0.04, Math.sin(t * 0.5) * 0.03, 0.04 * (1 - e) + Math.sin(t * 0.8) * 0.01);
    this.readBack.material.opacity = 0.55 * e;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    this._updateRead(dt);
    if (this.state === 'none' || this.state === 'held') return;
    this.t += dt;
    const bot = this.h.bot;
    if ((this.state === 'printing' || this.state === 'hanging') && !bot) { this.obj.removeFromParent(); this.state = 'none'; return; }
    if (this.state === 'printing') {
      const k = Math.min(1, this.t / PRINT_TIME);
      // line-by-line feed: the paper advances in little steps
      const len = this.L * (k + Math.sin(k * 90) * 0.004 * (1 - k));
      shapeStrip(this.geo, Math.max(0.001, len), this.L, (s) => 0.12 + 1.3 * (1 - Math.exp(-s / 0.03)), 0.004, this.t);
      bot.setPrinting?.(true);
      if (k >= 1) { this.state = 'hanging'; this.t = 0; bot.setPrinting?.(false); this.h.onReceiptPrinted?.(); }
    } else if (this.state === 'hanging') {
      shapeStrip(this.geo, this.L, this.L, (s) => 0.12 + 1.32 * (1 - Math.exp(-s / 0.03)) + Math.sin(this.t * 2.3 + s * 30) * 0.06, 0.003, this.t);
      if (this.t > HANG_TIME) this._tear();
    } else if (this.state === 'falling') {
      const f = this.fall;
      f.vy = Math.max(-0.7, f.vy - 2.2 * dt);
      const o = this.obj;
      o.position.x += (f.vx + Math.sin(this.t * 4.1) * 0.25) * dt;
      o.position.z += (f.vz + Math.cos(this.t * 3.3) * 0.25) * dt;
      o.position.y += f.vy * dt;
      o.quaternion.slerp(f.q, Math.min(1, dt * 2.2));
      o.rotateZ(Math.sin(this.t * 5) * dt * 0.6);
      const flat = Math.min(1, this.t / 1.2);
      shapeStrip(this.geo, this.L, this.L, (s) => (0.12 + 1.3 * (1 - Math.exp(-s / 0.03))) * (1 - flat) + Math.sin(s * 40) * 0.08 * flat, 0.002 * (1 - flat), this.t);
      if (o.position.y <= f.floor + 0.004) { o.position.y = f.floor + 0.004; this._land(); }
    }
  }

  // ---------------------------------------------------------------- tear off -> fall -> floor prop
  _tear() {
    const w = this.game.world;
    if (!w) return;
    audio.play('hl_tear', { pos: this.h.pos, volume: 0.7 });
    w.group.attach(this.obj);
    const p = this.obj.position;
    const hit = w.physics.raycast(p, new THREE.Vector3(0, -1, 0), 4, Q.world);
    const floor = hit ? p.y - hit.dist : (w.level?.floorY?.(p.x, p.z) ?? 0);
    // land face up, the strip lying along a random heading
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.random() * Math.PI * 2, 0, 'YXZ'));
    this.fall = { vy: 0.1, vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3, floor, q };
    this.state = 'falling';
    this.t = 0;
    this.h.onReceiptTorn?.();
  }
  _land() {
    const w = this.game.world;
    this.state = 'floor';
    this.obj.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(this.obj).getCenter(new THREE.Vector3());
    // a thin static box so the player's interaction ray finds it
    const self = this;
    this.pickDev = {
      prompt() { return `[${input.keyName('interact')}] Pick up receipt`; },
      interact() { self.take(); },
      interactHold() {}, holdTime: 0,
    };
    try { this.collider = w.physics.addStaticBox(c.x, c.y + 0.01, c.z, 0.07, 0.015, 0.07, { kind: 'device', device: this.pickDev }); this.colWorld = w; } catch (e) { this.collider = null; }
    audio.play('paper', { pos: c, volume: 0.35 });
  }
  _dropFloor() {
    if (this.collider && this.colWorld) { try { this.colWorld.physics.removeCollider(this.collider); } catch (e) { /* world gone */ } }
    this.collider = null;
    if (this.state === 'floor' || this.state === 'falling') { this.obj.removeFromParent(); this.state = 'none'; }
  }

  // world changed: the clone pockets whatever it printed (a receipt on the floor is not left behind)
  onWorldChange() {
    this.collider = null;
    if (this.state !== 'held') { this.obj.removeFromParent(); this.state = this.data ? 'held' : 'none'; }
    this.closeRead();
  }
}

// ------------------------------------------------------------------------------------------ paper view
// The same first-person "hold the paper up to the light" view for any canvas (notes taped to things):
//   const v = new PaperView(game); v.open(canvas, { width }); v.update(dt) every frame; v.reading
export class PaperView {
  constructor(game) { this.game = game; this.reading = false; this.group = null; }
  open(canvas, o = {}) {
    const l = this.game.local;
    if (this.reading || l.terminal) return;
    this.W = o.width || 0.09;
    this.H = this.W * (canvas.height / canvas.width);
    if (!this.group) {
      this.group = new THREE.Group();
      this.back = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
      this.back.position.z = -0.9; this.back.renderOrder = 50;
      this.mat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide, transparent: true });
      this.mat.color.setRGB(1.15, 1.13, 1.08);
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8), this.mat);
      this.mesh.renderOrder = 51;
      this.group.add(this.back, this.mesh);
      this.group.traverse((m) => { m.frustumCulled = false; });
    }
    if (this.canvas !== canvas) {
      this.tex?.dispose();
      this.tex = new THREE.CanvasTexture(canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
      this.mat.map = this.tex; this.mat.needsUpdate = true;
      this.canvas = canvas;
    }
    // a slight curl: pad paper never lies flat
    const P = this.mesh.geometry.attributes.position;
    const base = this._base || (this._base = Float32Array.from(P.array));
    for (let i = 0; i < P.count; i++) {
      const x = base[i * 3] * this.W, y = base[i * 3 + 1] * this.H;
      P.setXYZ(i, x, y, -((x / this.W) ** 2) * 0.01 - Math.sin((y / this.H + 0.5) * Math.PI) * 0.003);
    }
    P.needsUpdate = true;
    this.reading = true;
    this.t = 0; this.closeT = 0;
    this.session = { kind: 'paper' };
    l.releaseGrab?.(false);
    l.terminal = this.session;
    this.game.ui?.setPrompt?.(null);
    engine.vmCamera.add(this.group);
    this._tap = (e) => { if (this.t > 0.3 && !this.game.ui?.menuOpen) { e.preventDefault?.(); this.close(); } };
    window.addEventListener('pointerdown', this._tap, true);
  }
  close() {
    if (!this.reading) return;
    this.reading = false;
    this.closeT = 0;
    window.removeEventListener('pointerdown', this._tap, true);
    const l = this.game.local;
    if (l.terminal === this.session) l.terminal = null;
    audio.play('paper', { volume: 0.5, bus: 'ui', pitch: 1.2 });
  }
  update(dt) {
    const g = this.group;
    if (this.reading) {
      this.t += dt;
      const l = this.game.local;
      const lost = l.dead || this.game.state !== 'playing' || !this.game.world || (l.terminal && l.terminal !== this.session);
      const keys = this.t > 0.25 && !this.game.ui?.menuOpen && (input.hit('interact') || input.hit('pause') || input.hit('Backspace') || input.hit('Space') || input.hit('drop') || input.hit('watch') || input.mouseHit(0) || input.mouseHit(2));
      if (lost || keys) this.close();
    }
    if (!g || !g.parent) return;
    const k = this.reading ? Math.min(1, this.t / 0.35) : Math.max(0, 1 - (this.closeT += dt) / 0.25);
    if (!this.reading && k <= 0) { g.removeFromParent(); return; }
    const e = 1 - (1 - k) ** 3, cam = engine.vmCamera;
    const fov = THREE.MathUtils.degToRad(cam.fov / 2);
    const dist = Math.max((this.H * 0.62) / Math.tan(fov), (this.W * 0.62) / (Math.tan(fov) * cam.aspect));
    const t = this.t;
    this.mesh.position.set(Math.sin(t * 0.7) * 0.002, -0.3 * (1 - e) + Math.sin(t * 1.1) * 0.0015, -dist);
    this.mesh.rotation.set(-0.9 * (1 - e) - 0.04, Math.sin(t * 0.5) * 0.03, 0.04 * (1 - e) + Math.sin(t * 0.8) * 0.01 - 0.02);
    this.back.material.opacity = 0.55 * e;
  }
  dispose() { if (this.reading) this.close(); this.group?.removeFromParent(); this.tex?.dispose(); }
}
