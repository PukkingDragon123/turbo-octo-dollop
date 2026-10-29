// R.O.O.M. — Level 0 field-camp kit models (picked up by catalog.js through the models_*.js glob).
//
// Physics props (origin = centre of the visual bounds, front +Z, meters), modelled with the device kit
// (src/entities/devices/camp.js: cached DKit templates, cloned per spawn):
//   camp_kit     long wooden TENT KIT crate. parts.lid (hinge at the back top edge; rotation.x < 0 opens)
//   camp_pole    aluminium A-frame tent pole (legs in the XY plane, apex up)
//   camp_canvas  rolled tent canvas bundle (long axis X) with straps
//   camp_stakes  bundle of tent stakes tied with cord (long axis X)
//   camp_lamp    stake post with a hanging hurricane lantern. userData.setLit(bool), parts.mantle
// The finished tent, the teleport pads and the ghost markers are built in src/game/campdevices.js.
import { buildDevice } from './models_devices.js';

export { POLE_W, POLE_H, LAMP_H } from './devices/camp.js';

function campLamp() {
  const m = buildDevice('cg_lamp');
  const mat = m.parts.mantle?.material; // per-instance clone (userData.unique)
  m.object.userData.setLit = (on) => { if (!mat) return; mat.emissiveIntensity = on ? 5 : 0; mat.color.setHex(on ? 0xffe0a0 : 0x40301a); };
  return m;
}

export const ITEMS = {
  camp_kit: () => buildDevice('cg_kit'),
  camp_pole: () => buildDevice('cg_pole'),
  camp_canvas: () => buildDevice('cg_canvas'),
  camp_stakes: () => buildDevice('cg_stakes'),
  camp_lamp: campLamp,
};
