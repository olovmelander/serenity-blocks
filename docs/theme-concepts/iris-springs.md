# Iris Springs: theme concept build document

| Field | Value |
|---|---|
| Name | **Iris Springs** (the name itself is a Stage 0 decision for the user; see §3.14) |
| Proposed id | `iris-springs` (registry group `biomes`) |
| Logline | A bright, steaming basin of living colour seen from an overlook at late morning. The board's heat paints the springs, terraces fill and turn to stone, and your combos wind a geyser up until it erupts. |
| Status | **Concept: not built.** Nothing under `src/` implements it. |
| Source | Design competition held on 2026-10-11 to replace the theme `cosmic-chimes`. Six concepts, three judges, 0–10 per lens. The winner, Rainbark, is being built on branch `ccr-b2364ce7-64kjge` (commits `0c747dd` and `585ab55` so far). Iris Springs began as the seed "Prismatic Springs": candidate #1 of the pre-competition research (`docs/theme-concepts/reference/research.md`, "Top 5, ranked"), with candidate #2 (travertine terraces) merged in as the foreground and the mineral accent pools as jewel details. |
| Scores | Art director **7.5** (3rd of 6) · Rendering lead **6.5** (3rd of 6) · Gameplay feel **8.6** (1st of 6) · **Total 22.6 / 30: 2nd of 6** |
| Date | 2026-10-11 |

**The six concepts and their totals**

| Rank | Concept | Art | Tech | Play | Total /30 | Build document |
|---|---|---|---|---|---|---|
| 1 | Rainbark (being built) | 8.0 | 8.5 | 8.4 | **24.9** | `docs/theme-concepts/rainbark.md` |
| **2** | **Iris Springs** | **7.5** | **6.5** | **8.6** | **22.6** | this file |
| 3 | Painted Ages | 7.0 | 8.0 | 7.5 | 22.5 | `docs/theme-concepts/painted-ages.md` |
| 4 | Riverbloom | 6.0 | 6.0 | 8.0 | 20.0 | `docs/theme-concepts/riverbloom.md` |
| 5 | Haft Rang | 8.5 | 4.5 | 6.9 | 19.9 | `docs/theme-concepts/haft-rang.md` |
| 6 | Sunfall | 6.5 | 5.5 | 7.2 | 19.2 | `docs/theme-concepts/sunfall.md` |

> **How to use this file**
>
> 1. Start a **new Claude Code session** on this repository. Give it the ready-to-paste prompt in
>    `docs/theme-concepts/PLAYBOOK.md` §8 (or the shorter one in `docs/theme-concepts/README.md`),
>    filled in with this file's path (`docs/theme-concepts/iris-springs.md`).
> 2. Before anything else, read `docs/theme-concepts/PLAYBOOK.md`. It holds the steps every concept
>    shares: **"Choosing a slot"** (which existing theme this one replaces, or whether it is added as a
>    new one), the rename and removal checklist, the CI gates, and the headless capture tooling that
>    works in cloud containers.
> 3. Reference snapshots of the existing fleet, for side-by-side similarity checks, are in
>    `docs/theme-concepts/reference/` (catalogue with each theme's "motifs to avoid") and
>    `docs/theme-screenshots/<id>.png`. For this concept compare against **halcyon-apex, geode,
>    cinder-drift, pyrestorm, luminous-tides, parhelion** (the closest), then shifting-sands,
>    verdant-hills, ocean, koi-pond, singing-bowl, chromadelic-highway, tornado, lunara,
>    vesper-chrysalis, winter, ice-temple, and **rainbark** (§4). Parhelion and Rainbark have no
>    fleet screenshot; capture their playground effects (`effect=parhelion`, `effect=rainbark`).
> 4. Read `docs/theme-concepts/rainbark.md` for the lesson that applies here: **prototype the hero
>    material on the CPU (numpy/PIL) and compare it with reference photos before writing any shader.**
> 5. **Precedence inside this file.** §1 is the concept exactly as proposed. §2 is what the judges
>    said. **§3 amends §1, and where they disagree §3 wins.** §5 (the implementation plan) already
>    includes every §3 change. §4 lists what must not duplicate Rainbark.
> 6. Repo rules that apply throughout (`CLAUDE.md`): iterate in the playground first, **one small
>    effect per session**, and never call a WebGPU/TSL change done without a screenshot and a clean
>    console (ADR-0007, `docs/adr/0007-webgpu-tsl-definition-of-done.md`). Generated SFX are
>    unavailable: if a step seems to need them, stop and ask the user.
> 7. Words: never put the trademarked name of the falling-block game, or its word for a piece, in code,
>    strings, CSS or HTML (`npm run check:ip-strings`). Say "falling-block", "pieces", "four lines".

**Contents**

- §0 Glossary of named things
- §1 The concept in full (as proposed)
- §2 What the judges said
- §3 Required changes before building
- §4 Overlap with Rainbark
- §5 Implementation plan
- §6 Reference imagery to look for

---

## 0. Glossary of named things

| Name | What it is |
|---|---|
| **Iris Basin** | The fictional hydrothermal basin the whole world is set in. Not a named real park. |
| **the Iris** | The great hot spring: a cobalt eye ringed by bands of living colour. The hero, left of the card. |
| **the eye** | The Iris's deep cobalt centre. |
| **the fingers** | Braided runoff channels that fan outward from the Iris's outer bands like the rays of a printed sun. |
| **the apron** | The pale sinter flats round the Iris and across the basin. |
| **the Chalice** | The working geyser: a white sinter cone on a cream mound, right of the card. |
| **the Stair** | The travertine terraces that step down from the Chalice toward the camera into the bottom-right corner. |
| **the Sleeper** | A dormant giant geyser on the far rim. It erupts only on a perfect clear. |
| **the Consort** | (Added in §3.5.) A companion vent that wakes while a back-to-back chain is live. |
| **jewel pools** | Small accent pools on the far apron: lime acid, champagne (orange rim, fizzing) and milky opal. |
| **ghost pines** | Dead lodgepole pines, silver-grey, with white silica "socks" where they stand in runoff. |
| **spouters, fumaroles** | Small ambient vents: spouters throw water 1–2 m; fumaroles chuff white steam. |
| **bloom** | The streamers of pigment that grow where a lock's water runs. |
| **fossil** | A bloom (or, after §3.8, a cleared row's colours) fixed into the stone by a clear. |
| **preplay** | The real small splashes a geyser makes before a major eruption. |
| **steam phase** | The long white exhalation of steam after a geyser's water phase. |

---

## 1. The concept in full (as proposed)

Everything in this section is the proposal as the judges scored it, with every number kept. Where §3
changes something, a marker **[amended: §3.x]** points to the change. The proposal assumed it would
take Cosmic Chimes' slot; slot-specific parts are written here for "the theme this one replaces"
(see PLAYBOOK.md "Choosing a slot").

### 1.1 Name, id, logline

- **Display name: Iris Springs.** Iris was the Greek goddess of the rainbow, and an iris is also the
  coloured ring of an eye. Both meanings fit: the hero is a giant spring whose eye is a cobalt pupil
  ringed with colour, and the big payoffs were real rainbows standing in geyser spray. No current
  theme uses this name. Fallback names: "Prismatic Springs", "Thermal Bloom". **[amended: §3.14]**
- **id:** `iris-springs`. Registry group: `biomes`. (The proposal noted this leaves the `cosmic` group
  that cosmic-chimes was in; for a different slot, choose the group per PLAYBOOK.md.)
- **Logline (as proposed):** "A bright, steaming basin of living colour seen from an overlook at late
  morning. The board's heat paints the springs, terraces fill and turn to stone, and your combos wind
  a geyser up until it erupts into rainbows." **[amended: §3.4, the bow appears once]**

The world is a fictional basin, the **Iris Basin**, not a named real park. It fuses facts from real
places:
- **Grand Prismatic Spring** supplies the rings, the steam that takes their colour, and the summer
  and winter mat colours.
- **Mammoth Hot Springs'** terraces supply the rims, which grow where water spills.
- **Castle Geyser** and **Old Faithful** supply the eruption cycle: preplay, then a water phase, then
  a steam phase.
- The **Lower Geyser Basin** supplies the "bobby-sox" ghost pines.
- **Champagne Pool** and **Spotted Lake** supply jewel-coloured accent pools.

Named places in the world: **the Iris** (the great spring), **the Chalice** (the working geyser),
**the Stair** (the terraces that step down from the Chalice), **the Sleeper** (a dormant giant geyser,
seen erupting only on a perfect clear).

### 1.2 The picture

#### Painter's description (16:9 desktop)

We stand on a pale sinter lip about **44 m** above a vast hydrothermal basin and look down at it at
an angle. The camera **pitches down 18°** with a **46° vertical field of view**, so the horizon sits
about **12% from the top**. The colourful ground fills almost the whole frame. The sky is a high,
clean band of cerulean, and steam towers punch up into it.

**Left of the card: the Iris.** A spring about **110 m** across (enlarged about **1.3×** for drama)
lies as a wide ellipse. Its eye sits at screen position **(0.16, 0.39)**, and the pool spans
**x 0.0 to 0.33, y 0.33 to 0.49**.
- The centre is an abyssal cobalt that deepens to near-ink where the bowl drops away. You can see
  down the white sinter ledges of the throat through the clear water, wavering under convection.
- Next comes a turquoise shelf over pale sinter, then a thin wet cream rim of bare silica.
- Then the living bands: lemon-chartreuse *Synechococcus*, blazing *Phormidium* orange, and
  *Calothrix* rust-brown.
- At the outer edge the mats break into radiating **fingers**: braided runoff channels that fan
  outward like the rays of a sun printed on the ground. The near fingers run down to the bottom-left
  corner of the frame and slide under the card toward the right.
- The fingers are wet and glossy, and their sheen flows outward.

A translucent dome of steam rises off the Iris. It is lit from beneath by the spring, a real effect:
the steam is **turquoise-blue at its core and apricot at its skirts**. The sun lights its upper left
flanks pearl-white, and it leans right with the breeze.

**Right of the card: the Chalice and the Stair.** At middle distance, about **260 m** away and
**30° right**, a white sinter geyser cone stands on a cream mound at **(0.88, 0.33)**. Spiky sinter
spicules crust its splash zone, and it breathes a constant thread of steam. From the cone, **the
Stair** descends toward the camera into the bottom-right corner:
- **8 to 10** scalloped terraces of porcelain travertine, cream at the lips.
- Their risers are streaked apricot and chocolate where runoff flows, and hung with "frozen
  waterfall" dripstone curtains.
- Each terrace holds a pool of milky turquoise that glows from within, because colloidal silica
  scatters sunlight inside the water. **The pools are not mirrors.**
- The nearest rim crosses the bottom-right corner only **10 to 15 m** from the lens, so the scale
  range runs from fingertip-sized spicules to a **90 m** eruption.

**Behind the card and beyond.**
- **The far apron.** Pale sinter flats are dotted with small jewel pools: a lime-green acid pool, a
  champagne pool with an orange rim fizzing with bubbles, and a milky opal pool.
- **The ghost pines.** Stands of dead lodgepole pines rise silver-grey with white silica "socks"
  where they stand in shallow runoff.
- **The steam field.** **Five to nine** far steam columns of different sizes rise at different
  distances across the basin and lean with the wind.
- **The Sleeper.** On 21:9 the Sleeper's broad dormant mound shows on the far right horizon, with only
  a faint wisp of steam. It foreshadows the perfect clear. **[amended: §3.12, visible on every preset]**
- **The far rim.** A dark blue-green lodgepole rim runs along a low, flat rhyolite plateau, which fades
  to blue-white in the haze.

**Light (as proposed).** **[amended: §3.2, the sun moves to a three-quarter back-side position]** The
sun is high (about **42°**) and behind the camera's left shoulder (azimuth about **145°** from the
view direction). It is never in frame, so this is not a low sun on a horizon. Front-side light makes
the mineral colours as saturated as they can be: there is no glare and every band reads.
- Plumes are lit pearl-white on their left faces and shaded cool blue-grey on their right.
- Plume shadows lie across the basin, angled away from us, and slide across the colour bands as the
  wind moves.
- The sun sits behind us, so the antisolar point lies just below the bottom-right of the frame. The
  rainbow arc therefore crosses the right half of the picture, through the Chalice's column at about
  two-thirds of its height. Whenever there is spray in the right direction, a true rainbow appears
  exactly where physics puts it. (Checked while writing this file: with the camera above, the primary
  bow crosses the Chalice column 38–44 m above its base, at screen y 0.12–0.15.)

**Why it has depth.**
1. A ground plane recedes from 10 m to 15 km, so size gradients run from near spicules to
   microterraces to distant pools.
2. Aerial perspective washes the far rim blue-white.
3. Steam plumes overlap at a dozen depths, and each casts a moving shadow on the ground below it, so
   their distance is unambiguous.
4. The Iris shows real depth inside it: you look down through clear water to ledges.
5. The camera breathes slowly (**±0.3° over about 30 s**), which gives parallax between the terraces,
   the Iris rim, the pines and the rim forest.
6. Warm, saturated colour sits near and cool, pale colour sits far.

#### 21:9 desktop

The camera and vertical field of view stay the same, so the extra width becomes more world.
- The whole Iris sits left of the card, with the eye at about **(0.13, 0.39)**, and more fingers fan
  out to the left edge.
- On the right, the Chalice is at about **0.80**. The Stair broadens across the right foreground, and
  the Sleeper's mound appears on the far right horizon.
- The rainbow's right flank shows more of its arc.

#### Upright phone (aspect about 0.46)

The composer switches presets when **aspect < 0.62**, as the house does.
- **Camera:** it rises to about **60 m** and pitches down about **30°**, with a **62°** vertical field
  of view. The Iris is seen more face-on (ellipse aspect about **0.5**).
- **Below the card (bottom about 22%):** the Iris eye sits at about **(0.5, 0.87)**. Its colour bands
  fill the bottom band, and its fingers fan toward both bottom corners. This is where the eye reads
  best, as a big colourful iris under the board.
- **Above the card (top about 15%):** the far apron, the Chalice at about **(0.72, 0.10)**, ghost pines
  and a sliver of sky. The Chalice's eruption column and the Iris's steam rise through the top edge.
- **Beside the card (thin margins):** narrow slivers of terrace on both sides, so lock spills still
  have somewhere to land.
- **Sun (as proposed):** the composer raises it to about **50°** behind the camera, so the antisolar
  point sits below the bottom centre. The top of the rainbow then arcs across the top band, through
  the Chalice column above the card. **[amended: §3.2]**

#### Composition rules

- The sun direction is a **composition output**, not a world constant. Each layout pass, the composer
  solves the sun azimuth and elevation that put the primary bow across the Chalice column
  (`bowAnchor`). **[amended: §3.2, within fixed light ranges, eased]**
- If the HUD rect sits on the larger free side, the preset **mirrors**: the Iris goes right and the
  Chalice and Stair go left, so the eye is never under the HUD calm zone.
- Lock and clear aims use `boardFor(layout, player)` plus `boardPoint(...)`, then step outward past
  the HUD rect, as SKILL.md gotcha #144 requires ("lock effects behind the card are never seen").

### 1.3 Palette

#### Core colours (High Summer, the resting look)

| Name | Hex | Where |
|---|---|---|
| Iris Cobalt | `#0B3A8C` | the deep eye; Beer-law colour of 50 m of hot clear water |
| Vent Turquoise | `#14B3C8` | the shelf; terrace pool glow; underlit steam core |
| Sinter Cream | `#EDE6CF` | bare silica rim, travertine lips, the Chalice cone |
| Synechococcus Lemon | `#E9CF2C` | the first living band, where the water is just under about 73 °C |
| Phormidium Orange | `#EE7420` | the main mat band (about 45–60 °C); the radiating fingers |
| Calothrix Rust | `#9C3A1C` | the coolest mats and finger tips; streaks on the terrace risers |
| Chlorophyll Olive | `#5E7F2E` | cool fringes in summer; the dominant mat colour in winter |
| Steam Pearl | `#F3F1EC` lit, `#9DB1C6` shade | front-lit steam and its blue-grey shadow side |
| Basin Sky | zenith `#3F7FC8`, horizon haze `#DCE7EE` | high, clean, cold air |
| Lodgepole Rim | `#2F4A3E`, far plateau `#7E97A8` | the far band, through aerial perspective |

The ramp is a function of **temperature**, so the ground colours come from a real physical variable
rather than a painted gradient. Normalised temperature T:

| T | Colour |
|---|---|
| above about 0.92 | cobalt water |
| 0.85 to 0.92 | turquoise shelf |
| 0.78 to 0.85 | cream silica |
| 0.70 to 0.78 | lemon |
| 0.55 to 0.70 | orange |
| 0.40 to 0.55 | rust |
| 0.25 to 0.40 | olive |
| below 0.25 | dry, bleached sinter |

#### Variants: two world-native drivers, not an hour wheel

**A. The season (level-driven): the mats change pigment with light.** In real hot springs the mats are
orange and red in summer, where carotenoids act as sunscreen, and dark green in winter. A level-up
turns the basin's year one step. Every season keeps the cobalt, turquoise and cream core; only the
living bands, the air and the rim change.

| Step | Season | What changes |
|---|---|---|
| L1 | **High Summer** | Full carotenoid orange and rust; deep cerulean sky; thin, crisp steam; dark green rim. The most vivid state. |
| L2 | **Straw Gold** | Rim meadows turn straw-gold; mats deepen toward rust and carmine; high, pale haze; the sharpest bows. |
| L3 | **First Frost** | Cold air makes the steam stand in tall towers; hoarfrost feathers the ghost pines; aspens on the rim flame gold; the mats shift to amber-olive. |
| L4 | **Deep Cold** | Snow on everything except the warm ground: the colour bands sit in a white field, ringed by steam. The mats turn bottle-green with orange cores; pearl-blue sky; cooler light. |
| L5 | **Thaw** | Meltwater sheen everywhere; the mats are chartreuse and green with first orange; a clean washed blue sky. |
| L6 | **Bloom** | New growth: rose-pink streamers in the runoff (the proposal called them *Thermus*; see §3.13), chartreuse and orange together. The most varied palette, which then wraps back to High Summer at L7. |

The change is a **succession front**, not a cross-fade. A boundary sweeps outward from the Iris along
the fingers over about **6 s**. Behind it the mats take the new season's ramp row, as if a time-lapse
of mat succession were running. In modes with no LEVEL_UP (Infinity, local and online multiplayer),
the season advances once per **5 minutes** of active play.

**B. The basin's breath (clock-driven): air temperature and wind.** A closed-form sum of three
incommensurate slow sines (periods of about **71, 97 and 133 s**) stands in for the cold air settling
and the sun warming it.
- It scales steam density (**×0.7 to ×1.35**) and plume height, and swings the wind direction by
  **±20°**.
- Gusts every **20 to 40 s** tear a travelling hole through the Iris's steam dome, revealing the eye
  for about **6 s**. Real overlook visitors wait for exactly this moment.
- This is weather, not a palette, so it never reads as a wheel turning.

**Level-driven intensity.** Higher levels also raise the base heat a little: the cobalt eye is about
**3% wider per level**, up to a cap (§3.9 sets the cap at +15%). A late game therefore looks hotter as
well as later in the year.

### 1.4 Environmental animation (everything that moves)

| Element | Motion | Rate |
|---|---|---|
| Iris steam dome | Rises and billows (domain-warped fBm advected upward); leans with the wind; underlit colour shifts with heat | rise 1.2–2.0 m/s; billow warp period 9–14 s |
| Far steam columns (5–9) | Rise, lean and merge into a high haze | rise 1.5–2.5 m/s; lean follows the wind (1.5–4 m/s) |
| Ground mist | Low sheets 1–4 m deep creep over the warm apron; holes open where gusts pass | drift = wind × 0.6 |
| Gust tears | A travelling clear lane through the steam reveals the eye | every 20–40 s; crossing takes about 6 s |
| Steam shadows | Plume shadows slide across the colour bands | move with the wind |
| Convection in the Iris | Shimmering ripples refract the underwater ledges | big ripples 0.3 Hz, fine 1.5 Hz |
| Boil domes | A bulge of upwelling turquoise swells and relaxes in the eye | one every 4–9 s (hashed schedule) |
| Runoff sheen | Wet glints flow outward along the fingers (two-phase flow map) | 0.25 m/s; 3 s phase |
| Terrace overflow | Thin glossy water sheets slide over the Stair's lips; streaks scroll down the risers | 0.6 m/s |
| Bubble trains | Beads rise and pop in the pools; the champagne pool fizzes | 1–3 per pool per 5 s; the champagne pool fizzes constantly |
| The Chalice (idle) | Constant steam thread; a preplay splash cluster; a modest eruption on its own clock | preplay every 35–50 s; a 25 m, 10 s eruption every ~170 s, then a 20 s steam phase **[amended: §3.9]** |
| Spouters (3 small vents) | Small ambient spouts 1–2 m high | periods 7, 11, 13 s |
| Fumaroles (5–8) | Sharp white chuffs of steam | every 6–15 s each, hashed |
| Cirrus | High wisps drift slowly | about 0.002 rad/s |
| Ghost pines | Still, because they are dead; only the wet sheen at their socks moves | — |
| Heat shimmer (post) | Air wobbles over the Iris and the Chalice vent | 1.2 Hz; amplitude about 0.6 px at 1080p |
| Camera | Slow breathing drift; small pointer parallax (desktop only) | ±0.3° over about 30 s |

Everything is closed-form in time, with integrated phases wrapped, so `seek(t)` reproduces any frame.
All ambient schedules are hashed from the clock: the Chalice's cycle, boil domes, fumaroles and gusts.

### 1.5 Gameplay event language (as proposed)

**The grammar.** The board is a source of **heat and water** for the basin. Each event is a real
hydrothermal process, and the world answers *from inside itself*. Nothing flies out of the card, and
no light is "held then released". The world uses five physical verbs:

| Verb | Event | What happens in the world |
|---|---|---|
| **SPILL** | Lock | Water overflows, and living pigment blooms where it runs. |
| **SEAL** | Clear | Sinter precipitates a new rim and the pool behind it fills; the blooms are fixed into stone. |
| **PREPLAY** | Combo | The geyser's real pre-eruption splashes, one per link. |
| **ERUPT** | Four lines | The water phase, with a rainbow in the spray. |
| **STEAM PHASE** | Release | The long white exhalation after an eruption. |

The **colour decay is new for the fleet.** A bloom does not fade to dark. It **bleaches to white**,
exactly as real mats die to white sinter when their water stops. Only a clear rescues it, by fixing it
into stone.

**Aiming.** Rows map to screen height. Beside the card, every screen height is ground: the Iris complex
on the left, the Stair on the right. A row r on side s (the side nearer the piece's column centroid,
`u < 0.5` meaning left) therefore lands on ground at the matching height, just beyond the HUD rect. On
phones it lands in the margin slivers, or on the Iris's near rim below the card, with the column mapped
along the rim. **[amended: §3.7]**

| Event | What happens (timeline) | Why it reads at a glance |
|---|---|---|
| **Lock** | **The Spill.** At the piece's height on its side, the ground overflows. On the **left** a surge of hot water runs out of the Iris along the finger nearest that point. On the **right** the matching terrace of the Stair brims and a glossy sheet slides over its lip. Behind the moving wet front, the mat **blooms in the piece's colour**: a fan of fine streamers grows downstream for **1.5 s**, like real microbial streamers in runoff, with a bright wet sheen at its leading edge. A bubble train rises and a small steam puff lifts. The bloom then slowly **bleaches**: fully saturated for about **8 s**, paling to cream by about **30 s**, recolonised by the base mat colours by about **60 s**. **[amended: §3.7]** | Placed at the piece's own height, in the piece's own colour, as a moving wet front. Pigment in sunlight, not a glow. |
| **Hard drop** | **The Plunge.** Same as a lock, but the slug of water jumps the lip in an arc of sunlit drops (spray slot). The nearest fumarole fires a sharp white steam jet, **2 to 8 m** tall in proportion to the rows fallen. The bloom spreads **1.5×** farther and faster. No camera dip. | A visible jet whose height scales with the drop distance. |
| **Line clear 1 / 2 / 3** | **The Seal.** For each cleared row, on both sides at that row's height, sinter precipitates a **new rim**: a crisp white lip draws itself across the terrace (on the left, across the Iris's microterraces) in about **0.4 s**, sparkling like time-lapse frost. The pool behind it then **fills**: milky turquoise rises and lights from within, and then a sheet spills over the new lip into the tier below. With 2 or 3 lines, the fills chain downward **0.15 s** apart, so the cascade runs. Every bloom alive in that area is **fixed**: it stops bleaching and becomes a permanent, lower-saturation stripe in the stone (fossil slots). Over a session the Stair's walls slowly become a striped record of your colours. The Iris sends one modest steam lift per line. Gravity cascades (wave k ≥ 2) extend the cascade one tier further per wave: the game's "cascade" is literally a cascade. **[amended: §3.8]** | Height-matched; the count of new lips equals the lines cleared; water filling basins is a grammar the fleet has not used. |
| **Four lines** | **Major eruption of the Chalice.** No hush or darkening. **0.00–0.35 s**, *surge*: the Chalice's pool heaves into a dome and overflows down the cone, and a steam skirt flares at its base. **0.35 s**, *launch*: a water column rises to **90 m** in **0.8 s** with a dense white core, and spray climbs past the frame top. The **primary rainbow ignites** in the spray at the antisolar angle, ramping in over **0.5 s**. **0.6–3.5 s**: four spouters fire in sympathy across the basin, near to far, **6 to 10 m** each. Meanwhile the Iris **overflows**: a glossy sheet floods the whole apron (wetness 0 to 1 over **1.2 s**), so every band goes darker and more saturated, as wet rock does. At **4 s** the column falls back as glittering rain, and the **steam phase** follows: a towering white column billows and leans across the sky band for about **15 s**, carrying a pale broad **fogbow**. The post adds a saturation lift (**vivid ≤ 1.25**), never an exposure flash. **[amended: §3.10, no fogbow]** | One geyser, unmistakable, beside the card. Spectacle comes from colour and motion, not luminance. |
| **Combo chain (true combo)** | **Preplay, then eruption.** This follows the real geyser cycle, where small preplay bursts trigger the main eruption. Escalation: each chain link from 2 upward triggers **one discrete preplay burst** at the Chalice, so the player can count links as splashes. Links 2–3: **1–4 m** splashes over the rim. Links 4–5: **8–15 m**, rhythmic, and fumaroles across the basin chuff in sympathy. Links 6+: a sustained water column (**25 m, growing to 60 m**) with a standing rainbow in it. In parallel the **Iris heats**: the cobalt eye widens about **6% per link (cap +40%)**, the bands march outward, the steam thickens and its underlight turns turquoise, and the fingers run wet. **Release (chain break):** the column gives way to the **steam phase**, a roaring white exhalation lasting **4 + 2 × peak** seconds that drifts across the sky and thins. The Iris cools, and the bands slide back over about **12 s**. A break reads as a satisfying sigh, not a collapse. **[amended: §3.9, no bow at 6+, a second gauge]** | One burst per link; height and the eye's width are both a gauge. Steam phase equals the end of the chain. |
| **Back-to-back** | **The bow doubles.** The next eruption shows the **secondary bow**: colours reversed, 51° out, with the darker Alexander's band between the bows. While the B2B chain lives, a faint **standing fogbow** hangs in the basin's steam as a persistent, world-native status light. It fades when a non-difficult wave-1 clear breaks the chain (inferred by the director, because no `active:false` exists). **[replaced: §3.5, the Consort]** | Double rainbow means a doubled achievement, and the indicator persists while B2B is live. |
| **T-spin** | **Steam devil.** A slender, rotating steam whirl spins up off the Iris; this real phenomenon forms over hot water in cold air. Its skirt is coloured from beneath by the bands it crosses: turquoise core, apricot hem. It wanders across the apron toward the card's side for **5 to 7 s**, leaning and wobbling, then dissipates. A T-spin single raises 1 devil, double 2, triple 3. They live in the world and do not orbit the card. **[amended: §3.11, adds a persistent scar]** | A twisting column means a spin, and the count matches the lines. |
| **Perfect clear** | **The Sleeper wakes.** The dormant giant on the far rim, otherwise only a faint wisp, erupts for the first time this session. A **150 m** column stands above the frame top, and its steam phase rolls across the whole sky in white billows. A full **double rainbow** stands in its falling spray. As the steam thins (about **10 s**), the basin is revealed **renewed**: every bleached bloom and fossil stripe washes away, and all bands blaze at maximum season saturation for **20 s** before settling. The moment stands alone, because PERFECT_CLEAR arrives in a later frame with no rows. **[amended: §3.12, no bow, the stone record stays]** | The rarest event wakes the rarest thing in the world. |
| **Level up** | **The year turns.** A succession front sweeps outward from the Iris along the fingers over about **6 s**, recolouring the mats to the next season. The sky, the steam density, the frost or snow on the rim and the ghost pines follow. A soft silent level-up on rebuild restores the season without the sweep. | The colour change starts at the source and travels, so it reads as cause and effect. |
| **Game over / top-out** | **The springs sigh.** All live blooms bleach to white over **3 s**. The Chalice's pool **drains** (the water level sinks into the vent with a last gurgle of steam). The steam thins and the colours ease **15%** toward muted for about **8 s**. On `resetSession` the Chalice refills and the steam returns over about **6 s**. Fired from window `gameOver` (single player and Infinity) and from GameModeManager `modeStopped`. | Quiet, dignified, and physical. |
| **Idle (no play)** | The basin keeps its own life. The Chalice runs its natural cycle (preplay clusters, a modest eruption about every **3 minutes**, with a bow if it is in the spray). The breath thickens and thins the steam, and gusts reveal the eye. After about **60 s** every bloom has bleached and recolonised, leaving a pristine basin. The fossil stripes remain until a new session or a perfect clear. **[amended: §3.9, idle eruptions only in menus or after 60 s idle; no idle bow]** | A screensaver-worthy rest state. |

