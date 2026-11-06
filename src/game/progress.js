// Survival progression (game.survival): what the team has made, how far it has come, and the light guidance.
//   progress -> { tool, shelter, bench, nights, crafted, broke, day }   tiers (read by the radio voices, game/radio.js):
//     tool     0 bare hands, 1 crude (sharpened stick, rock hammer, torch), 2 scrap (pry bar, saw, knife, spear,
//              nail bat), 3 better gear (hatchet, padded armour, lantern, backpack), 4 crossbow
//     shelter  0 none, 1 a sleeping spot, 2 + light or warmth, 3 + a door or barricades and storage,
//              4 fortified (bed, door, stove, light, storage, insulation, traps)  (game/shelter.js rates it)
//     bench    0 none, 1 workbench, 2 + vise, 3 + soldering kit
//   Host authoritative ('svProg' replicates it); hand crafts are reported by the crafter ('svCraft').
//   Milestones unlock the commendations (core/profile.js ACHIEVEMENTS) and their cosmetics.
//   Notes: the scribbled notes read so far (NOTES app), the recipe notes (RECIPES app, the field notebook).
//   Narration: a handful of one-off lines in the clone's own head when something first matters. Never a checklist.
import { net } from '../net/net.js';
import { profile } from '../core/profile.js';
import { floatText } from '../ui/floattext.js';
import { setWatchApps } from '../ui/watch.js';
import { RECIPES, TIER_NAMES, recipeText } from './crafting.js';
import { itemName } from './itemdefs.js';
import { WATCH_APPS } from './economy.js';

export const TOOL_TIER = {
  sharp_stick: 1, rock_hammer: 1, torch: 1,
  crowbar: 2, saw: 2, knife: 2, spear: 2, bat: 2, wrench: 2, weapon_pipe: 2,
  hatchet: 3, padded_vest: 3, lantern: 3, backpack: 3, machete: 3, hard_hat: 3,
  crossbow: 4,
};
const NARRATE = '#e9e0bd';
// one-off lines (key -> text); spoken at most once a run
const LINES = {
  wake: 'Carpet under your cheek. The lights hum. Nobody is coming.',
  notebook: 'A notebook lies by your hand. Someone was here before you.',
  hungry: 'Your stomach is empty. Break rooms, fridges, vending machines.',
  thirsty: 'Thirsty. Water coolers. A puddle, if you have a bottle, but boil it.',
  furniture: 'Furniture comes apart if you hit it hard enough. Better with a tool.',
  cold: 'Cold. A fire, a stove, a roof over you. Or keep moving.',
  dusk: 'The hum drops. It is getting cold. Find somewhere to sleep.',
  dawn: 'Morning, of a kind. The lights come back up.',
  bench: 'A bench. Lay the parts on it and they make better things.',
  bed: 'Your bed now. If you die, this is where you wake up.',
};

export class SurvivalProgress {
  constructor(game) {
    this.game = game;
    this.reset();
    this._bind();
    this._registerWatch();
  }

  reset() {
    this.state = { tool: 0, shelter: 0, bench: 0, nights: 0, crafted: 0, broke: 0, made: {}, stuns: 0 };
    this.notes = [];         // local: [{ i, text }] notes read, newest first
    this.said = new Set();   // local: narration lines spoken
    this.discoveries = new Map(); // local: key -> { kind, pos, label }
    this._discT = 0;
    this._lineT = 0;
  }

  get progress() {
    const s = this.state;
    return { tool: s.tool, shelter: s.shelter, bench: s.bench, nights: s.nights, crafted: s.crafted, broke: s.broke, day: this.game.day?.day || 1 };
  }

  get active() { return !!this.game.world?.level?.mission?.survival; }

  _bind() {
    net.onClient('svProg', (s) => { if (!net.isHost) Object.assign(this.state, s); });
    net.onHost('svCraft', (d, from) => { const r = RECIPES.find((x) => x.id === d.id); if (r) this.hostCrafted(r, from, 0); });
    net.onHost('svHave', (d) => this._raise('tool', TOOL_TIER[d.type] || 0));
    net.onClient('svLine', (d) => this.say(d.k));
  }

  push() { if (net.isHost) net.toAll('svProg', this.state); }

