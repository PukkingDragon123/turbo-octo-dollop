# R.O.O.M.

**Research Office for Otherworldly Matters** is a 1–4 player co-op survival-horror game set in the Backrooms. It runs in the browser and is inspired by R.E.P.O., Lethal Company and PEAK.

R.O.O.M. is a shady 1990s corporation. It sends disposable clones into strange dimensions to study anomalies, collect samples, take photos and restart generators, all on a 7-day clock before reality collapses. Your clones are chubby sack-doll employees in yellow hazmat gear.

Everything is procedural: geometry, textures, animation, sound and music are all generated at runtime. The game ships with zero image or audio files.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (deployable to any static host)
```

* **Solo shift**: play offline.
* **Host shift**: creates a 5-character shift code. Up to three friends enter it under **Join shift**.
  * Multiplayer is peer-to-peer WebRTC (PeerJS).
  * Joining needs internet access to the public PeerJS signalling server.
* **Proximity voice chat**: positional 3D audio, muffled through walls. Monsters can hear you talk.
  * Choose open mic, push-to-talk (**V**) or off in Settings.
  * The living can't hear the dead, but the dead hear everyone.

A GitHub Pages workflow (`.github/workflows/deploy.yml`) builds and deploys on every push to `main`. To use it, enable **Pages → Source: GitHub Actions** in the repository settings.

### Controls

| Action | Keys |
|---|---|
| Move / sprint / crouch / jump | WASD / Shift / Ctrl or C / Space |
| Grab physics objects (and teammates) | hold **LMB**. While holding: **wheel** = distance, **R + mouse** = rotate, **RMB** = throw |
| Interact / pick up | **E** |
| Use the selected item (eat, drink, heal, weld, dismantle, collect sample) | **RMB** |
| Inventory slots | **1–5** / wheel |
| Drop or throw an item | **G** |
| Flashlight | **F** |
| Wristwatch | **Tab**. Switch tabs with **Q/E**. **LMB** takes a photo in the CAMERA tab |
| Emotes | **H** wave, **J** dance, **B** point |
| Third-person view | **T** |
| Pause | **Esc** |

## The game loop

1. **HQ lobby (Sublevel B4)**
   * Reception with a receptionist who turns to watch you when nobody is looking.
   * Open office with working CRT terminals: shift roster, orientation, achievements and lore.
   * Locker room: customize your clone in front of a real mirror.
   * Break room:
     * Vending machines that sometimes jam until you hit them with something.
     * Water cooler.
     * Aquarium with swimming fish. It shatters if you throw something heavy at it, and the fish flop around.
     * Darts with real scoring on a scoreboard.
     * Couch, a training-video TV, coffee machine and fridge.
   * Cloning lab with creepy half-finished clones floating in tubes.
   * Uncanny touches: a waiting-room chair slowly sinks into the floor, and posters, clocks and the Employee of the Month change when nobody is looking.
   * Pull the **dispatch lever**. Anything inside the hazard-striped zone comes with you.
2. **Dispatch**: the team falls through the ceiling into **Level 0, the Yellow Rooms**, with a cardboard **starter kit** (flashlight, protein bar, almond milk, bandage and multitool, one set per clone). Late joiners don't get a box.
3. **Mission**:
   * Find and repair **three generators**, each with its own physical mechanic:
     * **Diesel:** carry a fuel can and hold it at the filler cap, then hold and release the recoil cord inside the timing window.
     * **Electrical:** open the panel, re-wire colour-coded terminals (wrong socket = shock), insert an industrial fuse and throw the breaker.
     * **Mechanical:** weld three glowing cracks, tighten four bolts with the multitool, then crank it up. Several clones crank faster.
   * Every generator is loud and attracts monsters.
4. **Physically carry the field radio** to each running generator to establish an uplink. Use the radio to:
   * transmit research photos;
   * deposit samples;
   * order **supply crates**, which crash through the ceiling;
   * **request extraction**.
5. **Evacuate**: a mysterious exit door opens with a 120-second countdown.
   * Physically carry whatever you want to keep into the exit room.
   * Anyone left outside dies.
   * The next dimension starts with a fresh 7-day timer.
6. **Death**:
   * Dead clones spectate. Their body and items stay in the world.
   * Teammates can spend credits at the **cloning pad** to bring them back.
   * If everyone dies, or Day 7 ends, the run is over: back to HQ, starting again from Level 1.
   * Only cosmetics and achievements persist between runs.

### The seven-day reality collapse

Each day lasts exactly **10 real minutes**, so you have at most 70 minutes per dimension. The current day (`DAY X/7`) is shown on your wristwatch and on the radio.

| Days | What happens |
|---|---|
| 1–2 | Stable. |
| 3–4 | More anomalies and monsters. Furniture starts moving when nobody is looking. |
| 5–6 | Lights die, furniture sinks into the carpet, and more creatures appear. |
| 7 | Reality starts to collapse: walls wobble, lights turn red, unseen corridors re-arrange themselves and monsters get aggressive. |

When Day 7 ends, the dimension is gone and so is anyone still inside it.

### Systems

* **Physics (Rapier)**
  * Almost everything can be grabbed, rotated, dragged, stacked, thrown and broken.
  * Each player's grab force is capped, so heavy furniture needs several clones working together.
  * **Weld** objects together or to walls with real physics joints to build barricades.
  * Dismantle furniture into materials with the multitool.
  * Craft barricade panels, spike traps, noise makers, splints, bandages and lamps at **workbenches**.
* **Survival**: hunger, thirst, blood volume and blood pressure, bleeding (light or heavy), fractures, infection, stamina, sleep and insomnia, and sanity.
  * Sanity drops in the dark, when alone and when you see monsters.
  * Low sanity brings hallucinations: whispers, fake footsteps, shadow figures and lying warnings.
* **Healthity**: a floating medical robot with a pixel face. It warns you about your condition and gives terrible corporate wellness advice. You can pat it.
* **Wristwatch**: a retro corporate terminal with these tabs:
  * **STATUS**: vitals with a live EKG.
  * **CAMERA**: research photos.
  * **RESEARCH**: your photos and samples.
  * **MAP**: explored cells, the generators, the radio and the exit.
  * **MSG**: message log.
  * **TASKS**: objectives.
* **The Bacteria** (based on Kane Pixels' Backrooms films): a tall, black, wet stick figure with unnatural stop-motion procedural animation.
  * It **hunts by sound**: footsteps, impacts, generators, welding, crates crashing in and voice chat.
  * It stalks at the edge of your light and freezes when watched.
  * It chases on all fours and smashes through barricades.
  * It is afraid of lit flares.
* **Still Lifes**: sack-doll clones with horribly wrong anatomy.
  * Watchers and twins only move when nobody is looking.
  * Crawlers hate flashlights.
  * Masses lumber toward you.
  * Tall ones walk away and vanish.
  * A camera flash freezes them.
* **Rats and cockroaches** scatter from footsteps and flashlights and escape into wall vents. You can catch rats in sample jars.

### Level 0: the Yellow Rooms

* An endless world generated in 24 m chunks from a seed, identical on every peer.
* Sectors: classic yellow halls, cubicle offices, concrete maintenance areas, flooded sectors with reflective water, pillar halls, dark zones and manila rooms.
* Memorable rooms:
  * chair piles;
  * a bedroom;
  * a TV room with a face in the static;
  * a red chair;
  * stairs to nowhere;
  * a wall of false doors;
  * storage rooms with loot;
  * furniture clipped into walls or sunk into the floor;
  * a workshop;
  * an **endless hallway** that keeps sending you back;
  * the remains of previous clones;
  * a glimpse of the Poolrooms.
* Lighting is "dynamic baked" fluorescent light. Every vertex stores its strongest lights, so individual tubes can flicker, die or turn red while the whole level renders with a few materials. Moving objects get per-object light probes.

## Tech notes

* **Engine**: Three.js r186 (WebGL2), Rapier 3D (WASM), PeerJS (WebRTC), Vite.
* **Rendering**:
  * PBR materials on procedural canvas textures (albedo, normal and roughness).
  * Planar water reflections and a real mirror.
  * Post-processing: bloom, GTAO on High, FXAA, and a camcorder pass with grain, vignette, chromatic aberration, damage and sanity warping, and collapse glitching.
  * The first-person viewmodel is drawn in its own overlay pass.
* **Networking**:
  * The host is authoritative for props, monsters, devices, the day clock and the mission.
  * Clients own their player movement and survival stats.
  * Prop transforms are sent as compact binary snapshots and interpolated on clients.
* **Code layout**:

  | Path | Contents |
  |---|---|
  | `src/core` | Engine, input, profile and seeded RNG |
  | `src/gfx` | Textures, materials, post-processing, particles, baked lighting, water |
  | `src/audio` | Procedural sound effects, loops, music and mixer |
  | `src/net` | Networking and voice chat |
  | `src/physics` | Rapier wrapper |
  | `src/entities` | Procedural models: avatar, creatures, furniture, items, devices |
  | `src/game` | Gameplay systems |
  | `src/world` | Lobby, level registry, Yellow Rooms generator and navigation |
  | `src/ui` | HUD, menus, CRT terminals, wristwatch |
* **Adding dimensions**:
  * New levels plug into `src/world/levels/registry.js`.
  * Poolrooms, Grasslands and Endless Hotel are already registered as upcoming levels.
  * Until a level is implemented, evacuation leads to a deeper, harder sector of the Yellow Rooms.
* **Test and debug URL parameters**:
  * `?auto=solo` skips the menu.
  * `?auto=solo&level=yellow` dispatches straight into Level 0.
  * `?daylen=60` makes each day last 60 seconds.
  * `?q=low|medium|high` sets graphics quality.
