// Level registry. Add new dimensions here (Poolrooms, Grasslands, Endless Hotel...).
// Each level class implements: build(onProgress), spawnPoint(i, lateJoin, arrival), hostStart(desc),
// update(dt), startAudio(), sampleLight(pos, out), surfaceAt(x,z), waterDepth(x,z),
// sampleKindAt(hit), serialize()/applySync(), spawnBody()/removeBody(), dispose().
import { LobbyLevel } from './lobby.js';
import { YellowLevel } from './yellow/yellow.js';

export const LEVELS = {
  lobby: { name: 'R.O.O.M. HQ', cls: LobbyLevel, ready: true },
  yellow: { name: 'Level 0 — The Yellow Rooms', cls: YellowLevel, ready: true },
  poolrooms: { name: 'Level 37 — The Poolrooms', cls: null, ready: false },
  grasslands: { name: 'Level 1.1 — The Grasslands', cls: null, ready: false },
  hotel: { name: 'Level 5 — The Endless Hotel', cls: null, ready: false },
  // dimension order for a run; unfinished levels fall back to a deeper Yellow Rooms sector
  order: ['yellow', 'poolrooms', 'grasslands', 'hotel'],
  nextAfter(type, depth) {
    const idx = Math.min(this.order.length - 1, depth); // depth 1 -> order[1]
    const want = this.order[idx];
    return this[want]?.ready ? want : 'yellow';
  },
};

export function createLevel(type, world, desc) {
  const def = LEVELS[type];
  const Cls = def?.cls || YellowLevel;
  return new Cls(world, desc);
}
