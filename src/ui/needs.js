// Top-left survival patch: a stitched hazmat-fabric badge sewn onto the clone's sleeve, drawn in pixel art.
// A little stomach (with a face) and a water drop sit beside chunky segmented gauges: nutrient paste that
// wobbles and water that sloshes and bubbles. Health is a subtle heart + pip strip along the bottom, and a
// paper price tag with the shift's credits vs. quota hangs off the patch once selling starts.
// Low values pulse and shake; the stomach growls when hunger crosses a threshold. The first time needs
// switch on, the patch slides in, gets sewn on stitch by stitch, its gauges fill and the stomach growls.
import { Pix, C, RAMP, mix, text, textWidth, FONT3, heart, coin, bayer, bitmap } from './pixelart.js';

import { audio } from '../audio/audio.js';
import { damp } from '../core/rng.js';

const STOMACH = [
  '.....+#.......',
  '.....+#.......',
  '.....+#-......',
  '.....+##-.....',
  '...+++###--...',
  '..++o######-..',
  '.++o########-.',
  '.+##########-.',
  '.+##########=.',
  '.+#########-=.',
  '..+-######-=..',
  '..+=.-----=...',
  '.+-...====....',
  '.+=...........',
];
const STOMACH_SQ = [
  '.....+#.......',
  '.....+#.......',
  '.....+#-......',
  '....++##-.....',
  '..++++###--...',
  '.++o#######-..',
  '+#o#########-.',
  '+###########=.',
  '+###########=.',
  '.+-########-=.',
  '..+=-------=..',
  '..+==.====....',
  '.+-...........',
  '.+=...........',
];
const W = 94, H = 60;          // canvas (art px)
const PX = 3, PY = 2;          // patch origin
const PW = 86, PH = 40;        // patch size
const BAR_X = 19, BAR_W = 61;  // gauge housing x / width (inner 59 = 10 cells x 5 + 9 dividers)
const CELLS = 10;

// gauge fill colours per row (top highlight .. bottom shade)
const ROWS = {
  paste: [C.amber4, C.amber, C.amber, C.amber2, C.amber2, C.br3, C.br2],
  water: [C.blue4, C.blue, C.blue, C.blue2, C.blue2, C.blue1, C.blue1],
  danger: [C.red4, C.red, C.red, C.red2, C.red2, C.red1, C.red1],
};

// stitch path around the inside of the patch (ordered, so it can be sewn on progressively)
function stitchPath() {
  const pts = [], x0 = PX + 3, y0 = PY + 3, x1 = PX + PW - 4, y1 = PY + PH - 4;
  for (let x = x0 + 2; x <= x1 - 2; x++) pts.push([x, y0]);
  pts.push([x1 - 1, y0 + 1]);
  for (let y = y0 + 2; y <= y1 - 2; y++) pts.push([x1, y]);
  pts.push([x1 - 1, y1 - 1]);
  for (let x = x1 - 2; x >= x0 + 2; x--) pts.push([x, y1]);
  pts.push([x0 + 1, y1 - 1]);
  for (let y = y1 - 2; y >= y0 + 2; y--) pts.push([x0, y]);
  pts.push([x0 + 1, y0 + 1]);
  return pts;
}
const STITCH = stitchPath();

export class NeedsWidget {
  constructor(parent) {
    this.cv = document.createElement('canvas');
    this.cv.id = 'pxneeds';
    this.cv.width = W; this.cv.height = H;
    parent.appendChild(this.cv);
    this.pix = new Pix(W, H);
    this.base = null;       // cached fabric patch (without stitches)
    this.t = 0;
    this.drawT = 0;
    this.shown = false;
    this.revealed = false;  // the big first-time reveal has played
    this.reveal = 1;        // 0..1 progress of the current reveal (1 = done)
    this.revealLen = 2.8;
    this.fade = 0;
    this.disp = { hunger: 100, thirst: 100, health: 100 };
    this.flash = { hunger: 0, thirst: 0, health: 0 };
    this.growlT = 0;
    this.growlCool = 0;
    this.lastH = null;
    this.money = null;      // { credits, quota } once selling starts
    this.moneyDisp = 0;
    this.moneyFlash = 0;
    this.bubbles = Array.from({ length: 5 }, (_, i) => ({ x: Math.random(), y: 1 + i * 0.25, s: 0.6 + Math.random() * 0.6 }));
    this.scale = 2;
  }

  get bottomPx() {
    if (!this.shown) return 0;
    const r = this.cv.getBoundingClientRect();
    return r.top + (this.money ? H : PY + PH + 2) * (r.height / H);
  }

