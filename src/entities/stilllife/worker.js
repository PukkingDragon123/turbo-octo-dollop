// Still Lifes — background builder: sculpts, meshes and skins every variant's template (and the
// shared detail textures) off the main thread, then hands the raw arrays over (transferred).
import * as watcher from './watcher.js';
import * as tall from './tall.js';
import * as twin from './twin.js';
import * as crawler from './crawler.js';
import * as mass from './mass.js';
import { textureData, TEX_NAMES } from './textures.js';

const BUILDERS = { watcher, tall, twin, crawler, mass };

function geoData(g, transfer) {
  if (!g) return null;
  const attrs = {};
  for (const [name, a] of Object.entries(g.attributes)) { attrs[name] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized }; transfer.push(a.array.buffer); }
  const index = g.index ? g.index.array : null;
  if (index) transfer.push(index.buffer);
  return { attrs, index };
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'build') {
    for (const v of msg.variants) {
      try {
        const t0 = performance.now();
        const tpl = BUILDERS[v].template();
        const transfer = [];
        const out = {
          type: 'template', variant: v, ms: performance.now() - t0,
          spec: { names: tpl.spec.names, parent: tpl.spec.parent, pos: tpl.spec.pos },
          body: geoData(tpl.body, transfer), parts: geoData(tpl.parts, transfer), cloth: geoData(tpl.cloth, transfer),
          bounds: [tpl.bounds.center.x, tpl.bounds.center.y, tpl.bounds.center.z, tpl.bounds.radius],
          height: tpl.height, radius: tpl.radius, meta: tpl.meta, stats: tpl.stats,
        };
        self.postMessage(out, transfer);
      } catch (err) {
        self.postMessage({ type: 'error', variant: v, error: String(err && err.stack || err) });
      }
    }
    if (msg.textures) for (const n of TEX_NAMES) { const d = textureData(n); self.postMessage({ type: 'texture', ...d }, [d.data.buffer]); }
    self.postMessage({ type: 'done' });
  }
};