**Mode notes.**
- **Meditation (`serenity` mode):** clicks are LINE_CLEARs with a `position`. The click point is
  projected onto the ground, a spouter fountains there, and click combos grow it.
- **Odyssey:** synthetic clears with empty rows fall back to the lowest Stair tiers.
- **Local multiplayer:** has no TSPIN, B2B or PERFECT_CLEAR. Combo still drives preplay per player,
  and the world follows the maximum chain on screen.
- **Infinity:** uses `viewportOrigin` for aims.

**Photosensitivity.** No event changes exposure.
- Eruptions are bright but localised (**under 10% of the frame**) and ramp in over at least **0.3 s**.
- The "vivid" saturation lift is the only global response, capped at **1.25**, with a time constant of
  at least **0.4 s**.
- Bow intensity ramps in.
- Repeated hard drops are capped by `max()` folding: a new jet restarts a slot rather than stacking.

**Reduced motion:**
- the camera's breathing and parallax are off
- steam drift ×0.4
- devils turn in place rather than wander
- eruptions rise over 1.2 s
- shimmer is off

### 1.6 Piece colours (as proposed) **[amended: §3.13, CVD fix]**

Every piece wears a colour from the basin, and no shape wears its Guideline hue. The score on
`npm run check:palette` is **0/7**: all seven roles are deranged.

| Shape | Name | Hex | Hue | Guideline band for that shape | Match? |
|---|---|---|---|---|---|
| I | Phormidium Orange | `#FF8A2A` | 27° | cyan 160–210 | no |
| O | Iris Cobalt (bright) | `#3A78F0` | 220° | yellow 32–75 | no |
| T | Sulfur Lemon | `#F5D020` | 50° | purple 245–315 | no |
| S | Vent Turquoise | `#19C2D6` | 186° | green 90–170 | no |
| Z | Chlorophyll | `#8DBF3A` | 83° | red 320–20 | no |
| J | Thermus Rose | `#E2559A` | 331° | blue 200–250 | no |
| L | Calothrix Rust | `#B8341C` | 9° | orange 20–50 | no |
| GARBAGE | Bleached Sinter | `#7E776C` | — | — | — |
| CLEAN_GARBAGE | Opal | `#CFE3E0` | — | — | — |

**Separation (as claimed).** "Hue and value are spread so the set stays distinct for most colour-vision
types. From light to dark: lemon, turquoise, orange, rose, chlorophyll, cobalt, rust. Orange and rust are
18° apart in hue, but about two value steps apart, and rust is redder." **Both claims fail a check made
while writing this file** (measured CIE L\*: lemon 84.3, turquoise 72.0, chlorophyll 71.7, orange 69.2,
rose 57.1, cobalt 52.5, rust 42.4; and I/Z collapse under protanopia and deuteranopia). §3.13 has the
numbers and the fix.

**How the cells look: glazed mineral tiles.** `version: 2`, `renderMode: 'solid'`, using the Phaser
`effects` block (as in `src/themes/ocean/ocean-tetrominos.js` and `src/themes/rainbark/rainbark-tetrominos.js`):
- `gradient: true`, with a soft top-left wet highlight of about **0.22**, like a fresh film of water on
  glazed sinter
- a thin darker rim of the same hue (`rim: true`, rimAlpha about **0.45**)
- a slight inner shadow
- no glow, pulse or trails, which keeps the active piece, ghost, next queue and multiplayer previews
  readable on every surface
- garbage is matte and dry (no highlight), the colour of dead white sinter gone grey, matching the
  world's own decay

The world uses the same seven hexes as the pigment of the lock blooms. The board's colours and the
basin's living colours are therefore literally one palette.

### 1.7 Rendering plan (TSL, three r186.1, WebGPU and WebGL2 backends)

#### House rules carried over

- One scene pass and one output pass; bloom on a max-channel knee; no MRT.
- Everything is a self-shaded `MeshBasicNodeMaterial`: no scene lights, no `ShaderMaterial`, no `mx_*`
  noise.
