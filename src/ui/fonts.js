// The game's type palette: hand-drawn and vintage faces (OFL / Apache, bundled via @fontsource).
// Use the role names, not raw families, so the look can be retuned in one place.
//   FONT.speech  floating speech (EB Garamond)
//   FONT.hand    scribbled handwriting: notes, notices, Healthity asides
//   FONT.marker  thick felt marker: warnings, labels, graffiti
//   FONT.scrawl  frantic scrawl: wall writing, horror notes
//   FONT.messy   loose pencil: margins, doodles
//   FONT.type    worn typewriter: files, forms, receipts
//   FONT.print   old letterpress: posters, official notices
//   FONT.title   vintage western/display: titles, signs
//   FONT.deco    art-deco display: corporate signage
//   FONT.horror  dripping horror display: scares
//   FONT.mono / FONT.crt  clean mono / CRT pixel for terminals and the watch
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/permanent-marker';
import '@fontsource/rock-salt';
import '@fontsource/reenie-beanie';
import '@fontsource/special-elite';
import '@fontsource/im-fell-english';
import '@fontsource/rye';
import '@fontsource/limelight';
import '@fontsource/creepster';
import '@fontsource/courier-prime';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/500-italic.css';
import '@fontsource/eb-garamond/700.css';

export const FONT = {
  speech: '"EB Garamond", Garamond, Georgia, serif',
  hand: '"Caveat", "Comic Sans MS", cursive',
  marker: '"Permanent Marker", "Caveat", cursive',
  scrawl: '"Rock Salt", "Permanent Marker", cursive',
  messy: '"Reenie Beanie", "Caveat", cursive',
  type: '"Special Elite", "Courier Prime", "Courier New", monospace',
  print: '"IM Fell English", Georgia, serif',
  title: '"Rye", "IM Fell English", Georgia, serif',
  deco: '"Limelight", "IM Fell English", Georgia, serif',
  horror: '"Creepster", "Rock Salt", cursive',
  mono: '"Courier Prime", "IBM Plex Mono", monospace',
  crt: '"VT323", "IBM Plex Mono", monospace',
};

// resolve once the faces are usable in canvas text (canvas doesn't trigger font loading by itself)
export function loadFonts(timeout = 4000) {
  const faces = ['400 32px "Caveat"', '700 32px "Caveat"', '32px "Permanent Marker"', '32px "Rock Salt"', '32px "Reenie Beanie"',
    '32px "Special Elite"', '32px "IM Fell English"', '32px "Rye"', '32px "Limelight"', '32px "Creepster"', '32px "Courier Prime"', '500 32px "EB Garamond"', 'italic 500 32px "EB Garamond"', '700 32px "EB Garamond"'];
  return Promise.race([
    Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, timeout)),
  ]);
}
