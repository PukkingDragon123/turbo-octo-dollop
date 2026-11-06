// Retired: the "reality liquefaction" episodes (flowing walls + screen-space melting) are gone with the old-footage
// look (docs/ART_DIRECTION.md: no liquefying walls, no glitch). The class stays so main.js keeps working; unease
// now shows through the gentle low-sanity treatment of the post stack (post.params.uSanity).
export class Distortion {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.episode = 0;
  }

  update() {}
}