- Noise is baked on the CPU into 2D textures with CPU mips (half-float fBm, an RGBA8 cellular tile and
  a ridged flow tile). **No `Data3DTexture`**: any 3D noise uses the Void Ember 2D-lattice trick
  (SKILL.md gotcha #136; `src/themes/void-ember/void-ember-tsl.js`). `Data3DTexture` writes also fail
  WebGPU validation on the headless SwiftShader build used for cloud captures.
- One shared uniform bag `u`. **One** packed `vec4` `uniformArray` event table, with live rows
  compacted to the front and a `Loop` over the count, to stay within 12 uniform buffers per stage
  (gotchas #102, #110).
- Laid-out pure helpers only (gotchas #81, #93, #95). Pools are always drawn, with zero-size dormant
  slots, so the first frame compiles every pipeline.
- Determinism: `seek(t)` plus a fixed-step replay.

#### Per element

| Element | Technique | Notes |
|---|---|---|
| **Sky + far rim** (`-sky.js`) | A screen-space backdrop triangle at the far plane (renderOrder after the solids). `skyColour(dir)` is an analytic cerulean-to-haze gradient with a slight brightening on the sun side and cirrus from baked fBm on a sky plane. The far rim and plateau come from a baked 1D crest table (two silhouette layers by azimuth) with aerial-perspective haze. | The same `skyColour` (fewer layers) feeds the Fresnel on the water and the haze. No sun disc. |
| **Iris + apron ground** (`-basin.js`) | A CPU polar fan mesh centred on the Iris, finer near the camera and the eye. The CPU bakes heights: a gentle sinter dome, radial microterrace steps, incised channels. In the fragment shader, a **temperature field** T(p) is computed: an elliptic distance to the vent, domain-warped by fBm into scalloped lobes; plus radial **fingers** (ridged noise in (θ·N, log r)) where hot water runs further; plus combo heat (scales the radii); plus event heat (Loop). Colour comes from a **256×6 half-float ramp DataTexture** (one row per season). The succession front picks the old or new row per pixel (gotcha #143). A baked cellular tile gives the mat micro-texture: bubbly, wrinkled mats and conical tufts. **Wetness** (channels + flow-map sheen + event wetness) darkens albedo, raises saturation and lowers roughness, which drives a Schlick Fresnel sky reflection written as products (gotcha #94). Lighting: wrap-Lambert from the heightfield normal; hemispheric sky ambient; **steam shadows**, where the ground point is projected along the sun direction to the plume layer and a Loop over ≤12 plume ellipses (uniform rows) applies Beer transmittance; then aerial perspective. | The hero shader. Event Loops are bounded by distance tests, so they early-out. |
| **The Iris's water** | Inside the pool mask: an analytic bowl depth (ledged throat profile). **Fake refraction**: the lookup into the procedural sinter-ledge pattern on the bowl floor is offset by the convection normal × depth. Beer-law absorption gives cobalt in the deep, turquoise on the shelf and clear water over cream at the rim. Convection normals come from 2-octave fBm plus **boil-dome** slots (bulge plus turquoise lift). Sky Fresnel is clamped (at most **0.12**) so the cobalt never washes out. | Not a mirror: there is no scene reflection, only a gentle sky sheen at grazing angles. |
| **The Stair** (`-terraces.js`) | A separate denser mesh patch for the right foreground. At build time the CPU bakes a 512² RGBA layout texture: height, distance to the rim (scalloped), tier id, and arc-length along the rim. The vertex stage displaces from it with `.level(0)`. Pools are flat water at rim height minus ε. Pool colour is **single-scattering "lit from within"**: `albedo × sun × (1 − exp(−σd))`, milky turquoise. The pool floor uses the same fake-refraction trick. Risers carry flow streaks along the slope (scrolling noise), apricot and chocolate microbial stain bands, and baked AO beneath each lip. Wrap lighting gives a subsurface feel on the cream travertine. **[amended: §3.6.3, heights in a vertex attribute]** | **Fill, seal and fossil effects** read the tier id and arc-length: rims draw along their arc-length, and the water level rises per tier. |
| **Steam** (`-steam.js`) | Each plume is 2 to 6 vertical sheets, world-anchored, facing the camera around a vertical axis and slightly staggered in depth. Density = envelope (width grows with height, bent by wind) × fBm advected upward (two taps at different scales and speeds, domain-warped). Opacity = `1 − exp(−σ·ρ·L)` (Beer). Light = sun × (0.35 + 0.65 × self-shadow, from one tap offset toward the sun) × phase (Henyey-Greenstein g ≈ 0.55 plus a small backscatter lobe, since the sun is behind us) + **underlight**: the ground ramp colour at the sheet's base xz × spring glow × `exp(−h/12 m)` + blue sky ambient on the shade side. **Fogbow**: a broad white band at 36–42° from the antisolar direction, with a faint red outer and blue inner edge, scaled by density **[removed: §3.4]**. Output is premultiplied over the scene (CustomBlending One / OneMinusSrcAlpha, gotcha #90). Ground mist is 1 to 4 horizontal sheets just above the apron, with gust holes. Sheets fade where they project onto the card rect (a screen mask uniform) as well as under the post calm zone. **[amended: §3.6.1]** | Ordered by renderOrder bands by distance, which is static because the camera is quasi-fixed. |
| **Steam devils** | One open cylinder mesh per devil (≤3), front and back faces. Density comes from noise in (θ + ωt − twist·h, h − rise·t) × a radial thickness term from view·normal. The path is a closed-form wander curve with lean. Lit like the steam, with underlight sampled at its moving base. | Dormant devils are scaled to zero. |
| **Geyser, spouters, spray** (`-geyser.js`) | **Cone:** a small lathe mesh (sinter, spicule-noise normals). **Column core:** 3 to 5 vertical billboards of streaked white water scrolling upward, shaped by a closed-form height h(t) for each eruption slot **[replaced: §3.6.2, lathe mesh]**. **Spray and rain:** ONE instanced quad pool. Integer-coded seeds sit in an interleaved buffer (gotchas #87, #99). Per-slot eruption parameters live in the event table. The vertex stage evaluates a closed-form ballistic path `p0 + v0·t + ½g·t²` and kills particles at landing. Each particle's **rainbow colour** is computed per vertex from the angle between view and antisolar: primary 40.6–42.4° (red outside); secondary 50.2–53.4° (reversed); Alexander's band dims the spray by 30%. It is passed as a varying. Size is floored at about one buffer pixel (gotcha #147), and total light is budgeted per tier (gotcha #120). **[amended: §3.4, analytic bow on a veil]** | One draw serves the Chalice, the spouters, the Sleeper and the hard-drop splashes. |
| **Ghost pines + jewel pools** (`-flora.js`) | Instanced tapered trunk cards: silver-grey dead wood with branch stubs, white silica socks where they stand in runoff, side-lit, plus hoarfrost or snow by season. Jewel pools are extra temperature kernels in the basin shader, with their own ramp offsets (lime acid, champagne orange rim with bubble particles, opal). | Static, apart from the sheen at the socks. |
| **Heat shimmer** (post) | In the output pass, a UV offset driven by fBm(time) inside analytic screen ellipses (the projected Iris and Chalice vent, passed as uniforms), multiplied by (1 − calm). | One extra scene tap. |
| **Anticrepuscular hint** (Ultra+) | The ground mist's density is modulated by projected plume shadows. The shadow lanes naturally converge toward the antisolar point. | A rare, real optic. |

#### Post (`-post.js`)

- The scene pass uses **MSAA 4× only at Ultra and Extreme**. Medium and High use FXAA, as Sunset does,
  because steam overdraw under MSAA is bandwidth-heavy.
- Bloom (Medium and up) uses the house `highPassFn` with a **high threshold** of about **1.6** in linear
  space. Only spray glints, rainbow cores and wet sun-glints bloom; the bright sky and steam must not
  veil.
- The output pass runs in this order:
  1. shimmer
  2. calm zones (the house rounded-box SDF soft-clip)
  3. bloom add
  4. exposure (fixed)
  5. "mineral filmic" tone map: hue-preserving, with a shoulder tuned so lit steam lands at about
     **0.86** and never flat white
  6. grade: clear cool shadows, faint warm highlights
  7. **vivid**, a saturation lift uniform for eruptions and the perfect clear
  8. light vignette
  9. sRGB encode, then grain and dither
- There is no rush, zoom blur, lens ripple or flash.

#### Quality tiers ("every tier keeps the whole picture and every event")

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Basin fan (rings × spokes) | 48×64 | 64×96 | 96×144 | 128×192 | 160×256 | 200×320 |
| Stair layout bake | 256² | 256² | 384² | 512² | 512² | 768² |
| Steam plumes × sheets | 4×2 | 6×2 | 8×3 | 10×4 | 12×5 | 14×6 |
| Ground-mist sheets | 0 | 1 | 2 | 3 | 4 | 4 |
| Spray particles | 400 | 700 | 1400 | 2400 | 3600 | 5000 |
| Lock-bloom / fossil slots | 8 / 8 | 12 / 12 | 16 / 16 | 16 / 24 | 16 / 24 | 16 / 32 |
| Ghost pines | 24 | 40 | 72 | 110 | 150 | 200 |
| Devil mesh | 12×8 | 16×10 | 20×12 | 24×16 | 28×18 | 32×20 |
| Mat micro-texture octaves | 1 | 1 | 2 | 2 | 3 | 3 |
| Steam fBm detail tap | off | off | on | on | on | on |
| Shimmer | off | off | on | on | on | on |
| Anticrepuscular lanes | off | off | off | off | on | on |
| Bloom (resolution) | off | off | 0.33 | 0.45 | 0.5 | 0.5 |
| AA | none | none | FXAA | FXAA | MSAA 4× | MSAA 4× |
| Pixel-ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |

Octaves and taps are dropped as whole **terms in JavaScript**, never by substituting 0.5 (gotcha #135).
Minimal and Low drop bloom, shimmer, the steam detail tap, the second mat-texture octave and the
anticrepuscular lanes. They also reduce counts. Every event remains, including the bows (they are
analytic and cheap) and the devils (with smaller meshes). §5.8 has the amended table.

**Estimated GPU cost** (1080p, mid-range iGPU; these are targets to verify with the ADR-0016 instrument,
`docs/adr/0016-perf-claims-require-a-verified-instrument.md`, not claims):

| Tier | Ground | Stair | Steam | Particles | Post | Total |
|---|---|---|---|---|---|---|
| Minimal | 1.2 | 0.3 | 0.6 | 0.1 | 0.3 | about 2.5 ms |
| Low | 1.5 | 0.4 | 0.9 | 0.15 | 0.35 | about 3.3 ms |
| Medium | 2.0 | 0.5 | 1.3 | 0.25 | 0.9 | about 5 ms |
| High | 2.4 | 0.6 | 1.8 | 0.35 | 1.1 | about 6.3 ms |
| Ultra | — | — | — | — | — | about 8.5 ms (aimed at discrete GPUs) |
| Extreme | — | — | — | — | — | about 11 ms (aimed at discrete GPUs) |

Steam overdraw is the variable term: the plume budget caps screen coverage at about **1.6× (High)** and
about **1.0× (Low)**.

#### Phone strategy

- Phones use the Low or Minimal tier with the pixel-ratio caps and the portrait preset (§1.2). The Iris
  below the card covers about 22% of a small buffer; the ground shader cost scales with that, and the
  card area is cheap behind the calm zone.
- Steam sheets thin out where they project onto the card.
- Particles are floored at one buffer pixel and dimmed rather than drawn sub-pixel (gotcha #147).
- No render targets beyond the post (no env target, no reflector, no accumulation target).
- Captures must include **390×844 portrait** and the **Low and Minimal** tiers (gotchas #71, #135, #147).

#### WebGL2-backend risks

1. Nested `select` holding a `Fn` call (gotcha #89), the WebGL2-only `addToStack` failure. Fold
   conditions into single selects inside laid-out helpers.
2. Vertex texture fetch for the Stair displacement must use `.level(0)`. If it is flaky on a device,
   bake heights into a vertex attribute instead (one CPU pass). (§3.6.3 makes the attribute the default.)
3. Half-float textures: RGBA16F is filterable on WebGL2, but mips for the fBm are built on the CPU, as
   the house does.
4. More than 8 vertex buffers is a WebGPU-only failure (gotcha #99). Every instanced pool uses one
   `InstancedInterleavedBuffer`.
5. Dynamic `Loop` bounds come from int uniforms, as the siblings already ship on both backends.
6. Transparency sorting: steam is ordered by fixed renderOrder bands, because the camera barely moves.
7. Shader size: the basin fragment is the largest. Keep the ramp in a texture, keep helpers laid out,
   and gate the WGSL size two ways: `tests/unit/iris-springs-shaders.test.js` (each stage < 48 KB,
   §5.10) and, in the browser, a WGSL-size reporter: `scripts/capture-breathing-headless.mjs`
   has one behind `--shaders` (an init script that wraps `GPUDevice.prototype.createShaderModule`
   and records each module's `code.length`). That script only captures the breathing effect, so
   copy its init script into your scratchpad capture tool (PLAYBOOK.md §5) for `effect=iris-springs`.

#### Module split (as proposed; §5.2 has the amended list)

```
src/themes/iris-springs/
  iris-springs-core.js         three-free: world plan (metres), seasons, temperature ramp stops, piece colours,
                               geyser cycle maths (closed-form schedule + preplay/eruption/steam-phase envelopes),
                               bow angles, sun-from-composition solver, row→tier mapping, mulberry32, approach
  iris-springs-tsl.js          uniform bag u + ONE event table, hashes, CPU bakes (fBm, cellular, ridged flow,
                               ramp DataTexture, crest table), skyColour, thermoRamp, bowColour, steamLight, haze
  iris-springs-quality.js      QUALITY tiers (table above), tierFor
  iris-springs-sky.js          backdrop: sky, cirrus, far rim, plateau
  iris-springs-basin.js        Iris water + apron + fingers + microterraces + jewel pools + steam shadows
  iris-springs-terraces.js     the Stair: baked layout, pools, rims, curtains, fill/seal/fossil
  iris-springs-steam.js        plumes, ground mist, steam phase, devils, fogbow
  iris-springs-geyser.js       Chalice cone, column cores, spray/rain pool with per-vertex rainbow, spouters, Sleeper
  iris-springs-flora.js        ghost pines (+ frost/snow by season)
  iris-springs-fx.js           event-slot writers: blooms, fossils, fills, boils, puffs, jets, eruptions, devils
  iris-springs-world.js        IrisSpringsWorld (WORLD_METHODS contract), REST_RIG, fovForAspect, IRIS_SPRINGS_PARTS
  iris-springs-post.js         RenderPipeline, knee bloom, output pass (shimmer, calm, filmic, vivid), POST_LOOK
  iris-springs-director.js     copy of ocean/serenity-warp director (+ b2b-chain inference, cascade depth)
  iris-springs-composition.js  copied readers + new presets (Iris side, Chalice side, bowAnchor, HUD mirroring)
  iris-springs-tetrominos.js   palette above (version 2)
  iris-springs-theme.js        BaseTheme adapter (copied lifecycle, renamed flags irisSprings*)
  iris-springs-theme-icon.png  the Iris eye, coloured steam, a white column with a bow   [amended: §3.4, no bow]
src/playground/effects/iris-springs.effect.js
```

**Parts:** `sky, basin, terraces, steam, geyser, flora, fx`.

**Playground parameters (as proposed):** the house set, plus `season=0..5`, `heat=0..1`, `breath=0..1`,
`b2b=1` and `event=…|gameOver`. (§5.5 has the full amended list.)

**Build order (as proposed), one effect per session:** 1. sky + basin (static); 2. steam; 3. the Stair;
4. geyser spray + bows; 5. the event language; 6. post and tiers. (§5.6 has the amended staged plan.)

### 1.8 Why it will be breathtaking, and why it resembles nothing in the fleet

**Breathtaking (as argued by the proposal):**
- **The most colourful natural object on Earth, made bigger.** The colour is a function of real
  temperature, so the bands have the irregular, organic, scalloped logic of the real thing, not a
  gradient.
- **The empty slot in the fleet.** It is high-key, mineral-saturated daylight. Most of the 61 themes
  are night, dusk, golden-hour monochrome or void. This one is cerulean and pearl and blazing orange.
  (Rainbark now also occupies high-sun daylight; see §4.)
- **Steam lit by the ground.** Steam that takes the spring's colours from below (turquoise core, apricot
  hem) is a signature image no theme has: volumetric-looking colour without a single extra pass.
- **Honest optics as reward.** The rainbow appears only where the spray meets the antisolar angle. B2B
  adds the reversed secondary bow and Alexander's dark band. The steam carries a broad pale fogbow. A
  perfect clear hangs a full double bow in a giant's falling spray. (§3.4 cuts this to one bow.)
- **A complete physical grammar that is new to the fleet:** spill, then bloom; bleach to white, unless
  sealed into stone; the cascade fills basins; preplay builds to eruption, then the steam phase; steam
  devils; the succession of seasons. Every gameplay beat is a process you could witness in a real geyser
  basin, and the session leaves a striped record in the terraces.
- **Spectacle without strobing.** The big moments are carried by colour, water and motion, not luminance
  flashes, which also makes it the most photosensitivity-friendly showpiece in the roster.

**The three closest themes and the exact differences:**
1. **halcyon-apex** (turquoise water, golden dawn, an 8-terrace pyramid).
   - Halcyon is an architectural stepped pyramid of sandstone beside a **mirror lagoon**, with floating
     crystals, ley lines and a low dawn sun on the horizon.
   - Iris Springs has **natural** travertine terraces whose pools are milky and lit from within, with
     water flowing over the rims and never mirroring the scene. It has no crystals, no architecture and
     no sun in frame. Its turquoise is one band in a full temperature spectrum, not the dominant tone.
2. **geode** (concentric warm agate bands round a centre).
   - Geode is an **interior** radial tunnel looking into a glowing white-gold heart, lined with faceted
     gems in a violet and orange jewel palette.
   - Iris Springs is open air. The bands lie flat on the ground, seen as an oblique ellipse that is
     off-centre and fingered, and they surround a **dark cool cobalt** eye, not a glowing heart. The bands
     are wet, alive and steaming, with no facets, dispersion or glitter cracks.
3. **cinder-drift** (geothermal, a burst of fountains on a clear).
   - Cinder-drift is a dark underground magma chamber: a heat spectrum of black to red to white, lava,
     crust plates, fire fountains, basalt columns, and "hold its breath" on four lines.
   - Iris Springs is hydrothermal **water** in bright daylight. Its heat is expressed as the colours of
     living mats, not incandescence. A clear **builds rims and fills pools** rather than venting fire. The
     four-line payoff is one geyser with a rainbow and a steam phase, with no hush and no darkening.

**Also checked:**
- shifting-sands: "spice blows" are dust geysers on orange dunes at dusk.
- parhelion: ice-crystal halos and sundogs around the sun on a snowfield. Ours are droplet bows on the
  antisolar side, and the sun is never in frame. (Parhelion's avoid list also names "cobalt-and-gold
  daylight" and "optical arcs"; one more reason for §3.4.)
- verdant-hills: daylight with cloud shadows on a meadow. Ours are steam shadows on a mineral basin.
- ocean and koi-pond: turquoise water with caustics. Caustics are deliberately avoided here.
- chromadelic-highway, tornado and singing-bowl: rainbow motifs as neon roads, ribbons and hue cycling.
  Ours never hue-cycles; the bow is an optic.
- winter and ice-temple: snow appears only in one of six seasons, as a white field round steaming colour.
- Found while writing this file: luminous-tides' avoid list names "a geyser of light" (its icon), and
  pyrestorm's names "eruptions". §3.1 keeps the Chalice's column water, never light or fire.

### 1.9 Top risks and mitigations (as proposed)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **The scene goes milky and flat.** High-key ground plus white steam could wash out contrast and the board. | Steam coverage is budgeted per tier; the knee bloom threshold is high (about 1.6); the tone-map shoulder puts lit steam near 0.86; the cobalt eye and steam shade provide anchoring darks. Steam fades where it projects onto the card, as well as under the calm zone. Judge everything in false colour first (gotcha #149). |
| 2 | **The rainbow lands off-frame or on the card** at some aspect or layout (4:3, multiplayer, portrait). | The sun is solved from the composition each layout pass so the bow crosses the Chalice column (`bowAnchor`). If no valid placement exists, the bow is simply unseen: every event also has a non-bow payoff (the column, the devil, the spouters). Pin this with unit tests for 16:9, 21:9, 4:3 and 0.46. |
| 3 | **The lock bloom is hard to read** because the ground near the card sits under the HUD, or because a cobalt or rust bloom lands on rust mats. | Aims step past the HUD rect. The bloom's leading edge carries a moving wet sheen; the bloom paints a thin cream "scour" halo before the pigment, for contrast; the pigment is clamped to stay at least ΔE 25 from the base band beneath it. (§3.7 replaces the clamp.) |
| 4 | **The basin fragment shader grows too large** (temperature field, fingers, ramp, wetness, Fresnel, shadows, haze, event Loops) and compiles slowly or hits the WebGL2-only select bug. | Use laid-out pure helpers, the ramp in a texture, and bounded Loops with distance early-outs. Split the Stair into its own material. Gate the WGSL size with the capture script (§1.7, WebGL2 risk 7), and run both backends in the playground before porting. |
| 5 | **Steam overdraw on phones**: large transparent sheets close to the camera. | Reduce plume and sheet counts on Low and Minimal; fade near-camera sheets; cap screen coverage at about 1.0×; no near-camera mist on Minimal. Profile with `profile=1&trackTimestamp=1` at 390×844. |
| 6 | **Photosensitivity**: a 90 m white column appearing fast. | The column ramps over 0.8 s and stays under 10% of the frame; no exposure change; the vivid lift is capped at 1.25 with τ ≥ 0.4 s; event slots fold with `max()`, so rapid cascades and hard drops cannot stack into strobing (WCAG 2.3.1). |
| 7 | **"It's just a photo of Yellowstone"**, or it reads as a real-place homage. | Use a fictional basin and names, an enlarged Iris, time-lapse life (blooms, succession, devils), honest but heightened optics, and a fused geology (terraces + prismatic spring + giant geyser) that no single real place shows together. |
| 8 | **Integration and naming**: the theme this one replaces may sit at an Odyssey orb whose name and chapter do not suit an Earth basin. Worked example: Cosmic Chimes was the theme of Odyssey orb 47 "Singularity Gate" in chapter 6 ("Space & Cosmic Expanse"); when Rainbark replaced it (commit `585ab55`) the orb was renamed "The Painted Giants", switched to `transitionIn: 'crossfade'` and given new copy as "a rare pocket of quiet before the final pull". | Alias the replaced id in `RETIRED_THEME_IDS` (`src/themes/theme-registry.js`) so saves, earned collection entries and Odyssey completions follow it. Decide deliberately whether the orb keeps its slot with renamed copy, or whether that level is remapped. See PLAYBOOK.md "Choosing a slot". |
| 9 | **Colour time-lapse reads as hue-cycling** (singing-bowl), or seasons read as a palette wheel. | Colour only changes by spatial fronts from a source (blooms, succession sweep), never by global hue rotation. Seasons are monotonic per level, with clock drift only in level-less modes. |

### 1.10 Reference facts used (web lookups made for the proposal)

These are the facts the proposal leaned on, with its sources. In-game copy must not state species or
geology facts (keep them in docs and code comments).

- **Grand Prismatic Spring.** About 110 m across and about 50 m deep, discharging about 2,100 L/min of
  70 °C water. The colour of the mats depends on the chlorophyll-to-carotenoid ratio: orange and red in
  summer, dark green in winter. Sources: [Wikipedia: Grand Prismatic Spring](https://en.wikipedia.org/wiki/Grand_Prismatic_Spring),
  [MicrobeWiki](https://microbewiki.kenyon.edu/index.php/The_grand_prismatic_spring),
  [Smithsonian](https://www.smithsonianmag.com/travel/science-behind-yellowstones-rainbow-hot-spring-180950483/).
- **Band organisms.** *Synechococcus* is yellow-green up to about 72 °C, *Phormidium* is orange at about
  45–60 °C, and *Calothrix* is brown at the coolest edge. Source:
  [How It Works](https://www.howitworksdaily.com/grand-prismatic-spring-what-causes-its-colours/).
- **Photosynthesis limit.** About 73 °C in alkaline springs; mats get thicker downstream as the water
  cools. Sources: [bioRxiv 2022](https://www.biorxiv.org/content/10.1101/2022.03.25.485844.full.pdf),
  [Daily Montanan](https://dailymontanan.com/2021/12/27/where-the-color-runs-out-why-some-yellowstone-pools-have-a-lot-of-color-while-others-dont/).
- **Steam colour and steam density.** The deep blue is reflected in the steam rising over the spring,
  and the orange and yellow come from the cyanobacteria in the runoff. Cold, humid air thickens the steam
  and can hide the colours. Sources: [MIT Earth 2006: Grand Prismatic & Fairy Falls](https://web.mit.edu/deaps/earth_2006/gp.html),
  [Teton Hiking Trails: overlook](https://www.tetonhikingtrails.com/grand-prismatic-overlook.htm),
  [SummitPost](https://www.summitpost.org/grand-prismatic-spring/516255).
- **Travertine.** It precipitates fastest where the water is agitated, so rims grow at the lip until
  breached. The mineral is white, and the colours are bacteria zoned by temperature. A spring that stops
  flowing turns white, then grey. Deposition at Mammoth runs at about 1 ton or more per day. Sources:
  [Mammoth Hot Springs Area (Project Gutenberg)](https://gutenberg.org/cache/epub/66403/pg66403-images.html),
  [USGS Bulletin 1444](https://www.nps.gov/parkhistory/online_books/geology/publications/bul/1444/summary.htm),
  [IGB Illinois](https://www.igb.illinois.edu/node/2889).
- **Geyser cycle.** Old Faithful erupts for 1.5–5 min to 30–55 m; a preplay of small discrete eruptions
  triggers the main one. Castle Geyser has a water phase of about 20 min to 27 m, followed by a steam
  phase of 30–40 min. Sources: [NPS geyser activity](https://www.nps.gov/yell/learn/nature/geyseractivity.htm),
  [GSA Today physical model](https://www.geosociety.org/gsatoday/archive/23/6/article/i1052-5173-23-6-4.htm),
  [Wikipedia: Castle Geyser](https://en.wikipedia.org/wiki/Castle_Geyser).
- **"Bobby-sox" trees.** Dead lodgepole pines whose bases turned white from silica-rich runoff. Sources:
  [NPS Old Faithful VVC](https://www.nps.gov/features/yell/ofvec/exhibits/ecology/plants/index.htm),
  [USGS image](https://www.usgs.gov/media/images/bobby-socks-trees-near-parking-lot-fountain-paint-pots-lower-geyser-basin-yellowstone).
- **Sinter textures.** Spicules form in splash zones; rims, columns and knobs form in overflow areas.
  Source: Lowe & Braunstein 2003, via the [mindat reference](https://app2.fnc.mindat.org/reference.php?id=483755).
- **Optics** (standard atmospheric optics, not looked up). The primary bow sits at about 42° from the
  antisolar point with red outside; the secondary at about 51° with colours reversed; Alexander's dark
  band lies between them; the sky inside the primary is brighter than outside it. A fogbow forms from
  small droplets: it is broad and nearly white, slightly inside the primary radius. Steam devils form
  over warm water in cold air. Anticrepuscular rays converge on the antisolar point.

---

## 2. What the judges said

Three judges scored all six concepts, each through one lens, 0–10. This section quotes or closely
paraphrases every passage about Iris Springs, keeping their numbers.

### 2.1 Art director: 7.5 (3rd of 6)

**Lens:** beauty, originality against the 61-theme catalogue (setting, palette, composition, motifs and
FX grammar), wow factor, depth, atmosphere and lighting, the still and the motion, surprise, and the
name. "I was strict about resemblance."

Art ranking: Haft Rang 8.5, Rainbark 8.0, **Iris Springs 7.5**, Painted Ages 7.0, Sunfall 6.5,
Riverbloom 6.0.

**Strengths.**
- **"The best palette in the slate,"** taken straight from the most colourful natural object on Earth:
  cobalt, turquoise, sinter cream, lemon, orange and rust. It fills the open high-key daylight slot
  without falling back on golden hour.
- **The signature image is steam lit from below in the spring's colours** (a turquoise core, apricot
  skirts). "It is real, cheap and unlike anything in the fleet."
- **The most ambient motion of the landscape concepts:** billowing steam, gust tears that reveal the
  eye, boil domes, runoff sheen and a geyser cycle.
- **"Bleach to white unless sealed into stone"** is a genuinely new decay for the fleet.
- **The combo can be counted in preplay splashes,** one burst per link.
- **The game over drains the spring,** quietly and with dignity.

**Weaknesses.**
- **The sun sits high behind the camera,** chosen so the antisolar point lands in frame. "Front light
  is the flattest light there is: it trades form, chiaroscuro and spectacle for saturation, and the user
  asked for spectacular lighting." Bright ground plus white steam also risks a milky, low-contrast frame.
- **Each element brushes a neighbour:**
  - concentric bands round a centre, like geode's agate;
  - stepped turquoise terraces in daylight, like halcyon-apex;
  - a four-line clear that is an eruption, like pyrestorm, cinder-drift and luminous-tides' "geyser of
    light".
- **The rainbow is again a key payoff.**
- **The oblique basin can read like a map.**
- **The name** is pleasant, but sounds like a spa or a real town.

**Worth grafting (into any winner).** Steam underlit by the ground colour; the bleach-to-white decay,
rescued by a clear; combo links counted as discrete preplay bursts; steam devils for the T-spin, which
twist in place rather than round the card; a succession front from the source for level up; a sun solved
from the composition so optics land in frame (`bowAnchor`); the game-over drain.

**Verdict line:** "Iris Springs is the best palette, held back by flat front light."

**Findings across the slate that bear on Iris Springs:**
1. **"The rainbow has become the slate's own cliché."** Three concepts make a physically placed bow a
   headline payoff: Iris (the four-line clear and B2B), Painted Ages (the chain release) and Sunfall
   (every clear plus the four-line clear). The fleet already has rainbow motifs in tornado,
   chromadelic-highway and singing-bowl. "Whichever concept wins should use the bow at most once, as a
   grace note, never as the signature."
2. **Almost every lock is still a softened version of the house "the world holds the colour".**
   "Something in the piece's colour appears beside the card at the piece's height, then fades over
   18–90 s: Iris blooms, Painted Ages fans, Riverbloom blushes, Sunfall leaves, Rainbark bands. Only
   Haft Rang breaks the pattern for real."
3. **Composition template.** Every concept puts a hero on the left and a secondary on the right, the
   template the catalogue asks us to break.
4. **Lighting slot.** Golden hour is the fleet's most overused light (halcyon, himalayan, sunset,
   summer, fall, tornado, golden-forest, waves, shifting-sands, nimbus and sky-children all use it).
   High sun or morning daylight is the open slot.
5. **"Whatever wins":** use the rainbow no more than once; keep the decay world-native (bleach, green,
   ripen), never "held then released"; source a clear's colours from the real cells of the cleared row
   (Painted Ages' shadow well).

### 2.2 Rendering lead: 6.5 (3rd of 6)

**Lens:** can it be built in three r186 TSL so it looks right on WebGPU and on the WebGL2 backend; cost
on phones and iGPUs; procedural without models; how cheap it looks if it falls short; compile and
pipeline cost; board readability. "Look-per-millisecond is the main thing I reward. I penalise concepts
whose beauty depends on volumetrics, refraction passes or extra render targets."

Tech ranking: Rainbark 8.5, Painted Ages 8.0, **Iris Springs 6.5**, Riverbloom 6.0, Sunfall 5.5,
Haft Rang 4.5.

**One-line verdict:** "The temperature-ramp ground is cheap and gorgeous. But half the frame's beauty is
steam sheets, geyser billboards and particle bows, and those look cheap when under-delivered."

**Strengths.**
- **The basin is a near-ideal look-per-ms element:** a polar fan mesh (the Sunset sea precedent); a
  temperature field with domain-warped scallops and log-polar fingers; a 256×6 ramp texture with one row
  per season, and a succession front per pixel (gotcha #143); fake refraction into the procedural ledge
  pattern, and Beer cobalt. "Cheap, physical and very colourful."
- **Steam underlit by the ground colour,** sampled analytically at the sheet's base, "is a free and
  memorable trick."
- **Bleaching decay** is a cheap uniform-driven event read.

**Weaknesses.**
- **Steam carries half the beauty, and it is camera-facing sheets.** 10×4 at High, with screen coverage
  capped at about 1.6×. "Sheet steam reads as cards when the sheets intersect, when the view moves, or
  when the noise is static." The steam phase, the devils (an open cylinder) and the fogbow all ride on
  the same technique.
- **The geyser column is 3–5 streaked billboards,** "the classic cheap-looking geyser."
- **The rainbow emerges from 2,400 spray particles.** "At that density a bow looks speckled, not banded."
- **High-key ground plus white steam** risks a milky, flat frame. The concept admits it.
- **The Stair needs a 512² layout bake with vertex displacement:** more modelling scope.

**Graftable (ranked list for the winner).** #5: "Iris Springs underlighting from the ground colour:
Rainbark's cloud-tide underglow should take its colour from the ripening bark above it, as cheap colour
bleed." #8: "Painted Ages analytic bow plus slab in-scatter: use it if any winner shows a bow, rather than
particle-only bows." (That second graft is the fix for Iris's own speckled bow; §3.4.)

**Verdict line:** "Iris Springs and Riverbloom lean on techniques that look cheap when under-delivered
(sheet steam and billboard geysers; dense alpha-tested fronds)."

### 2.3 Gameplay-feel designer: 8.6 (1st of 6)

**Lens:** how spectacular, colourful, satisfying and world-native each event is; readability at 1–3
locks per second; whether combos escalate and release clearly; novelty against the house FX grammar;
clean mapping to board positions; photosensitivity; how the theme feels after 20 minutes. "A 20-minute
session has roughly 600–900 locks, 150–250 clears, 10–40 four-line clears, a few T-spins and almost no
perfect clears. Lock and clear set the feel of the session."

Play ranking: **Iris Springs 8.6**, Rainbark 8.4, Riverbloom 8.0, Painted Ages 7.5, Sunfall 7.2,
Haft Rang 6.9.

**One line:** "Best combo arc in the set, a physical verb for every beat, calm at speed, the most
photosensitivity-safe. Weak points: the Chalice does too many jobs, and the lock can be hard to see on
phones."

**Strengths, beat by beat.**
- **Lock (Spill).** A wet front runs out along the finger or terrace at the piece's own height, on the
  side nearer the piece; streamers in the piece's colour grow for 1.5 s, then bleach to white over about
  30 s. "This is pigment in sunlight, not a glow, so it stays calm at two locks per second. Bleaching to
  white is a new decay for the fleet, and it explains itself."
- **Clear (Seal).** One crisp white lip per cleared row on both sides; the pool fills and spills to the
  tier below. "The number of lips equals the number of lines." Cascade waves extend the water cascade,
  "so the game's cascade is literally a cascade". Blooms caught by a clear leave a striped record. "It
  maps to rows cleanly, and filling basins is a verb the fleet has never used."
- **Combo.** "This is the best escalation and release in the set": one discrete preplay splash per link
  (countable); a parallel gauge as the eye widens about 6% per link; links 6+ give a sustained column;
  the release is a white steam phase lasting 4 + 2 × peak seconds, "so a break feels like a sigh, not a
  collapse." It is also the real geyser cycle.
- **Four lines.** No hush or darkening; dome, column, sympathetic spouters near to far, the whole apron
  going wet-saturated, a 15 s steam phase. The post adds a saturation lift capped at 1.25 and changes
  **no exposure**. "That is the safest four-line clear in the set."
- **B2B:** the reversed secondary bow, plus a standing fogbow "as a status light while the chain lives.
  This is a persistent, world-native B2B indicator."
- **T-spin:** steam devils, one per line, wandering the apron. "Native, though soft."
- **Perfect clear:** the Sleeper wakes and the basin is renewed. "A big standalone moment."
- **Level:** a succession front sweeps outward from the source, "which reads as cause and effect."

**Problems on this lens.**
1. **"The Chalice does too many jobs."** It is the hero of combo (6+ column with a rainbow), of four
   lines (90 m column with a rainbow), and of idle play (a 25 m eruption about every 170 s). "An idle
   eruption during a run will be read as a reward the player did not earn, and the combo 6+ bow takes
   some shine off the four-line bow."
2. **Lock visibility.** "Piece-coloured pigment lands on an already orange, rust and lemon ground. The
   planned cream 'scour' halo and the ΔE ≥ 25 clamp are essential. On a phone the lock lands in thin
   margin slivers or on the Iris rim below the card, which is the weakest lock placement among the top
   three."
3. **The rainbow overlaps a fleet trope.** Geode, lunara and vesper (`vesper-chrysalis`) all put a "prism ring across the sky"
   on four lines. "Keeping the bow inside the spray column, as designed, keeps it distinct. It must never
   become a sky-wide arc."

**The judge's own fixes for the build:**
- **Idle Chalice:** while a session is active, idle activity is preplay splashes only. Full eruptions
  only in menus or after 60 s of idle.
- **Bows:** keep the coloured bow for four lines and perfect clear only. The combo 6+ column gets a
  fogbow, or a bow only on B2B. (§3.4 goes further, to satisfy the art judge's "at most once".)
- **Lock shape:** borrow Rainbark's row span, so the spill front's height matches the piece's rows.

**Grafts the judge named specifically for Iris** (from the other concepts):
- From Painted Ages: **"Iris's fossil stripes could carry the cleared row's colours instead of only fixed
  blooms"** (the shadow well); a celebration on release sized by the peak ("or, for Iris, a fogbow");
  a persistent B2B landform; an ash or white sinter bed between games.
- From Riverbloom: **"B2B as a standing shape held in moving water"**; **"T-spin leaves a permanent
  record … For Iris: a sinter rosette or spiral scar in the mats where the devil passed"**; the hard drop
  feeds a persistent collection; a perfect clear in which the world goes still and clear before it
  blooms; a restart rite; everything flows toward the viewer.
- From Haft Rang: **"A spatial combo meter of 'light or water flowing along channels', where reach equals
  chain length. Iris's fingers and runoff channels could fill outward per link"**; T-spin as one
  rotational click of every pattern at once; give B2B its own screen region (the top band).
- From Sunfall: a discrete per-link counter; the clear's line count picks the optic tier; one leaf per
  cell on lock; water visible only where the light is.
- From Rainbark: the lock spans the piece's rows; four lines resets the world's age; a perfect clear that
  reveals what the session accumulated; a T-spin scar that lasts the level; native anticipation instead of
  a hush.

**Grafts the judge listed *from* Iris for any winner:** one preplay splash per combo link; bleach-to-white
decay rescued by sealing into stone; gravity cascade waves extend a physical cascade; **a saturation lift
instead of exposure flashes**; a steam-phase release lasting 4 + 2 × peak seconds; secondary bow and
standing fogbow as the B2B status light.

**Engineering note (all concepts):** the house `ComboTracker` reports a break one lock late. PIECE_LOCK
and wave 1's LINE_CLEAR are emitted in the same synchronous tick, so the director can infer at `flush()`
that a lock with no clear in the frame breaks the chain, and deliver `combo(0)` on the breaking lock
itself. "This matters most for strata's rainbow and Iris's steam phase."

### 2.4 Why it did not win

From the decision record in `docs/theme-concepts/rainbark.md`: Rainbark scored 24.9/30, next were Iris
Springs 22.6 and Painted Ages 22.5. Rainbark was "the strongest landscape on art, the best on look-per-millisecond (tech
8.5), and second on play (8.4)". Iris Springs won the play lens outright but lost 2 points to Rainbark on
rendering (sheet steam, billboard geysers, particle bows) and 0.5 on art (flat front light, neighbour
resemblances, the rainbow). §3 fixes exactly those.

---

## 3. Required changes before building

**This section overrides §1.** Every weakness a judge named has a fix below, plus the cross-cutting
findings and the gaps found while writing this document. §5 is already written against these fixes.

### 3.1 Every named weakness, and its fix

| Judge | Weakness | Fix (details in the subsection named) |
|---|---|---|
| Art | Sun high behind the camera: the flattest front light; trades form for saturation; the user asked for spectacular lighting | **Three-quarter back-side sun** (§3.2): azimuth 115–130° from the view direction (to the left), elevation 30–36° on desktop; portrait azimuth 140–150°, elevation 28–36°. Long plume shadows (1.5–1.7× plume height), a visible terminator on every plume (35–45% of each plume's visible area in shade), warm sun against cool shade, cavity AO in channels and under terrace lips. The bow solver works inside these ranges, never the other way round. |
| Art + Tech | Bright ground plus white steam risks a milky, low-contrast frame | **Measured contrast targets** (§3.3): the darkest 10% of non-card pixels at L\* ≤ 25; at most 30% of the frame above L\* 85; lit steam ≤ 0.86 after the tone map; steam screen coverage capped per tier; steam fades over the card. Gated by `falseColor=1` plus a tone-mapped luminance histogram in every Stage A shot. |
| Art | Concentric bands round a centre, like geode's agate | **Off-centre, oblique, fingered bands** (§3.15, §5.7 checklist): scalloped lobes (3–9 per band ring, amplitude 0.2–0.35 of band width), 30+ fingers, a dark cool eye, never centred on the screen or the card axis, never seen top-down (pitch ≤ 30°). The CPU lab (Stage A0) must show it does not read as a target, an agate or topographic contour lines. |
| Art | Stepped turquoise terraces in daylight, like halcyon-apex | **Milky, opaque, flowing pools in a cream and apricot Stair** (§3.15): turquoise ≤ 35% of the Stair's screen area; irregular scalloped tiers that follow the slope, with no axis of symmetry; water running over the lips; dripstone curtains; no reflections, crystals, architecture or sun in frame. |
| Art | A four-line clear that is an eruption, like pyrestorm, cinder-drift and luminous-tides' "geyser of light" | **Water, never light or fire** (§3.10): the column is lit like steam (white lit side, blue-grey shade side, never emissive, never above 0.86 after the tone map except tiny glints), no fire colours, no hush. The beat's signature is the **flood of wetness across the apron** and the steam phase's shadow sweeping the basin; the column is the cause, not the picture. |
| Art | The rainbow is again a key payoff | **The bow appears once** (§3.4): the primary bow, only on four lines, only inside spray. No bow on combo 6+, on B2B, on the perfect clear, on idle eruptions or in the icon. No fogbow anywhere. B2B gets a new indicator, the Consort (§3.5). |
| Art | The oblique basin can read like a map | **Depth recipe** (§3.15): sky band ≥ 10% of the frame on every desktop preset (12% at 16:9); vertical elements at every depth; a cropped near-scale anchor (the nearest Stair rim at 10–15 m with spicules); plume shadows; aerial perspective; camera breath; pitch never steeper than 18° on desktop or 30° on portrait. |
| Art | The name sounds like a spa or a real town | **Stage 0 decision with the user** (§3.14). Options: keep "Iris Springs"; "Thermal Bloom" (recommended); "Sinterbloom". Avoid "Prismatic". |
| Tech | Steam is camera-facing sheets that read as cards when they intersect, when the view moves, or when the noise is static | **Slices of one volume** (§3.6.1): every sheet samples a 3D noise field at its fragment's world position (2D-lattice `noise3`, gotcha #136), so sheets are slices through one volume; all sheets of a plume share one yaw and never cross; analytic ground fade; soft envelope edges; two advected taps plus domain warp so nothing is static; an analytic steam veil in the basin's haze carries density on Low and Minimal. Accepted in three frames 0.5 s apart with pointer parallax held. |
| Tech | The geyser column is 3–5 streaked billboards, the classic cheap-looking geyser | **A lathe mesh** (§3.6.2), sharing the devils' material: radius r(h, t) from the eruption envelope with noise jitter, front and back faces, density noise scrolling up, thickness from view·normal, a crown that flares as the water slows. |
| Tech | The rainbow from 2,400 spray particles looks speckled, not banded | **Analytic bow** (§3.4): evaluated per fragment on a spray-veil shell round the column and on any steam sheet inside the spray, from the angle to the antisolar point (the Painted Ages formulation). Particles only add glints tinted by the same function. |
| Tech | The Stair's 512² layout bake with vertex displacement is more modelling scope | **CPU prototype, then a vertex attribute** (§3.6.3): build the terrace generator in numpy/PIL first against reference photos; ship it three-free in `iris-springs-bake.js`; heights go into a vertex attribute (no vertex texture fetch); the layout texture is read only in the fragment stage at `.level(0)`; one session (A2) for the Stair alone. |
| Play | The Chalice does too many jobs | **Unload the Chalice** (§3.9): idle eruptions only in menus or after 60 s with no events (preplay splashes only while a session is live); no bow on combo 6+; the combo's second gauge moves to the Iris side (the fingers fill one notch per link); B2B moves to its own object and region (the Consort, §3.5). |
| Play | The lock is hard to see: pigment on orange, rust and lemon ground; phone slivers | **Scour, then bloom** (§3.7): the surge scours a strip to bare cream sinter first (every piece is ≥ ΔE 49 from cream, while five of seven sit 5.6–15.7 from their "home" band); the spill front spans the piece's rows; wet leading-edge sheen; a minimum on-screen size; on phones the lock lands on the Iris's near rim below the card first. Bleaching is time-normalised to slot pressure, so it is still seen at 1–3 locks/s. |
| Play | The rainbow overlaps the "prism ring across the sky" of geode, lunara and vesper | The bow exists **only inside spray** (veil, spray sheets, particles); the visible arc is at most 35° of the circle; never a sky arc and never a full ring (§3.4). |
| Play | The combo break reaches the theme one lock late | **Infer the break on the breaking lock** (§3.9). The Rainbark director already does it: clone `src/themes/rainbark/rainbark-director.js`. |
| Play (grafts for Iris) | Fossils from blooms only; soft T-spin; no spatial combo meter | Fossil stripes carry the **cleared row's real cell colours** (§3.8); the T-spin devil leaves a persistent **sinter rosette** scar (§3.11); the fingers are the spatial combo meter (§3.9). |
| Cross-cutting | Rainbow is the slate's cliché | §3.4 (once). |
| Cross-cutting | Decay must be world-native, never "held then released" | Bleach to white stays (a world process on the world's clock). A clear **fixes** pigment into stone; it never releases a held light (§3.7, §3.16). |
| Cross-cutting | A clear's colours from the real cells of its row | Shadow well → the new rim's stripe carries the row's 10 cell colours, left to right (§3.8). |
| Cross-cutting | Combo break inferred on the breaking lock | §3.9. |
| Cross-cutting | Avoid the house FX grammar (quoted in §3.16; source: `docs/theme-concepts/reference/research.md` §0 item 6) | Checked item by item in §3.16. |
| Gap (this file) | The Sleeper is visible only on 21:9, but the perfect clear needs it on every layout | The composer places the Sleeper in frame on every preset (§3.12). |
| Gap (this file) | The proposed piece palette collapses under colour-vision deficiency (I/Z ΔE 10.8 protanopia, 12.8 deuteranopia with ΔL\* only 1.7) | Adjusted I, Z and L hexes; worst pair now ΔE 17.3 (§3.13). |
| Gap (this file) | Lock-bloom slots (8–16) cannot hold 30–60 s of bleaching at 1–3 locks/s, so the bleach would never be seen in fast play | Time-normalised bleach under slot pressure (§3.7). |
| Gap (this file) | The fossil record is capped by 8–32 slots, so "a striped record over a session" cannot exist | A small CPU-written record texture keyed by (tier, arc length) (§3.8). |
| Gap (this file) | The perfect clear washing the fossil stripes away is unphysical (stone does not wash off) and destroys the record the player built | The stone record stays; the renewal restores the living colour only (§3.12). |
| Gap (this file) | "Thermus rose-pink streamers" | The pink filament streamers of Yellowstone's alkaline springs are usually attributed to *Thermocrinis ruber*; name the colour "Streamer Rose" and state no species facts in game (§3.13). |

### 3.2 Light: a three-quarter back-side sun, solved within fixed ranges

**Why.** The art judge's top weakness. Front light kills form; the original placement existed only to
put the antisolar point (and so the bow) in frame. With the bow cut to one event (§3.4), light comes
first.

**Ranges (composer output, never a world constant):**

| Preset | Sun azimuth (from the view direction, to the camera's left; 180° = directly behind) | Sun elevation |
|---|---|---|
| Desktop (16:9, 21:9, 4:3) | 115–130° | 30–36° |
| Portrait (aspect < 0.62) | 140–150° | 28–36° |
| Mirrored preset (HUD on the larger free side) | mirror the azimuth to the camera's right | same |

**Solver.** For each layout pass, search the range for the (azimuth, elevation) pair that puts the
primary bow (40.6–42.4° from the antisolar point) across the Chalice column at 55–70% of the column's
visible height. If no pair in range does, take the in-range pair nearest that target and let the bow be
unseen (the four-line beat has other payoffs). Ease the sun toward the new solution with τ = 2 s, and
never move it while an eruption slot is live.

**Checked numbers (made while writing this file, camera as in §1.2):**
- 16:9, sun azimuth 120°, elevation 32°: the antisolar point is 60° right and 32° down; the primary bow
  crosses the Chalice column 32–42 m above its base, at screen y 0.13–0.19 (column base at y 0.357,
  frame top at y 0). With elevation 36° it crosses at 18–26 m, y 0.22–0.26. Azimuth 110° at elevation 30°
  gives no crossing, which is why 115° is the lower bound.
- Portrait (camera 60 m, pitch 30°, vertical FOV 62°, Chalice at (0.72, 0.10), about 800 m away): azimuth
  140°, elevation 28° crosses 16 m up at y 0.08; azimuth 150°, elevation 36° crosses 36 m up at y 0.05.
- The original placement (azimuth 145°, elevation 42°) crossed 38–44 m up at y 0.12–0.15, so the new
  ranges keep the bow on the column with far more side light.

**What the light must do (acceptance for Stage A):**
- **Plume terminators.** Every plume shows a lit left flank (Steam Pearl `#F3F1EC`) and a shade right
  flank (`#9DB1C6`), with 35–45% of its visible area in shade.
- **Long shadows.** At 30–36° elevation a plume's ground shadow is 1.5–1.7× its height, falling to the
  front-right across the colour bands. Shadowed ground sits at 0.35–0.45 of lit luminance, cool-shifted
  toward the sky ambient.
- **Temperature contrast.** Sun `#FFF1DC` (warm, late morning) against sky ambient from `skyColour` on
  shade sides.
- **Relief.** Cavity AO in the finger incisions and under every terrace lip; raking light on spicules and
  microterrace steps (their normals come from the baked heightfield).
- **No sun specular from water toward the camera.** With the sun behind, horizontal water does not mirror
  it at us: glints come only from tilted facets (spray, bubbles, spicules, ripples).

### 3.3 Contrast and the steam budget (anti-milk)

Measured on the tone-mapped frame of acceptance shot A3 (and every later rest shot), card area excluded:

| Metric | Target |
|---|---|
| Darkest 10% of pixels | L\* ≤ 25 (they come from the eye's cobalt core, plume shadows on dark mats, channel incisions, the lodgepole rim) |
| Share of pixels above L\* 85 | ≤ 30% |
| Lit steam after the tone map | ≈ 0.86 display value, never 1.0 flat |
| Steam screen coverage (sum of sheet alpha over the frame) | ≤ 1.6× High, ≤ 1.3× Medium, ≤ 1.0× Low, ≤ 0.8× Minimal |
| Steam over the card rect | faded to ≤ 0.25 of its density (screen mask), on top of the post calm zone |
| Things above the bloom knee in `falseColor=1` | only spray glints, the bow core during four lines, bubble glints and wet-facet glints |

Implementation notes: the "mineral filmic" shoulder (§1.7 post) is tuned on lit steam first; then the
exposure is fixed so the cream rim, the brightest ground ring, lands at 0.80–0.84. Add a small helper in
the playground effect's diagnostics that reports the luminance histogram's 10th and 70th percentiles, so
shots can be checked numerically, not by eye alone.

### 3.4 The bow appears once (four lines only), and it is analytic

**Rule.** The coloured primary bow appears **only during the four-line eruption**, only inside spray,
for as long as the spray is in the air (about 0.85–4.5 s after the event). There is **no** bow on combo
links, on B2B, on the perfect clear, on idle Chalice eruptions or spouters, and **no fogbow** anywhere
(a fogbow is still a bow). The icon has no bow.

**The bow function** (one laid-out pure helper, `irisBowColour(cosAngle, density)` in `-tsl.js`):
- θ = angle between the view ray and the antisolar direction (pass the cosine; derive θ with a clamped
  `acos`).
- Primary band 40.6–42.4°, red outside, violet inside; band colours from a 1D table (8 stops are enough),
  no supernumeraries.
- **Brighter inside, darker outside** (real optics): spray luminance ×1.15 for θ < 40.6°, ×0.85 for
  θ > 42.4°, blended over 0.6°.
- Intensity = density of the spray at that fragment × eruption envelope, ramped in over 0.5 s; colour
  added, never exposure.

**Where it is evaluated:**
- **Spray veil** (new, in `-geyser.js`): an open shell mesh round the column at 1.6× its radius, density
  from noise scrolled upward, invisible except as spray haze and the bow carrier. This makes the bands
  continuous.
- **Steam sheets inside the spray** (the Chalice skirt) use the same function.
- **Particles** tint their glints with the same function in the vertex stage (varying), as sparkle on top
  of the bands, never as the bands.

**Limits:** the visible arc is at most 35° of the bow's circle (the spray only covers part of it); never
a sky-wide arc; never a ring. Under `reduce=1` the bow ramps in over 0.8 s.

### 3.5 Back-to-back: the Consort (replaces the secondary bow and fogbow)

**Idea.** Real geysers are often connected: in Yellowstone's Upper Geyser Basin, Grand Geyser's
eruptions are joined by its neighbours Vent and Turban. While a back-to-back chain is live, a companion
vent wakes: **the Consort**. It is a persistent, world-native status light in its own screen region, and
it doubles the next four-line eruption, so "doubled achievement" reads as a doubled column instead of a
doubled bow. (This takes the play judge's "give B2B its own screen region (the top band)" and "a
standing shape held in moving water".)

**Placement.** On the far apron above and left of the Iris, so its column rises into the sky band:
16:9 at about (0.25, 0.24); 21:9 at about (0.22, 0.24); portrait in the top band at about (0.28, 0.08).
Mirrored with the preset. Never inside a card or HUD rect plus a 0.02 margin.

| Time | What happens |
|---|---|
| B2B level 1 (first live back-to-back) | Over 2 s the Consort's mound darkens wet, a boiling dome rises in its small pool, and a **standing steam column** (12 m wide, 40 m tall, underlit turquoise) stands above it, with a small splash (2–4 m) every 3–5 s. |
| Level 2, 3 | Each new B2B steps it up: column 60 m, then 80 m; splashes 4–8 m, then a steady 10 m fountain. |
| A four-line clear while the Consort is live | **Double eruption**: the Consort fires a 50 m water column 0.25 s after the Chalice's launch, with its own spray (inside the same bow function; it may carry part of the bow if the geometry allows). |
| Break (director infers it from a non-difficult wave-1 clear; no producer sends `active:false`) | The fountain stops, the column thins over 6 s and the mound dries (wetness τ 8 s). Nothing is "released": the vent simply goes quiet. |

**Director:** `sink.b2b(level, player)` (0–3), exactly as in `src/themes/rainbark/rainbark-director.js`.
In modes without B2B (local and online multiplayer) the Consort stays dormant.

### 3.6 Rendering fixes for the techniques that look cheap when under-delivered

#### 3.6.1 Steam: slices of one volume

1. **One continuous field.** Density `ρ(P, t)` is a function of the fragment's **world position**:
   envelope (width grows with height, bent by wind) × `noise3` (Void Ember 2D-lattice trick, gotcha
   #136, no `Data3DTexture`) advected upward, with a second tap at another scale and speed and a domain
   warp. Adjacent sheets therefore show parallax-consistent slices of one billow, which reads as volume.
2. **Never crossing.** All sheets of one plume share one yaw (camera-facing about the plume's own
   vertical axis) and are staggered 2–6 m in depth along the view, so they never intersect each other.
   Plumes are placed so their sheet sets do not overlap in world space.
3. **Ground contact.** Fade with height above the analytic ground: `smoothstep(0, 3 m, y − ground(x, z))`
   (the basin heightfield function is available in the shader), so no hard line where a sheet meets
   the apron. No depth texture is needed.
4. **No card edges.** Envelope falloff covers at least the outer 25% of each sheet's half-width and the
   top 30% of its height; the sheet quad is 1.4× the envelope so nothing reaches the quad edge.
5. **Never static.** Billow warp period 9–14 s, rise 1.2–2.5 m/s, two taps at different speeds.
6. **Light** stays as proposed (sun × self-shadow tap toward the sun × Henyey-Greenstein, underlight
   from the ramp colour at the sheet's base × `exp(−h/12 m)`, sky ambient on the shade side), with the
   HG `pow` written as `x·sqrt(x)` on a clamped base (gotcha #94).
7. **Analytic steam veil.** The basin's haze term gains a low, warm-white steam veil whose density follows
   the breath and the plume positions (a few Gaussian bumps). On Low and Minimal it carries most of the
   "steam everywhere" impression, so fewer sheets are needed and the frame never looks like cards.
8. **Acceptance:** three captures 0.5 s apart (`t=40`, `t=40.5`, `t=41`) with `px=0.8&py=0.2` held:
   no sheet edge, no slice line, no intersection seam, no static texture.

#### 3.6.2 Geyser column: a lathe mesh, not billboards

- One open cylinder mesh per eruption slot (Chalice, Consort, Sleeper; spouters reuse a small one),
  front and back faces, sharing the devils' material builder (`irisColumnMaterial`).
- Radius `r(h, t)`: from the closed-form eruption envelope (launch, sustain, fall-back), widening with
  height, with a crown that flares as the water slows near the apex (r ∝ 1/√v), plus noise jitter of
  ±15% so the silhouette is ragged.
- Density: noise in (θ, h − v·t) with streaks, a dense white core (thickness term from view·normal) and
  a translucent rim. Lit like the steam (lit side Steam Pearl, shade side blue-grey); **not emissive**.
- The spray particles form a shell round it; the rain skirt falls from the crown at the fall-back.
- Dormant slots are scaled to zero. Devil mesh sizes from the tier table apply to the column too.

#### 3.6.3 The Stair: CPU-first, heights in a vertex attribute

- Prototype the terrace generator in numpy/PIL before any shader (Stage A0): a slope, a scalloped rim
  distance field, pools filling each tier, dripstone curtain masks on the risers. Compare oblique renders
  with reference photos (§6) side by side. Rejection criteria: terraces read as contour lines, as a
  stepped pyramid, or as rice paddies.
- Ship the generator three-free in `iris-springs-bake.js` with a fixed seed: outputs a heightfield
  (written into the Stair mesh as a vertex attribute, so there is no vertex texture fetch on either
  backend) and an RGBA8 layout texture (rim distance, tier id, arc length along the rim, curtain mask)
  read only in the fragment stage at `.level(0)`. Wrap the same `Uint8Array` in two `DataTexture` views,
  `NearestFilter` for the tier id (a filtered or mipmapped id is garbage) and `LinearFilter` for the rim
  distance and arc length, no mips: the pattern Rainbark uses for its bark atlas.
- 8 tiers on Minimal and Low, 10 elsewhere. Unit tests: tiers strictly descending toward the camera,
  every rim closed, pool depth > 0, arc length monotonic along each rim.

### 3.7 Lock: scour, then bloom (and bleaching under slot pressure)

**Why.** By design the piece colours are the basin's own band colours, so five of the seven pieces sit
right on their "home" band (CIELAB ΔE76, amended palette from §3.13):

| Piece | Cobalt `#0B3A8C` | Turquoise `#14B3C8` | Cream `#EDE6CF` | Lemon `#E9CF2C` | Orange `#EE7420` | Rust `#9C3A1C` | Olive `#5E7F2E` |
|---|---|---|---|---|---|---|---|
| I `#FF9A3C` | 121.6 | 103.3 | 62.7 | 41.2 | **15.7** | 42.9 | 65.2 |
| O `#3A78F0` | 30.8 | 69.4 | 90.2 | 148.4 | 131.1 | 107.1 | 115.3 |
| T `#F5D020` | 144.1 | 107.0 | 69.1 | **6.3** | 53.0 | 75.1 | 59.1 |
| S `#19C2D6` | 74.0 | **5.6** | 49.1 | 101.5 | 112.9 | 99.0 | 64.9 |
| Z `#619945` | 107.1 | 60.1 | 53.6 | 53.6 | 80.9 | 76.1 | **12.4** |
| J `#E2559A` | 65.9 | 92.0 | 74.2 | 111.8 | 74.2 | 55.3 | 99.2 |
| L `#BD3B1A` | 103.2 | 107.8 | 78.5 | 75.0 | 25.3 | **15.5** | 76.6 |

A ΔE ≥ 25 clamp would change the piece's colour exactly where it lands on its home band, which breaks
"the piece's own colour". Instead, the ground under the bloom is changed first, physically:

**The Spill, amended timeline (left side; the Stair version follows the same steps on the riser below
the brimming lip):**

| Time | What happens |
|---|---|
| 0–0.30 s | **Scour.** A hot surge runs out along the nearest finger and scours a strip to bare, wet cream sinter: the strip's height spans the piece's rows (the Rainbark row span), its length grows to 2.5 cell heights on screen. The wet leading edge carries a moving sheen. |
| 0.20–1.70 s | **Bloom.** Streamers in the piece's colour grow downstream **on the cream strip** (every piece is ≥ ΔE 49 from cream), with a thin darker rim line of the same hue. A bubble train and a small steam puff. |
| 1.7 s → life L | **Bleach.** Saturated for 0.13·L, paling to cream by 0.5·L, recolonised by the base mat by L. At rest L = 60 s (so 8 s, 30 s, 60 s, as proposed). |

**Slot pressure.** Both sides share one pool of N bloom slots (§5.8: 8 / 12 / 16 / 24 / 24 / 24). With the
measured total lock rate λ (locks/s, eased over 10 s), `L = clamp(0.9 · N / λ, 6 s, 60 s)`. With N = 24:
L ≈ 21.6 s at 1 lock/s, 10.8 s at 2 locks/s, 7.2 s at 3 locks/s. The whole bleach curve (saturated,
paling, recolonised) is compressed into L, so it is still seen in fast play instead of every bloom being
evicted while still saturated. The slot reused is always the one nearest its end; at the 6 s floor its
remainder fades over 0.4 s.

**Placement and size.**
- The spill front's height **spans the piece's rows** (min row to max row of its occupied cells, mapped to
  screen height), never a single point.
- Minimum on-screen size: 1 cell high × 2 cells long on desktop; 1.5 cells high on phones.
- Phones: the lock lands on the **Iris's near rim below the card**, with the column mapped along the rim
  (column 0 at the rim's left end); it uses the margin slivers only if the layout leaves the near rim
  off-screen.
- Hard drop (the Plunge) keeps its arc of drops and fumarole jet (2–8 m by `distance`), scours and blooms
  1.5× farther; `max()` folding per slot.

### 3.8 Clear: the cleared row's own colours, into a stone record

**Shadow well.** Clone the Rainbark director (`src/themes/rainbark/rainbark-director.js`): each player
slot remembers which piece filled which cell from PIECE_LOCK snapshots, so `sink.clear(...)` carries
`rowCodes` (≤ 4 × 10 piece codes, lowest row first; unknown cells use the garbage code).

**The Seal, amended:** for each cleared row, the new white sinter lip draws itself along its rim (0.4 s);
the pool behind it fills; then, as the lip sets (0.4–1.2 s), a **stripe of 10 segments in the row's
cell colours, left to right along the rim's arc length**, fixes into the riser below it at fossil
saturation (about 0.55 of the piece colour, mixed toward Sinter Cream). Blooms alive in that area also
fix, as proposed. Garbage cells show as Bleached Sinter `#7E776C`.

**Record texture (unlimited session record).** Fossils are not event slots. Keep a CPU-owned RGBA8
`DataTexture` of 16 rows (one per Stair tier, up to 10, plus 6 microterrace rings on the Iris side) × 256
arc-length samples (128 on Minimal), 16 KB (8 KB on Minimal). A clear writes its stripe into the row for that tier and uploads the whole texture
once (r186 `addUpdateRange` falls back to a full upload on the WebGPU path, which is irrelevant at 16 KB).
The terraces' and microterraces' riser shaders read it at `.level(0)`. When a tier's row is full, the new
stripe overwrites the oldest segment band (the stone record wraps, oldest first). The record clears on a
new session only.

Cascades (wave k ≥ 2) extend the fill one tier further per wave, as proposed. Odyssey's synthetic clears
with empty rows use the lowest Stair tiers and Bleached Sinter stripes.

### 3.9 Combo: two gauges, an unloaded Chalice, the release on the breaking lock

**Gauge 1, the count (the Chalice):** one discrete preplay burst per link from ×2, as proposed (links 2–3:
1–4 m; 4–5: 8–15 m with fumaroles chuffing in sympathy; 6+: a sustained column 25 m growing to 60 m).
**No bow on the 6+ column.**

**Gauge 2, the reach (the Iris side):** each link pushes a glossy hot-water front one notch farther out
along the fingers: at chain n ≥ 2 the front sits at notch k = n − 1, reaching `r_k = r_rim · (1 + 0.12·k)`
(cap at k = 8), the wet fingers darken
and deepen as wet rock does, and the underlit steam dome turns more turquoise. Reach = chain length, read
at a glance on the opposite side from the count.

**The eye:** widens 6% per link (cap +40%), plus the level heat of 3% per level capped at **+15%**; the two
add, total cap +50%.

**Release (`combo(0)` after a peak p ≥ 2, delivered on the breaking lock):** the column gives way to the
steam phase, lasting `4 + 2·p` seconds, rising and leaning across the sky band; the fingers' wet fronts
drain back notch by notch over 12 s; the Iris cools. The director infers the break at `flush()` (a slot
with a staged lock, no staged clear and a reported combo > 0 sends `combo(0)` now, and the tracker's later
0 is suppressed); a late clear before the next lock resumes the chain without restarting the steam phase
(the Rainbark director's resume rule, within 0.6 s).

**Idle Chalice:** while a session is live (layout live and a lock in the last 20 s), the Chalice's idle
cycle runs **preplay splashes only**. Full idle eruptions (25 m, 10 s, then a 20 s steam phase) run only in
menus or after 60 s with no events. No idle eruption ever carries a bow. For reproducible captures the
core schedules the first idle eruption after `seek(0)` at t = 170 s, and none earlier.

### 3.10 Four lines, amended

As proposed in §1.5 (surge 0–0.35 s; launch at 0.35 s to 90 m in 0.8 s; four sympathetic spouters near to
far 0.6–3.5 s, 6–10 m each; the apron floods, wetness 0 → 1 over 1.2 s; fall-back as rain at 4 s; steam
phase about 15 s; vivid ≤ 1.25, τ ≥ 0.4 s, no exposure change), with these changes:
- The column is the lathe mesh (§3.6.2) with the spray veil; the bow is the analytic primary only (§3.4).
- **No fogbow** in the steam phase. Instead, the steam phase's broad shadow sweeps across the basin
  (projected along the sun), darkening a band of the wet apron as it passes: a large, slow light change
  that is world-native.
- The apron flood is a moving sheet of water (sheen travelling outward from the Iris at 4 m/s), not a
  global wetness fade, and it drains over 8 s from the outside in.
- If the Consort is live, the double eruption of §3.5.
- The column is never emissive and never above 0.86 after the tone map except tiny glints; under 10% of
  the frame.

### 3.11 T-spin: devils that leave a rosette

As proposed (1/2/3 slender devils off the Iris, turquoise core and apricot hem from the bands they
cross, wandering toward the card's side for 5–7 s, never orbiting the card; turning in place under reduced
motion), plus a **persistent record**: where each devil dissipates, its spinning base scours a **sinter
rosette** into the mats, a 4–6 m spiral of bare cream with a thin darker rim, which the base mat slowly
recolonises over the rest of the level (or 4 minutes in level-less modes). Rosettes live in ≤ 6 slots;
the oldest heals over 4 s when a seventh is needed. Count the rosettes = recent T-spin lines.

### 3.12 Perfect clear, amended: the Sleeper wakes; the living colour is renewed; the stone stays

- **Placement.** The composer places the Sleeper's mound in frame on every preset: 16:9 on the far rim at
  about (0.72, 0.13); 21:9 about (0.88, 0.13); 4:3 about (0.70, 0.13); portrait in the top band at about
  (0.42, 0.05). Always outside the card and HUD rects. Its faint resting wisp foreshadows the moment.
- **The beat** (standalone; PERFECT_CLEAR arrives in a later frame with `rows: []`): a 150 m column (lathe
  mesh) stands above the frame top; its steam phase rolls across the whole sky band in white billows and
  its shadow passes over the basin. **No bow** (§3.4). As the steam thins (about 10 s), the basin is
  **renewed**: every live bloom finishes instantly into recolonised mat, the bands blaze at maximum season
  saturation for 20 s (vivid ≤ 1.25), and the eye's water is at its clearest (ledges visible to the deepest
  step).
- **The stone record stays.** Sinter does not wash away; the fossil stripes and rosettes remain.
- Before the column (0–0.8 s), the world goes still: steam drift and convection ease to ×0.3, so the
  launch reads against calm (the Riverbloom graft "the world goes still and clear before it blooms").
  This is a stillness of motion, not a hush or darkening.

### 3.13 Piece colours, amended (CVD fix)

**The problem, measured** (Machado 2009 simulation at full severity, applied in linear RGB, CIELAB ΔE76;
the same method as the Rainbark spec, and the script printed in PLAYBOOK.md §2.8, which reproduces every
number below):

| Vision | Proposed palette: worst pairs |
|---|---|
| Normal | I/L 37.1, T/Z 42.3 |
| Protanopia | **I/Z 10.8** (ΔL\* 9.4), T/Z 17.3 |
| Deuteranopia | **I/Z 12.8 (ΔL\* 1.7)**, I/T 16.6 |
| Tritanopia | **I/J 14.5**, J/L 23.9 |

Orange I and chlorophyll Z become nearly the same colour for protanopes and deuteranopes. Rainbark's
palette, for comparison, has its worst pair at ΔE 19.4.

**Amended palette** (still 0/7 on `npm run check:palette`; the names stay world-native):

| Shape | Name | Hex | Hue | Guideline band | In band? | CIE L\* |
|---|---|---|---|---|---|---|
| I | Phormidium Orange | `#FF9A3C` | 28.9° | cyan 160–210 | no | 72.7 |
| O | Iris Cobalt (bright) | `#3A78F0` | 219.6° | yellow 32–75 | no | 52.5 |
| T | Sulfur Lemon | `#F5D020` | 49.6° | purple 245–315 | no | 84.3 |
| S | Vent Turquoise | `#19C2D6` | 186.3° | green 90–170 | no | 72.0 |
| Z | Mat Green (the winter mats) | `#619945` | 100.0° | red 320–20 | no | 57.8 |
| J | Streamer Rose | `#E2559A` | 330.6° | blue 200–250 | no | 57.1 |
| L | Calothrix Rust | `#BD3B1A` | 12.1° | orange 20–50 | no | 44.3 |
| GARBAGE | Bleached Sinter | `#7E776C` | — | — | — | 50.3 |
| CLEAN_GARBAGE | Opal | `#CFE3E0` | — | — | — | 88.7 |

| Vision | Amended palette: worst pairs |
|---|---|
| Normal | I/L 37.9, I/T 39.5 |
| Protanopia | I/Z 17.8, Z/L 23.2 |
| Deuteranopia | I/T 17.3, Z/L 17.6 |
| Tritanopia | I/J 22.0, O/Z 22.0 |

Worst pair overall: **ΔE 17.3** (from 10.8). Re-run the simulation if any hex changes, and check the board
under protanopia and deuteranopia filters in a real-game capture. The lightness order is now lemon 84.3,
orange 72.7, turquoise 72.0, green 57.8, rose 57.1, cobalt 52.5, rust 44.3.

Piece-colour config (`src/themes/iris-springs/iris-springs-tetrominos.js`, same shape as Rainbark's):
```js
export const IRIS_SPRINGS_TETROMINOS = {
    version: 2,
    colors: {
        I: '#FF9A3C', O: '#3A78F0', T: '#F5D020', S: '#19C2D6',
        Z: '#619945', J: '#E2559A', L: '#BD3B1A',
        GARBAGE: '#7E776C', CLEAN_GARBAGE: '#CFE3E0',
    },
    renderMode: 'solid',
    effects: {
        premium: true,
        phaser: { gradient: true, highlight: 0.22, shadow: 0.18, rim: true, rimAlpha: 0.45,
                  rimWidthFactor: 0.05, gloss: true, glossAlpha: 0.12 },
    },
    rendererOverrides: {},
};
```
Garbage is matte (no highlight, no gloss) if the renderer allows a per-type override; otherwise leave it
and rely on its low chroma. The constant must be referenced by the theme (the palette gate warns about
dead configs).

**Species names.** The proposal's "Thermus rose-pink streamers": the pink filament streamers of
Yellowstone's alkaline springs (for example Octopus Spring) are usually attributed to *Thermocrinis
ruber*. Use the colour name "Streamer Rose" and keep species names out of in-game copy.

### 3.14 The name (a Stage 0 question for the user)

The art judge: "pleasant, but sounds like a spa or a real town". Ask the user before Stage 0, because the
id, class names, flags, files and music title all follow the name:

| Option | id | For | Against |
|---|---|---|---|
| Iris Springs | `iris-springs` | Two good meanings (rainbow goddess; the eye) | Spa or town; the "rainbow" meaning now points at a bow used once |
| **Thermal Bloom** (recommended) | `thermal-bloom` | Names the grammar (heat → bloom); not a place | Less romantic |
| Sinterbloom | `sinterbloom` | Coined, unique, names the stone and the life | Obscure word |

Avoid "Prismatic Springs": "prism" sits on geode's avoid list, and it names the real spring. If the name
changes, rename every `iris-springs` / `IrisSprings` / `irisSprings` / `IRIS_SPRINGS` identifier in §5 in
one pass before writing code. This document keeps "Iris Springs" throughout for readability.

### 3.15 Composition rules against the neighbours (geode, halcyon-apex, the map look)

- **Not a target:** the eye is off-centre in its own ellipse (the vent sits 10–15% of the pool's width
  toward the far side), the bands are lobed and broken by 30+ fingers, the eye is never on the card's
  vertical axis or the screen centre, and the camera never looks down more than 30°.
- **Not an agate:** the bands are wet, matte-to-glossy living mats with micro-texture, never smooth glossy
  stripes; no band is a perfect constant-width ring.
- **Not halcyon-apex:** the Stair's pools are milky and opaque (no reflection of anything), cream and
  apricot dominate it (turquoise ≤ 35% of its area), the tiers are irregular and follow a natural slope,
  and there is no pyramid, causeway, crystal or sun in frame.
- **Not a map:** a sky band ≥ 10% of the frame on desktop (12% at 16:9); the near Stair rim at 10–15 m is
  cropped by the frame and shows spicules; steam columns, ghost pines, the Chalice and spouters give
  vertical elements at every depth; plume shadows and aerial perspective layer the distance.
- **The template finding** (hero left, secondary right): accepted with a purpose here. The split carries
  cause and effect: the Iris side shows heat (reach, bloom), the Chalice side shows pressure (count,
  eruption). The HUD mirror rule keeps the eye out of the HUD calm zone.

### 3.16 House FX grammar check

The source is the pre-competition research (`docs/theme-concepts/reference/research.md`, §0 "What to
avoid", item 6, "One shared gameplay grammar"): nearly every masterpiece rebuild follows "a locking piece
sends a spark or wisp of its own colour out of the card into X, which keeps that light; a clear fires the
cleared rows out of the card as blades of light and sends a wave, one front per line; a chain of clears
charges or wakes the world; four lines hold its breath" (the wording in geode, lunara, vesper-chrysalis,
halcyon-apex, bioluminescence, fluid-dreams, ice-temple, chiral-gold, cinder-drift, tornado and waves). The
new theme should instead let the world record, deposit, fill or erupt. If `docs/theme-concepts/README.md`
carries a fuller list, check that too. This table checks each pattern, plus Rainbark's list of what is
absent:

| House pattern | Iris Springs (amended) |
|---|---|
| A spark or wisp of the piece's colour leaves the card into a site that keeps that light | Absent. The lock is a surge of water that starts in the world (the Iris, a terrace lip) at the piece's rows. Pigment, not light. |
| A site holds the piece's colour for ~30 s, then a clear releases it | Inverted: the bloom bleaches on the world's own clock; a clear **fixes** it into stone. Nothing is released. Watch the wording and the look: no glow in blooms. |
| Blades of light at the cleared rows; twin jets from both card edges | Not light: a white sinter lip (≤ 1.0 display value, frost sparkle only) draws along a rim on the ground at each row's height, on both sides. Material, horizontal on the ground, not fired from the card. Keep it non-emissive. |
| One wave front per line | Absent. Per line: one lip and one fill, plus one modest steam lift; no travelling front across the frame. |
| Four lines: hush or darkening, then a flare | Absent. No hush, no darkening, no exposure lift; vivid ≤ 1.25. (The perfect clear's 0.8 s motion stillness is not a darkening.) |
| A spiral, wheel, garland or creatures circling the card | Absent. Devils wander the apron and never orbit the card. |
| An hour wheel of palettes | Absent. Seasons are monotonic per level and arrive as a spatial front. The breath is weather. |
| Camera dip or kick on hard drop | Absent. |
| Prism ring or rainbow arc across the sky on four lines | Absent: the one bow lives only inside spray, ≤ 35° of arc. |
| Exposure flash on clears | Absent. |

---

## 4. Overlap with Rainbark

Rainbark (`docs/theme-concepts/rainbark.md`; code in `src/themes/rainbark/`) is colossal painted eucalyptus
trunks in blue air over a mist floor; its events are material (peel on lock, shed on clear, the Great Moult
on four lines), its combo counter is canopy-gap sun pools, and its B2B is a sunshower. A build of Iris
Springs must keep its own identity next to it.

### 4.1 What Rainbark already took from Iris Springs

From Rainbark's graft table ("What is grafted from the runners-up", in `docs/theme-concepts/rainbark.md`):

| Iris idea | How Rainbark uses it | What Iris keeps |
|---|---|---|
| One discrete beat per combo link | Each link opens a canopy gap "with a puff of leaf bits"; the chain is counted in sun pools on the trunks | Iris's count is **water splashes at a geyser** (preplay). Keep it, plus the fingers' reach gauge (§3.9), which Rainbark does not have. Never count with pools or patches of light. |
| Steam underlit by the ground colour | Rainbark's mist top takes a faint tint from the mean bark colour above it | Iris's underlight is the **signature** (turquoise core, apricot hem, strong and spatially varying). Rainbark's is a faint global tint. Keep Iris's strong. |
| Saturation and colour instead of exposure flashes | The Moult's measured mean-luminance lift is capped at +0.25 stop under an iris dip | Iris uses **no exposure lift at all**, only vivid ≤ 1.25. Keep that stricter rule. |

The judges also offered Rainbark other Iris ideas that it did **not** take (the steam-phase release, the
bleach decay, the succession front, steam devils, the drain, `bowAnchor`). They remain Iris's own.

### 4.2 New similarity risks now that Rainbark exists

| Risk | Why it is real | Mitigation in an Iris build |
|---|---|---|
| **Two full-spectrum natural themes in high daylight** | Rainbark took the "high sun / morning daylight" slot the art judge called open, with a full spectrum carried by a natural material | Iris is **ground, horizon and open sky** (Rainbark has no ground and no horizon); its dominant areas are warm mineral (cream, orange, rust) with cobalt and turquoise accents and white steam, against Rainbark's cool slate-blue matrix in blue haze. Make Iris's haze target a warm pearl (for example `#E8E6DE`) rather than blue air, and keep its far rim greener. Compare thumbnails side by side (80 px picker size) before Stage B. |
| **Wetness as the reward** | Rainbark's Sunshower (B2B) and Moult use "wet deepens colour" (albedo ×(1 − 0.2·wet), chroma ×(1 + 0.3·wet)) | Iris's wetness is **flowing water**: a sheet travelling outward from the Iris (four lines) and wet fronts in the fingers (combo reach), never rain and never a global fade. Do not put rain in Iris. |
| **A vapour exhale on combo release** | Rainbark's "Set" includes a vapour roll sliding down the trunks into the mist (grafted from Sunfall) | Iris's release is the **geyser's steam phase**: a white column rising and leaning across the sky band for 4 + 2·peak s. It rises from a vent; it never rolls down a surface. |
| **Counted combo beats** | Both count links | Different objects, sides and media (splashes at the Chalice vs light pools on trunks). Fine as long as Iris never uses light pools. |
| **Persistent T-spin scar** | Rainbark's Unwinding leaves a helical scar with amber beads | Iris's rosette is a scoured spiral in mats on the ground, recolonising; no beads, no helix on a vertical surface. |
| **Session record** | Rainbark's perfect clear (the Floor) reveals the session's shed curls | Iris's record is the stone stripes on the risers, visible all session; its perfect clear does not "reveal the session". Keep the perfect clear about the Sleeper and the renewal. |
| **Registry group** | Both `biomes` | Fine; the group only sorts the picker. |
| **Piece palettes** | Same-shape colours differ strongly except J (Iris `#E2559A` rose vs Rainbark `#D23468` ruby: ΔE 19.2) | Acceptable: the CVD constraints decided J, and six of seven shapes differ by ΔE 61–129. |
| **Steam vs mist floor** | Both have low white vapour | Iris's ground mist is 1–4 m sheets over a visible apron with gust holes; there is no cloud floor and no abyss. |

### 4.3 What an Iris build must not borrow back from Rainbark

No bark, peeling, curls or shed strips; no canopy-gap sun pools or gobo flecks as a mechanic; no mist
floor or abyss; no blue air as the aerial-perspective target; no rain or sunshower; no camera climb on
level up; no "Floor" reveal. If a step drifts toward any of these, stop and re-read §1.5 and §3.

---

## 5. Implementation plan

The house pattern is the "masterpiece rebuild" layout of `src/themes/serenity-warp/`, as cloned by
Rainbark (`src/themes/rainbark/`, commit `585ab55`). Rainbark is the closest working precedent: same three
r186 stack, same director extensions, same rename procedure. Read its files before writing new ones.

### 5.1 Stage 0: slot, rename and scaffold

PLAYBOOK.md §3.1–§3.2 split this into **Stage 0a** (one small commit: `iris-springs-core.js` with the
constants of §5.2, `iris-springs-tetrominos.js` from §3.13, `npm run check:palette` and the CVD script
green; Rainbark's equivalent is `0c747dd`) and **Stage 0b** (scaffold and rename in parallel by disjoint
file owners, then integrate; Rainbark's is `585ab55`). Before either, settle the slot and the name:

1. **Choose the slot** with PLAYBOOK.md §1 "Choosing a slot": which theme Iris Springs replaces (call it
   `OLD_ID`), or whether it is added as a new theme (that changes registry counts pinned by tests, such as
   the 61-entry music catalogue). **Ask the user; never guess.** Decide the name at the same time (§3.14).
   Facts to put in front of the user, from PLAYBOOK §1a's candidates script run at `585ab55` (re-run it,
   the fleet changes):
   - **Subject overlap** (PLAYBOOK criterion 3): `pyrestorm` (orb 4 "Molten Flow", chapter 1 "Earth Core
     & Subterranean Origins", placeholder song, no `world.js` or playground effect, so not yet rebuilt;
     its avoid list is "volcanoes, eruptions", the motif an Iris four-line clear brushes) and
     `luminous-tides` (orb 7 "Sunken Depths", chapter 2 "Deep Ocean & Liquid Worlds", placeholder song,
     not rebuilt; its avoid list names "a geyser of light"). Replacing one of them removes the nearest
     eruption/geyser neighbour from the fleet.
   - **Chapter fit** (criterion 4): a daylight Earth basin fits chapter 1 (geothermal, "Earth Core") or
     chapter 3 "Surface World & Living Landscapes" (not-rebuilt themes there include `misty-lake`,
     orb 11, and `moonlit-greenhouse`, orb 14, both with authored songs). It fits chapters 6 and 7 (space,
     abstraction) worst.
   - **Do not** pick a recent masterpiece rebuild with a world and an effect (halcyon-apex, geode,
     cinder-drift are the closest neighbours but all are rebuilt), and never Forest.
2. **Worked example:** commit `585ab55` replaced Cosmic Chimes with Rainbark. Follow the same list for
   `OLD_ID → iris-springs` (PLAYBOOK §4 is the full ordered checklist): registry entry in place
   (`group: 'biomes'`, add to `HEAVY_GPU_THEME_IDS`);
   `RETIRED_THEME_IDS` gains `['OLD_ID', 'iris-springs']`; the song is retitled (ID3 TIT2 rewritten,
   audio bytes and file length unchanged; track key renamed; `RETIRED_TRACK_KEYS` entry;
   `public/assets/music/songs.json` regenerated with `node generate-songs.js`; tell the user the
   recording is unchanged; a placeholder song is only renamed); the Odyssey orb
   (if any) keeps its slot with new name and copy and a sensible `transitionIn`;
   `src/core/odyssey/theme-presentation.js` key colour (suggest `'#14B3C8'`, Vent Turquoise); ThemesTab
   fallback glyph (suggest `'droplet'`); container `#iris-springs-theme { background: <clear colour>;
   overflow: hidden; }`; captureThemes row; playground parameter catalogue; the phone validator list;
   CREDITS and living docs; a rename migration test cloned from the Rainbark one.
3. **Clear colour:** a mid value that never flashes the 2.5 s container fade white or black, taken from
   the scene: suggest `0x7E97A8` (Far Plateau).
4. **Scaffold:** clone Rainbark's adapter, director, composition, quality and post; a minimal world that
   draws only the sky and satisfies `WORLD_METHODS` from day one; the playground effect. Delete the old
   theme folder and obsolete tests per the checklist. Run the minimal verification list (§5.11) and the
   integrator checklist of PLAYBOOK §3.2 (a known-good control capture, playground shots of every event
   code path on both backends, the real game, a clean switch-away, the phone validator) before Stage A.

### 5.2 Files (`src/themes/iris-springs/`)

| File | Role |
|---|---|
| `iris-springs-core.js` | Three-free: world plan in metres (Iris, Chalice, Stair, Sleeper, Consort, pines, plumes); `SEASONS`, `RAMP_STOPS` (temperature → colour, 6 rows); piece codes; `TIMING`; `EVENT_ROWS`; `chaliceSchedule(t)` (closed-form idle cycle; first idle eruption at t = 170 s); eruption, preplay and steam-phase envelopes; `breathAt(t)` (71/97/133 s sines); `gustAt(t)`; `bowAngles`; `solveSun(layout, aspect)` (§3.2 ranges); `rowToTier(...)`; `bloomLife(N, λ)` (§3.7); `fingerReach(k)`; `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`. |
| `iris-springs-bake.js` | Three-free typed-array bakes, deterministic by seed: `bakeFbm` (+ CPU mips), `bakeCellular` (mat micro-texture), `bakeRidgedFlow`, `bakeLattice` (for `noise3`), `bakeRamp` (256×6), `bakeCrest` (far rim, two layers), `bakeStair` (heights for the vertex attribute + RGBA8 layout texture), `bakeBasinHeights` (fan mesh heights: dome, microterrace steps, incisions). |
| `iris-springs-tsl.js` | `createIrisUniforms` (`u`, `events`, counts); `DataTexture` wrappers; laid-out pure helpers (`irisHash21`, `irisHash31`, `irisSchlick` (products), `irisHg` (products, clamped), `irisBowColour`, `irisFilmic`, `irisRoundBoxSdf`, `irisDecodeCode`); inline builders that read `u` and textures (`skyColour`, `thermoRamp`, `steamDensity`, `steamLight`, `underlight`, `haze`, `steamVeil`, `wetness`). `export *` from core. |
| `iris-springs-sky.js` | Backdrop triangle at the far plane: sky, cirrus, far rim, plateau, haze. |
| `iris-springs-basin.js` | Fan mesh: the Iris's water (bowl, ledges, fake refraction, Beer, boil domes), apron, fingers, microterraces, jewel pools, steam shadows, blooms, scours, rosettes, the fingers' reach, record stripes on the microterraces. |
| `iris-springs-terraces.js` | The Stair: mesh with baked heights, pools lit from within, rims, curtains, overflow, fills, seals, record stripes. |
| `iris-springs-steam.js` | Plume sheets (volume slices), ground mist, steam phases, devils. |
| `iris-springs-geyser.js` | Cones (Chalice, Consort, Sleeper), column lathe meshes, spray veils, spray/rain particle pool, spouters, fumarole jets. |
| `iris-springs-flora.js` | Ghost pines (instanced cards, socks, frost or snow by season). |
| `iris-springs-fx.js` | Event-slot writers: blooms, fills/seals, boils, puffs, jets, eruptions, devils, rosettes, the record texture writer. |
| `iris-springs-world.js` | `IrisSpringsWorld` with every `WORLD_METHODS` method (`build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`) plus `onB2B(level)`, `onGameOver()`, `onSessionStart()`; camera rig; timed queue; slot rings; season front; breath; writes `u`. Exports `REST_RIG`, `fovForAspect`, `IRIS_SPRINGS_PARTS = ['sky', 'basin', 'terraces', 'steam', 'geyser', 'flora', 'fx']`. |
| `iris-springs-director.js` | Clone of `rainbark-director.js`: try/finally delivery, `broke` flag, `shape`/`cells`, shadow well with `rowCodes`, combo-break inference on the breaking lock, B2B live level with break inference, the multiplayer pending-COMBO stash, hard-drop `distance`. Rename identifiers only. |
| `iris-springs-composition.js` | Cloned readers (with `'#online-main-board canvas'`) plus presets: desktop, 21:9, portrait (aspect < 0.62), HUD mirroring; anchors for the eye, Chalice, Stair, Sleeper, Consort; the near-rim lock line for phones; `bowAnchor` input to `solveSun`. |
| `iris-springs-post.js` | `IrisSpringsPost` (`RenderPipeline`), knee bloom (threshold ≈ 1.6), one output pass (shimmer, calm zones, bloom, exposure, mineral filmic, grade, vivid, vignette, sRGB, grain, dither), FXAA on Medium/High, MSAA 4× on Ultra/Extreme, `POST_LOOK`, `createPassThroughPipeline`, `falseColor`. |
| `iris-springs-quality.js` | `QUALITY` (§5.8), `QUALITY_NAMES`, `tierFor`. |
| `iris-springs-theme.js` | Clone of `rainbark-theme.js`: ids, flags (`irisSpringsTime`, `irisSpringsFixedDt`, `irisSpringsParts`, `irisSpringsFalseColor`, `irisSpringsForceWebGL`), renderer with WebGL2 fallback and GPU-loss handling, layout reads on frame time, calm zones, settings. Sink: `lock`, `clear`, `combo` → max over players, `levelUp`, `b2b` → `world.onB2B` (max over players); window `gameOver` and `modeStopped` → `world.onGameOver(); resetSession()`; `modeStarted` → `world.onSessionStart()` (the Chalice refills). |
| `iris-springs-tetrominos.js` | §3.13. |
| `iris-springs-theme-icon.png` | 512² 8-bit RGBA, circular. **The eye and its underlit steam dome**, a sliver of bands and fingers, a white plume; **no bow**. Mirror to `public/assets/themes/iris-springs-theme-icon.png`. |
| `src/playground/effects/iris-springs.effect.js` | Mounts the same world and post (`capture: true`), events through a real director, imports only `three/webgpu` plus its own theme modules. |

URL catalogue row (`src/ui/url-parameters/theme-parameters.js`, `captureThemes`):
`['iris-springs', 'irisSprings', 'Iris Springs', 'sky, basin, terraces, steam, geyser, flora, fx']`.

### 5.3 Director and sink contract

```
sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, rowCodes, screen })
sink.combo(n, player)        // true combo; 0 = broke, inferred on the breaking lock; idempotent vs the tracker's late 0
sink.b2b(level, player)      // 0..3; 0 inferred from a non-difficult wave-1 clear (no producer sends active:false)
sink.levelUp(level)
```
Event facts to respect (from the event bus survey): subscribe only to `PIECE_LOCK, HARD_DROP, LINE_CLEAR,
COMBO, TSPIN, B2B, PERFECT_CLEAR, LEVEL_UP`; the bus `COMBO.comboCount` is cascade depth, not the true
combo (ADR-0011); the HARD_DROP `piece` is pooled (copy synchronously); visible row = board row − 4; Infinity
uses `viewportOrigin` and has no LEVEL_UP; local multiplayer (players 1–4) has no TSPIN/B2B/LEVEL_UP/PERFECT_CLEAR
and no cascade count on LINE_CLEAR; online multiplayer (the local player only, slot 0) has no
TSPIN/B2B/LEVEL_UP and no cascade count but does send PERFECT_CLEAR (`source: 'online'`), so the Sleeper can
wake there; meditation (`serenity` mode) has no locks and no board, only LINE_CLEAR/COMBO clicks with a
`position`; Odyssey adds synthetic victory-lap and goal-flourish clears with empty rows (PLAYBOOK §2.3 has
the full table); PERFECT_CLEAR arrives in a later frame with no rows; game over is the window `gameOver` event
(single player and Infinity) or GameModeManager `modeStopped`. Settings: `pieceLockRipple` off → no Spill or
Plunge; `backgroundComboEffects` off → no event reactions, the ambient world continues.

### 5.4 The event table (`u.events`, one vec4 `uniformArray`, live rows compacted, counts in int uniforms)

A suggested layout (adjust, but keep one array and ≤ 128 rows):

| Block | Slots × rows | Rows | Contents |
|---|---|---|---|
| Blooms (+ scour) | 24 × 2 | 48 | side, screen-mapped start, direction, row span; colour, birth time, life L, hard-drop scale |
| Fills / seals | 8 × 1 | 8 | tier id, side, birth time, cascade depth |
| Jets, puffs, bubble trains | 8 × 1 | 8 | position, height, birth time, kind |
| Eruptions | 8 × 2 | 16 | vent id (Chalice, Consort, Sleeper, spouters ×4, preplay), envelope params, birth time, peak height |
| Boil domes | 4 × 1 | 4 | eye position, radius, birth time |
| Devils | 3 × 2 | 6 | path seed, birth, life, twist; base colour |
| Rosettes | 6 × 1 | 6 | position, radius, birth, heal |
| Plume ellipses (ground shadows) | 14 × 1 | 14 | centre xz, radii, density |
| Globals | — | 4 | heat, reach notch, wetness flood radius, season front radius and rows, breath, gust phase, vivid |
| **Total** | | **114** | |

The record texture (§3.8) and the season ramp (256×6) are textures, not uniform rows. Only these two
`uniformArray`s at most (events, plus an optional small palette array) per stage (gotcha #102).

### 5.5 Playground parameters

Every parameter must be catalogued in `src/ui/url-parameters/playground-parameters.js` with `scope` naming
`iris-springs` and `sources` naming the effect file; the URL-parameter catalogue test fails on any literal
`params.get('x')` that is not catalogued.

| Param | Meaning |
|---|---|
| `t` | Fixed time (phase-locked; `seek(t)` every frame) |
| `quality` | Minimal…Extreme; default High |
| `level` | 1–12; default 1 (season = (level − 1) mod 6) |
| `season` | 0–5, overrides the level's season |
| `heat` | 0–1, holds the combo heat (eye width, steam underlight) |
| `breath` | 0–1, holds the breath (steam density and wind) |
| `gust` | 0–1, holds a gust tear at that phase of its crossing |
| `board`, `statsHud` | Mock board with the real selectors (calm zones and aims exercised) |
| `locks=<n>` | Pre-play n locks (alternating sides and pieces) |
| `record=<n>` | Pre-fill n fossil stripes (random row colours from the palette) |
| `event` | `lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`, `levelUp`, `release`, `b2b`, `gameOver` |
| `eventAge` | Seconds after the event; default 0.4 |
| `eventLevel` | Default level + 1 |
| `lines` | 1–4; default 2 |
| `row`, `u` | Default 9 and 0.3 |
| `piece`, `turns`, `color` | Piece shape, quarter turns, colour override |
| `dist` | Hard-drop distance; default 14 |
| `cascade` | Waves for `clear`; default 1 |
| `combo=<n>` | Hold a chain |
| `peak=<n>` | For `release`; default 6 |
| `b2b=<0–3>` | Hold the Consort's level |
| `reduce`, `parts`, `noPost`, `falseColor`, `bloom` | Reduced motion, part filter, post off, false colour, bloom override |
| `px`, `py` | Hold the pointer |
| `icon`, `iconFov`, `iconYaw`, `iconPitch` | Icon frame |
| `demo` | 40 s loop of locks, clears, chains, four lines, T-spin and B2B |

### 5.6 Staged build order with acceptance shots

Each step is **one small effect per session** (CLAUDE.md). Each ends with playground screenshots (wait for
`window.__PLAYGROUND_READY__ === true`, then a few animation frames or `window.__PLAYGROUND__.seek(t)`), a
clean console (no WGSL, GLSL or validation errors), `window.__PLAYGROUND__.diagnostics()` read back, and
one Low-tier capture. In a cloud container use the headless Chromium + SwiftShader tooling described in
PLAYBOOK.md §5 (`shot.mjs`, `game.mjs`, `switch-away.mjs`; it includes the harness-only
`GPUTexture.createView` swizzle shim that Chromium 141 needs with three r186). Look at every PNG: a clean
console is not proof it looks right.

Every Stage A step runs PLAYBOOK §3.3's loop: build → acceptance shots plus a **similarity montage** →
an independent critic with a fresh context → fix → repeat until the critic passes it. Montage the rest
frame against `docs/theme-screenshots/<id>.png` of the neighbours each step is most at risk of
resembling: A1 geode and cinder-drift (bands round a centre; geothermal), A2 halcyon-apex (turquoise
terraces), A3 nimbus-veil and sky-children (white vapour masses) plus Rainbark's mist, A4 pyrestorm and
luminous-tides (eruptions; "a geyser of light") and parhelion (daylight optics), A5 the full rest frame
against Rainbark at the 80 px picker size (§4.2). Every Stage B beat captures an age sequence
(`eventAge=0.25, 0.75, 1.8, 4` or the beat's own times below), as PLAYBOOK §3.4 asks.

All queries below follow `/playground.html?`. Viewports: **D** = 1920×1080, **W** = 2560×1080,
**P** = 390×844 (DPR 1), **Q** = 1440×1080 (4:3). ★ = capture on both backends (add `&forceWebGL=1`).

**Stage A: environment**

| Step | Work | Acceptance shots |
|---|---|---|
| **A0** | **CPU lab, no shader** (numpy/PIL, in the session's scratchpad, never committed): the temperature field T(p) (elliptic distance, domain warp, lobes, log-polar fingers), the ramp, band internal variation, mat micro-texture, rendered top-down and in the §1.2 oblique view; the Stair generator (§3.6.3). Compare side by side with reference photos (§6). Write down the parameters that passed. | Montage of render vs reference. Pass only if the basin does not read as a target, an agate, topographic contour lines (the failure Rainbark's lab found with thresholded fBm contours) or a map; and the Stair does not read as contour lines, a pyramid or rice paddies. |
| **A1** | Sky + basin (static): fan mesh, temperature field, ramp, fingers, micro-texture, the Iris's water (ledges, fake refraction, Beer, boil domes), wetness, light (§3.2), haze. | ★ `effect=iris-springs&t=40&parts=sky,basin` @D · `effect=iris-springs&t=40&parts=sky,basin&season=3` @D · `effect=iris-springs&t=40&parts=sky,basin` @P · `effect=iris-springs&t=40&parts=sky,basin&falseColor=1` @D. Hero checklist §5.7 items 1–9. |
| **A2** | The Stair: baked heights (vertex attribute), layout texture, pools lit from within, rims, curtains, overflow, AO, stains. | ★ `effect=iris-springs&t=40&parts=sky,basin,terraces` @D · same @W · `…&quality=Minimal` @D. Turquoise ≤ 35% of the Stair's area; no mirror; tiers irregular. |
| **A3** | Steam: plume sheets as volume slices, underlight, self-shadow, ground mist, steam shadows on the ground, gust tears, the analytic veil. | ★ `effect=iris-springs&t=40&parts=sky,basin,terraces,steam` @D · `effect=iris-springs&t=40&px=0.8&py=0.2` and `t=40.5`, `t=41` @D (no slices or seams) · `effect=iris-springs&t=40&gust=0.5` @D (the eye revealed) · `effect=iris-springs&t=40&breath=1` and `breath=0` @D · `effect=iris-springs&t=40&falseColor=1` @D. Contrast targets §3.3 met on the tone-mapped frame. |
| **A4** | Geyser and flora: cones, column lathe mesh, spray veil, particle pool, spouters, fumaroles, the Chalice's idle cycle; ghost pines; jewel pools; bubble trains. | ★ `effect=iris-springs&t=40` @D (full rest) · `effect=iris-springs&t=176` @D (the idle eruption at its peak, menu state) · `effect=iris-springs&t=40&quality=Low&forceWebGL=1` @P. |
| **A5** | Seasons, breath, composition presets, HUD mirror, the sun solver, Sleeper and Consort placement (dormant), camera breath and parallax. | ★ `effect=iris-springs&t=40&board=1` @D, @W, @Q, @P · `effect=iris-springs&t=40&level=2` … `level=6` @D · `effect=iris-springs&t=40&board=1&reduce=1` @D. Unit tests pin: the eye never under card or HUD rects at aspects 0.46, 1.0, 1.33, 1.78 and 2.37; the Sleeper and Consort in frame on every preset; `solveSun` inside its ranges. |

**Stage B: gameplay FX**

| Step | Work | Acceptance shots (all after `effect=iris-springs&t=40&board=1&`) |
|---|---|---|
| **B1** | Spill and Plunge: scour, bloom on cream, row span, wet sheen, bubble train, puff; bleach with slot pressure; hard-drop arc and jet; director wiring. | ★ `event=lock&piece=L&u=0.15&row=12&eventAge=0.25` @D (scour) · `event=lock&piece=L&u=0.15&row=12&eventAge=1.5` @D (bloom grown) · `event=lock&piece=S&u=0.85&row=8&eventAge=1.5` @D (right side, turquoise on cream) · `event=lock&piece=T&u=0.2&row=15&eventAge=20` @D (bleaching at rest, L = 60 s) · `locks=12&event=lock&piece=T&u=0.2&row=15&eventAge=6` @D (compressed bleach under slot pressure) · `event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.25` @D (jet) · ★ `event=lock&piece=T&u=0.2&row=10&eventAge=1.2` @P (near-rim lock legible). |
| **B2** | Seal: lips along rims, fills, chained cascade, row-colour stripes from the shadow well, the record texture. | ★ `locks=10&event=clear&lines=3&row=16&eventAge=0.5` @D (lips drawing) · `locks=10&event=clear&lines=3&row=16&eventAge=1.6` @D (fills chaining) · `locks=10&event=clear&lines=2&row=17&eventAge=4` @D (stripes in the rows' colours) · `event=clear&lines=1&row=18&cascade=3&eventAge=2` @D · `record=40` @D (a session's record). |
| **B3** | Combo: preplay bursts, finger reach, eye heat, sustained column (no bow); release steam phase; break inference in the director. | ★ `combo=4` @D (chain of 4: reach notch 3, splash cadence) · `combo=7` @D (sustained column, no bow) · `event=release&peak=6&eventAge=2` @D (steam phase rising) · `event=release&peak=6&eventAge=10` @D (fingers draining). Director tests: break on the breaking lock, resume rule. |
| **B4** | Four lines: surge dome, launch, column, spray veil, analytic primary bow, spouters near to far, the apron flood sheet, fall-back rain, steam phase with its shadow sweep. | ★ `event=quad&row=16&eventAge=0.2` @D (dome) · ★ `event=quad&row=16&eventAge=1.4` @D (column and bow) · `event=quad&row=16&eventAge=3` @D (spouters, apron flooding) · `event=quad&row=16&eventAge=9` @D (steam phase shadow) · `event=quad&row=16&eventAge=1.4` @P · `event=quad&row=16&eventAge=1.4&falseColor=1` @D (only spray glints and the bow core above the knee). |
| **B5** | T-spin devils and rosettes; B2B Consort and the double eruption; perfect clear (Sleeper, renewal); level up (succession front); game over (drain) and restart (refill); idle rules; meditation; multiplayer. | `event=tspin&lines=2&u=0.2&row=13&eventAge=3` @D (two devils) · `event=tspin&lines=2&u=0.2&row=13&eventAge=9` @D (rosettes) · `b2b=2` @D (Consort standing) · ★ `b2b=1&event=quad&row=16&eventAge=1.6` @D (double eruption) · ★ `event=perfect&eventAge=2.5` @D (the Sleeper's column) · `event=perfect&eventAge=13` @D (renewed basin, stone record kept: add `record=30`) · `event=levelUp&eventLevel=3&eventAge=3` @D (front mid-sweep) · `event=gameOver&eventAge=4` @D (drained Chalice) · `reduce=1&event=tspin&lines=1&eventAge=3` @D. |

**Stage C: post, tiers, phone, icon, docs**

| Step | Work | Acceptance |
|---|---|---|
| **C1** | Post: shimmer ellipses, calm zones with `board=1`, knee bloom, mineral filmic, grade, vivid, FXAA/MSAA, false colour. | ★ `effect=iris-springs&t=40&board=1` @D (board readable, steam faded over the card) · `effect=iris-springs&t=40&falseColor=1` @D. |
| **C2** | Quality tiers (§5.8); Minimal and Low captures; the WebGL2 leg on every starred event shot. | `effect=iris-springs&t=40&board=1&quality=Minimal` @D · ★ `effect=iris-springs&t=40&board=1&quality=Low&forceWebGL=1&event=clear&lines=2&row=17&eventAge=0.8` @P. Measure Low on the phone viewport with `profile=1&trackTimestamp=1`. |
| **C3** | Portrait, 21:9 and 4:3 passes: aims, near-rim locks, Consort and Sleeper placement, bow solver. | ★ `effect=iris-springs&t=40&board=1&event=quad&row=16&eventAge=1.4` @W, @Q, @P. |
| **C4** | Icon frame; the theme end to end in the real game on both backends; switching away leaves no canvas; the phone validator at Low and Minimal; tests; docs (`docs/IRIS_SPRINGS_VISUAL_OVERHAUL_<yyyy-mm>.md` after the precedent `docs/SERENITY_WARP_VISUAL_OVERHAUL_2026-10.md`, small webp captures in `docs/iris-springs-captures/`, a `docs/ARCHITECTURE_INDEX.md` row, and any new gotcha rows in **both** `.claude/skills/webgpu-threejs-tsl/SKILL.md` and `.agents/skills/webgpu-threejs-tsl/SKILL.md`, kept byte-identical). Then PLAYBOOK §3.6's final adversarial review. | Icon: `effect=iris-springs&t=40&icon=1&iconFov=30&iconYaw=-34&iconPitch=-8&gust=0.5` (square 512×512; the eye and its underlit dome on the lower-third intersection, a white plume, no bow). Real-game and phone runs as in PLAYBOOK.md. |

### 5.7 Art checklist for the hero (the Iris and the basin ground)

Accept A0 and A1 only when every item holds, judged against reference photos side by side:

1. **Lobed, not concentric.** Each band boundary has 3–9 lobes round the ring, amplitude 0.2–0.35 of the
   band's width, and the lobes differ between bands.
2. **Fingers.** 30–60 braided, branching, tapering channels round the visible rim, longest on the downhill
   (near) side; each has a darker wet core and a lighter, drier margin; they widen downstream.
3. **The eye.** Cobalt deepening to near-ink at the centre; white sinter ledges visible through clear
   water with convection wobble; a thin turquoise shelf with a crisp inner edge; a bright wet cream rim.
4. **Band proportions.** Lemon thin (about 0.5× the orange's width), orange widest, rust medium, olive as
   the cool fringe; dry bleached sinter beyond.
5. **No flat colour inside a band.** A soft gradient across each band (warmer toward the hot side) and
   low-amplitude value noise; adjacent bands differ in value as much as hue.
6. **Micro-texture.** Wrinkled, blistered, bubbly mats and small conical tufts at 1–5 m scale; anisotropic
   along the flow inside fingers; fading by pixel footprint into the band's mean colour at distance (the
   `fwidth` mean-blend graft from Painted Ages), so nothing shimmers under the camera breath.
7. **Wet vs dry.** Glossy where water runs (fingers, rim, flooded apron), matte elsewhere; wet is darker
   and more saturated.
8. **Value structure.** The eye is the darkest large shape; the cream rim is the brightest ring; plume
   shadows read as cool, soft-edged patches.
9. **False colour.** Nothing in the basin above the bloom knee except glints.
10. **All six seasons read** (`season=0…5`), and the succession front looks like growth, not a wipe.
11. **Seen whole, it reads as "a hot spring from an overlook"**, not as an eye, a target, an agate, a map
    or a planet.

### 5.8 Quality tiers (amended)

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Basin fan (rings × spokes) | 48×64 | 64×96 | 96×144 | 128×192 | 160×256 | 200×320 |
| Stair bake (layout texture; heights per vertex) | 256², 8 tiers | 256², 8 tiers | 384² | 512² | 512² | 768² |
| Steam plumes × sheets | 4×2 | 6×2 | 8×3 | 10×4 | 12×5 | 14×6 |
| Steam screen-coverage cap | 0.8× | 1.0× | 1.3× | 1.6× | 1.6× | 1.8× |
| Plume shadow ellipses (basin Loop) | 4 | 6 | 8 | 10 | 12 | 14 |
| Analytic steam veil | on | on | on | on | on | on |
| Ground-mist sheets | 0 | 1 | 2 | 3 | 4 | 4 |
| Spray particles | 400 | 700 | 1400 | 2400 | 3600 | 5000 |
| Spray veil + column lathe mesh (θ × h) | 12×8 | 16×10 | 20×12 | 24×16 | 28×18 | 32×20 |
| Lock-bloom slots (one pool, both sides) | 8 | 12 | 16 | 24 | 24 | 24 |
| Record texture (rows × samples) | 16×128 | 16×256 | 16×256 | 16×256 | 16×256 | 16×256 |
| Rosette slots | 3 | 4 | 6 | 6 | 6 | 6 |
| Ghost pines | 24 | 40 | 72 | 110 | 150 | 200 |
| Devil mesh | 12×8 | 16×10 | 20×12 | 24×16 | 28×18 | 32×20 |
| Mat micro-texture octaves | 1 | 1 | 2 | 2 | 3 | 3 |
| Steam second tap (`noise3` detail) | off | off | on | on | on | on |
| Shimmer | off | off | on | on | on | on |
| Anticrepuscular lanes | off | off | off | off | on | on |
| Bloom (resolution) | off | off | 0.33 | 0.45 | 0.5 | 0.5 |
| AA | none | none | FXAA | FXAA | MSAA 4× | MSAA 4× |
| Pixel-ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |

Every tier keeps the whole picture and every event (the bow, devils, the Consort, the Sleeper, rosettes
and the record included). Drop octaves and taps as whole terms in JavaScript, never by substituting 0.5
(gotcha #135). GPU cost targets stay those of §1.7 until measured (ADR-0016). Scope cuts if over budget,
in order: anticrepuscular lanes, then ghost-pine count, then plume count on Medium, then ground-mist
sheets. Never cut: scour and bloom, seal with row stripes, preplay and reach, the eruption with its one
bow, devils and rosettes, the Consort, the Sleeper, the succession front, the drain.

### 5.9 TSL and WebGL2/WebGPU guards that matter for this concept

Gotcha numbers refer to the table in `.claude/skills/webgpu-threejs-tsl/SKILL.md` (numbered by line at
commit `5d3478d`; search the symptom text if the lines have moved). The `webgpu-threejs-tsl` skill
auto-loads on this work.

| Guard | Where it bites in Iris Springs |
|---|---|
| **#89** nested `select` round `Fn` calls fails on the WebGL2 backend only (`addToStack`) | The ramp row choice under the succession front, the bow band choice, wet/dry and side selection in blooms. Fold into one `select(a.and(b), v, f)` with `v.toVar()` built inside a laid-out helper. |
| **#71** an unbounded `exp` turns a region black, often only on tall portrait screens | Beer transmittance `exp(−σ·ρ·L)`, underlight `exp(−h/12 m)`, steam-shadow Beer in the basin Loop, the bloom life curves. Bound every argument (`exp(max(x, 0).mul(−k))`); capture portrait early. |
| **#94** NaN from `pow` of a base a hair below zero spreads through the bloom chain | Schlick Fresnel on the water and wet mats, Henyey-Greenstein phase (`pow(1 + g² − 2g·cosθ, 1.5)` → `x·sqrt(x)` with x clamped ≥ 1e-4), the bow's `acos` (clamp the cosine). |
| **#102** more than 12 uniform buffers per stage fail WebGPU validation | One `vec4` event array (§5.4), at most one small palette array; everything else plain uniforms or textures. |
| **#110 / #155** loop over live rows; named loops hand their index under that name | Blooms, fills, plumes, devils, rosettes Loops: distinct names (`bl`, `fi`, `pl`, `dv`, `ro`), read the index by that name. |
| **#99** more than 8 vertex buffers fail on WebGPU | Spray particle pool and ghost pines: one `InstancedInterleavedBuffer` each. |
| **#87 / #88** interpolated instance attributes carry last-bit noise | Integer seeds and vent codes read with `floor(x + 0.5)`. |
| **#136** and the container's 3D-texture failure | Steam `noise3` via the 2D-lattice trick; never `Data3DTexture` or `lut3D`. |
| **#93 / #95** laid-out helpers must not capture textures or uniforms | Keep `irisBowColour`, `irisHg`, `irisSchlick`, `irisFilmic` pure; pass values in. The ramp, record and layout textures are read in inline builders. |
| **#68** a branch reads zeros from shared nodes | Root-pin (`.toVar()`) the temperature, wetness and steam density before any `If`. |
| `.level()` inside `If` and `Loop` | Every texture read inside an event Loop or branch (record texture, ramp, layout texture, fBm). |
| **#104 / #116** baked fBm at mip 0 with large gain is serrated; narrow `smoothstep` on noise is confetti | Steam density thresholds and band edges: wide ramps, `.level(2.0)` for large-gain reads. |
| **#143** palette change on banded surfaces | Season rows in the 256×6 ramp texture; the front picks a row per pixel. |
| **#69** equal-edge `smoothstep` is a hard WGSL error | Band edges built from data (season rows, slot widths) must never produce equal edges; add an epsilon. |
| **#135** dropping octaves by substituting 0.5 | Tiers drop terms in JavaScript. |
| **#147 / #120** sub-pixel particles become blobs on phones; additive light must be budgeted | Spray particles floored at one buffer pixel and dimmed below that; total spray light capped per tier. |
| **#90 / #117** premultiplied blending; a part captured alone is black | Steam and spray write premultiplied colour; capture additive parts with an opaque part (`parts=sky,basin,…`). |
| **#100 / #129** backdrop last among opaque; transparent quads picking up depth haze | Sky backdrop renderOrder after the solids with `LessEqual` depth test and no depth write; steam ordered in fixed renderOrder bands. |
| **#105** MSAA extrapolates varyings on thin strips | Clamp interpolated coordinates in the devils, columns and veils on the MSAA tiers. |
| **#122** polynomial S-curves outside 0..1 | Clamp before the mineral filmic shoulder's contrast curve. |
| **#96** pipeline count | Target about 12–14 pipelines: sky, basin, terraces, steam, mist, columns/devils/veils (one material), spray, cones, pines; every pool always drawn with dormant zero-size slots so the first frame compiles them all. |
| **#144** effects behind the card are never seen | All aims step outward past the card and HUD rects. |
| Gate on renderer kind, not backend (ADR-0019) | The world and post build identically for the WebGPU and WebGL2 backends. |

### 5.10 Tests (clone Rainbark's, then add)

| Test file | What it covers |
|---|---|
| `tests/unit/iris-springs-core.test.js` | Palette gate 0/7 with the script's hue maths; CVD worst pair ≥ 17 (Machado 2009, ΔE76); ramp stops; `chaliceSchedule` deterministic and quiet before t = 170 s; `breathAt` bounds; `solveSun` stays in range and crosses the column for 16:9, 21:9, 4:3 and 0.46; `bloomLife` monotonic in λ; `fingerReach` capped; `rowToTier`. |
| `tests/unit/iris-springs-bake.test.js` | Stair: tiers descending, rims closed, pool depth > 0, arc length monotonic; fBm tiles seamlessly; mips present; ramp has 6 rows. |
| `tests/unit/iris-springs-director.test.js` | Shadow-well `rowCodes`; combo break on the breaking lock; resume rule; B2B level and break inference; multiplayer COMBO stash; empty-row fallback; settings resets. |
| `tests/unit/iris-springs-composition.test.js` | The eye, Sleeper and Consort outside card and HUD rects at aspects 0.46, 1.0, 1.33, 1.78, 2.37; HUD mirroring; phone near-rim lock line. |
| `tests/unit/iris-springs-world.test.js` | `WORLD_METHODS`; dormant pools; `seek` determinism; reduced motion; the record texture wraps oldest first. |
| `tests/unit/iris-springs-theme.test.js` | Node graphs built for all six tiers with `forceWebGL: true` and no GPU; banned-API greps (no `ShaderMaterial`, `WebGLRenderer`, `mx_*`, `from 'three'`, absolute asset paths); flag literals; registry triple (`heavy-gpu`, `heavy`, not startup-eligible); icon exists. |
| `tests/unit/iris-springs-playground.test.js` | The effect's parameters equal the catalogue entries. |
| `tests/unit/iris-springs-shaders.test.js` | Each part built with `WGSLNodeBuilder` and `GLSLNodeBuilder` at High and Minimal: no warnings, each stage < 48 KB, no equal-edge `smoothstep`, no `mx_`, laid-out helpers emitted once (copy the inline helper from `tests/unit/himalayan-peak-shaders.test.js`). |
| `tests/unit/iris-springs-rename-migration.test.js` | For `OLD_ID` (clone the Rainbark rename test). |

### 5.11 Verification commands

PLAYBOOK.md §6 is authoritative (it also lists the baselines to compare against). Minimal (every
commit), PLAYBOOK §6.1 with this concept's id:
```
npm run typecheck
npx vitest run tests/unit/iris-springs- tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/theme-music-catalog.test.js tests/unit/odyssey-unique-themes.test.js \
  tests/unit/url-parameter-catalog.test.js tests/unit/dual-state-theme-tripwire.test.js \
  tests/unit/mobile-webgl2-validation.test.js tests/unit/odyssey-save-migration.test.js \
  tests/unit/theme-music-preferences.test.js tests/unit/theme-collection.test.js \
  tests/unit/development-collection-access.test.js tests/unit/theme-container-registry.test.js \
  tests/unit/theme-capture-orchestrator.test.js tests/unit/murmuration-rename-migration.test.js \
  tests/unit/rainbark-rename-migration.test.js \
  tests/unit/odyssey-difficulty-balance.test.js tests/unit/theme-lifecycle-audit.test.js
npm run audit:theme-lifecycle && npm run check:palette && npm run check:boundaries
node scripts/architecture-fitness-check.mjs
npx eslint src/themes/iris-springs src/playground/effects/iris-springs.effect.js --ext .js
```
(`git add` new files before trusting the dual-state tripwire: it scans tracked files only. Adding any net
line to `src/main.js` or `src/core/game-modes/OdysseyMode.js` fails the architecture-fitness ceilings.)

Full (before a merge): `npm test`, `npm run lint:ci`, `node scripts/ts-ratchet-check.mjs`,
`npm run perf:budgets:gate`, `npm run check:release-gates`, `npm run build`, `npm run check:ip-strings`,
`npm run check:pages-artifact`, plus the visual proof: playground shots on both backends, the real game on
both backends, and `npm run validate:mobile:webgl2 -- --theme iris-springs` at Low and then
`--quality Minimal` (PLAYBOOK.md has the port workaround needed when a dev server already holds 5173).

### 5.12 Prototype the hero on the CPU first (the Rainbark lesson)

Rainbark's spec described its bark atlas as an anisotropic Voronoi mosaic. Prototyped on the CPU before any
shader, that recipe **read as stained glass** and was rejected; thresholded fBm contours read as
topographic rainbow outlines and were rejected too; a third model ("ribbon splats" over a cool matrix)
passed. The details are in `docs/theme-concepts/rainbark.md` §10 ("Art direction lesson: the bark") and
PLAYBOOK.md §7.3. Iris Springs' hero is exactly the kind of
material that fails the same way: a temperature field pushed through a colour ramp **is** a set of
thresholded contours of a warped noise field. So, before A1:
- Write a small numpy/PIL script that renders T(p) → ramp → the §1.2 oblique view at 960×540.
- Put it side by side with two or three reference photos (§6), in the session scratchpad only.
- Iterate until it passes the §5.7 checklist, especially items 1, 2, 5 and 11. Typical fixes: soft and
  noisy band edges at different scales per band (crisp lemon edge, diffuse orange-to-rust transition),
  the micro-texture perturbing the ramp lookup (T + 0.04 × texture), a gradient inside each band, and
  enough fingers to break every ring.
- Record the passing parameters in `iris-springs-core.js` comments and in the theme's record doc. Never
  commit the reference photos.

---

## 6. Reference imagery to look for

Keep reference images in the session's scratchpad and use them with the playground's `ref=` overlay
locally. **Do not commit copyrighted images.** Images by the US National Park Service and the USGS are
often public domain, but check each image's credit line; commit an image only if it is verifiably public
domain or the user's own, and record its source next to it.

**The Iris (Grand Prismatic Spring, Midway Geyser Basin, Yellowstone):**
- "Grand Prismatic Spring Fairy Falls overlook" (the exact oblique view the camera imitates)
- "Grand Prismatic Spring aerial" (band shapes, fingers, the off-centre vent)
- "Grand Prismatic Spring winter" and "Grand Prismatic steam blue" (steam taking the spring's colours;
  winter mats)
- "Grand Prismatic microbial mat close up", "Excelsior Geyser runoff mats" (micro-texture, finger edges)
- "Morning Glory Pool" (the deep eye, ledges through clear water)

**The Stair (travertine terraces):**
- "Mammoth Hot Springs Minerva Terrace", "Canary Spring", "Palette Spring" (stain colours on risers,
  active white lips, flowing sheets)
- "Pamukkale travertines" and "Huanglong terraces" (scalloped rims and milky pools; avoid the sunset
  mirror shots)
- "Badab-e Surt terraces" (orange-stained risers)

**The Chalice, the Consort, the Sleeper (geysers):**
- "Castle Geyser steam phase" (the long white exhalation)
- "Old Faithful preplay" (small splashes before the eruption)
- "Strokkur bubble before eruption" (Iceland; the surge dome)
- "Grand Geyser Vent Turban eruption" (connected vents erupting together: the Consort's reference)
- "Beehive Geyser" (a narrow, tall column)
- "Old Faithful rainbow in spray", "geyser spray rainbow" (where the bow really appears, how much arc
  shows)

**Accents and life:**
- "bobby socks trees Lower Geyser Basin", "Black Sand Basin dead trees" (ghost pines)
- "Champagne Pool Wai-O-Tapu", "Devil's Bath Wai-O-Tapu" (champagne and lime jewel pools)
- "Spotted Lake British Columbia" (jewel pools)
- "Octopus Spring pink filaments" (Streamer Rose)
- "steam devil over hot spring", "steam devils Yellowstone" (the T-spin)
- "fumarole steam jet"

**Optics and light:**
- "rainbow Alexander's dark band" and "bright sky inside rainbow" (the brightness step across the bow)
- "anticrepuscular rays" (the Ultra lanes)
- "steam plume shadow hot spring" (shadows on the colour bands)

**Painters and early photographers (public domain):**
- Thomas Moran, "Hot Springs of the Yellowstone" (1872) and his 1871–1872 Hayden Survey watercolours: how
  a painter heightened the colour without losing the place.
- William Henry Jackson's 1871 Hayden Survey photographs of the Mammoth terraces: form and scale of the
  Stair in black and white.
