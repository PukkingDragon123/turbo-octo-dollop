// Inventory of pocketable items: 5 slots in the hands (game/hands.js), more in a worn backpack (game/gear.js).
// Items are plain {type, state} records while carried; dropping one asks the host to spawn the physical prop again.
export const SLOTS = 5;

export class Inventory {
  constructor() {
    this.slots = new Array(SLOTS).fill(null);
    this.selected = 0;
    this.version = 0;
  }
  get current() { return this.slots[this.selected]; }
  firstFree() { return this.slots.findIndex((s) => !s); }
  hasFree() { return this.firstFree() >= 0; }
  add(item) {
    // prefer the selected slot if empty
    let i = this.slots[this.selected] ? this.firstFree() : this.selected;
    if (i < 0) return -1;
    this.slots[i] = { type: item.type, state: { ...(item.state || {}) } };
    this.version++;
    return i;
  }
  remove(i = this.selected) {
    const it = this.slots[i];
    this.slots[i] = null;
    this.version++;
    return it;
  }
  find(type) { return this.slots.findIndex((s) => s && s.type === type); }
  count(type) { return this.slots.filter((s) => s && s.type === type).length; }
  select(i) {
    if (i < 0 || i >= SLOTS) return; // only hand slots can be held
    if (i !== this.selected) { this.selected = i; this.version++; }
  }
  cycle(d) { this.select((this.selected + d + SLOTS) % SLOTS); }
  // grow / shrink (a backpack); what no longer fits goes to drop(item)
  setCapacity(n, drop = null) {
    n = Math.max(SLOTS, n | 0);
    if (n === this.slots.length) return;
    while (this.slots.length < n) this.slots.push(null);
    while (this.slots.length > n) { const it = this.slots.pop(); if (it) drop?.(it); }
    this.version++;
  }
  clear() { this.slots.fill(null); this.version++; }
  serialize() { return this.slots.map((s) => (s ? { type: s.type, state: s.state } : null)); }
  restore(arr) { if (Array.isArray(arr)) { const n = Math.max(SLOTS, this.slots.length); this.slots = arr.slice(0, n); while (this.slots.length < n) this.slots.push(null); this.version++; } }
}
