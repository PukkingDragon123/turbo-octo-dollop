// The Bacteria — background sculptor: builds the shared body template off the main thread and
// hands the raw arrays back (transferred, no copies).
import { buildTemplateData } from './bacteria_sculpt.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== 'build') return;
  try {
    const d = buildTemplateData();
    self.postMessage({ type: 'template', d }, [d.pos.buffer, d.nor.buffer, d.si.buffer, d.sw.buffer, d.tis.buffer, d.idx.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.stack) || err) });
  }
};
