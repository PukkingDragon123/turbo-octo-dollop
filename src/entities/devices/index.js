// New-style device builders (DKit). models_devices.js merges these over its legacy builders.
import { b_fuse_box, b_employee_of_month, b_wall_clock, b_poster, b_mirror, b_ceiling_vent, b_wall_vent, b_fire_alarm, b_exit_sign, b_hazard_sign } from './wall.js';
import { b_generator_diesel, b_generator_electric, b_generator_mech } from './generators.js';
import { b_vending_snack, b_vending_drink } from './vending.js';

export const NEW_BUILDERS = {
  fuse_box: b_fuse_box, employee_of_month: b_employee_of_month, wall_clock: b_wall_clock, poster: b_poster, mirror: b_mirror,
  ceiling_vent: b_ceiling_vent, wall_vent: b_wall_vent, fire_alarm: b_fire_alarm, exit_sign: b_exit_sign, hazard_sign: b_hazard_sign,
  generator_diesel: b_generator_diesel, generator_electric: b_generator_electric, generator_mech: b_generator_mech,
  vending_snack: b_vending_snack, vending_drink: b_vending_drink,
};