  setScale(s) {
    if (s === this.scale && this.cv.style.width) return;
    this.scale = s;
    this.cv.style.width = `${W * s}px`;
    this.cv.style.height = `${H * s}px`;
  }

  // show/hide; `first` plays the long reveal the first time needs become active
  setVisible(on) {
    if (on === this.shown) return;
    this.shown = on;
    this.cv.classList.toggle('show', on);
    if (on) {
      if (!this.revealed) { this.revealed = true; this.reveal = 0; this.revealLen = 2.8; } else { this.reveal = 0.55; this.revealLen = 1.2; }
    }
  }

  update(dt, s, money) {
    this.t += dt;
    if (!this.shown || !s) return;
    const prevR = this.reveal;
    if (this.reveal < 1) this.reveal = Math.min(1, this.reveal + dt / this.revealLen);
    // the stomach growls at the end of the first reveal
    if (prevR < 0.82 && this.reveal >= 0.82 && this.revealLen > 2) this.growl(true, false);
    const hunger = clampV(s.hunger), thirst = clampV(s.thirst), health = clampV(s.health);
    // gauges ease toward the real value; refills flash
    for (const [k, v] of [['hunger', hunger], ['thirst', thirst], ['health', health]]) {
      const d = this.disp[k];
      if (v > d + 0.5) this.flash[k] = 1;
      this.disp[k] = damp(d, v, v > d ? 4 : 6, dt);
      this.flash[k] = Math.max(0, this.flash[k] - dt * 1.6);
    }
    // hunger threshold crossings make the stomach growl
    if (this.lastH !== null) {
      for (const th of [50, 30, 15]) if (this.lastH > th && hunger <= th) this.growl();
    }
    this.lastH = hunger;
    this.growlCool -= dt;
    if (hunger < 20 && this.growlCool <= 0 && this.reveal >= 1) this.growl();
    this.growlT = Math.max(0, this.growlT - dt);
    // money tag
    if (money) {
      if (!this.money || money.credits !== this.money.credits) this.moneyFlash = this.money ? 1 : 0.6;
      this.money = money;
      this.moneyDisp = damp(this.moneyDisp, money.credits, 5, dt);
      if (Math.abs(this.moneyDisp - money.credits) < 0.5) this.moneyDisp = money.credits;
    } else this.money = null;
    this.moneyFlash = Math.max(0, this.moneyFlash - dt * 1.5);
    this.speed = s.speed || 0;
    // ~20 fps is plenty for pixel animation
    this.drawT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 1 / 20;
    this._draw(s);
  }

  // wobble + squiggles; the reveal growl is silent because the mission plays its own stomach sound then
  growl(force = false, sound = true) {
    if (!force && this.growlCool > 0) return;
    this.growlT = 1.5;
    this.growlCool = 22;
    if (sound && audio.ready) audio.play('_gurgle', { volume: 0.5, pitch: 0.5, bus: 'ui' });
  }

  // ------------------------------------------------------------------
  _patch() {
    if (this.base) return this.base;
    const p = new Pix(W, H);
    // fabric: worn hazmat twill with a darker bound edge
    p.rbox(PX, PY, PW, PH, 4, C.ink);
    p.rbox(PX + 1, PY + 1, PW - 2, PH - 2, 3, C.hz1);
    for (let y = PY + 2; y < PY + PH - 2; y++) {
      for (let x = PX + 2; x < PX + PW - 2; x++) {
        if (!p.a(x, y) || p.get(x, y)[0] === rgba0(C.ink)) continue;
        const tw = (x + y * 2) & 3;
        let c = tw === 0 ? C.hz1 : tw === 2 ? mix(C.hz2, C.hz, 0.35) : C.hz2;
        // wear: lighter toward the top-left, grime toward the bottom-right
        const v = (x - PX) / PW * 0.5 + (y - PY) / PH * 0.5;
        if (v < 0.3 && bayer(x, y) < 0.3 - v) c = C.hz;
        if (v > 0.72 && bayer(x + 1, y) < (v - 0.72) * 1.4) c = C.hz1;
        p.set(x, y, c);
      }
    }
    // bound edge: light top/left, shadowed bottom/right
    for (let x = PX + 3; x < PX + PW - 3; x++) { p.set(x, PY + 1, C.hz4); p.set(x, PY + PH - 2, C.hz0); }
    for (let y = PY + 3; y < PY + PH - 3; y++) { p.set(PX + 1, y, C.hz); p.set(PX + PW - 2, y, C.hz0); }
    // drop shadow onto the "world"
    const sh = new Pix(W, H);
    sh.rbox(PX + 1, PY + 2, PW, PH, 4, [0, 0, 0, 110]);
    sh.blit(p, 0, 0);
    // gauge housings (recessed grooves)
    for (const y of [PY + 5, PY + 19]) this._housing(sh, BAR_X + PX - 3, y);
    // health strip groove
    sh.rect(PX + 15, PY + 32, 63, 5, mix(C.hz1, C.ink, 0.35));
    sh.hline(PX + 15, PX + 77, PY + 32, mix(C.hz1, C.ink, 0.6));
    sh.hline(PX + 15, PX + 77, PY + 37, C.hz4);
    this.base = sh;
    return sh;
  }