  _raise(k, v) {
    if (!net.isHost || !(v > this.state[k])) return false;
    this.state[k] = v;
    this.push();
    return true;
  }

  // ------------------------------------------------------------------ events
  // local: something was made in this clone's hands
  onCrafted(r, where) {
    profile.unlock('craft');
    if (TOOL_TIER[r.out]) profile.unlock('quota');
    if (net.isHost) this.hostCrafted(r, net.selfId, 0);
    else net.toHost('svCraft', { id: r.id, where });
  }

  // host: a recipe was made (by hand or at a bench of `tier`)
  hostCrafted(r, from, tier) {
    const s = this.state;
    s.crafted++;
    if (r.out) s.made[r.out] = (s.made[r.out] || 0) + 1;
    if (TOOL_TIER[r.out]) s.tool = Math.max(s.tool, TOOL_TIER[r.out]);
    if (r.out === 'scrap_bench') { s.bench = Math.max(s.bench, 1); this.game.unlockAll('generators'); }
    if (r.upgrade) s.bench = Math.max(s.bench, r.upgrade);
    if (tier > 0) s.bench = Math.max(s.bench, tier);
    if (TOOL_TIER[r.out]) { if (from === net.selfId) profile.unlock('quota'); else net.toPeer(from, 'ach', 'quota'); }
    if (from === net.selfId) profile.unlock('craft'); else net.toPeer(from, 'ach', 'craft');
    this.push();
    if (r.out === 'scrap_bench') this.lineAll('bench');
  }

  hostDismantled(type, from, yields) {
    const s = this.state;
    s.broke++;
    if (s.broke >= 40) this.game.unlockAll('asset_stripper');
    this.push();
    void type; void from; void yields;
  }

  hostShelter(tier) {
    if (!this._raise('shelter', tier)) return;
    if (tier >= 1) this.game.unlockAll('crate');
    if (tier >= 4) this.game.unlockAll('escape_fund');
  }

  // host: a new day began; prev -> day
  hostDawn(day) {
    const s = this.state;
    s.nights = Math.max(s.nights, day - 1);
    this.push();
    if (day === 2) this.game.unlockAll('night_owl');
    if (day === 5 && (this.game.run?.deaths || 0) === 0) this.game.unlockAll('ironclad');
  }

  // local: the clone picked something up (a better tool counts toward the tool tier)
  onPicked(type) {
    const t = TOOL_TIER[type] || 0;
    if (t > this.state.tool) { if (net.isHost) this._raise('tool', t); else net.toHost('svHave', { type }); }
  }

  // local: something was eaten / drunk
  onUsed(type) {
    if (/_cooked$/.test(type) || type === 'canned_food_hot') profile.unlock('researcher');
  }

  // local: a scribbled note was read
  onNote(i, text) {
    if (!this.notes.find((n) => n.i === i)) this.notes.unshift({ i, text });
    if (this.notes.length > 30) this.notes.pop();
    if (this._noteTotal && this.notes.filter((n) => n.i >= 0).length >= this._noteTotal) profile.unlock('dossier');
  }
  set noteTotal(n) { this._noteTotal = n; }

  // ------------------------------------------------------------------ narration
  say(k, force = false) {
    if (!LINES[k] || (this.said.has(k) && !force)) return;
    if (this.game.local?.dead) return;
    this.said.add(k);
    floatText.notice(LINES[k], { color: NARRATE, duration: 3 + LINES[k].length * 0.05 });
  }
  lineAll(k) { if (net.isHost) net.toAll('svLine', { k }); }

  // host: count the Bacteria being hit (wraps the creature combat's damage once per world)
  _wrapStuns() {
    const cmb = this.game.world?.monsters?.combat;
    if (!net.isHost || !cmb?.damage || cmb._svWrapped) return;
    cmb._svWrapped = true;
    const orig = cmb.damage.bind(cmb);
    cmb.damage = (a, dmg, dir, o = {}) => {
      const r = orig(a, dmg, dir, o);
      if (a?.type === 'bacteria' && o.from) { this.state.stuns++; if (this.state.stuns >= 3) this.game.unlockAll('bacteria_basher'); }
      return r;
    };
  }

