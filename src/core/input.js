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
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons = 0; });
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
    window.addEventListener('mousedown', (e) => {
      const b = 1 << e.button;
      this.mouse.buttons |= b;
      this.mouse.pressed |= b;
    });
    window.addEventListener('mouseup', (e) => {
      const b = 1 << e.button;
      this.mouse.buttons &= ~b;
      this.mouse.released |= b;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      for (const l of this.listeners) l('lock', this.locked);
    });
  }

  onEvent(fn) { this.listeners.push(fn); }

  requestLock() {
    if (!this.canvas || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

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
