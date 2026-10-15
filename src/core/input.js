// Keyboard / mouse input with pointer lock, per-frame edge detection and rebind-able actions.
const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  interact: ['KeyE'],
  drop: ['KeyG'],
  flashlight: ['KeyF'],
  watch: ['Tab'],
  rotate: ['KeyR'],
  talk: ['KeyV'],
  emoteWave: ['KeyH'],
  emoteDance: ['KeyJ'],
  emotePoint: ['KeyB'],
  tabPrev: ['KeyQ'],
  tabNext: ['KeyE'],
  thirdPerson: ['KeyT'],
  pause: ['Escape'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'],
};

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, pressed: 0, released: 0, x: 0, y: 0 };
    this.binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
    this.locked = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = true;
    this.textCapture = null; // when a text field is focused / terminal typing
    this.listeners = [];
    // touch devices: the on-screen controls (ui/touch.js) feed virtual keys, buttons and look deltas;
    // "pointer lock" becomes a plain flag so the pause / resume flow works unchanged
    this.touch = false;
    this.moveAxis = null; // analog stick { x, y } in [-1, 1] (y < 0 = forward), null when idle
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (this.textCapture) {
        this.textCapture(e);
        if (e.code !== 'Escape') return;
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || (e.ctrlKey && e.code !== 'KeyC' && e.code !== 'KeyV')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      for (const l of this.listeners) l('down', e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
      for (const l of this.listeners) l('up', e.code, e);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons = 0; this.moveAxis = null; });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.locked) {
        // clamp crazy spikes some browsers emit on lock
        const dx = Math.max(-300, Math.min(300, e.movementX));
        const dy = Math.max(-300, Math.min(300, e.movementY));
        this.mouse.dx += dx;
        this.mouse.dy += dy;
      }
    });
    // compatibility mouse events that follow a touch would otherwise read as clicks / grabs
    const synthetic = () => this.touch && performance.now() - (this.lastTouch || -1e9) < 1200;
    window.addEventListener('mousedown', (e) => {
      if (synthetic()) return;
      const b = 1 << e.button;
      this.mouse.buttons |= b;
      this.mouse.pressed |= b;
    });
    window.addEventListener('mouseup', (e) => {
      if (synthetic()) return;
      const b = 1 << e.button;
      this.mouse.buttons &= ~b;
      this.mouse.released |= b;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.touch) return;
      this.locked = document.pointerLockElement === canvas;
      for (const l of this.listeners) l('lock', this.locked);
    });
  }

  onEvent(fn) { this.listeners.push(fn); }

  _setLocked(v) {
    if (this.locked === v) return;
    this.locked = v;
    for (const l of this.listeners) l('lock', v);
  }

  // ---- virtual input (touch controls) ----
  virtualDown(code) {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }
  virtualUp(code) {
    if (!this.keys.has(code)) return;
    this.keys.delete(code);
    this.released.add(code);
  }
  virtualMouse(btn, down) {
    const b = 1 << btn;
    if (down) { this.mouse.buttons |= b; this.mouse.pressed |= b; } else if (this.mouse.buttons & b) { this.mouse.buttons &= ~b; this.mouse.released |= b; }
  }
  addLook(dx, dy) { this.mouse.dx += dx; this.mouse.dy += dy; }
  releaseAll() {
    for (const k of [...this.keys]) this.virtualUp(k);
    for (let b = 0; b < 3; b++) this.virtualMouse(b, false);
    this.moveAxis = null;
  }

  requestLock() {
    if (this.touch) { this._setLocked(true); return; }
    if (!this.canvas || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
  }
  exitLock() {
    if (this.touch) { this.releaseAll(); this._setLocked(false); return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // --- queries ---
  down(action) {
    if (!this.enabled) return false;
    const b = this.binds[action];
    return b ? b.some((k) => this.keys.has(k)) : this.keys.has(action);
  }
  hit(action) {
    if (!this.enabled) return false;
    const b = this.binds[action];
    return b ? b.some((k) => this.pressed.has(k)) : this.pressed.has(action);
  }
  up(action) {
    const b = this.binds[action];
    return b ? b.some((k) => this.released.has(k)) : this.released.has(action);
  }
  mouseDown(btn = 0) { return this.enabled && (this.mouse.buttons & (1 << btn)) !== 0; }
  mouseHit(btn = 0) { return this.enabled && (this.mouse.pressed & (1 << btn)) !== 0; }
  mouseUp(btn = 0) { return (this.mouse.released & (1 << btn)) !== 0; }
  consumeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return this.enabled ? w : 0; }
  look() {
    const s = 0.0022 * this.sensitivity;
    const r = { x: this.mouse.dx * s, y: this.mouse.dy * s * (this.invertY ? -1 : 1) };
    return this.enabled ? r : { x: 0, y: 0 };
  }

  // call at end of frame
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.pressed = 0;
    this.mouse.released = 0;
    this.mouse.wheel = 0;
  }

  keyName(action) {
    const k = (this.binds[action] || [action])[0] || '?';
    return k.replace('Key', '').replace('Digit', '').replace('Left', '').replace('Right', '');
  }
}

export const input = new Input();
