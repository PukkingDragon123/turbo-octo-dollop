// The seven-day reality-collapse clock. Each day lasts exactly 10 real minutes (70 min per
// dimension). Host-authoritative; clients extrapolate between periodic syncs.
import { net } from '../net/net.js';

const q = new URLSearchParams(location.search);
export const DAY_LENGTH = Math.max(20, Number(q.get('daylen')) || 600);
export const DAYS = 7;

// instability per day (start of day -> end of day)
const CURVE = [0.04, 0.1, 0.24, 0.38, 0.58, 0.74, 0.9, 1.0];

export class DayCycle {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.time = 0;
    this.day = 1;
    this.syncT = 0;
    this.collapsed = false;
  }

  reset(active, t0 = 0) {
    this.active = active;
    this.time = t0;
    this.day = this._dayOf(t0);
    this.collapsed = false;
    this.syncT = 0;
  }

  _dayOf(t) { return Math.min(DAYS, Math.floor(t / DAY_LENGTH) + 1); }

  get dayProgress() { return (this.time % DAY_LENGTH) / DAY_LENGTH; }
  get dayTimeLeft() { return Math.max(0, this.day * DAY_LENGTH - this.time); }
  get totalLeft() { return Math.max(0, DAYS * DAY_LENGTH - this.time); }

  // 0..1 how unstable reality is right now
  instability() {
    if (!this.active) return 0;
    const d = this.day - 1;
    const p = Math.min(1, this.dayProgress);
    return CURVE[d] + (CURVE[d + 1] - CURVE[d]) * p;
  }

  // 0 at start of day 7, 1 at total collapse
  collapse() {
    if (!this.active || this.day < 7) return 0;
    return Math.min(1, this.dayProgress);
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const d = this._dayOf(this.time);
    if (d !== this.day) {
      const prev = this.day;
      this.day = d;
      this.game.onDayChange?.(d, prev);
    }
    if (net.isHost) {
      this.syncT -= dt;
      if (this.syncT <= 0) {
        this.syncT = 5;
        net.toRemotes('time', this.serialize());
      }
      if (!this.collapsed && this.time >= DAYS * DAY_LENGTH) {
        this.collapsed = true;
        this.game.onTotalCollapse?.();
      }
    }
  }

  serialize() { return { t: this.time, a: this.active ? 1 : 0 }; }
  sync(d) {
    if (!d) return;
    this.active = !!d.a;
    // smooth small drift, snap large
    if (Math.abs(d.t - this.time) > 2) this.time = d.t;
    else this.time += (d.t - this.time) * 0.5;
    this.day = this._dayOf(this.time);
  }

  clockString() {
    // in-world time label: each day 06:00 -> 06:00 compressed
    const p = this.dayProgress;
    const mins = Math.floor(p * 24 * 60);
    const h = (6 + Math.floor(mins / 60)) % 24, m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  leftString() {
    const s = Math.ceil(this.dayTimeLeft);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
