// Background render worker: synthesizes one-shot variations and instrument samples off the main thread.
import { renderShot } from './sfx.js';
import { renderNote } from './music.js';

self.onmessage = (e) => {
  const { id, kind, name, i, len, instr, zone, vt } = e.data;
  try {
    const r = kind === 'note' ? renderNote(instr, zone, vt) : renderShot(name, i, len);
    if (!r) throw new Error('unknown ' + (name || instr));
    self.postMessage({ id, chs: r.chs, sr: r.sr }, r.chs.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
