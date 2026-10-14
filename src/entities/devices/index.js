// Device builders remade on the device kit (src/entities/devices/core.js). models_devices.js merges
// these over its registry.
import { b_fuse_box } from './wall.js';
import { b_generator_diesel, b_generator_electric, b_generator_mech } from './generators.js';

export const NEW_BUILDERS = {
  fuse_box: b_fuse_box,
  generator_diesel: b_generator_diesel,
  generator_electric: b_generator_electric,
  generator_mech: b_generator_mech,
};
