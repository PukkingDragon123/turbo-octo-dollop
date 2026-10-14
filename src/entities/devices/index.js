// New-style device builders (DKit). models_devices.js merges these over its legacy builders.
import { b_fuse_box } from './wall.js';
import { b_generator_diesel, b_generator_electric, b_generator_mech } from './generators.js';
import { b_vending_snack, b_vending_drink } from './vending.js';

export const NEW_BUILDERS = {
  fuse_box: b_fuse_box,
  generator_diesel: b_generator_diesel, generator_electric: b_generator_electric, generator_mech: b_generator_mech,
  vending_snack: b_vending_snack, vending_drink: b_vending_drink,
};
