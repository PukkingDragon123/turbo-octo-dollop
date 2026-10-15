// Hand-built procedural pixel-art sprites (24x24) for every pocketable item, drawn with the pixel kit's
// ramp shading, then finished with rim light, ink outline and a drop shadow. Unknown items fall back to
// a 3D render that is downsampled and quantized to the house palette (see UI.icon).
import { Pix, C, RAMP, bitmap, mix, PALETTE, rgba, bayer } from './pixelart.js';

const S = 24;
const glass = [C.blue1, C.blue2, '#6fb8e8', C.blue4, C.blue5, C.white];
const copper = [C.br0, C.br1, C.br2, C.br3, C.amber4, C.amber5];

const DRAW = {
  flashlight(p) {
    p.rod(4, 20, 13, 11, 2.6, RAMP.dark, { lo: 0.15, hi: 1 });
    for (const t of [0.25, 0.4, 0.55]) { const x = 4 + 9 * t, y = 20 - 9 * t; p.set(x | 0, y | 0, C.ink); }
    p.rod(12, 12, 16.5, 7.5, 3.6, RAMP.steel, { lo: 0.15 });
    p.rod(16, 8, 17.5, 6.5, 4.1, RAMP.steel, { lo: 0.25, hi: 1 });
    p.disc(18.6, 5.4, 2.4, C.amber4);
    p.set(18, 4, C.white); p.set(19, 4, C.amber5); p.set(18, 5, C.amber5);
    p.rect(8, 14, 2, 2, C.red); p.set(8, 14, C.red4);
  },
  protein_bar(p) {
    p.rod(4, 19, 19, 5, 3.4, RAMP.red, { lo: 0.1 });
    p.rod(9.2, 14.3, 13.6, 10, 3.4, RAMP.paper, { lo: 0.25 });
    p.line(10, 13, 12, 11, C.red2); p.line(11, 14, 13, 12, C.br2);
    for (const [x, y] of [[3, 17], [4, 18], [5, 19], [6, 20], [17, 3], [18, 4], [19, 5], [20, 6]]) p.set(x, y, (x + y) % 2 ? C.red4 : C.red1);
  },
  almond_milk(p) {
    p.poly([[16, 9], [20, 7], [20, 19], [16, 21]], C.paper2);
    p.vgrad(6, 9, 10, 12, RAMP.paper, { lo: 0.5, hi: 0.8 });
    p.poly([[6, 9], [11, 4], [16, 9]], C.paper);
    p.poly([[11, 4], [15, 2], [20, 7], [16, 9]], C.paper3);
    p.line(11, 4, 15, 2, C.white); p.line(11, 3, 15, 1, C.paper2);
    p.rect(6, 12, 10, 5, C.blue2); p.hline(6, 15, 12, C.blue);
    p.poly([[16, 12], [20, 10], [20, 15], [16, 17]], C.blue1);
    p.ellipse(11, 14.5, 2.2, 1.5, C.br3); p.set(10, 14, C.br5);
    p.hline(7, 14, 19, C.paper2);
  },
  bandage(p) {
    p.ellipse(12, 18, 7, 2.6, C.paper3);
    p.cyl(5, 10, 14, 8, RAMP.paper, { lo: 0.35, hi: 0.95 });
    p.ellipse(12, 10, 7, 2.6, (u, v) => (u * u + v * v < 0.12 ? C.paper3 : u * u + v * v < 0.3 ? C.paper2 : C.white));
    p.ellipse(12, 10, 1.6, 0.8, C.ink4);
    p.poly([[18, 13], [21, 16], [20, 21], [17, 18]], C.paper2); p.line(18, 13, 21, 16, C.white);
    p.rect(9, 13, 2, 4, C.red); p.rect(8, 14, 4, 2, C.red);
  },
  multitool(p) {
    p.rod(13, 10, 19.5, 3.5, 1.5, RAMP.steel, { lo: 0.3, hi: 1 });
    p.rod(13, 10, 20, 9, 1.1, RAMP.steel, { lo: 0.2 });
    p.rod(13, 10, 17, 14, 1, RAMP.steel, { lo: 0.25 });
    p.rod(4, 19, 13, 10, 2.8, RAMP.red, { round: true, lo: 0.15 });
    p.rect(8, 13, 1, 3, C.white); p.rect(7, 14, 3, 1, C.white);
    p.disc(13, 10, 1.3, C.st5); p.set(13, 10, C.st2);
  },
  almond_water(p) {
    p.cyl(7, 9, 10, 12, glass, { lo: 0.25 });
    p.cyl(8, 7, 8, 2, glass, { lo: 0.3 });
    p.cyl(9, 5, 6, 2, glass, { lo: 0.4 });
    p.cyl(9, 2, 6, 3, RAMP.paper, { lo: 0.4 });
    p.hline(9, 14, 4, C.paper3);
    p.cyl(7, 12, 10, 5, RAMP.paper, { lo: 0.35, hi: 1 });
    p.ellipse(12, 14.5, 2, 1.4, C.br3); p.set(11, 14, C.br5);
    p.hline(8, 15, 10, C.blue5);
    p.erase(7, 20); p.erase(16, 20);
  },
  energy_drink(p) {
    p.cyl(8, 4, 8, 17, RAMP.dark, { lo: 0.25, hi: 1 });
    p.ellipse(12, 4, 4, 1.3, C.st4); p.hline(10, 13, 4, C.st2); p.set(12, 3, C.st5);
    p.hline(8, 15, 20, C.st3); p.hline(9, 14, 21, C.st2);
    bitmap(['..##', '.##.', '####', '.##.', '##..'], { '#': C.lime }, p, 10, 9);
    p.vline(8, 6, 18, C.lime2);
  },
  soda_can(p) {
    p.cyl(7, 6, 10, 14, RAMP.red, { lo: 0.12 });
    p.ellipse(12, 6, 5, 1.5, C.st4); p.hline(10, 14, 6, C.st2); p.set(13, 5, C.st5);
    p.hline(7, 16, 19, C.st3); p.hline(8, 15, 20, C.st2);
    for (let x = 7; x < 17; x++) { const y = 13 + Math.round(Math.sin(x * 0.9) * 1.2); p.set(x, y, C.white); p.set(x, y + 1, C.red5); }
    bitmap(['##.', '#.#', '##.', '#.#'], { '#': C.white }, p, 10, 8);
  },
  canned_food(p) {
    p.cyl(5, 9, 14, 10, RAMP.steel, { lo: 0.25 });
    p.cyl(5, 11, 14, 6, [C.br0, C.br1, C.br2, C.amber2, C.amber, C.amber4], { lo: 0.2 });
    p.ellipse(12, 9, 7, 2.2, C.st4); p.ellipse(12, 9, 5.5, 1.5, C.st3); p.hline(9, 15, 9, C.st5);
    p.ellipse(10, 14, 2.3, 1.4, C.br1); p.set(9, 13, C.amber4);
    p.ellipse(12, 19, 7, 1.4, C.st1);
  },
  chips(p) {
    p.poly([[6, 4], [18, 4], [19, 12], [18, 20], [6, 20], [5, 12]], (x, y) => Pix.rampAt(RAMP.hazmat, 0.95 - (x - 5) / 16 * 0.55, x, y));
    for (let x = 6; x <= 18; x++) { p.set(x, 4, x % 2 ? C.hz5 : C.hz2); p.set(x, 20, x % 2 ? C.hz4 : C.hz1); p.set(x, 5, C.hz2); p.set(x, 19, C.hz2); }
    p.rect(6, 8, 13, 3, C.red2); p.hline(6, 18, 8, C.red);
    p.ellipse(12, 15, 3.2, 2.2, C.amber4); p.ellipse(12.5, 15.5, 1.5, 1, C.amber2); p.set(11, 14, C.amber5);
  },
  candy_bar(p) {
    p.rod(4, 19, 15, 8, 3, RAMP.purple, { lo: 0.15 });
    p.rod(14, 9, 19, 4, 2.7, RAMP.brown, { lo: 0.15, hi: 0.8 });
    p.set(16, 7, C.br1); p.set(17, 6, C.br1); p.set(15, 6, C.br1); p.set(18, 8, C.br1);
    for (const [x, y] of [[13, 7], [14, 8], [15, 9], [16, 10], [12, 7], [17, 11]]) p.set(x, y, C.pu3);
    p.line(7, 16, 10, 13, C.amber4);
  },
  medkit(p) {
    p.rect(9, 5, 6, 1, C.ink4); p.rect(9, 5, 1, 3, C.ink4); p.rect(14, 5, 1, 3, C.ink4);
    p.poly([[4, 9], [7, 7], [20, 7], [20, 8]], C.paper2);
    p.vgrad(4, 8, 16, 12, RAMP.paper, { lo: 0.45, hi: 0.85 });
    p.vline(19, 8, 19, C.paper3); p.hline(4, 19, 19, C.paper3);
    p.rect(10, 10, 4, 8, C.red2); p.rect(8, 12, 8, 4, C.red2);
    p.rect(10, 10, 4, 1, C.red); p.rect(8, 12, 2, 1, C.red); p.rect(14, 12, 2, 1, C.red);
    p.hline(4, 19, 8, C.white);
  },
  antibiotics(p) {
    p.cyl(8, 9, 8, 11, [C.amber0, C.amber1, C.amber2, '#ff9a2a', C.amber4, C.amber5], { lo: 0.15 });
    p.cyl(7, 4, 10, 5, RAMP.paper, { lo: 0.35, hi: 1 });
    for (let x = 8; x < 17; x += 2) p.vline(x, 5, 7, C.paper2);
    p.cyl(8, 12, 8, 5, RAMP.paper, { lo: 0.4, hi: 1 });
    p.rect(10, 13, 4, 1, C.red2); p.rect(10, 15, 3, 1, C.ink4);
  },
  painkillers(p) {
    p.rbox(4, 5, 16, 15, 1, C.st4);
    p.vgrad(5, 6, 14, 13, RAMP.steel, { lo: 0.55, hi: 0.9 });
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 7.5 + c * 4.5, y = 9.5 + r * 5;
        if (r === 1 && c === 2) { p.ellipse(x, y, 1.6, 1.6, C.st2); p.set(x | 0, (y | 0) - 1, C.st1); continue; }
        p.ellipse(x, y, 1.7, 1.7, C.paper); p.set((x - 1) | 0, (y - 1) | 0, C.white); p.set((x + 0.5) | 0, (y + 0.7) | 0, C.paper3);
      }
    }
    p.hline(5, 18, 6, C.st5);
  },
  splint(p) {
    p.rod(5, 20, 13, 4, 1.6, RAMP.brown, { lo: 0.3 });
    p.rod(10, 20, 18, 4, 1.6, RAMP.brown, { lo: 0.3 });
    p.rod(4, 15, 16, 15, 1.3, RAMP.paper, { lo: 0.4 });
    p.rod(7, 9, 18, 9, 1.3, RAMP.paper, { lo: 0.4 });
  },
  paper_cup(p) {
    p.poly([[6, 7], [18, 7], [16, 21], [8, 21]], (x, y) => Pix.rampAt(RAMP.paper, 0.95 - (x - 6) / 12 * 0.5, x, y));
    p.hline(7, 16, 11, C.blue2); p.hline(7, 16, 12, C.blue1);
    p.ellipse(12, 7, 6, 1.8, C.white); p.ellipse(12, 7.3, 4.8, 1.1, C.blue2); p.hline(10, 13, 7, C.blue4);
  },
  leech(p) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([4 + t * 15, 14 + Math.sin(t * 5.5) * 4]); }
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i], r = 2.8 - Math.abs(i - 5) * 0.16;
      p.ellipse(x, y, r, r, (u, v) => (v < -0.45 ? C.pk2 : v < 0.2 ? C.pk1 : C.pk0));
    }
    for (let i = 1; i < pts.length - 1; i += 2) p.set(pts[i][0] | 0, (pts[i][1] - 2) | 0, C.pk4);
    p.disc(pts[12][0], pts[12][1], 1.5, C.pk0); p.set(pts[12][0] | 0, pts[12][1] | 0, C.red);
  },
  welder(p) {
    p.cyl(3, 9, 7, 12, RAMP.blue, { lo: 0.15 });
    p.ellipse(6.5, 9, 3.5, 1.2, C.blue4);
    p.rect(5, 6, 3, 3, C.st3); p.set(5, 6, C.st5);
    p.line(8, 7, 11, 6, C.ink3);
    p.rod(10, 13, 18, 5, 1.6, copper, { lo: 0.25 });
    p.rod(9, 14, 12, 11, 2.3, RAMP.dark, { lo: 0.2, hi: 1 });
    p.disc(19.5, 3.5, 1.5, C.blue4); p.set(20, 3, C.white); p.set(21, 2, C.blue);
  },
  battery(p) {
    p.rod(5, 18, 15, 8, 3.2, RAMP.dark, { lo: 0.15, hi: 1 });
    p.rod(13.5, 9.5, 16.5, 6.5, 3.2, copper, { lo: 0.2 });
    p.rod(16.5, 6.5, 18.5, 4.5, 1.3, RAMP.steel, { lo: 0.4, hi: 1 });
    p.rect(8, 13, 3, 1, C.lime); p.rect(9, 12, 1, 3, C.lime);
  },
  glowstick(p) {
    for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) {
      const d = Math.abs((x - 6) + (y - 18)) / 1.414; const along = ((x - 6) - (y - 18)) / 1.414;
      if (d < 5.5 && along > -1 && along < 17 && bayer(x, y) < 0.35 - d * 0.05) p.set(x, y, [77, 255, 122, 90]);
    }
    p.rod(6, 18, 17, 7, 2.2, RAMP.lime, { round: true, lo: 0.35, hi: 1 });
    p.rod(16.5, 7.5, 18.5, 5.5, 2.4, RAMP.dark, { lo: 0.3, hi: 1 });
    p.disc(6, 18, 1.5, C.green4);
  },
  flare(p) {
    p.rod(5, 20, 14, 11, 2.4, RAMP.red, { lo: 0.15 });
    p.rod(14, 11, 16.5, 8.5, 2.7, RAMP.dark, { lo: 0.25, hi: 1 });
    p.hline(7, 9, 16, C.paper); p.hline(8, 10, 15, C.paper2);
    for (const [x, y, c] of [[18, 6, C.amber5], [19, 5, C.white], [20, 4, C.amber4], [17, 4, C.amber], [20, 7, C.amber], [21, 3, C.red4], [18, 3, C.amber2]]) p.set(x, y, c);
  },
  lighter(p) {
    p.cyl(7, 12, 10, 9, RAMP.steel, { lo: 0.3, dither: false });
    p.hline(7, 16, 14, C.st1); p.hline(7, 16, 15, C.st5);
    p.rect(8, 9, 6, 3, C.st4); p.rect(9, 10, 1, 1, C.ink2); p.rect(11, 10, 1, 1, C.ink2); p.rect(13, 10, 1, 1, C.ink2);
    p.rect(14, 8, 3, 4, C.st3); p.set(14, 8, C.st5);
    p.ellipse(11, 5, 2.6, 4, (u, v) => (v > 0.35 && Math.abs(u) < 0.5 ? C.blue4 : Math.abs(u) < 0.5 && v > -0.55 ? C.amber5 : C.amber));
    p.set(11, 0, C.red4); p.set(10, 1, C.amber2);
    p.rect(9, 17, 6, 2, C.st2);
  },
  crowbar(p) {
    p.rod(5, 20, 16, 6, 1.4, RAMP.red, { lo: 0.2 });
    p.rod(16, 6, 17, 3, 1.3, RAMP.steel, { lo: 0.3 });
    p.rod(17, 3, 14, 1.6, 1.1, RAMP.steel, { lo: 0.3 });
    p.rod(5, 20, 3, 21, 1.2, RAMP.steel, { lo: 0.3 });
  },
  wrench(p) {
    p.rod(5, 19, 15, 9, 1.8, RAMP.steel, { lo: 0.2 });
    p.disc(17, 7, 3.8, (u, v) => (u + v < -0.6 ? C.st5 : u + v > 0.7 ? C.st2 : C.st4));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x + 0.5 - 19, y + 0.5 - 5) < 2.1) p.erase(x, y);
    p.disc(5, 19, 2.6, C.st3);
    p.erase(5, 19); p.erase(4, 19);
    p.line(8, 15, 12, 11, C.st5);
  },
  tape_roll(p) {
    p.ellipse(12, 15, 8, 5.5, C.st2);
    p.rect(4, 12, 16, 3, C.st3);
    p.ellipse(12, 12, 8, 5.5, (u, v) => (u * u + v * v < 0.28 ? null : u < -0.3 ? C.st5 : u > 0.5 ? C.st3 : C.st4));
    p.ellipse(12, 12, 4, 2.6, C.br3); p.ellipse(12, 12.4, 2.8, 1.7, C.ink3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (((x + 0.5 - 12) / 2.6) ** 2 + ((y + 0.5 - 12.4) / 1.6) ** 2 < 1) p.erase(x, y);
    p.poly([[19, 14], [22, 17], [21, 20], [18, 17]], C.st4); p.set(20, 15, C.st5);
  },
  fuse(p) {
    p.rod(17, 6, 20.5, 2.5, 1, RAMP.steel, { lo: 0.35, hi: 1 });
    p.rod(5, 18, 2, 21, 1, RAMP.steel, { lo: 0.35, hi: 1 });
    p.rod(7.5, 15.5, 14.5, 8.5, 3, RAMP.paper, { lo: 0.35 });
    p.rod(5, 18, 8, 15, 3.3, copper, { lo: 0.25 });
    p.rod(14, 9, 17, 6, 3.3, copper, { lo: 0.25 });
    p.line(10, 13, 12, 11, C.red2);
  },
  sample_jar(p, v) {
    p.cyl(6, 6, 12, 3, RAMP.steel, { lo: 0.3, hi: 1 });
    for (let x = 7; x < 18; x += 2) p.set(x, 7, C.st2);
    p.cyl(6, 9, 12, 12, [C.blue1, '#3a6a8a', '#6a9ab8', '#a8d0e8', C.blue5, C.white], { lo: 0.2, hi: 0.85 });
    if (v === 'full') {
      p.cyl(7, 13, 10, 7, RAMP.lime, { lo: 0.25, hi: 0.8 });
      p.set(9, 15, C.green5); p.set(13, 17, C.lime); p.set(11, 14, '#e8ffa0');
    }
    p.rect(8, 11, 6, 3, C.paper); p.hline(9, 12, 12, C.ink4);
    p.hline(6, 17, 20, '#3a6a8a');
  },
  water_tester(p) {
    p.rod(12, 18, 12, 22, 1, RAMP.steel, { lo: 0.4 });
    p.rbox(7, 3, 10, 16, 2, C.ink3);
    p.vgrad(8, 4, 8, 14, [C.blue0, C.blue1, C.blue2, C.blue, C.blue4, C.blue5], { lo: 0.2, hi: 0.55 });
    p.rect(9, 5, 6, 4, C.green1); p.hline(10, 13, 6, C.green); p.hline(10, 12, 7, C.green2);
    p.disc(10.5, 12.5, 1.2, C.red); p.disc(13.5, 12.5, 1.2, C.paper2); p.rect(10, 15, 4, 1, C.blue1);
  },
  keycard(p) {
    p.rbox(3, 6, 18, 12, 1, C.paper);
    p.vgrad(4, 7, 16, 10, RAMP.paper, { lo: 0.55, hi: 0.85 });
    p.rect(4, 7, 16, 3, C.blue2); p.hline(4, 19, 7, C.blue);
    p.rect(5, 11, 4, 5, C.paper3); p.disc(7, 12.5, 1, C.br2); p.rect(6, 14, 2, 2, C.br2);
    p.rect(11, 12, 4, 3, C.amber2); p.set(12, 13, C.amber5); p.set(13, 13, C.amber1);
    p.hline(11, 18, 16, C.ink4);
  },
  noise_maker(p) {
    p.disc(6, 6, 2.6, C.amber); p.disc(18, 6, 2.6, C.amber); p.set(5, 5, C.amber5); p.set(17, 5, C.amber5);
    p.line(7, 19, 5, 21, C.ink3); p.line(17, 19, 19, 21, C.ink3);
    p.disc(12, 13, 7, (u, v) => (u + v < -0.7 ? C.red4 : u + v > 0.6 ? C.red1 : C.red2));
    p.disc(12, 13, 5, C.paper); p.set(10, 10, C.white);
    p.line(12, 13, 12, 9, C.ink); p.line(12, 13, 15, 14, C.ink);
    p.rect(11, 4, 2, 2, C.st3);
  },
  dart(p) {
    p.poly([[4, 16], [7, 14], [9, 19], [6, 20]], C.red);
    p.poly([[4, 16], [3, 12], [6, 13]], C.red4);
    p.rod(5, 18, 16, 7, 0.9, RAMP.steel, { lo: 0.3 });
    p.rod(9.5, 13.5, 14, 9, 1.6, copper, { lo: 0.3 });
    p.rod(16, 7, 19.5, 3.5, 0.7, RAMP.steel, { lo: 0.6, hi: 1 });
  },
  photo(p) {
    p.rect(5, 3, 14, 17, C.paper);
    p.vgrad(5, 3, 14, 17, RAMP.paper, { lo: 0.6, hi: 0.85 });
    p.rect(7, 5, 10, 9, C.hz2);
    p.dither(7, 5, 10, 9, C.hz, 0.4);
    p.rect(11, 8, 3, 6, C.ink2); p.hline(7, 16, 12, C.hz1); p.hline(7, 16, 13, C.hz1);
    p.rect(8, 6, 2, 1, C.hz5); p.rect(14, 6, 2, 1, C.hz5);
    p.hline(7, 13, 16, C.ink4);
  },
  clipboard(p) {
    p.rbox(5, 4, 14, 18, 1, C.br3);
    p.vgrad(5, 4, 14, 18, RAMP.brown, { lo: 0.4, hi: 0.75 });
    p.rect(7, 7, 10, 13, C.paper); p.vline(16, 7, 19, C.paper2);
    for (const y of [10, 12, 14, 16]) p.hline(8, y === 16 ? 12 : 15, y, C.paper3);
    p.rect(9, 3, 6, 3, C.st3); p.hline(9, 14, 3, C.st5); p.rect(11, 2, 2, 1, C.st2);
  },
  camera_disposable(p) {
    p.rbox(3, 8, 18, 11, 1, C.hz);
    p.vgrad(3, 8, 18, 11, RAMP.hazmat, { lo: 0.35, hi: 0.9 });
    p.rect(3, 15, 18, 4, C.ink3); p.hline(3, 20, 15, C.ink4);
    p.disc(14, 13, 3.6, C.ink); p.disc(14, 13, 2.6, C.st1); p.disc(14, 13, 1.6, C.blue1); p.set(13, 12, C.blue4);
    p.rect(5, 10, 3, 2, C.ink2); p.set(5, 10, C.st3);
    p.rect(17, 6, 3, 2, C.st3);
    p.rect(5, 13, 4, 1, C.paper);
  },
  plank(p) {
    p.rod(4, 19, 19, 5, 2.8, RAMP.brown, { lo: 0.3, hi: 0.95 });
    for (const [a, b] of [[0.2, 0.55], [0.6, 0.85]]) p.line(4 + 15 * a, 18.3 - 14 * a, 4 + 15 * b, 18.3 - 14 * b, C.br2);
    p.set(10, 12, C.br1); p.set(14, 9, C.br1);
  },
  metal_scrap(p) {
    p.poly([[5, 8], [12, 4], [19, 9], [20, 15], [13, 20], [5, 17], [8, 13]], (x, y) => Pix.rampAt(RAMP.steel, 0.9 - (x + y - 10) / 30 * 0.6, x, y));
    p.line(8, 9, 12, 6, C.st5); p.line(13, 18, 19, 14, C.st1);
    p.dither(13, 12, 6, 5, C.br2, 0.35); p.set(15, 14, C.br3);
    p.disc(10, 11, 1.2, C.ink2);
  },
  screws(p) {
    const one = (x, y, ang) => {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      p.rod(x, y, x + dx * 8, y + dy * 8, 0.8, RAMP.steel, { lo: 0.3 });
      for (let i = 2; i < 8; i += 2) p.set((x + dx * i) | 0, (y + dy * i + 1) | 0, C.st1);
      p.disc(x, y, 2, C.st4); p.set(x | 0, y | 0, C.st1); p.set((x - 1) | 0, (y - 1) | 0, C.st5);
    };
    one(5, 6, 0.9); one(13, 5, 1.5); one(9, 13, 0.2);
  },
  fabric_scrap(p) {
    p.poly([[4, 8], [16, 5], [20, 11], [18, 19], [7, 20], [3, 14]], (x, y) => Pix.rampAt(RAMP.hazmat, 0.85 - (x + y - 8) / 34 * 0.6, x, y));
    p.line(5, 10, 16, 7, C.hz5); p.line(9, 13, 17, 16, C.hz2); p.line(6, 17, 11, 15, C.hz2);
    for (let x = 6; x < 18; x += 2) p.set(x, (19 - (x - 6) * 0.05) | 0, C.hz1);
  },
  wire_spool(p) {
    p.ellipse(12, 18, 8, 2.6, C.br1);
    p.cyl(6, 8, 12, 10, copper, { lo: 0.2 });
    for (let y = 9; y < 18; y += 2) p.hline(6, 17, y, C.br2);
    p.ellipse(12, 7, 8, 2.6, (u, v) => (u * u + v * v < 0.12 ? C.ink3 : C.br3));
    p.ellipse(12, 6.5, 7, 2, (u, v) => (u * u + v * v < 0.15 ? C.ink3 : v < 0 ? C.br5 : C.br4));
    p.line(18, 12, 21, 16, C.amber2); p.line(21, 16, 20, 19, C.amber2);
  },
  pipe_short(p) {
    p.rod(4, 18, 16, 8, 3, RAMP.steel, { lo: 0.2 });
    p.disc(17, 7, 3.2, C.st4); p.disc(17, 7, 2.1, C.ink2); p.set(16, 6, C.ink);
    p.rod(5, 17, 7, 15, 3.3, RAMP.steel, { lo: 0.3, hi: 1 });
  },
  gear(p) {
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + 0.2;
      p.rod(12 + Math.cos(a) * 5.5, 12 + Math.sin(a) * 5.5, 12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9, 1.5, RAMP.steel, { lo: 0.3, spec: false });
    }
    p.disc(12, 12, 7, (u, v) => (u + v < -0.5 ? C.st5 : u + v > 0.6 ? C.st2 : C.st3));
    p.ring(12, 12, 4.5, C.st2);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x + 0.5 - 12, y + 0.5 - 12) < 2.2) p.erase(x, y);
  },
  fuel_can(p) {
    p.rbox(4, 7, 15, 14, 1, C.red2);
    p.vgrad(4, 7, 15, 14, RAMP.red, { lo: 0.25, hi: 0.8 });
    p.line(5, 9, 17, 19, C.red1); p.line(5, 19, 17, 9, C.red1);
    p.rect(13, 4, 4, 3, C.st3); p.rect(7, 4, 4, 3, C.ink3); p.hline(7, 10, 4, C.ink4);
    p.hline(5, 17, 8, C.red4);
  },
  coin_pile(p) {
    for (const [x, y] of [[8, 16], [14, 15], [11, 12]]) {
      p.ellipse(x, y + 1.2, 4.5, 2, C.amber1);
      p.ellipse(x, y, 4.5, 2, (u) => (u < -0.3 ? C.amber5 : u > 0.4 ? C.amber2 : C.amber));
    }
  },
};
DRAW.water_cooler_cup = DRAW.paper_cup;