  _housing(p, x, y) {
    p.rect(x, y, BAR_W, 9, C.ink);
    p.rect(x + 1, y + 1, BAR_W - 2, 7, C.ink2);
    p.hline(x + 1, x + BAR_W - 2, y + 1, C.ink);
    p.hline(x, x + BAR_W - 1, y + 9, C.hz4); // fabric lip under the groove catches light
  }

  _draw(s) {
    const p = this.pix;
    const t = this.t;
    p.clear();
    const R = this.reveal;
    const ease = (a, b) => Math.max(0, Math.min(1, (R - a) / (b - a)));
    // slide in from the left with a small overshoot
    const k = ease(0, 0.22);
    const ox = Math.round((1 - k) * -(PW + 8) + Math.sin(k * Math.PI) * 3);
    // shake: low values + growl
    const low = Math.min(this.disp.hunger, this.disp.thirst);
    let sx = 0, sy = 0;
    if (this.growlT > 0) { sx = Math.round(Math.sin(t * 55) * 1.2); sy = Math.round(Math.cos(t * 41) * 0.7); }
    else if (low < 12 && R >= 1) sx = Math.round(Math.sin(t * 40) * (Math.floor(t * 2) % 3 === 0 ? 1 : 0));
    const dx = ox + sx, dy = sy;
    p.blit(this._patch(), dx, dy);
    // stitches: sewn on progressively during the reveal
    const sewn = Math.floor(STITCH.length * ease(0.18, 0.5));
    for (let i = 0; i < sewn; i++) {
      if (i % 4 >= 2) continue;
      const [x, y] = STITCH[i];
      p.set(x + dx, y + dy, C.hz5);
      p.set(x + dx + 1, y + dy + 1, C.hz0);
    }
    if (sewn > 0 && sewn < STITCH.length) { const [x, y] = STITCH[sewn]; p.set(x + dx, y + dy - 1, C.st5); p.set(x + dx, y + dy - 2, C.st4); p.set(x + dx, y + dy, C.white); }
    const iconK = ease(0.42, 0.55);
    const fillK = ease(0.5, 0.8);
    if (iconK > 0) {
      this._stomach(p, PX + 4 + dx, PY + 3 + dy, iconK);
      this._drop(p, PX + 4 + dx, PY + 17 + dy, iconK);
    }
    // gauges
    const hx = BAR_X + PX - 2 + dx;
    this._gauge(p, hx, PY + 6 + dy, this.disp.hunger / 100 * fillK, 'paste', this.flash.hunger);
    this._gauge(p, hx, PY + 20 + dy, this.disp.thirst / 100 * fillK, 'water', this.flash.thirst);
    // health heart + pips
    const hp = this.disp.health;
    const beat = hp < 35 ? (Math.sin(t * (6 + (35 - hp) * 0.15)) > 0.6 ? 1 : 0) : (Math.sin(t * 2.4) > 0.94 ? 1 : 0);
    heart(p, PX + 5 + dx, PY + 31 + dy, true, beat);
    const pipOn = Math.ceil(hp / 10 * fillK - 0.001);
    for (let i = 0; i < 10; i++) {
      const x = PX + 16 + i * 6 + dx, y = PY + 33 + dy;
      const on = i < pipOn;
      const crit = hp < 30 && on && Math.floor(t * 4) % 2;
      p.rect(x, y, 5, 3, on ? (crit ? C.red4 : C.red2) : mix(C.hz1, C.ink, 0.6));
      if (on) { p.hline(x, x + 4, y, crit ? C.red5 : C.red); p.set(x, y, C.red5); p.hline(x, x + 4, y + 2, C.red1); }
      if (on && this.flash.health > 0 && i === pipOn - 1) p.rect(x, y, 5, 3, alphaC(C.white, this.flash.health));
    }
    // growl squiggles beside the stomach
    if (this.growlT > 0) {
      const ph = Math.floor(t * 10) % 2;
      const gx = PX + 15 + dx, gy = PY + 2 + dy;
      for (const [x, y] of ph ? [[0, 0], [1, 1], [0, 2], [1, 3]] : [[1, 0], [0, 1], [1, 2], [0, 3]]) p.set(gx + x, gy + y, C.ink);
      for (const [x, y] of ph ? [[0, 8], [1, 9], [0, 10]] : [[1, 8], [0, 9], [1, 10]]) p.set(gx - 14 + x, gy + y + 2, C.ink);
    }
    // money price tag hanging off the patch
    if (this.money && R > 0.5) this._tag(p, dx, t);
    // reveal: the whole patch flashes once as the needle finishes
    if (R > 0.48 && R < 0.53) p.tint(PX + dx, PY + dy, PW, PH, (c) => mix(c, C.white, 0.35));
    p.toCanvas(this.cv);
  }

