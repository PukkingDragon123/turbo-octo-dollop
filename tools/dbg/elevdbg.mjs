// debug: elevator reflection probe state in the lobby (node tools/dbg/elevdbg.mjs [url])
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://localhost:5186/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(base + '?auto=solo');
for (let i = 0; i < 200; i++) { const ok = await page.evaluate(() => !!(window.__game && window.__game.world && !window.__game.loading && window.__game.state === 'playing')).catch(() => false); if (ok) break; await page.waitForTimeout(1000); }
await page.waitForTimeout(12000);
const r = await page.evaluate(() => {
  const lv = __game.world.level, s = lv.elevatorSteel, R = __engine.renderer;
  const out = { type: __game.world.type, time: lv.time, frames: lv._frames, hasEnv: !!lv._elevEnv, envMap: !!s?.envMap, envI: s?.envMapIntensity, rough: s?.roughness, metal: s?.metalness, envInt: __engine.scene.environmentIntensity };
  const door = lv.elevatorDoors?.[0];
  out.doorMat = door ? { same: door.material === s, name: door.material.name, envMap: !!door.material.envMap, probe: !!door.material.userData?.probe, type: door.material.type, color: door.material.color?.getHexString(), map: !!door.material.map } : null;
  out.doorVisible = door ? door.visible && !!door.parent : null;
  const prog = __engine.renderer.info.programs?.find?.((p) => p.name === 'elevator_steel' || (p.cacheKey || '').includes('elevator'));
  out.prog = !!prog; out.engineFrame = __engine.frame; out.gameTime = __game.time; out.loading = __game.loading; out.state = __game.state;
  // sample the captured env by rendering a test: capture again into a small cube RT and read pixels of each face
  const THREE = __engine.scene.constructor; void THREE;
  return out;
});
console.log(JSON.stringify(r));
// read back average color of a fresh cube capture
const avg = await page.evaluate(async () => {
  const eng = __engine, R = eng.renderer, scene = eng.scene;
  const T = await import('/node_modules/.vite/deps/three.js').catch(() => null);
  if (!T) return 'no three';
  const crt = new T.WebGLCubeRenderTarget(32, { type: T.HalfFloatType });
  const cam = new T.CubeCamera(0.1, 40, crt); cam.position.set(0, 1.5, 13.6); scene.add(cam); cam.update(R, scene); scene.remove(cam);
  const res = [];
  for (let f = 0; f < 6; f++) { const buf = new Uint16Array(32 * 32 * 4); R.readRenderTargetPixels(crt, 0, 0, 32, 32, buf, f); let s = 0; for (let i = 0; i < buf.length; i += 4) s += T.DataUtils.fromHalfFloat(buf[i + 1]); res.push(+(s / 1024).toFixed(3)); }
  return res;
});
console.log('cube face mean G (linear):', JSON.stringify(avg));
await browser.close();
