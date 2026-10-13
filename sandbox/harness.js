// Sandbox harness: renders a module in a small lit test room with orbit controls.
// URL: /sandbox/?m=<moduleName>&cam=x,y,z&target=x,y,z
// The sandbox module exports default async function(ctx) and may return { update(dt,t) }.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import '@fontsource/vt323';
import '@fontsource/ibm-plex-mono';
import { engine } from '../src/core/engine.js';
import * as Mat from '../src/gfx/materials.js';
import * as Tex from '../src/gfx/textures.js';

const q = new URLSearchParams(location.search);
const modName = q.get('m') || 'materials';
await document.fonts.ready;
engine.init(document.body, q.get('q') || 'medium');
const { scene, camera, renderer } = engine;
camera.position.fromArray((q.get('cam') || '3,1.8,4').split(',').map(Number));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.fromArray((q.get('target') || '0,0.8,0').split(',').map(Number));
controls.update();

// test room: carpet floor, wallpaper walls, ceiling with light panels
const room = new THREE.Group();
scene.add(room);
const S = 14, H = 2.9;
function plane(w, h, mat, pos, rot) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  const m = new THREE.Mesh(g, mat);
  m.position.fromArray(pos);
  m.rotation.set(...rot);
  m.receiveShadow = true;
  room.add(m);
  return m;
}
if (q.get('room') !== '0') {
  plane(S, S, Mat.get('carpet'), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  plane(S, S, Mat.get('ceiling'), [0, H, 0], [Math.PI / 2, 0, 0]);
  plane(S, H, Mat.get('wallpaper'), [0, H / 2, -S / 2], [0, 0, 0]);
  plane(S, H, Mat.get('wallpaper'), [-S / 2, H / 2, 0], [0, Math.PI / 2, 0]);
  plane(S, H, Mat.get('wallpaper'), [S / 2, H / 2, 0], [0, -Math.PI / 2, 0]);
  plane(S, H, Mat.get('wallpaper'), [0, H / 2, S / 2], [0, Math.PI, 0]);
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 0]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.2), Mat.get('lightpanel'));
    p.position.set(x, H - 0.01, z);
    room.add(p);
    const l = new THREE.PointLight(0xfff1d0, 6, 12, 1.6);
    l.position.set(x, H - 0.3, z);
    room.add(l);
  }
}
const sun = new THREE.SpotLight(0xffffff, q.get('room') === '0' ? 30 : 8, 20, 0.7, 0.5, 1.5);
sun.position.set(2, 2.6, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xfff4d0, 0x4a3c20, 0.35));
scene.fog = new THREE.FogExp2(0x1a1606, 0.03);

const ctx = { THREE, scene, camera, renderer, engine, Mat, Tex, controls, room };
const mod = await import(`./${modName}.js`);
const api = (await mod.default(ctx)) || {};
const info = document.getElementById('info');
const clock = new THREE.Timer();
let frames = 0;
function loop() {
  clock.update(); const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  api.update?.(dt, engine.time);
  engine.render(dt);
  frames++;
  if (frames === 3) window.__ready = true;
  info.textContent = `${modName}  draw:${renderer.info.render.calls} tris:${renderer.info.render.triangles}`;
  requestAnimationFrame(loop);
}
loop();
