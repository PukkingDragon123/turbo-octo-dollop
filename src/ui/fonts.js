// The game's type palette: one family per kind of text (the 12 slots of the "R.O.O.M. Font Slots" picker).
// Change a family in SLOT_FAMILY (and its @fontsource import below) and every caller of that slot follows.
//   speech    what characters say, floating next to them
//   name      the small speaker name above speech
//   hint      short tips at the bottom of the screen, DOM UI (loading, death, prompts, touch buttons)
//   label     hover / click pop-ups on objects
//   sign      menu signs and factory stencils
//   title     the game name
//   note      handwritten notes taped to things
//   receipt   receipts, forms, printed files
//   terminal  store / quest screens
//   watch     wrist watch apps
//   wall      wall scrawls and graffiti
//   poster    official signs and posters in the levels
// Canvas text: font('speech', 48) -> '400 48px "Jolly Lodger", Georgia, serif' (the slot's own weight).
// The old role names (main, hand, type, crt...) stay as aliases of the slots that replaced them.
import '@fontsource/jolly-lodger/400.css';

// The user's choice: Jolly Lodger for every piece of text in the game. The slots stay so a single kind
// of text can still be given its own face later.
const GAME_FONT = 'Jolly Lodger';
export const SLOT_FAMILY = {
  speech: GAME_FONT,
  name: GAME_FONT,
  hint: GAME_FONT,
  label: GAME_FONT,
  sign: GAME_FONT,
  title: GAME_FONT,
  note: GAME_FONT,
  receipt: GAME_FONT,
  terminal: GAME_FONT,
  watch: GAME_FONT,
  wall: GAME_FONT,
  poster: GAME_FONT,
};

// weight each family reads best at (anything not listed is drawn at its regular 400: no faux bold)
const WEIGHT = { 'Cormorant Garamond': 600, 'EB Garamond': 500 };
const MONO = new Set(['Special Elite', 'Courier Prime', 'Cutive Mono', 'IBM Plex Mono', 'Xanh Mono', 'Major Mono Display', 'VT323', 'Share Tech Mono', 'Syne Mono', 'Anonymous Pro']);
const stack = (f) => `"${f}", ${MONO.has(f) ? '"Jolly Lodger", Georgia, serif' : 'Georgia, serif'}`;

export const FONT = Object.fromEntries(Object.entries(SLOT_FAMILY).map(([k, f]) => [k, stack(f)]));
Object.assign(FONT, {
  main: FONT.speech,
  hand: FONT.note,
  marker: FONT.note,
  messy: FONT.note,
  scrawl: FONT.wall,
  horror: FONT.wall,
  type: FONT.receipt,
  print: FONT.poster,
  deco: FONT.poster,
  mono: FONT.terminal,
  crt: FONT.terminal,
});

export function weightOf(slot) { return WEIGHT[SLOT_FAMILY[slot]] || 400; }
// canvas font string for a slot at a pixel size
export function font(slot, px, { weight } = {}) {
  return `${weight ?? weightOf(slot)} ${Math.round(px)}px ${FONT[slot] || FONT.speech}`;
}

// resolve once the faces are usable in canvas text (canvas doesn't trigger font loading by itself)
export function loadFonts(timeout = 4000) {
  const faces = new Set(Object.keys(SLOT_FAMILY).map((k) => `${weightOf(k)} 32px "${SLOT_FAMILY[k]}"`));
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--lux-font', FONT.hint);
  return Promise.race([
    Promise.all([...faces].map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, timeout)),
  ]);
}
