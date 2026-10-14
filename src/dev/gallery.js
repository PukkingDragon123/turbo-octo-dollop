// Dev-only model gallery: renders a grid of models in a neutral studio so art can be judged
// (and screenshotted headlessly). Not part of the game build.
//   gallery.html?set=furniture|items|devices|avatar|stilllife|critters|clones|healthity|bacteria
//                &keys=a,b,c   (optional subset)   &from=0&n=12   &cols=4   &yaw=0.7&pitch=0.32
//                &zoom=1   &bg=studio|dark   &close=1 (tight framing)   &cos=<json cosmetics>
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as Tex from '../gfx/textures.js';
import { buildModel } from '../entities/catalog.js';

const P = new URLSearchParams(location.search);
const set = P.get('set') || 'furniture';
const cols = +(P.get('cols') || 4);
const yaw = +(P.get('yaw') ?? (set === 'avatar' || set === 'stilllife' || set === 'clones' ? Math.PI + 0.5 : 0.7)), pitch = +(P.get('pitch') ?? 0.32), zoom = +(P.get('zoom') || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = +(P.get('exposure') || 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

async function listModels() {
  const keysParam = P.get('keys');
  const pick = (all) => {
    let list = keysParam ? keysParam.split(',') : all;
    const from = +(P.get('from') || 0), n = +(P.get('n') || list.length);
    return list.slice(from, from + n);
  };
  if (set === 'furniture' || set === 'items' || set === 'devices') {
    const mod = set === 'furniture' ? await import('../entities/models_furniture.js') : set === 'items' ? await import('../entities/models_items.js') : await import('../entities/models_devices.js');
    if (mod.preloadItems) await mod.preloadItems();
    const reg = mod.FURNITURE || mod.ITEMS || mod.DEVICES;
    return pick(Object.keys(reg)).map((k) => ({ key: k, build: () => buildModel(k, { seed: 3 }).object }));
  }
  if (set === 'avatar') {
    const A = await import('../entities/avatar.js');
    const base = P.get('cos') ? JSON.parse(P.get('cos')) : A.DEFAULT_COSMETICS;
    const variants = keysParam ? keysParam.split(',') : ['default'];
    return variants.map((v) => ({
      key: v,
      build: () => {
        let cos = { ...base };
        if (v.includes('=')) for (const kv of v.split(/[;| ]/)) { const [a, b] = kv.split('='); if (b) cos[a] = b; }
        const av = new A.Avatar(cos);
        av.update?.(0.016, { speed: 0, grounded: true, expression: 'neutral' });
        return av.root;
      },
      update: null,
    }));
  }
  if (set === 'stilllife') {
    const S = await import('../entities/stilllife_model.js');
    return pick(S.STILL_LIFE_VARIANTS).map((v) => {
      const m = S.buildStillLife(v, 3);
      return { key: v, build: () => m.root, update: (dt, t) => m.update?.(dt, { t, state: P.get('state') || 'idle', speed: +(P.get('speed') || 0) }) };
    });
  }
  if (set === 'critters') {
    const C = await import('../entities/critter_models.js');
    const fish = C.FISH_KINDS || [];
    const list = [{ key: 'rat', m: C.buildRat(2) }, { key: 'cockroach', m: C.buildCockroach(2) }, ...fish.map((f) => ({ key: f, m: C.buildFish(f, 2) }))];
    return pick(list.map((x) => x.key)).map((k) => { const x = list.find((y) => y.key === k); return { key: k, build: () => x.m.root, update: (dt) => x.m.update?.(dt, { speed: 0 }) }; });
  }
  if (set === 'clones') {
    const C = await import('../entities/clone_models.js');
    const list = [1, 2, 3, 4].map((s) => ({ key: 'clone_stage' + s, m: C.buildUnfinishedClone(s, 2) }));
    list.push({ key: 'receptionist', m: C.buildReceptionist() });
    return list.map((x) => ({ key: x.key, build: () => x.m.root, update: (dt) => x.m.update?.(dt) }));
  }
  if (set === 'healthity') {
    const H = await import('../entities/healthity_model.js');
    return (H.HEALTHITY_FACES || ['happy']).slice(0, 8).map((f) => { const m = H.buildHealthity(); m.setFace?.(f); return { key: f, build: () => m.root, update: (dt) => m.update?.(dt) }; });
  }
  if (set === 'bacteria') {
    const B = await import('../entities/monsters/bacteria_body.js');
    const scene = new THREE.Scene();
    const body = new B.BacteriaBody(scene, { seed: 3 });
    return [{ key: 'bacteria', build: () => body.root || body.group || scene, update: (dt) => body.update?.(dt, {}) }];
  }
  return [];
}

function frame(obj, cam, aspect) {
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(0.05, size.length() / 2);
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * (P.get('close') ? 0.82 : 1.0) / zoom / Math.min(1, aspect);
  cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.near = dist / 50; cam.far = dist * 20;
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  return { c, r, box };
}

async function main() {
  await Tex.preload?.(() => {});
  const items = await listModels();
  const rows = Math.ceil(items.length / cols);
  const W = innerWidth, H = innerHeight;
  const cw = Math.floor(W / cols), ch = Math.floor(H / Math.max(1, rows));
  const cells = [];
  const labels = document.getElementById('labels');
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.environmentIntensity = +(P.get('envi') || 0.55);
    scene.background = new THREE.Color(P.get('bg') === 'dark' ? 0x0d0d10 : 0x3a3b40);
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.6);
    scene.add(key, fill, key.target);
    let obj;
    try { obj = it.build(); } catch (e) { console.error('build failed', it.key, e); obj = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xff00ff })); }
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(32, cw / ch, 0.01, 100);
    const f = frame(obj, cam, cw / ch);
    // floor + shadows
    const floor = new THREE.Mesh(new THREE.CircleGeometry(f.r * 4, 48), new THREE.MeshStandardMaterial({ color: 0x55565c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = f.box.min.y - 0.001;
    floor.receiveShadow = true;
    scene.add(floor);
    key.position.copy(f.c).add(new THREE.Vector3(f.r * 2.2, f.r * 3.2, f.r * 2.6));
    key.target.position.copy(f.c);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = sc.bottom = -f.r * 1.6; sc.right = sc.top = f.r * 1.6; sc.near = 0.01; sc.far = f.r * 12; sc.updateProjectionMatrix();
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01 * f.r;
    fill.position.copy(f.c).add(new THREE.Vector3(-f.r * 3, f.r * 1.2, -f.r * 1.5));
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const col = i % cols, row = Math.floor(i / cols);
    cells.push({ scene, cam, obj, it, x: col * cw, y: H - (row + 1) * ch, w: cw, h: ch });
    const lab = document.createElement('div');
    lab.textContent = it.key;
    lab.style.left = col * cw + 4 + 'px';
    lab.style.top = row * ch + 4 + 'px';
    labels.appendChild(lab);
  }
  let t = 0, frames = 0;
  const loop = () => {
    const dt = 1 / 30;
    t += dt;
    for (const c of cells) {
      c.it.update?.(dt, t);
      renderer.setViewport(c.x, c.y, c.w, c.h);
      renderer.setScissor(c.x, c.y, c.w, c.h);
      renderer.render(c.scene, c.cam);
    }
    frames++;
    if (frames === 3) window.__galleryDone = true;
    if (P.get('anim')) requestAnimationFrame(loop);
    else if (frames < 3) requestAnimationFrame(loop);
  };
  loop();
}
main().catch((e) => { console.error(e); window.__galleryDone = true; window.__galleryError = String(e); });
