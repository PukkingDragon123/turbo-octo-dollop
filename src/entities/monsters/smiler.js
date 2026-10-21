// THE SMILER — what you see of it: two pale slanted eyes and an impossibly wide grin of glowing teeth
// hanging at head height in the dark, in front of a smoky black silhouette that is mostly suggestion.
// The body is a sculpted, rigged figure (stilllife/smiler.js: gaunt, hunched, slick black skin), wrapped in a
// faint smoke aura; the face (additive, bloom-hot) rides on its head bone and turns to face the viewer. The grin widens with `intensity`, stretches when charging, and the whole
// thing glitches out when light hits it.
//   buildSmiler(seed) -> { root, update(dt, {state, intensity, attacking, frozen, speed}), dispose() }
import * as THREE from 'three';
import { engine } from '../../core/engine.js';
import { buildStillLife } from '../optional.js';

let _faceTex = null, _faceGeo = null, _bodyGeo = null;

function faceTexture() {
  if (_faceTex) return _faceTex;
  const W = 512, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  // eyes: slanted almonds, white-hot centre fading to cold cyan, pin pupils
  const eye = (cx, cy, s) => {
    c.save();
    c.translate(cx, cy);
    c.rotate(s * 0.28);
    c.shadowColor = 'rgba(180,230,255,0.9)';
    c.shadowBlur = 26;
    const g = c.createRadialGradient(0, 0, 4, 0, 0, 62);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#e8f6ff');
    g.addColorStop(1, '#7ab8d8');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-64, 0);
    c.quadraticCurveTo(-10, -30, 62, -6);
    c.quadraticCurveTo(8, 26, -64, 0);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(0,0,0,0.85)';
    c.beginPath(); c.ellipse(4, -2, 4, 11, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  };
  eye(152, 150, 1);
  eye(360, 150, -1);
  // grin: crescent from cheek to cheek, rows of narrow teeth, faint red gum glow along the lips
  const top = (x) => 300 + Math.pow((x - 256) / 200, 2) * -70;  // upper lip curve (x 56..456)
  const bot = (x) => 312 + (1 - Math.pow((x - 256) / 200, 2)) * 110 - Math.pow((x - 256) / 200, 2) * 70;
  c.save();
  c.shadowColor = 'rgba(255,90,70,0.8)';
  c.shadowBlur = 18;
  c.strokeStyle = 'rgba(255,120,100,0.55)';
  c.lineWidth = 5;
  c.beginPath();
  for (let x = 56; x <= 456; x += 4) (x === 56 ? c.moveTo(x, top(x)) : c.lineTo(x, top(x)));
  for (let x = 456; x >= 56; x -= 4) c.lineTo(x, bot(x));
  c.closePath();
  c.stroke();
  c.restore();
  c.save();
  c.shadowColor = 'rgba(255,250,230,0.95)';
  c.shadowBlur = 14;
  const tooth = (x, y0, len, w, dir) => {
    const g = c.createLinearGradient(0, y0, 0, y0 + len * dir);
    g.addColorStop(0, '#fffdf2');
    g.addColorStop(1, '#e8dcb8');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - w / 2, y0);
    c.quadraticCurveTo(x - w * 0.35, y0 + len * 0.7 * dir, x, y0 + len * dir);
    c.quadraticCurveTo(x + w * 0.35, y0 + len * 0.7 * dir, x + w / 2, y0);
    c.closePath();
    c.fill();
  };
  for (let i = 0; i < 26; i++) {
    const x = 66 + i * (380 / 25);
    const e = Math.abs(x - 256) / 200;
    tooth(x, top(x) - 2, 34 * (1 - e * 0.55) + (i % 3) * 3, 15 - e * 4, 1);
  }
  for (let i = 0; i < 24; i++) {
    const x = 74 + i * (364 / 23);
    const e = Math.abs(x - 256) / 200;
    tooth(x, bot(x) + 2, 30 * (1 - e * 0.6) + (i % 2) * 4, 15 - e * 4, -1);
  }
  c.restore();
  _faceTex = new THREE.CanvasTexture(cv);
  _faceTex.colorSpace = THREE.SRGBColorSpace;
  _faceTex.anisotropy = 4;
  return _faceTex;
}