  // ------------------------------------------------------------------ per frame (every peer, local clone)
  update(dt) {
    if (!this.active) return;
    this._wrapStuns();
    const g = this.game, l = g.local, s = l.survival;
    if (!l.world || l.dead || g.cutscene) return;
    this._lineT -= dt;
    if (this._lineT <= 0) {
      this._lineT = 1;
      if (s.hunger < 62) this.say('hungry');
      if (s.thirst < 58) this.say('thirsty');
      if ((s.warmth ?? 100) < 38) this.say('cold');
    }
    this._discT -= dt;
    if (this._discT <= 0) { this._discT = 1.5; this._discover(); }
  }

  // things worth remembering on the map: water, food, benches, old camps
  _discover() {
    const g = this.game, w = g.world, p = g.local.pos;
    if (!w || this.discoveries.size > 60) return;
    for (const d of w.devices.values()) {
      const k = d.key || '';
      const kind = /water_cooler/.test(k) ? 'water' : /vending|fridge|coffee/.test(k) ? 'food' : k === 'workbench' ? 'bench' : null;
      if (!kind || this.discoveries.has(d.id)) continue;
      if (d.root.position.distanceTo(p) < 7) this.discoveries.set(d.id, { kind, pos: d.root.position.clone(), label: kind === 'bench' ? 'BENCH' : '' });
    }
    w.props.query(p, 7, (pr) => {
      const kind = pr.type === 'tent_ruin' || pr.type === 'camp_stove' ? 'camp' : pr.type.startsWith('vending') || pr.type === 'fridge' ? 'food' : pr.type === 'water_cooler' || pr.type === 'water_jug' ? 'water' : null;
      const key = kind === 'camp' ? `camp:${Math.round(pr.root.position.x / 6)},${Math.round(pr.root.position.z / 6)}` : `p${pr.id}`;
      if (!kind || this.discoveries.has(key)) return;
      this.discoveries.set(key, { kind, pos: pr.root.position.clone(), label: kind === 'camp' ? 'OLD CAMP' : '' });
    });
  }

  // map pins for the watch (merged into mission.markers())
  discoveryMarkers() {
    const out = [];
    for (const d of this.discoveries.values()) out.push({ kind: d.kind === 'water' ? 'file' : d.kind === 'food' ? 'gen' : 'spot', pos: d.pos, label: d.label || (d.kind === 'water' ? 'WATER' : 'FOOD') });
    return out;
  }

  // ------------------------------------------------------------------ the recipe book (notebook, RECIPES app)
  // recipes worth showing now: everything up to one tier above the best bench the team has
  book() {
    const tier = this.state.bench;
    const out = [];
    for (let t = 0; t <= 3; t++) {
      const list = RECIPES.filter((r) => r.at === t && !r.hidden && r.note);
      if (!list.length) continue;
      out.push({ tier: t, title: TIER_NAMES[t], open: t <= Math.max(1, tier) || t === 0, items: list.map((r) => ({ id: r.id, name: r.out ? itemName(r.out) : r.id === 'radio_fix' ? 'Fix the radio' : 'Load the crossbow', parts: recipeText(r), note: r.note })) });
      if (t > tier + 1) break;
    }
    return out;
  }

  // ------------------------------------------------------------------ watch apps
  _registerWatch() {
    const self = this;
    const list = WATCH_APPS.map((a) => ({ ...a }));
    const rec = list.find((a) => a.id === 'recipes');
    if (rec) rec.draw = (c, K, t, y0) => self._drawRecipes(c, K, t, y0);
    const notes = list.find((a) => a.id === 'notes');
    if (notes) notes.draw = (c, K, t, y0) => self._drawNotes(c, K, t, y0);
    try {
      setWatchApps(list, () => (self.active ? ['status', 'map', 'recipes', 'notes'] : null));
    } catch (e) { console.warn('[survival] watch apps', e); }
  }

