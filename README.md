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

* **First dimension**: pick Level 0, the Poolrooms or the Grasslands on the main menu; the dispatch lever sends you there.
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
| Interact / pick up | tap **RMB** (or **E**) |
| Grab and pull physics objects (and teammates) | hold **RMB**: the longer you hold, the harder you pull. While holding: **Shift** = throw far, **LMB** = throw, **wheel** = distance, **R + mouse** = rotate |
| Punch | **LMB** (hold to wind up a haymaker). Hard hits knock teammates out into a ragdoll for ~2 s |
| Use the item in your right hand (eat, drink, heal, swing a crowbar, light, throw) | **LMB** |
| Built-in multitool: attach / detach / dismantle what you aim at, or the camp part you carry | **Q** draws it, hold **LMB** to charge power (a full charge zaps), **R** switches ATTACH / DISMANTLE |
| Swap hands / pick the right-hand item | **1–5** / wheel |
| Drop an item (hold: drop everything) | **G** |
| Flashlight | **F** |
| Wristwatch | **Tab**. Switch tabs with **Q/E**. **LMB** takes a photo in the CAMERA tab |
| Emotes | **H** wave, **J** dance, **B** point |
| Third-person view | **T** |
| Pause | **Esc** |

#### Phones and tablets

Touch devices get on-screen controls styled like the knobs of a 1990s field terminal (force them with `?touch=1`, hide them with `?touch=0`):

* **Left thumb**: a floating analog stick. Push it to the rim to sprint.
* **Right thumb**: drag to look, tap to interact with whatever is under the dot.
* **Buttons**: JUMP, USE (shows what it will do), GRAB (tap = use, hold = grab and pull; ROT appears while carrying), PUNCH (punch / use the right-hand item / the multitool; THROW while carrying), TOOL (multitool), DUCK, plus WATCH, LIGHT, NEXT (swap hands), DROP, VIEW and MENU along the top. ◀ ▶ switch watch tabs. Quick-time events turn the whole screen into a tap / hold area.
* Phones start on the LOW graphics preset unless you pick one in Settings.

#### Healthity

You start without one. On Level 0 two crates wait between the lift and the camp: one holds basic supplies, the other knocks from the inside. Open it and a broken **Healthity MK-VII** (a yellowed, cracked 1979 medical unit with doll eyes on a little CRT and a receipt printer for a mouth) slumps out, sparking. Press **E** on it to repair it: the view zooms into its opened chassis, where you drag each loose wire onto the post of its colour (a wrong post shorts out) and hold on every joint to zap it with your multitool. Then it reboots, floats up and prints your orders as a **receipt** out of its mouth: take it (**E** on Healthity, or pick it up off the floor) to read it up close, and press **X** to read it again. The boxes tick as you finish tasks, and a new receipt prints when the orders change. Healthity talks in floating text next to itself with a synthesized voice (toggle in Settings), gives tips for the current task, warns about low health, sanity and battery, and charges your multitool (**E** when the battery is not full).

All messages in the game (HQ radio, pickups, warnings, achievements) are floating 3D text instead of screen boxes.

#### (Almost) no HUD

The only HUD is two little machines at the top of the view, drawn in 3D:

* a **mechanical heart** (health): brass valves, a pressure gauge and a glass chamber of sloshing green plasma that beats with your pulse. Damage cracks the glass, the cracks leak plasma while you bleed and the pressure needle sags. A **bandage**, **medkit** or **plasma syringe** plays a first-person patch-up: your clone pulls the heart out of its chest, tapes the cracks and/or injects plasma, and pushes it back in. Food and drink heal a little too.
* a **mechanical brain** called **SANITY**: glass hemispheres of glowing filaments and gears in a steel cage. It drains in the dark, alone and near monsters, and recovers with teammates and light. Low sanity turns it violet, then red, and you start hallucinating; at zero for a few seconds, your clone dies of insanity.

What you carry sits in your hands: one item in the right hand, a second in the left, and three or more become an armful piled in front of you that slows you down and keeps your fists busy. The multitool shows its battery on an LED bar. Quick-time events (a monster grabbing you, pinning one down) appear as big keycaps under the crosshair. Tasks, credits and messages live on the wristwatch. When something happens (HQ radio, a pickup, a warning, the exit countdown) the watch beeps and your clone glances at it. Raising the watch zooms in on its face.

## The game loop

