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
const yaw0 = +(P.get('yaw') ?? (set === 'avatar' || set === 'stilllife' || set === 'clones' ? Math.PI + 0.5 : 0.7)), pitch = +(P.get('pitch') ?? 0.32), zoom = +(P.get('zoom') || 1);

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
  if (set === 'synth') {
    // material swatches: a sphere + a rounded slab per texsynth recipe
    const Synth = await import('../gfx/texsynth.js');
    const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js');
    const opts = P.get('opts') ? JSON.parse(P.get('opts')) : {};
    return pick(Synth.recipeNames()).map((k) => ({
      key: k,
      build: () => {
        const g = new THREE.Group();
        const m = Synth.pbrMaterial(k, { ...(opts[k] || {}), repeat: +(P.get('rep') || 1) });
        const sph = new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 48), m);
        sph.position.set(-0.55, 0.5, 0);
        const box = new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.0, 0.25, 6, 0.05), m);
        box.position.set(0.6, 0.5, 0);
        box.rotation.y = -0.5;
        g.add(sph, box);
        return g;
      },
    }));
  }
  if (set === 'fparms' || set === 'ragdoll') {
    // first-person viewmodel arms (camera at the origin looking -Z: use &yaw=0&pitch=0&focus=0,-0.2,-0.4&fr=0.35)
    // or ragdoll parts laid out in their spawn pose
    const A = await import('../entities/avatar.js');
    const variants = keysParam ? keysParam.split(',') : ['default'];
    return variants.map((v) => {
      const cos = {};
      let fst = { watchRaised: 0, holdingItem: false };
      if (v.includes('=')) for (const kv of v.split(/[;| ]/)) { const [a, b] = kv.split('='); if (b == null) continue; if (a.startsWith('state.')) fst[a.slice(6)] = isNaN(+b) ? b === 'true' : +b; else cos[a] = b; }
      let arms = null;
      return {
        key: v,
        build: () => {
          if (set === 'fparms') { arms = A.buildFirstPersonArms(cos); for (let k = 0; k < 90; k++) arms.update(1 / 60, fst); return arms.root; }
          const rd = A.buildRagdoll(cos), g = new THREE.Group();
          for (const [k, part] of Object.entries(rd.parts)) { part.mesh.position.fromArray(rd.pose[k]); g.add(part.mesh); }
          return g;
        },
        update: P.get('anim') && set === 'fparms' ? (dt) => arms?.update(dt, fst) : null,
      };
    });
  }
  if (set === 'avatar' || set === 'doll') {
    // variants: "slot=id;slot=id;state.speed=1.5;state.expression=happy;t=0.8"
    const A = set === 'doll' ? await import('../entities/doll/doll_avatar.js') : await import('../entities/avatar.js');
    const base = P.get('cos') ? JSON.parse(P.get('cos')) : { suit: 'yellow', skin: 'tan', hat: 'none', visor: 'none', face: 'dots', backpack: 'tank', accessory: 'none' };
    const gstate = P.get('state') ? JSON.parse(P.get('state')) : {};
    const variants = keysParam ? keysParam.split(',') : ['default'];
    return variants.map((v) => {
      let av = null, st = { speed: 0, grounded: true, expression: 'neutral', ...gstate }, simT = +(P.get('t') || 0);
      return {
        key: v,
        build: () => {
          const cos = { ...base };
          if (v.includes('=')) for (const kv of v.split(/[;| ]/)) {
            const [a, b] = kv.split('='); if (b == null) continue;
            if (a.startsWith('state.')) st[a.slice(6)] = isNaN(+b) ? (b === 'true' ? true : b === 'false' ? false : b) : +b;
            else if (a === 't') simT = +b; else cos[a] = b;
          }
          if (st.moveX != null || st.moveY != null) st.moveDir = new THREE.Vector2(st.moveX || 0, st.moveY ?? 1);
          const t0 = performance.now();
          av = new A.Avatar(cos);
          window.__buildMs = (window.__buildMs || []).concat(performance.now() - t0);
          av.update?.(0.016, st);
          for (let k = 0; k < Math.round(simT / 0.016); k++) av.update?.(0.016, st);
          if (cos.item) {
            const m = buildModel(cos.item, { seed: 1 });
            if (m.hold) { m.object.position.fromArray(m.hold.pos); m.object.rotation.set(...m.hold.rot); }
            av.getHandAnchor('right').add(m.object);
          }
          if (v.includes('deadclone')) { const g = new THREE.Group(); av.root.position.set(0, 0.12, 0); av.root.rotation.set(-Math.PI / 2 + 0.15, 0.7, 0.2); g.add(av.root); return g; }
          window.__avatars = (window.__avatars || []).concat(av);
          return av.root;
        },
        update: P.get('anim') ? (dt) => av?.update?.(dt, st) : null,
      };
    });
  }
  if (set === 'stilllife') {
    // &impl=new -> src/entities/stilllife/index.js; &state=attack|chase|frozen; &speed=1.5&walk=1 (root moves);
    // &frames=N&fdt=0.25 -> N cells of the first key at successive times; &t=secs pre-roll
    const S = P.get('impl') === 'new' ? await import('../entities/stilllife/index.js') : await import('../entities/stilllife_model.js');
    let keys = pick(S.STILL_LIFE_VARIANTS);
    const frames = +(P.get('frames') || 0), fdt = +(P.get('fdt') || 0.2);
    let cells = frames ? Array.from({ length: frames }, (_, i) => ({ v: keys[0], off: i * fdt })) : keys.map((v) => ({ v, off: 0 }));
    if (P.get('yaws')) { const ys = P.get('yaws').split(',').map(Number); cells = cells.flatMap((c) => ys.map((y) => ({ ...c, yaw: y }))); }
    const st = P.get('state') || 'idle', speed = +(P.get('speed') || 0), walk = !!P.get('walk');
    const seed = +(P.get('seed') || 3);
    return cells.map(({ v, off, yaw: cyaw }, ci) => {
      const t0 = performance.now();
      const m = S.buildStillLife(v, seed);
      const ms = performance.now() - t0;
      console.log('stilllife build', v, ms.toFixed(1) + 'ms', JSON.stringify(S.buildStats?.[v] || {}));
      let tt = 0, atkT = 9;
      const look = new THREE.Vector3();
      const upd = (dt, cam) => {
        tt += dt;
        if (walk && speed > 0) m.root.position.z -= speed * dt;
        atkT += dt;
        if (st === 'attack' && atkT > 2.2) atkT = 0;
        if (cam) look.copy(cam.position); else look.set(0, 1.2, -3);
        m.update(dt, { speed: walk ? speed : 0, moving: walk && speed > 0, attacking: st === 'attack' ? Math.max(0, 1 - atkT * 1.5) : 0, alert: st === 'chase' || st === 'attack' ? 1 : 0.3, lookTarget: look, frozen: st === 'frozen' });
      };
      const pre = +(P.get('t') || 0) + off;
      return { key: (frames ? `${v} t=${(pre).toFixed(2)}` : v) + (cyaw != null ? ` y=${cyaw}` : ''), build: () => m.root, update: (dt, t, cam) => upd(dt, cam), pre, follow: walk, yaw: cyaw };
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
    // &faces=happy,angry &talk=1 &yaws=0.7,3.4 (pre-rolled so the face-change glitch has settled)
    const faces = P.get('faces') ? P.get('faces').split(',') : (H.HEALTHITY_FACES || ['happy']).slice(0, 8);
    const ys = P.get('yaws') ? P.get('yaws').split(',').map(Number) : [null];
    return faces.flatMap((f) => ys.map((y) => { const m = H.buildHealthity(); m.setFace?.(f); m.setTalking?.(!!P.get('talk')); return { key: f + (y != null ? ' y=' + y : ''), build: () => m.root, update: (dt) => m.update?.(dt), pre: +(P.get('t') || 1.2), yaw: y ?? undefined }; }));
  }
  if (set === 'bacteria') {
    // &state=idle|wander|listen|investigate|stalk|chase|attack|smash|retreat|flee|stunned
    // &speed=m/s &walk=1 (root moves) &frames=N&fdt=0.2 (time strip) &yaws=0,1.57,3.14 (turntable)
    // &t=secs pre-roll &int=0..1 intensity &frozen=1 &look=0 (no look target) &dissolve=0..1 &seed=3
    const B = await import('../entities/monsters/bacteria_body.js');
    const st = P.get('state') || 'idle', speed = +(P.get('speed') || 0), walk = !!P.get('walk');
    const frames = +(P.get('frames') || 0), fdt = +(P.get('fdt') || 0.2), seed = +(P.get('seed') || 3);
    const inten = P.get('int') != null ? +P.get('int') : st === 'chase' ? 1 : st === 'stalk' ? 0.6 : 0.4;
    let cells = frames ? Array.from({ length: frames }, (_, i) => ({ off: i * fdt })) : [{ off: 0 }];
    if (P.get('yaws')) { const ys = P.get('yaws').split(',').map(Number); cells = cells.flatMap((c) => ys.map((y) => ({ ...c, yaw: y }))); }
    // &bones=head:2.8,handR:0.4 : one close-up cell per bone[:yaw]
    if (P.get('bones')) cells = P.get('bones').split(',').map((b) => { const [bn, y] = b.split(':'); return { off: 0, yaw: y != null ? +y : undefined, bone: bn }; });
    return cells.map(({ off, yaw: cyaw, bone: cbone }) => {
      const t0 = performance.now();
      const body = new B.BacteriaBody(seed);
      console.log('bacteria build', (performance.now() - t0).toFixed(0) + 'ms', JSON.stringify(window.__bacStats || {}));
      if (P.get('dissolve')) body.setDissolve(+P.get('dissolve'));
      const root = body.root;
      const vel = new THREE.Vector3(), look = new THREE.Vector3();
      let tt = 0;
      const upd = (dt, cam) => {
        tt += dt;
        if (walk && speed > 0) root.position.z -= speed * dt;
        vel.set(0, 0, walk ? -speed : 0);
        let atk = 0;
        if (st === 'attack') atk = Math.min(1, (tt % 1.6) / 0.75);
        else if (st === 'smash') atk = 0.6 * (Math.floor(tt / 0.9) % 2) + 0.01 * Math.floor(tt / 0.9);
        if (cam) look.copy(cam.position); else look.set(0, 1.4, -4);
        body.update(dt, { velocity: vel, state: st, lookTarget: P.get('look') === '0' ? null : look, attackT: atk, ceilingY: 2.9, intensity: inten, frozen: !!P.get('frozen') });
      };
      const pre = +(P.get('t') || 0) + off;
      // &bone=head|handR|footL|sp3...&fr=0.3 : frame a close-up around one bone of the posed body
      const bone = cbone || P.get('bone'), fr = +(P.get('fr') || 0.3);
      const box = () => {
        if (bone && body.id[bone] != null) { const c = body.bPos[body.id[bone]]; return new THREE.Box3(c.clone().addScalar(-fr), c.clone().addScalar(fr)); }
        return new THREE.Box3(new THREE.Vector3(-0.95, 0, -0.95).add(root.position), new THREE.Vector3(0.95, 2.75, 0.95).add(root.position));
      };
      return { key: `${st}${bone ? ' ' + bone : ''}${frames ? ' t=' + pre.toFixed(2) : ''}${cyaw != null ? ' y=' + cyaw : ''}`, build: () => root, update: (dt, t, cam) => upd(dt, cam), pre: pre || 1 / 30, follow: walk, yaw: cyaw, box, floorY: 0 };
    });
  }
  return [];
}

function frame(obj, cam, aspect, yawOverride = null, boxFn = null) {
  const yaw = yawOverride ?? yaw0;
  const box = boxFn ? boxFn() : new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  let r = Math.max(0.05, size.length() / 2);
  // &focus=x,y,z (object-local) &fr=radius : close-ups
  if (P.get('focus')) { const f = P.get('focus').split(',').map(Number); c.set(f[0], f[1], f[2]).applyMatrix4(obj.matrixWorld); r = +(P.get('fr') || 0.4); }
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
    const tBuild = performance.now();
    try { obj = it.build(); } catch (e) { console.error('build failed', it.key, e); obj = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xff00ff })); }
    // &stats=1: draw calls / triangles / build time per model (also in window.__galleryStats)
    if (P.get('stats')) {
      const ms = performance.now() - tBuild;
      let draws = 0, tris = 0;
      obj.traverse((o) => { if (o.isMesh && o.visible) { draws++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
      it.stat = `${draws}dc ${Math.round(tris / 100) / 10}kt ${ms.toFixed(0)}ms`;
      (window.__galleryStats = window.__galleryStats || {})[it.key] = { draws, tris, ms: +ms.toFixed(1), info: obj.userData.stats || null };
    }
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(32, cw / ch, 0.01, 100);
    if (it.pre) {
      // pre-roll the animation (camera placed first so lookTarget is meaningful)
      frame(obj, cam, cw / ch, it.yaw, it.box);
      for (let k = 0, n = Math.round(it.pre * 30); k < n; k++) { it.update(1 / 30, 0, cam); obj.updateMatrixWorld(true); }
    } else if (it.update) { frame(obj, cam, cw / ch, it.yaw, it.box); it.update(1 / 30, 0, cam); }
    obj.updateMatrixWorld(true);
    const f = frame(obj, cam, cw / ch, it.yaw, it.box);
    it.camOff = cam.position.clone().sub(obj.position);
    // floor + shadows
    const floor = new THREE.Mesh(new THREE.CircleGeometry(f.r * 4, 48), new THREE.MeshStandardMaterial({ color: 0x55565c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = (it.floorY ?? f.box.min.y) - 0.001;
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
    lab.textContent = it.stat ? `${it.key}  ${it.stat}` : it.key;
    lab.style.left = col * cw + 4 + 'px';
    lab.style.top = row * ch + 4 + 'px';
    labels.appendChild(lab);
  }
  let t = 0, frames = 0;
  const loop = () => {
    const dt = 1 / 30;
    t += dt;
    for (const c of cells) {
      c.it.update?.(dt, t, c.cam);
      if (c.it.follow) { c.cam.position.copy(c.obj.position).add(c.it.camOff); }
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
