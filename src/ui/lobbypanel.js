// The HTML lobby roster panel is retired: the HQ waiting room is run entirely in-world (the elevator's
// split-flap board shows the shift code, the call panel has HOST / JOIN / START / EXIT, see
// world/hq_elevator.js and world/lobby_director.js). This stub keeps the interface ui.js still calls.
export class LobbyPanel {
  constructor(ui) { this.ui = ui; this.visible = false; }
  get bottomPx() { return 0; }
  setVisible(on) { this.visible = !!on; }
  update() {}
  start() {}
}