1. **HQ lobby (Sublevel B4)**
   * Reception with a receptionist who turns to watch you when nobody is looking, and GREET-O-TRON 9000, a beige CRT-headed service robot that tracks you, stamps forms and greets you by name ([E]). Its grin gets too wide when nobody is looking.
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
2. **Level 0 (`src/game/campmission.js`)** introduces one system at a time. The HQ receptionist announces each stage on the wristwatch and Healthity explains it:
   1. **Build your camp.** A **TENT KIT** crate waits at the camp clearing. Open it ([E]) and five parts spill out: two tent poles, the canvas, the stakes and a camp lamp. Drag each part onto its glowing ghost marker and attach it with the **built-in multitool** (empty hand + RMB). When the last part clicks in, the tent pops up and the lamp lights the camp.
   2. **Stay fed.** The stomach growls: from now on **hunger and thirst** drain (bars top left). Eat or drink something.
   3. **Make quota.** Furniture is money. Drag it into the **teleport pad hall**, put it on the pads and pull the lever: the pads charge up, the items beam away and their value uploads to your watch as team money (couch $210, desk $160, office chair $70, clutter a few dollars). Money can't buy anything.
   4. **Get out.** The quota is the main mission ($1500 solo, +$900 per extra clone). When it is met, an exit room opens in a corner of the camp for 180 seconds. Get inside: the shift is complete and the team returns to HQ.
   * The 7-day clock still runs: when Day 7 ends, the dimension collapses and the run is lost.
3. **Death (Level 0)**: dead clones spectate for a few seconds, then a new clone is printed at the camp automatically. Each re-clone costs **half of the team's money**. Their body and dropped items stay where they died.
4. **Other dimensions** (Poolrooms, Grasslands) still run the older generator / field radio mission, with credits for research and a paid cloning pad. Supply-crate ordering is discontinued everywhere.
5. Only cosmetics and achievements persist between runs.

### The seven-day reality collapse

Each day lasts exactly **10 real minutes**, so you have at most 70 minutes per dimension. The current day (`DAY X/7`) is shown on your wristwatch and on the radio.

| Days | What happens |
|---|---|
| 1 | Probation day: guaranteed safe. No monsters, no hallucinations, injuries can't kill you. |
| 2 | Stable, but things start hunting. |
| 3–4 | More anomalies and monsters. Furniture starts moving when nobody is looking. |
| 5–6 | Lights die, furniture sinks into the carpet, and more creatures appear. |
| 7 | Reality starts to collapse: walls wobble, lights turn red, unseen corridors re-arrange themselves and monsters get aggressive. |

When Day 7 ends, the dimension is gone and so is anyone still inside it.

### Systems

* **Physics (Rapier)**
  * Almost everything can be grabbed, rotated, dragged, stacked, thrown and broken.
  * Each player's grab force is capped, so heavy furniture needs several clones working together.
  * The **built-in multitool** ([Q], hold LMB) charges up the longer you hold it (faster work, heavy furniture needs power, a full charge fires a damaging zap) and runs on a battery that Healthity or a battery item recharges. Attaching a **caster wheel** to a board or crate mounts it on a real spinning axle, so you can build carts. It **attaches** whatever you aim at to what it touches (a real fixed physics joint: barricades, furniture stacks), **detaches** it again, or (press R) **dismantles** furniture into crafting materials. The welding torch still welds too.
  * Looking at furniture with an empty hand shows its name and, once the pads are online, what the pads pay for it.
  * Craft barricade panels, spike traps, noise makers, splints, bandages and lamps at **workbenches**.
* **Survival** (`src/game/survival.js`): health, **sanity**, **hunger**, **thirst**, stamina and bleeding (light or heavy; it costs health until bandaged). Clones killed by a huge hit are torn apart into robot parts (limbs, plates, gears, wire) in a spray of plasma and oil.
  * Blood pressure, infection, fractures and sleep / microsleep are still in the code but switched off by one flag, `ADVANCED_SURVIVAL`.
  * `survival.needsActive`: hunger and thirst only drain while it is on (Level 0 switches it on once the camp is built).
* **Healthity**: an old floating medical unit you repair on Level 0. It warns you about your condition, prints mission receipts, charges your multitool and gives terrible corporate wellness advice. You can pat it.
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
* **Arrival complex** (the same for every seed): the personnel lift stands in an alcove on the north side of a 15 × 15 m **camp clearing** under warm light. A 6 m wide passage leads east to the 18 × 24 m, 6.6 m tall **teleport pad hall**, which has wide exits to the maze on three sides. Blue TELEPORT PADS plates with arrows hang on maze walls up to ~100 m out.
* Sectors:
  * classic yellow halls, cubicle offices, concrete maintenance areas, flooded sectors with reflective water, pillar halls, dark zones and manila rooms;
  * **atriums**: vast open halls with 6 m ceilings, giant pillars and hanging lights;
  * **corridor sectors**: long parallel corridors with rhythmic lighting;
  * **low rooms**: 1.85 m ceilings, with crawlspaces you have to crouch through;
  * **warehouses**: 7 m ceilings and aisles of pallet racking stacked with boxes and crates;
  * **lounges**: sofas, armchairs, TVs and lamps.
