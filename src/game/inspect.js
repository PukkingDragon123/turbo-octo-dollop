// Inspect labels. Hover the crosshair over (or, on touch, look at) a notable thing and a small floating name
// fades in near it; [E] / a tap / a click shows one short line of flavour text under the name.
//
// Opt in from anywhere:  obj.userData.inspect = { name, desc }   (any Object3D, device root or prop root)
//   or call tagInspect(obj, name, desc). Physics userData may carry `inspect` too.
// Defaults: INSPECT_DEFAULTS by prop type / device kind / device id, then the item's name (+ a line by its
// category). Lobby objects (fish tank, reception desk, chairs, elevator) are tagged at runtime by kind, type
// and object name, so level files stay untouched. Labels are floatText.say bubbles (FONT.main, small).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { floatText } from '../ui/floattext.js';
import { itemDef, itemName } from './itemdefs.js';

export const INSPECT = { range: 3.4, hoverDelay: 0.2, linger: 0.3, descTime: 5, nameSize: 0.5, descSize: 0.55, color: '#efe2c0', rescan: 6 };

export const INSPECT_DEFAULTS = {
  // HQ lobby
  aquarium: { name: 'Aquarium', desc: 'The fish have no eyes. They watch anyway.' },
  reception_desk: { name: 'Reception Desk', desc: 'Nobody has worked here in years. The monitor is still warm.' },
  hq_elevator: { name: 'Dimensional Elevator', desc: 'It only goes down. Even when it goes up.' },
  ElevatorCar: { name: 'Elevator Car', desc: 'The buttons are numbered in a language you almost read.' },
  Receptionist_RX07: { name: 'RX-07', desc: 'Smiling. It has been smiling for a very long time.' },
  // office furniture & devices found on shifts
  vending_snack: { name: 'Snack Machine', desc: 'Every coil holds the same snack. You never chose it.' },
  vending_drink: { name: 'Drink Machine', desc: 'It hums a song you heard as a child.' },
  water_cooler: { name: 'Water Cooler', desc: 'The bubbles rise a little too slowly.' },
  dart_board: { name: 'Dart Board', desc: 'Someone was very good at this. Then they stopped.' },
  locker_bank: { name: 'Lockers', desc: 'One of them is always locked from the inside.' },
  service_bell: { name: 'Service Bell', desc: 'Ring it. Somebody, somewhere, gets up.' },
  crt_terminal: { name: 'Terminal', desc: 'The cursor blinks like it is waiting for an apology.' },
  lore_terminal: { name: 'Old Terminal', desc: 'Its files remember people you never met.' },
  poster: { name: 'Poster', desc: 'MORALE IS MANDATORY.' },
  wall_clock: { name: 'Wall Clock', desc: 'It says 3:33. It always says 3:33.' },
  employee_of_month: { name: 'Employee of the Month', desc: 'Every month, the same face. Every month, a little older.' },
  mirror: { name: 'Mirror', desc: 'Your reflection blinks a moment after you do.' },
  coffee_machine: { name: 'Coffee Machine', desc: 'Brews something black. Calling it coffee is generous.' },
  fridge: { name: 'Fridge', desc: 'Labelled lunches. None of the names are real.' },
  server_rack: { name: 'Server Rack', desc: 'Warm, blinking, and listening.' },
  workbench: { name: 'Workbench', desc: 'Scarred by a thousand bad ideas. Make another.' },
  creepy_tv: { name: 'Television', desc: 'Static, and in the static, a hallway.' },
};

// HQ waiting-room furniture (props, tagged at runtime only in the lobby)
export const LOBBY_PROPS = {
  chair_wood: { name: 'Waiting Chair', desc: 'The seat is warm. Nobody was sitting in it.' },
  chair_office: { name: 'Office Chair', desc: 'Turned slightly away, as if someone just stood up.' },
  table_round: { name: 'Side Table', desc: 'Magazines from a month that never happened.' },
};

// a line by item category when nothing specific is written
const CATEGORY = {
  eat: 'Still sealed. The date is a smudge.',
  drink: 'Smells faintly of almonds.',
  heal: 'Use it before you need it.',
  swing: 'Heavy enough to change somebody\'s mind.',
  flashlight: 'The light keeps the dark honest.',
  battery: 'A little bottled lightning.',
  multitool: 'Welds, attaches, takes apart. Mostly takes apart.',
  material: 'Scrap. The crusher pays for it.',
  furniture: 'Heavy. Someone carried it here, once.',
  item: 'Ordinary. That is what worries you.',
};