  // RECIPES: the recipe notes of the open tiers, a page at a time (pages turn by themselves)
  _drawRecipes(c, K, t, y0) {
    const book = this.book().filter((b) => b.open);
    const rows = [];
    for (const b of book) { rows.push({ head: b.title.toUpperCase() }); for (const it of b.items) rows.push(it); }
    const per = 7, pages = Math.max(1, Math.ceil(rows.length / per)), pg = Math.floor(t / 5) % pages;
    let y = y0;
    for (const r of rows.slice(pg * per, pg * per + per)) {
      if (r.head) { K.txt(c, r.head, 4, y, K.SM, K.DIM, 'left', K.AW - 8); K.rule(c, 4 + K.tw(c, r.head, K.SM) + 3, K.AW - 4, y + 3.5, K.LINE, 0.25); y += 9; continue; }
      K.txt(c, r.name.toUpperCase(), 4, y, K.M, K.INK, 'left', 58);
      K.txt(c, r.parts, 64, y + 1, K.SM, K.DIM, 'left', K.AW - 68);
      y += 11;
    }
    K.txt(c, `${pg + 1}/${pages}`, K.AW - 4, K.AH - 9, K.SM, K.DIM, 'right');
    const next = this.book().find((b) => !b.open);
    if (next) K.txt(c, `NEXT: ${next.title.toUpperCase()}`, 4, K.AH - 9, K.SM, K.DIM, 'left', K.AW - 30);
  }

  // NOTES: the notes read so far, newest first, scrolling
  _drawNotes(c, K, t, y0) {
    if (!this.notes.length) {
      K.txt(c, 'NOTHING YET', K.AW / 2, y0 + 30, K.M, K.DIM, 'center');
      K.txt(c, 'READ WHAT OTHERS LEFT BEHIND', K.AW / 2, y0 + 44, K.SM, K.DIM, 'center', K.AW - 8);
      return;
    }
    const lines = [];
    for (const n of this.notes) { for (const ln of K.wrap(c, `"${n.text}"`, K.AW - 10, K.M)) lines.push(ln); lines.push(''); }
    const view = 9, total = Math.max(1, lines.length - view + 1), off = Math.floor(t / 2.2) % total;
    let y = y0;
    for (const ln of lines.slice(off, off + view)) { if (ln) K.txt(c, ln, 5, y, K.M, K.INK, 'left', K.AW - 10); y += 10; }
  }

  dispose() {}
}

// the field notebook you wake up next to: a canvas page for the paper view (game/paper.js)
export function drawNotebook(cv, book, notes = []) {
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.fillStyle = '#efe4c8'; c.fillRect(0, 0, W, H);
  // ruled lines, a margin, coffee ring
  c.strokeStyle = 'rgba(80,110,150,0.28)'; c.lineWidth = 2;
  for (let y = 120; y < H - 20; y += 44) { c.beginPath(); c.moveTo(20, y); c.lineTo(W - 20, y); c.stroke(); }
  c.strokeStyle = 'rgba(170,60,50,0.35)'; c.beginPath(); c.moveTo(78, 0); c.lineTo(78, H); c.stroke();
  c.strokeStyle = 'rgba(120,80,40,0.18)'; c.lineWidth = 9; c.beginPath(); c.arc(W - 120, H - 150, 70, 0.3, 5.6); c.stroke();
  const ink = '#2c2418';
  c.fillStyle = ink;
  c.font = '64px "Jolly Lodger", Georgia, serif';
  c.fillText('Things I worked out', 96, 86);
  let y = 150;
  c.font = '38px "Jolly Lodger", Georgia, serif';
  const line = (s, x = 96, col = ink) => { c.fillStyle = col; c.fillText(s, x, y); y += 44; };
  for (const b of book) {
    if (y > H - 80) break;
    if (!b.open) { line(`(${b.title}: ...?)`, 96, 'rgba(44,36,24,0.55)'); continue; }
    line(b.title === 'hands' ? 'With just my hands (hold the bits, [R]):' : `At a ${b.title}:`, 96, '#6a2a1a');
    for (const it of b.items) {
      if (y > H - 80) break;
      line(`- ${it.name}: ${it.parts}`, 120);
    }
    y += 10;
  }
  if (notes.length && y < H - 140) {
    line('Also found:', 96, '#6a2a1a');
    for (const n of notes.slice(0, 3)) { if (y > H - 60) break; line(`"${n.text.slice(0, 60)}${n.text.length > 60 ? '...' : ''}"`, 120, 'rgba(44,36,24,0.8)'); }
  }
  return cv;
}

