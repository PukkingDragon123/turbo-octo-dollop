// Dev-only furniture bench (not part of the game build):
//   ?mode=grid&keys=a,b&vars=all|0,1&cols=4&yaw=0.7&pitch=0.3&zoom=1&close=1&light=studio|game&info=1
//   ?mode=phys[&keys=...]   Rapier settle / drop test of every geometry variant -> window.__benchResult
//   ?mode=stats             warmFurniture timing + per-model tris / meshes -> window.__benchResult
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as F from '../../models_furniture.js';
import { DEFS, geoVariants, templateInfo } from '../core.js';

const P = new URLSearchParams(location.search);
const mode = P.get('mode') || 'grid';
const labels = document.getElementById('labels');
const done = (res) => { window.__benchResult = res; window.__galleryDone = true; };

async function grid() {
  const cols = +(P.get('cols') || 4);
  const yaw = +(P.get('yaw') ?? 0.7), pitch = +(P.get('pitch') ?? 0.32), zoom = +(P.get('zoom') || 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = +(P.get('exposure') || 1.0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setScissorTest(true);
  document.body.appendChild(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const game = P.get('light') === 'game';
  let applyProbe = null;
  if (game) ({ applyProbe } = await import('../../../gfx/bakedlight.js'));
  let keys = P.get('keys') ? P.get('keys').split(',') : Object.keys(F.FURNITURE);
  const from = +(P.get('from') || 0), n = +(P.get('n') || keys.length);
  keys = keys.slice(from, from + n);
  const items = [];
  for (let k of keys) {
    if (k.includes(':')) { const [kk, vv] = k.split(':'); items.push({ k: kk, v: +vv }); continue; }
    const nv = DEFS[k].variants || 1;
    const vs = P.get('vars') === 'all' ? [...Array(nv).keys()] : P.get('vars') ? P.get('vars').split(',').map(Number) : [P.get('v') ? +P.get('v') : 0];
    for (const v of vs) if (v < nv) items.push({ k, v });
  }
  const rows = Math.ceil(items.length / cols);
  const W = innerWidth, H = innerHeight, cw = Math.floor(W / cols), ch = Math.floor(H / Math.max(1, rows));
  const cells = [];
  for (let i = 0; i < items.length; i++) {
    const { k, v } = items[i];
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.environmentIntensity = game ? 0.3 : +(P.get('envi') || 0.55);
    scene.background = new THREE.Color(P.get('bg') === 'dark' || game ? 0x0d0d10 : 0x3a3b40);
    const key = new THREE.DirectionalLight(0xfff2e0, game ? 1.1 : 2.6);
    const fill = new THREE.DirectionalLight(0xc8d8ff, game ? 0.15 : 0.6);
    scene.add(key, fill, key.target);
    let obj, info = '';
    try {
      const t0 = performance.now();
      const m = F.buildFurniture(k, { variant: v, color: P.get('color') ? +P.get('color') : undefined });
      obj = m.object;
      const ti = templateInfo(k, v);
      info = `${k}/${v}  ${Math.round(ti.tris)}t ${ti.meshes}dc ${ti.buildMs.toFixed(0)}ms` + (P.get('slots') ? '\n' + ti.slots.join(' ') : '');
      if (P.get('cols_show')) {
        for (const c of m.colliders) {
          let g;
          if (c.type === 'box') g = new THREE.BoxGeometry(...c.size);
          else if (c.type === 'cylinder') g = new THREE.CylinderGeometry(c.radius, c.radius, c.height, 16);
          else if (c.type === 'ball') g = new THREE.SphereGeometry(c.radius, 12, 8);
          else g = new THREE.CapsuleGeometry(c.radius, c.halfHeight * 2, 4, 12);
          const me = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true }));
          me.position.fromArray(c.pos);
          if (c.rot) me.rotation.set(c.rot[0], c.rot[1], c.rot[2]);
          obj.add(me);
        }
      }
      obj.position.y = m.halfHeight;
      if (game) { applyProbe(obj); obj.userData.probe.setRGB(0.42, 0.4, 0.36); }
    } catch (e) {
      console.error('build failed', k, e);
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
      info = `${k} FAILED ${e.message}`;
    }
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(32, cw / ch, 0.01, 100);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(0.05, size.length() / 2);
    if (P.get('tx')) c.x += +P.get('tx') * r; if (P.get('ty')) c.y += +P.get('ty') * r;
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(16))) * (P.get('close') ? 0.82 : 1.0) / zoom / Math.min(1, cw / ch);
    cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.near = dist / 50; cam.far = dist * 20;
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(r * 4, 48), new THREE.MeshStandardMaterial({ color: game ? 0x6a6250 : 0x55565c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.0005;
    floor.receiveShadow = true;
    scene.add(floor);
    key.position.copy(c).add(new THREE.Vector3(r * 2.2, r * 3.2, r * 2.6));
    if (game) key.position.copy(c).add(new THREE.Vector3(r * 0.6, r * 4, r * 1.2));
    key.target.position.copy(c);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = sc.bottom = -r * 1.6; sc.right = sc.top = r * 1.6; sc.near = 0.01; sc.far = r * 12; sc.updateProjectionMatrix();
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01 * r;
    fill.position.copy(c).add(new THREE.Vector3(-r * 3, r * 1.2, -r * 1.5));
    const col = i % cols, row = Math.floor(i / cols);
    cells.push({ scene, cam, x: col * cw, y: H - (row + 1) * ch, w: cw, h: ch });
    if (P.get('info') !== '0') {
      const lab = document.createElement('div');
      lab.textContent = info;
      lab.style.left = col * cw + 4 + 'px';
      lab.style.top = row * ch + 4 + 'px';
      labels.appendChild(lab);
    }
  }
  let frames = 0;
  const loop = () => {
    for (const c of cells) {
      renderer.setViewport(c.x, c.y, c.w, c.h);
      renderer.setScissor(c.x, c.y, c.w, c.h);
      renderer.render(c.scene, c.cam);
    }
    frames++;
    if (frames === 3) done({ ok: true });
    else requestAnimationFrame(loop);
  };
  loop();
}

