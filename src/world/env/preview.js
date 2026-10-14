// Dev-only preview of the environment material set (not part of the game build).
//   /src/world/env/preview.html?mats=wallpaper,carpet&size=2&cols=4&light=0.6
// Each cell shows a size x size meter swatch (UVs in meters, exactly like the level geometry) lit by a
// grazing point light, so texture scale, relief and roughness can be judged.
import * as THREE from 'three';
import * as Mat from '../../gfx/materials.js';

const P = new URLSearchParams(location.search);
const names = (P.get('mats') || 'wallpaper,wallpaper_manila,carpet,ceiling,concrete,slab,cmu,office_carpet,linoleum,paint,panel,tile,lightpanel,trim,enamel,pipe_paint,insulation,galvanized').split(',');
const size = +(P.get('size') || 2);
const cols = +(P.get('cols') || 6);
const rows = Math.ceil(names.length / cols);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const t0 = performance.now();
const cw = innerWidth / cols, ch = innerHeight / rows;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
const amb = new THREE.HemisphereLight(0xfff4e0, 0x403828, 0.35);
scene.add(amb);
const pl = new THREE.PointLight(0xfff2dc, 6, 0, 2);
scene.add(pl);
const cam = new THREE.PerspectiveCamera(40, cw / ch, 0.01, 50);
const items = [];
for (let k = 0; k < names.length; k++) {
  const n = names[k];
  let m;
  try { m = Mat.get(n); } catch (e) { console.error(e); continue; }
  const geo = new THREE.PlaneGeometry(size, size);
  // UVs in meters (like the level geometry)
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
  if (m.vertexColors) {
    const c = new Float32Array(uv.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.visible = false;
  scene.add(mesh);
  const lab = document.createElement('div');
  lab.className = 'lab';
  lab.textContent = n;
  lab.style.left = `${(k % cols) * cw + 4}px`;
  lab.style.top = `${Math.floor(k / cols) * ch + 4}px`;
  document.body.appendChild(lab);
  items.push({ mesh, k });
}
const lightK = +(P.get('light') || 0.55);
function render() {
  for (const it of items) {
    const x = (it.k % cols) * cw, y = innerHeight - (Math.floor(it.k / cols) + 1) * ch;
    for (const o of items) o.mesh.visible = o === it;
    cam.position.set(0, 0, size * 1.38);
    cam.lookAt(0, 0, 0);
    pl.position.set(-size * lightK * 1.2, size * 0.45, size * 0.35);
    pl.intensity = 6 * Math.pow(size / 2, 2) * +(P.get('li') || 1);
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.render(scene, cam);
  }
}
render();
window.__previewMs = performance.now() - t0;
window.__galleryDone = true;
console.log('[env] preview ready in', Math.round(window.__previewMs), 'ms');
