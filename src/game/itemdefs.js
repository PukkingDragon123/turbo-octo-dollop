// Gameplay definitions for every physical object type (visual model comes from catalog.js).
//  pocket:   can be stored in the 5-slot inventory
//  use:      action when the player presses RMB while it is the selected slot
//  fx:       survival effect when consumed
//  breakF:   impact force (N) above which it breaks; into: spawned pieces/materials
//  dismantle: materials yielded when taken apart with the multitool
//  sample:   research sample worth credits when deposited into the radio
export const ITEM = {
  // --- starter kit ---
  flashlight: { name: 'Flashlight', pocket: true, use: 'flashlight', battery: 1 },
  protein_bar: { name: 'Protein Bar', pocket: true, use: 'eat', fx: { hunger: 35, stamina: 10 } },
  almond_milk: { name: 'Almond Milk', pocket: true, use: 'drink', fx: { thirst: 35, hunger: 8, sanity: 6 } },
  bandage: { name: 'Bandage', pocket: true, use: 'heal', fx: { bleed: -1, health: 8, infection: -5 } },
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

  // --- mission devices that are physics props ---
  radio: { name: 'Field Radio', mission: true, device: 'radio' },
  supply_crate: { name: 'Supply Crate', device: 'crate' },
  starter_box: { name: 'Starter Kit', device: 'starter' },
  clone_pad: { name: 'Cloning Pad', device: 'clonepad' },
};

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
  ['screws', 5], ['tape_roll', 3], ['multitool', 2], ['almond_milk', 5], ['soda_can', 4], ['noise_maker', 2],
];

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