async function phys() {
  const { initPhysics, Physics } = await import('../../../physics/physics.js');
  await initPhysics();
  const keys = P.get('keys') ? P.get('keys').split(',') : Object.keys(F.FURNITURE);
  const out = [];
  for (const k of keys) {
    for (const v of geoVariants(k)) {
      const m = F.buildFurniture(k, { variant: v });
      const res = { k, v, n: m.colliders.length, mass: m.mass };
      for (const test of ['rest', 'drop']) {
        const ph = new Physics();
        ph.addStaticBox(0, -0.25, 0, 5, 0.25, 5);
        const q = new THREE.Quaternion();
        const pos = new THREE.Vector3(0, m.halfHeight + (test === 'drop' ? 0.4 : 0), 0);
        if (test === 'drop') q.setFromEuler(new THREE.Euler(0.4, 0.7, 0.25));
        const body = ph.createDynamic(m.colliders, m.mass, pos, q, null, { friction: m.friction, restitution: m.restitution, linearDamping: m.linearDamping, angularDamping: m.angularDamping });
        let maxV = 0, t = 0, slept = -1;
        const ys = [];
        for (let i = 0; i < 60 * 6; i++) {
          ph.world.step(ph.events);
          ph.events.drainContactForceEvents(() => {});
          t += 1 / 60;
          const lv = body.linvel();
          if (i > 60 * 4) maxV = Math.max(maxV, Math.hypot(lv.x, lv.y, lv.z));
          if (slept < 0 && body.isSleeping()) slept = t;
          if (i % 30 === 0) ys.push(+body.translation().y.toFixed(4));
        }
        const tr = body.translation(), rq = body.rotation();
        const qq = new THREE.Quaternion(rq.x, rq.y, rq.z, rq.w);
        const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(qq);
        if (test === 'rest') {
          res.restDy = +(tr.y - m.halfHeight).toFixed(4);
          res.restTilt = +Math.acos(Math.min(1, upv.y)).toFixed(3);
          res.restSleep = slept;
        } else {
          res.dropUp = +upv.y.toFixed(2);
          res.dropSleep = slept;
          res.dropJitter = +maxV.toFixed(4);
        }
        ph.dispose();
      }
      out.push(res);
    }
  }
  console.log(JSON.stringify(out));
  done(out);
}

