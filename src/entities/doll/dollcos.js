// R.O.O.M. — cosmetics catalogue. Ids and unlock achievement ids are stable (saved profiles
// reference them). Every 'suit' entry is a colourway / finish of the R.O.O.M. work coverall the
// clone androids wear (the old hazmat colourways); 'skin' is the finish of the android's ABS shell
// and porcelain face plate; 'face' picks the painted face (and the eye hardware).
// Body plan (robotmorph.js deforms the cached geometry): 'frame' (masc / fem / neutral proportions),
// 'skull' (head shape: s = head scale, jaw = extra jaw scale), 'build' (body shape) and 'eyes'
// (s = eyeball scale, iris colour, led = 'red' swaps the LED pupil, pupil = LED disc scale).
// Entries with `unlock` are commendation rewards (ids in core/profile.js ACHIEVEMENTS).
import { RNG, hashString } from '../../core/rng.js';

export const COSMETICS = {
  suit: [
    { id: 'yellow', name: 'Standard Issue', outfit: 'hazmat', color: 0xf3c010, unlock: null },
    { id: 'orange', name: 'Safety Orange', outfit: 'hazmat', color: 0xf0761a, unlock: null },
    { id: 'white', name: 'Cleanroom White', outfit: 'hazmat', color: 0xecebe4, unlock: null },
    { id: 'blue', name: 'Coolant Blue', outfit: 'hazmat', color: 0x3a80d6, unlock: null },
    { id: 'pink', name: 'Bubblegum', outfit: 'hazmat', color: 0xf19ac0, unlock: null },
    { id: 'mint', name: 'Mint Condition', outfit: 'hazmat', color: 0x84dcb8, unlock: null },
    { id: 'lavender', name: 'Lavender Haze', outfit: 'hazmat', color: 0xb09ae4, unlock: null },
    { id: 'hawaiian', name: 'Vacation Mode', outfit: 'hazmat', pattern: 'hawaiian', color: 0xec6fa6, unlock: null },
    { id: 'fleece', name: 'Weekend Hiker', outfit: 'hazmat', color: 0xc8962c, unlock: null },
    { id: 'orange_hivis', name: 'Hi-Vis Crew', outfit: 'hazmat', color: 0xf26812, unlock: null },
    { id: 'navy_jacket', name: 'Night Shift', outfit: 'hazmat', color: 0x2a3654, unlock: null },
    { id: 'red', name: 'Code Red', outfit: 'hazmat', color: 0xd3382c, unlock: 'medic' },
    { id: 'black', name: 'Disposable', outfit: 'hazmat', color: 0x2b2b31, unlock: 'disposable' },
    { id: 'camo', name: 'Survivor Camo', outfit: 'hazmat', color: 0x6e7444, pattern: 'camo', unlock: 'survivor7' },
    { id: 'gold', name: 'Golden Employee', outfit: 'hazmat', color: 0xe8b43e, gloss: true, unlock: 'quota' },
    { id: 'chrome', name: 'Chrome Plated', outfit: 'hazmat', color: 0xc9ced6, gloss: true, unlock: 'generators' },
    // hard-quest rewards (game/economy.js quest tree -> profile.js ACHIEVEMENTS)
    { id: 'liquidator', name: 'Liquidator', outfit: 'hazmat', color: 0x3b3f46, gloss: true, unlock: 'asset_stripper' },
    { id: 'ironclad', name: 'Ironclad', outfit: 'hazmat', color: 0x8c9096, gloss: true, unlock: 'ironclad' },
    { id: 'basher', name: 'Bacteria Basher', outfit: 'hazmat', color: 0x6a1418, unlock: 'bacteria_basher' },
    { id: 'archivist', name: 'Archivist Manila', outfit: 'hazmat', color: 0xc9a868, unlock: 'dossier' },
    { id: 'lineman', name: 'Lineman Teal', outfit: 'hazmat', color: 0x1f6f5c, unlock: 'grid_restored' },
  ],
  skin: [
    { id: 'tan', name: 'Yellowed ABS', color: 0xe0d2b0, unlock: null },
    { id: 'light', name: 'Factory White', color: 0xf0ebdf, unlock: null },
    { id: 'dark', name: 'Walnut Bakelite', color: 0x7c5a40, unlock: null },
    { id: 'grey', name: 'Primer Grey', color: 0xa3a19b, unlock: null },
    { id: 'rose', name: 'Dusty Rose', color: 0xe6bcae, unlock: 'night_owl' },
    { id: 'gilded', name: 'Gilded Shell', color: 0xd9b04a, unlock: 'escape_fund' },
  ],
  hat: [
    { id: 'none', name: 'No Hat', unlock: null },
    { id: 'bucket', name: 'Sunny Bucket Hat', color: 0xdccdaa, unlock: null },
    { id: 'beanie', name: 'Pom-Pom Beanie', color: 0x2f4d34, color2: 0x7da66b, unlock: null },
    { id: 'hardhat', name: 'Hazard Hard Hat', color: 0xf2c418, color2: 0x1d1d1f, unlock: null },
    { id: 'party', name: 'Party Hat', color: 0x46b6e8, color2: 0xf6d24a, unlock: null },
    { id: 'cone', name: 'Traffic Cone', color: 0xf26a1b, unlock: null },
    { id: 'propeller', name: 'Propeller Cap', unlock: null },
    { id: 'chef', name: 'Chef Toque', color: 0xf8f6f0, unlock: null },
    { id: 'sprout', name: 'Little Sprout', unlock: null },
    { id: 'headlamp', name: 'Headlamp', unlock: null },
    { id: 'tophat', name: 'Top Hat', color: 0x1d1c22, unlock: 'collector' },
    { id: 'bunny', name: 'Bunny Ears', color: 0xf3ece2, unlock: 'bullseye' },
    { id: 'halo', name: 'Halo', unlock: 'revived' },
    { id: 'crown', name: 'Crown', unlock: 'escape' },
  ],
  // face gear (kept under the 'visor' key for API compatibility)
  visor: [
    { id: 'none', name: 'Nothing', unlock: null },
    { id: 'goggles', name: 'Climbing Goggles', unlock: null },
    { id: 'face_shield', name: 'Face Shield', unlock: null },
    { id: 'gas_mask_up', name: 'Respirator', unlock: null },
    { id: 'glasses', name: 'Round Glasses', unlock: null },
    { id: 'sunglasses', name: 'Shades', unlock: 'lost' },
  ],
  face: [
    { id: 'dots', name: 'Classic', unlock: null },
    { id: 'happy', name: 'Sunny', unlock: null, mouth: 'grin', eyeSY: 0.62, brow: 0.008, browRot: -0.12 },
    { id: 'sleepy', name: 'Drowsy', unlock: null, mouth: 'o', eyeSY: 0.35, brow: -0.006 },
    { id: 'grumpy', name: 'Overtime', unlock: null, mouth: 'grumpy', eyeSY: 0.7, browRot: 0.45, brow: -0.008 },
    { id: 'shy', name: 'Bashful', unlock: null, mouth: 'shy', blush: 1.7, browRot: -0.35 },
    { id: 'cat', name: 'Kitty', unlock: null, mouth: 'cat', whiskers: true },
    { id: 'freckles', name: 'Freckles', unlock: null, mouth: 'gap', freckles: true },
    { id: 'button', name: 'Button Eyes', unlock: 'collector', eyes: 'button' },
    { id: 'cyclops', name: 'Cyclops', unlock: 'stilllife', eyes: 'cyclops' },
    { id: 'stitched', name: 'Patched Up', unlock: 'revived', eyes: 'mismatch', scar: true, mouth: 'flat' },
  ],
  backpack: [
    { id: 'tank', name: 'Air Tank', unlock: null },
    { id: 'satchel', name: 'Satchel', unlock: null },
    { id: 'jet', name: 'Jet Pack', unlock: null },
    { id: 'bear', name: 'Teddy Pack', unlock: 'night_owl' },
    { id: 'turtle', name: 'Turtle Shell', unlock: 'survivor7' },
    { id: 'none', name: 'Nothing', unlock: null },
  ],
  accessory: [
    { id: 'none', name: 'None', unlock: null },
    { id: 'scarf', name: 'Checkered Scarf', color: 0x2f5fa8, color2: 0x15171c, unlock: null },
    { id: 'fannypack', name: 'Fanny Pack', color: 0x2c2f35, color2: 0x15161a, unlock: null },
    { id: 'tie', name: 'Office Tie', color: 0x2f4f8f, color2: 0xc94a3a, unlock: null },
    { id: 'bowtie', name: 'Bow Tie', color: 0xd23c4a, unlock: null },
    { id: 'lei', name: 'Flower Lei', unlock: null },
    { id: 'bandana', name: 'Bandana', color: 0xc8302a, unlock: null },
    { id: 'headphones', name: 'Neck Phones', unlock: null },
    { id: 'bell', name: 'Kitty Bell', unlock: 'bullseye' },
    { id: 'badge', name: 'Employee of the Month', unlock: 'quota' },
  ],
};
COSMETICS.frame = [
  { id: 'neutral', name: 'Unisex Frame', unlock: null },
  { id: 'masc', name: 'Frame M-1 Broad', unlock: null },
  { id: 'fem', name: 'Frame F-1 Fine', unlock: null },
];
COSMETICS.skull = [
  { id: 'std', name: 'Standard Skull', s: [1, 1, 1], unlock: null },
  { id: 'round', name: 'Round', s: [1.07, 0.95, 1.04], jaw: [1.04, 0.95, 1], unlock: null },
  { id: 'long', name: 'Long', s: [0.93, 1.11, 0.98], jaw: [0.95, 1.08, 1], unlock: null },
  { id: 'wide', name: 'Wide Jaw', s: [1.12, 0.97, 1.02], jaw: [1.14, 1.06, 1.08], unlock: null },
  { id: 'narrow', name: 'Narrow', s: [0.89, 1.04, 0.97], jaw: [0.88, 1, 0.95], unlock: null },
  { id: 'egg', name: 'Egghead', s: [0.95, 1.17, 1.05], jaw: [0.84, 0.94, 0.94], unlock: null },
  { id: 'bobble', name: 'Bobblehead', s: [1.3, 1.3, 1.3], jaw: [1, 1, 1], unlock: 'hydrated' },
];
COSMETICS.build = [
  { id: 'std', name: 'Standard Build', unlock: null },
  { id: 'slim', name: 'Slim', unlock: null },
  { id: 'stocky', name: 'Stocky', unlock: null },
  { id: 'tall', name: 'Tall', unlock: null },
  { id: 'heavy', name: 'Heavy Lifter', unlock: 'teamlift' },
];
COSMETICS.eyes = [
  { id: 'glass', name: 'Grey Glass', iris: [0.12, 0.16, 0.2], s: 1, unlock: null },
  { id: 'hazel', name: 'Hazel', iris: [0.26, 0.15, 0.06], s: 1, unlock: null },
  { id: 'green', name: 'Bottle Green', iris: [0.07, 0.2, 0.1], s: 1, unlock: null },
  { id: 'doll', name: 'Doll Eyes', iris: [0.08, 0.2, 0.42], s: 1.22, unlock: null },
  { id: 'beady', name: 'Beady', iris: [0.03, 0.03, 0.03], s: 0.78, pupil: 0.8, unlock: null },
  { id: 'red', name: 'Red Alert', iris: [0.22, 0.03, 0.02], led: 'red', s: 1, unlock: 'ratcatcher' },
  { id: 'void', name: 'Pinprick Void', iris: [0, 0, 0], s: 1.05, pupil: 0.38, unlock: 'photo_bacteria' },
  { id: 'gold', name: 'Gilded Optics', iris: [0.55, 0.38, 0.06], s: 1.05, unlock: 'researcher' },
];
export const DEFAULT_COSMETICS = { suit: 'yellow', skin: 'tan', hat: 'none', visor: 'none', face: 'dots', backpack: 'tank', accessory: 'none', frame: 'neutral', skull: 'std', build: 'std', eyes: 'glass' };

