// Gameplay definitions for every physical object type (visual model comes from catalog.js).
//  pocket:   can be stored in the 5-slot inventory
//  use:      action when the player presses RMB while it is the selected slot
//  fx:       survival effect when consumed
//  breakF:   impact force (N) above which it breaks; into: spawned pieces/materials
//  dismantle: materials yielded when taken apart with the (built-in) multitool
//  sample:   research sample worth credits when deposited into the radio (older dimensions)
//  camp:     Level 0 tent-kit part (dragged onto its ghost marker and attached with the multitool)
//  sell:     $ paid by the teleport pads (overrides SELL_VALUE / the mass estimate, see sellValue())
export const ITEM = {
  // --- starter kit ---
  flashlight: { name: 'Flashlight', pocket: true, use: 'flashlight', battery: 1 },
  protein_bar: { name: 'Protein Bar', pocket: true, use: 'eat', fx: { hunger: 35, stamina: 10 } },
  almond_milk: { name: 'Almond Milk', pocket: true, use: 'drink', fx: { thirst: 35, hunger: 8, sanity: 6 } },
  bandage: { name: 'Bandage', pocket: true, use: 'heal', fx: { bleed: -1, health: 8, infection: -5 } },
  // the multitool is built into the suit now (empty hand + RMB); the item only survives in older loot tables
  multitool: { name: 'Multitool', pocket: true, use: 'multitool' },

  // --- consumables ---
  almond_water: { name: 'Almond Water', pocket: true, use: 'drink', fx: { thirst: 50, sanity: 18, infection: -10 } },
  energy_drink: { name: 'Energy Drink', pocket: true, use: 'drink', fx: { thirst: 20, stamina: 40, rest: 30, sanity: -3 } },
  soda_can: { name: 'R.O.O.M. Cola', pocket: true, use: 'drink', fx: { thirst: 28, sanity: 4, rest: 6 } },
  canned_food: { name: 'Mystery Stew', pocket: true, use: 'eat', fx: { hunger: 55, thirst: -5 } },
  chips: { name: 'Snack Chips', pocket: true, use: 'eat', fx: { hunger: 18, thirst: -6, sanity: 5 } },
  candy_bar: { name: 'Candy Bar', pocket: true, use: 'eat', fx: { hunger: 15, sanity: 8, stamina: 15 } },
  medkit: { name: 'Medkit', pocket: true, use: 'heal', fx: { bleed: -2, health: 45, blood: 600, infection: -15 } },
  antibiotics: { name: 'Antibiotics', pocket: true, use: 'heal', fx: { infection: -70 } },
  painkillers: { name: 'Painkillers', pocket: true, use: 'heal', fx: { health: 12, sanity: 10, pain: -1 } },
  splint: { name: 'Splint', pocket: true, use: 'heal', fx: { fracture: -1 } },
  paper_cup: { name: 'Cup of Water', pocket: true, use: 'drink', fx: { thirst: 22 } },
  leech: { name: 'Leech', pocket: true, use: 'eat', fx: { hunger: 12, thirst: 4, infection: 5, sanity: -6 } },

  // --- tools ---
  welder: { name: 'Welding Torch', pocket: true, use: 'weld', fuel: 1 },
  battery: { name: 'Battery', pocket: true, use: 'battery' },
  glowstick: { name: 'Glowstick', pocket: true, use: 'glowstick' },
  flare: { name: 'Road Flare', pocket: true, use: 'flare' },
  lighter: { name: 'Lighter', pocket: true, use: 'lighter' },
  crowbar: { name: 'Crowbar', pocket: true, use: 'swing' },
  wrench: { name: 'Wrench', pocket: true, use: 'swing' },
  tape_roll: { name: 'Duct Tape', pocket: true },
  fuse: { name: 'Industrial Fuse', pocket: true, mission: true },
  fuel_can: { name: 'Fuel Can', pocket: false, mission: true, fuel: 1 },
  sample_jar: { name: 'Sample Jar', pocket: true, use: 'sample' },
  water_tester: { name: 'Water Tester', pocket: true, use: 'test' },
  keycard: { name: 'Keycard', pocket: true },
  noise_maker: { name: 'Noise Maker', pocket: true, use: 'arm' },
  spike_trap: { name: 'Spike Trap', pocket: false, trap: 'spike' },
  barricade_panel: { name: 'Barricade Panel', pocket: false, dismantle: ['plank', 'plank', 'screws'] },
  dart: { name: 'Dart', pocket: true, use: 'throw' },
  photo: { name: 'Photo', pocket: true },
  clipboard: { name: 'Clipboard', pocket: true },
  camera_disposable: { name: 'Disposable Camera', pocket: true },

  // --- crafting materials ---
  plank: { name: 'Plank', pocket: true, material: true },
  metal_scrap: { name: 'Scrap Metal', pocket: true, material: true },
  screws: { name: 'Screws', pocket: true, material: true },
  fabric_scrap: { name: 'Cloth', pocket: true, material: true },
  wire_spool: { name: 'Wire', pocket: true, material: true },
  pipe_short: { name: 'Short Pipe', pocket: true, material: true },
  gear: { name: 'Gear', pocket: true, material: true },

  // --- furniture & clutter (physics props) ---
  chair_wood: { name: 'Stacking Chair', breakF: 900, into: ['plank', 'fabric_scrap'], dismantle: ['plank', 'plank', 'fabric_scrap'] },
  chair_office: { name: 'Office Chair', dismantle: ['metal_scrap', 'fabric_scrap', 'screws'] },
  chair_folding: { name: 'Folding Chair', dismantle: ['metal_scrap', 'screws'] },
  stool: { name: 'Stool', breakF: 800, into: ['plank'], dismantle: ['plank', 'screws'] },
  table_folding: { name: 'Folding Table', dismantle: ['plank', 'metal_scrap', 'screws'] },
  table_round: { name: 'Cafe Table', dismantle: ['metal_scrap', 'plank'] },
  desk: { name: 'Desk', dismantle: ['plank', 'plank', 'plank', 'screws', 'metal_scrap'] },
  desk_cubicle_panel: { name: 'Cubicle Panel', dismantle: ['fabric_scrap', 'metal_scrap', 'plank'] },
  filing_cabinet: { name: 'Filing Cabinet', dismantle: ['metal_scrap', 'metal_scrap', 'screws'] },
  bookshelf: { name: 'Bookshelf', dismantle: ['plank', 'plank', 'plank', 'screws'] },
  couch: { name: 'Couch', dismantle: ['fabric_scrap', 'fabric_scrap', 'plank', 'screws'], sleep: true },
  armchair: { name: 'Armchair', dismantle: ['fabric_scrap', 'plank'], sleep: true },
  mattress: { name: 'Mattress', dismantle: ['fabric_scrap', 'fabric_scrap'], sleep: true },
  bed: { name: 'Bed', dismantle: ['metal_scrap', 'fabric_scrap', 'fabric_scrap'], sleep: true },
  lamp_floor: { name: 'Floor Lamp', breakF: 600, into: ['metal_scrap', 'wire_spool'], dismantle: ['wire_spool', 'metal_scrap'] },
  lamp_desk: { name: 'Desk Lamp', breakF: 500, into: ['wire_spool'], dismantle: ['wire_spool'] },
  plant_pot: { name: 'Potted Plant' },
  plant_small: { name: 'Small Plant' },
  trash_can: { name: 'Trash Can', dismantle: ['metal_scrap'] },
  box_small: { name: 'Box', breakF: 380, into: ['paper_stack'] },
  box_medium: { name: 'Box', breakF: 480, into: ['paper_stack'] },
  box_large: { name: 'Big Box', breakF: 600, into: ['paper_stack'] },
  crate_wood: { name: 'Wooden Crate', breakF: 1500, into: ['plank', 'plank', 'screws'], dismantle: ['plank', 'plank', 'screws'] },
  pallet: { name: 'Pallet', dismantle: ['plank', 'plank', 'plank'] },
  traffic_cone: { name: 'Traffic Cone' },
  wet_floor_sign: { name: 'Wet Floor Sign' },
  barrel: { name: 'Barrel' },
  bucket: { name: 'Mop Bucket' },
  water_jug: { name: 'Water Jug', use: 'drink', fx: { thirst: 60 } },
  crt_monitor: { name: 'CRT Monitor', breakF: 700, into: ['metal_scrap', 'wire_spool'], dismantle: ['wire_spool', 'metal_scrap', 'screws'] },
  computer_tower: { name: 'Computer', dismantle: ['wire_spool', 'metal_scrap', 'screws'] },
  keyboard: { name: 'Keyboard' },
  desk_phone: { name: 'Desk Phone', dismantle: ['wire_spool'] },
  mug: { name: 'Mug', breakF: 140, into: [] },
  paper_stack: { name: 'Papers' },
  binder: { name: 'Binder' },
  printer: { name: 'Printer', dismantle: ['metal_scrap', 'gear', 'screws'] },
  microwave: { name: 'Microwave', dismantle: ['metal_scrap', 'wire_spool', 'screws'] },
  fire_extinguisher: { name: 'Fire Extinguisher', use: 'spray' },
  toolbox: { name: 'Toolbox', container: ['multitool', 'screws', 'wrench', 'tape_roll'] },
  step_ladder: { name: 'Step Ladder', dismantle: ['metal_scrap', 'metal_scrap'] },
  pipe: { name: 'Pipe', dismantle: ['pipe_short', 'pipe_short'] },
  whiteboard: { name: 'Whiteboard', dismantle: ['metal_scrap', 'plank'] },
  tv_crt: { name: 'CRT TV', breakF: 800, into: ['wire_spool', 'metal_scrap'], dismantle: ['wire_spool', 'metal_scrap', 'screws'] },
  rubber_duck: { name: 'Rubber Duck' },
  basketball: { name: 'Basketball' },
  coat_rack: { name: 'Coat Rack', dismantle: ['metal_scrap'] },
  cinder_block: { name: 'Cinder Block' },
  ceiling_tile: { name: 'Ceiling Tile', breakF: 120, into: [] },
  office_divider_plant: { name: 'Planter' },
  water_cooler_cup: { name: 'Paper Cup' },
  broom: { name: 'Broom', dismantle: ['plank'] },
  mop: { name: 'Mop', dismantle: ['plank', 'fabric_scrap'] },
  vent_grate: { name: 'Vent Grate' },
  suitcase: { name: 'Suitcase' },
  radio_cassette: { name: 'Boombox', use: 'music' },
  globe: { name: 'Globe' },
  clock_desk: { name: 'Desk Clock' },
  hand_truck: { name: 'Hand Truck', dismantle: ['metal_scrap', 'metal_scrap'] },
  sandbag: { name: 'Sandbag' },
  tire: { name: 'Tire' },

  // --- Level 0 fauna, fungi, cooking & scavenging (game/bio.js, game/cooking.js; models: entities/models_bio.js) ---
  // raw meat / fungus is edible but risky; cooked in the camp-stove pan it feeds and heals more; burnt is barely food
  mole_meat: { name: 'Raw Mole Meat', pocket: true, use: 'eat', fx: { hunger: 14, health: -6, sanity: -4, infection: 8 }, sell: 6 },
  mole_meat_cooked: { name: 'Roast Mole', pocket: true, use: 'eat', fx: { hunger: 50, health: 14, stamina: 15, sanity: 4 }, sell: 14 },
  mole_meat_burnt: { name: 'Charred Mole', pocket: true, use: 'eat', fx: { hunger: 18, health: -2, thirst: -10, sanity: -3 }, sell: 2 },
  crawler_meat: { name: 'Crawler Limb', pocket: true, use: 'eat', fx: { hunger: 18, health: -10, sanity: -12, infection: 15 }, sell: 10 },
  crawler_meat_cooked: { name: 'Fried Crawler Limb', pocket: true, use: 'eat', fx: { hunger: 42, health: 8, sanity: -4 }, sell: 16 },
  crawler_meat_burnt: { name: 'Burnt Crawler Limb', pocket: true, use: 'eat', fx: { hunger: 14, health: -4, thirst: -8, sanity: -6 }, sell: 3 },
  fungus_black: { name: 'Black Mold Cap', pocket: true, use: 'eat', fx: { hunger: 6, health: -5, sanity: -8 }, sell: 18 },
  fungus_black_cooked: { name: 'Fried Mold Caps', pocket: true, use: 'eat', fx: { hunger: 16, health: 4, sanity: 2 }, sell: 10 },
  fungus_black_burnt: { name: 'Burnt Mold Caps', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 }, sell: 1 },
  fungus_glow: { name: 'Glowcap', pocket: true, use: 'eat', fx: { hunger: 5, sanity: -14, stamina: 25 }, sell: 24 },
  fungus_glow_cooked: { name: 'Toasted Glowcaps', pocket: true, use: 'eat', fx: { hunger: 12, sanity: 8, stamina: 15 }, sell: 12 },
  fungus_glow_burnt: { name: 'Burnt Glowcaps', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 }, sell: 1 },
  fungus_shelf: { name: 'Carpet Bracket', pocket: true, use: 'eat', fx: { hunger: 10, health: -2 }, sell: 12 },
  fungus_shelf_cooked: { name: 'Seared Bracket', pocket: true, use: 'eat', fx: { hunger: 28, health: 8 }, sell: 8 },
  fungus_shelf_burnt: { name: 'Burnt Bracket', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 }, sell: 1 },
  fungus_puff: { name: 'Spore Puffball', pocket: true, use: 'eat', fx: { hunger: 8, thirst: -4, sanity: -6 }, sell: 14 },
  fungus_puff_cooked: { name: 'Roasted Puffball', pocket: true, use: 'eat', fx: { hunger: 24, health: 6, sanity: 3 }, sell: 8 },
  fungus_puff_burnt: { name: 'Burnt Puffball', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 }, sell: 1 },
  canned_food_hot: { name: 'Hot Mystery Stew', pocket: true, use: 'eat', fx: { hunger: 70, thirst: -2, health: 10, sanity: 8 }, sell: 6 },
  camp_stove: { name: 'Camp Stove', sell: 0 },
  supply_box: { name: 'Supply Crate', breakF: 2600, into: ['plank', 'plank', 'screws'], dismantle: ['plank', 'plank', 'screws', 'metal_scrap'] },
  sleeping_bag: { name: 'Sleeping Bag', sleep: true, dismantle: ['fabric_scrap', 'fabric_scrap'] },
  tent_ruin: { name: 'Collapsed Tent', dismantle: ['fabric_scrap', 'fabric_scrap', 'metal_scrap'] },
  trolley_broken: { name: 'Broken Trolley', dismantle: ['metal_scrap', 'metal_scrap', 'plank', 'screws'] },
  board: { name: 'Plywood Board', dismantle: ['plank', 'plank'] },
  note_scribble: { name: 'Scribbled Note', sell: 0 },

  // --- mission devices that are physics props ---
  radio: { name: 'Field Radio', mission: true, device: 'radio' },
  supply_crate: { name: 'Supply Crate', device: 'crate' },
  starter_box: { name: 'Starter Kit', device: 'starter' },
  clone_pad: { name: 'Cloning Pad', device: 'clonepad' },

  // --- Level 0 camp kit (CampMission) ---
  camp_kit: { name: 'Tent Kit', device: 'campkit', sell: 0 },
  camp_pole: { name: 'Tent Pole', camp: true, sell: 0 },
  camp_canvas: { name: 'Tent Canvas', camp: true, sell: 0 },
  camp_stakes: { name: 'Tent Stakes', camp: true, sell: 0 },
  camp_lamp: { name: 'Camp Lamp', camp: true, sell: 0 },

  // --- crafted camp gear (game/crafting.js, game/basecamp.js) ---
  trolley: { name: 'Wheel Trolley', sell: 0, dismantle: ['plank', 'metal_scrap', 'screws'] },
  distorter: { name: 'Distorter', sell: 0, dismantle: ['wire_spool', 'metal_scrap'] },
  field_bench: { name: 'Field Workbench', sell: 0, dismantle: ['plank', 'plank', 'metal_scrap', 'screws'] },

  // --- player & combat (game/player.js, game/tools.js) ---
  // plasma syringe: refills the mechanical heart's plasma chamber (first-person heart-patch animation)
  plasma_syringe: { name: 'Plasma Syringe', pocket: true, use: 'heal', fx: { health: 35, bleed: -1, blood: 400 }, weight: 0.3 },
  // caster wheel: attach it to a board / crate with the multitool and it spins on a real axle (DIY carts)
  wheel: { name: 'Caster Wheel', pocket: true, material: true, wheel: true, weight: 1.2, sell: 6 },

  // --- company-store gear & quest items (game/economy.js; models: entities/items/shopitems.js) ---
  //  weapon: { dmg (hits per swing), range (m), cd (s), knock, ranged }   armor: { slot, mul (damage taken x) }
  //  shield: damage taken x while held   upgrade: team upgrade installed with [E]   quest: counted by the crusher
  weapon_pipe: { name: 'Lead Pipe', pocket: true, use: 'swing', weapon: { dmg: 1, range: 2.0, cd: 0.5, knock: 1.3 }, sell: 60 },
  bat: { name: 'Nail Bat', pocket: true, use: 'swing', weapon: { dmg: 2, range: 2.1, cd: 0.62, knock: 1.7 }, sell: 90 },
  machete: { name: 'Machete', pocket: true, use: 'swing', weapon: { dmg: 3, range: 2.0, cd: 0.42, knock: 0.8 }, sell: 150 },
  nailgun: { name: 'Nail Gun', pocket: true, use: 'swing', weapon: { dmg: 2, range: 22, cd: 0.3, ranged: true }, sell: 260 },
  hard_hat: { name: 'Hard Hat', armor: { slot: 'head', mul: 0.85 }, sell: 60 },
  padded_vest: { name: 'Padded Vest', armor: { slot: 'body', mul: 0.7 }, sell: 120 },
  riot_shield: { name: 'Riot Shield', pocket: true, shield: 0.55, sell: 180 },
  up_battery: { name: 'Tool Battery', upgrade: 'battery', sell: 0 },
  up_carry: { name: 'Carry Harness', upgrade: 'carry', sell: 0 },
  up_plasma: { name: 'Plasma Tank', upgrade: 'plasma', sell: 0 },
  up_sanity: { name: 'Sanity Dampener', upgrade: 'sanity', sell: 0 },
  case_file: { name: 'Case File', pocket: true, quest: 'file', sell: 800 },
};