* Furniture is the loot. Rooms are furnished with sets that make sense together: lounge sets, desk pods, break nooks, bedroom sets, vending machines, lockers, fridges, shelves, arcade cabinets and pianos. Anything can be hauled to the pads and sold.
* Drawers, cabinets, lockers, fridges, boxes, crates, suitcases, toolboxes, trash cans and vending machines can be **searched** once ([E]) for food, drink and materials.
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
  * a glimpse of the Poolrooms;
  * break rooms, living rooms, libraries, server rooms and locker rooms.
* Rare weird rooms:
  * a **slide pit**: a playground chute and a spiral flume you really slide down into a 2.6 m deep ball pit;
  * a play tower over a ball pit;
  * a sunken carpet conversation pit;
  * towers of stacked chairs rising into the dark;
  * a room with all its furniture on the ceiling;
  * giant furniture;
  * a corridor of identical doors;
  * an office party frozen mid-celebration;
  * a room tilted 9°.
* Unsettling details: doors that open onto a wall, chairs set out facing whoever walks in, an armchair staring into a corner, a room that mirrors itself.
* Unsettling events (every minute or two):
  * a desk phone rings in an empty office and stops when you get close;
  * the lights go out one by one behind you;
  * a figure stands at the end of a long corridor and is gone when you approach or look away;
  * chairs behind you turn to face you.
* Rare jumpscares (at most one every 3–5 minutes, never before the camp is built on Day 1, never in the camp or pad hall, never harmful):
  * something sprints across the corridor ahead;
  * a face appears in a wall vent;
  * every light around trips at once with a shriek in the dark;
  * a pale faceless clone stands right behind you when you turn around.
  `?scares=0` turns them off.
* Wet areas are organic: puddles collect under water-logged ceiling tiles, in low spots and along damp walls. They have soaked halos, tide rings and drips rippling the standing water. Flooded sectors have curved shorelines.
* Lighting is "dynamic baked" fluorescent light. Every vertex stores its strongest lights, so individual tubes can flicker, die or turn red while the whole level renders with a few materials. Moving objects get per-object light probes.
* Performance: props are culled by size and by walls (a 2D line of sight over the cell grid). Untouched furniture in chunks far from every player is put away and comes back exactly as it was.

### Level 37: the Poolrooms

* An endless forward-only waterway of giant tiled halls (48 × 24 m, 7.6 m ceilings) with a deep, dark canal down the middle. Sluice walls seal each hall, so the team has to **punt a raft** onward (hold [E] on the raft; more punters go faster). Everyone and everything on the deck rides along.
* Decor: pendant lamps, skylights, spiral slides, lifeguard chairs, loungers, shower banks, mushroom fountains, hot tubs, palms, ferns, ivy, algae mats, lily pads and floaties. Each hall has a mood: bright, overgrown, dark and flooded, or bath hall.
* The water is murky green-black and you can't see the bottom. Swimming drains stamina, you can drown, and some stretches are **contaminated**: wading in or drinking them causes infection. The **water tester** in the starter kit reads SAFE, TRACE or CONTAMINATED.
* From Day 2, a **giant mutated goldfish** with a cluster of eyes and human arms stalks the canal, lunges at swimmers and rams the raft. **Mutant leeches** latch onto clones in the water; pull them off and eat them if you're desperate.

## Tech notes

* **Engine**: Three.js r186 (WebGL2), Rapier 3D (WASM), PeerJS (WebRTC), Vite.
* **Rendering**:
  * PBR materials on procedural canvas textures (albedo, normal and roughness).
  * Planar water reflections and a real mirror.
  * Post-processing: bloom, GTAO on High, FXAA, and an old-footage pass: lens barrel, film-gate weave, VHS line jitter, chroma bleed and a rolling tracking band, halation around lights, dust and scratches, a faded warm grade, grain, vignette, damage and sanity warping, and collapse glitching.
  * **Liquefaction**: the walls breathe. Wallpaper flows and drips, glossy ripples run across every surface and the picture itself warps. It grows with day instability and lost sanity, and every minute or so an episode turns the walls fully liquid for a few seconds (`?liquid=0..1` pins the level for testing).
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
