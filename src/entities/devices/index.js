// New-style device builders (DKit). models_devices.js merges these over its legacy builders.
import { b_fuse_box, b_employee_of_month, b_wall_clock, b_poster, b_mirror, b_ceiling_vent, b_wall_vent, b_fire_alarm, b_exit_sign, b_hazard_sign } from './wall.js';
import { b_generator_diesel, b_generator_electric, b_generator_mech } from './generators.js';
import { b_vending_snack, b_vending_drink } from './vending.js';
import { b_water_cooler, b_aquarium, b_service_bell, b_dart_board, b_coffee_machine, b_fridge } from './breakroom.js';
import { b_crt_terminal, b_reception_desk, b_photocopier, b_server_rack, b_locker, b_locker_bank } from './office.js';
import { b_clone_tube, b_clone_console, b_clone_pad } from './clonelab.js';
import { b_dispatch_door, b_dispatch_lever, b_radio, b_supply_crate, b_starter_box } from './dispatch.js';
import { b_exit_door, b_exit_room_shell } from './exit.js';
import { b_workbench, b_pipe_cluster } from './workshop.js';
import { b_cg_kit, b_cg_pole, b_cg_canvas, b_cg_stakes, b_cg_stake, b_cg_lamp, b_cg_stove, b_cg_supply, b_cg_board, b_cg_bag } from './camp.js';
import { b_crusher_frame, b_crusher_ram, b_crusher_gate, b_kiosk_shop, b_kiosk_quest, b_kiosk_key, b_kiosk_crank } from './mission.js';

export const NEW_BUILDERS = {
  fuse_box: b_fuse_box, employee_of_month: b_employee_of_month, wall_clock: b_wall_clock, poster: b_poster, mirror: b_mirror,
  ceiling_vent: b_ceiling_vent, wall_vent: b_wall_vent, fire_alarm: b_fire_alarm, exit_sign: b_exit_sign, hazard_sign: b_hazard_sign,
  generator_diesel: b_generator_diesel, generator_electric: b_generator_electric, generator_mech: b_generator_mech,
  vending_snack: b_vending_snack, vending_drink: b_vending_drink,
  water_cooler: b_water_cooler, aquarium: b_aquarium, service_bell: b_service_bell, dart_board: b_dart_board, coffee_machine: b_coffee_machine, fridge: b_fridge,
  crt_terminal: b_crt_terminal, reception_desk: b_reception_desk, photocopier: b_photocopier, server_rack: b_server_rack, locker: b_locker, locker_bank: b_locker_bank,
  clone_tube: b_clone_tube, clone_console: b_clone_console, clone_pad: b_clone_pad,
  dispatch_door: b_dispatch_door, dispatch_lever: b_dispatch_lever, radio: b_radio, supply_crate: b_supply_crate, starter_box: b_starter_box,
  exit_door: b_exit_door, exit_room_shell: b_exit_room_shell,
  workbench: b_workbench, pipe_cluster: b_pipe_cluster,
  crusher_frame: b_crusher_frame, crusher_ram: b_crusher_ram, crusher_gate: b_crusher_gate,
  cg_kit: b_cg_kit, cg_pole: b_cg_pole, cg_canvas: b_cg_canvas, cg_stakes: b_cg_stakes, cg_stake: b_cg_stake, cg_lamp: b_cg_lamp,
  cg_stove: b_cg_stove, cg_supply: b_cg_supply, cg_board: b_cg_board, cg_bag: b_cg_bag,
  kiosk_shop: b_kiosk_shop, kiosk_quest: b_kiosk_quest, kiosk_key: b_kiosk_key, kiosk_crank: b_kiosk_crank,
};
