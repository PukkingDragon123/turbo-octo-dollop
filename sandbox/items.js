// Item model library viewer (src/entities/models_items.js).
//   /sandbox/?m=items                       all items laid out on tables in the test room (orbit controls)
//   &item=flashlight,crowbar                 only these items (compact table + player-eye camera). Per-item options:
//                                            &item=keycard:level=4,flare:lit=1,sample_jar:fill=0.3;color=0x9030c0
//   &wire=1                                  collider wireframes (magenta) + anchors (cyan) + origin (white)
//   &held=1&item=name                        first-person held preview through engine.vmScene (anchor 0.28,-0.25,-0.55)
//   &hand=1                                  palm proxy at the hand anchor (held / heldsheet)
//   &mode=sheet[&view=front|top|back|side|iso|low][&cols=6][&zoom=1][&shadows=0]   contact sheet, one cell per item
//   &mode=heldsheet[&cols=4][&crop=0]        contact sheet of first-person held views (crop = zoom on the hand area)
//   &frames=N                                sheets: stop after N frames (default 3)
//   &freeze=N                                room/held: render N frames then stop
//   &clean=1                                 disable grain / aberration / vignette for inspection
//   &bench=1                                 time building 50 instances of every listed item
//   &spin=1  &row=1.25  &cam=x,y,z&target=x,y,z
// Sheets and frozen views are also copied into a 2D overlay canvas (window.__overlay, frame count in
// window.__sheetFrames) because the WebGL buffer is not preserved, which makes headless captures flaky.
import * as THREE from 'three';
import { ITEMS, buildItem, itemStats } from '../src/entities/models_items.js';

const HAND_ANCHOR = new THREE.Vector3(0.28, -0.25, -0.55);

function colliderWire(c) {
  let g;
  if (c.type === 'box') g = new THREE.BoxGeometry(...c.size);
  else if (c.type === 'cylinder') g = new THREE.CylinderGeometry(c.radius, c.radius, c.height, 16);
  else g = new THREE.SphereGeometry(c.radius, 12, 8);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff30c0, wireframe: true, transparent: true, opacity: 0.85, depthTest: false }));
  m.position.fromArray(c.pos);
  if (c.rot) m.rotation.set(...c.rot);
  m.renderOrder = 10;
  return m;
}

function addDebug(inst) {
  for (const c of inst.colliders) inst.object.add(colliderWire(c));
  const dot = (col, r = 0.004) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
  const o = dot(0xffffff, 0.003); o.renderOrder = 11; inst.object.add(o);
  for (const k in inst.anchors) { const d = dot(0x00e5ff); d.position.copy(inst.anchors[k]); d.renderOrder = 11; inst.object.add(d); }
}

function palmProxy() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.6, transparent: true, opacity: 0.55 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.085), mat);
  palm.rotation.z = 0.5;
  g.add(palm);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8), mat);
  thumb.position.set(-0.04, 0.02, -0.01); thumb.rotation.set(0.3, 0, 0.9);
  g.add(thumb);
  return g;
}

function studioLights(scene, env) {
  scene.environment = env;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight(0xfff4d0, 0x4a3c20, 0.9));
  const key = new THREE.DirectionalLight(0xfff2dc, 2.4);
  key.position.set(1.2, 3, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
  key.shadow.camera.right = key.shadow.camera.top = 1.2;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xc8d8ff, 0.8);
  rim.position.set(-2, 1.5, -2);
  scene.add(rim);
  return key;
}

// Render `n` frames through `render`, copying each into a 2D overlay, then stop (stable captures).
function freezeAfter(engine, n, render) {
  let frames = 0, cv = null;
  engine.render = (dt) => {
    if (frames >= n) return;
    render(dt);
    const src = engine.renderer.domElement;
    if (!cv) {
      cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none';
      document.body.appendChild(cv);
    }
    cv.width = src.width; cv.height = src.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    window.__overlay = cv;
    frames++;
    window.__sheetFrames = frames;
  };
}

function logStats(names) {
  let total = 0;
  const lines = [];
  for (const n of names) {
    const s = itemStats(n);
    total += s.tris;
    const worst = Math.max(...s.perMesh.map((p) => +p.split(':').pop()));
    lines.push(`${n.padEnd(17)} meshes:${s.meshes} tris:${String(s.tris).padStart(5)}${worst > 2500 ? ' !!>2500' : ''}  [${s.perMesh.join(' ')}]`);
  }
  console.log('ITEM STATS\n' + lines.join('\n') + `\nTOTAL tris (one of each): ${total}`);
}

