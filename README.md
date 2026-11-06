# R.O.O.M.

**Research Office for Otherworldly Matters** is a 1–4 player co-op survival-horror game set in the Backrooms. It runs in the browser and is inspired by R.E.P.O., Lethal Company and PEAK.

You are a cheap, uncanny robot clone, and you have just woken up on the carpet of the Backrooms. Nobody is coming. There is no job and nothing to deliver: the only goals are to stay alive and, one day, to find a way out, on a 7-day clock before reality collapses. Take furniture apart for materials, make tools in your hands and then at workbenches you build, claim a shelter and build it up, find food and water, and get the old field radio talking.

Almost everything is procedural: geometry, textures, animation, sound and music are generated at runtime. The only bundled assets are open-licensed fonts.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (deployable to any static host)
```

* **Main menu**: a dark clone factory. Your robot clone hangs on the assembly line under a caged work lamp, and the menu is a set of old rusted signs: **NEW MISSION**, **CONTINUE** (when a run is saved), **COMMENDATIONS** (achievements and the cosmetics they unlock) and a seized cog for **SETTINGS**. Click the robot to strip it down and swap parts in the workshop. New Mission drops you through a floor hatch into the HQ lobby.
* **Host / join**: in the lobby, the elevator's call panel hosts a shift (its code shows on the floor display) or joins one with a friend's code; friends drop in from the ceiling. Up to 4 clones.
  * Multiplayer is peer-to-peer WebRTC (PeerJS) and needs internet access to the public PeerJS signalling server. The published artifact build is solo only.
* **Proximity voice chat**: positional 3D audio, muffled through walls. Monsters can hear you talk.
  * Choose open mic, push-to-talk (**V**) or off in Settings.
  * The living can't hear the dead, but the dead hear everyone.

A GitHub Pages workflow (`.github/workflows/deploy.yml`) builds and deploys on every push to `main`. To use it, enable **Pages → Source: GitHub Actions** in the repository settings.

### Controls

| Action | Keys |
|---|---|
| Move / sprint / crouch / jump | WASD / Shift / Ctrl or C / Space |
| Interact, talk, pick up | tap **RMB** (or **E**) |
| Grab and drag with your arms (props, furniture, teammates) | hold **RMB**: the longer you hold, the harder you pull. While holding: **Shift** = throw, **wheel** = distance, **R + mouse** = rotate |
| Punch | **LMB** (hold to wind up). Hard hits knock teammates into a ragdoll for a moment |
| Use the item in your hand (eat, drink, heal, swing, light) | **LMB** |
| Break furniture down | **LMB** on it: punches with bare hands, swings with a tool (faster, and more comes off) |
| Put what you hold together (craft in the hands) | **R** while holding the parts (right hand, left hand or an armful) |
| Built-in multitool (attach, detach, dismantle) | **Q** draws it, hold **LMB** to charge, **R** switches mode. Holding something with it drawn, **LMB** fixes it where it is held |
| Swap hands / pick the right-hand item | **1–5** / wheel |
| Drop an item (hold: drop everything) | **G** |
| Flashlight | **F** |
| Wristwatch (status, map, recipes, notes) | **Tab**. Switch apps with **Q/E** |
| Backpack: stow the right-hand item / take the last thing out | **X** (once you wear one) |
| Emotes | **H** wave, **J** dance, **B** point |
| Third-person view | **T** |
| Pause | **Esc** |

Pointing at most things shows a small floating label with their name; click for a line about them (try the fish tank).

#### Phones and tablets

Touch devices get on-screen controls styled like the knobs of a 1990s field terminal (force them with `?touch=1`, hide them with `?touch=0`):

* **Left thumb**: a floating analog stick. Push it to the rim to sprint.
* **Right thumb**: drag to look, tap to interact with whatever is under the dot.
* **Buttons**: JUMP, USE (shows what it will do), GRAB (tap = use, hold = grab and pull; ROT appears while carrying), PUNCH (punch / use the right-hand item / the multitool; THROW while carrying), TOOL (multitool), DUCK, plus WATCH, LIGHT, NEXT (swap hands), DROP, VIEW and MENU along the top. ◀ ▶ switch watch tabs. Quick-time events turn the whole screen into a tap / hold area.
* Phones start on the LOW graphics preset unless you pick one in Settings.

#### Text and fonts

There are no text boxes. Speech, hints and labels float in the 3D world as plain lettering in one ink colour with a soft shadow, and they type themselves out. Every kind of text has its own font slot in `src/ui/fonts.js` (speech, speaker names, hints, hover labels, menu signs, title, handwritten notes, receipts, terminals, watch, wall writing, posters). Change a slot's family there, add its `@fontsource` import, and every caller follows.

#### Guidance

Nothing tells you what to do. A **field notebook** lies by your hand when you wake up (pick it up, **LMB** to read it): whoever had it before wrote down what they worked out. Scribbled notes left by earlier clones turn up in old camps and empty rooms. Now and then a line goes through your clone's head when something first matters (hunger, the cold, the first night). The radio, once it works, has voices on it.

#### (Almost) no HUD

The only HUD is two little machines at the top of the view, drawn in 3D:

* a **mechanical heart** (health): brass valves, a pressure gauge and a glass chamber of sloshing green plasma that beats with your pulse. Damage cracks the glass, the cracks leak plasma while you bleed and the pressure needle sags. A **bandage**, **medkit** or **plasma syringe** plays a first-person patch-up: your clone pulls the heart out of its chest, tapes the cracks and/or injects plasma, and pushes it back in. Food and drink heal a little too.
* a **mechanical brain** called **SANITY**: glass hemispheres of glowing filaments and gears in a steel cage. It drains in the dark, alone and near monsters, and recovers with teammates and light. Low sanity turns it violet, then red, and you start hallucinating; at zero for a few seconds, your clone dies of insanity.

What you carry sits in your hands: one item in the right hand, a second in the left, and three or more become an armful piled in front of you that slows you down and keeps your fists busy. The multitool shows its battery on an LED bar. Quick-time events (a monster grabbing you, pinning one down) appear as big keycaps under the crosshair. Vitals, the map, your recipes and the notes you found live on the wristwatch. When something happens (a pickup, a warning, an achievement) the watch beeps and your clone glances at it. Raising the watch zooms in on its face.

## The game loop

1. **Factory menu** → **NEW MISSION**: the hatch opens and your clone falls into the lobby.
2. **HQ lobby**: a small, dim reception with tables, four chairs, a fish tank and a service bell. **Gloria**, the humanoid robot receptionist, sits at the desk. Nothing starts until you talk to her. She checks you in and opens the elevator; step in and press **START** (or **EXIT**, which drops the car into the robot furnace pit).
3. **The ride**: a violent elevator trip through other dimensions and doorways that ends in a free fall in the dark.
4. **Waking up** (`src/game/arrival.js`): black, a breath, and the eyes blink slowly open on the ceiling lights. The clone, lying on the carpet of a clearing, sits up and gets to its feet (the camera rides its head, servos whirring), and then it is yours. A field notebook lies by its hand; a broken field radio sits in a corner of the clearing. The big concrete hall next door has furniture heaped against its walls.
5. **Surviving** (`src/game/survivalmission.js`), in whatever order you like:
   * **Gather** (`src/game/gather.js`): hit furniture and junk and it comes apart into materials: planks, sticks, scrap metal, screws, cloth, foam, wire, glass shards, concrete chunks, batteries, gears, pipe. Bare hands are slow and only get the soft parts and splinters (a plank comes off as a stick; metal will not give). Tools are faster and get more off: a rock hammer smashes glass and electronics, a **pry bar** gets metal panels and screws off, a **saw** or **hatchet** cuts whole planks, a knife cuts cloth and wire clean. The **multitool** (dismantle mode) takes anything apart completely but eats battery. Drawers and lockers that were never searched spill their contents when they come apart.
   * **Craft** (`src/game/crafting.js`): hold the parts in your hands and press **R**: they come together, twist and snap into the new thing. Then build a **workbench** and lay parts on its top: when they make something, its ghost turns above the bench; **E** and the parts lift, spin together and slam into it. A **bench vise** made at the bench takes it to the next tier, a **soldering kit** to the last. The **RECIPES** watch app and the notebook list what you know.
   * **Shelter** (`src/game/shelter.js`): lie down in a bed and it becomes yours (you wake up there after dying); the first bedroll, camp cot or old sleeping bag the team sleeps in makes the place it stands the team's shelter (a mattress or a couch is a bed too, but not a home). Build it up: a plank door hung in a doorway with the multitool (it swings on a real hinge; **E** opens and closes it), barricade panels fixed in place, a storage crate (**E** puts in what you hold, takes things out), a stove, a standing lamp or a lantern, insulation pads, spike traps. The shelter is rated 0–4 by what it has: inside it is warmer, and the better it is shut up, the fewer things come for it at night.
   * **Food and water**: break rooms, kitchens, fridges, vending machines, lockers and old camps hold food. Water coolers fill a bottle with clean water; a puddle fills it with dirty water that makes you sick: boil it in the stove pan or run it through a water filter. Raw meat and fungus cook in the pan (**E** flips it before it burns).
   * **Cold and the night**: from 22:00 on the watch clock it is night. Warmth drains faster then (and later in the week); fires, the stove, a lit torch or lantern, padded armour, the shelter and sleeping keep it up. Things come for the shelter at night from Day 2. When everyone alive is asleep in a bed at night, the night goes by fast until the lights come back up.
   * **The radio** (`src/game/radio.js`): repair it at a workbench and fit it with the parts you make (battery, antenna, tuning coil, amplifier) to reach farther: other survivors, and maybe the way out.
6. **Death**: a dead clone drops everything it carried and wore where it fell, and after a few seconds wakes up again beside its bed (or where it first woke up, if it has none). The day clock keeps running.
7. Achievements (survival milestones: the first tool, a workbench, a shelter, the first cooked meal, the first night, radio contact, getting out) and the cosmetics they unlock persist between runs; an unfinished run can be continued from the menu.

### Progression

| Tier | Where | What it makes |
|---|---|---|
| 0 | in the hands (**R**) | rag bandage, torch, sharpened stick, rock hammer, bedroll, the workbench; filtering water, loading the crossbow |
| 1 | workbench | pry bar, scrap saw, shiv knife, spear, nail bat, barricade panel, plank door, storage crate, spike trap, splint, battery, wheel trolley, the radio repair, radio antenna, radio battery, **bench vise** |
| 2 | + vise | hatchet, padded armour, scrap helmet, backpack (+3 slots), lantern, standing lamp, water filter, camp stove, camp cot, insulation pad, noise maker, tuning coil, **soldering kit** |
| 3 | + soldering kit | crossbow and bolts, signal amplifier, distorter |

`game.survival.progress` (`src/game/progress.js`) tracks the team's tool tier (0 bare hands … 4 crossbow), shelter tier (0–4) and bench tier (0–3).

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
  * The **built-in multitool** ([Q], hold LMB) charges up the longer you hold it (faster work, heavy furniture needs power, a full charge fires a damaging zap) and runs on a battery that a battery item recharges (found in drawers and old camps, or made at a workbench). Attaching a **caster wheel** to a board or crate mounts it on a real spinning axle, so you can build carts. It **attaches** whatever you aim at to what it touches (a real fixed physics joint: barricades, furniture stacks), **detaches** it again, or (press R) **dismantles** furniture into crafting materials. The welding torch still welds too.
  * Looking at furniture with an empty hand shows its name and that it can be broken down.
  * A **plank door** attached to the world with the multitool hangs on a real hinge.
* **Survival** (`src/game/survival.js`): health, **sanity**, **hunger**, **thirst**, **warmth**, stamina and bleeding (light or heavy; it costs health until bandaged). Worn armour cuts the damage taken. Clones killed by a huge hit are torn apart into robot parts (limbs, plates, gears, wire) in a spray of plasma and oil.
  * Blood pressure, infection, fractures and sleep / microsleep are still in the code but switched off by one flag, `ADVANCED_SURVIVAL`.
  * `survival.needsActive`: hunger and thirst only drain while it is on (on in every level).
* **Wristwatch**: STATUS (vitals with a live EKG and what is wrong: cold, hungry, bleeding), MAP (explored rooms, your shelter, your bed, benches, the radio, water and food you found), RECIPES (what you can make at each tier) and NOTES (what you have read).
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
* **Arrival complex** (the same for every seed): a dark empty alcove on the north side of a 15 × 15 m **clearing** under warm light, where the clones wake up. A 6 m wide passage leads east to the 18 × 24 m, 6.6 m tall concrete **storage hall** (furniture heaped against its walls), which has wide exits to the maze on three sides.
* Sectors:
  * classic yellow halls, cubicle offices, concrete maintenance areas, flooded sectors with reflective water, pillar halls, dark zones and manila rooms;
  * **atriums**: vast open halls with 6 m ceilings, giant pillars and hanging lights;
  * **corridor sectors**: long parallel corridors with rhythmic lighting;
  * **low rooms**: 1.85 m ceilings, with crawlspaces you have to crouch through;
  * **warehouses**: 7 m ceilings and aisles of pallet racking stacked with boxes and crates;
  * **lounges**: sofas, armchairs, TVs and lamps.
* Furniture is the loot. Rooms are furnished with sets that make sense together: lounge sets, desk pods, break nooks, bedroom sets, vending machines, lockers, fridges, shelves, arcade cabinets and pianos. Anything can be dragged home, stacked, barricaded with or taken apart.
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
* Rare jumpscares (at most one every 3–5 minutes, never on Day 1 before a shelter exists, never in the clearing or the storage hall, never harmful):
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
  | `src/ui` | Floating text, font slots, menus, terminals, wristwatch, touch controls |
* **Adding dimensions**:
  * New levels plug into `src/world/levels/registry.js`.
  * Poolrooms, Grasslands and Endless Hotel are already registered as upcoming levels.
  * Until a level is implemented, evacuation leads to a deeper, harder sector of the Yellow Rooms.
* **Test and debug URL parameters**:
  * `?auto=solo` skips the menu.
  * `?auto=solo&level=yellow` dispatches straight into Level 0.
  * `?daylen=60` makes each day last 60 seconds.
  * `?q=low|medium|high` sets graphics quality.