export function hasSprite(type) { return !!DRAW[type]; }

export function itemSprite(type, variant) {
  const f = DRAW[type];
  if (!f) return null;
  const p = new Pix(S, S);
  f(p, variant);
  return p.finish();
}

// Turn a 3D render (canvas, alpha) into a palette-quantized pixel sprite of S x S
export function pixelizeCanvas(cv) {
  const inner = S - 2, src = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const k = cv.width / inner;
  const p = new Pix(S, S);
  const pal = PALETTE.map((c) => rgba(c));
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = Math.floor(y * k); j < Math.floor((y + 1) * k); j++) {
        for (let i = Math.floor(x * k); i < Math.floor((x + 1) * k); i++) {
          const o = (j * cv.width + i) * 4, al = src[o + 3] / 255;
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al; n++;
        }
      }
      if (a / n < 0.45) continue;
      r /= a; g /= a; b /= a;
      // punch up contrast a little before snapping to the palette
      const l = (r + g + b) / 3;
      r = l + (r - l) * 1.25; g = l + (g - l) * 1.25; b = l + (b - l) * 1.25;
      let best = pal[0], bd = Infinity;
      for (const c of pal) {
        const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 + Math.abs((c[0] + c[1] + c[2]) / 3 - l) * 6;
        if (d < bd) { bd = d; best = c; }
      }
      p.set(x + 1, y + 1, best);
    }
  }
  return p.finish();
}

export { mix };
