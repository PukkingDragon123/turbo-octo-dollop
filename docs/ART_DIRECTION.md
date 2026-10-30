# R.O.O.M. art direction and game pillars

One page every change to the game is checked against. If something here conflicts with old code, this page wins.

Mood references (not shipped, look only): a hazy, warm, miniature-diorama world with soft silhouettes in
golden fog (Little Nightmares II), and soft, saturated, sunlit stylised 3D with chunky readable shapes
(Grounded). Reference frames: `/tmp/claude-0/-home-user-turbo-octo-dollop/00ed0cd1-3018-5fe0-b035-f0749e4fb7f4/images/1.jpg`
and `.../images/2.jpg`.

## The look: beautiful, cartoony semi-realistic, hand-painted

The setting stays the Backrooms: endless yellow rooms, carpet, fluorescent panels, the poolrooms and the
grasslands. Only the treatment changes.

* **Feeling**: a lost, lonely, slightly whimsical miniature world. Warm and hazy, never grimy-photoreal.
  Like a hand-built set photographed through soft golden haze.
* **Shapes**: chunky and readable, slightly exaggerated (a bit too thick, a bit too round), soft bevels on
  every edge, nothing razor sharp. Hand-made irregularity: walls a touch out of true, props slightly tilted,
  lines that wobble. Silhouettes must read at a glance.
* **Palette** (Level 0): mustard and ochre walls `#c9a74e`→`#a8843a`, cream ceiling `#e9dcb6`, warm sepia
  carpet `#7a5a36`. Shadows are desaturated cool olive and teal (`#3e4a3f`), never pure black. Highlights warm
  honey `#ffd98a`. Accents: rust orange, faded teal, dusty rose, sage. No neon except a deliberate signal.
* **Textures**: hand-painted. Broad soft brush strokes, large slow value shifts, painted (not noisy) edge
  wear: lighter on edges, darker in crevices. Patterns (wallpaper stripes, carpet motifs) painted with
  uneven line weight. Dirt and damp as soft painted stains. Very little high-frequency noise. Consistent
  texel density.
* **Materials**: mostly high roughness (0.7 to 0.95). Metal is painted metal with chipped edges unless it is
  bare on purpose. No glossy plastic. A soft rim / sheen is welcome on characters and cloth.
* **Lighting**: natural and motivated. Fluorescent panels are soft warm-white sources; warm bounce from the
  carpet; cool ambient fill in the shadows; soft shadows; deep ambient occlusion in corners. Depth haze:
  warm where lit, cooler and bluer with distance. Dark zones are truly dark, lit by your torch with a warm
  falloff.
* **Post**: a soft painterly filter (edge-preserving smoothing with a small radius plus a faint canvas/paper
  grain), gentle bloom on light sources, a warm split-tone grade, a soft vignette, depth-based atmospheric
  haze and a subtle miniature depth-of-field far away. **Not allowed**: VHS, film scratches, chromatic
  aberration, glitch, barrel distortion, liquefying walls, scanlines.
* **Characters**: the clones are robots (the setting stays), stylised: readable shapes, slightly large hands
  and head, soft painted materials. **Animation is expressive**: anticipation and overshoot, light squash
  and stretch, idle breathing and fidgets, reactions (shiver when cold, hold the stomach when hungry, flinch,
  sigh). Nothing pops in or out: everything eases.
* **Interaction**: tactile and physical. Props wobble and settle when touched; switches click; dials turn.
* **Text and UI**: Jolly Lodger for all text (`src/ui/fonts.js`). Diegetic first: watch, radio, notes,
  objects. Any screen-space UI is minimal: warm ivory ink `#f3e6c8` with one soft dark shadow, thin
  hand-drawn lines, no boxes, no glass panels, no neon, no glow.
* **Sound**: soft, warm, close foley; the fluorescent hum; nothing harsh or clipped.

Never generic, never random: every asset has a reason to be where it is and the same hand made all of it.

## Game pillars: survive, then escape

* There is no company and no job. No quotas, no crusher, no shop, no receipts, no quest board, no
  Healthity. Your clone woke up in the Backrooms; the only goals are to stay alive and to find a way out.
* **Survival**: hunger, thirst, health, sanity, cold and fatigue (keep the current survival model). Find food
  and water, cook, rest.
* **Gathering and crafting**: break down furniture and junk for resources (wood, scrap metal, cloth, wire,
  screws, glass, foam, tape...). Craft at your hands, then at benches you build. Progress the way Minecraft
  does: bare hands → crude tools (sharpened stick, rock hammer, rag bandage) → scrap tools (pry bar, saw,
  knife, spear) → better tools and gear (hatchet, padded armour, lantern, backpack). Better tools gather
  faster and unlock better recipes.
* **Shelter**: start with a sleeping spot, then build up: barricades, a door, a bed, storage, a stove, light,
  traps. Shelters keep you warm and safe at night/collapse.
* **The radio**: a physical, interactive radio (tune the dial, flick switches, hold the talk button). Through
  it you reach other survivors, piece together where the exit might be, and upgrade the radio with parts
  you craft to reach farther. Escaping is the end goal.
* No unnecessary missions. Light guidance only (a note, a radio voice), never a checklist.
