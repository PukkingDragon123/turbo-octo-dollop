// Persistent player profile (localStorage): name, cosmetics, settings, achievements, lifetime stats.
// Only cosmetics and achievements persist between runs — no gameplay upgrades.
const KEY = 'room_profile_v1';

// Survival milestones. The ids are kept (the cosmetics in entities/doll/dollcos.js unlock by id); what they
// stand for is the survival loop: waking up, the first tool, a bench, a shelter, the first night, the radio, out.
// game/progress.js unlocks most of them; game/radio.js unlocks radio_contact, grid_restored and escape.
export const ACHIEVEMENTS = {
  first_day: { name: 'Rise and Shine', desc: 'Wake up in the Backrooms.' },
  craft: { name: 'Handmade', desc: 'Put two things together into something new.' },
  quota: { name: 'First Tool', desc: 'Make your first tool.' },
  generators: { name: 'Workshop', desc: 'Build a workbench.' },
  crate: { name: 'A Roof of Sorts', desc: 'Lie down in a bed and claim a shelter.' },
  researcher: { name: 'Home Cooking', desc: 'Eat a meal you cooked on a stove.' },
  night_owl: { name: 'Night Owl', desc: 'Live through your first night.' },
  sleepy: { name: 'Power Nap', desc: 'Sleep in a bed you made.' },
  survive3: { name: 'Three Days In', desc: 'Survive until Day 3.' },
  survivor7: { name: 'Seven Day Week', desc: 'Reach Day 7 in a dimension.' },
  radio_contact: { name: 'Is Anyone There?', desc: 'Hear another voice on the radio.' },
  escape: { name: 'Escape Artist', desc: 'Get out of the Backrooms alive.' },
  bullseye: { name: 'Bullseye', desc: 'Hit a bullseye in the break room.' },
  photo_bacteria: { name: 'Say Cheese', desc: 'Photograph the Bacteria and live.' },
  stilllife: { name: 'Still Life Painter', desc: 'Photograph a Still Life.' },
  cloned: { name: 'Not Again', desc: 'Die and wake up again.' },
  revived: { name: 'Home Again', desc: 'Wake up again in your own bed.' },
  hydrated: { name: 'Hydration Champion', desc: 'Drink 10 almond-based beverages.' },
  ratcatcher: { name: 'Pest Control', desc: 'Catch a rat in a sample jar.' },
  disposable: { name: 'Truly Disposable', desc: 'Die 10 times.' },
  teamlift: { name: 'Heavy Lifting', desc: 'Carry something with 3 clones at once.' },
  vending: { name: 'Snack Attack', desc: 'Get 10 things out of vending machines.' },
  welder: { name: 'Hot Work', desc: 'Fix something to something else with the multitool.' },
  collector: { name: 'Hoarder', desc: 'Fill a storage crate.' },
  aquarium: { name: 'Fish Out of Water', desc: 'Break the aquarium.' },
  medic: { name: 'Field Medic', desc: 'Stop your own bleeding with a bandage.' },
  lost: { name: 'Hopelessly Lost', desc: 'Wander more than 150 m from where you woke up.' },
  // ---- hard ones: each unlocks a special cosmetic (entities/doll/dollcos.js entries with unlock: <id>);
  //      hard: shown with a star on the trophy wall
  escape_fund: { name: 'Fortified', desc: 'A shelter with a bed, a door, storage, a stove, a light, insulation and a trap.', hard: true, cosmetic: 'skin:gilded' },
  asset_stripper: { name: 'Scrapper', desc: 'Take 40 things apart in one run.', hard: true, cosmetic: 'suit:liquidator' },
  ironclad: { name: 'Ironclad', desc: 'Reach Day 5 without anyone dying.', hard: true, cosmetic: 'suit:ironclad' },
  bacteria_basher: { name: 'Bacteria Basher', desc: 'Stun the Bacteria 3 times.', hard: true, cosmetic: 'suit:basher' },
  dossier: { name: 'Archivist', desc: 'Read every note the earlier clones left.', hard: true, cosmetic: 'suit:archivist' },
  grid_restored: { name: 'Long Range', desc: 'Fit the radio with an antenna, a tuning coil and an amplifier.', hard: true, cosmetic: 'suit:lineman' },
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
