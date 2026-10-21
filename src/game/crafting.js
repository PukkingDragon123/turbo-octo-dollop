// Crafting is retired. Scrap, tools and supplies are looted from boxes, lockers and abandoned camps, hauled to the
// crusher for money, and gear is bought at the camp's COMPANY STORE (game/terminals.js, game/economy.js).
// The level's old workbench devices stay as set dressing: [E] explains, the CRT says DISCONTINUED.
// (Registered over devicekinds' Workbench through DEVICE_FACTORIES; imported by game/basecamp.js.)
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { text } from '../ui/crt.js';
import { ModelDevice, DEVICE_FACTORIES } from './devicekinds.js';

// kept for old imports: nothing can be crafted any more
export const CRAFT_RECIPES = [];
export function recipeOk() { return false; }

export class RetiredBench extends ModelDevice {
  constructor(world, id, opts) {
    super(world, id, 'workbench', opts);
    this.scr = this.screen('main', 512, 384, 'amber', 1.3);
    if (this.scr) this.scr.fps = 2;
  }

  prompt() { return `[${input.keyName('interact')}] Old workbench — fabrication discontinued`; }

  interact() {
    audio.play('ui_error', { volume: 0.4, bus: 'ui' });
    this.world.game.ui.toast('FABRICATION DISCONTINUED by R.O.O.M. Procurement. Crush scrap for money, buy gear at the COMPANY STORE.', 'warn');
  }

  update(dt) {
    if (!this.scr || !this.nearLocal(8)) return;
    this.scr.draw(dt, (ctx, w, h, pal, t) => {
      text(ctx, 'DIY-OS v0.9', 16, 14, 30, pal.dim);
      text(ctx, 'DISCONTINUED', w / 2, 120, 64, Math.floor(t) % 2 ? pal.bad : pal.dim, 'center');
      text(ctx, 'BY ORDER OF PROCUREMENT', w / 2, 210, 30, pal.fg, 'center');
      text(ctx, 'PLEASE USE THE COMPANY STORE', w / 2, 250, 28, pal.dim, 'center');
    });
  }
}
DEVICE_FACTORIES.workbench = (world, id, opts) => new RetiredBench(world, id, opts);

// field benches (old saves / loot) are plain props now
export class CraftStation {
  constructor() {}
  open() {}
  hostCraft() {}
  drawIdle() {}
}
