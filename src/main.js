// R.O.O.M. — boot & main loop
import '@fontsource/vt323';
import '@fontsource/ibm-plex-mono';
import './ui/style.css';
import * as THREE from 'three';
import { engine } from './core/engine.js';
import { input } from './core/input.js';
import { profile } from './core/profile.js';
import { net } from './net/net.js';
import { initPhysics } from './physics/physics.js';
import * as Tex from './gfx/textures.js';
import { audio } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { Game } from './game/game.js';
import { Terminal } from './ui/terminal.js';
import { Watch } from './ui/watch.js';
import { Healthity } from './game/healthity.js';
import { Voice } from './net/voice.js';
import { preloadItems } from './entities/models_items.js';
import { warmFurniture } from './entities/models_furniture.js';

const params = new URLSearchParams(location.search);

async function boot() {
  const bootEl = document.createElement('div');
  bootEl.style.cssText = 'position:fixed;inset:0;background:#000;color:#ffb43a;font:28px VT323,monospace;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:100';
  bootEl.innerHTML = '<div style="font-size:64px;letter-spacing:10px;text-shadow:0 0 14px #ffb43a">R.O.O.M.</div><div id="boot-l">INITIALIZING...</div>';
  document.body.appendChild(bootEl);
  const setL = (t) => { const e = document.getElementById('boot-l'); if (e) e.textContent = t; };

  engine.init(document.body, params.get('q') || profile.settings.quality);
  input.attach(engine.renderer.domElement);
  setL('LOADING PHYSICS...');
  await initPhysics();
  setL('LOADING FONTS...');
  try {
    await Promise.race([
      Promise.all([document.fonts.load('24px "VT323"'), document.fonts.load('24px "IBM Plex Mono"'), document.fonts.load('bold 24px "IBM Plex Mono"')]).then(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch (e) { /* fonts optional */ }
  setL('GENERATING TEXTURES...');
  await Tex.preload((p, n) => setL(`GENERATING TEXTURES... ${Math.round(p * 100)}% (${n})`));

  setL('PRINTING LABELS...');
  await new Promise((r) => setTimeout(r, 0));
  try { await preloadItems(); } catch (e) { console.warn('item preload', e); }
  setL('ASSEMBLING FURNITURE...');
  await new Promise((r) => setTimeout(r, 0));
  try { await warmFurniture?.((p) => setL(`ASSEMBLING FURNITURE... ${Math.round((p || 0) * 100)}%`)); } catch (e) { console.warn('furniture warm', e); }

  const ui = new UI();
  const game = new Game(ui);
  game.terminal = new Terminal(game);
  game.watch = new Watch(game);
  game.healthity = new Healthity(game);
  game.voice = new Voice(game);
  ui.applySettings();
  window.__game = game;
  window.__net = net;
  window.__engine = engine;
  window.__input = input;

  bootEl.remove();

  // menu backdrop: the lobby, offline, with a slow camera drift
  await net.startOffline();
  game._resetRoster();
  game.state = 'menu';
  game.menuBackdrop = true;
  await game.loadWorld({ type: 'lobby', seed: 1234 }, false);
  ui.showMainMenu();

  // test hooks: ?auto=solo|host & ?level=yellow|poolrooms|grasslands
  const auto = params.get('auto');
  if (auto === 'solo') {
    await game.startSolo();
    ui.hideMenus();
    if (params.get('level')) game.hostDispatch([], params.get('level'));
  }

  // ---------------- main loop ----------------
  const timer = new THREE.Timer();
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    timer.update(now);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    try {
      if (game.menuBackdrop && game.state === 'menu') menuCamera(game, dt);
      else game.update(dt);
      if (game.state !== 'menu' || !game.menuBackdrop) {
        game.terminal.update(dt);
        game.watch.update(dt);
        game.healthity.update(dt);
        game.voice.update(dt);
      }
      ui.update(dt);
      audio.update?.(dt);
      engine.render(dt);
      game.watch.captureIfRequested(engine.renderer.domElement);
    } catch (e) {
      console.error('[frame]', e);
    }
    input.endFrame();
  }
  requestAnimationFrame(frame);
}

let menuT = 0;
function menuCamera(game, dt) {
  menuT += dt;
  const cam = engine.camera;
  const a = menuT * 0.05;
  cam.position.set(Math.sin(a) * 3.2, 1.5 + Math.sin(menuT * 0.3) * 0.08, 12.5 + Math.cos(a) * 1.5);
  cam.lookAt(0, 1.1, 9.6);
  cam.fov = 60;
  cam.updateProjectionMatrix();
  if (game.world) {
    game.world.update(dt);
  }
  if (audio.ready) audio.setListener(cam.position, cam.quaternion);
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#ff6040;font:18px monospace;padding:20px">R.O.O.M. failed to start:\n${e?.stack || e}</pre>`;
});
