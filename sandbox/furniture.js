// Furniture / prop library viewer.
// /sandbox/?m=furniture                       all models in a grid (labels above)
//   &only=chair_office,desk                   just these (close-up, auto camera)
//   &variants=1                               every variant of each shown model
//   &wire=1                                   collider wireframes
//   &stack=8                                  a pile of stacked chair_wood
//   &open=1                                   open drawers / spin seats
//   &clean=1                                  disable grain/vignette/bloom for inspection
//   &rot=deg                                  yaw every model (to see backs)
import { FURNITURE, buildFurniture, furnitureInfo } from '../src/entities/models_furniture.js';

export default async function (ctx) {
  const { THREE, scene, camera, controls, engine } = ctx;
  const q = new URLSearchParams(location.search);
  const only = q.get('only');
  const wire = q.get('wire') === '1';
  const showVariants = q.get('variants') === '1';
  const rot = (+q.get('rot') || 0) * Math.PI / 180;
  if (q.get('clean') === '1') {
    const P = engine.post.params;
    P.uGrain.value = 0; P.uVignette.value = 0.1; P.uAberration.value = 0;
    engine.post.bloom.strength = 0.15;
  }
  let names = only ? only.split(',') : Object.keys(FURNITURE);
  if (q.has('range')) { const [a, b] = q.get('range').split('-').map(Number); names = names.slice(a, b); }
  const t0 = performance.now();
  const items = [];
  for (const n of names) {
    const info = furnitureInfo(n, 0);
    const vs = showVariants ? [...Array(info.variants).keys()] : [q.has('variant') ? +q.get('variant') : 0];
    for (const v of vs) items.push({ n, v, f: buildFurniture(n, { variant: v, seed: q.get('seed') ?? undefined }) });
  }
  const tBuild = performance.now() - t0;

  // stats
  let total = 0;
  const rows = [];
  for (const n of Object.keys(FURNITURE)) {
    if (!names.includes(n)) continue;
    const i = furnitureInfo(n, 0);
    total += i.tris;
    rows.push(`${n.padEnd(22)} tris ${String(i.tris).padStart(5)}  meshes ${i.meshes}  variants ${i.variants}  size ${i.size.map((x) => x.toFixed(2)).join('x')}${i.tris > 6000 ? '  !!! >6000' : i.tris > 3000 ? '  (>3000)' : ''}`);
  }
  console.log(`[furniture] ${items.length} models built in ${tBuild.toFixed(0)} ms, total tris ${total}\n` + rows.join('\n'));

  // layout: rows across the room, spacing from footprint
  const maxW = 12.6;
  let x = -maxW / 2, z = -5.6, rowD = 0;
  const group = new THREE.Group();
  scene.add(group);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff66, depthTest: false, transparent: true, opacity: 0.85 });
  for (const it of items) {
    const { f } = it;
    const [w, , d] = f.size;
    const fw = Math.max(w, d) + 0.35;
    if (x + fw > maxW / 2) { x = -maxW / 2; z += rowD + 0.4; rowD = 0; }
    f.object.position.set(x + fw / 2, f.halfHeight, z + Math.max(w, d) / 2);
    f.object.rotation.y = rot;
    group.add(f.object);
    it.pos = f.object.position.clone();
    x += fw;
    rowD = Math.max(rowD, Math.max(w, d));
    if (wire) {
      for (const c of f.colliders) {
        let g;
        if (c.type === 'box') g = new THREE.BoxGeometry(...c.size);
        else if (c.type === 'cylinder') g = new THREE.CylinderGeometry(c.radius, c.radius, c.height, 16, 1);
        else g = new THREE.SphereGeometry(c.radius, 12, 8);
        const l = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), wireMat);
        l.position.fromArray(c.pos);
        if (c.rot) l.rotation.set(...c.rot);
        l.renderOrder = 999;
        f.object.add(l);
      }
      for (const [k, p] of Object.entries(f.anchors || {})) {
        if (k === 'stack') continue;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }));
        m.position.copy(p);
        m.renderOrder = 1000;
        f.object.add(m);
      }
    }
    if ((!only && !q.has('range')) || showVariants) {
      const label = `${it.n}${showVariants ? ' v' + it.v : ''}`;
      const tex = ctx.Tex.labelTexture(256, 40, (c, w2, h2) => {
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, w2, h2);
        c.fillStyle = '#9f9'; c.font = 'bold 22px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, w2 / 2, h2 / 2);
      });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      s.scale.set(0.64, 0.1, 1);
      s.position.set(f.object.position.x, f.size[1] + 0.12, f.object.position.z);
      s.renderOrder = 998;
      group.add(s);
    }
  }

  // stacked chairs demo
  const stackN = +q.get('stack') || 0;
  if (stackN) {
    for (const [col, n] of [[0, stackN], [1, Math.max(2, stackN - 3)]]) {
      let base = null;
      for (let i = 0; i < n; i++) {
        const f = buildFurniture('chair_wood', { variant: i % 3 === 2 ? 1 : 0 });
        if (!base) base = new THREE.Vector3(-1 + col * 0.7, f.halfHeight, 1.2 + col * 0.3);
        f.object.position.copy(base).addScaledVector(f.anchors.stack, i);
        f.object.rotation.y = col * 0.4;
        if (col) f.object.position.sub(base).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.4).add(base);
        group.add(f.object);
      }
    }
  }

  if (q.get('open') === '1') {
    for (const it of items) for (const [k, p] of Object.entries(it.f.parts || {})) {
      if (k.startsWith('drawer')) p.position.z = p.userData.rest.z + (p.userData.maxOpen || 0.3) * (k.endsWith('1') ? 0.9 : 0.4);
      if (k === 'seat') p.rotation.y = 0.6;
      if (k === 'door') p.rotation.y = -1.1;
    }
  }

  // auto camera for close-ups
  if ((only || q.has('range')) && !q.has('cam') && q.get('sheet') !== '1') {
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = Math.max(0.35, r * (+q.get("zoom") || 1.6));
    camera.position.copy(c).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist));
    controls.target.copy(c);
    controls.update();
  }

  // sheet mode: every model rendered close-up in its own viewport tile
  if (q.get('sheet') === '1') {
    const { renderer } = ctx;
    const cols = +q.get('cols') || Math.ceil(Math.sqrt(items.length * 16 / 9));
    const rows = Math.ceil(items.length / cols);
    group.children.filter((c) => c.isSprite).forEach((c) => (c.visible = false));
    // spread models on a grid in the room centre so each tile has a clean background
    items.forEach((it, i) => {
      const gx = (i % 6) - 2.5, gz = Math.floor(i / 6) - 2;
      it.f.object.position.set(gx * 2.0, it.f.halfHeight, gz * 2.0);
    });
    const tcam = new THREE.PerspectiveCamera(35, 1, 0.02, 50);
    const yaw = (+q.get('yaw') || 35) * Math.PI / 180, pitch = (+q.get('pitch') || 22) * Math.PI / 180;
    const labels = items.map((it) => {
      const d = document.createElement('div');
      d.textContent = `${it.n}${showVariants ? ' v' + it.v : ''}`;
      d.style.cssText = 'position:fixed;color:#9f9;font:12px monospace;background:rgba(0,0,0,.55);padding:1px 4px;z-index:3';
      document.body.appendChild(d);
      return d;
    });
    engine.render = () => {
      const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
      const tw = Math.floor(W / cols), th = Math.floor(H / rows);
      renderer.setScissorTest(true);
      items.forEach((it, i) => {
        const cx = (i % cols) * tw, cy = H - (Math.floor(i / cols) + 1) * th;
        items.forEach((o) => (o.f.object.visible = o === it));
        const box = new THREE.Box3().setFromObject(it.f.object);
        const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
        tcam.aspect = tw / th; tcam.updateProjectionMatrix();
        const dist = (r / Math.sin((tcam.fov * Math.PI / 180) / 2)) * (+q.get('zoom') || 1.15);
        tcam.position.copy(c).add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist));
        tcam.lookAt(c);
        renderer.setViewport(cx, cy, tw, th); renderer.setScissor(cx, cy, tw, th);
        renderer.render(scene, tcam);
        labels[i].style.left = cx + 4 + 'px'; labels[i].style.top = (H - cy - th) + 4 + 'px';
      });
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    };
  }

  window.__furniture = { items, FURNITURE };
  return {
    update(dt, t) {
      if (q.get('spin') === '1') for (const it of items) if (it.f.parts?.seat) it.f.parts.seat.rotation.y = t;
    },
  };
}
