// First-person viewmodel arms in the overlay scene. URL: &state={"watchRaised":1}&suit=yellow
import { buildFirstPersonArms } from '../src/entities/avatar.js';

export default async function (ctx) {
  const { THREE, engine, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  engine.post.params.uGrain.value = 0.015;
  engine.post.params.uVignette.value = 0.2;
  engine.post.params.uAberration.value = 0;
  engine.renderer.toneMappingExposure = +(q.get('exp') ?? 0.8);
  camera.position.set(0, 1.15, 2); controls.target.set(0, 1.1, -2); controls.update();
  const vm = engine.vmScene;
  vm.add(new THREE.HemisphereLight(0xfff4dc, 0x40382a, 1.4));
  const dl = new THREE.DirectionalLight(0xfff0d8, 2.2); dl.position.set(0.6, 1.2, 0.5); vm.add(dl);
  const fp = buildFirstPersonArms({ suit: q.get('suit') || 'yellow', skin: q.get('skin') || 'tan' });
  vm.add(fp.root);
  // live watch screen
  const c = document.createElement('canvas'); c.width = 256; c.height = 192;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  fp.watchScreen.material.map = tex; fp.watchScreen.material.emissiveMap = tex;
  const draw = (t) => {
    const g = c.getContext('2d');
    g.fillStyle = '#0b1a10'; g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#62ff8e'; g.font = "88px 'VT323', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('12:' + String(Math.floor(t) % 60).padStart(2, '0'), 128, 80);
    g.font = "34px 'VT323', monospace"; g.fillText('O2 87%  HR 92', 128, 150);
    g.strokeStyle = '#62ff8e'; g.lineWidth = 3; g.strokeRect(6, 6, 244, 180);
    tex.needsUpdate = true;
  };
  const state = JSON.parse(q.get('state') || '{}');
  window.__fpState = state;
  window.__fp = fp;
  let tt = 0;
  window.__advance = (sec) => { for (let i = 0; i < sec * 60; i++) { tt += 1 / 60; fp.update(1 / 60, { ...window.__fpState }); } };
  return {
    update(dt) {
      tt += dt;
      draw(tt);
      fp.update(dt, { ...window.__fpState, sway: new THREE.Vector2(Math.sin(tt) * 3, 0) });
    },
  };
}