// stack test: ?mode=stack&pairs=desk>crt_monitor,table_round>mug  (top model placed on the base's top)
async function stack() {
  const { initPhysics, Physics } = await import('../../../physics/physics.js');
  await initPhysics();
  const pairs = (P.get('pairs') || 'desk>crt_monitor').split(',').map((x) => x.split('>'));
  const out = [];
  for (const [bk, tk] of pairs) {
    const ph = new Physics();
    ph.addStaticBox(0, -0.25, 0, 5, 0.25, 5);
    const B = F.buildFurniture(bk, { variant: 0 }), T = F.buildFurniture(tk, { variant: 0 });
    const top = (B.anchors.top ? B.anchors.top.y + B.halfHeight : B.size[1]);
    const q = new THREE.Quaternion();
    const bb = ph.createDynamic(B.colliders, B.mass, new THREE.Vector3(0, B.halfHeight, 0), q, null, { friction: B.friction, restitution: B.restitution, linearDamping: B.linearDamping, angularDamping: B.angularDamping });
    const tb = ph.createDynamic(T.colliders, T.mass, new THREE.Vector3(B.anchors.top ? B.anchors.top.x : 0, top + T.halfHeight + 0.01, B.anchors.top ? B.anchors.top.z : 0), q, null, { friction: T.friction, restitution: T.restitution, linearDamping: T.linearDamping, angularDamping: T.angularDamping });
    let events = 0, maxV = 0, slept = -1;
    for (let i = 0; i < 60 * 6; i++) {
      ph.world.step(ph.events);
      ph.events.drainContactForceEvents(() => { if (i > 60) events++; });
      const lv = tb.linvel();
      if (i > 120) maxV = Math.max(maxV, Math.hypot(lv.x, lv.y, lv.z));
      if (slept < 0 && tb.isSleeping() && bb.isSleeping()) slept = i / 60;
    }
    out.push({ pair: bk + '>' + tk, events, jitter: +maxV.toFixed(4), slept, topY: +(tb.translation().y - top - T.halfHeight).toFixed(4) });
    ph.dispose();
  }
  console.log(JSON.stringify(out));
  done(out);
}

async function stats() {
  const { warmMaterials } = await import('../mats.js');
  const tA = performance.now();
  warmMaterials();
  const synth = performance.now() - tA;
  const t0 = performance.now();
  await F.warmFurniture();
  const warm = performance.now() - t0;
  const rows = [];
  const { getTemplate } = await import('../core.js');
  for (const k of Object.keys(F.FURNITURE)) for (const v of geoVariants(k)) { const i = templateInfo(k, v); const pr = getTemplate(k, v).prof; rows.push({ k, v, tris: Math.round(i.tris), verts: i.verts, dc: i.meshes, ms: +i.buildMs.toFixed(1), b: +pr.build.toFixed(1), ao: +pr.ao.toFixed(1), pk: +pr.pack.toFixed(1), cols: i.colliders, mass: i.mass, slots: i.slots.join(' ') }); }
  const res = { synthMs: Math.round(synth), warmMs: Math.round(warm), geoMs: Math.round(rows.reduce((a, r) => a + r.ms, 0)), texMB: +(F.furnitureTextureBytes() / 1048576).toFixed(1), atlas: F.furnitureAtlas().used, rows };
  console.log(JSON.stringify(res));
  done(res);
}

(mode === 'phys' ? phys() : mode === 'stack' ? stack() : mode === 'stats' ? stats() : grid()).catch((e) => { console.error(e); done({ error: String(e.stack || e) }); });
