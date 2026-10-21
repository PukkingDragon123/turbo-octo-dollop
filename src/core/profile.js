// Persistent player profile (localStorage): name, cosmetics, settings, achievements, lifetime stats.
// Only cosmetics and achievements persist between runs — no gameplay upgrades.
const KEY = 'room_profile_v1';

export const ACHIEVEMENTS = {
  first_day: { name: 'First Day on the Job', desc: 'Get dispatched into the Backrooms.' },
  survive3: { name: 'Probationary Period', desc: 'Survive until Day 3.' },
  survivor7: { name: 'Seven Day Week', desc: 'Reach Day 7 in a dimension.' },
  generators: { name: 'Generator Whisperer', desc: 'Repair all three generators.' },
  escape: { name: 'Escape Artist', desc: 'Evacuate through the exit door.' },
  bullseye: { name: 'Bullseye', desc: 'Hit a bullseye in the break room.' },
  photo_bacteria: { name: 'Say Cheese', desc: 'Photograph the Bacteria and live.' },
  stilllife: { name: 'Still Life Painter', desc: 'Photograph a Still Life.' },
  cloned: { name: 'Clone Again', desc: 'Get brought back on a cloning pad.' },
  hydrated: { name: 'Hydration Champion', desc: 'Drink 10 almond-based beverages.' },
  ratcatcher: { name: 'Pest Control', desc: 'Catch a rat in a sample jar.' },
  disposable: { name: 'Truly Disposable', desc: 'Die 10 times.' },
  teamlift: { name: 'Team Building Exercise', desc: 'Carry something with 3 clones at once.' },
  vending: { name: 'Snack Attack', desc: 'Buy 10 things from vending machines.' },
  welder: { name: 'Hot Work Permit', desc: 'Weld something to something else.' },
  crate: { name: 'Air Mail', desc: 'Order a supply crate.' },
  researcher: { name: 'Employee of the Month', desc: 'Earn $250,000 in one run.' },
  aquarium: { name: 'Fish Out of Water', desc: 'Break the aquarium.' },
  sleepy: { name: 'Power Nap', desc: 'Sleep in the Backrooms.' },
  craft: { name: 'Arts & Crafts', desc: 'Craft something at a workbench.' },
  medic: { name: 'Field Medic', desc: 'Stop your own bleeding with a bandage or medkit.' },
  quota: { name: 'Quota Met', desc: 'Earn your first $1,000 at the crusher.' },
  collector: { name: 'Specimen Collector', desc: 'Deposit 5 research samples.' },
  revived: { name: 'Back From the Vat', desc: 'Re-clone a teammate at the cloning pad.' },
  lost: { name: 'Hopelessly Lost', desc: 'Wander more than 150 m from where you landed.' },
  night_owl: { name: 'Night Owl', desc: 'Sleep through a nap in the Backrooms.' },
  // ---- hard quests of the quest tree (game/economy.js QUEST_TREES): each one unlocks a special cosmetic
  //      (entities/doll/dollcos.js entries with unlock: <id>). hard: shown with a star on the trophy wall.
  escape_fund: { name: 'Escape Velocity', desc: 'Fill a level\'s $1,000,000 escape fund.', hard: true, cosmetic: 'skin:gilded' },
  asset_stripper: { name: 'Asset Stripper', desc: 'Deliver $500,000 to the crusher in one level.', hard: true, cosmetic: 'suit:liquidator' },
  ironclad: { name: 'Ironclad', desc: 'Reach Day 5 without a single re-clone.', hard: true, cosmetic: 'suit:ironclad' },
  bacteria_basher: { name: 'Bacteria Basher', desc: 'Stun the Bacteria 3 times.', hard: true, cosmetic: 'suit:basher' },
  dossier: { name: 'Complete Dossier', desc: 'Recover all 6 case files and study 15 things.', hard: true, cosmetic: 'suit:archivist' },
  grid_restored: { name: 'Grid Restored', desc: 'Get all 3 maze generators running.', hard: true, cosmetic: 'suit:lineman' },
};
// achievement id -> 'slot:id' of the cosmetic it unlocks (for the trophy wall)
export const ACHIEVEMENT_COSMETICS = Object.fromEntries(Object.entries(ACHIEVEMENTS).filter(([, a]) => a.cosmetic).map(([k, a]) => [k, a.cosmetic]));

const DEFAULTS = {
  name: '',
  cosmetics: null,
  settings: {
    master: 0.85, sfx: 1, music: 0.6, ambient: 0.9, voice: 1,
    sensitivity: 1, invertY: false, quality: 'medium', fov: 72,
    voiceMode: 'open', // 'open' | 'ptt' | 'off'
    hrtf: true, grain: true,
  },
  achievements: {},
  stats: { runs: 0, deaths: 0, escapes: 0, credits: 0, almond: 0, vending: 0 },
};

class Profile {
  constructor() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = { ...this.data, ...d, settings: { ...this.data.settings, ...(d.settings || {}) }, stats: { ...this.data.stats, ...(d.stats || {}) } };
      }
    } catch (e) { /* storage blocked */ }
    if (!this.data.name) this.data.name = 'Clone-' + Math.floor(1000 + Math.random() * 8999);
    this.listeners = [];
  }
  get name() { return this.data.name; }
  set name(v) { this.data.name = String(v).slice(0, 16) || this.data.name; this.save(); }
  get settings() { return this.data.settings; }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }
  has(id) { return !!this.data.achievements[id]; }
  unlock(id) {
    if (!ACHIEVEMENTS[id] || this.data.achievements[id]) return false;
    this.data.achievements[id] = Date.now();
    this.save();
    for (const l of this.listeners) l(id, ACHIEVEMENTS[id]);
    return true;
  }
  onUnlock(fn) { this.listeners.push(fn); }
  stat(k, add = 1) {
    this.data.stats[k] = (this.data.stats[k] || 0) + add;
    this.save();
    return this.data.stats[k];
  }
  isUnlocked(unlockId) { return !unlockId || this.has(unlockId); }
}

export const profile = new Profile();
