// Run save slot (localStorage). One slot; Continue in the factory menu reads it.
//   save.has()            -> bool
//   save.load()           -> state | null
//   save.store(state)     -> merges and writes { credits, escape, level, depth, day, inventory, stash, unlocks, quests, cosmetics, t }
//   save.summary()        -> { credits, escape, level, day, inventory:[types], stash:[types], unlocks } for the 3 Continue crates
//   save.clear()
const KEY = 'room_run_v2';

function read() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

export const save = {
  has() { return !!read(); },
  load() { return read(); },
  store(state) {
    const cur = read() || {};
    const next = { ...cur, ...state, t: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* storage blocked */ }
    return next;
  },
  summary() {
    const s = read();
    if (!s) return null;
    return {
      credits: s.credits || 0, escape: s.escape || 0, level: s.level || 'yellow', day: s.day || 1,
      inventory: (s.inventory || []).filter(Boolean), stash: (s.stash || []).filter(Boolean), unlocks: s.unlocks || {}, t: s.t,
    };
  },
  clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
};
