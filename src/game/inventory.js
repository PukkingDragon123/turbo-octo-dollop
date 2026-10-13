// 5-slot inventory of pocketable items. Items are plain {type, state} records while pocketed;
// dropping one asks the host to spawn the physical prop again.
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
    if (i < 0 || i >= SLOTS) return;
    if (i !== this.selected) { this.selected = i; this.version++; }
  }
  cycle(d) { this.select((this.selected + d + SLOTS) % SLOTS); }
  clear() { this.slots.fill(null); this.version++; }
  serialize() { return this.slots.map((s) => (s ? { type: s.type, state: s.state } : null)); }
  restore(arr) { if (Array.isArray(arr)) { this.slots = arr.slice(0, SLOTS); while (this.slots.length < SLOTS) this.slots.push(null); this.version++; } }
}