const FACE_VS = /* glsl */`
  varying vec2 vUv;
  uniform float uOpen;
  uniform float uT;
  uniform float uGlitch;
  void main() {
    vUv = uv;
    vec3 p = position;
    // grin half stretches wider/taller as it opens; glitch tears rows sideways
    float mouth = smoothstep(0.55, 0.35, uv.y);
    p.x *= 1.0 + mouth * uOpen * 0.35;
    p.y -= mouth * uOpen * 0.08 * (0.55 - uv.y) * 4.0;
    p.x += uGlitch * 0.08 * sin(floor(uv.y * 14.0) * 12.9 + uT * 40.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FACE_FS = /* glsl */`
  uniform sampler2D map;
  uniform float uAlpha;
  uniform float uGlow;
  uniform float uOpen;
  uniform float uT;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // open the jaw: the lower lip and its teeth slide down within the mouth area
    float m = smoothstep(0.42, 0.3, uv.y);
    uv.y += m * uOpen * 0.07;
    vec4 t = texture2D(map, uv);
    float flick = 0.9 + 0.1 * sin(uT * 23.0) * sin(uT * 7.3);
    float a = t.a * uAlpha * flick;
    gl_FragColor = vec4(t.rgb * uGlow, a);
  }`;
const BODY_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BODY_FS = /* glsl */`
  uniform float uAlpha;
  uniform float uT;
  varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 p = vUv - vec2(0.5, 0.0);
    // head
    float head = 1.0 - smoothstep(0.0, 1.0, length((p - vec2(0.0, 0.77)) / vec2(0.2, 0.15)));
    // body: shoulders taper into smoke trailing to the floor
    float w = mix(0.06, 0.32, smoothstep(0.0, 0.62, vUv.y)) * (1.0 - smoothstep(0.62, 0.72, vUv.y) * 0.6);
    float wisp = n2(vec2(p.x * 6.0, vUv.y * 4.0 - uT * 0.6)) * 0.5 + n2(vec2(p.x * 13.0 + 3.0, vUv.y * 9.0 - uT * 1.3)) * 0.5;
    float body = (1.0 - smoothstep(w * 0.6, w * (1.1 + wisp * 0.5), abs(p.x))) * smoothstep(0.0, 0.45, vUv.y + wisp * 0.25) * step(vUv.y, 0.74);
    float a = max(head, body) * (0.55 + 0.45 * wisp) * uAlpha;
    gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 0.92));
  }`;

const _cam = new THREE.Vector3();
const _wp = new THREE.Vector3();

export function buildSmiler(seed = 1) {
  if (!_faceGeo) {
    _faceGeo = new THREE.PlaneGeometry(0.62, 0.62, 16, 16);
    // slight cylindrical curve so it reads as a face, not a card
    const p = _faceGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, -Math.pow(p.getX(i) / 0.31, 2) * 0.08);
    _faceGeo.userData.shared = true;
    _bodyGeo = new THREE.PlaneGeometry(1.25, 2.3);
    _bodyGeo.translate(0, 1.15, 0);
    _bodyGeo.userData.shared = true;
  }
  const root = new THREE.Group();
  root.name = 'Smiler';
  const fu = { map: { value: faceTexture() }, uAlpha: { value: 0 }, uGlow: { value: 2.2 }, uOpen: { value: 0 }, uT: { value: seed * 3.1 }, uGlitch: { value: 0 } };
  const face = new THREE.Mesh(_faceGeo, new THREE.ShaderMaterial({ uniforms: fu, vertexShader: FACE_VS, fragmentShader: FACE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  face.position.set(0, 1.62, 0);
  face.renderOrder = 6;
  const bu = { uAlpha: { value: 0 }, uT: { value: seed } };
  const body = new THREE.Mesh(_bodyGeo, new THREE.ShaderMaterial({ uniforms: bu, vertexShader: BODY_VS, fragmentShader: BODY_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  body.renderOrder = 5;
  const pivot = new THREE.Group(); // turns toward the viewer
  pivot.add(body, face);
  root.add(pivot);
  // the sculpted body (filled in when its template arrives from the background builder)
  const sl = buildStillLife('smiler', seed);
  root.add(sl.root);
  let headBone = null;
  const _hp = new THREE.Vector3();
  for (const m of [face, body]) { m.castShadow = false; m.receiveShadow = false; m.userData.noProbe = true; m.userData.noShadow = true; }
  let t = seed * 1.7, vis = 0, open = 0, glitch = 0, blinkT = 3;
  function update(dt, s = {}) {
    dt = Math.min(dt || 0, 0.1);
    t += dt;
    const st = s.state || 'lurk';
    const fleeing = st === 'flee' || st === 'flinch';
    const want = fleeing ? 0 : 1;
    vis += (want - vis) * Math.min(1, dt * (fleeing ? 3.5 : 0.8));
    const I = Math.max(0, Math.min(1, s.intensity ?? 0.2));
    open += ((st === 'charge' ? 1 : I * 0.85) - open) * Math.min(1, dt * (st === 'charge' ? 10 : 2));
    glitch = Math.max(fleeing ? 1 : st === 'charge' ? 0.25 : 0, glitch - dt * 2);
    blinkT -= dt;
    let blink = 1;
    if (blinkT < 0) { blink = 0.15; if (blinkT < -0.12) blinkT = 2 + Math.random() * 5; }
    // face the camera (yaw only) and bob in the air
    root.updateWorldMatrix(true, false);
    _wp.setFromMatrixPosition(root.matrixWorld);
    _cam.copy(engine.camera.position);
    const ang = Math.atan2(_cam.x - _wp.x, _cam.z - _wp.z);
    pivot.rotation.y = ang - root.rotation.y;
    const lunge = st === 'charge' ? 0.12 : 0;
    // body: animate, then sink / shudder away while light is on it
    sl.update(dt, { mode: st, speed: s.speed || 0, attacking: s.attacking || 0, frozen: !!s.frozen });
    sl.root.position.set(glitch > 0.3 ? (Math.random() - 0.5) * 0.08 * glitch : 0, -(1 - vis) * 1.3, 0);
    sl.root.visible = vis > 0.03;
    if (!headBone) headBone = sl.root.getObjectByName('head') || null;
    if (headBone) {
      headBone.updateWorldMatrix(true, false);
      pivot.updateMatrixWorld(true);
      pivot.worldToLocal(_hp.setFromMatrixPosition(headBone.matrixWorld));
      face.position.set(_hp.x, _hp.y + 0.03 + Math.sin(t * 1.3) * 0.01, _hp.z + 0.11 + lunge);
    } else {
      face.position.y = 1.62 + Math.sin(t * 1.3) * 0.03 - lunge * 0.3;
      face.position.z = lunge;
    }
    face.scale.set((1 + open * 0.06) * 0.78, (1 + open * 0.04) * 0.78, 1);
    fu.uT.value = t;
    fu.uOpen.value = open;
    fu.uGlitch.value = glitch;
    fu.uAlpha.value = vis * blink * (s.frozen ? 1 : 0.92);
    fu.uGlow.value = 1.6 + I * 1.8 + (st === 'charge' ? 1.5 : 0);
    bu.uT.value = t;
    bu.uAlpha.value = vis * 0.3; // a faint smoke aura around the body
  }
  function dispose() {
    sl.root.userData.dispose?.();
    face.material.dispose();
    body.material.dispose();
  }
  update(0, {});
  return { root, update, dispose, height: 1.9, radius: 0.24 };
}