export default async function (ctx) {
  const { THREE: T, scene, camera, engine, controls, room } = ctx;
  const q = new URLSearchParams(location.search);
  const all = Object.keys(ITEMS);
  // item specs: name or name:key=val;key=val (e.g. keycard:level=4, flare:lit=1, sample_jar:fill=0.3;color=0x9030c0)
  const parseVal = (v) => (v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(+v) ? +v : v);
  const specs = (q.get('item') ? q.get('item').split(',') : all).map((sp) => {
    const [n, os = ''] = sp.split(':');
    const opts = {};
    for (const kv of os.split(';').filter(Boolean)) { const [k, v = '1'] = kv.split('='); opts[k] = parseVal(v); }
    return { n, opts, label: sp };
  }).filter((sp) => ITEMS[sp.n]);
  const names = specs.map((sp) => sp.n);
  const wire = q.get('wire') === '1';
  const mode = q.get('mode') || 'room';

  if (q.get('clean') === '1' || mode !== 'room') {
    engine.post.params.uGrain.value = 0;
    engine.post.params.uAberration.value = 0;
    engine.post.params.uVignette.value = 0.1;
  }

  const t0 = performance.now();
  const insts = specs.map((sp) => ({ n: sp.label, inst: buildItem(sp.n, sp.opts) }));
  console.log(`built ${names.length} items (first build incl. textures) in ${(performance.now() - t0).toFixed(0)} ms`);
  logStats([...new Set(names)]);
  if (q.get('bench') === '1') {
    const t1 = performance.now();
    for (const n of names) for (let i = 0; i < 50; i++) buildItem(n);
    console.log(`bench: 50 x ${names.length} cached builds in ${(performance.now() - t1).toFixed(1)} ms`);
  }
  if (wire) for (const { inst } of insts) addDebug(inst);

  // ------------------------------------------------------------ contact sheets
  if (mode === 'sheet' || mode === 'heldsheet') {
    room.visible = false;
    const held = mode === 'heldsheet';
    const studio = new T.Scene();
    studio.background = new T.Color(held ? 0x6b5a2c : 0x2c2a26);
    const key = studioLights(studio, engine.defaultEnv);
    key.castShadow = !held && q.get('shadows') !== '0';
    const floor = new T.Mesh(new T.PlaneGeometry(6, 6), ctx.Mat.get('carpet'));
    floor.rotation.x = -PI2;
    floor.receiveShadow = true;
    if (!held) studio.add(floor);
    const anchor = new T.Group();
    anchor.position.copy(HAND_ANCHOR);
    if (held) {
      studio.add(anchor);
      if (q.get('hand') === '1') anchor.add(palmProxy());
    }
    const cam = new T.PerspectiveCamera(held ? 60 : 35, 1, 0.01, 20);
    for (const { inst } of insts) {
      inst.object.visible = false;
      if (held) {
        inst.object.position.fromArray(inst.hold.pos);
        inst.object.rotation.set(...inst.hold.rot);
        anchor.add(inst.object);
      } else studio.add(inst.object);
    }
    const cols = +(q.get('cols') || Math.ceil(Math.sqrt(insts.length * 1.6)));
    const rows = Math.ceil(insts.length / cols);
    const views = { front: [0.42, 0.42, 1], top: [0.04, 1, 0.25], back: [-0.45, 0.4, -1], side: [1, 0.3, 0.06], iso: [0.8, 0.75, 0.8], low: [0.3, 0.12, 1] };
    const dir = new T.Vector3(...(views[q.get('view') || 'front'] || views.front)).normalize();
    const r = engine.renderer;
    const maxFrames = +(q.get('frames') || 3); // stop after a few frames: static image for screenshots
    engine.render = () => {
      if ((window.__sheetFrames || 0) >= maxFrames) return;
      const W = innerWidth, H = innerHeight, cw = W / cols, ch = H / rows;
      r.setScissorTest(true);
      r.setClearColor(0x000000, 1);
      r.clear();
      insts.forEach(({ inst }, i) => {
        const cx = (i % cols) * cw, cy = H - (Math.floor(i / cols) + 1) * ch;
        r.setViewport(cx + 1, cy + 1, cw - 2, ch - 2);
        r.setScissor(cx + 1, cy + 1, cw - 2, ch - 2);
        inst.object.visible = true;
        cam.aspect = (cw - 2) / (ch - 2);
        if (held) {
          cam.position.set(0, 0, 0);
          cam.quaternion.identity();
          if (q.get('crop') !== '0') {
            // zoom on the hand region of a virtual 16:9 first-person frame (true perspective)
            const FW = 1600, FH = 900, cwp = FW * 0.5, chp = cwp / cam.aspect;
            cam.aspect = FW / FH;
            cam.setViewOffset(FW, FH, FW * 0.45, FH - chp, cwp, chp);
          } else cam.clearViewOffset();
        } else {
          const rad = Math.max(0.03, Math.hypot(...inst.size) / 2);
          inst.object.position.set(0, inst.halfHeight, 0);
          floor.position.y = 0;
          const dist = rad / Math.sin((cam.fov * PI) / 360) * (+(q.get("zoom") || 1.0)) / Math.min(1, cam.aspect);
          cam.position.copy(dir).multiplyScalar(dist).add(new T.Vector3(0, inst.halfHeight, 0));
          cam.lookAt(0, inst.halfHeight, 0);
          key.position.set(1.2, 3, 2.2).multiplyScalar(Math.max(0.3, rad * 2));
          key.shadow.camera.left = key.shadow.camera.bottom = -rad * 1.6;
          key.shadow.camera.right = key.shadow.camera.top = rad * 1.6;
          key.shadow.camera.near = 0.01; key.shadow.camera.far = rad * 20 + 2;
          key.shadow.camera.updateProjectionMatrix();
        }
        cam.near = held ? 0.01 : Math.max(0.005, cam.position.length() * 0.05);
        cam.updateProjectionMatrix();
        r.render(studio, cam);
        inst.object.visible = false;
      });
      r.setScissorTest(false);
      r.setViewport(0, 0, W, H);
      // copy into a 2D overlay (the WebGL buffer is not preserved, which makes captures flaky)
      if (!window.__sheetCopy) {
        const cv = document.createElement('canvas');
        cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none';
        document.body.appendChild(cv);
        window.__sheetCopy = cv;
      }
      const cv = window.__sheetCopy;
      window.__overlay = cv;
      cv.width = r.domElement.width; cv.height = r.domElement.height;
      const g2 = cv.getContext('2d');
      g2.drawImage(r.domElement, 0, 0);
      const sx = cv.width / W, sy = cv.height / H;
      g2.font = `${Math.round(12 * sy)}px monospace`;
      g2.fillStyle = '#ffe9a8';
      insts.forEach(({ n }, i) => g2.fillText(n, ((i % cols) * cw + 4) * sx, (Math.floor(i / cols) * ch + 14) * sy));
      window.__sheetFrames = (window.__sheetFrames || 0) + 1;
    };
    return {};
  }

  const freeze = +(q.get('freeze') || 0);
  if (freeze) freezeAfter(engine, freeze, engine.render.bind(engine));

  // ------------------------------------------------------------ held preview (vmScene)
  if (q.get('held') === '1') {
    const vm = engine.vmScene;
    const anchor = new T.Group();
    anchor.position.copy(HAND_ANCHOR);
    vm.add(anchor);
    const dl = new T.DirectionalLight(0xfff2dc, 2.0);
    dl.position.set(0.5, 1, 0.6);
    vm.add(dl, new T.HemisphereLight(0xfff4d0, 0x4a3c20, 0.8));
    if (q.get('hand') === '1') anchor.add(palmProxy());
    const { inst } = insts[0];
    inst.object.position.fromArray(inst.hold.pos);
    inst.object.rotation.set(...inst.hold.rot);
    anchor.add(inst.object);
    camera.position.set(0, 1.6, 2);
    controls.target.set(0, 1.5, -2);
    controls.update();
    return {
      update(dt, t) { anchor.position.y = HAND_ANCHOR.y + Math.sin(t * 2) * 0.004; },
    };
  }

  // ------------------------------------------------------------ room layout on tables
  const tableTop = 0.76;
  const tableMat = ctx.Mat.get('wood_light');
  const gap = 0.07, maxRow = +(q.get('row') || (names.length <= 12 ? 1.25 : 4.2));
  const rowsArr = [];
  let row = { items: [], w: 0, d: 0 };
  for (const it of insts) {
    const w = it.inst.size[0], d = it.inst.size[2];
    if (row.w + w > maxRow && row.items.length) { rowsArr.push(row); row = { items: [], w: 0, d: 0 }; }
    row.items.push(it); row.w += w + gap; row.d = Math.max(row.d, d);
  }
  rowsArr.push(row);
  let z = 0;
  const layoutDepth = rowsArr.reduce((a, r) => a + r.d + 0.12, 0);
  z = -layoutDepth / 2;
  for (const r of rowsArr) {
    const tbl = new T.Mesh(new T.BoxGeometry(r.w + 0.1, 0.04, r.d + 0.1), tableMat);
    tbl.position.set(0, tableTop - 0.02, z + r.d / 2);
    tbl.receiveShadow = tbl.castShadow = true;
    scene.add(tbl);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.04, tableTop - 0.04, 0.04), tableMat);
      leg.position.set(sx * (r.w / 2), (tableTop - 0.04) / 2, z + r.d / 2 + sz * r.d / 2);
      scene.add(leg);
    }
    let x = -r.w / 2 + gap / 2;
    for (const it of r.items) {
      const w = it.inst.size[0];
      it.inst.object.position.set(x + w / 2, tableTop + it.inst.halfHeight, z + r.d / 2);
      scene.add(it.inst.object);
      x += w + gap;
    }
    z += r.d + 0.12;
  }
  if (!q.get('cam')) {
    const span = Math.max(...rowsArr.map((r) => r.w), layoutDepth);
    if (names.length <= 12) camera.position.set(0, tableTop + 0.35 + span * 0.35, layoutDepth / 2 + 0.25 + span * 0.45);
    else camera.position.set(0, tableTop + span * 0.45, span * 0.55 + 0.2);
    controls.target.set(0, tableTop, 0);
    controls.update();
  }
  const spin = q.get('spin') === '1';
  return {
    update(dt) {
      if (spin) for (const { inst } of insts) inst.object.rotation.y += dt * 0.5;
    },
  };
}

const PI2 = Math.PI / 2;
const PI = Math.PI;
