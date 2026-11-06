// Gameplay definitions for every physical object type (the visual model comes from catalog.js).
//  pocket:    can be carried (the hands / armful; game/hands.js)
//  use:       action when the player presses LMB with it in the right hand
//  fx:        survival effect when consumed            empties: what is left in the hand afterwards (a bottle)
//  breakF:    impact force (N) above which it breaks; into: spawned pieces
//  dismantle: what it is made of. Taking it apart (game/gather.js) recovers these, depending on the tool:
//             bare hands only get the soft parts and splinters, a pry bar gets the metal and screws off, a saw
//             gets whole planks, the multitool (battery) gets everything
//  gather:    material class for the work it takes: 'wood' | 'metal' | 'soft' | 'electro' | 'glass' | 'stone'
//  tool:      gathering capabilities of a hand tool { bash, pry, cut, fine } (0..2, work speed per hit)
//  weapon:    { dmg (hits per swing), range (m), cd (s), knock, ranged }
//  wear:      worn with [E] on the prop: { slot: 'head' | 'body' | 'back', armor (damage taken x), slots (+pack
//             slots), warm (insulation) }
//  light:     a fire or lamp: { r (light radius m), warm (warmth / s nearby), life (s, 0 = endless), fire }
//  shelter:   counts toward a claimed shelter: 'bed' | 'door' | 'storage' | 'stove' | 'light' | 'trap' |
//             'insulation' | 'barricade' | 'bench'
//  sample:    research sample kinds stored in a sample_jar (older dimensions)
export const ITEM = {
  // --- found supplies ---
  flashlight: { name: 'Flashlight', pocket: true, use: 'flashlight', battery: 1 },
  protein_bar: { name: 'Protein Bar', pocket: true, use: 'eat', fx: { hunger: 35, stamina: 10 } },
  almond_milk: { name: 'Almond Milk', pocket: true, use: 'drink', fx: { thirst: 35, hunger: 8, sanity: 6 } },
  bandage: { name: 'Bandage', pocket: true, use: 'heal', fx: { bleed: -1, health: 8, infection: -5 } },
  // an old multitool item in older loot tables works like the built-in one
  multitool: { name: 'Multitool', pocket: true, use: 'multitool' },

  // --- consumables ---
  almond_water: { name: 'Almond Water', pocket: true, use: 'drink', fx: { thirst: 50, sanity: 18, infection: -10 }, empties: 'bottle' },
  energy_drink: { name: 'Energy Drink', pocket: true, use: 'drink', fx: { thirst: 20, stamina: 40, rest: 30, sanity: -3 } },
  soda_can: { name: 'Cola', pocket: true, use: 'drink', fx: { thirst: 28, sanity: 4, rest: 6 } },
  canned_food: { name: 'Mystery Stew', pocket: true, use: 'eat', fx: { hunger: 55, thirst: -5 } },
  chips: { name: 'Snack Chips', pocket: true, use: 'eat', fx: { hunger: 18, thirst: -6, sanity: 5 } },
  candy_bar: { name: 'Candy Bar', pocket: true, use: 'eat', fx: { hunger: 15, sanity: 8, stamina: 15 } },
  medkit: { name: 'Medkit', pocket: true, use: 'heal', fx: { bleed: -2, health: 45, blood: 600, infection: -15 } },
  antibiotics: { name: 'Antibiotics', pocket: true, use: 'heal', fx: { infection: -70 } },
  painkillers: { name: 'Painkillers', pocket: true, use: 'heal', fx: { health: 12, sanity: 10, pain: -1 } },
  splint: { name: 'Splint', pocket: true, use: 'heal', fx: { fracture: -1, health: 4 } },
  paper_cup: { name: 'Cup of Water', pocket: true, use: 'drink', fx: { thirst: 22 } },
  leech: { name: 'Leech', pocket: true, use: 'eat', fx: { hunger: 12, thirst: 4, infection: 5, sanity: -6 } },
  // water you collect: a puddle fills an empty bottle with dirty water; boil it in the stove pan or run it
  // through a water filter
  bottle: { name: 'Empty Bottle', pocket: true, use: 'fill', weight: 0.15 },
  water_dirty: { name: 'Dirty Water', pocket: true, use: 'drink', fx: { thirst: 30, health: -8, sanity: -6, infection: 12 }, empties: 'bottle', sick: 0.5, weight: 0.6 },
  water_clean: { name: 'Clean Water', pocket: true, use: 'drink', fx: { thirst: 45, sanity: 4 }, empties: 'bottle', weight: 0.6 },

  // --- tools & lights ---
  welder: { name: 'Welding Torch', pocket: true, use: 'weld', fuel: 1 },
  battery: { name: 'Battery', pocket: true, use: 'battery' },
  glowstick: { name: 'Glowstick', pocket: true, use: 'glowstick' },
  flare: { name: 'Road Flare', pocket: true, use: 'flare' },
  lighter: { name: 'Lighter', pocket: true, use: 'lighter' },
  crowbar: { name: 'Pry Bar', pocket: true, use: 'swing', tool: { pry: 1.1, bash: 0.6 }, weapon: { dmg: 1, range: 2.0, cd: 0.5, knock: 1.2 }, weight: 1.6 },
  wrench: { name: 'Wrench', pocket: true, use: 'swing', tool: { pry: 0.6, bash: 0.5 }, weapon: { dmg: 1, range: 1.9, cd: 0.45, knock: 1 } },
  tape_roll: { name: 'Duct Tape', pocket: true, material: true },
  fuse: { name: 'Industrial Fuse', pocket: true, mission: true },
  fuel_can: { name: 'Fuel Can', pocket: false, mission: true, fuel: 1 },
  sample_jar: { name: 'Sample Jar', pocket: true, use: 'sample' },
  water_tester: { name: 'Water Tester', pocket: true, use: 'test' },
  keycard: { name: 'Keycard', pocket: true },
  noise_maker: { name: 'Noise Maker', pocket: true, use: 'arm' },
  spike_trap: { name: 'Spike Trap', pocket: false, trap: 'spike', shelter: 'trap', dismantle: ['plank', 'metal_scrap', 'screws'], gather: 'wood' },
  barricade_panel: { name: 'Barricade Panel', pocket: false, shelter: 'barricade', dismantle: ['plank', 'plank', 'screws'], gather: 'wood' },
  dart: { name: 'Dart', pocket: true, use: 'throw' },
  photo: { name: 'Photo', pocket: true },
  clipboard: { name: 'Clipboard', pocket: true, dismantle: ['plank'], gather: 'wood' },
  camera_disposable: { name: 'Disposable Camera', pocket: true, dismantle: ['battery', 'glass_shard'], gather: 'electro' },

  // --- crafting materials ---
  plank: { name: 'Plank', pocket: true, material: true },
  stick: { name: 'Stick', pocket: true, material: true, weight: 0.4 },
  metal_scrap: { name: 'Scrap Metal', pocket: true, material: true },
  screws: { name: 'Screws', pocket: true, material: true },
  fabric_scrap: { name: 'Cloth', pocket: true, material: true },
  foam: { name: 'Foam', pocket: true, material: true, weight: 0.1 },
  wire_spool: { name: 'Wire', pocket: true, material: true },
  glass_shard: { name: 'Glass Shard', pocket: true, material: true, weight: 0.15 },
  rock: { name: 'Concrete Chunk', pocket: true, material: true, weight: 1.1 },
  pipe_short: { name: 'Short Pipe', pocket: true, material: true },
  gear: { name: 'Gear', pocket: true, material: true },

  // --- hand-made (no bench) ---
  rag_bandage: { name: 'Rag Bandage', pocket: true, use: 'heal', fx: { bleed: -1, health: 5 }, weight: 0.1 },
  torch: { name: 'Torch', pocket: true, use: 'light', light: { r: 6, warm: 0.6, life: 300, fire: true }, weight: 0.5 },
  sharp_stick: { name: 'Sharpened Stick', pocket: true, use: 'swing', tool: { fine: 0.6 }, weapon: { dmg: 1, range: 2.3, cd: 0.42, knock: 0.6 }, weight: 0.4 },
  rock_hammer: { name: 'Rock Hammer', pocket: true, use: 'swing', tool: { bash: 1.0 }, weapon: { dmg: 1, range: 1.8, cd: 0.6, knock: 1.4 }, weight: 1.3 },
  bedroll: { name: 'Bedroll', pocket: false, bed: 1, shelter: 'bed', dismantle: ['fabric_scrap', 'fabric_scrap', 'foam'], gather: 'soft' },
  scrap_bench: { name: 'Workbench', pocket: false, bench: 1, shelter: 'bench', dismantle: ['plank', 'plank', 'stick', 'stick'], gather: 'wood' },

  // --- workbench, scrap tier ---
  saw: { name: 'Scrap Saw', pocket: true, use: 'swing', tool: { cut: 1.3 }, weapon: { dmg: 1, range: 1.8, cd: 0.5, knock: 0.6 }, weight: 0.8 },
  knife: { name: 'Shiv Knife', pocket: true, use: 'swing', tool: { fine: 1.3, cut: 0.4 }, weapon: { dmg: 2, range: 1.7, cd: 0.32, knock: 0.5 }, weight: 0.3 },
  spear: { name: 'Spear', pocket: true, use: 'swing', tool: { fine: 0.4 }, weapon: { dmg: 2, range: 2.9, cd: 0.6, knock: 1.1 }, weight: 1.2 },
  bat: { name: 'Nail Bat', pocket: true, use: 'swing', tool: { bash: 0.7 }, weapon: { dmg: 2, range: 2.1, cd: 0.62, knock: 1.7 }, weight: 1.3 },
  plank_door: { name: 'Plank Door', pocket: false, door: true, shelter: 'door', dismantle: ['plank', 'plank', 'plank', 'screws'], gather: 'wood' },
  stash_crate: { name: 'Storage Crate', pocket: false, storage: 6, shelter: 'storage', dismantle: ['plank', 'plank', 'plank', 'screws'], gather: 'wood' },
  bench_vise: { name: 'Bench Vise', pocket: false, upgrade: 2 },

  // --- workbench with a vise ---
  hatchet: { name: 'Hatchet', pocket: true, use: 'swing', tool: { cut: 1.4, bash: 1.0, pry: 0.4 }, weapon: { dmg: 3, range: 2.0, cd: 0.5, knock: 1.2 }, weight: 1.1 },
  padded_vest: { name: 'Padded Armour', wear: { slot: 'body', armor: 0.7, warm: 0.35 }, dismantle: ['fabric_scrap', 'foam', 'foam'], gather: 'soft' },
  hard_hat: { name: 'Scrap Helmet', wear: { slot: 'head', armor: 0.85, warm: 0.1 }, dismantle: ['metal_scrap', 'foam'], gather: 'metal' },
  backpack: { name: 'Backpack', wear: { slot: 'back', slots: 3 }, dismantle: ['fabric_scrap', 'fabric_scrap', 'tape_roll'], gather: 'soft' },
  lantern: { name: 'Lantern', pocket: true, use: 'light', light: { r: 9, warm: 0.25, life: 0 }, shelter: 'light', weight: 0.9 },
  camp_lamp: { name: 'Standing Lamp', pocket: false, light: { r: 10, warm: 0.15, life: 0 }, shelter: 'light', dismantle: ['metal_scrap', 'wire_spool', 'glass_shard'], gather: 'electro' },
  water_filter: { name: 'Water Filter', pocket: true, use: 'filter', weight: 0.7 },
  cot: { name: 'Camp Cot', pocket: false, bed: 2, shelter: 'bed', dismantle: ['plank', 'plank', 'fabric_scrap', 'foam'], gather: 'wood' },
  insulation: { name: 'Insulation Pad', pocket: false, shelter: 'insulation', warm: 1, dismantle: ['foam', 'foam', 'fabric_scrap'], gather: 'soft' },
  solder_kit: { name: 'Soldering Kit', pocket: false, upgrade: 3 },

  // --- workbench with a soldering kit ---
  crossbow: { name: 'Crossbow', pocket: true, use: 'swing', weapon: { dmg: 3, range: 26, cd: 0.9, ranged: true, ammo: 'bolts' }, weight: 1.8 },
  bolt_bundle: { name: 'Crossbow Bolts', pocket: true, ammo: 6, weight: 0.3 },

  // --- the radio (gameplay: game/radio.js). Found broken near where you wake up; repair it at a workbench and
  //     fit it with parts to reach farther. state.broken: 1 until repaired; fitted parts live in its state too.
  radio: { name: 'Field Radio', pocket: false, device: 'radio', radio: true },
  radio_battery: { name: 'Radio Battery', pocket: true, radioPart: 'battery', weight: 0.9 },
  radio_antenna: { name: 'Radio Antenna', pocket: true, radioPart: 'antenna', weight: 0.4 },
  radio_coil: { name: 'Tuning Coil', pocket: true, radioPart: 'coil', weight: 0.3 },
  radio_amp: { name: 'Signal Amplifier', pocket: true, radioPart: 'amp', weight: 1.0 },

  // --- paper ---
  notebook: { name: 'Field Notebook', pocket: true, use: 'read', weight: 0.2 },
  note_scribble: { name: 'Scribbled Note' },

  // --- furniture & clutter (physics props) ---
  chair_wood: { name: 'Stacking Chair', breakF: 900, into: ['stick', 'stick', 'fabric_scrap'], dismantle: ['plank', 'stick', 'fabric_scrap'], gather: 'wood' },
  chair_office: { name: 'Office Chair', dismantle: ['metal_scrap', 'foam', 'fabric_scrap', 'screws'], gather: 'metal' },
  chair_folding: { name: 'Folding Chair', dismantle: ['metal_scrap', 'pipe_short', 'screws'], gather: 'metal' },
  stool: { name: 'Stool', breakF: 800, into: ['stick', 'stick'], dismantle: ['plank', 'stick', 'screws'], gather: 'wood' },
  table_folding: { name: 'Folding Table', dismantle: ['plank', 'metal_scrap', 'pipe_short', 'screws'], gather: 'wood' },
  table_round: { name: 'Cafe Table', dismantle: ['metal_scrap', 'plank', 'pipe_short'], gather: 'metal' },
  desk: { name: 'Desk', dismantle: ['plank', 'plank', 'plank', 'screws', 'metal_scrap'], gather: 'wood' },
  desk_cubicle_panel: { name: 'Cubicle Panel', dismantle: ['fabric_scrap', 'foam', 'metal_scrap', 'plank'], gather: 'soft' },
  filing_cabinet: { name: 'Filing Cabinet', dismantle: ['metal_scrap', 'metal_scrap', 'screws'], gather: 'metal' },
  bookshelf: { name: 'Bookshelf', dismantle: ['plank', 'plank', 'plank', 'screws'], gather: 'wood' },
  couch: { name: 'Couch', dismantle: ['fabric_scrap', 'fabric_scrap', 'foam', 'foam', 'plank', 'screws'], gather: 'soft', sleep: true },
  armchair: { name: 'Armchair', dismantle: ['fabric_scrap', 'foam', 'plank'], gather: 'soft', sleep: true },
  mattress: { name: 'Mattress', dismantle: ['fabric_scrap', 'fabric_scrap', 'foam', 'foam'], gather: 'soft', sleep: true },
  bed: { name: 'Bed', dismantle: ['metal_scrap', 'fabric_scrap', 'fabric_scrap', 'foam'], gather: 'metal', sleep: true },
  lamp_floor: { name: 'Floor Lamp', breakF: 600, into: ['metal_scrap', 'glass_shard'], dismantle: ['wire_spool', 'metal_scrap', 'glass_shard'], gather: 'electro' },
  lamp_desk: { name: 'Desk Lamp', breakF: 500, into: ['glass_shard'], dismantle: ['wire_spool', 'glass_shard'], gather: 'electro' },
  plant_pot: { name: 'Potted Plant', dismantle: ['rock', 'stick'], gather: 'stone' },
  plant_small: { name: 'Small Plant', dismantle: ['stick'], gather: 'soft' },
  trash_can: { name: 'Trash Can', dismantle: ['metal_scrap'], gather: 'metal' },
  box_small: { name: 'Box', breakF: 380, into: ['paper_stack'] },
  box_medium: { name: 'Box', breakF: 480, into: ['paper_stack'] },
  box_large: { name: 'Big Box', breakF: 600, into: ['paper_stack'] },
  crate_wood: { name: 'Wooden Crate', breakF: 1500, into: ['plank', 'stick', 'screws'], dismantle: ['plank', 'plank', 'screws'], gather: 'wood' },
  pallet: { name: 'Pallet', dismantle: ['plank', 'plank', 'plank'], gather: 'wood' },
  traffic_cone: { name: 'Traffic Cone' },
  wet_floor_sign: { name: 'Wet Floor Sign' },
  barrel: { name: 'Barrel', dismantle: ['metal_scrap', 'metal_scrap'], gather: 'metal' },
  bucket: { name: 'Mop Bucket' },
  water_jug: { name: 'Water Jug', use: 'drink', fx: { thirst: 60 } },
  crt_monitor: { name: 'CRT Monitor', breakF: 700, into: ['glass_shard', 'wire_spool'], dismantle: ['wire_spool', 'glass_shard', 'metal_scrap', 'screws'], gather: 'electro' },
  computer_tower: { name: 'Computer', dismantle: ['wire_spool', 'metal_scrap', 'screws', 'battery'], gather: 'electro' },
  keyboard: { name: 'Keyboard', dismantle: ['wire_spool'], gather: 'electro' },
  desk_phone: { name: 'Desk Phone', dismantle: ['wire_spool', 'battery'], gather: 'electro' },
  mug: { name: 'Mug', breakF: 140, into: [] },
  paper_stack: { name: 'Papers' },
  binder: { name: 'Binder' },
  printer: { name: 'Printer', dismantle: ['metal_scrap', 'gear', 'wire_spool', 'screws'], gather: 'electro' },
  microwave: { name: 'Microwave', dismantle: ['metal_scrap', 'wire_spool', 'glass_shard', 'screws'], gather: 'electro' },
  fire_extinguisher: { name: 'Fire Extinguisher', use: 'spray', dismantle: ['metal_scrap', 'pipe_short'], gather: 'metal' },
  toolbox: { name: 'Toolbox', container: ['crowbar', 'screws', 'wrench', 'tape_roll'], dismantle: ['metal_scrap', 'screws'], gather: 'metal' },
  step_ladder: { name: 'Step Ladder', dismantle: ['metal_scrap', 'metal_scrap', 'pipe_short'], gather: 'metal' },
  pipe: { name: 'Pipe', dismantle: ['pipe_short', 'pipe_short'], gather: 'metal' },
  whiteboard: { name: 'Whiteboard', dismantle: ['metal_scrap', 'plank'], gather: 'metal' },
  tv_crt: { name: 'CRT TV', breakF: 800, into: ['glass_shard', 'wire_spool'], dismantle: ['wire_spool', 'glass_shard', 'metal_scrap', 'screws'], gather: 'electro' },
  rubber_duck: { name: 'Rubber Duck' },
  basketball: { name: 'Basketball' },
  coat_rack: { name: 'Coat Rack', dismantle: ['stick', 'stick', 'metal_scrap'], gather: 'wood' },
  cinder_block: { name: 'Cinder Block', dismantle: ['rock', 'rock'], gather: 'stone' },
  ceiling_tile: { name: 'Ceiling Tile', breakF: 120, into: [] },
  office_divider_plant: { name: 'Planter', dismantle: ['rock', 'stick', 'plank'], gather: 'wood' },
  water_cooler_cup: { name: 'Paper Cup' },
  broom: { name: 'Broom', dismantle: ['stick', 'stick'], gather: 'wood' },
  mop: { name: 'Mop', dismantle: ['stick', 'fabric_scrap'], gather: 'wood' },
  vent_grate: { name: 'Vent Grate', dismantle: ['metal_scrap'], gather: 'metal' },
  suitcase: { name: 'Suitcase', dismantle: ['fabric_scrap', 'metal_scrap'], gather: 'soft' },
  radio_cassette: { name: 'Boombox', use: 'music', dismantle: ['wire_spool', 'battery', 'metal_scrap'], gather: 'electro' },
  globe: { name: 'Globe', dismantle: ['metal_scrap'], gather: 'metal' },
  clock_desk: { name: 'Desk Clock', dismantle: ['gear', 'battery'], gather: 'electro' },
  hand_truck: { name: 'Hand Truck', dismantle: ['metal_scrap', 'metal_scrap', 'wheel'], gather: 'metal' },
  sandbag: { name: 'Sandbag', dismantle: ['fabric_scrap', 'rock'], gather: 'soft' },
  tire: { name: 'Tire' },
  // Level 0 furniture with models of their own (entities/catalog.js merges its names in for anything missing)
  dresser: { name: 'Dresser', dismantle: ['plank', 'plank', 'plank', 'screws'], gather: 'wood' },
  nightstand: { name: 'Nightstand', dismantle: ['plank', 'stick', 'screws'], gather: 'wood' },
  cabinet_low: { name: 'Storage Cabinet', dismantle: ['metal_scrap', 'plank', 'screws'], gather: 'wood' },
  arcade_cabinet: { name: 'Arcade Machine', dismantle: ['plank', 'plank', 'wire_spool', 'glass_shard', 'metal_scrap', 'screws'], gather: 'electro' },
  piano: { name: 'Upright Piano', dismantle: ['plank', 'plank', 'plank', 'wire_spool', 'metal_scrap'], gather: 'wood' },
  vending_snack: { name: 'Snack Machine', dismantle: ['metal_scrap', 'metal_scrap', 'glass_shard', 'wire_spool', 'gear'], gather: 'metal' },
  vending_drink: { name: 'Drinks Machine', dismantle: ['metal_scrap', 'metal_scrap', 'glass_shard', 'wire_spool', 'gear'], gather: 'metal' },
  locker: { name: 'Locker', dismantle: ['metal_scrap', 'metal_scrap', 'screws'], gather: 'metal' },
  fridge: { name: 'Fridge', dismantle: ['metal_scrap', 'metal_scrap', 'wire_spool', 'foam'], gather: 'metal' },
  water_cooler: { name: 'Water Cooler', dismantle: ['metal_scrap', 'wire_spool', 'bottle'], gather: 'metal' },
  photocopier: { name: 'Photocopier', dismantle: ['metal_scrap', 'gear', 'glass_shard', 'wire_spool', 'screws'], gather: 'electro' },
  server_rack: { name: 'Server Rack', dismantle: ['metal_scrap', 'metal_scrap', 'wire_spool', 'wire_spool'], gather: 'metal' },
  coffee_machine: { name: 'Coffee Machine', dismantle: ['metal_scrap', 'wire_spool', 'glass_shard'], gather: 'electro' },
  cake: { name: 'Office Cake' },
  balloon: { name: 'Balloon' },
  party_hat: { name: 'Party Hat' },

  // --- Level 0 fauna, fungi, cooking & scavenging (game/bio.js, game/cooking.js; models: entities/models_bio.js) ---
  // raw meat / fungus is edible but risky; cooked in the stove pan it feeds and heals more; burnt is barely food
  mole_meat: { name: 'Raw Mole Meat', pocket: true, use: 'eat', fx: { hunger: 14, health: -6, sanity: -4, infection: 8 } },
  mole_meat_cooked: { name: 'Roast Mole', pocket: true, use: 'eat', fx: { hunger: 50, health: 14, stamina: 15, sanity: 4 } },
  mole_meat_burnt: { name: 'Charred Mole', pocket: true, use: 'eat', fx: { hunger: 18, health: -2, thirst: -10, sanity: -3 } },
  crawler_meat: { name: 'Crawler Limb', pocket: true, use: 'eat', fx: { hunger: 18, health: -10, sanity: -12, infection: 15 } },
  crawler_meat_cooked: { name: 'Fried Crawler Limb', pocket: true, use: 'eat', fx: { hunger: 42, health: 8, sanity: -4 } },
  crawler_meat_burnt: { name: 'Burnt Crawler Limb', pocket: true, use: 'eat', fx: { hunger: 14, health: -4, thirst: -8, sanity: -6 } },
  fungus_black: { name: 'Black Mold Cap', pocket: true, use: 'eat', fx: { hunger: 6, health: -5, sanity: -8 } },
  fungus_black_cooked: { name: 'Fried Mold Caps', pocket: true, use: 'eat', fx: { hunger: 16, health: 4, sanity: 2 } },
  fungus_black_burnt: { name: 'Burnt Mold Caps', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 } },
  fungus_glow: { name: 'Glowcap', pocket: true, use: 'eat', fx: { hunger: 5, sanity: -14, stamina: 25 } },
  fungus_glow_cooked: { name: 'Toasted Glowcaps', pocket: true, use: 'eat', fx: { hunger: 12, sanity: 8, stamina: 15 } },
  fungus_glow_burnt: { name: 'Burnt Glowcaps', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 } },
  fungus_shelf: { name: 'Carpet Bracket', pocket: true, use: 'eat', fx: { hunger: 10, health: -2 } },
  fungus_shelf_cooked: { name: 'Seared Bracket', pocket: true, use: 'eat', fx: { hunger: 28, health: 8 } },
  fungus_shelf_burnt: { name: 'Burnt Bracket', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 } },
  fungus_puff: { name: 'Spore Puffball', pocket: true, use: 'eat', fx: { hunger: 8, thirst: -4, sanity: -6 } },
  fungus_puff_cooked: { name: 'Roasted Puffball', pocket: true, use: 'eat', fx: { hunger: 24, health: 6, sanity: 3 } },
  fungus_puff_burnt: { name: 'Burnt Puffball', pocket: true, use: 'eat', fx: { hunger: 6, health: -2, thirst: -8 } },
  canned_food_hot: { name: 'Hot Mystery Stew', pocket: true, use: 'eat', fx: { hunger: 70, thirst: -2, health: 10, sanity: 8 } },
  camp_stove: { name: 'Camp Stove', light: { r: 4, warm: 1.2, life: 0, fire: true }, shelter: 'stove', dismantle: ['metal_scrap', 'metal_scrap', 'pipe_short'], gather: 'metal' },
  supply_box: { name: 'Supply Crate', breakF: 2600, into: ['plank', 'plank', 'screws'], dismantle: ['plank', 'plank', 'screws', 'metal_scrap'], gather: 'wood' },
  sleeping_bag: { name: 'Sleeping Bag', bed: 1, shelter: 'bed', dismantle: ['fabric_scrap', 'fabric_scrap', 'foam'], gather: 'soft' },
  tent_ruin: { name: 'Collapsed Tent', dismantle: ['fabric_scrap', 'fabric_scrap', 'stick', 'stick', 'metal_scrap'], gather: 'soft' },
  trolley_broken: { name: 'Broken Trolley', dismantle: ['metal_scrap', 'metal_scrap', 'plank', 'screws'], gather: 'metal' },
  board: { name: 'Plywood Board', dismantle: ['plank', 'plank'], gather: 'wood' },

  // --- older dimensions' mission props ---
  supply_crate: { name: 'Supply Crate', device: 'crate' },
  starter_box: { name: 'Starter Kit', device: 'starter' },
  clone_pad: { name: 'Cloning Pad', device: 'clonepad' },

  // --- crafted camp machines (game/basecamp.js) ---
  trolley: { name: 'Wheel Trolley', dismantle: ['plank', 'metal_scrap', 'screws', 'wheel', 'wheel'], gather: 'metal' },
  distorter: { name: 'Distorter', shelter: 'trap', dismantle: ['wire_spool', 'metal_scrap', 'glass_shard'], gather: 'electro' },
  field_bench: { name: 'Old Workbench', bench: 2, shelter: 'bench', dismantle: ['plank', 'plank', 'metal_scrap', 'screws'], gather: 'wood' },

  // --- player & combat (game/player.js, game/tools.js) ---
  // plasma syringe: refills the mechanical heart's plasma chamber (first-person heart-patch animation)
  plasma_syringe: { name: 'Plasma Syringe', pocket: true, use: 'heal', fx: { health: 35, bleed: -1, blood: 400 }, weight: 0.3 },
  // caster wheel: attach it to a board / crate with the multitool and it spins on a real axle (DIY carts)
  wheel: { name: 'Caster Wheel', pocket: true, material: true, wheel: true, weight: 1.2 },

  // --- found weapons ---
  weapon_pipe: { name: 'Lead Pipe', pocket: true, use: 'swing', tool: { bash: 0.7 }, weapon: { dmg: 1, range: 2.0, cd: 0.5, knock: 1.3 } },
  machete: { name: 'Machete', pocket: true, use: 'swing', tool: { cut: 0.9, fine: 0.8 }, weapon: { dmg: 3, range: 2.0, cd: 0.42, knock: 0.8 } },
  riot_shield: { name: 'Riot Shield', pocket: true, shield: 0.55 },
};

