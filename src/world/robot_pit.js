// The robot pit under the HQ waiting room (EXIT on the elevator panel): a rusted furnace shaft lined with
// catwalk rings, a colossal dead robot face in the wall, a slag bowl heaped with junked robots and a pool
// of molten metal at the bottom. Rendered through engine.setView (own scene, own lights) while the lobby
// world keeps running behind it. The clone falls ~34 m, lands in the melt, burns (fire, embers, screams,
// the image melts to white heat) and the shift ends: game.finishExit() returns everyone to the menu.
// The scene is built once per session (preparePit) and reused.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';
import { FX } from '../gfx/particles.js';
import { GBin, T } from '../entities/elevator.js';

const PI = Math.PI, TAU = PI * 2;
const TOP = 34, R = 10, POOL = 4.4, GRAV = 13;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), ZA = new THREE.Vector3(0, 0, 1), _eu = new THREE.Euler(0, 0, 0, 'YXZ');
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const bowlY = (r) => (r <= POOL ? -0.2 : 4.2 * ((r - POOL) / (R - POOL)) ** 1.4);

function plateTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d'), r = rng(9);
  x.fillStyle = '#5a4434'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const g = 30 + r() * 30;
    x.fillStyle = `rgb(${70 + g},${50 + g * 0.6},${36 + g * 0.3})`; x.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
    x.fillStyle = '#2a1d14';
    for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(i * 128 + 10 + k * 21, j * 128 + 10, 3, 0, TAU); x.fill(); x.beginPath(); x.arc(i * 128 + 10 + k * 21, j * 128 + 118, 3, 0, TAU); x.fill(); }
  }
  for (let k = 0; k < 140; k++) {
    x.strokeStyle = `rgba(${r() < 0.5 ? '120,52,20' : '20,12,8'},${0.1 + r() * 0.25})`; x.lineWidth = 2 + r() * 8;
    const px = r() * 512, py = r() * 512; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 10, py + 30 + r() * 120); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 7); t.anisotropy = 8;
  return t;
}
function glowTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,240,210,1)'); g.addColorStop(0.3, 'rgba(255,200,140,0.35)'); g.addColorStop(1, 'rgba(255,180,120,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MELT_VS = `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MELT_FS = `varying vec2 vP; uniform float uT;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec2 p = vP * 0.55; float t = uT * 0.12;
  float f = fbm(p + vec2(t, -t * 0.7) + fbm(p * 1.7 - t) * 1.4);
  float crust = smoothstep(0.5, 0.66, f);
  float crack = smoothstep(0.44, 0.5, f) * (1.0 - smoothstep(0.5, 0.58, f));
  vec3 hot = vec3(5.0, 1.7, 0.32) * (0.8 + 0.4 * n(p * 3.0 + uT));
  vec3 c = mix(hot, vec3(0.06, 0.014, 0.004), crust) + vec3(6.0, 2.6, 0.6) * crack;
  gl_FragColor = vec4(c, 1.0);
}`;

let PIT = null;
class PitScene {
  constructor() {
    const S = (this.scene = new THREE.Scene());
    S.name = 'RobotPit';
    S.background = new THREE.Color(0x070201);
    S.fog = new THREE.FogExp2(0x2a0c04, 0.02);
    S.environment = engine.defaultEnv || null;
    S.environmentIntensity = 0.06;
    this.cam = new THREE.PerspectiveCamera(80, innerWidth / Math.max(1, innerHeight), 0.05, 200);
    this.cam.rotation.order = 'YXZ';
    S.add(this.cam);
    const r = rng(77);
    // shaft wall + catwalk rings + pipes
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TOP + 14, 48, 1, true), new THREE.MeshStandardMaterial({ map: plateTex(), roughness: 0.72, metalness: 0.55, side: THREE.BackSide }));
    wall.position.y = (TOP + 14) / 2 - 2;
    S.add(wall);
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.6, metalness: 0.7, vertexColors: true });
    const glowM = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const b = new GBin(), hot = new GBin(), glow = new GBin();
    for (const y of [7, 13.5, 20, 27]) {
      b.add(new THREE.RingGeometry(R - 1.5, R, 56, 1).rotateX(-PI / 2), 0x4a4440, T(0, y, 0));
      b.add(new THREE.TorusGeometry(R - 1.5, 0.04, 6, 64).rotateX(PI / 2), 0x6a625a, T(0, y + 1.05, 0));
      for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; b.cyl(0.03, 0.03, 1.05, 0x5a5450, T(Math.sin(a) * (R - 1.5), y + 0.52, Math.cos(a) * (R - 1.5)), { seg: 5 }); }
      // a dangling broken section
      b.box(1.6, 0.06, 1.2, 0x4a4440, T(Math.sin(y) * (R - 1.6), y - 0.7, Math.cos(y) * (R - 1.6), 0.9, y, 0.3));
    }
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU + 0.2; b.cyl(0.22, 0.22, TOP + 12, k % 3 ? 0x5c4a3a : 0x3e4a44, T(Math.sin(a) * (R - 0.35), (TOP + 12) / 2 - 2, Math.cos(a) * (R - 0.35)), { seg: 10 }); }
    // the colossal robot face in the wall: it wakes up as you fall past
    const a0 = 2.4, hx = Math.sin(a0) * (R - 1.0), hz = Math.cos(a0) * (R - 1.0), hy = 15.5;
    const HM = T(hx, hy, hz, 0, a0 + PI, 0);
    const at = (x, y, z, rx = 0, ry = 0, rz = 0) => HM.clone().multiply(T(x, y, z, rx, ry, rz));
    b.box(6.4, 5.2, 3.2, 0x8a8270, at(0, 0, -0.6));
    b.box(6.8, 0.5, 3.4, 0x5a5448, at(0, 2.7, -0.6));
    for (const s of [-1, 1]) {
      b.cyl(0.95, 0.95, 0.5, 0x1a1816, at(s * 1.5, 0.7, 1.05, PI / 2, 0, 0), { seg: 24 });
      b.add(new THREE.TorusGeometry(0.98, 0.12, 8, 28), 0x3a3630, at(s * 1.5, 0.7, 1.32));
      glow.sphere(0.62, 0xff2a10, at(s * 1.5, 0.7, 1.18), { seg: 18, rings: 10 });
      b.box(0.3, 1.4, 0.4, 0x5a5448, at(s * 3.35, 0.2, 0.2));
    }
    for (let k = 0; k < 7; k++) b.box(3.6, 0.12, 0.3, 0x2a2622, at(0, -1.2 - k * 0.24, 1.05));
    b.box(4.2, 0.9, 2.6, 0x7a7262, at(0, -2.9, 0.4, 0.42, 0, 0.08)); // hanging jaw
    b.box(0.6, 0.6, 0.6, 0x2a2622, at(2.4, -1.6, 1.0)); b.cyl(0.05, 0.05, 2.2, 0x2a2622, at(-2.2, 3.6, -0.4, 0, 0, 0.3), { seg: 6 });
    // slag bowl + junked robots heaped on it, some sinking into the melt
    const prof = []; for (let i = 0; i <= 14; i++) { const rr = POOL - 0.3 + (i / 14) * (R - POOL + 0.3); prof.push(new THREE.Vector2(rr, bowlY(rr) - 0.25)); }
    b.add(new THREE.LatheGeometry(prof, 56), 0x2a2420, T(0, 0, 0));
    const PAL = [0xb8ab88, 0x6c6f70, 0x7a4a2a, 0xc8a040, 0xc8c8c0, 0x4a5a6a, 0x8a3a2a];
    for (let i = 0; i < 74; i++) {
      const rr = POOL - 0.2 + r() * (R - POOL - 0.5), a = r() * TAU;
      const inMelt = rr < POOL + 0.5;
      const bin = inMelt ? hot : b;
      const M = T(Math.sin(a) * rr, bowlY(rr) + (inMelt ? -0.2 : 0.15) + r() * 0.2, Math.cos(a) * rr, (r() - 0.5) * 2.4, r() * TAU, (r() - 0.5) * 2.4, 0.7 + r() * 0.8, 0.7 + r() * 0.8, 0.7 + r() * 0.8);
      const add = (bb, w, h, d, x, y, z, c) => bb.box(w, h, d, c, M.clone().multiply(T(x, y, z)));
      const col = PAL[Math.floor(r() * PAL.length)];
      const tw = 0.5 + r() * 0.4, th = 0.6 + r() * 0.5;
      add(bin, tw, th, 0.45 + r() * 0.2, 0, 0, 0, col);
      add(bin, 0.42, 0.36, 0.38, 0, th / 2 + 0.22, 0, PAL[(i + 2) % PAL.length]);
      add(b, 0.3, 0.2, 0.02, 0, th / 2 + 0.22, 0.2, 0x080808);
      if (r() < 0.6) glow.sphere(0.035, r() < 0.5 ? 0xff3010 : 0xffa020, M.clone().multiply(T(-0.07, th / 2 + 0.24, 0.215)), { seg: 6, rings: 4 });
      for (let k = 0; k < 1 + Math.floor(r() * 2); k++) bin.cyl(0.06, 0.05, 0.7, 0x5a5a5a, M.clone().multiply(T((k ? -1 : 1) * (tw / 2 + 0.07), -0.1, 0, r() * 1.5, 0, (k ? -1 : 1) * (0.4 + r()))), { seg: 6 });
    }
    // three huge robot arms clawing up out of the melt
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + 0.6, rr = 2.4 + k * 0.5, base = T(Math.sin(a) * rr, -0.4, Math.cos(a) * rr, 0.35 * Math.cos(a), a, 0.35 * Math.sin(a));
      hot.cyl(0.32, 0.4, 3.4, 0x5a524a, base.clone().multiply(T(0, 1.5, 0)), { seg: 10 });
      b.sphere(0.42, 0x3a3630, base.clone().multiply(T(0, 3.25, 0)), { seg: 12, rings: 8 });
      b.cyl(0.26, 0.3, 2.4, 0x6a6258, base.clone().multiply(T(0, 3.3, 0, 0.9, 0, 0)).multiply(T(0, 1.2, 0)), { seg: 10 });
      for (let f = 0; f < 3; f++) b.cyl(0.07, 0.04, 0.9, 0x2a2622, base.clone().multiply(T(0, 3.3, 0, 0.9, 0, 0)).multiply(T((f - 1) * 0.18, 2.6, 0, -0.7, 0, (f - 1) * 0.3)), { seg: 5 });
    }
    b.mesh(iron, S);
    const hotM = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.5, metalness: 0.5, vertexColors: true, emissive: 0xff5a10, emissiveIntensity: 0.9 });
    hot.mesh(hotM, S);
    this.eyes = glow.mesh(glowM, S);
    this.glowM = glowM;
    // the melt
    this.melt = new THREE.ShaderMaterial({ vertexShader: MELT_VS, fragmentShader: MELT_FS, uniforms: { uT: { value: 0 } } });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(POOL + 0.4, 64).rotateX(-PI / 2), this.melt);
    pool.position.y = -0.05;
    S.add(pool);
    // the trapdoor far above (the lit waiting room)
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.25).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9), fog: false }));
    hole.position.y = TOP + 9;
    S.add(hole);
    this.hole = hole;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5 }));
    halo.position.y = TOP + 8.9;
    S.add(halo);
    // lights: the melt (two flickering), a dim red wash up the walls
    this.l1 = new THREE.PointLight(0xff6a1c, 420, 0, 2); this.l1.position.set(0, 1.4, 0);
    this.l2 = new THREE.PointLight(0xff8a30, 140, 0, 2); this.l2.position.set(2.5, 2.5, -1.5);
    this.l3 = new THREE.PointLight(0xff2a10, 60, 0, 2); this.l3.position.set(0, 24, 0);
    this.l4 = new THREE.PointLight(0xffa060, 0, 9, 2); // close fill on the camera when burning
    S.add(this.l1, this.l2, this.l3, this.l4, new THREE.HemisphereLight(0x3a1206, 0x000000, 0.35));
    this.fx = new FX(S);
    this.fx.ambientDust = false;
    S.traverse((o) => { if (o.isMesh) o.userData.noProbe = true; });
  }
}

export function preparePit() {
  if (PIT) return PIT;
  try {
    PIT = new PitScene();
    try { Promise.resolve(engine.renderer.compileAsync(PIT.scene, PIT.cam)).catch(() => {}); } catch (e) { /* older drivers */ }
  } catch (e) { console.error('[pit] build failed', e); PIT = null; }
  return PIT;
}

const POST_KEYS = ['uTint', 'uSat', 'uVignette', 'uExposure', 'uFadeColor', 'uGlitch', 'uFade', 'uContrast', 'uGrain'];

export class RobotPit {
  constructor(game, o = {}) {
    this.game = game;
    this.S = preparePit();
    this.t = 0;
    this.yaw = o.yaw || 0;
    this.finished = false;
    this.proxies = [];
    this.loops = {};
    this.fired = new Set();
    this.imp = Math.sqrt((2 * (TOP + 1)) / GRAV);
  }
  start() {
    const S = this.S, g = this.game;
    if (!S) { this.finished = true; return; }
    const pp = engine.post.params;
    this.saved = {};
    for (const k of POST_KEYS) { const v = pp[k]?.value; if (v !== undefined) this.saved[k] = v.clone ? v.clone() : v; }
    pp.uFade.value = 0; pp.uGlitch.value = 0.2;
    pp.uTint.value.setRGB(1.08, 0.95, 0.88); pp.uVignette.value = 0.55; pp.uExposure.value = 1; pp.uSat.value = 1.1;
    S.fx.setPixelScale(innerHeight);
    engine.setView(S.scene, S.cam);
    const vm = engine.post?.vmPass; if (vm) vm.enabled = false;
    // the other clones fall with you
    let i = 0;
    for (const rp of g.remotes.values()) {
      if (!rp.avatar?.root || rp.dead) continue;
      const a = (i++ / 3) * TAU + 0.6;
      this.proxies.push({ rp, ox: Math.sin(a) * 1.4, oz: Math.cos(a) * 1.4, lag: 0.15 + Math.random() * 0.35, spin: (Math.random() - 0.5) * 6, scream: 0.25 + Math.random() * 1.2 });
    }
    this.loops.wind = audio.loop('wind_fall', { bus: 'sfx', volume: 1, fadeIn: 0.1 });
    this.loops.rumble = audio.loop('collapse', { bus: 'sfx', volume: 0.7, fadeIn: 0.5, params: { intensity: 0.9 } });
    audio.play('furnace_roar', { volume: 0.6 });
  }
  _once(k, t, fn) { if (this.t >= t && !this.fired.has(k)) { this.fired.add(k); fn(); } }

  update(dt) {
    const S = this.S;
    if (!S || this.finished) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t, imp = this.imp, pp = engine.post.params, cam = S.cam;
    const asp = innerWidth / Math.max(1, innerHeight);
    if (Math.abs(cam.aspect - asp) > 1e-3) { cam.aspect = asp; cam.updateProjectionMatrix(); }
    S.melt.uniforms.uT.value += dt;
    const fl = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 31) * 0.05 + (Math.random() - 0.5) * 0.1;
    S.l1.intensity = 420 * fl; S.l2.intensity = 140 * (1.7 - fl);
    // ---- camera: freefall, then lying in the melt looking up at the trapdoor
    const fall = t < imp;
    let y, x = 0.9 * (1 - sstep(0, imp, t)) + 0.25, z = 0.6 * (1 - sstep(0, imp, t)) + 0.15, pitch, roll, yaw;
    if (fall) {
      y = TOP + 2 - 0.5 * GRAV * t * t;
      pitch = -1.15 - 0.3 * sstep(0, imp, t); yaw = this.yaw + t * 0.9; roll = Math.sin(t * 2.3) * 0.35 + t * 0.4;
    } else {
      const u = t - imp;
      y = 0.95 - 0.5 * sstep(0, 1.4, u);
      pitch = -1.45 + 2.55 * sstep(0.05, 0.9, u) + Math.sin(u * 2.1) * 0.05; yaw = this.yaw + imp * 0.9 + u * 0.08; roll = imp * 0.4 + 0.5 * sstep(0, 0.8, u) + Math.sin(u * 3.3) * 0.04;
    }
    cam.position.set(x, y, z);
    _q.setFromEuler(_eu.set(pitch, yaw, roll, 'YXZ'));
    cam.quaternion.copy(_q);
    const fov = fall ? 80 + 14 * sstep(0, imp, t) : 74;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (audio.ready) audio.setListener(cam.position, cam.quaternion);
    // ---- script
    this._once('eyes', 1.1, () => { audio.play('robo_whir', { volume: 1, pitch: 0.45 }); audio.play('_boom', { volume: 0.6 }); juice.shake(0.25); });
    S.glowM.color.setScalar(t < 1.1 ? 0.08 : 0.4 + 1.6 * sstep(1.1, 1.5, t) * (0.85 + Math.random() * 0.15));
    if (fall) juice.shake(0.03);
    this._once('impact', imp, () => {
      juice.shake(1); juice.hitstop(170); juice.flash(0.75); juice.punch(0.1);
      audio.play('water_splash_big', { volume: 1, pitch: 0.55 });
      audio.play('crate_land', { volume: 1 });
      audio.play('weld_crackle', { volume: 1 });
      audio.play('clone_scream', { volume: 1, delay: 0.12 });
      audio.play('clone_scream', { volume: 0.9, delay: 1.5, pitch: 0.9 });
      this.loops.wind?.stop(0.2); delete this.loops.wind;
      S.fx.sparks(_v.set(x, 0.2, z), 80, UP, [1, 0.55, 0.15], 7);
      for (let k = 0; k < 60; k++) this._flame(x + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2, 1.6);
    });
    this._once('notice1', imp + 1.0, () => floatText.notice('CLONE RECYCLED.', { color: '#ffb070', duration: 3.5, size: 1.2 }));
    this._once('notice2', imp + 2.3, () => floatText.notice('THANK YOU FOR YOUR SERVICE.', { color: '#ffe0b0', duration: 3, size: 1.1 }));
    this._once('roar2', imp + 0.5, () => audio.play('furnace_roar', { volume: 0.9 }));
    this._once('roar3', imp + 3.2, () => audio.play('furnace_roar', { volume: 0.8, pitch: 0.9 }));
    // ---- fire: embers up the shaft always, flames around the camera once in the melt
    this.emT = (this.emT || 0) - dt;
    if (this.emT <= 0) {
      this.emT = 0.02;
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * TAU, rr = Math.random() * POOL;
        S.fx.add.add(_v.set(Math.sin(a) * rr, 0.3, Math.cos(a) * rr), _v2.set((Math.random() - 0.5) * 1.5, 3 + Math.random() * 6, (Math.random() - 0.5) * 1.5), 2 + Math.random() * 3, 0.07, 0.01, 3, 1.3, 0.3, 1, -0.6, 0.15);
        this._flame(Math.sin(a) * rr, Math.cos(a) * rr, 1);
      }
      if (!fall) for (let k = 0; k < 5; k++) {
        // flames licking up in front of the face
        _v.set((Math.random() - 0.5) * 1.6, -0.6 - Math.random() * 0.6, -0.4 - Math.random() * 1.0).applyQuaternion(cam.quaternion).add(cam.position);
        this._flame(_v.x, _v.z, 1.5, _v.y);
      }
    }
    S.fx.update(dt);
    // ---- the other clones
    for (const p of this.proxies) {
      const root = p.rp.avatar?.root;
      if (!root) continue;
      if (root.parent !== S.scene) S.scene.add(root);
      const tt = Math.max(0, t - p.lag);
      const py = tt < imp ? TOP + 2 - 0.5 * GRAV * tt * tt : -0.3 - Math.min(0.4, (tt - imp) * 0.2);
      root.position.set(x + p.ox * (tt < imp ? 1 : 1.4), Math.max(-0.6, py), z + p.oz * (tt < imp ? 1 : 1.4));
      if (tt < imp) root.rotation.set(tt * p.spin * 0.7, tt * p.spin, tt * 0.8);
      else root.rotation.set(-PI / 2 + 0.3, root.rotation.y, 0);
      root.visible = true;
      const hotK = tt < imp ? 0.4 + tt * 0.2 : 2.5 + Math.sin(t * 9 + p.ox) * 0.4;
      root.userData.probe?.setRGB(hotK * 1.2, hotK * 0.45, hotK * 0.12);
      if (!this.fired.has('s' + p.ox) && t > imp + p.scream) { this.fired.add('s' + p.ox); audio.play('clone_scream', { pos: root.position.clone(), volume: 0.9, pitch: 0.85 + Math.random() * 0.3 }); }
      if (tt > imp && Math.random() < dt * 30) this._flame(root.position.x + (Math.random() - 0.5) * 0.5, root.position.z + (Math.random() - 0.5) * 0.5, 1.4, -0.2);
    }
    // ---- burn: the image heats up, melts to white, goes black
    if (!fall) {
      const u = t - imp;
      S.l4.position.copy(cam.position).add(_v.set(0, -0.4, 0));
      S.l4.intensity = 18 * sstep(0, 0.3, u) * fl;
      const k = sstep(0, 2.5, u);
      pp.uTint.value.setRGB(1.08 + 0.7 * k, 0.95 - 0.2 * k, 0.88 - 0.45 * k);
      pp.uExposure.value = 1 + 0.8 * sstep(1.2, 3.6, u);
      pp.uVignette.value = 0.55 + 0.45 * k;
      pp.uSat.value = 1.1 + 0.3 * k;
      pp.uGlitch.value = 0.12 + 0.18 * Math.abs(Math.sin(u * 5)) * k;
      const melt = sstep(2.8, 4.4, u), black = sstep(4.6, 5.4, u);
      pp.uFadeColor.value.setRGB(1.0 * (1 - black), 0.62 * (1 - black), 0.32 * (1 - black));
      pp.uFade.value = Math.max(melt, black);
      if (u > 5.9) this.finished = true;
    }
  }

  _flame(x, z, k = 1, y = null) {
    const fx = this.S.fx;
    const yy = y ?? 0.05 + Math.random() * 0.2;
    const hot = Math.random();
    fx.add.add(_v.set(x, yy, z), _v2.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.8 * k, (Math.random() - 0.5) * 0.6), 0.45 + Math.random() * 0.6, (0.5 + Math.random() * 0.6) * k, 0.06, 3.2, 1.1 + hot * 0.8, 0.22 + hot * 0.2, 0.9, -1.8, 1.4);
  }

  dispose() {
    for (const L of Object.values(this.loops)) L?.stop?.(0.3);
    this.loops = {};
    for (const p of this.proxies) {
      const root = p.rp.avatar?.root;
      if (!root) continue;
      if (p.rp.world) p.rp.world.group.add(root); else root.removeFromParent();
    }
    this.proxies = [];
    if (this.S && engine.view?.scene === this.S.scene) engine.resetView();
    const pp = engine.post.params;
    for (const k in this.saved || {}) { const v = this.saved[k]; if (v?.isColor || v?.isVector3) pp[k].value.copy(v); else pp[k].value = v; }
    pp.uGlitch.value = 0; pp.uFade.value = 0; pp.uFadeColor.value.setRGB(0, 0, 0);
    const vm = engine.post?.vmPass; if (vm) vm.enabled = !engine.view;
  }
}
void _m; void ZA;