export function tagInspect(obj, name, desc = '') {
  if (obj) obj.userData.inspect = { name, desc };
  return obj;
}

// inspect info for a prop (type defaults, its def, its name)
export function propInspect(p) {
  const ud = p.root?.userData?.inspect;
  if (ud) return ud;
  const d = INSPECT_DEFAULTS[p.type];
  if (d) return d;
  const def = p.def || itemDef(p.type);
  if (def.inspect) return def.inspect;
  const cat = def.material ? 'material' : CATEGORY[def.use] ? def.use : def.pocket === false || (!def.pocket && (p.mass || 0) > 6) ? 'furniture' : 'item';
  return { name: itemName(p.type), desc: def.desc || CATEGORY[cat] };
}

export function deviceInspect(dev) {
  return dev.root?.userData?.inspect || dev.inspect || INSPECT_DEFAULTS[dev.key] || INSPECT_DEFAULTS[dev.id] || null;
}

const _box = new THREE.Box3(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
const _ray = new THREE.Ray(), _hit = new THREE.Vector3();
const ZERO = new THREE.Vector3();

export class Inspector {
  constructor(player) {
    this.p = player;
    this.target = null;   // { key, info, root }
    this.hoverT = 0;
    this.lostT = 0;
    this.label = null;    // floatText handle
    this.labelKind = '';
    this.anchor = new THREE.Vector3();
    this.tagged = [];     // registered Object3Ds with userData.inspect (no collider of their own)
    this.scanT = 0;
    this.world = null;
    this.lastPress = -9;
  }

  // ---- runtime tagging: device roots, lobby props, and objects found by name
  _scan(world) {
    for (const dev of world.devices?.values?.() || []) {
      const d = deviceInspect(dev);
      if (d && dev.root && !dev.root.userData.inspect) dev.root.userData.inspect = d;
      if (dev.root) dev.root.userData._idev = true; // found through its colliders
    }
    const props = new Set(), lobby = !!this.p.game?.isLobby;
    for (const pr of world.props?.props?.values?.() || []) {
      if (!pr?.root) continue;
      props.add(pr.root);
      if (lobby && LOBBY_PROPS[pr.type] && !pr.root.userData.inspect) pr.root.userData.inspect = LOBBY_PROPS[pr.type];
    }
    const list = [];
    world.group?.traverse?.((o) => {
      if (!o.userData) return;
      if (!o.userData.inspect && o.name && INSPECT_DEFAULTS[o.name]) o.userData.inspect = INSPECT_DEFAULTS[o.name];
      if (o.userData.inspect && !o.userData._idev && !props.has(o)) list.push(o);
    });
    this.tagged = list;
  }

  register(obj) { if (obj && !this.tagged.includes(obj)) this.tagged.push(obj); }

  // what the crosshair rests on: the physics hit (device / prop / tagged collider), or a tagged object's box
  _pick(focus, hit) {
    const cam = engine.camera;
    let best = null, bd = hit ? hit.dist + 0.2 : INSPECT.range;
    const ud = hit?.ud;
    if (ud && hit.dist <= INSPECT.range) {
      if (ud.inspect) best = { key: ud, info: ud.inspect, root: null, point: hit.point };
      else if (ud.kind === 'device' && ud.device) {
        const info = deviceInspect(ud.device);
        if (info) best = { key: ud.device, info, root: ud.device.root, point: hit.point };
      } else if (ud.kind === 'prop' && ud.prop && !ud.prop.dead) best = { key: ud.prop, info: propInspect(ud.prop), root: ud.prop.root, point: hit.point };
    }
    if (!best && focus?.kind === 'propinfo' && focus.target?.root) best = { key: focus.target, info: propInspect(focus.target), root: focus.target.root, point: focus.target.root.position };
    if (best) return best;
    // tagged objects without colliders: ray vs their bounds (nearest, not behind a wall)
    _ray.origin.copy(cam.position);
    _ray.direction.set(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const o of this.tagged) {
      if (!o.parent || !o.visible) continue;
      const bb = o.userData._ibox || (o.userData._ibox = { box: new THREE.Box3(), t: -9 });
      if (engine.time - bb.t > 1) { bb.box.setFromObject(o); bb.t = engine.time; }
      if (bb.box.containsPoint(cam.position) || !_ray.intersectBox(bb.box, _hit)) continue;
      const d = _hit.distanceTo(cam.position);
      if (d < bd) { bd = d; best = { key: o, info: o.userData.inspect, root: o, point: _hit.clone() }; }
    }
    return best;
  }

  // float the label in front of the object, a little above its top (never above eye height)
  _place(t) {
    const cam = engine.camera;
    if (t.root) {
      _box.setFromObject(t.root);
      if (_box.isEmpty()) _box.setFromCenterAndSize(t.point, _s.set(0.3, 0.3, 0.3));
    } else _box.setFromCenterAndSize(t.point, _s.set(0.3, 0.3, 0.3));
    _box.getCenter(_c); _box.getSize(_s);
    _d.subVectors(cam.position, _c).setY(0);
    if (_d.lengthSq() < 1e-4) _d.set(0, 0, 1);
    _d.normalize();
    const ext = Math.abs(_d.x) * _s.x * 0.5 + Math.abs(_d.z) * _s.z * 0.5;
    const toCam = Math.max(0, Math.min(ext + 0.06, _c.distanceTo(cam.position) - 0.5));
    this.anchor.copy(_c).addScaledVector(_d, toCam);
    this.anchor.y = Math.min(_box.max.y + 0.12, cam.position.y + 0.04);
    if (this.anchor.y < _box.min.y + 0.1) this.anchor.y = _box.min.y + 0.1;
  }

  _size(k) { return THREE.MathUtils.clamp(this.anchor.distanceTo(engine.camera.position) * k, 0.35, 1.6); }

  _showName() {
    const t = this.target;
    this.label?.close();
    this.label = floatText.say(t.info.name, { at: this.anchor, offset: ZERO, size: this._size(INSPECT.nameSize), color: INSPECT.color, duration: 600 });
    this.labelKind = 'name';
  }

  _showDesc() {
    const t = this.target;
    if (!t.info.desc) { if (this.labelKind !== 'name') this._showName(); return; }
    // replaces the name bubble (same anchor): the name rides above the line, small caps between hairlines
    this.label = floatText.say(t.info.desc, { at: this.anchor, offset: ZERO, speaker: t.info.name, size: this._size(INSPECT.descSize), color: INSPECT.color, duration: INSPECT.descTime });
    this.labelKind = 'desc';
  }

  _alive() { const b = this.label?.bubble; return !!b && b.closing < 0; }

  clear() {
    this.label?.close();
    this.label = null; this.labelKind = ''; this.target = null; this.hoverT = 0;
  }

  update(dt, focus, hit, enabled = true) {
    const p = this.p, w = p.world;
    if (!w || !enabled || p.dead || p.watchOpen || p.grab) { if (this.target) this.clear(); return; }
    if (w !== this.world) { this.world = w; this.clear(); this._scan(w); this.scanT = 0; }
    this.scanT += dt;
    if (this.scanT > INSPECT.rescan) { this.scanT = 0; this._scan(w); }
    const t = this._pick(focus, hit);
    if (!t || !t.info?.name) {
      if (this.target) {
        this.lostT += dt;
        if (this.lostT > (this.labelKind === 'desc' ? 1.2 : INSPECT.linger)) this.clear();
      }
      return;
    }
    this.lostT = 0;
    if (!this.target || this.target.key !== t.key) {
      this.label?.close();
      this.label = null; this.labelKind = '';
      this.target = t; this.hoverT = 0;
      this._place(t);
    }
    this.hoverT += dt;
    // [E] / a tap / a click (devices and tagged things; LMB only with an empty right hand)
    const free = !p.hands?.R?.type;
    const isProp = t.key && t.key.def !== undefined && t.key.type !== undefined;
    const press = input.hit('interact') || (!isProp && (input.mouseHit(2) || (free && input.mouseHit(0))));
    if (press && engine.time - this.lastPress > 0.4) {
      this.lastPress = engine.time;
      this._place(t);
      this._showDesc();
      return;
    }
    if (!this._alive()) {
      this.label = null;
      if (this.hoverT >= INSPECT.hoverDelay) { this._place(t); this._showName(); }
    }
  }

  dispose() { this.clear(); this.tagged = []; }
}