  _gauge(p, x, y, f, kind, flash) {
    const t = this.t;
    const innerW = BAR_W - 2;
    const lowV = f < 0.25;
    const rows = lowV ? ROWS.danger : kind === 'water' ? ROWS.water : ROWS.paste;
    const blink = lowV && Math.floor(t * 3) % 2 === 0;
    const amp = kind === 'water' ? 1.1 + Math.min(1.5, (this.speed || 0) * 0.25) : 0.45;
    const edge = f * innerW;
    for (let j = 0; j < 7; j++) {
      // the leading edge sloshes row by row
      const e = edge + (edge > 0.5 ? Math.sin(t * (kind === 'water' ? 7 : 3.5) + j * 0.9) * amp * Math.min(1, edge / 6) : 0);
      const base = rows[j];
      for (let i = 0; i < innerW; i++) {
        if (i + 0.5 > e) break;
        let c = base;
        if (kind === 'paste' && !lowV && j > 0) {
          const h = (i * 7 + j * 13) % 19;
          if (h === 0) c = C.br1; else if (h === 9 && j < 4) c = C.amber5;
        }
        if (kind === 'water' && !lowV && j > 1 && (i * 5 + j * 3 + Math.floor(t * 6)) % 29 === 0) c = C.blue4;
        if (blink) c = mix(c, C.white, 0.22);
        p.set(x + i, y + j, c);
      }
      // meniscus: the last pixel of each row is a shade lighter
      const ei = Math.floor(e) - 1;
      if (ei >= 0 && ei < innerW) p.set(x + ei, y + j, mix(base, C.white, 0.25));
    }
    // surface shine travelling along the top row
    if (edge > 2) {
      const sx = Math.floor((t * (kind === 'water' ? 22 : 9)) % (innerW + 12)) - 6;
      for (let i = sx; i < sx + 4; i++) if (i >= 0 && i < edge - 1) p.set(x + i, y + 1, C.white);
    }
    // bubbles rising through the water
    if (kind === 'water' && edge > 4) {
      for (const b of this.bubbles) {
        b.y -= 0.016 * b.s * 3;
        if (b.y < 0) { b.y = 1; b.x = Math.random(); b.s = 0.6 + Math.random() * 0.6; }
        const bx = Math.floor(b.x * (edge - 3)) + 1, by = 1 + Math.floor(b.y * 5);
        p.set(x + bx, y + by, C.blue5);
      }
    }
    // refill flash
    if (flash > 0) for (let i = 0; i < Math.min(innerW, edge); i++) for (let j = 0; j < 7; j++) if ((i + j + Math.floor(t * 20)) % 6 === 0) p.set(x + i, y + j, alphaC(C.white, flash));
    // cell dividers (the chunky segments); the top highlight row stays continuous
    for (let c = 1; c < CELLS; c++) {
      const cx = x + c * 6 - 1;
      for (let j = 1; j < 7; j++) p.set(cx, y + j, alphaC(C.ink, cx - x < edge ? 0.5 : 0.9));
    }
    // empty cells: faint glass sockets
    for (let c = 0; c < CELLS; c++) {
      const cx = x + c * 6;
      if (cx + 3 < edge) continue;
      p.set(cx + 1, y + 1, C.ink4); p.set(cx + 2, y + 1, C.ink3); p.set(cx + 1, y + 2, C.ink3);
    }
  }