// Level price multiplier (set by the level's mission from LEVEL_RULES; 1 outside the economy loop)
export const ECON = { priceMul: 1 };

export function itemDef(type) {
  return ITEM[type] || { name: type.replace(/_/g, ' ') };
}

export function itemName(type) {
  return itemDef(type).name;
}

// Supply crate loot table: [type, weight]
export const CRATE_LOOT = [
  ['almond_water', 10], ['canned_food', 8], ['protein_bar', 8], ['energy_drink', 6], ['candy_bar', 5],
  ['medkit', 5], ['bandage', 8], ['antibiotics', 4], ['painkillers', 5], ['splint', 4],
  ['battery', 7], ['glowstick', 6], ['flare', 5], ['sample_jar', 6], ['welder', 2], ['flashlight', 3],
  ['screws', 5], ['tape_roll', 3], ['almond_milk', 5], ['soda_can', 4], ['noise_maker', 2],
];

// Teleport-pad payout ($) per furniture type (Level 0 economy). Tuned so one clone dragging furniture to the
// pad hall makes a $1500 quota in roughly 20-40 minutes: big pieces are worth the walk, clutter is pocket change.
export const SELL_VALUE = {
  couch: 210, bed: 190, desk: 160, bookshelf: 140, filing_cabinet: 125, armchair: 110, tv_crt: 105,
  computer_tower: 95, printer: 90, crt_monitor: 85, mattress: 80, microwave: 75, chair_office: 70,
  radio_cassette: 70, hand_truck: 65, table_folding: 60, suitcase: 60, table_round: 55, whiteboard: 55,
  barrel: 55, toolbox: 50, crate_wood: 50, desk_cubicle_panel: 45, step_ladder: 45, globe: 45,
  lamp_floor: 45, office_divider_plant: 40, chair_wood: 40, fire_extinguisher: 40, plant_pot: 35,
  fuel_can: 35, water_jug: 30, chair_folding: 30, lamp_desk: 28, coat_rack: 28, rubber_duck: 25,
  stool: 25, pallet: 22, desk_phone: 22, clock_desk: 22, keyboard: 18, trash_can: 18, box_large: 18,
  basketball: 16, traffic_cone: 15, wet_floor_sign: 15, bucket: 15, tire: 14, box_medium: 12, pipe: 12,
  plant_small: 12, broom: 10, mop: 10, vent_grate: 10, box_small: 8, mug: 6, cinder_block: 6, sandbag: 5,
  binder: 5, paper_stack: 3, ceiling_tile: 2, barricade_panel: 20, spike_trap: 15,
};