export function itemDef(type) {
  return ITEM[type] || { name: type.replace(/_/g, ' ') };
}

export function itemName(type) {
  return itemDef(type).name;
}

// Supply crates of older dimensions (Poolrooms, Grasslands rooms): [type, weight]
export const CRATE_LOOT = [
  ['almond_water', 10], ['canned_food', 8], ['protein_bar', 8], ['energy_drink', 6], ['candy_bar', 5],
  ['medkit', 5], ['bandage', 8], ['antibiotics', 4], ['painkillers', 5], ['splint', 4],
  ['battery', 7], ['glowstick', 6], ['flare', 5], ['sample_jar', 6], ['welder', 2], ['flashlight', 3],
  ['screws', 5], ['tape_roll', 3], ['almond_milk', 5], ['soda_can', 4], ['noise_maker', 2],
  ['fabric_scrap', 4], ['wire_spool', 3], ['stick', 3],
];

// Research sample kinds (stored in sample_jar state.kind; older dimensions)
export const SAMPLES = {
  bacteria_residue: { name: 'Bacteria Residue', color: 0x0b120c },
  black_mold: { name: 'Black Mold', color: 0x2a2a1a },
  carpet_fungus: { name: 'Carpet Fungus', color: 0x8a7a3a },
  flood_water: { name: 'Anomalous Water', color: 0x6a8a7a },
  infected_water: { name: 'Contaminated Water', color: 0x8a9a30 },
  still_life_tissue: { name: 'Still Life Tissue', color: 0xd8b48a },
  rat: { name: 'Specimen: Rat', color: 0x6a5a4a },
  wallpaper_growth: { name: 'Wallpaper Growth', color: 0xc8b450 },
};
