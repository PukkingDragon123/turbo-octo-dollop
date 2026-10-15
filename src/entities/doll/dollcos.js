// R.O.O.M. — cosmetics catalogue. Ids and unlock achievement ids are stable (saved profiles
// reference them). Every 'suit' entry is a colourway / finish of the R.O.O.M. work coverall the
// clone androids wear (the old hazmat colourways); 'skin' is the finish of the android's ABS shell
// and porcelain face plate; 'face' picks the painted face (and the eye hardware).
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
  ],
  skin: [
    { id: 'tan', name: 'Yellowed ABS', color: 0xe0d2b0, unlock: null },
    { id: 'light', name: 'Factory White', color: 0xf0ebdf, unlock: null },
    { id: 'dark', name: 'Walnut Bakelite', color: 0x7c5a40, unlock: null },
    { id: 'grey', name: 'Primer Grey', color: 0xa3a19b, unlock: null },
    { id: 'rose', name: 'Dusty Rose', color: 0xe6bcae, unlock: 'night_owl' },
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
export const DEFAULT_COSMETICS = { suit: 'yellow', skin: 'tan', hat: 'none', visor: 'none', face: 'dots', backpack: 'tank', accessory: 'none' };

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
  // canonical ids (unknown ids fall back to defaults)
  out.suit = out.suitEntry.id; out.skin = out.skinEntry.id; out.hat = out.hatEntry.id; out.visor = out.visorEntry.id;
  out.face = out.faceEntry.id; out.backpack = out.packEntry.id; out.accessory = out.accEntry.id;
  return out;
}