export function cosmeticEntry(slot, id) {
  const list = COSMETICS[slot];
  return list.find((e) => e.id === id) || list.find((e) => e.id === DEFAULT_COSMETICS[slot]) || list[0];
}
export function randomCosmetics(seed = 1, allowLocked = true) {
  const r = new RNG(typeof seed === 'string' ? hashString(seed) : seed);
  const out = {};
  for (const slot in COSMETICS) out[slot] = r.pick(COSMETICS[slot].filter((e) => allowLocked || !e.unlock)).id;
  return out;
}
export function resolveCos(c) {
  const out = { ...DEFAULT_COSMETICS, ...(c || {}) };
  out.suitEntry = cosmeticEntry('suit', out.suit);
  out.skinEntry = cosmeticEntry('skin', out.skin);
  out.hatEntry = cosmeticEntry('hat', out.hat);
  out.visorEntry = cosmeticEntry('visor', out.visor);
  out.faceEntry = cosmeticEntry('face', out.face);
  out.packEntry = cosmeticEntry('backpack', out.backpack);
  out.accEntry = cosmeticEntry('accessory', out.accessory);
  out.frameEntry = cosmeticEntry('frame', out.frame);
  out.skullEntry = cosmeticEntry('skull', out.skull);
  out.buildEntry = cosmeticEntry('build', out.build);
  out.eyesEntry = cosmeticEntry('eyes', out.eyes);
  // canonical ids (unknown ids fall back to defaults)
  out.suit = out.suitEntry.id; out.skin = out.skinEntry.id; out.hat = out.hatEntry.id; out.visor = out.visorEntry.id;
  out.face = out.faceEntry.id; out.backpack = out.packEntry.id; out.accessory = out.accEntry.id;
  out.frame = out.frameEntry.id; out.skull = out.skullEntry.id; out.build = out.buildEntry.id; out.eyes = out.eyesEntry.id;
  return out;
}