// $ the teleport pads pay for one prop: by type, else estimated from mass; scaled by condition (state.cond 0..1).
// Mission props, ragdolls and camp parts are worth nothing (and are left on the pad).
export function sellValue(type, mass = 5, state = null) {
  if (type.startsWith('rag_')) return 0;
  const d = ITEM[type];
  let v;
  if (d && d.sell !== undefined) v = d.sell;
  else if (SELL_VALUE[type] !== undefined) v = SELL_VALUE[type];
  else if (d?.mission || d?.device || d?.camp) v = 0;
  else if (d?.material) v = 4;
  else if (d?.pocket) v = d.use === 'eat' || d.use === 'drink' || d.use === 'heal' ? 5 : 8;
  else v = Math.round(Math.min(120, Math.max(4, mass * 3)));
  const cond = state?.cond ?? 1;
  return Math.round(v * Math.min(1, Math.max(0.3, cond)) * ECON.priceMul);
}

// Crafting recipes (workbench)
export const RECIPES = [
  { id: 'barricade_panel', name: 'Barricade Panel', needs: { plank: 3, screws: 1 }, desc: 'Heavy board. Weld it in place.' },
  { id: 'spike_trap', name: 'Spike Trap', needs: { plank: 1, metal_scrap: 1, screws: 1 }, desc: 'Hurts & slows anything that steps on it.' },
  { id: 'noise_maker', name: 'Noise Maker', needs: { metal_scrap: 1, wire_spool: 1 }, desc: 'Arm it, throw it, run.' },
  { id: 'splint', name: 'Splint', needs: { plank: 1, fabric_scrap: 1 }, desc: 'Fixes a fractured leg.' },
  { id: 'bandage', name: 'Bandage', needs: { fabric_scrap: 2 }, desc: 'Stops light bleeding.' },
  { id: 'glowstick', name: 'Glow Lamp', needs: { wire_spool: 1, metal_scrap: 1 }, desc: 'A crude, long-lasting light.' },
  { id: 'sample_jar', name: 'Sample Jar', needs: { metal_scrap: 1, screws: 1 }, desc: 'Containment for research samples.' },
];

// Research sample kinds (stored in sample_jar state.kind)
export const SAMPLES = {
  bacteria_residue: { name: 'Bacteria Residue', color: 0x0b120c, credits: 120 },
  black_mold: { name: 'Black Mold', color: 0x2a2a1a, credits: 45 },
  carpet_fungus: { name: 'Carpet Fungus', color: 0x8a7a3a, credits: 30 },
  flood_water: { name: 'Anomalous Water', color: 0x6a8a7a, credits: 40 },
  infected_water: { name: 'Contaminated Water', color: 0x8a9a30, credits: 70 },
  still_life_tissue: { name: 'Still Life Tissue', color: 0xd8b48a, credits: 150 },
  rat: { name: 'Specimen: Rat', color: 0x6a5a4a, credits: 35 },
  wallpaper_growth: { name: 'Wallpaper Growth', color: 0xc8b450, credits: 35 },
};