  _stomach(p, x, y, k) {
    const t = this.t;
    const g = this.growlT > 0;
    const hungry = this.disp.hunger < 30;
    const wob = g ? Math.round(Math.sin(t * 30)) : 0;
    const sq = g && Math.floor(t * 12) % 2 ? 1 : 0;
    const pop = k < 1 ? Math.round((1 - k) * 4) : 0;
    const s = new Pix(14, 14);
    // hand-drawn organ: esophagus on top, big lobe, duodenum curling out at the bottom left
    bitmap(sq ? STOMACH_SQ : STOMACH, { '+': C.pk4, '#': C.pk3, '-': C.pk2, '=': C.pk1, 'o': C.pk5 }, s, 0, 0);
    // face on the big lobe
    const ey = 7 + sq;
    if (g) { s.set(6, ey, C.ink); s.set(10, ey, C.ink); s.rect(7, ey + 2, 3, 2, C.ink); s.set(8, ey + 2, C.pk1); }
    else if (hungry) { s.set(6, ey, C.ink); s.set(10, ey, C.ink); s.hline(7, 9, ey + 2, C.ink); s.set(6, ey + 3, C.ink); s.set(10, ey + 3, C.ink); }
    else { s.set(6, ey, C.ink); s.set(10, ey, C.ink); s.set(7, ey + 2, C.ink); s.set(8, ey + 3, C.ink); s.set(9, ey + 2, C.ink); s.set(5, ey + 1, C.pk4); s.set(11, ey + 1, C.pk4); }
    s.outline(C.ink).shadow(0.4);
    p.blit(s, x + wob, y - pop);
  }

  _drop(p, x, y, k) {
    const t = this.t;
    const thirsty = this.disp.thirst < 30;
    const pop = k < 1 ? Math.round((1 - k) * 4) : 0;
    const sq = thirsty ? (Math.floor(t * 3) % 2) : (Math.sin(t * 2.2) > 0.7 ? 1 : 0);
    const s = new Pix(14, 14);
    // teardrop: round bottom + pointed top
    s.ellipse(7, 9 - sq * 0.3, 4.6 + sq * 0.3, 4.2 - sq * 0.3, (u, v) => (u + v < -0.7 ? C.blue5 : u + v > 0.6 ? C.blue1 : u < -0.1 ? C.blue : C.blue2));
    s.poly([[7, 1 + sq], [10.6, 7.5], [3.4, 7.5]], (xx) => (xx < 6 ? C.blue4 : xx < 8 ? C.blue : C.blue2));
    s.set(5, 8, C.white); s.set(5, 9, C.blue5); s.set(6, 6, C.blue5);
    if (thirsty) { s.set(5, 10, C.ink); s.set(8, 10, C.ink); s.hline(6, 7, 12, C.ink); }
    s.outline(C.ink).shadow(0.4);
    p.blit(s, x, y - pop);
  }

  _tag(p, dx, t) {
    const m = this.money;
    const cr = Math.round(this.moneyDisp);
    const quota = m.quota;
    const s1 = `${cr}`, s2 = quota ? `/${quota}` : ' CR';
    const tw = textWidth(s1, FONT3) + textWidth(s2, FONT3) + 1;
    const w = 7 + 2 + tw + 4, h = 11;
    const x = PX + PW - w - 3 + dx, y = PY + PH + 6;
    const sway = Math.round(Math.sin(t * 1.3) * 0.6);
    // string from the patch
    p.vline(x + 4 + sway, PY + PH - 1, y, C.paper3);
    // tag body with notched left corners and a punched hole
    const met = quota && m.credits >= quota;
    const col = met ? mix(C.paper, C.green4, 0.35) : C.paper;
    p.rect(x + 1 + sway, y + 1, w, h, [0, 0, 0, 90]);
    p.poly([[x + sway, y + 2], [x + 2 + sway, y], [x + w + sway, y], [x + w + sway, y + h], [x + 2 + sway, y + h], [x + sway, y + h - 2]], col);
    p.hline(x + 2 + sway, x + w - 1 + sway, y, C.white);
    p.hline(x + 2 + sway, x + w - 1 + sway, y + h - 1, C.paper2);
    p.set(x + 3 + sway, y + 2, C.ink3);
    if (this.moneyFlash > 0) p.tint(x + sway, y, w + 1, h, (c) => mix(c, C.amber5, this.moneyFlash * 0.7));
    coin(p, x + 3 + sway, y + 2, this.moneyFlash > 0 ? t : 0);
    let tx = x + 12 + sway;
    tx += text(p, s1, tx, y + 3, met ? C.green1 : C.ink, { font: FONT3 }) + 1;
    text(p, s2, tx, y + 3, C.paper3, { font: FONT3 });
    // outline around tag
    p.hline(x + 2 + sway, x + w + sway, y - 1, C.ink);
  }
}

function clampV(v) { return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 100)); }
function rgba0(c) { return parseInt(c.slice(1, 3), 16); }
function alphaC(c, a) { const h = c.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), Math.round(a * 255)]; }
function rampAt(ramp, v, x, y) { return Pix.rampAt(ramp, v, x, y, true); }
