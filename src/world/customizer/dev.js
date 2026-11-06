// Dev-only harness: the customizer without the game boot (src/world/customizer/dev.html?station=paint&q=low)
import { loadFonts } from '../../ui/fonts.js';
import { engine } from '../../core/engine.js';
import { openCustomizer } from './index.js';

const P = new URLSearchParams(location.search);
(async () => {
  try { await Promise.race([loadFonts(), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { /* */ }
  engine.init(document.body, P.get('q') || 'medium');
  if (P.get('res') === 'fixed') engine.fixedRes = true;
  const cos = P.get('cos') ? JSON.parse(P.get('cos')) : undefined;
  openCustomizer({ game: null, station: P.get('station') || 'paint', cosmetics: cos, onDone: (c) => { window.__done = c; } });
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!window.__noRender) engine.render(dt);
  };
  requestAnimationFrame(frame);
  window.__engine = engine;
})();
