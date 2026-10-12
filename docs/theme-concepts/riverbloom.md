# Riverbloom: theme concept build document

| Field | Value |
|---|---|
| Name | **Riverbloom** (the name is a Stage 0 decision for the user; see §3.13) |
| Proposed id | `riverbloom` (registry group `biomes`). Unused in `src`, `docs`, `data`, `public`, `tests` and `scripts` apart from `docs/theme-concepts/` and that folder's index row in `docs/ARCHITECTURE_INDEX.md` (checked 2026-10-12). Re-run `grep -rli riverbloom src docs data public tests scripts` before Stage 0. |
| Logline (as amended in §3) | *The river of five colours at the peak of its bloom: crimson riverweed streams under glass-clear rapids in high tropical sun, and every move you make boils, spills, ripens, drills or flowers the river.* |
| Status | **Concept: not built.** Nothing under `src/` implements it. |
| Seed | "Liquid Rainbow": Caño Cristales, Serranía de la Macarena, Meta, Colombia. Candidate #9 of the 33 researched; ranked 3rd in the research round's top 5 (§2.4). |
| Source | Design competition held on 2026-10-11 to replace the theme `cosmic-chimes`. Six concepts, three judges (art director, rendering lead, gameplay-feel designer), 0–10 per lens. The winner, Rainbark, is being built on branch `ccr-b2364ce7-64kjge` (commits `0c747dd` and `585ab55` so far). |
| Scores | Art director **6.0** (6th of 6) · Rendering lead **6.0** (4th of 6) · Gameplay feel **8.0** (3rd of 6) · **Total 20.0 / 30: 4th of 6** |
| Date | 2026-10-11 |

**The six concepts and their totals**

| Rank | Concept | Art | Tech | Play | Total /30 | Build document |
|---|---|---|---|---|---|---|
| 1 | Rainbark (being built) | 8.0 | 8.5 | 8.4 | **24.9** | `docs/theme-concepts/rainbark.md` |
| 2 | Iris Springs | 7.5 | 6.5 | 8.6 | 22.6 | `docs/theme-concepts/iris-springs.md` |
| 3 | Painted Ages | 7.0 | 8.0 | 7.5 | 22.5 | `docs/theme-concepts/painted-ages.md` |
| **4** | **Riverbloom** | **6.0** | **6.0** | **8.0** | **20.0** | this file |
| 5 | Haft Rang | 8.5 | 4.5 | 6.9 | 19.9 | `docs/theme-concepts/haft-rang.md` |
| 6 | Sunfall | 6.5 | 5.5 | 7.2 | 19.2 | `docs/theme-concepts/sunfall.md` |

> **How to use this file**
>
> 1. Start a **new Claude Code session** on this repository. Give it the short prompt from
>    `docs/theme-concepts/README.md` ("Start here") or the long one in PLAYBOOK.md §8, filled in with this
>    file's path (`docs/theme-concepts/riverbloom.md`) and the slot (or "ask me").
> 2. Before anything else, read `docs/theme-concepts/PLAYBOOK.md`. It holds every step that is the same for
>    all concepts: **§1 "Choosing a slot"** (which existing theme this one replaces, or whether it is added
>    as a new theme), §2 the adapter and director to clone, §3 the staged build order and critic loop, §4 the
>    rename and retirement checklist, §5 the headless Chromium + SwiftShader capture tooling that works in
>    cloud containers, and §6 the CI gates. This file only adds what is specific to Riverbloom.
> 3. For side-by-side similarity checks, compare against **koi-pond, ocean, halcyon-apex, waves,
>    verdant-hills and rainbark** before porting anything. Screenshots of the first five are in
>    `docs/theme-screenshots/<id>.png`; Rainbark has none yet, so capture it from the playground
>    (`/playground.html?effect=rainbark&t=60`). Written descriptions and "motifs to avoid" for every theme are
>    in `docs/theme-concepts/reference/catalog.md` (and `catalog.json`); the other `reference/` files are
>    surveys of the adapter, rendering patterns, events, CI and the rename, plus the research round
>    (`reference/research.md`, where this concept's seed is candidate #9).
> 4. Read `docs/theme-concepts/rainbark.md` §10 for the lesson that applies most here: **prototype the hero
>    material on the CPU (numpy/PIL) and compare it with reference photos before writing any shader**
>    (§5.12 says what that means for a river).
> 5. **Precedence inside this file.** §1 is the concept exactly as the judges scored it. §2 is what the judges
>    said. **§3 amends §1, and where they disagree §3 wins.** §5 (the implementation plan) already includes
>    every §3 change. §4 lists what must not duplicate Rainbark.
> 6. Repo rules that apply throughout (`CLAUDE.md`): iterate in the playground first, **one small effect per
>    session**, and never call a WebGPU/TSL change done without a screenshot and a clean console
>    (ADR-0007, `docs/adr/0007-webgpu-tsl-definition-of-done.md`). Generated SFX are unavailable: if a step
>    seems to need them, stop and ask the user.
> 7. Gotcha numbers written `#NN` are line numbers in the gotcha table of
>    `.claude/skills/webgpu-threejs-tsl/SKILL.md` as of commit `585ab55`. If that file has changed, search the
>    table for the symptom quoted next to the number.
> 8. Words: never write the trademarked name of the falling-block game, or its official spelling of the piece
>    name, anywhere: code, strings, comments, CSS, HTML, docs or commit messages (`npm run check:ip-strings`
>    enforces it in shipped files). Say "falling-block", "pieces", "four lines". The existing file suffix
>    `-tetrominos.js` and `getTetrominoConfig` are API and are fine.

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
| **Caño Cristales** | The real river in Colombia's Serranía de la Macarena that seeds the concept. The theme's river is a fictional reach "after" it, not a survey of it. |
| ***Macarenia*** | *Macarenia clavigera* (now *Rhyncholacis clavigera*), the riverweed (family Podostemaceae) that turns the real river red. In the theme: **the fronds**. Keep species names out of in-game copy. |
| **the fronds** | Finger-length ruffled ribbons of riverweed combed downstream by the current. The hero material. |
| **painted mats** | The fronds drawn as flow-aligned streaks in the bed shader, beyond the range where fronds are geometry. After §3.10 they carry the look on every tier. |
| **ripeness** | A 0–1 value per frond: 0 young jade, about 0.35 gold, about 0.6 crimson, about 0.8 carmine, 1.0 magenta-tipped peak. The real colour sequence of the plant. |
| **the five colours** | Red weed, yellow sand, green algae and young weed, blue water, black rock. |
| **Quartzite Shell** | The pale cream-and-rose bedrock. |
| **Patina Ink** | The manganese-black film on ledge lips: the fifth colour. |
| **ledges** | Low cross-flow steps in the bedrock; each lip draws a thin white curtain. After §3.6 they are where clears spill, and after §3.8 the combo's counting stations. |
| **giant's kettles** | Round pits drilled into rock by pebbles swirling in them. Some are static (part of the plan); T-spins drill new ones. |
| **Los Ochos** | A set piece: two interlocking round kettle pools in a figure eight, 2.5 m across, on the Kettle Terrace. |
| **the Kettle Terrace** | A raised quartzite shelf a foot above the water, left of the card, pocked with a dozen kettles. |
| **the White Curtain** | A set piece: a two-tier, 3 m fall of white and glassy water over a turquoise plunge pool, right of the card (after the real Los Cuarzos fall). |
| **the Serranía** | The Serranía de la Macarena: a flat-topped tableland wall 14 km away on the horizon, with thread falls. |
| **thread falls** | Thin waterfalls down the Serranía's cliffs; 2–6 by the convective cycle, 12–20 on a perfect clear. |
| **the convective breath** | The 300 s clock cycle of one tropical storm tower over the Serranía (fair, building, shower, clearing). |
| **sun credit, S** | The proposal's scalar for cloud shadow on the river. **Cut by §3.9** (clock only). |
| **`rvSurface`** | The water function every submerged surface applies to itself (the proposal called it `rbSurface`; §3.14 renames the prefix). |
| **the Boil** | The lock beat after §3.5 (the proposal called it "Quicken"). |
| **the Spill / the Chute** | The clear after §3.6: a ledge spills white and launches a glassy tongue of water downstream. |
| **braids** | Ten along-flow lanes inside a chute, coloured by the cleared row's ten cells (§3.6). |
| **the Spate** | The four-line clear after §3.7 (the proposal called it Tapete Rojo). |
| **stations** | Six fixed places that light one per combo link (§3.8). |
| **the Wash** | The combo release after §3.8 (the proposal called it Pearl-up). |
| **La Floración** | The perfect clear: the river stills, turns invisible and flowers. |
| **La Sequía / Primera Lluvia** | Game over (the dry season) and the restart rite (the first rain). |
| **tide lines** | Dark wet high-water marks left on the banks by each level-up (season turn). |

---

## 1. The concept in full (as proposed)

Everything in this section is the proposal as the judges scored it, with every number kept. Where §3 changes
something, a marker **[amended: §3.x]** points to the change. The proposal assumed it would take Cosmic Chimes'
slot; slot-specific parts are written here for "the theme this one replaces" (see PLAYBOOK.md "Choosing a slot";
the worked example is Cosmic Chimes → Rainbark, commit `585ab55`).

### 1.1 Name, id, logline

- **Display name:** Riverbloom **[amended: §3.13, a Stage 0 decision]**
- **id:** `riverbloom`. Folder `src/themes/riverbloom/`, class `RiverbloomTheme`, registry group `biomes`. The theme
  this one replaces is retired to this id through `RETIRED_THEME_IDS` in `src/themes/theme-registry.js`, as was
  done for `electric-dreams-v3 → murmuration` and `cosmic-chimes → rainbark`.
- **Logline (original):** *The river of five colours at the peak of its bloom: crimson riverweed streams under
  glass-clear rapids in high tropical sun, and every move you make quickens, sluices, ripens, carves or flowers the
  river.* **[amended: header; the verbs changed in §3]**
- Alternative names, in order of preference: **Cinco Colores**, **Tapete Rojo**, **Crimson Reach**.

**Pitch.** Almost every theme in the fleet is a dark sky, or a bright object standing in front of a low sun.
Riverbloom is the reverse. It is a noon-bright tropical daylight scene with no sun, moon or planet in the frame, no
mirror, and no crystal. The light lives *in the water*. The hero is a living material: tens of thousands of crimson,
magenta, gold and jade fronds, combed by a fast current, under water so clear the eye reads it as air. The game plays
the river the way a hydrologist and a gardener would, not the way a lighting desk would. Nothing leaves the card as a
spark, nothing stores your colour for 30 seconds, and nothing holds its breath. The river quickens, spills, ripens,
drills, flowers and dries.

### 1.2 The picture

#### Reference facts that ground the art direction

- The red is a flowering plant, not an alga: *Macarenia clavigera*, now *Rhyncholacis clavigera* (Podostemaceae, the
  riverweeds). It is **green when young, turns yellowish, then takes on shades of red**. Plants shaded by trees stay
  green. When the water recedes the plant dies and turns brown. It **clings tightly to rock where the current is
  fastest** and grows almost nowhere else on Earth.
  ([Wikipedia](https://en.wikipedia.org/wiki/Ca%C3%B1o_Cristales), [JBL expedition note](https://jbl.de/en-dk/podcast/detail/7))
- The colour shows from late July to November and peaks from September to November. In the wet season, **deep, fast
  water hides the bed**. **Under cloud the colours go dull**, because the effect needs direct sun through shallow
  water. ([Geography Realm](https://www.geographyrealm.com/cano-cristales-rainbow-river/),
  [World Book](https://www.worldbook.com/behind-the-headlines/Colombia-s-Liquid-Rainbow),
  [SlashGear](https://www.slashgear.com/1420578/science-behind-river-five-colors-colombia/))
- The five colours are **red** weed, **yellow** sand, **green** algae and young weed, **blue** water and **black**
  rock. The water is **extremely clear because it carries few nutrients and particles**.
  ([Wikipedia](https://en.wikipedia.org/wiki/Ca%C3%B1o_Cristales), [Atlas Obscura](https://atlasobscura.com/places/cano-cristales))
- The bed is **quartzite of the Serranía de la Macarena**, about 1.2 billion years old and a western outlier of the
  Guiana Shield. It is **pocked with giant's kettles**: round pits drilled by pebbles that swirl inside them.
  ([Wikipedia](https://en.wikipedia.org/wiki/Ca%C3%B1o_Cristales))
- Named places along the river
  ([tomplanmytrip](https://www.tomplanmytrip.com/travel-to-colombia/destinations-in-colombia/llanos-orientales/cano-cristales/),
  [Colombia Travel](https://colombia.travel/en/la-macarena/cano-cristales-natural-wonder)):
  - **Los Ochos**: round pools that read as a figure eight from above, each a different colour depending on its depth.
  - **Los Cuarzos**: a waterfall "like a white curtain" over clear pools.
  - **Tapete Rojo** ("the red carpet"): the stretch with the densest weed.
- Riverweeds hold on with mucilage holdfasts. They **flower when the falling water exposes them**: each flower opens
  from a membranous spathella that splits. ([Britannica](https://www.britannica.com/plant/Podostemaceae),
  [Kahaku Podostemaceae](https://www.kahaku.go.jp/research/db/botany/podostemaceae/2introduction.html))
- **Caustics** form when ripples on the surface focus sunlight into bright lines on the bed. **Dispersion puts spectral
  fringes** where the bending is strongest. Because the sun's disc is about a quarter of a degree in half-angle, the
  pattern **blurs with depth**. ([Atmospheric Optics, lake caustics](https://www.atoptics.co.uk/fz129.htm),
  [arXiv bubble optics](https://arxiv.org/pdf/1909.04401), [Wikipedia, Caustic](https://en.wikipedia.org/wiki/Caustic_(optics)))
- The Macarena sits where the Andes, the Llanos and the Amazon meet: gallery forest along the rivers, savanna on the
  slopes, and the tableland wall behind. At about 2–3° N in September and October, the sun stands near 48° at 15:00.

#### The painter's description (16:9 desktop, the reference frame) [amended: §3.2, oblique camera and diagonal reach]

We stand on a warm, dry quartzite shelf at the river's edge, **2.6 m above the water**, looking upstream. The camera is
pitched **12° down** with a vertical FOV of about 50°, so the horizon sits about 27% from the top.

**The foreground.** The rock in the lower corners is pale: cream with a rose blush, like the inside of a shell. Water
has worn it into rounded lobes and pocked it with circular holes. Some are dry and floored with gold sand; some are
brimming. From the bottom edge the river spreads across the whole picture: a 25 m sheet of water a hand to a forearm
deep, racing toward us over bedrock. It is so clear that the eye first reads rock and plants under open air. Three
things give the water away:
- a net of light trembling over every surface, its threads stretched long in the fast water;
- a scatter of sun-stars where the surface breaks over a ledge;
- a slow wobble that makes the fronds swim.

**The fronds.** Carpets of *Macarenia* cling to the rock in bands that follow the current. Each frond is a
finger-length of ruffled crimson tissue, combed downstream into long parallel locks.
- Where the water is shallowest and the sun strongest, they burn magenta and coral.
- In the fast middle of the channel they are deep carmine.
- Where a rib of rock throws shade, they fall back to jade and olive.

Between them lie gold, sand-floored pools, black patina on the ledge lips, and blue in every deeper hole. All five
colours lie in patches like a mosaic, and every patch is moving.

**Behind the card.** The river gathers into its deepest channel, a calm sapphire-teal run, deliberately darker and
quieter so it backs the board. It steps down toward us over three low ledges whose lips draw thin white lines across
the picture.

**Left of the card: the Kettle Terrace.** A raised quartzite shelf a foot above the water, pocked with a dozen giant's
kettles. Its jewel is **Los Ochos**: two interlocking round pools in a figure eight, 2.5 m across.
- The rim is shallow and gold-floored, the middle depths jade, the drilled heart sapphire.
- On the upstream lip the river pours in and drapes a fringe of crimson fronds over the edge.
- In the deepest kettle a pale pebble circles slowly.

Beyond the terrace runs the left channel, with long crimson locks streaming toward us, and beyond that the
**gallery-forest bank**: fan-palm crowns and dense dark canopy, lit warm along the top.

**Right of the card: the rapids and the White Curtain.** The near right is the fastest water: a broad ramp of pale rock
braided with stripes of fronds in crimson, magenta, gold and jade, with a line of standing waves glittering at its
foot. In the middle distance a side channel tumbles off a black-patina ledge in a two-tier fall 3 m high. This is
**the White Curtain** (after Los Cuarzos): a sheet of white and glassy water over a round turquoise plunge pool, its
spray rising into the light as a luminous veil.

**The horizon band** (top quarter). Beyond the forest, the savanna rises in gold-green swells to the **Serranía de la
Macarena**: a long, flat-topped wall of tableland 14 km away. It is blue-violet in the humid air, its cliffs striated,
with two thread falls catching the light. It stays low (rim at about 1.6°) and horizontal: a wall, not a peak. Over it
stands **one great convective tower**, brilliant white on its sunward flank and pearl-grey underneath. The sky above is
tropical cerulean, whitening toward the horizon with humidity.

**The light.** The sun is high (48°) and ahead-left, above the frame. **Nothing in the picture is a light source; the
light is in the water.** Because it comes through the river toward us:
- the fronds glow translucent ruby wherever we see them against the sun;
- each ledge throws a short shadow toward us;
- the caustics are sharp on the near bed;
- a small sparkle zone flickers in the lower-left corner, where chop tilts the sun into the lens.

The far reach, seen at a grazing angle, turns into a silver-blue ribbon of reflected sky. That is the Fresnel effect,
not a mirror. **[amended: §3.2, the far reach bends away; no ribbon]**

#### Why it has depth

1. **Overlapping planes.** Near shelf, then river, then terrace and falls, then forest bank, then savanna swells, then
   the tableland, then the cloud tower. That is seven planes, each separated by value and hue.
2. **The Fresnel gradient.** The near water is invisible (2–3% reflectance looking down). The far water becomes a sheet
   of sky (30–60% at grazing angles). Water alone gives the eye the full distance. **[amended: §3.2]**
3. **Texture gradients.** Fronds 40 cm long near the camera become streaks at 30 m and a painted mat beyond. Kettles
   shrink from 2.5 m discs to dots. The caustic cells shrink with distance and blur with depth.
4. **Motion parallax of the flow.** Everything moves toward the viewer and grows as it comes: comets, chutes, foam lines
   and the spate. Every event is a depth cue.
5. **Aerial perspective.** Humid tropical haze (`#9FB4D8` at 14 km) lifts and cools the tableland. Cloud shadows slide
   over the far savanna.
6. **Scale cues.** Dragonflies the size of a thumbnail over the rapids; a 3 m fall; a 14 km wall.

#### 21:9

The vertical FOV is narrowed to about 44° and the camera stays the same, so the panels widen rather than the river
shrinking.
- **Left panel** gains the full gallery-forest bank (6–8 more fan palms) and a second chain of three kettles stepping
  up the terrace.
- **Right panel** shows the White Curtain whole, with its plunge pool and outflow, plus a second braid of fronds beyond it.
- The cloud tower slides right to balance the frame; the tableland runs edge to edge.

#### Upright phone (aspect about 0.46)

The free space is above and below the card. The camera rises to **3.4 m** and pitches **24° down** (vertical FOV about
68°), so the near water fills the bottom band and the horizon sits about 14% from the top.
- **Above the card**, looking upstream: the far reach with its stepped ledges, the White Curtain (the composition moves
  it toward screen centre), the tableland and the tower.
- **Below the card**: the near rapids, with fronds streaming toward and under the viewer, and Los Ochos at the bottom
  edge (the composition moves it under the card).

Effects that use the card's flanks on landscape use the card's **bottom lip** on a phone (see §1.5).

#### Composition rules (for `riverbloom-composition.js`)

- The deep sapphire channel always passes behind the card. The brightest crimson is kept out of the card's rectangle,
  so the calm zone has an easy job.
- Los Ochos and the White Curtain are **movable set pieces**. They are placed at the centroids of the free regions, away
  from the HUD rect (`.single-player-stats-bar`). If the HUD sits on the left, Los Ochos moves down and outward.
- The river is wide enough that every free region always holds frond beds, so lock and clear effects always have a canvas.
- Lock and clear anchors map a card row to a point on the river surface by casting the ray through the card edge at
  that height onto the water plane. Rows near the top of the board therefore land farther upstream, and the current
  carries the effect down the screen toward the viewer.

### 1.3 Palette

#### Core colours (the resting look, season I "Crimson Run")

| Name | Hex | Where |
|---|---|---|
| **Macarenia Crimson** | `#C8163F` | Albedo of ripe fronds in sun; the signature |
| **Shallows Magenta** | `#D9408F` | Peak fronds in the shallowest, sunniest water |
| **Ruby Transmission** | `#FF4A55` | Light through backlit fronds (thin-leaf transmission tint) |
| **Sand Gold** | `#E9B43A` | Sand floors of pools and kettles; fronds that are turning |
| **Sprout Jade** | `#3E9A55` | Young and shaded fronds; algae film in slow water |
| **Kettle Sapphire / Clear Aqua** | `#1C5E9E` / `#9EE3E6` | Deep pools (Beer absorption over about 2 m) / tint of shallow water |
| **Quartzite Shell** | `#EADBCB`, rose shade `#C9A9A3` | The bedrock, lit and in shade |
| **Patina Ink** | `#221D26` | Manganese-black ledge lips: the fifth colour |
| **Tropic Cerulean** | zenith `#2C79D3` to horizon `#D3ECF2` | Sky |

Supporting colours: Serranía Violet `#7C82B4`; Tower White `#FFFAF0` with base `#93A3BE`; Gallery Green `#1E4A31`, lit
`#4F7F3A`; Savanna `#A8A85A`; Foam `#F4FBFF`; Spray glow `#EAF6FF`.

All colour is albedo multiplied by light. Nothing in the world is emissive except the glints and the caustic
highlights, which are focused sunlight. Saturation therefore comes from the light, which keeps the scene from tipping
into neon.

#### Level driver: the river's season (world-native, not an hour wheel)

The real Caño Cristales cycles water level and weed colour every year. Each level steps one season; the cycle wraps
after six. Transitions run **downstream**: the far reach changes first and the change arrives at the viewer with the
current. **[amended: §3.8, each season also sets a rest ripeness]**

| Step | Season (real months) | Fronds (base → tips) | Water | Sky and air |
|---|---|---|---|---|
| I | **Crimson Run** (Sep) | `#C8163F` → `#FF5A6E` | Clear aqua; medium level | Cerulean; one fair tower |
| II | **Magenta Peak** (Oct) | `#B3125A` → `#F25AAE` | Lowest and clearest; most bed showing | Deepest blue `#1F6ACB`; strongest sun; sharpest caustics |
| III | **Rose Flowering** (Nov) | `#D9476B` → `#FFA3B8`, with a sparse permanent scatter of white flowers on emerged tips | Falling; dark wet bands appear on the rock | Softer `#3C86D6`; more cumulus |
| IV | **Gold Ebb** (Dec–Feb) | Emerged weed dried to amber `#C98A2E` and straw `#EBCB7A`; submerged weed dark crimson | Threads between the rocks; kettles become isolated sapphire jewels | Pale `#5C97D6`; warm savanna haze `#E6D2B0`; thread falls dry |
| V | **First Rains** (Apr–Jun) | Jade `#2E8F57` → lime `#9ED84A` | High, quick, silver-green `#A9DCC8`; more white water | Towering cumulus; shower veils on the tableland; 6 thread falls running |
| VI | **Green Turning** (Jul) | Jade-gold `#4E9E3A` → `#E8B12A`, with first crimson blushes | Clearing | Washed blue; then wraps back to I |

Modes with no `LEVEL_UP` (Infinity, local and online multiplayer) advance one season every 15 cleared lines, counted
by the director, and also drift one season every **240 s** on the clock. A real `LEVEL_UP` resyncs.

#### Clock driver: the convective breath (period 300 s)

The tropical afternoon builds and releases one storm tower over the tableland:
1. **0–90 s, Fair.** The tower is small and crisp, and few cloud shadows cross.
2. **90–170 s, Building.** The tower top climbs about 2°, its base darkens, and shadows come more often.
3. **170–220 s, Shower.** A grey veil hangs from the tower onto the tableland, and its thread falls brighten and
   multiply from 2 to 6. One **large cloud shadow crosses the river** in about 12 s: the crimson dims to wine and the
   pools to teal. Then the sun's edge sweeps back over the water and **the colours switch on again**. This is the
   daily magic of the real river, and the clock delivers it once per cycle.
4. **220–300 s, Clearing.** The tower collapses to an anvil remnant, and the haze thins.

#### Gameplay coupling: sun credit [amended: §3.9, cut; the shadow follows the clock only]

A scalar **S** sets how much cloud shadow lies on the river.
- Every cleared line adds 0.12.
- A lock that clears nothing removes 0.03.
- With no events, S relaxes toward 0.85 with a time constant of 40 s.
- S is clamped to 0.55–1. Under the deepest shadow the river is still lit by bright tropical skylight (about 35% of
  sun, bluish), so it turns moody and never goes dark.
- In menus, S is 1.

The intent: **when you play cleanly the river blazes; a long run without clears lets cumulus shadows drift over it.**
A quiet, honest readout of how the stack is going, using the river's real behaviour.

### 1.4 Environmental animation (everything that moves)

| Element | Motion | Rate |
|---|---|---|
| Surface flow | Two-phase flow-mapped normals advected along the baked flow field | 0.2 m/s in pools; 1.2–1.8 m/s on the sheet; 2.5 m/s over ledges; phase period 2.4 s |
| Fronds | Stream downstream. Lateral flutter grows toward the tip (A ∝ s²). An undulation travels along the frond. Length stretches with the local current | Flutter 1.4–2.6 Hz (hashed per frond); travelling wave at 0.6× the current; stretch 1.0–1.25× with flow |
| Travelling caustics | The Jacobian caustic pattern (see §1.7), advected and stretched along the flow | Moves at the current speed; stretch up to 3:1 in fast water |
| Standing caustics | Fixed bright chevrons downstream of ledges and ribs, from stationary standing waves | Fixed in place; amplitude shimmer 3 Hz **[amended: §3.15, 1.6–2.4 Hz hashed]** |
| Glitter | Hashed facet lattice on the surface. A glint shows where a facet reflects the sun into the lens | Each glint lives 60–140 ms, scattered at random, small in area (see photosensitivity below) |
| Foam lines | Anisotropic streaks along streamlines below ledges, plus bead clusters | 1.5 m/s; fade over 6 m |
| White Curtain | Streaks fall and accelerate (v² term); spray sheets billow and drift; the plunge pool churns | Streaks 3–5 m/s; spray drift 0.4 m/s; billow period 7–11 s |
| Ledge curtains | Thin white lips on each step ledge, flowing | 2 m/s |
| Kettle pebbles | A pale pebble circles in each deep kettle, glinting; the water swirls with it | 0.2–0.5 rev/s, hashed; the glint catches the sun once per revolution |
| Los Ochos inflow | The lip pours in; the draped fronds stream over the edge | Constant |
| Cloud shadows | Projected noise in sun space, drifting with the wind; coverage from S and the convective phase **[amended: §3.9, phase only]** | A crossing every 25–45 s, taking 8 s; one large crossing per 300 s cycle |
| Convective tower | Growth by threshold and domain warp of a baked field; slow drift | Grows over 80 s; drifts 0.002 rad/s |
| Serranía thread falls | Thin flowing lines down the cliff; count and brightness follow the cycle and season | 2–6 falls; flow streaks 1 Hz |
| Shower veil | A soft vertical noise curtain over the tableland | Present 50 s per cycle |
| Gallery forest | Palm crowns sway; the canopy's lit tops shimmer | 0.25 Hz; gusts every 15–30 s |
| Dragonflies (2–4) | Closed-form hover-and-dart over the rapids; wings glint | Hover with 2 s darts; wing glint 30 Hz, sub-pixel and averaged, so it never strobes |
| Camera | Slow breathing sway; pointer parallax on desktop only (not touch, not reduced motion) | ±0.25° on 23 s and 31 s cycles; parallax ±1.2° |
| The river under menus | Camera drifts slowly along the bank | ±4° yaw over 90 s |

Nothing on the rock moves between events except water. Kettles appear only when the player drills them (§1.5), so the
bed reads as a record.

### 1.5 Gameplay event language (as proposed) [amended: §3.5–§3.9; §3.17 is the authoritative summary]

**Grammar: the board is a weir of stones across the river.** The river runs toward the viewer past both sides of the
card. The game acts on the river with its own matter:
- **QUICKEN** (water rises in a lens)
- **PLUNGE** (water bursts)
- **SLUICE** (water spills)
- **TAPETE ROJO** (the river runs red)
- **RIPEN** and **PEARL-UP** (the plant answers the sun)
- **STANDING WAVE** (the water holds a shape)
- **KETTLE** (stone drills rock)
- **LA FLORACIÓN** (the river flowers)
- **SEASON TURN** and **LA SEQUÍA** (time and drought)

Rules for every event:
- **No spark leaves the card.** Nothing flies through the air to a site that keeps your colour.
- **No hush, no blackout, no white flash, no camera dip.** The lens never moves for gameplay; the river does.
- Every response travels **downstream, toward the viewer**. This is the opposite of the house's outward rings and
  fronts, and it makes every event a depth cue.

| Event | World verb | What you see (timeline) | Scale and readability |
|---|---|---|---|
| **Lock** **[amended: §3.5]** | **Quicken** (a lens of water) | **0.00 s** In the river just outside the card edge nearest the piece, at the piece's height, the surface swells into a glassy **boil**: a dome 8 cm high that peaks at 0.12 s. Being a lens, it magnifies the fronds under it by 1.3× and **focuses the sun into a brilliant caustic knot** on the bed. The knot has spectral fringes biased toward the piece's colour. **0.1–0.4 s** Fronds within 0.6 m flick their tips up, flash their pale undersides, and **flush toward the piece's colour** (a 40% sheen, not a dye). **0.3–2.2 s** The current carries the knot downstream at the local flow speed. It stretches into a **comet of caustic filaments** 1.5 m long, and the fronds blush and relax in its wake. **2.2–3.5 s** It dissolves into the ambient net. | One knot per lock; up to 10 alive. Strength ×0.7 above 4 alive, to keep the light budget. The side follows the piece's centroid column (`u < 0.42` left, `u > 0.58` right, otherwise both sides at 0.6). Reads at a glance as "my colour ran down the river beside my piece." Calm enough to fire every second. **Phone:** the boil sits just below the card's bottom lip, under the piece's column. |
| **Hard drop** **[amended: §3.15, skip rate limit]** | **Plunge** | Folded into its lock, so only one boil. The dome is ×1.6, plus distance/20 (capped at ×2.2). It **bursts into a white-turquoise cloud of aerated water** that rushes 1.5 s downstream. **One pebble is knocked loose and skips** 3–6 closed-form hops along the bed, each hop a glint and a puff of gold sand, toward the nearest kettle on that side. There it **joins the kettle's orbit**: up to 3 pebbles per kettle, and the oldest settles. | Size follows drop distance. The kettles visibly gather your hard drops as circling stones, a tiny persistent detail with no colour held. No camera motion. |
| **Line clear ×1/2/3** **[amended: §3.6]** | **Sluice** (a course of the weir is lifted) | **0.00 s** At each cleared row's height, a lip of glassy water **slips over both card flanks**, lowest row first, 0.12 s apart. **0–0.7 s** Each lip **falls down** the outside of the card edge as a thin glass sheet: a nearly clear body with bright white edges and threads, wobbling the river seen through it. Gravity carries it to the water at the card's foot. **0.5–3.0 s** Where it lands, a **release**: a smooth glassy tongue (a chute) races down the reach on that side toward the viewer at 3 m/s. Under it the fronds **comb out to 1.6× length and flare to the season's peak colour**, and their tips break the surface in a **carpet of glitter**. Foam streamers trail the tongue's edges. | You count the falling sheets on each flank; the length of the release shows the size. **1 line:** one sheet per flank; the chute reaches mid-panel. **2:** two sheets per flank; the chute reaches the frame bottom. **3:** three sheets; the chute fills the whole near reach, every small ledge in both panels whitens into a curtain for 1.2 s, and the White Curtain doubles for a moment. Sun credit +0.12 per line. **Phone:** the sheets pour over the card's bottom lip, spread across its width, into the rapids below. |
| **Four lines** **[amended: §3.7]** | **Tapete Rojo** (the red carpet) | **0.00 s** All four courses lift at once. A **full glass apron** pours off both flanks and the card's foot, with one brilliant white lip line. **0.2 s** Upstream, behind and above the card, the held river **drops a hand's width**: the far ledges emerge glistening as the reservoir empties. **0.3–2.4 s** **The spate**: a single glassy bore with a rolling white crest runs from the card outward through both panels toward the viewer. Behind it, **every frond in the visible river streams to double length and ignites, in one sweep, to peak magenta-crimson**. The river becomes a red carpet under glass, from the board to the edge of the frame. The caustics densify into a gold lattice and every ledge becomes a white curtain. **Los Ochos overflows**, its rims sheeting with water. The White Curtain thunders and throws a sunlit spray veil full of forward-scattered spectral sparkles (no rainbow arc). **2.4–12 s** The bore passes out of frame. The river lies at peak colour, wet and gleaming, and relaxes over 10 s. | The biggest moment, and it reads instantly as "the river turned red all the way to me." No hush and no white flash. Exposure lift ≤ 0.15; the spectacle is colour and motion over the whole frame. The bore is the only front in the theme, and it is a real hydraulic one. |
| **Combo chain (true combo): escalation** **[amended: §3.8]** | **Ripen** | The true combo, from the per-player `ComboTracker`, drives the river's **ripeness**. More sun reaches quicker, shallower water, and the weed ripens through its **real colour sequence**, spreading outward from the card along the reach. **×2 Gold:** jade fronds near the card turn gold; the standing waves at the main ledge start to glitter; the caustics quicken. **×3 Crimson:** the near reach goes crimson; foam lines lengthen; the White Curtain thickens. **×4 Carmine and magenta:** the shallows flush magenta and the kettles deepen to sapphire by contrast; spray drifts into the light. **×5 The far reach ignites:** ripeness runs upstream to the vanishing point, one continuous red ribbon up to the tableland. **×6 Prismatic caustics:** dispersion strengthens until the net of light throws spectral colour over the whole bed (a liquid rainbow, made of real optics). **×7+ Pearling begins:** strings of silver oxygen beads rise from every sunlit frond and wink at the surface. Photosynthesis is made visible. | One visible stage per link, everywhere at once. Ripeness is the **river's own palette**: nothing takes the piece's colour and nothing holds it. Sun credit is pinned at 1 while the chain lives. |
| **Combo chain: release** (`combo(0)`) **[amended: §3.8]** | **Pearl-up** | Within 1 s the flow eases and the fronds settle back to their normal length over 2 s. **The sun-drunk fronds exhale**: along the ripened reach, streams of silver beads rise and burst at the surface into a **drifting fizz of glitter** that the current carries downstream past the card toward the viewer for 4–8 s. Ripeness relaxes to the season's rest over 20 s, the far reach first. | The reward comes at the release. The amount of fizz follows the **peak** chain: 2–3 gives a few threads near the card, 7+ fizzes the whole visible river. A break never reads as a collapse. |
| **Back-to-back** | **Standing wave** | Each B2B raises a **standing-wave train** at the main ledge in both near panels: a stationary crest of white glass, brilliant **fixed caustic chevrons** beneath it, and continuous glitter. Each B2B step adds a crest, from 1 to 3, and raises them. The train **persists while the B2B chain lives**. When the director infers a break (a wave-1 clear of fewer than 4 lines without a T-spin), it smooths out over 6 s. | Persistent and readable: "my back-to-backs built a wave that stays." It is a shape held still in moving water, unlike any sibling's B2B. |
| **T-spin** (1/2/3 lines) | **Kettle** (a giant's kettle is drilled) | On the T's side, on the rock shelf beside the card at the T's height (the Kettle Terrace on the left, a rock rib on the right): **a pebble drops into a hollow and spins**. In a 1.4 s time-lapse the whirling stone, a glint orbit that accelerates, **bores a new round kettle into the quartzite**. The rock darkens as the pit opens, water swirls in, gold sand lifts, and the pool settles to its depth colour. **Single:** 0.6 m, gold-jade. **Double:** 1.2 m, turquoise. **Triple:** 2 m, sapphire with a fringe of crimson fronds. | **The kettles persist for the session**, up to 8. When a 9th is drilled, the oldest silts up with gold sand over 20 s. The shelf becomes a geological record of your T-spins. The spin happens inside a pothole, never around the card. |
| **Perfect clear** | **La Floración** (the river flowers) | A standalone moment; it arrives a frame after the clears and works with `rows: []`. **0–0.6 s, Cristal:** the flow **stills**. Surface roughness falls to 0, the glitter and foam fade, and water absorption falls to near 0. **The river becomes invisible**: the bed shows as if under air, razor-sharp, at full chroma, with the caustics relaxing into slow broad gold bands. This is a *brightening*, not a hush. **0.6–2.5 s** The level drops a hand's width, so every frond tip emerges, and **the whole river flowers**. Per-flower delays are hashed, so the opening shimmers across the frame with no front. Millions of tiny five-lobed pink and white flowers open from splitting spathellae, on the crimson fronds, on Los Ochos' rim, and down the rapids. Sun sparkles on the wet petals. In the distance, **the Serranía lets down a row of 12–20 silver thread falls** from its rim. **2.5–14 s** Hold. Then the water returns over 4 s, the flowers close and go under, and the current comes back. | Rare, standalone and unmistakable: the riverweed's real flowering, on the whole river at once. Strongly colourful (pink and white over crimson, jade and gold) and calm. |
| **Level up** | **Season turn** | A 4 s time-lapse. Cloud shadows race, sun credit goes to full, and the water level, frond palette, sky and haze cross-fade to the next season (§1.3). The change **flows downstream**, from the far reach to the near. **A thin dark-wet tide line is left on the quartzite banks** at the old water level. These high-water marks accumulate through the session, up to 6. | Progress written into the rock as flood marks: a world-native replacement for the hour wheel. Without `LEVEL_UP`, the season steps every 15 lines and every 240 s. |
| **Game over / top-out** (window `gameOver`, or `modeStopped`) | **La Sequía** (the dry season) | Over 6 s the water drops to threads between the rocks. Emerged fronds dry from crimson to amber to straw (it stops at straw and never reaches brown). The rock bleaches, the haze warms, the cloud tower dissolves and the standing waves vanish. The kettles remain as the last blue jewels. Dragonflies settle on the rock. **On the next `modeStarted`: Primera Lluvia** (the first rain). For 5 s a soft shower veil crosses the tableland and the river: streaks show only against the dark forest, with a silver sheen on the rock and **no rings**. The thread falls run, the water returns over 4 s, and the fronds green, then ripen to the season's rest over 8 s. | Gentle and golden, never punishing. The restart becomes a small rite of renewal. |
| **Idle / no play** **[amended: §3.9]** | **The river runs** | Flow, fronds, caustics, kettle pebbles, dragonflies and the White Curtain continue. The convective breath delivers one large cloud shadow, and the switch-on of colour, every 300 s. With no locks for 40 s, S settles at 0.85. In menus (no card visible), the camera drifts along the bank and S is 1. | Beautiful on its own, and nothing waits for the player. |

**Mode notes.**
- **Local multiplayer:** every board's events anchor to that card's own flanks. The river is shared, and a slot's side
  is chosen by the card's screen position. Cascade depth arrives as `COMBO` ahead of `LINE_CLEAR`, so it is stashed and
  applied to the next `LINE_CLEAR` of that slot.
- **Infinity:** uses `viewportOrigin` for rows.
- **Odyssey synthetic clears** (`rows: []`) fall back to the bottom rows.
- **Meditation clicks:** a sluice chute launched from the bottom edge at the click's `x`, rate-limited to 2 per second.

**Photosensitivity and reduced motion.**
- Nothing flashes. The global exposure lift is capped at 0.15, and only Tapete Rojo and La Floración use it.
- Glints are small in area and random in space and time (no synchronized twinkle), and their total light is budgeted
  per tier.
- Event intensities use `max()`, never sums, so rapid cascades cannot stack into a strobe.
- Under reduced motion (the setting or `prefers-reduced-motion`): comets travel 0.15 s; frond flutter amplitude ×0.4;
  the spate becomes a 1.2 s colour cross-fade with a slow comb; the kettle drill becomes a 0.6 s fade-in; parallax is
  off; nothing else changes, because the camera never moves for gameplay anyway.

### 1.6 Piece colours (as proposed) [amended: §3.12, the palette fails colour-vision simulation]

Seven river colours, dealt so that **no shape wears its Guideline hue: 0/7 on `npm run check:palette`** (verified with
the gate's own `hexToHue` in `scripts/palette-guideline-check.mjs`). The set covers the same seven well-separated hue
families players already tell apart (red, orange, yellow, green, cyan, blue, purple), but **every role is moved**, and
each piece is a part of the river:

| Shape | River name | Hex | Hue | Rel. luminance | Guideline band avoided |
|---|---|---|---|---|---|
| **I** | Macarenia Crimson (a long frond) | `#E3264F` | 347° | 0.18 | cyan 160–210 |
| **O** | Kettle Turquoise (a round pool) | `#22C3C9` | 182° | 0.44 | yellow 32–75 |
| **T** | Sand Gold | `#F4BE2C` | 44° | 0.56 | purple 245–315 |
| **S** | Shallows Magenta | `#E45FC8` | 313° | 0.29 | green 90–170 |
| **Z** | Sprout Jade (a zigzag shoot) | `#2FBF71` | 148° | 0.39 | red 320–20 |
| **J** | Coral Tip (a hooked frond tip) | `#FF7A4D` | 15° | 0.36 | blue 200–250 |
| **L** | Deep-Run Azure (the bend of the channel) | `#3C7DF0` | 218° | 0.22 | orange 20–50 |
| GARBAGE | Patina Ink | `#3A3340` | — | 0.04 | — |
| CLEAN_GARBAGE | Quartzite | `#CDBFB2` | — | 0.54 | — |

- **Readability.** The three warm pieces (I crimson, J coral, S magenta) are separated by hue (34° and 28° apart) and by
  luminance (0.18 / 0.36 / 0.29). The two blues (O turquoise, L azure) differ by 36° and 0.22 in luminance. This
  mirrors the red/orange/purple and cyan/blue spacing of familiar sets, so nothing new has to be learned. Colour-vision
  check before shipping: render the palette through deuteranopia and protanopia simulation in the playground. If
  needed, lift L to `#4A88F5` (luminance 0.26).
- **Cell look: river-polished stone under a film of water.** This uses only the existing Phaser board options, so every
  surface stays readable (active, ghost, next, opponent):
  ```js
  renderMode: 'solid',
  effects: { premium: true, phaser: {
      gradient: true, highlight: 0.24, shadow: 0.2,        // wet top-left light, darker foot
      rim: true, rimAlpha: 0.42, rimWidthFactor: 0.05,     // the stone's edge
      gloss: true, glossAlpha: 0.2 } }                     // a film of water
  ```
- **Optional stretch** (only if the board ever gets per-theme cell shaders): a slow caustic shimmer drifting across each
  cell face. Not required. **[amended: §3.4, dropped]**
- **How the world uses piece colour.** Only transiently: the lock's caustic fringe and the blush in the fronds. **No site
  keeps it**, and the combo ripens the river in its *own* colours. **[amended: §3.5, §3.6]**

### 1.7 Rendering plan in TSL (three r186.1, WebGPU and WebGL2 backends)

#### House conventions kept

- `WebGPURenderer` with the WebGL2 backend as fallback.
- Every surface a self-shaded `MeshBasicNodeMaterial`, in scene-linear HDR.
- No scene lights, no `ShaderMaterial`, no compute, no `mx_noise`, **no `Data3DTexture`**.
- One CPU-baked 2D fBm texture (half float with CPU mips, from the `createFbmTexture` pattern in
  `src/themes/serenity-warp/serenity-warp-tsl.js`), plus one tiny CPU-baked tower field (RGBA8).
- Laid-out pure helpers; builders that read `u` stay inline.
- Closed-form event slots in **one** `uniformArray` vec4 table, with live rows compacted to the front; `seek(t)` with
  fixed-step replay.
- Every pool always drawn with dormant zero-size slots, so the first frame compiles every pipeline.
- One scene pass, single output (`usesMrtScenePass() → false`), then one bloom chain and one output pass.

#### Key decision: the water is a function, not a mesh

The water is shallow (0–40 cm, 2 m in kettles) and the eye is high. That makes it exact, and cheap, to treat the surface
the way the house treats the sky: **one function that every submerged surface applies to itself.**
`rbSurface(u, P, V)` **[amended: §3.14, rename to `rvSurface`]** takes a bed or frond point `P` and its local water
level `lvl(P.xz)`:
1. Intersect the eye ray with the plane `y = lvl` to get `W`. This is exactly the surface point the eye looks through.
2. Build the surface normal at `W` from: the flow-mapped normal (baked fBm, two phases); the standing-wave terms near
   ledges; the event slots (boils, chutes, spate).
3. Return:
   - **Fresnel** (Schlick, written as products), multiplied by `rbSky(reflect(V, n))`, the same sky function along the
     mirrored ray. No reflector, no second render.
   - **Refraction offset** `Δ = (refract(V, n, 1/1.33) − V)·depth`. The caller re-evaluates its procedural patterns
     (bed mosaic, caustics) at `P.xz + Δ`, which is fake refraction with no `viewportSharedTexture`.
   - **Beer absorption** `exp(−σ·depth·(1/cosθv + 1/cosθs))`, with σ = (0.42, 0.085, 0.06) per metre for
     crystal-clear water: aqua in the shallows, sapphire in the kettles.
   - **Glitter**, foam and white water.

Bed and fronds both call it. There is no transparent water layer, no overdraw from one, and no sorting problem between
fronds and water. Waterline: `depth = lvl − P.y` fades the surface in over 1 cm, and a 3 cm band of wet-rock darkening
sits above it. **[amended: §3.10, fronds evaluate the water terms per vertex]**

#### Per element

| Element | Technique | Notes |
|---|---|---|
| **Sky** (`-sky.js`) | Far-plane backdrop triangle (the `serenity-warp` pattern). `rbSky(u, dir)` is analytic: a cerulean-to-haze gradient, a sun aureole (Mie-like `(1−g²)/(1+g²−2g·cosθ)^1.5`, with the cosine clamped and powers written as products, gotcha #94) that brightens the upper left although the sun is out of frame, and a horizon humidity band | Also returns the Serranía, forest and savanna bands. Used for the sky, the water's Fresnel reflection and the aerial-perspective target colour |
| **Serranía tableland** | Inside `rbSky`: a CPU-baked 1D crest profile (flat top, cliff-edge falloffs, 512×1 RGBA8 `DataTexture`, `.level(0)`) gives a mask `elev < crest(az)` | Shading: aerial perspective toward `#7C82B4`, vertical cliff striations from 1D noise, a lit rim, thread falls as thin flowing lines at hashed azimuths, the shower veil as soft vertical noise. A second and third band (savanna, gallery canopy) use fBm crests with lit tops. Cost: a few ALU per sky pixel |
| **Convective tower** | 1–2 camera-facing impostor quads reading a CPU-baked 256² field (thickness and pseudo-normal from a union of about 40 spheres, baked once) | Growth by threshold plus domain warp from the 2D fBm; wrap lighting with a silver sunward edge and a grey-blue base. Phase is driven by the clock. No marching |
| **Cloud shadows** | `rbCloudShadow(P.xz)` reads the 2D fBm in sun-projected, wind-advected coordinates; coverage comes from S and the convective phase **[amended: §3.9]** | Shared by bed, fronds and falls, so shadow and colour dimming always agree |
| **Riverbed** (`-bed.js`) | A CPU heightfield mesh, finer near the eye (the `ocean-seabed.js` pattern), built from the seeded plan (`-plan.js`): a centreline spline, cross-flow ledges (quantised, warped steps with rounded `smin` lips), shelves and channels | Per-vertex `aFlow` (vec2, m/s), `aLevel` (water level) and `aMask` (frond-bed, sand, algae and patina weights; cavity occlusion baked on the CPU), interleaved |
| **Bed shading** | Mosaic classification from `aMask` plus 2D fBm, evaluated at the refracted coordinate. Lambert plus wrap lighting from the sun, skylight ambient, baked occlusion, cloud shadow, **caustics**, then `rbSurface` | Beyond the frond-geometry range (tiers), the bed paints **procedural frond mats**: flow-aligned anisotropic streaks in the season's frond colours, animated along the flow. The far reach reads as weed with no geometry |
| **Caustics** **[amended: §3.4, demoted]** | A small tileable **light-pattern target** painted each frame (or every 2nd/3rd) by a `QuadMesh` with the **analytic Jacobian caustic** of a tileable wave sum h(x) (8–12 sinusoids with integer wave vectors): `I = 1/max(ε, abs(1 − d·(hxx+hyy) + d²·(hxx·hyy − hxy²)))`, with ε = 0.08 so it stays bounded | **Chromatic:** a different `d` per channel (refraction depth × dispersion) gives real spectral fringes. RGBA8, `RepeatWrapping`, `generateMipmaps` (verified on both backends by Ocean, `src/themes/ocean/ocean-tsl.js`). Surfaces read it **flow-advected and flow-stretched** (two phases, like the normal). **Depth blur from the sun's 0.25° half-angle:** `.level(log2(1 + depth·k))`. **Standing chevrons** downstream of ledges: the 1D closed form `1/max(ε, abs(1 − d·A·k²·cos(k·s + φ)))`, with a fixed φ and a 3 Hz amplitude shimmer. Scaled by sun direction, S and cloud shadow |
| **Glitter** | In `rbSurface`: house `glintLobe(slope, variance, V, sun)` (`src/themes/sunset/sunset-tsl.js`) for statistical sparkle, plus a hashed facet lattice in surface space (cells floored at about 1.2 buffer pixels, gotcha #147) | HDR peaks so they alone cross the bloom knee. Total sparkle light budgeted per tier (gotcha #120) |
| **Fronds** (`-fronds.js`) **[amended: §3.10]** | Instanced ribbons, one `InstancedInterleavedBuffer` (gotcha #99): `aAnchor` (x, z, bedY, flowAngle), `aLook` (length, width, seed, phase), `aTone` (ripeness offset, species variation, side, bed id). Scattered on the CPU where the current is fast, depth is 5–40 cm and the mask is frond-bed, and **only in visible free regions** (composition-aware, as Verdant Hills does with grass) | **Vertex stage, closed form:** the ribbon lies along the flow and hugs the bed near its root, then lifts. Flutter `A0·s²·sin(2π(f·t − k·s) + φ)`. Stretch from `comb` (chute, spate, combo flow). Lift from boil slots. Emergence (flowering, drought) lets tips break the surface; otherwise `y ≤ lvl − 1 cm`. A refraction wobble shifts xz by `n.xz·(lvl − y)·0.75`. **Fragment:** a lobed silhouette from `uv` (SDF), `alphaTest` 0.5 with `depthWrite` on (gotcha #129). Colour from the ripeness ramp, the season row and per-instance variation. **Thin-leaf transmission** toward the sun (ruby glow when backlit), wrap diffuse, a wet rim sheen, caustics read at the frond's xz (light rolls along the fronds), lock-blush mix, then `rbSurface` |
| **Flowers** | Instanced 5-lobe SDF sprites anchored to frond tips by evaluating the same tip formula in their own vertex stage | Dormant (zero size) until bloom > 0 (La Floración, Rose Flowering season). Delays hashed per flower **[amended: §3.14, the uniform is `flowering`]** |
| **Pearling beads** **[amended: §3.11, deleted]** | Instanced tiny sprites rising from frond positions (0.25 m/s, wobble, hashed lifetimes), popping into glints at `lvl` | Dormant unless pearling > 0 (combo ×7+, Pearl-up) |
| **White Curtain and ledge curtains** (`-falls.js`) | Sheet meshes following a ballistic lip curve. Flowing streak noise stretched along the fall and accelerating (v²). Translucent white-turquoise body; edge threads | Ledge curtains are one instanced strip type with a `whiteness` per ledge group, so sluice and spate can whiten them |
| **Spray** | 2–8 camera-facing noise sheets with Beer extinction plus a **Henyey–Greenstein** forward-scatter term (g = 0.6) toward the sun | Densities from the 2D fBm with drift; reads `rbCloudShadow` |
| **Kettles** | **Analytic ray–spherical-cap tracing in the bed fragment**, which needs no geometry change. The eye ray entering a kettle's disc is intersected with the cap below to shade wall, sand floor and water fill (Beer by depth) at the true hit point. Los Ochos is the union of two caps | Static kettles from the plan plus up to 8 drilled ones (event rows `x, z, r, age`), looped only inside a terrace-mask `If`. Pebbles are tiny instanced impostors orbiting in closed form with a sun glint. The swirl is a rotating polar normal term in `rbSurface` inside the disc |
| **Gallery forest and palms** (`-life.js`) | Instanced camera-facing fan-palm cards (radial-leaflet SDF and trunk, wrap-lit, swaying), in front of a canopy backdrop band | 0–30 instances by tier |
| **Dragonflies** | 2–4 instances × (body + 4 wing quads), closed-form Lissajous hover with darts; wing glint averaged sub-pixel | Off on Minimal |
| **FX** (`-fx.js`) **[amended: §3.5–§3.8, §5.4]** | **Sluice sheets:** instanced strips placed in world space at the card flank (composition ray-cast), streak-shaded glass with white edges, premultiplied over. **Comet, chute, spate and standing waves:** not geometry; they are rows in the event table read by `rbSurface`, the caustic sampler and the frond vertex stage. **Pebble skips:** instanced impostors on closed-form hops. **Flower drift and Pearl-up fizz:** reuse the flower and bead pools | Event table: boils and comets 10×2 rows, sluices 8×2, chutes 4×2, spate 1×2, standing waves 2×1, kettles 24×1 (16 static + 8 drilled), skips 6×2. About 98 rows in one vec4 array, so a stage binds 2 uniform buffers (events plus palette) instead of approaching 12 (gotcha #102) |
| **Post** (`-post.js`) | House pipeline: scene pass (MSAA 4× High and up), max-channel-knee bloom with threshold 1.0, so only glints, caustic knots and spray bloom. Calm zones (round-box SDF, house clip). **"Tropic filmic"** tone map (hue-preserving shoulder, k about 0.5, whitening only above a peak of 4). Grade: neutral-warm highlights, faintly teal shadows, saturation 1.04. Vignette 0.22, grain 0.01, dither | No rush, no shafts, no fringe (there is no hero light, and the camera never moves). FXAA on Medium and Low for thin fronds (Sunset precedent). Event exposure ≤ 0.15 |

Render order: fronds 10 (opaque, alpha-tested); flowers and pebbles 12; bed 20; falls 30; palms 35; backdrop sky 50
(`LessEqualDepth`, far plane, last among opaque); spray 60; sluice sheets 70; beads and dragonflies 80.
**[amended: §5.2, sluice sheets and beads are gone]**

#### Quality tiers (as proposed) [amended: §5.8]

"Every tier keeps the whole picture and every event."

| | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Bed grid (vertices) | 96×64 | 128×96 | 160×128 | 200×160 | 240×192 | 280×224 |
| Frond instances × segments | 4k × 6 | 8k × 8 | 16k × 10 | 26k × 12 | 38k × 12 | 52k × 14 |
| Frond geometry range (painted mats beyond) | 6 m | 9 m | 13 m | 18 m | 22 m | 26 m |
| Caustic target / update / channels | 128² / every 3rd / 1 | 192² / every 2nd / 1 | 256² / 1 / RGB | 384² / 1 / RGB | 512² / 1 / RGB | 512² / 1 / RGB |
| Surface normal octaves | 1 | 1 | 2 | 2 | 3 | 3 |
| Glitter lattice | statistical lobe only | coarse | full | full | full | full + second scale |
| Frond transmission term | off | on | on | on | on | on |
| Spray sheets / tower impostors | 2 / 1 | 3 / 1 | 4 / 2 | 6 / 2 | 7 / 2 | 8 / 2 |
| Flowers / beads | 600 / 300 | 1.2k / 600 | 3k / 1.5k | 6k / 3k | 9k / 4k | 12k / 6k |
| Palms / dragonflies | 0 / 0 | 8 / 2 | 14 / 2 | 20 / 3 | 26 / 4 | 30 / 4 |
| AA / bloom | none / off | FXAA / off | FXAA / 0.33 | MSAA 4× / 0.45 | MSAA 4× / 0.5 | MSAA 4× / 0.5 |
| Pixel-ratio cap (house) | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |
| **Estimated GPU, 1080p desktop iGPU** (unverified, ADR-0016) | ~2.5 ms | ~3.5 ms | ~5.5 ms | ~8 ms | ~11 ms | ~14 ms |

Rough split at High: bed and surface about 2.5 ms; fronds about 2.5 ms (vertex about 1, fragment about 1.5); sky, tower
and backdrop about 0.5; falls and spray about 0.8; caustic paint about 0.2; post about 2. These are budgets to verify
with the profile harness, not claims.

**What Minimal and Low drop.** Each term is dropped in JavaScript, never by substituting constants (gotcha #135): the
second surface octave; chromatic caustics (luma only); the frond transmission term (Minimal only); the glitter lattice
(Minimal keeps the statistical lobe); dragonflies (Minimal) and palms (Minimal); bloom. The river, the five colours,
the caustics, the kettles, the falls and every event remain.

**Phone strategy.**
- Fronds are scattered only where the composition says the free regions are. On an upright phone that is the band
  below the card and the far reach above it, so a 10k budget looks dense.
- The painted frond mats carry everything beyond the range.
- Caustic target 192–256², every 2nd frame; one normal octave; no MSAA.
- Phone-portrait FOV handled in the image plane for any disc (gotcha #153). The upright layout is captured at every
  tier before sign-off (gotchas #71, #147).
- Pixel-ratio caps as for the house.

#### WebGL2-backend risks and their guards (as proposed; §5.9 is the full list)

1. **Nested `select` with `Fn` calls** (gotcha #89) inside the mosaic classifier or kettle tracer: fold conditions into
   one `select(a.and(b), …)` and `.toVar()` the value first. The `forceWebGL` leg is verified in the playground every
   session.
2. **Uniform buffers:** one event array plus one palette array keeps each stage far under 12. **Vertex buffers:** frond,
   flower and bead attributes are interleaved, so 8 is never reached on WebGPU.
3. **Render-target mips:** the caustic target is RGBA8 with `generateMipmaps` (proven by Ocean). No half-float target is
   needed, so there is no `EXT_color_buffer_float` dependence.
4. **Unbounded maths:** caustic reciprocals are clamped with ε; the aureole cosine is clamped and its powers written as
   products; `exp()` terms are bounded before masking (gotcha #71, the portrait black-region trap); integer-coded
   instance seeds are read with `floor(x + 0.5)` (gotcha #87).
5. **Alpha test with MSAA on thin ribbons:** clamp interpolated `uv` (gotcha #105). FXAA on the tiers without MSAA.
6. **No `Data3DTexture` or `lut3D`.** Every texture is 2D, which keeps the headless SwiftShader verification green.

#### Module split (as proposed; §5.2 has the amended list)

```
src/themes/riverbloom/
  riverbloom-core.js         three-free: season palettes, ripeness ramp, event timings, Jacobian wave set, S (sun credit) maths, tier-free constants
  riverbloom-plan.js         three-free, seeded: centreline, ledges, shelves, water levels, flow field, static kettles, Los Ochos/White Curtain set pieces, frond scatter (composition-aware)
  riverbloom-tsl.js          uniform bag `u`, laid-out hashes, fBm and tower bakes, rbSky / rbSurface / rbCaustic / rbCloudShadow builders, caustic paint pass, material helpers
  riverbloom-sky.js          backdrop (sky, Serranía, forest bands) + tower impostors
  riverbloom-bed.js          heightfield mesh + bed material (mosaic, kettles, caustics, painted far mats)
  riverbloom-fronds.js       fronds + flowers + pearling beads
  riverbloom-falls.js        White Curtain, ledge curtains, spray sheets
  riverbloom-life.js         palms, dragonflies
  riverbloom-fx.js           sluice sheets, pebble skips, drift reuse; event-row writers
  riverbloom-world.js        RiverbloomWorld (shared by theme + playground): parts, event slots, timed queue, seek/replay, season/clock/S state
  riverbloom-director.js     clone of ocean-director (try/finally, `broke`) + serenity-warp shape/cells; adds B2B-break inference, line counting for seasons, MP cascade stash
  riverbloom-composition.js  clone of serenity-warp composition + '#online-main-board canvas'; set-piece placement from free regions and HUD; row → river-surface anchor
  riverbloom-post.js         RiverbloomPost (RenderPipeline) + POST_LOOK per tier
  riverbloom-quality.js      QUALITY tiers (table above), tierFor()
  riverbloom-theme.js        BaseTheme adapter (clone of the serenity-warp adapter, renamed)
  riverbloom-tetrominos.js   §1.6
  riverbloom-theme-icon.png  512² circle: close-up of crimson fronds streaming under glass water past a kettle rim, caustics, a turquoise pool, the Serranía at the top edge
src/playground/effects/riverbloom.effect.js   mounts the same world + post; serenity-warp param set (+ catalogue rows)
```

- **Parts** for `?riverbloomParts=` and the playground's `parts=`: `sky, bed, fronds, falls, life, fx`. The URL-catalogue
  row lives in `src/ui/url-parameters/theme-parameters.js`.
- **New playground event values** (`b2b`, `release`, `gameOver`, `restart`) need catalogue entries. If they are added,
  the shared `event` parameter's `values` must be extended. (Since then Rainbark added `release`, `b2b` and `gameOver`;
  only `restart` is new.)

**Playground-first build order (as proposed)**, one small effect per session: 1. bed and caustics (`parts=bed`); 2.
`rbSurface` on the bed; 3. fronds; 4. sky, tableland and tower; 5. falls and spray; 6. kettles; 7. FX events one by one.
Each step gets a screenshot plus a clean console on WebGPU, the `forceWebGL=1` leg, the Low tier and a 390×844
portrait. Iterate against a local Caño Cristales reference with `?ref=…&refMode=split`. Keep the reference out of the
repo. **[amended: §5.6 adds a CPU lab first and acceptance shots per step]**

### 1.8 Why it will be breathtaking, and why it resembles nothing in the catalogue

**Why breathtaking (the proposal's case):**
- **It is a living material, not a lit object.** No theme has a field of tens of thousands of combed, translucent,
  sun-ripened fronds moving under glass. Its motion is continuous, organic and directional. The eye can rest on it for
  minutes.
- **The open slot in the palette.** High-key tropical daylight, saturated by sun rather than neon: crimson and magenta
  against turquoise and sapphire, on cream rock under a cerulean sky. The fleet survey made for the competition agrees
  this register is almost empty (13 of the 15 themes in one quarter of the catalogue are night, dusk or void).
- **Light you can believe.** Real Jacobian caustics with dispersion and depth blur, standing chevrons in place below the
  ledges, a Fresnel gradient that turns the far reach to sky, thin-leaf ruby transmission, and the cloud-shadow
  switch-on that real visitors describe. The physics does the art direction.
- **A grammar players will remember.** The river ripens through its real colour sequence. T-spins drill giant's kettles
  that stay. B2B holds a standing wave. Hard drops feed kettles their pebbles. A perfect clear makes the riverweed
  flower. A game over is the dry season, and a restart is the first rain. Every verb is native to *this* river.
- **Depth from motion.** Everything flows toward the viewer, so every event is also a lesson in perspective.

**The three closest existing themes, and the precise differences:**

| Theme | What it shares | Precise differences |
|---|---|---|
| **koi-pond** ("the moonwake pond") | Clear water with caustics; colour seen under water; plants | Koi-pond is **night**, a **still pond seen steeply from above**, with koi, lilies, red maple, a stone lantern and the moon *in* the water. Its caustics come from a wave simulation on half-float targets, its refraction from `viewportSharedTexture` (`src/themes/koi-pond/koi-pond-water.js`), and its lock is **rings plus a pebble of light arcing out of the card**. Riverbloom is **high tropical day**, a **fast shallow river seen from 12° down looking upstream**, with no fish, lilies or lantern. Its colour is riverweed mats. Its caustics are analytic, **flow-stretched, chromatic, with standing chevrons**. The water is a function with no refraction texture. **No rings anywhere**: the lock is a lens-boil carried downstream. |
| **ocean** ("the reef canyon") | Sunlit chromatic caustics on a coloured bed; plants in a current; bubbles | Ocean is **underwater looking up** through Snell's window, with coral, kelp, fish schools, turtle, mantas, whales and post shafts. Its combo **summons animals**; its lock sinks light to colonies that **hold the colour**. Riverbloom is **above the water**, with one plant species in mats **combed** (not swaying kelp), no creatures summoned and no shafts. Its combo ripens the plants through their **real biological colour sequence**. Its beads are photosynthetic pearling seen from above, appearing only at combo ×7+ and on release, not the bubble sheets and crowns of the reef. **[amended: §3.11, no beads at all]** |
| **halcyon-apex** ("sanctuary of first light") | Daylight; turquoise water; warm stone | Halcyon is a **golden dawn with a low sun in frame**, a **planar-mirror lagoon**, a stepped pyramid, floating crystals and ley lines. Its lock uses a wisp and **held light in great crystals**; its quad uses a **hush**. Riverbloom is **mid-afternoon with the sun out of frame**, **flowing** water (Fresnel only in the far reach, no reflector), no architecture or crystals, and **crimson** as the key. Its quad is a spate with no hush. |

Also checked:
- **waves:** jade water, spray. Riverbloom's water is colourless and the colour lives in the bed, with no tube, surf or dolphins.
- **verdant-hills:** daylight with cloud shadows. Here the shadows dim a river's plant colour; there is no meadow, kite or
  fair-weather cumulus field (one convective tower over a tableland).
- **The other seeds on the table:** Iris Springs (geothermal pools, microbial mats, steam, geyser) and Painted Ages
  (strata, rain-driven combo, rainbow on release, a flash flood of silt). Riverbloom has no steam, no geyser, no rain
  combo and no sky rainbow. Its quad is a clear-water spate inside a living river.

**Catalogue motifs deliberately avoided:** moon, stars, nebula, aurora; mirror lake or reflector; crystals or gems;
hexagonal columns; sea of clouds; low sun on the horizon, god-rays; tree frames at the screen edges (the palms sit on a
far bank); rings from the card's foot; sparks that keep colour; blades of light; one front per line; hush then flare;
spiral round the card; hour wheel; camera dip; fireflies or motes; petals thrown from the card; lanterns, ribbons,
kites, meteors.

### 1.9 Top risks and mitigations (as proposed)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Shallow water must read as water while staying nearly invisible.** Without enough cues, the scene reads as "red seaweed on a floor". | Four simultaneous cues: refraction wobble, caustics (travelling and standing), glitter and foam on the breaks, and Fresnel sky in the far reach. Plus a 3 cm wet-dark band at every waterline. Iterate reference-driven in the playground (`refMode=split`) before porting. Capture a single still at `t` fixed: if a still reads as water, the motion will too. **[amended: §3.3]** |
| 2 | **Frond cost on phones and the iGPU** (vertex count, alpha test defeating early-z). | Composition-aware scatter (fronds only in visible free regions); painted far mats beyond the geometry range; tier counts in the table above; fronds drawn first so the bed is depth-rejected under them; a dynamic-resolution hook if the profile harness shows overruns. Measure High and Medium with `profile=1&trackTimestamp=1` before choosing defaults. **[amended: §3.10]** |
| 3 | **Board readability against saturated crimson.** | The deep sapphire channel always runs behind the card. Calm zones soft-clip, as in the house. Fronds are scattered away from the card rectangle. Crimson-family pieces (I, J, S) separated by luminance. Colour-vision simulation captures. |
| 4 | **Garishness:** "liquid rainbow" could tip into candy. | All colour is albedo × sunlight (no emissive weed). Hue-preserving tone map with gentle saturation (1.04). Real absorption coefficients. Ripeness stages stay inside the plant's real green, gold, red and magenta range. The prismatic caustic stage only appears at ×6 and is capped in intensity. **[amended: §3.11, stage deleted]** |
| 5 | **Overlap with koi-pond and ocean** on caustics and bubbles. | Caustics are supporting, never the hero, and their signature (flow-stretched, standing chevrons, daylight on pale rock) differs. Pearling only at combo ×7+ and on release. The above-water viewpoint is non-negotiable. **[amended: §3.4, §3.11]** |
| 6 | **Flow-map pulsing and seams** on the surface and caustics. | Two-phase blend with a noise-offset phase; tile frequency decoupled from phase length; flow stored per vertex and smooth. Capture at three `t` values to check for pulsing. |
| 7 | **Kettle drilling needs to change the terrain** at run time. | No geometry change: analytic ray-cap tracing in the bed fragment, with the kettle list in event rows, gated by a terrace-mask `If`. Drill sites come from precomputed candidate positions per side and height band, so they never land in water or behind the card. |
| 8 | **Layout variance** (21:9, upright phone, HUD on either side, 4-player multiplayer). | Set pieces placed from the free regions in `-composition.js`. The river is wide enough to always carry fronds in every free region. Phone variants for sluice and boil (bottom lip). Per-board flank anchoring in multiplayer. Portrait captured at every tier. |
| 9 | **The sun credit could feel like punishment** if the river dims while the player struggles. | Floor of 0.55 (moody, never dark). Relaxes to 0.85 with no events. Full in menus. Coverage changes slowly (τ ≥ 8 s). If playtests show it reads as negative, drop it to a pure clock cycle (one constant). **[amended: §3.9, dropped now]** |
| 10 | **Photosensitivity:** glints, glitter carpets and the prismatic stage. | Glints are small, random and unsynchronised; per-tier total-light budget; event intensities use `max()`, never sums; no flash; exposure lift ≤ 0.15 on two events only; `prefers-reduced-motion` path (§1.5). |
| 11 | **Odyssey placement.** If the theme being replaced is an Odyssey level's backdrop, the new theme inherits that level through the retired-id alias. Worked example: Cosmic Chimes was the theme of level 47 "Singularity Gate" and of the chapter-6 pool, and a tropical river behind a "Singularity Gate" level would have been a mood mismatch (Rainbark renamed that orb "The Painted Giants"). | Check the replaced theme's Odyssey uses (`src/core/odyssey/data/levels.js`, `src/core/odyssey/data/chapters.js`) and either retitle the level for a river (keep the orb's slot, change its name, copy and `transitionIn`) or accept the mismatch (the theme is the level's backdrop, not its story). Ask the user. |
| 12 | **Scope.** About 14 modules plus a playground effect is a large build, and full-journey WebGPU captures have TDR-crashed the dev iGPU. | Strict playground-first, one element per session. Every element is useful alone: the bed with caustics is already a frame. The FX are event rows read by existing shaders, so most events add almost no new pipelines. |

### 1.10 Sources used by the proposal

- [Caño Cristales, Wikipedia](https://en.wikipedia.org/wiki/Ca%C3%B1o_Cristales)
- [Colombia's Liquid Rainbow, World Book](https://www.worldbook.com/behind-the-headlines/Colombia-s-Liquid-Rainbow)
- [Caño Cristales, the Rainbow River, Geography Realm](https://www.geographyrealm.com/cano-cristales-rainbow-river/)
- [The science behind the river of five colors, SlashGear](https://www.slashgear.com/1420578/science-behind-river-five-colors-colombia/)
- [Caño Cristales, Atlas Obscura](https://atlasobscura.com/places/cano-cristales)
- [JBL expedition podcast, Caño Cristales](https://jbl.de/en-dk/podcast/detail/7)
- [Caño Cristales guide, tomplanmytrip](https://www.tomplanmytrip.com/travel-to-colombia/destinations-in-colombia/llanos-orientales/cano-cristales/)
- [Caño Cristales natural wonder, Colombia Travel](https://colombia.travel/en/la-macarena/cano-cristales-natural-wonder)
- [Podostemaceae, Britannica](https://www.britannica.com/plant/Podostemaceae)
- [Podostemaceae introduction, National Museum of Nature and Science (Kahaku)](https://www.kahaku.go.jp/research/db/botany/podostemaceae/2introduction.html)
- [Lake caustics, Atmospheric Optics](https://www.atoptics.co.uk/fz129.htm)
- [Bubble optics, arXiv 1909.04401](https://arxiv.org/pdf/1909.04401)
- [Caustic (optics), Wikipedia](https://en.wikipedia.org/wiki/Caustic_(optics))

---

## 2. What the judges said

Three judges each read all six proposals in full and scored them 0–10 on their own lens. Riverbloom's three scores:
art **6.0**, rendering **6.0**, play **8.0**, total **20.0 / 30**, 4th of 6.

### 2.1 Art director: 6.0 (6th of 6)

**Lens.** Beauty, originality against the 61-theme catalogue (setting, palette, composition, motifs and FX grammar), wow
factor, depth, atmosphere and lighting, how the theme reads as a still and in motion, surprise, and the name. Strict
about resemblance.

**Strengths.**
- **An at-a-glance unique palette:** crimson and magenta weed under glass-clear water on cream rock, with sapphire kettles.
- **The most alive ambient motion in the slate.**
- **Everything flows toward the viewer,** which is a smart depth cue.
- **The best individual beats:** T-spins drill giant's kettles that persist for the session; hard drops feed those
  kettles their circling pebbles; the perfect clear makes the riverweed flower (La Floración); the combo ripens the weed
  through its real colour sequence; game over is the dry season, and a restart is the first rain.

**Weaknesses.**
- **Caustics are central** to the lock (a caustic knot comet) and the combo (prismatic caustics), yet they are named on
  both koi-pond's and ocean's avoid lists.
- **The clear's "sluice" reskins the house grammar.** Glass sheets pour over both card flanks at each cleared row's
  height: the house twin-jet/blade grammar in water clothing.
- **More house grammar:** the lock fires at the card edge at the piece's height in the piece's colour, the quad is a bore
  front running outward from the card, and the pearling bubbles are ocean's.
- **Water fills the bottom two-thirds,** and the far reach turns into a sky-coloured Fresnel ribbon, which reads like the
  fleet's water-across-the-bottom.
- **As a still it risks reading as "red seaweed on a floor".** The proposal names this risk itself.
- **The name is the weakest:** generic and garden-centre in feel.

**Worth grafting (from Riverbloom into the winner).** The kettle-drilling T-spin with persistent pits; hard drops
feeding the kettles; La Floración as a perfect clear; a ripeness ladder through a real biological colour sequence;
"sun credit", cloud shadow as a quiet readout of how the stack is going; water as a function every submerged surface
applies to itself, with no transparent layer; dry season and first rain as the game-over and restart pair.

**Slate-wide findings that touch Riverbloom.**
1. **The rainbow has become the slate's own cliché** (Iris, Painted Ages and Sunfall make a placed bow a headline
   payoff; the fleet already has rainbow motifs in tornado, chromadelic-highway and singing-bowl). Use it at most once,
   as a grace note. The judge did not list Riverbloom among the three, but its ×6 "liquid rainbow" caustic stage is the
   same move; §3.11 removes it.
2. **Almost every lock is a softened "the world holds the colour":** something in the piece's colour appears beside the
   card at the piece's height, then fades over 18–90 s. The judge names "Riverbloom blushes" among them (Iris blooms,
   Painted Ages fans, Sunfall leaves, Rainbark bands); only Haft Rang's live Sun Rug broke the pattern.
3. **Composition template.** Every concept puts a hero on the left and a secondary on the right (here the Kettle Terrace
   and the White Curtain), the template the catalogue survey asks to break.
4. **Lighting slot.** Golden hour is the fleet's most overused light; high sun or morning daylight is the open slot.
   Riverbloom's high sun is in the open slot.

**Verdict line.** "Riverbloom donates its kettle and flowering beats." And for whatever wins: use the rainbow no more
than once; keep the decay world-native (bleach, green, ripen), never "held then released"; source a clear's colours from
the real cells of the cleared row (Painted Ages' "shadow well").

### 2.2 Rendering lead: 6.0 (4th of 6)

**Lens.** Can it be built in three r186 TSL so it looks right on WebGPU and on the WebGL2 backend? Cost on phones and
iGPUs; procedural without models; how cheap it looks if it falls short; compile and pipeline cost; board readability.
Look-per-millisecond is rewarded; beauty that depends on volumetrics, refraction passes or extra render targets is
penalised.

**One line.** "'Water as a function' and analytic Jacobian caustics are excellent ideas. But the hero is 26k
alpha-tested fronds, each running the surface function, so it degrades hard on phones. Shallow water that reads as
water is a known hard problem."

**Repo precedents the judge checked.** Verdant Hills ships 18k near + 40k far grass clumps at High, so the frond counts
are in a range the house has already shipped. Ocean paints a tileable RGBA8 light-pattern `RenderTarget` with
`generateMipmaps` and verified it on both backends, which covers the caustic target.

**Strengths.**
- **`rbSurface` (water as a function) is the cleverest water plan on the table.** Every submerged surface intersects the
  eye ray with the water plane and applies Fresnel times the analytic sky, a refraction offset into its own procedural
  pattern, and Beer absorption. No transparent water layer, no sorting and no `viewportSharedTexture`.
- **Analytic Jacobian caustics:** one small tileable RT with an ε-bounded reciprocal; per-channel depth gives spectral
  fringes; mip LOD gives the sun's 0.25° blur with depth. Precedent: Ocean's pattern target.
- **Kettles by analytic ray–cap tracing** need no geometry change.

**Weaknesses.**
- **The hero is geometry density with an expensive fragment.** At High, 26k fronds × 12 segments, alpha-tested and
  running `rbSurface`, caustics and transmission per fragment. The concept's own estimates (High ≈ 8 ms, Extreme ≈ 14 ms)
  are the second-worst. On phones (4k–8k fronds and "painted mats" beyond 6 m) the hero thins out and looks cheap.
- **Alpha test on thin fluttering ribbons shimmers.** It needs `alphaToCoverage` on MSAA tiers, and FXAA does not fix
  temporal crawl (#105).
- **A still frame of 5–40 cm clear water must read as water.** A hard art problem, and the concept says so.
- **Tech overlap with koi-pond and ocean** (caustics, bubbles) reduces its technical novelty.

**Graft offered to the winner (6th of the judge's 8).** "Riverbloom's 'surface as a function' principle: for any thin
layer (wet film, kino gloss), shade it inside the host material instead of adding a transparent layer."

**Verdict line.** "Iris Springs and Riverbloom lean on techniques that look cheap when under-delivered (sheet steam and
billboard geysers; dense alpha-tested fronds)."

### 2.3 Gameplay-feel designer: 8.0 (3rd of 6)

**Lens.** How spectacular, colourful, satisfying and world-native each event is; readability at 1–3 locks per second;
whether combos escalate and release clearly; novelty against the house FX grammar; clean mapping to board positions;
photosensitivity; how the theme feels after 20 minutes. Frequency weighting: a 20-minute session has roughly 600–900
locks, 150–250 clears, 10–40 four-line clears, a few T-spins and almost no perfect clears. Lock and clear set the feel;
four lines and perfect clears are the moments players remember.

**One line.** "Best B2B (standing wave), T-spin (kettle) and perfect clear (La Floración). The clear's water sheets down
the card flanks are the house twin jets in another form. Sun credit punishes a player who is struggling."

- **Lock (Quicken).** A lens-boil at the card edge at the piece's height, which magnifies the fronds and focuses a
  caustic knot. The current then carries it downstream toward the viewer as a comet. Calm, physical, never held, and
  every event becomes a depth cue. **But the piece's colour is only a 40% blush and a fringe, so colour recognition is
  weaker than Iris's or Rainbark's.**
- **Clear (Sluice).** Glass sheets slip over both card flanks at each cleared row's height and fall down the card's
  outside edge, then a chute races downstream with flaring fronds and a carpet of glitter. **The chute is lovely, but the
  sheets are the house "twin jets from both card edges at row height" pointed downward, and they move right against the
  board's edges on every clear.**
- **Four lines (Tapete Rojo).** A single bore runs from the card toward the viewer, and every frond ignites crimson behind
  it. Very colourful, real hydraulics, exposure lift ≤ 0.15.
- **Combo (Ripen).** One stage per link in the plant's real colour sequence, spreading from the card. Pearl-up fizz on
  release, scaled by peak. **Two overlaps blur it:** season I's resting look is already ripe crimson; four lines also ends
  at "peak magenta-crimson".
- **Strongest beats in the whole set:** B2B, a standing-wave train that persists while the chain lives; T-spin, a giant's
  kettle drilled into the rock that stays all session; hard drop, the pebble that joins a kettle's orbit; perfect clear
  (La Floración), the river stills, turns invisible, and flowers; game over and restart, drought, then the first rain.
- **Sun credit** dims the river by −0.03 per lock that clears nothing. The visuals sink exactly when the player is under
  pressure, which is negative feedback at the worst moment. **Cut it, or make it a clock-only cycle.**
- **Glitter** carpets and field glints are budgeted and random, so they are acceptable for photosensitivity, but they
  **need a hard total-luminance cap**.

**Ideas the judge offered other concepts from Riverbloom.** B2B as a standing shape held in moving water; a T-spin that
leaves a permanent record, like a drilled kettle; a hard drop that feeds a persistent collection, like the kettle
pebbles; a perfect clear in which the world goes still and clear before it blooms; a restart rite (the first rain);
everything flows toward the viewer.

**Engineering note for every concept.** All six put a reward on the combo release, and the house `ComboTracker` reports
a break one lock late. `PIECE_LOCK` and wave 1's `LINE_CLEAR` are emitted in the same synchronous tick, so the director
can infer at `flush()` that a lock with no clear in the frame breaks the chain, and deliver `combo(0)` on the breaking
lock itself.

### 2.4 The research round (before the judges)

The seed was candidate #9 of 33, "LIQUID RAINBOW (alt: Cristales, River of Five Colours)", ranked **3rd** of the top 5:
"The only candidate whose spectacle is moving colour inside clear running water. The caustics, streaming crimson fronds
and five-colour combo ladder are very original and very joyful. It ranks below #1 and #2 because believable shallow
water (refraction, caustics, flow) costs more and is harder to get right on phones, and because it sits a little near
koi-pond and ocean." Phone risk: moderate. Similarity: low to moderate (koi-pond, ocean, waves).

The seed's own sketch, kept for reference: palette `#D81E4A` crimson, `#FF5F7A` coral pink, `#F4C430` sand yellow,
`#3FA34D` algae green, `#1A1A1F` black rock, `#6FD3E8` water blue, `#F2E8D5` pale stone; lock "a ribbon of the
piece's colour streams downstream", clear "the river surges and the fronds flare", combo "each step adds one of the five
colours", four lines "a surge carries spray and a rainbow down the whole reach", T-spin "an eddy whirlpool". Its scene
was tropical late afternoon over pale pocked rock with round potholes, rock shelves and small falls, the tableland,
savanna and tall cumulus, with hummingbirds and mist off the falls; its technique line was a flow-mapped surface, a UV
offset for refraction, **procedural Voronoi caustics** and instanced frond strips swaying along the flow. The proposal
(§1) replaced most of these: high 15:00 sun instead of late afternoon, dragonflies instead of hummingbirds, analytic
Jacobian caustics instead of Voronoi, and the rainbow and whirlpool dropped deliberately.

### 2.5 Why it did not win

It was last on art (the name, the still-frame risk, and three pieces of house grammar), fourth on rendering (a dense,
expensive alpha-tested hero that thins on phones), and only third on play despite holding the best B2B, T-spin and
perfect clear in the slate, because its two most frequent beats (lock and clear) were the weakest or most house-like.
Its best ideas were offered to the winner; Rainbark took two of them (§4.1). Everything below fixes the named problems
while keeping what made the judges single it out.

---

## 3. Required changes before building

**This section overrides §1.** Every weakness a judge named has a fix below, plus the cross-cutting findings and the gaps
found while writing this document. §5 is already written against these fixes. §3.17 is the authoritative event table.

### 3.1 Every named weakness, and its fix

| Judge | Weakness | Fix (details in the subsection named) |
|---|---|---|
| Art | Caustics are central to the lock (caustic knot comet) and combo (prismatic caustics), and are on koi-pond's and ocean's avoid lists | **Caustics demoted to ambient light** (§3.4): no caustic knot, no prismatic stage, capped share of the bed's light, a flow-stretched signature on pale rock only, never on a dark bed, never the subject of an event. |
| Art + Play | The clear's sluice sheets over both card flanks are the house twin-jet/blade grammar, and they move right against the board's edges on every clear | **Flank sheets deleted** (§3.6). Each cleared row spills a **ledge in the world**, chosen by casting the row's ray onto the water, with the visible spill starting ≥ 0.04 screen width from the card. A chute then races toward the viewer carrying ten braids in the cleared row's own cell colours. |
| Art | The lock fires at the card edge, at the piece's height, in the piece's colour (house) | **The Boil** (§3.5) keeps the board mapping (a play strength) but carries no light: the colour appears in one of the river's own materials (frond tips in air, a puff of sand, or an eddy of deep water), then leaves downstream within 3.5 s. Nothing is fired, nothing glows, nothing is stored. |
| Art | The quad is a bore front running outward from the card | **The Spate comes from upstream** (§3.7): a swell out of the far bend that follows the channels, splits round the Kettle Terrace and passes behind the card. It is never centred on the card and never radial. |
| Art + Tech | The pearling bubbles are ocean's | **Pearling and Pearl-up deleted** (§3.8, §3.11). The release is **the Wash**: stations spill in reverse with sunlit spray veils. No bubbles anywhere. |
| Art | Water fills the bottom two-thirds; the far Fresnel ribbon reads as the fleet's water-across-the-bottom | **Oblique camera and a diagonal braided reach** (§3.2): the near-left is a rock shelf, ledges run on diagonals, the far reach bends away behind the gallery forest, and the frame shares are measured (water ≤ 45% of non-card pixels, rock ≥ 25%). |
| Art + Tech | As a still it reads as "red seaweed on a floor"; shallow water that reads as water is a known hard problem | **Seven-cue still recipe** (§3.3), a **CPU lab before any shader** (§5.12), a blind still test and a "no water" A/B gate. |
| Art | The name is generic and garden-centre in feel | **Stage 0 decision with the user** (§3.13). Recommended: "Crimson Reach". |
| Tech | The hero is geometry density with an expensive fragment; High ≈ 8 ms, Extreme ≈ 14 ms; on phones the hero thins and looks cheap | **Painted mats carry the look on every tier; geometry fronds are the near accent** (§3.10): clumped opaque ribbons, water terms evaluated per vertex, a footprint fade into the mat, fewer vertices (High 378k against 676k). Targets: High ≤ 6 ms, Low ≤ 3 ms (estimates until measured, ADR-0016). |
| Tech | Alpha test on thin fluttering ribbons shimmers; needs `alphaToCoverage` on MSAA tiers; FXAA does not fix temporal crawl | **No alpha test by default** (§3.10): geometric silhouettes with a vertex width profile. Lobed SDF edges only on MSAA tiers, with `alphaToCoverage` (supported by both r186 backends). Fronds narrower than 1.5 buffer pixels collapse into the mat. |
| Tech | Tech overlap with koi-pond and ocean (caustics, bubbles) | §3.4 (caustics demoted, distinct signature) and §3.11 (no bubbles). |
| Play | Lock colour recognition is weak (a 40% blush and a fringe) | **Material flush at 85% piece colour** (§3.5): frond tips prick the surface and are seen in air at full chroma; T lifts gold sand; O and L open an eddy of deep coloured water. Minimum on-screen size; a ΔE gate in captures. |
| Play | Combo overlaps: season I's rest is already ripe crimson; four lines also ends at peak magenta-crimson | **Rest is a mosaic** at a season-dependent ripeness (0.55 in season I); **the combo is a spatial reach with six counted stations**; **the Spate ends in the four cleared rows' mosaic**, not peak crimson (§3.7, §3.8). |
| Play | Sun credit punishes a struggling player | **Cut** (§3.9): cloud shadow follows the clock only. Gameplay can only *lift* shadows (positive only). |
| Play | Glitter carpets need a hard total-luminance cap | **Per-tier cap** on pixels above the bloom knee, max-combined, measured in false colour (§3.15). |
| Play (engineering note) | The combo break reaches the theme one lock late | **Infer the break on the breaking lock** (§5.3). `src/themes/rainbark/rainbark-director.js` already does it: clone it. |
| Cross-cutting | The rainbow is the slate's own cliché | **No rainbow anywhere** (§3.11): the ×6 prismatic caustic stage is deleted; spray scatters silver-white; dispersion survives only as faint fringes on caustic lines. |
| Cross-cutting | Decay must be world-native, never "held then released" | Fronds ripen back, sand settles, eddies fill, kettles silt, the water clears, the river dries. Nothing stores a colour and nothing is released (§3.16). |
| Cross-cutting | Take a clear's colours from the real cells of its row | Shadow well → the chute's ten braids (§3.6) and the Spate's mosaic (§3.7). |
| Cross-cutting | Infer the combo break on the breaking lock | §5.3. |
| Cross-cutting | Avoid the house FX grammar listed in `docs/theme-concepts/README.md` | Checked item by item in §3.16. |
| Gap (this file) | The piece palette collapses under colour-vision deficiency: O/S ΔE 8.6 (deuteranopia), O/Z 8.1 (tritanopia), Z/J 12.4 (protanopia). The proposal's own fallback (lift L) does not touch these pairs | **Amended hexes** (§3.12): worst pair ΔE 22.9, still 0/7 on the palette gate. |
| Gap (this file) | Name collisions in code: Rainbark already uses the `rb*` prefix (`rbAir`, `rbHash`, `rbBark`…); "bloom" is the post effect; "Quicken" sits next to Rainbark's combo "Quickening" | Prefix `rv*`, flower uniform `flowering`, lock named **the Boil** (§3.14). |
| Gap (this file) | Standing-chevron shimmer at 3 Hz on bright HDR lines; habitual hard drops would send 600+ pebble skips a session | Chevron shimmer 1.6–2.4 Hz, hashed per chevron, ±15%; at most one pebble skip per 1.5 s (§3.15). |
| Gap (this file) | Anything that lands behind the card is never seen (gotcha #144): the "three ledges behind the card" and any station or anchor there | Every station, ledge spill and anchor is clipped to the free regions; ledges behind the card count only by their visible ends (§3.6, §3.8, §5). |
| Gap (this file) | Rainbark now exists and shares the biomes daylight slot and a "ripening" vocabulary | §4. |

### 3.2 Composition: an oblique view of a diagonal, braided reach

**Why.** The art judge's "water across the bottom" and "silver Fresnel ribbon". Looking straight upstream turns every
cross-flow ledge into a horizontal line and every metre of river into a horizontal band.

**The amended rig (16:9 reference, 1920×1080, level 1, `t=60`).**
- Eye **2.6 m** above the water on the dry quartzite shelf, pitch **12° down**, vertical FOV **50°** (unchanged), horizon
  about 27% from the top.
- **Yaw 28° to the right of the flow axis.** The river now enters from the upper left (far, behind the gallery forest) and
  sweeps toward the lower right (near), so the current still comes toward the viewer, diagonally. Cross-flow ledges read
  as diagonals.
- **Near-left foreground is rock:** the shelf the viewer stands on (dry, cream-and-rose lobes, dry and brimming kettles
  floored with gold sand) runs into **the Kettle Terrace**, which now fills most of the left panel's lower half.
  The **left channel** runs between the terrace and the forest bank.
- **The deep sapphire channel still passes behind the card** (composition rule kept).
- **Near right is the rapids ramp**, with its standing waves at the foot, flowing out of the lower-right corner.
- **The far reach bends left behind the gallery forest about 140 m out.** No long grazing sheet of water reaches the
  horizon, so there is no silver ribbon. Fresnel remains physical (Schlick on every surface) and is seen in the mid reach
  at 10–35%, broken by emergent rock and frond tips.
- **Vertical accents at three depths:** near (a rock rib with a dry kettle lip, and one palm on the near-left bank at
  21:9), mid (the White Curtain's 3 m fall), far (thread falls and the convective tower).

**Measured shares** (by a class-mask debug view, `mask=1`, §5.5; at 16:9, 21:9 and 4:3, excluding the card and HUD rects):

| Class | Target |
|---|---|
| Visible water surface (any depth) | ≤ 45% |
| Rock, dry or emerged (shelf, terrace, ribs, ledge tops) | ≥ 25% |
| Sky, Serranía, savanna and forest | 18–30% |
| Ledge, bank and waterline lines within ±8° of horizontal | none longer than 30% of the frame width |

**Upright phone.** Eye **3.4 m**, pitch **24°**, vertical FOV **68°** (unchanged), **yaw 18°**: the river runs from the
top-left behind the card to the bottom-right below it. The White Curtain sits above the card, Los Ochos below it, and a
strip of shelf rock lines the bottom edge (≥ 12% of the frame height), so the bottom band is not wall-to-wall water.

**21:9.** Vertical FOV about 44°, same yaw. The extra width shows the gallery bank (6–8 more fan palms) on the left and
the White Curtain whole on the right, as proposed.

**Also from the slate finding** (hero left, secondary right): the split is now cause and effect along the flow (water
leaves the rapids on the right; the terrace on the left is where the river drills and stores), and the set pieces move
with the free regions, so the left/right roles are not fixed on every layout.

### 3.3 The still must read as water: seven cues and two gates

**Why.** The art judge's and rendering lead's shared worry, and the proposal's own risk #1. If a still reads as water,
the motion will too.

| # | Cue | Specification |
|---|---|---|
| 1 | **Waterline contact** | Every emerged rock meets the water with a 1 cm surface fade and a 3 cm wet-dark band (albedo ×0.62, gloss up), plus a 2–4 cm bright meniscus glint line on the sun side. Above-water rock is matte, warm and dry; below-water rock is aqua-tinted, caustic-lit and refracted. The contact line is the strongest single cue. |
| 2 | **Refraction break** | Edges of submerged features (ledge lips, kettle rims, frond locks) are displaced by the refraction offset where they cross surface slope changes: 2–6 px at 1080p in fast water near the camera, 0–1 px in pools. Straight submerged edges must look broken in a still. |
| 3 | **Surface marks over the bed** | Foam lines along streamlines below ledges (1.5 m/s, fade over 6 m) and bead clusters; V-wakes behind emerged frond tips and rocks (2–5 cm surface wrinkles); standing-wave chevrons below ledges. These sit visibly *on top of* the bed pattern and do not follow it. |
| 4 | **Glitter** | The lower-left sparkle zone and the breaks over ledges only; small, random, desynchronised (§3.15 cap). |
| 5 | **Depth colour** | Beer σ = (0.42, 0.085, 0.06) per metre: at 40 cm the bed visibly shifts to aqua; kettles go sapphire; the deep channel behind the card is clearly blue-teal (not black). |
| 6 | **Fresnel** | Mid-reach water reflects the analytic sky at 10–35%, brightening toward grazing angles, broken by emergent rocks. |
| 7 | **Caustics** | Low contrast in the 5–15 cm shallows, crisper in 30–40 cm runs, stretched along the flow up to 3:1, blurred with depth (§3.4). |

**Gate 1, the blind still.** Show one still (`t` fixed) at 960×540 and at a 160 px thumbnail to a reviewer who has not
seen the work (the user, or a fresh critic session). It passes only if they answer "a shallow, fast, clear river" (or
equivalent) without prompting. Answers like "a red carpet", "seaweed on a floor", "a rug", "coral" or "a map" fail.

**Gate 2, the no-water A/B.** Render the same frame with the water function disabled (`water=0`, §5.5). At least 60% of
the river's pixels must change by ΔE ≥ 6, and the waterlines, foam lines and wakes must disappear. If the frames look
nearly the same, the water is not doing its job.

### 3.4 Caustics are supporting light, never the subject

**Why.** Caustics are on koi-pond's and ocean's avoid lists, and the art judge objected to their central role in the
lock and the combo.

- **No event is "about" caustics.** The lock's caustic knot and comet are deleted (§3.5); the ×6 prismatic stage is
  deleted (§3.8, §3.11). Events change the water (domes, chutes, swells), and the ambient caustic pattern responds only
  as physics dictates (a lens magnifies what is under it; a swell's slope changes the pattern for a moment).
- **Capped share of the bed's light:** caustic modulation contributes at most 25% of the bed's irradiance in the shallows
  and 40% in runs over 30 cm (measured in false colour; tune `d` and the wave amplitudes, not a gain knob).
- **Signature distinct from koi-pond and ocean:** always flow-advected and flow-stretched (never isotropic cells), always
  in daylight on pale quartzite or gold sand, never a bright net over a dark bed, plus fixed standing chevrons below
  ledges, which neither neighbour has.
- **Dispersion:** per-channel `d` differs by at most 6%, so colour fringes are faint and appear only at the edges of the
  brightest lines. Never a spectral field.
- The piece-cell "caustic shimmer" stretch (§1.6) is dropped.

### 3.5 Lock: the Boil (replaces Quicken)

**Why.** Three findings at once: caustics as the lock's hero (art), "card edge, piece height, piece colour" (art), and
weak colour recognition (play). The board mapping itself was praised and stays.

**Anchor.** As proposed: the side follows the piece's centroid column (`u < 0.42` left, `u > 0.58` right, otherwise both
sides at 0.6 strength). The point is the river-surface hit of the ray through the card edge at the piece's centroid row,
stepped outward until it is ≥ 0.02 screen width outside the card and HUD rects (gotcha #144). The boil is elongated
along the flow to the **piece's row span** projected onto the water (a vertical I makes a long lens, an O a round one).
Minimum on-screen diameter: 1.2 cell heights (cell height = board height / 20), on every layout.

**Timeline.**

| Time | What happens |
|---|---|
| 0.00–0.12 s | The surface swells into a glassy dome, 8 cm high at its peak (0.12 s). As a lens it magnifies the fronds below ×1.3 and bends their lines sharply at its rim. One small sun glint sits on its crown (≤ 1.5× the bloom knee, a few pixels). **No caustic knot.** |
| 0.05–0.9 s | **The colour, in the river's own material** (by the piece's family, table below), at 85% of the piece's hex. |
| 0.3–2.4 s | The dome flattens and the current carries a **wake** downstream at the local flow speed: a 1.5 m V of combed fronds whose pale undersides flash (`#F2E6E0` at 60%), carrying the colour at its head and the season's colour at its tail. |
| 2.4–3.5 s | The colour **ripens back** into the season (fronds), settles (sand) or fills in (eddy). Nothing remains. No site holds the colour longer than 3.5 s. |

**The colour carrier by piece family** (every piece colour is a river material; §3.12 hexes):

| Pieces | Carrier | Detail |
|---|---|---|
| I (crimson), S (magenta), J (coral), Z (jade) | **Frond tips prick the surface** | 12–30 tips break the surface inside the dome (emergence = 1). Emerged tips are seen through air (no Beer, no Fresnel), wet-glossy, at `mix(season colour, piece colour, 0.85)`, quivering (flutter ×1.5). All four colours are real stages of the plant. |
| T (sand gold) | **A puff of gold sand** | 60–140 grains (instanced sprites from the drift pool) lift from the bed inside the dome, swirl once and trail down the wake, settling over 2.5 s, tinted toward the piece's hex. |
| O (turquoise), L (azure) | **An eddy of deep water** | A swirl dimple (radius 0.4 m, 6 cm surface dip, rotating polar normal) whose Beer depth is deepened by 0.5 m, so the water inside reads as `mix(Beer colour, piece colour, 0.7)` (0.7 rather than 0.85 because the deepened Beer colour is already turquoise-to-azure; tune the mix until the colour-recognition gate below passes). It drifts down the wake and fills in over 2 s. It is a transient hollow in the water, not a pit in the rock (that is the T-spin's kettle). |

**Limits and safety.** Up to 10 alive; strength ×0.7 above 4 alive; intensities combined with `max()`. No light is
emitted by any carrier except the single crown glint.

**Phone.** The boil sits just below the card's bottom lip, under the piece's column (as proposed); the wake streams down
the screen into the near rapids.

**Hard drop (the Plunge), unchanged except §3.15:** dome ×(1.6 + distance/20), capped at ×2.2; a white-turquoise cloud of
aerated water rushes 1.5 s downstream; a pebble skips 3–6 hops (glint and gold puff per hop) to the nearest kettle on
that side and joins its orbit (≤ 3 per kettle, the oldest settles). At most one pebble skip per 1.5 s; plunges without a
skip still burst.

**Colour-recognition gate.** In a capture at `eventAge=0.5`, the mean tone-mapped colour of the carrier region is within
ΔE 15 of the piece's hex for the frond and eddy families and within ΔE 20 for sand.

### 3.6 Clear: the Spill and the Chute (replaces the Sluice)

**Why.** The flank sheets were the house twin jets pointed downward (art and play). The chute itself was praised
("lovely") and stays.

**Which ledges.** The plan has **5 near ledges per side** (`L0` nearest the camera … `L4` farthest) and **3 long
ledges** across the river behind the card (`B1`–`B3`), whose visible ends count as ledges on both sides. For each cleared
row and each side: cast the row's ray through the card edge onto the water (the proposal's anchor rule), then pick the
**nearest ledge downstream** of that point on that side. If two rows pick the same ledge, the second takes the next
ledge downstream; if none is left, the nearest unused ledge upstream. Visible spill segments are clipped to the free
regions and start ≥ 0.04 screen width from the card. High rows therefore spill far ledges (higher on screen) and low
rows near ledges, so the picture still maps to the board, but nothing touches the card's edges.

**Timeline (per cleared row, lowest row first, 0.12 s apart).**

| Time | What happens |
|---|---|
| 0.00–0.15 s | The chosen ledge's lip **brims and spills**: its curtain thickens to white water 0.3–0.5 m tall along its visible length (curtain whiteness → 1). |
| 0.15–1.35 s | The spill holds; its spray glints (small). It decays over 0.8 s. |
| 0.2–3.0 s | From each spilling ledge a **chute** races downstream toward the viewer at 3 m/s: a smooth glassy tongue as wide as the ledge segment (2–4 m). Under it fronds comb to 1.6× length; tips that break the surface glitter (capped, §3.15); foam streamers trail its edges. |
| 0.2–3.0 s | **The ten braids (shadow well):** across the chute's width, ten equal along-flow lanes take the cleared row's ten cell colours in order (the left cell is the braid on the viewer's left), each in its native material at 85% of the cell's hex: frond flush for I, S, J and Z cells; a gold sand streak for T; a deepened turquoise or azure water lane for O and L; black patina for GARBAGE; pale quartzite for CLEAN_GARBAGE. |
| 3–9 s | The braids **ripen back** (fronds), settle (sand) and clear (water), the far end first, so the colour drains downstream like the real river. |

**Count and size.** Spilling ledges per side = lines. **1 line:** the chute reaches mid-panel. **2:** the frame bottom.
**3:** it fills the near reach, every small ledge in both panels whitens for 1.2 s, and the White Curtain doubles for a
moment (as proposed).

**Gravity cascades.** Each cascade wave k ≥ 2 spills the next ledge downstream on both sides and launches a chute at
×0.7 length, so a cascade reads as a staircase of spills: the game's cascade is a water cascade.

**Phone.** The chosen ledges are the near-rapids ledges below the card, stacked downward from its bottom lip; chutes run
down the screen. Braids stay ten lanes across the chute.

**Meditation clicks.** A chute launched from the nearest ledge to the click's `x` at the bottom of the frame, with a
neutral season-coloured flush (no row cells exist), rate-limited to 2 per second.

### 3.7 Four lines: the Spate (replaces Tapete Rojo)

**Why.** The bore ran outward from the card (art); four lines ended at the same peak crimson as the combo's top and season
I's rest (play); and the clear must take its colours from the real rows (cross-cutting).

| Time | What happens |
|---|---|
| 0.0 s | Four courses lift at once: the visible ends of `B1`–`B3` and one near ledge per side spill white. |
| 0.2 s | Upstream, the held river **drops a hand's width**: the far ledges emerge glistening as the reach empties (kept). |
| 0.3 s | The White Curtain **thunders**: streak speed ×1.6, spray density ×2. |
| 0.3–2.6 s | **The Spate arrives from upstream.** A long, low glassy swell with a rolling white crest comes out of the far bend, **follows the channels** (it races down the rapids first, splits round the Kettle Terrace and reaches the left channel 0.3 s later), passes **behind the card** (calm zone), and runs out of frame toward the viewer. It is the only travelling front in the theme, it is hydraulic, and it is never centred on the card. |
| behind the swell | Every frond in view streams to double length and **flushes into a mosaic of the four cleared rows' 40 cells**: each frond-bed patch (0.6–1.5 m, flow-stretched 2:1) hashes into one of the 40 cell codes, weighted by frequency, and shows it in its native material (frond flush, gold sand fan, deepened turquoise or azure pool, patina, quartzite). Patches, never stripes. **Los Ochos overflows**, its rims sheeting with water. Every ledge becomes a white curtain. Caustics brighten only as the swell's slope dictates. |
| 2.6–12 s | The river lies wet and gleaming in your rows' colours, then **ripens back** to the season's rest over 10 s, the far reach first. |

- Spray scatters **silver-white** (Henyey–Greenstein, g = 0.6); no spectral sparkles and no bow.
- Exposure: measured mean-luminance lift ≤ +0.15 stop (rise ≥ 400 ms, decay τ ≥ 800 ms), no hush, no darkening, no white
  flash. The board's own gold screen flash on four lines sits on top, so keep this one small.
- **Positive-only sun:** the Spate lifts any cloud shadow off the river for 20 s (§3.9).
- **Reduced motion:** a 1.2 s cross-fade into the mosaic with a slow comb (as proposed); no travelling swell.

### 3.8 Combo: six stations up the river, and the Wash on release

**Why.** Play: rest already ripe; quad ends at the same colour; no discrete per-link beat that can be counted at a
glance. Art: prismatic caustics (rainbow) and pearling (ocean's bubbles). Engineering: the release must land on the
breaking lock.

**Rest ripeness per season** (the season ramp texture holds the season's §1.3 colours at its rest ripeness r_s and
always reaches peak carmine-magenta at 1.0; the rest look is a real mosaic, never uniform):

| Season | I Crimson Run | II Magenta Peak | III Rose Flowering | IV Gold Ebb | V First Rains | VI Green Turning |
|---|---|---|---|---|---|---|
| Rest ripeness r_s (mean; patches ±0.2) | 0.55 | 0.65 | 0.60 | 0.50 (emerged: dried amber/straw) | 0.15 | 0.30 |

**Stations.** Link n ≥ 2 lights **station n − 1** (max 6). The order is fixed, near to far:

| Station | Place (16:9) | Lit at | What else changes (the proposal's ladder, kept where legal) |
|---|---|---|---|
| S1 | `L0`/`L1` near ledges, both panels | ×2 | Jade fronds near the card turn gold. Caustic advection speed ×1.2 (not brighter). |
| S2 | `L2`/`L3` mid ledges | ×3 | The near reach goes crimson; foam lines lengthen ×1.5. |
| S3 | The visible ends of `B2`, both sides of the card | ×4 | The shallows flush magenta; kettles deepen to sapphire by contrast. |
| S4 | The far reach, up to the bend | ×5 | One continuous red ribbon up to the forest. |
| S5 | Los Ochos brims | ×6 | Its rims sheet with water; spray drifts into the light. |
| S6 | The White Curtain doubles | ×7 | The whole visible river at peak. |
| — | ×8 and beyond | — | Each further link pulses every lit ledge lip once (the beat continues; no new station). |

- **Each link's discrete beat (0–0.8 s):** the new station's ledge lip glints and spills white for 0.6 s, and a ripeness
  front runs from the card's foot up the river to it in 0.8 s; everything up to that station ripens to 1.0 (uniform
  carmine-magenta with tip sparkle).
- **A glance counts the chain:** lit stations (white-lipped, with ripened water up to them) = chain − 1, up to 6.
- **Phone stations:** S1–S3 are ledges below the card, stacked downward; S4 is the far reach above the card; S5 Los Ochos
  (below); S6 the White Curtain (above).
- In season V (First Rains, r_s 0.15) a chain turns a green river red up to the stations: the most dramatic case, and
  the one to check.
- No prismatic caustics and no pearling at any length. While a chain lives, cloud shadows avoid the ripened reach
  (positive only).

**Release: the Wash** (`combo(0)` after peak p ≥ 2, delivered on the breaking lock, §5.3):

| Time | What happens |
|---|---|
| 0–1 s | The flow eases; fronds settle back to normal length over 2 s. |
| 0 to 0.12·(p − 1) s | Lit stations **release in reverse order** (far to near), 120 ms apart: each ledge lip spills a short white curtain that throws a **sunlit spray veil** (silver forward scatter, HG g = 0.6), which drifts downstream past the card toward the viewer for 4–8 s. |
| 0–20 s | Ripeness ebbs to the season's rest, far reach first (the colour drains downstream). |

The amount follows the **peak**: p = 2–3 spills the near ledges with a faint veil; p ≥ 7 spills every station and veils
drift across the whole river. A break never reads as a collapse. No bubbles. **Resume:** a combo rise within 0.6 s of a
release (asynchronous multiplayer clears) relights stations without restarting the Wash.

### 3.9 Sun credit is cut: the cloud shadow follows the clock

**Why.** Play: "the visuals sink exactly when the player is under pressure". The proposal's own risk #9 named the same
fallback.

- **Deleted:** +0.12 per line, −0.03 per lock that clears nothing, the 40 s relaxation to 0.85.
- **Kept:** the convective breath (§1.3) drives cloud-shadow coverage on its own 300 s clock: few shadows when Fair, more
  when Building, **the one large crossing** (about 12 s, crimson to wine, pools to teal, then the switch-on) during the
  Shower, clear skies when Clearing. Under the deepest shadow the river still has bluish skylight at about 35% of sun.
- **Positive-only gameplay hooks:** the Spate and La Floración lift any cloud shadow off the river for 20 s; a live combo
  keeps shadows off its ripened reach. Nothing in play ever dims the river.
- Menus: no cloud shadow on the river.

### 3.10 Fronds: mats first, cheap geometry second

**Why.** Rendering lead: a dense hero with an expensive fragment that degrades hard on phones, plus alpha-test shimmer.

1. **The painted mat is the base on every tier.** The bed's procedural frond mat (flow-aligned streaks in the season
   ramp, animated along the flow) is authored first and must carry the look alone: the Minimal tier (6 m geometry range)
   must still read as the crimson river. In the CPU lab (§5.12) build the mat as line-integral-convolution (LIC) of noise
   along the flow field; on the GPU use 4–6 taps of the baked fBm along the flow direction, or a small baked LIC tile
   advected by two phases.
2. **Geometry fronds are clumps.** One instance is a clump of 3–4 ribbons sharing an anchor, a flow angle, a bend and the
   water terms; per-ribbon offsets come from the instance seed. Fewer instances, one attribute fetch per clump (still one
   `InstancedInterleavedBuffer`, gotcha #99).
3. **Opaque silhouettes, no alpha test by default.** The lobed, ruffled outline comes from a width profile evaluated in
   the vertex stage (taper plus a low-frequency sine ruffle along the ribbon). `depthWrite` on, no `alphaTest`, so early-z
   works and nothing crawls.
4. **Lobed SDF edges only on MSAA tiers** (High and up), with `material.alphaToCoverage = true`. Both r186 backends honour
   it when the scene pass is multisampled (`node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js` sets
   `alphaToCoverageEnabled` when `sampleCount > 1`; the WebGL2 backend's
   `node_modules/three/src/renderers/webgl-fallback/utils/WebGLState.js` checks `currentSamples > 0`). Drive alpha through `colorNode`/`opacityNode` with
   `alphaTest`, so `NodeMaterial` applies its `smoothstep(alphaTest, alphaTest + fwidth(a), a)`; a custom `fragmentNode`
   bypasses that path (compare gotcha #111).
5. **Water terms per vertex.** In the frond vertex stage, intersect the eye ray with `y = lvl` at each segment vertex and
   compute Fresnel, Beer transmittance and the refraction offset there; pass them as one `vec4` (transmittance rgb,
   Fresnel) and one `vec2` (offset) varying. Fronds are small on screen, so the interpolation is invisible. The fragment
   stage does only: ramp lookup, thin-leaf transmission, wrap diffuse, one caustic tap at `.level(n)` (Medium and up),
   the wet sheen, and the statistical glint lobe (no facet lattice on fronds).
6. **Footprint fade.** When a ribbon's projected width falls below 1.5 buffer pixels, its width collapses to zero over
   the next 0.5 px and the mat underneath carries the colour (no sub-pixel crawl, gotcha #147).
7. **Draw fronds first** (opaque) so the bed fragment under them is depth-rejected.
8. **Budgets** (estimates until measured with `profile=1&trackTimestamp=1`, ADR-0016): Minimal 2.2 ms, Low 3.0, Medium
   4.5, High 6.0, Ultra 8.5, Extreme 11 at 1080p on a desktop iGPU. Vertex count at High: 7k clumps × 3 ribbons × 9 rows ×
   2 = 378k, against the proposal's 26k × 13 × 2 = 676k.

### 3.11 No bubbles, no rainbow

- **Deleted:** pearling beads (the instanced bead pool, `pearling` uniform), the Pearl-up fizz, the ×7+ pearling stage.
- **Deleted:** the ×6 prismatic caustic stage ("a liquid rainbow, made of real optics"), the spectral sparkles in the
  four-line spray, and "liquid rainbow" in any copy.
- **Kept:** foam beads in clusters below ledges (surface foam, not rising bubbles); faint dispersion fringes on caustic
  lines (§3.4).
- **The rainbow budget is zero.** The five colours of the river are the theme's spectrum.

### 3.12 Piece colours, amended (colour-vision fix)

**The problem, measured** (Machado 2009 simulation at full severity, applied in linear RGB, CIELAB ΔE76; the method the
Rainbark spec and the Iris Springs document use):

| Vision | Proposed palette: worst pairs |
|---|---|
| Normal | I/J 35.7, O/Z 47.2 |
| Protanopia | **Z/J 12.4**, S/L 20.9 |
| Deuteranopia | **O/S 8.6**, I/Z 14.5 |
| Tritanopia | **O/Z 8.1**, S/J 18.2 |

Turquoise O and magenta S become nearly the same colour for deuteranopes; turquoise O and jade Z for tritanopes; jade Z
and coral J for protanopes. Rainbark's palette, for comparison, has its worst pair at ΔE 19.4.

**Amended palette** (0/7 on `npm run check:palette`; the names and roles stay; each hue within 20° of the proposal):

| Shape | River name | Hex | Hue | Rel. luminance | CIE L\* | Guideline band avoided |
|---|---|---|---|---|---|---|
| I | Macarenia Crimson | `#D60A45` | 342.6° | 0.149 | 45.6 | cyan 160–210 |
| O | Kettle Turquoise (sunlit shallow) | `#4FE8EE` | 182.3° | 0.655 | 84.8 | yellow 32–75 |
| T | Sand Gold | `#F7C030` | 43.4° | 0.577 | 80.6 | purple 245–315 |
| S | Shallows Magenta | `#D25AB8` | 313.0° | 0.245 | 56.6 | green 90–170 |
| Z | Sprout Jade | `#2FB27F` | 156.6° | 0.340 | 64.9 | red 320–20 |
| J | Coral Tip | `#EC7238` | 19.3° | 0.302 | 61.8 | blue 200–250 |
| L | Deep-Run Azure | `#3873E6` | 219.7° | 0.188 | 50.5 | orange 20–50 |
| GARBAGE | Patina Ink | `#3A3340` | — | 0.036 | 22.4 | — |
| CLEAN_GARBAGE | Quartzite | `#CDBFB2` | — | 0.535 | 78.1 | — |

| Vision | Amended palette: worst pairs |
|---|---|
| Normal | O/Z 37.9, I/J 41.5 |
| Protanopia | S/L 24.6, Z/J 26.4 |
| Deuteranopia | O/S 23.2, T/J 23.8 |
| Tritanopia | O/Z 22.9, Z/L 24.5 |

Worst pair overall: **ΔE 22.9** (from 8.1). The warm trio is now I 342.6°, S 313.0°, J 19.3° (29.6° and 36.7° apart) with
luminances 0.149 / 0.245 / 0.302. The lightness order is turquoise 84.8, gold 80.6, jade 64.9, coral 61.8, magenta 56.6,
azure 50.5, crimson 45.6. Re-run the simulation if any hex changes (unit test, §5.10), and check the real board under
protanopia, deuteranopia and tritanopia filters in a game capture.

Piece config (`src/themes/riverbloom/riverbloom-tetrominos.js`, same shape as Rainbark's
`src/themes/rainbark/rainbark-tetrominos.js`; the cell look is the proposal's):
```js
export const RIVERBLOOM_TETROMINOS = {
    version: 2,
    colors: {
        I: '#D60A45', O: '#4FE8EE', T: '#F7C030', S: '#D25AB8',
        Z: '#2FB27F', J: '#EC7238', L: '#3873E6',
        GARBAGE: '#3A3340', CLEAN_GARBAGE: '#CDBFB2',
    },
    renderMode: 'solid',
    effects: {
        premium: true,
        phaser: {
            gradient: true, highlight: 0.24, shadow: 0.2,        // wet top-left light, darker foot
            rim: true, rimAlpha: 0.42, rimWidthFactor: 0.05,     // the stone's edge
            gloss: true, glossAlpha: 0.2,                        // a film of water
        },
    },
    rendererOverrides: {},
};
```
The constant must be referenced by the theme (the palette gate warns about dead configs). The world uses these same hexes
for the lock carriers (§3.5) and the braids and mosaic (§3.6, §3.7), converted with `srgbToLinear`.

### 3.13 The name (a Stage 0 question for the user)

The art judge called "Riverbloom" the weakest name in the slate: generic, garden-centre. Options, with the id each implies:

| Name | id | For | Against |
|---|---|---|---|
| **Crimson Reach** (recommended) | `crimson-reach` | English, specific, evokes the picture (a reach is a stretch of river) without claiming a real place | Loses the flowering idea |
| Cinco Colores | `cinco-colores` | The river's own nickname ("river of five colours") | Needs translation for most players |
| Tapete Rojo | `tapete-rojo` | A real named stretch; "the red carpet" | Spanish; a carpet is not obviously a river |
| Riverbloom | `riverbloom` | Already used throughout this file | The judge's objection; "bloom" also names the post effect in code (§3.14) |

Ask the user before Stage 0. If the name changes, change the id, folder, class, capture prefix and constants together;
this file keeps its name.

### 3.14 Names in code

- **Prefix `rv`, not `rb`:** Rainbark's modules already export and use `rbHash`, `rbAir`, `rbBark`, `rbLuma`, `rbMax`,
  `rbPatchAge`, `rbHgMix` and more. Riverbloom's builders are `rvSky`, `rvSurface`, `rvSurfaceVertex`, `rvCaustic`,
  `rvCloudShadow`, `rvRamp`, `rvKettle`, and its laid-out helpers `rvHash21`, `rvSchlick`, `rvHg`, `rvAureole`,
  `rvJacobian`, `rvFilmic`, `rvRoundBoxSdf`, `rvDecodeCodes`.
- **Never `bloom` for flowers.** "Bloom" is the post effect (and the playground's `bloom=` parameter). The flowering state
  is `flowering` (0–1), the ripeness is `ripeness`, the combo reach is `reach`.
- **"The Boil", not "Quicken":** Rainbark's combo gauge is called "Quickening".
- **No "pearl" anywhere.**
- Constants: `RIVERBLOOM_TETROMINOS`, `RIVERBLOOM_PARTS`, `RIVERBLOOM_EVENT_HANDLERS`, `LOG_PREFIX = '[Riverbloom]'`;
  classes `RiverbloomTheme`, `RiverbloomWorld`, `RiverbloomPost`, `RiverbloomDirector`; capture prefix `riverbloom`
  (`?riverbloomTime=`, `?riverbloomFixedDt=`, `?riverbloomParts=`, `?riverbloomFalseColor=`, `?riverbloomForceWebGL=`).

### 3.15 Photosensitivity and calm, amended

- **Glitter cap.** At any moment, pixels above the bloom knee from glints and glitter are ≤ 0.4% of the frame at rest and
  ≤ 0.8% during a chute or the Spate (event glitter density at most ×2 ambient, combined with `max()`). Measured in
  `falseColor=1` captures; the cap is enforced by a per-tier density constant, not by clamping brightness.
- **Standing chevrons** shimmer at 1.6–2.4 Hz, hashed per chevron, amplitude ±15% (was 3 Hz in phase). No large area
  modulates at 3 Hz or more.
- **Pebble skips** at most one per 1.5 s (habitual hard drops would otherwise send 600–900 skips a session).
- **Exposure:** only the Spate (≤ +0.15 stop) and La Floración (≤ +0.15 stop) lift measured mean luminance; never a flash
  frame, never pure white, HDR clamped hue-preservingly before bloom.
- **Motion near the card:** wakes, chutes, braids and veils always travel *away* from the card (downstream) and never
  enter the card or HUD rect plus a 0.02 margin; the vertex stage fades anything that would.
- Everything else in the proposal's photosensitivity and reduced-motion rules stands (§1.5), with the additions in §3.17.

### 3.16 House FX grammar check

The authoritative list is in `docs/theme-concepts/README.md`. This table checks the patterns known when this file was
written (the research's "one shared gameplay grammar" and the house patterns the judges named):

| House pattern | Riverbloom (amended) |
|---|---|
| A spark or wisp of the piece's colour leaves the card into a site that keeps that light | Absent. The boil rises *in the river*; its colour is a material (frond tips, sand, deep water), carried away downstream within 3.5 s. |
| A site holds the piece's colour for ~30 s, then a clear releases it | Absent. No site stores colour; nothing is released. Decay is ripening, settling, clearing. Kettles persist but hold no colour (their pools take depth colour only). |
| Blades of light at the cleared rows; twin jets from both card edges | Absent. White water spills at *world ledges* chosen by the rows' rays, ≥ 0.04 screen width from the card; it is a material on a ledge line, not a beam, and not fired from the card. Residual similarity: it is bilateral and row-correlated. Keep the spills on the ledges' own diagonal lines and never let them touch the card edge. |
| One wave front per line | Absent. Per line: one ledge spill and one chute. The only front is the Spate's swell on four lines, which comes from upstream. |
| Four lines: hush or darkening, then a flare | Absent. No hush, no darkening; ≤ +0.15 stop. |
| A spiral, wheel, garland or creatures circling the card | Absent. The kettle's pebble spins inside a pothole on the shelf; dragonflies never orbit the card. |
| An hour wheel of palettes | Absent. Seasons are levels; the convective breath is weather. |
| Camera dip or kick on hard drop | Absent. The camera never moves for gameplay. |
| Rings from the card's foot or the piece's column | Absent. No rings anywhere (the eddy is a swirl dimple; the first rain shows no rings). |
| Prism ring or rainbow arc on four lines | Absent (§3.11). |
| Exposure flash on clears | Absent. |
| "The board paints a permanent picture" / rows written into the world as stripes | Braids are along the flow (the real river's braids), transient (≤ 9 s), and the Spate's mosaic is patch-wise, never banded. No permanent record of row colours. |

### 3.17 The amended event language (authoritative; replaces §1.5's table)

| Event | Name | Where | What you see | Lasts |
|---|---|---|---|---|
| Lock | **the Boil** | The river beside the piece's rows (phone: below the bottom lip) | A glassy lens dome; the piece's colour as frond tips in air, a sand puff or a deep eddy; a wake downstream | ≤ 3.5 s |
| Hard drop | **the Plunge** | Same, folded into the lock | Bigger dome bursting into aerated water; a pebble skips to a kettle (≤ 1 per 1.5 s) | 1.5 s; the pebble stays |
| Clear ×1–3 | **the Spill and the Chute** | World ledges picked by the rows' rays, both sides | Ledges spill white; chutes race toward the viewer with ten braids in the row's cell colours; cascades spill the next ledge | Ripen back by 9 s |
| Four lines | **the Spate** | The whole river, from upstream | A swell from the far bend along the channels; the river flushes into the four rows' mosaic; Los Ochos overflows | Relaxes over 10 s |
| Combo | **Ripen** (six stations) | S1–S6 up the river | One station per link: a ledge spill and a ripeness front; count lit stations = chain − 1 | While the chain lives |
| Combo release | **the Wash** | Lit stations, far to near | Reverse spills, sunlit silver spray veils drifting downstream, ripeness ebbs | 4–20 s, sized by peak |
| Back-to-back | **Standing wave** | The main ledge, both near panels | 1–3 white glass crests with fixed chevrons; persists while the chain lives; smooths over 6 s on the inferred break | Chain |
| T-spin | **Kettle** | The shelf beside the card at the T's rows (terrace left, rock rib right) | A pebble drills a new pit in a 1.4 s time-lapse: 0.6 m gold-jade / 1.2 m turquoise / 2 m sapphire with a frond fringe | Session (≤ 8; the 9th silts the oldest over 20 s) |
| Perfect clear | **La Floración** | The whole river | Cristal (the river stills and turns invisible), then every frond flowers, 12–20 thread falls; shadows lifted 20 s | 14 s |
| Level up | **Season turn** | The whole river, far to near | 4 s time-lapse to the next season; a tide line on the banks (≤ 6) | Session record |
| Game over | **La Sequía** | The whole river | Water drops to threads, fronds dry to straw, kettles remain as jewels, dragonflies settle | Until restart |
| Next session | **Primera Lluvia** | Tableland and river | 5 s soft shower veil (streaks only against the forest, no rings), water returns over 4 s, fronds green then ripen over 8 s | 13 s |
| Idle | **The river runs** | Everywhere | Ambient animation; the clock's one large cloud shadow and switch-on per 300 s | — |

**Settings.** `pieceLockRipple` off: no Boil and no Plunge. `backgroundComboEffects` off: no event reactions at all; the
ambient river continues.

**Reduced motion** (setting or `prefers-reduced-motion`): wakes travel 0.15 s; frond flutter ×0.4; chutes become a 0.8 s
cross-fade of the braids with a slow comb; the Spate becomes a 1.2 s cross-fade into the mosaic; the kettle drill a
0.6 s fade-in; the Wash's veils do not drift (fade in place); parallax and camera breath off.

**Other modes.** Local multiplayer: each board anchors to its own card's free sides; stations light to the **maximum**
chain on screen; no T-spin, B2B or level events arrive, so seasons step every 15 lines and 240 s; cascade depth arrives
only as `COMBO` before `LINE_CLEAR` and is stashed. Online multiplayer: slot 0, board canvas `#online-main-board canvas`.
Infinity: `viewportOrigin` for rows and `u`; seasons by lines and clock. Odyssey: synthetic clears with `rows: []` fall
back to the bottom rows `19 − i` (braids use a neutral flush); the goal flourish (comboCount 6) lights five stations.
Meditation: see §3.6.

---

## 4. Overlap with Rainbark

Rainbark (`docs/theme-concepts/rainbark.md`; code in `src/themes/rainbark/`) is colossal painted eucalyptus trunks in blue
air over a mist floor. Its events are material: the bark **peels** on a lock, **sheds** a girdle on a clear and the whole
grove **moults** on four lines. Its combo counter is **canopy-gap sun pools** opening one per link, its B2B is a
**sunshower**, its T-spin **unwinds** a helical strip, its perfect clear reveals **the Floor**, its level up **climbs** the
camera, and its game over is **Mistfall** with "morning returns" on the next session. A Riverbloom build must keep its
own identity next to it.

### 4.1 What Rainbark already took from Riverbloom

From Rainbark's graft table (§0.2 "What is grafted from the runners-up", in `docs/theme-concepts/rainbark.md`):

| Riverbloom idea | How Rainbark uses it | What Riverbloom keeps |
|---|---|---|
| A T-spin leaves a persistent record | **The Unwinding**: a helical scar plus amber resin beads that last **the level**, healing when slots run out | Riverbloom's record is **geological and lasts the session**: round pits drilled into rock, up to 8, the oldest silting with sand. A pit in the ground, never a mark on a vertical surface, never beads. |
| A restart rite | **Morning returns**: the mist drains back on the next session start | Riverbloom's rite is the origin: **the first rain** crossing the tableland and the river, the water returning, the fronds greening then ripening. Water and rain, never mist draining. |

The rendering lead also offered the winner Riverbloom's "surface as a function" principle (shade a thin layer inside its
host material). Rainbark's wetness is a parameter inside the bark material, which is the same habit; it is a technique,
not an identity, and Riverbloom keeps `rvSurface` as its core.

The judges offered other Riverbloom ideas that Rainbark did **not** take: the kettle-drilling T-spin itself, hard drops
feeding the kettles, La Floración, the standing-wave B2B, the ripeness ladder through a real biological colour sequence,
"everything flows toward the viewer", sun credit and the dry season. They remain Riverbloom's own (sun credit is cut by
§3.9 anyway).

### 4.2 New similarity risks now that Rainbark exists

| Risk | Why it is real | Mitigation in a Riverbloom build |
|---|---|---|
| **"Ripening" as the colour logic** | Rainbark's bark ages through a ramp and its combo "quickening" ripens patches near the card in "slow flame"; Riverbloom's combo ripens the weed through a real colour sequence spreading from the card | Riverbloom's ripening is a **spatial reach up a river to fixed ledge stations**, in a **submerged, moving plant**, limited to green → gold → red → magenta (never blue, violet or full spectrum), counted by **white water**, never by light pools. No patch-wise flame climbing, no time-lapse clock speed-up, and never the word "quickening". |
| **Two high-daylight, full-spectrum natural themes in `biomes`** | Rainbark took the "high sun / morning daylight" slot with a full spectrum carried by a natural material | Riverbloom is **water, ground and horizon** (Rainbark has no ground and no horizon); its dominant areas are cream rock, crimson weed and turquoise-to-sapphire water under a cerulean sky with one storm tower, against Rainbark's cool slate-blue matrix in blue haze. Keep Riverbloom's haze warm-white near the horizon (`#D3ECF2` humidity band, savanna haze `#E6D2B0` in Gold Ebb) and use blue-violet only on the 14 km tableland, never as near aerial perspective on saturated colour. Compare thumbnails side by side at the 80 px picker size before Stage B. |
| **Rain as a reward** | Rainbark's B2B is a sunshower that wets and deepens the grove | Riverbloom has rain only in the clock's shower veil over the tableland and in the first-rain restart rite. No rain on any gameplay reward; B2B stays the standing wave; wetness is the river itself, never "wet makes colour richer" as a global parameter. |
| **Counted combo beats** | Both count links at fixed stations | Different media (ledges spilling white water versus pools of sunlight on trunks) and a different direction (up the river away from the viewer). Never count with light pools or sunflecks. |
| **Session-aware moments** | Rainbark's Floor shows the session's shed curls; Riverbloom's kettles, pebbles and tide lines record the session | Riverbloom's record is always visible on the rock (kettles, pebbles, tide lines); its perfect clear is about the river flowering, not about revealing the session. |
| **Vapour or spray on release** | Rainbark's Set includes a vapour roll sliding down the trunks into the mist | Riverbloom's Wash throws spray *up* off ledges into sunlight and lets it drift downstream; it never rolls down a surface. |
| **Cloud and light patterns on the hero** | Rainbark's sunflecks (canopy gobo) crawl over the bark | Riverbloom's light pattern is caustics (supporting, §3.4) and one clock-driven cloud shadow; no gobo, no flecks. |
| **Identifier prefix** | Rainbark uses `rb*` | `rv*` (§3.14). |
| **Piece palettes** | Same-shape colours differ strongly except L (Riverbloom `#3873E6` azure vs Rainbark `#2F4CC0` cobalt, ΔE 16.7) and S (`#D25AB8` vs `#B98AF2`, ΔE 29.1) | Acceptable: the CVD constraint decided L, and the other five shapes differ by ΔE 46–128. |
| **Registry group** | Both `biomes` | Fine; the group only sorts the picker. |

### 4.3 What a Riverbloom build must not borrow back from Rainbark

No bark, peeling, curls, shed strips or girdles; no canopy-gap sun pools or gobo flecks as a mechanic; no mist floor or
abyss; no blue air as near aerial perspective; no sunshower or global wetness reward; no time-lapse "quickening"; no
camera climb on level up; no resin beads; no "Floor" reveal. If a step drifts toward any of these, stop and re-read §1.5
and §3.17.

---

## 5. Implementation plan

The house pattern is the "masterpiece rebuild" layout of `src/themes/serenity-warp/`, as cloned by Rainbark
(`src/themes/rainbark/`, commit `585ab55`). Rainbark is the closest working precedent: same three r186.1 stack, the same
director extensions (combo-break inference, B2B level, multiplayer stash, shadow-well `rowCodes`), the same rename
procedure. Read its files before writing new ones. Ocean (`src/themes/ocean/`) is the precedent for the seabed
heightfield and the caustic light-pattern target; Sunset (`src/themes/sunset/`) for `glintLobe` and the mirrored sky
function; Verdant Hills for composition-aware scatter.

### 5.1 Stage 0: slot, rename and scaffold

1. **Choose the slot** with PLAYBOOK.md §1 "Choosing a slot": which theme Riverbloom replaces (call it `OLD_ID`), or
   whether it is added as a new theme (that changes registry counts pinned by tests, such as the music catalogue). Ask
   the user if it is not obvious. Decide the name (§3.13). Check whether `OLD_ID` is an Odyssey level's backdrop
   (risk #11 in §1.9) and ask the user how to retitle that level.
2. **Stage 0a (PLAYBOOK §3.1), one small commit:** write `riverbloom-core.js` (piece codes 0–8, `SEASONS` with r_s,
   `RAMP_STOPS`, `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`, `packCodes`/`unpackCodes`) and
   `riverbloom-tetrominos.js` with the §3.12 hexes; add the CVD unit test (§5.10, worst pair ≥ 22); run
   `npm run check:palette` (0/7) and commit before anything references them, as Rainbark did in `0c747dd`.
3. **Stage 0b (PLAYBOOK §3.2), scaffold and rename.** Worked example: commit `585ab55` replaced Cosmic Chimes with
   Rainbark. Follow the same list (PLAYBOOK §4 is the generalised checklist) for
   `OLD_ID → riverbloom`: registry entry in place in `src/themes/theme-registry.js` (`group: 'biomes'`, add to
   `HEAVY_GPU_THEME_IDS`); `RETIRED_THEME_IDS` gains `['OLD_ID', 'riverbloom']`; the song is retitled (ID3 TIT2 rewritten,
   audio bytes and file length unchanged; track key renamed; `RETIRED_TRACK_KEYS` entry; `songs.json` regenerated with
   `node generate-songs.js`; tell the user the recording is unchanged); the Odyssey orb (if any) keeps its slot with a new
   name, copy and a sensible `transitionIn` (risk #11; suggest `'crossfade'`); `src/core/odyssey/theme-presentation.js`
   key colour (suggest `'#D60A45'`, Macarenia Crimson); ThemesTab fallback glyph in `src/ui/serenity-hub/ThemesTab.js`
   (both `'droplet'` and `'wave'` already exist there: Fluid Dreams and Stillwater use `'droplet'`, Ocean and Waves use
   `'wave'`; suggest `'droplet'`); the container `<div id="riverbloom-theme" class="theme-container">` in `index.html`
   and its CSS in `public/styles/main.css`, `#riverbloom-theme { background: <clear colour>; overflow: hidden; }` (copy
   the `#rainbark-theme` rule); the `captureThemes` row; playground parameter catalogue; the phone validator list
   (`scripts/lib/mobile-webgl2-validation.mjs`); CREDITS and living docs; a rename migration test cloned from
   `tests/unit/rainbark-rename-migration.test.js`.
4. **Clear colour** (`CLEAR_COLOR` in `riverbloom-theme.js`, as `rainbark-theme.js` has `0x3a4a72`): a mid value that
   never flashes the 2.5 s container fade white or black, taken from the scene: suggest `0x5E8FA8` (a hazy river teal
   between the deep channel and the sky).
5. **Scaffold:** clone Rainbark's adapter, director, composition, quality and post; a minimal world that draws only the
   sky and satisfies `WORLD_METHODS` from day one; the playground effect. Delete the old theme's folder and obsolete
   tests per the checklist. Run the minimal verification list (§5.11) before Stage A.

### 5.2 Files (`src/themes/riverbloom/`)

| File | Role |
|---|---|
| `riverbloom-core.js` | Three-free: `SEASONS` (§1.3 colours, rest ripeness r_s §3.8, water level, σ, sky and haze), `RAMP_STOPS` (ripeness 0 → 1), `TIMING` (every timeline above), `EVENT_ROWS` (§5.4), the Jacobian wave set (8–12 integer wave vectors, amplitudes, per-channel `d` ≤ 6% apart), `convectiveAt(t)` (phase, tower growth, shadow coverage, thread-fall count), `SUN` (elevation 48°, azimuth ahead-left), `STATION_ORDER`, `CODE_MATERIAL` (cell code → frond / sand / water / patina / quartzite), `packCodes`/`unpackCodes` (§5.4), `reachFor(chain)`, `flushMix`, `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`. |
| `riverbloom-plan.js` | Three-free, seeded: the diagonal centreline spline (§3.2), channels and depths, shelves and the Kettle Terrace, ledges `L0`–`L4` per side and `B1`–`B3` (ids, endpoints, lip heights), water levels per season, the flow field, static kettles (16, including the two caps of Los Ochos), set-piece candidates, T-spin drill candidates per side and height band, frond-clump scatter (composition-aware), the far bend. |
| `riverbloom-bake.js` | Three-free typed-array bakes, deterministic by seed: `bakeFbm` (half float, CPU mips), `bakeTowerField` (256² RGBA8, union of about 40 spheres), `bakeCrest` (512×1 RGBA8 Serranía profile plus savanna and canopy crests), `bakeSeasonRamp` (256×6 RGBA8: x = ripeness, one row per season, gotcha #143), `bakeBedMesh` (interleaved positions, `aFlow`, `aLevel`, `aMask` with cavity occlusion), optional `bakeLicTile` (the mat streaks, if the lab picks it). |
| `riverbloom-tsl.js` | `createRiverbloomUniforms` (`u`, `events`, counts); `DataTexture` wrappers; laid-out pure helpers (`rvHash21`, `rvHash31`, `rvSchlick` (products), `rvHg` (products, clamped), `rvAureole` (products, clamped), `rvJacobian`, `rvFilmic`, `rvRoundBoxSdf`, `rvDecodeCodes`); inline builders that read `u` and textures (`rvSky`, `rvSurface`, `rvSurfaceVertex`, `rvCaustic`, `rvCloudShadow`, `rvRamp`, `rvKettle`); the caustic paint pass (`QuadMesh` into an RGBA8 target with `generateMipmaps`). `export *` from core. |
| `riverbloom-sky.js` | Backdrop triangle at the far plane: sky, aureole, Serranía with striations, thread falls and shower veil, savanna and canopy bands; tower impostors (1–2). |
| `riverbloom-bed.js` | Heightfield mesh and bed material: mosaic (at the refracted coordinate), painted frond mats, sand, algae, patina, caustics, standing chevrons, waterlines and meniscus, kettles by ray–cap tracing, pebbles' swirl, tide lines, boil domes, eddies, chute braids and Spate mosaic on the mats, `rvSurface`. |
| `riverbloom-fronds.js` | Frond clumps (opaque, width-profiled; SDF edge + `alphaToCoverage` on MSAA tiers), per-vertex water terms, flowers (dormant until `flowering` > 0 or season III). |
| `riverbloom-falls.js` | The White Curtain, ledge curtains (one instanced strip type with `whiteness` per ledge), spray sheets (premultiplied, HG forward scatter). |
| `riverbloom-life.js` | Fan palms (moriche-like cards) and dragonflies. |
| `riverbloom-fx.js` | The drift pool (sand puffs on T locks and on pebble hops), pebble skips and the orbiting-pebble pool (CPU-written instance attributes when a pebble joins: kettle id, phase, joined time), event-row writers for boils, eddies, spills, chutes, the Spate, stations, the Wash, standing waves, kettles and tide lines. **No sluice sheets, no beads.** |
| `riverbloom-world.js` | `RiverbloomWorld` with every `WORLD_METHODS` method (`build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`) plus `onB2B(level)`, `onGameOver()`, `onSessionStart()`; camera rig (§3.2, `REST_RIG`, `fovForAspect`); timed queue; slot rings; season front; convective clock; station reach; writes `u`. Exports `RIVERBLOOM_PARTS = ['sky', 'bed', 'fronds', 'falls', 'life', 'fx']`. |
| `riverbloom-director.js` | Clone of `rainbark-director.js`: try/finally delivery, `broke` flag, `shape`/`cells`, shadow well with `rowCodes`, combo-break inference on the breaking lock, B2B live level with break inference, the multiplayer pending-COMBO stash, hard-drop `distance`, line counting for seasons in modes without `LEVEL_UP`. Rename identifiers only; map `rowCodes` to river cell codes. |
| `riverbloom-composition.js` | Cloned readers (with `'#online-main-board canvas'`), `BOARD_GRID`, `boardPoint`; presets (desktop, 21:9, 4:3, portrait < 0.62, HUD mirroring); `rowToRiver(layout, player, row, side)` (ray through the card edge onto the water); `pickLedges(rows, side)` (§3.6); station screen positions (§3.8); set-piece placement (Los Ochos, the White Curtain, drill candidates) from free regions and the HUD rect; the class-mask debug view's region list. |
| `riverbloom-post.js` | `RiverbloomPost` (`RenderPipeline`), max-channel knee bloom (threshold 1.0), one output pass (calm zones, bloom, exposure, tropic filmic, grade, vignette, sRGB, grain, dither), FXAA on Low and Medium, MSAA 4× on High and up, `POST_LOOK`, `falseColor`, the `mask=1` class view. |
| `riverbloom-quality.js` | `QUALITY` (§5.8), `QUALITY_NAMES`, `tierFor`. |
| `riverbloom-theme.js` | Clone of `rainbark-theme.js`: ids, flags, renderer with WebGL2 fallback and GPU-loss handling, layout reads on frame time, calm zones, settings. Sink: `lock`, `clear`, `combo` → max over players, `levelUp`, `b2b` → `world.onB2B` (max over players); window `gameOver` and `modeStopped` → `world.onGameOver(); resetSession()`; `modeStarted` → `world.onSessionStart()` (Primera Lluvia). The caustic paint pass runs before the scene pass each frame (never in the same pass that samples it). |
| `riverbloom-tetrominos.js` | §3.12. |
| `riverbloom-theme-icon.png` | 512² 8-bit RGBA, circular. A close-up of crimson fronds streaming under glass-clear water past a kettle rim with a turquoise pool, one pale pebble, wet cream rock, a sliver of the Serranía at the top edge. No caustic net as the subject, no rainbow. Mirror to `public/assets/themes/riverbloom-theme-icon.png`. |
| `src/playground/effects/riverbloom.effect.js` | Mounts the same world and post (`capture: true`), events through a real director, imports only `three/webgpu` plus its own theme modules (the Ocean playground test pins this rule). |

URL catalogue row (`src/ui/url-parameters/theme-parameters.js`, `captureThemes`):
`['riverbloom', 'riverbloom', 'Riverbloom', 'sky, bed, fronds, falls, life, fx']`.

Render order (amended): fronds 10 (opaque); flowers and pebbles 12; bed 20; falls 30; palms 35; backdrop sky 50
(`LessEqualDepth`, depth write off, last among opaque, gotcha #100); spray 60; drift pool (sand) 65; dragonflies 80. Leave
Group `renderOrder` at 0 and set it per mesh (gotcha #139).

### 5.3 Director and sink contract

```
sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, rowCodes, screen })
sink.combo(n, player)        // true combo; 0 = broke, inferred on the breaking lock; idempotent vs the tracker's late 0
sink.b2b(level, player)      // 0..3; 0 inferred from a non-difficult wave-1 clear (no producer sends active:false)
sink.levelUp(level)
```
Event facts to respect (from the event-bus survey; PLAYBOOK.md has the full list): subscribe only to `PIECE_LOCK,
HARD_DROP, LINE_CLEAR, COMBO, TSPIN, B2B, PERFECT_CLEAR, LEVEL_UP`; the bus `COMBO.comboCount` is cascade depth, not the
true combo (ADR-0011); the `HARD_DROP` piece is pooled (copy it synchronously); visible row = board row − 4; Infinity uses
`viewportOrigin`; local multiplayer has no `TSPIN`, `B2B`, `LEVEL_UP` or `PERFECT_CLEAR` and no cascade count on
`LINE_CLEAR`; `PERFECT_CLEAR` arrives in a later frame with no rows; game over is the window `gameOver` event (single
player and Infinity) or GameModeManager `modeStopped`; `PIECE_LOCK` and wave 1's `LINE_CLEAR` share one synchronous tick
(the basis of the break inference).

### 5.4 The event table (`u.events`, one vec4 `uniformArray`, live rows compacted, counts in int uniforms)

| Block | Slots × rows | Rows | Contents |
|---|---|---|---|
| Boils, wakes and eddies (lock, hard drop) | 10 × 2 | 20 | A: water-plane anchor x, z; birth; strength (hard-drop scale). B: piece colour (linear rgb); `w = carrier + 4·span` (carrier 0 fronds, 1 sand, 2 eddy; span = the piece's row span in cells, 1–4), decoded as `span = floor(w/4 + 0.02)`, `carrier = w − 4·span` (gotcha #88 bias). |
| Pebble skips | 6 × 2 | 12 | A: start x, z; birth; target kettle index. B: hop count, seed, side, reserved. |
| Ledge spills | 10 × 1 | 10 | ledge id, side mask, birth, kind (clear, cascade, station, wash, spate). |
| Chutes and braids | 4 × 3 | 12 | A: start x, z; flow angle; birth. B: length scale, width, lines, cascade. C: cell codes packed 5 per float in `.x` and `.y` (4 bits each, 20 bits per float, exact in float32), side, reserved. |
| The Spate | 1 × 4 | 4 | A: birth, origin arc length, speed, strength. B: reserved. C–D: the 40 cell codes packed 5 per float (8 floats). |
| Standing waves | 2 × 1 | 2 | ledge id, level (1–3), birth, break time. |
| Kettles | 24 × 1 | 24 | x, z, radius, birth (static kettles: −1e4). 16 static (Los Ochos = 2 caps) + 8 drilled. |
| Tide lines | 2 × 1 | 2 | Up to 6 old water levels (8 values; unused = −1). |
| Globals | — | 4 | Season index and front arc length; flowering; drought; restart; cloud coverage and convective phase; station reach (0–6) and its front; Wash birth and peak; exposure lift. |
| **Total** | | **90** | |

Packing rule for cell codes: code = 0–6 for I O T S Z J L, 7 GARBAGE, 8 CLEAN_GARBAGE; `packed = Σ code_k · 16^k` for
k = 0–4; decode `floor(packed / 16^k + 0.02) mod 16` (gotcha #88). Unit-test the round trip in `riverbloom-core.test.js`.
The season ramp is a texture, not uniform rows. At most two `uniformArray`s per stage: the events, and optionally a small
palette array for the piece colours (gotcha #102). Pebble orbits use instance attributes written on the CPU when a pebble
joins (a rare event), not event rows.

### 5.5 Playground parameters

Every parameter must be catalogued in `src/ui/url-parameters/playground-parameters.js` with `scope` naming `riverbloom`
and `sources` naming the effect file; the URL-parameter catalogue test fails on any literal `params.get('x')` that is not
catalogued. Shared entries (`event`, `eventAge`, `piece` and the rest) need `riverbloom` added to their `scope` and
`sources`.

| Param | Meaning |
|---|---|
| `t` | Fixed time (phase-locked; `seek(t)` every frame). The convective breath is 300 s: Fair 0–90, Building 90–170, Shower 170–220 (big crossing about 190–202, switch-on about 202–214), Clearing 220–300. |
| `quality` | Minimal…Extreme; default High |
| `level` | 1–12; default 1 (season = (level − 1) mod 6) |
| `season` | 0–5, overrides the level's season |
| `board`, `statsHud` | Mock board with the real selectors (calm zones and anchors exercised) |
| `locks=<n>` | Pre-play n locks (alternating sides and pieces); also fills the director's shadow well for `event=clear` |
| `event` | `lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`, `levelUp`, `release`, `b2b`, `gameOver`, `restart` (only `restart` is new to the shared catalogue entry) |
| `eventAge` | Seconds after the event; default 0.4 |
| `eventLevel` | Default level + 1 |
| `lines` | 1–4; default 2 |
| `row`, `u` | Default 9 and 0.3 |
| `piece`, `turns`, `color` | Piece shape, quarter turns, colour override |
| `dist` | Hard-drop distance; default 14 |
| `cascade` | Waves for `clear`; default 1 |
| `combo=<n>` | Hold a chain (lights n − 1 stations) |
| `peak=<n>` | For `release`; default 6 |
| `b2b=<0–3>` | Hold the standing-wave level |
| `kettles=<n>` | Pre-drill n kettles (0–9; 9 shows the oldest silting) |
| `pebbles=<n>` | Pre-seat n orbiting pebbles across the kettles (≤ 3 each) |
| `tides=<n>` | Pre-draw n tide lines (0–6) |
| `water=0` | Debug: disable `rvSurface` (the §3.3 no-water A/B gate) |
| `mask=1` | Debug: paint the class mask (water, rock, sky and land, card) for the §3.2 shares |
| `reduce`, `parts`, `noPost`, `falseColor`, `bloom` | Reduced motion, part filter, post off, false colour, bloom override |
| `px`, `py` | Hold the pointer |
| `ref`, `refMode` | (Playground-wide, already catalogued) a local reference image, `split` to compare |
| `icon`, `iconFov`, `iconYaw`, `iconPitch` | Icon frame |
| `demo` | Live only: a 40 s loop of locks, clears, chains, four lines, a T-spin and B2B |

### 5.6 Staged build order with acceptance shots

Each step is **one small effect per session** (CLAUDE.md). Each ends with playground screenshots (wait for
`window.__PLAYGROUND_READY__ === true`, then a few animation frames or `window.__PLAYGROUND__.seek(t)`), a clean console
(no WGSL, GLSL or validation errors), `window.__PLAYGROUND__.diagnostics()` read back, and one Low-tier capture. In a
cloud container use the headless Chromium + SwiftShader tooling described in PLAYBOOK.md (it includes the harness-only
`GPUTexture.createView` swizzle shim that Chromium 141 needs with three r186). Look at every PNG: a clean console is not
proof it looks right. Run each step through PLAYBOOK §3.3's loop (build, acceptance shots plus a similarity montage
against koi-pond, ocean, halcyon-apex, waves, verdant-hills and rainbark, an independent critic with a fresh context,
fix, repeat until the critic passes it), then commit.

All queries below follow `/playground.html?`. Viewports: **D** = 1920×1080, **W** = 2560×1080, **P** = 390×844 (DPR 1),
**Q** = 1440×1080 (4:3). ★ = capture on both backends (add `&forceWebGL=1`).

**Stage A: environment**

| Step | Work | Acceptance shots |
|---|---|---|
| **A0** | **CPU lab, no shader** (§5.12): numpy/PIL renders of the bed, painted mats, water function and caustics from the §3.2 camera; one clump-silhouette study. Compare side by side with reference photos (§6). Write down the parameters that passed. | Montage of render vs reference. Pass the §3.3 blind-still gate on the CPU render, and the §5.7 checklist items 1, 3, 4, 6 and 12. |
| **A1** | Sky (static) + bed mesh and mosaic + painted mats + caustic paint pass (§3.4 caps), no water function yet. Plan, diagonal reach, ledges, shelves, the terrace. | ★ `effect=riverbloom&t=60&parts=sky,bed` @D · `effect=riverbloom&t=60&parts=sky,bed&mask=1` @D, @W, @Q (shares §3.2) · `effect=riverbloom&t=60&parts=sky,bed&quality=Minimal` @D · `effect=riverbloom&t=60&parts=sky,bed` @P · `effect=riverbloom&t=60&parts=sky,bed&falseColor=1` @D (caustics under the knee). |
| **A2** | `rvSurface` on the bed: refraction, Fresnel, Beer, glitter (lobe + lattice), foam lines, wakes, standing chevrons, waterline band and meniscus. | ★ `effect=riverbloom&t=60&parts=sky,bed` @D · `effect=riverbloom&t=60&parts=sky,bed&water=0` @D (gate 2) · `effect=riverbloom&t=60&parts=sky,bed`, `t=60.8`, `t=61.6` @D (no flow-map pulsing across a 2.4 s phase) · `effect=riverbloom&t=60&parts=sky,bed&px=0.8&py=0.2` @D · `effect=riverbloom&t=60&parts=sky,bed` @P (no black regions, gotcha #71). |
| **A3** | Frond clumps (opaque silhouettes, per-vertex water terms, transmission, footprint fade; SDF edge with `alphaToCoverage` on High+); flowers dormant. | ★ `effect=riverbloom&t=60&parts=sky,bed,fronds` @D · `effect=riverbloom&t=60&parts=sky,bed,fronds&season=1` and `season=4` @D · `effect=riverbloom&t=60&parts=sky,bed,fronds&quality=Minimal` @D (mats carry the look) · `effect=riverbloom&t=60&parts=sky,bed,fronds` and `t=60.05` @D, cropped 200% at the near fronds (no crawl, no aliasing) · `effect=riverbloom&t=60&parts=sky,bed,fronds&quality=Low&forceWebGL=1` @P. Gate 1 (blind still) on the D shot. |
| **A4** | Sky in full: aureole, Serranía (striations, thread falls, shower veil), savanna and canopy bands, tower impostors, cloud shadows, the convective breath. | ★ `effect=riverbloom&t=60` @D · `effect=riverbloom&t=150` @D (building) · `effect=riverbloom&t=196` @D (the big crossing over the river: wine and teal, never dark) · `effect=riverbloom&t=212` @D (the switch-on) · `effect=riverbloom&t=60&season=4` @D (First Rains: 6 thread falls, towering cumulus). |
| **A5** | Falls and spray: the White Curtain, ledge curtains, spray sheets (premultiplied, HG). | ★ `effect=riverbloom&t=60&parts=sky,bed,fronds,falls` @D · same @W (the Curtain whole) · `effect=riverbloom&t=60&parts=sky,bed,fronds,falls&falseColor=1` @D (only glints and spray above the knee). |
| **A6** | Kettles (ray–cap, Los Ochos), pebble orbits, life (palms, dragonflies), composition presets, HUD mirror, set-piece placement, seasons, camera breath and parallax. | ★ `effect=riverbloom&t=60&board=1` @D, @W, @Q, @P · `effect=riverbloom&t=60&kettles=8&pebbles=12` @D · `effect=riverbloom&t=60&level=2` … `level=6` @D · `effect=riverbloom&t=60&tides=6` @D · `effect=riverbloom&t=60&board=1&reduce=1` @D. Unit tests pin: the deep channel under the card and Los Ochos and the White Curtain outside the card and HUD rects at aspects 0.46, 1.0, 1.33, 1.78 and 2.37. |

**Stage B: gameplay FX** (all after `effect=riverbloom&t=60&board=1&`)

| Step | Work | Acceptance shots |
|---|---|---|
| **B1** | The Boil and the Plunge: dome, carriers by family, wake, ripen-back; pebble skip with rate limit; director wiring. | ★ `event=lock&piece=I&u=0.15&row=12&eventAge=0.12` @D (dome at peak) · `event=lock&piece=I&u=0.15&row=12&eventAge=0.5` @D (tips in air, ΔE gate) · `event=lock&piece=I&u=0.15&row=12&eventAge=1.6` @D (wake) · `event=lock&piece=T&u=0.85&row=8&eventAge=0.6` @D (sand puff, right side) · `event=lock&piece=O&u=0.2&row=14&eventAge=0.6` @D (eddy) · `event=lock&piece=L&u=0.5&row=10&eventAge=0.6` @D (both sides at 0.6) · `locks=12&event=lock&piece=S&u=0.2&row=15&eventAge=0.6` @D (ten alive, ×0.7) · `event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.25` @D (plunge) · `event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=1.2` @D (pebble mid-skip) · ★ `event=lock&piece=J&u=0.3&row=10&eventAge=0.5` @P (below the bottom lip, legible). |
| **B2** | The Spill and the Chute: ledge picking, spills, chutes, braids from the shadow well, ripen-back, cascades. | ★ `locks=10&event=clear&lines=3&row=16&eventAge=0.3` @D (three ledges spilling per side, none touching the card) · `locks=10&event=clear&lines=3&row=16&eventAge=1.4` @D (chutes with braids in the rows' colours) · `locks=10&event=clear&lines=2&row=17&eventAge=6` @D (ripening back, far end first) · `event=clear&lines=1&row=18&cascade=3&eventAge=1.6` @D (staircase of spills) · ★ `locks=10&event=clear&lines=2&row=17&eventAge=1.2` @P. |
| **B3** | The Spate: courses, upstream drop, the Curtain's thunder, the swell along channels, the 40-cell mosaic, Los Ochos overflowing, ripen-back, exposure ≤ +0.15. | ★ `locks=12&event=quad&row=16&eventAge=0.25` @D (courses, far ledges emerging) · ★ `locks=12&event=quad&row=16&eventAge=1.4` @D (swell mid-frame, mosaic behind, passing behind the card) · `locks=12&event=quad&row=16&eventAge=5` @D (the river in your rows' colours) · `locks=12&event=quad&row=16&eventAge=1.4&falseColor=1` @D · `locks=12&event=quad&row=16&eventAge=1.4` @P. |
| **B4** | Combo stations and the Wash; director break inference. | ★ `combo=4` @D (three stations lit) · `combo=7` @D (all six) · `season=4&combo=5` @D (a green river ripened red to the far reach) · `event=release&peak=7&eventAge=0.5` @D (reverse spills) · `event=release&peak=7&eventAge=3` @D (veils drifting) · `event=release&peak=2&eventAge=1` @D (small) · `combo=4` @P (phone stations). Director tests: break on the breaking lock, resume rule. |
| **B5** | Standing wave (B2B) and Kettle (T-spin). | `b2b=1` and `b2b=3` @D · `event=tspin&lines=1&u=0.2&row=13&eventAge=0.7` @D (drill mid-time-lapse) · `event=tspin&lines=3&u=0.8&row=12&eventAge=3` @D (2 m sapphire kettle on the right rib) · `kettles=8&event=tspin&lines=2&u=0.2&row=13&eventAge=10` @D (the oldest silting) · `reduce=1&event=tspin&lines=1&eventAge=0.7` @D. |
| **B6** | La Floración, season turn and tide lines, La Sequía and Primera Lluvia, idle rules, meditation, multiplayer anchors. | ★ `event=perfect&eventAge=0.4` @D (cristal) · ★ `event=perfect&eventAge=4` @D (the river in flower, thread falls) · `event=levelUp&eventLevel=3&eventAge=2` @D (season front mid-river) · `event=gameOver&eventAge=6` @D (dry season) · `event=restart&eventAge=2.5` @D (first rain, no rings) · `reduce=1&event=quad&row=16&eventAge=0.8` @D. |

**Stage C: post, tiers, phone, icon, docs**

| Step | Work | Acceptance |
|---|---|---|
| **C1** | Post: calm zones with `board=1`, knee bloom, tropic filmic, grade, FXAA/MSAA, false colour, the class mask view. | ★ `effect=riverbloom&t=60&board=1` @D (board readable over the deep channel) · `effect=riverbloom&t=60&falseColor=1` @D. |
| **C2** | Quality tiers (§5.8); Minimal and Low captures; the WebGL2 leg on every starred event shot. | `effect=riverbloom&t=60&board=1&quality=Minimal` @D · ★ `effect=riverbloom&t=60&board=1&quality=Low&forceWebGL=1&event=clear&lines=2&row=17&eventAge=0.8` @P. Measure Low and High with `profile=1&trackTimestamp=1`. |
| **C3** | Portrait, 21:9 and 4:3 passes: anchors, ledge picking, stations, set pieces. | ★ `effect=riverbloom&t=60&board=1&locks=12&event=quad&row=16&eventAge=1.4` @W, @Q, @P. |
| **C4** | Icon frame; the theme end to end in the real game on both backends; switching away leaves no canvas; the phone validator at Low and Minimal; tests; docs (`docs/RIVERBLOOM_VISUAL_OVERHAUL_<date>.md`, `docs/riverbloom-captures/`, a `docs/ARCHITECTURE_INDEX.md` row). | Icon: `effect=riverbloom&t=60&icon=1&iconFov=28&iconYaw=-30&iconPitch=-14&kettles=1&pebbles=1` (square 512×512; fronds streaming past a kettle rim on the lower-third intersection, turquoise pool, a sliver of the Serranía). Real-game and phone runs as in PLAYBOOK.md. |

### 5.7 Art checklist for the hero (the frond river under clear water)

Accept A0, A2 and A3 only when every item holds, judged against reference photos side by side:

1. **It reads as water in a still** (§3.3 gate 1), at 960×540 and at a 160 px thumbnail.
2. **The water does visible work** (§3.3 gate 2): the no-water frame is clearly different.
3. **Combed, not grown.** Fronds lie in long parallel locks along the local flow, hugging the bed at the root and lifting
   toward the tip; nothing stands upright like grass, waves like kelp or flickers like flames.
4. **A mosaic, not a carpet.** All five colours in patches that follow the current (crimson beds in fast shallows, jade in
   shade behind ribs, gold sand floors, black patina on lips, blue in holes). Patch edges are frayed and flow-stretched,
   never polygonal (Voronoi) and never nested contours (thresholded noise): the two failures the Rainbark lab found.
5. **Value structure.** Pale rock is the brightest large area; the deep channel behind the card the darkest; crimson sits
   in the middle values; ruby transmission only where fronds are backlit.
6. **Ripeness variation inside a bed:** tips lighter and warmer than bases (`#C8163F` → `#FF5A6E` in season I), with
   per-clump variation; never flat colour.
7. **Waterlines everywhere rock emerges** (1 cm fade, 3 cm wet band, meniscus glint).
8. **Caustics supporting** (§3.4): under the caps, flow-stretched, never a net over dark ground.
9. **No crawl, no shimmer** in two frames 0.05 s apart at the near fronds; distant fronds dissolve into the mat without a
   visible boundary at the geometry range.
10. **All six seasons read** (`season=0…5`), and a season front looks like the river changing downstream, not a wipe.
11. **False colour:** nothing in the river above the bloom knee except glints, meniscus sparkle and spray.
12. **Seen whole, it reads as "a sunlit tropical river of red weed"**, not as a red carpet, a rug, coral, a map or seaweed
    on a floor.

### 5.8 Quality tiers (amended)

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Bed grid (vertices) | 96×64 | 128×96 | 160×128 | 200×160 | 240×192 | 280×224 |
| Frond clumps × ribbons × segments | 1.2k × 3 × 5 | 2.4k × 3 × 6 | 4.5k × 3 × 8 | 7k × 3 × 8 | 9k × 4 × 10 | 12k × 4 × 12 |
| (ribbons) | (3.6k) | (7.2k) | (13.5k) | (21k) | (36k) | (48k) |
| Frond geometry range (painted mats beyond) | 6 m | 9 m | 13 m | 18 m | 22 m | 26 m |
| Lobed SDF edge + `alphaToCoverage` | off | off | off | on | on | on |
| Frond caustic tap | off | off | on | on | on | on |
| Frond transmission term | off | on | on | on | on | on |
| Caustic target / update / channels | 128² / every 3rd / 1 | 192² / every 2nd / 1 | 256² / 1 / RGB | 384² / 1 / RGB | 512² / 1 / RGB | 512² / 1 / RGB |
| Surface normal octaves | 1 | 1 | 2 | 2 | 3 | 3 |
| Glitter lattice (bed) | statistical lobe only | coarse | full | full | full | full + second scale |
| Spray sheets / tower impostors | 2 / 1 | 3 / 1 | 4 / 2 | 6 / 2 | 7 / 2 | 8 / 2 |
| Flowers | 600 | 1.2k | 3k | 6k | 9k | 12k |
| Drift pool (sand grains) | 120 | 200 | 300 | 400 | 500 | 600 |
| Pebbles (orbit pool + skips) | 24 + 6 | 24 + 6 | 24 + 6 | 24 + 6 | 24 + 6 | 24 + 6 |
| Boil slots (both sides) | 6 | 8 | 10 | 10 | 10 | 10 |
| Palms / dragonflies | 0 / 0 | 8 / 2 | 14 / 2 | 20 / 3 | 26 / 4 | 30 / 4 |
| AA / bloom | none / off | FXAA / off | FXAA / 0.33 | MSAA 4× / 0.45 | MSAA 4× / 0.5 | MSAA 4× / 0.5 |
| Pixel-ratio cap (house) | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |
| **Target GPU, 1080p desktop iGPU** (unverified, ADR-0016) | ~2.2 ms | ~3.0 ms | ~4.5 ms | ~6.0 ms | ~8.5 ms | ~11 ms |

Every tier keeps the whole picture and every event (stations, braids, the Spate, kettles, standing waves, La Floración,
tide lines and the dry season included). Drop terms in JavaScript, never by substituting constants (gotcha #135). Scope
cuts if over budget, in order: dragonflies, then palm count, then the glitter lattice on Medium, then flower count, then
frond ribbons per clump (4 → 3). Never cut: the painted mats, the water function's Beer and Fresnel, waterlines, the
Boil's carriers, braids, stations, kettles, the Spate's mosaic.

### 5.9 TSL and WebGL2/WebGPU guards that matter for this concept

Gotcha numbers refer to the table in `.claude/skills/webgpu-threejs-tsl/SKILL.md` (numbered by line at commit `585ab55`;
search the symptom text if the lines have moved). The `webgpu-threejs-tsl` skill auto-loads on this work.

| Guard | Where it bites in Riverbloom |
|---|---|
| **#89** nested `select` round `Fn` calls fails on the WebGL2 backend only (`addToStack`) | The mosaic classifier, the braid/mosaic material switch (frond / sand / water / patina / quartzite), the kettle tracer (inside vs outside a cap, wall vs floor), the carrier family in the boil. Fold conditions into one `select(a.and(b), v, f)` with `v.toVar()` built in a laid-out helper, or blend by arithmetic weights. Verify the `forceWebGL=1` leg every session. |
| **#71** an unbounded `exp` turns a region black, often only on tall portrait screens | Beer `exp(−σ·depth·(1/cosθv + 1/cosθs))` (grazing `cosθv` → 0 blows up: clamp `cosθv ≥ 0.05` and bound the product), kettle Beer, wake and ripen-back decays, cloud-shadow falloff. Bound every argument (`exp(max(x, 0).mul(−k))`); capture portrait early. |
| **#94** NaN from `pow` of a base a hair below zero spreads through the bloom chain | Schlick Fresnel (products), the aureole `(1 + g² − 2g·cosθ)^1.5` and HG phase (write `x·sqrt(x)` with x clamped ≥ 1e-4, cosine clamped). |
| Jacobian caustic reciprocal | `1/max(ε, abs(J))` with ε = 0.08; the standing-chevron 1D form likewise; never divide by a raw determinant. |
| **#113 / #114** RT row order; never sample a target in the pass that writes it | The caustic light-pattern target: paint it with its own `renderer.render` of the `QuadMesh` before the scene pass; sample by world xz with a consistent orientation (it tiles, but advection direction must match the flow). |
| **#102** more than 12 uniform buffers per stage fail WebGPU validation | One vec4 event array (§5.4) plus at most one small palette array; the season ramp is a texture. |
| **#99** more than 8 vertex buffers fail on WebGPU | Frond clumps, flowers, pebbles, drift grains, palms and dragonflies: one `InstancedInterleavedBuffer` each. |
| **#87 / #88** interpolated instance attributes carry last-bit noise; exact divisions need a bias | Integer seeds, bed ids and carrier codes read with `floor(x + 0.5)`; packed cell codes decoded with `floor(q + 0.02)`. |
| **#110 / #155** loop over live rows; named loops hand their index under that name | Boils `bo`, spills `sp`, chutes `ch`, kettles `ke`, standing waves `sw`: distinct names, index read by that name. |
| `.level()` inside `If` and `Loop` | Every texture read inside the kettle loop (behind the terrace-mask `If`), the boil and chute loops, and the caustic reads on fronds. |
| **#68** a branch reads zeros from shared nodes | Root-pin (`.toVar()`) depth, the refraction offset, ripeness and the caustic sample before any `If`. |
| **#104 / #116** baked fBm at mip 0 with large gain is serrated; narrow `smoothstep` on noise is confetti | Mosaic patch edges, mat streaks, cloud-shadow edges: wide ramps, `.level(2.0)` for large-gain reads. |
| **#143** palette change on banded surfaces | Season rows in the 256×6 ramp texture; the downstream season front picks a row per pixel by the plan's arc length. |
| **#69** equal-edge `smoothstep` is a hard WGSL error | The 1 cm waterline fade, the ramp stops and any data-driven edge (station reach, braid lanes): add an epsilon. |
| **#135** dropping octaves by substituting 0.5 | Tiers drop terms in JavaScript. |
| **#147 / #120** sub-pixel particles become blobs on phones; additive light must be budgeted | Glint lattice cells ≥ 1.2 buffer px; frond footprint fade at 1.5 px; dragonfly wing glint averaged; sand grains floored at 1 px; the glitter cap (§3.15). |
| **#105** MSAA extrapolates varyings on thin strips | Clamp the frond `uv` and the ledge-curtain and Curtain coordinates on MSAA tiers. |
| **#111** `fragmentNode` disables the mask path | Fronds with SDF edges use `colorNode`/`opacityNode` + `alphaTest` + `alphaToCoverage` so `NodeMaterial` smooths alpha with `fwidth`. |
| **#129** transparent quads pick up depth haze | Opaque fronds with `depthWrite: true`; spray in fixed renderOrder bands. |
| **#90 / #117** premultiplied blending; a part captured alone is black | Spray and drift grains write premultiplied colour; capture additive parts with an opaque part (`parts=sky,bed,…`). |
| **#100 / #139** backdrop last among opaque; Group renderOrder first | Sky backdrop renderOrder 50 with `LessEqual` and no depth write; per-mesh renderOrder only. |
| **#153** a disc in direction space is an ellipse on a wide portrait lens | The sun aureole's falloff and the tower impostors on phones: draw in the lens's image plane. |
| **#93 / #95** laid-out helpers must not capture textures or uniforms | Keep `rvJacobian`, `rvSchlick`, `rvHg`, `rvAureole`, `rvFilmic`, `rvDecodeCodes` pure; textures are read in inline builders. |
| **#80 / #136** no `mx_noise`; no 3D textures in this container | 2D baked fBm with CPU mips; never `Data3DTexture` or `lut3D` (the headless SwiftShader build fails its writes). |
| **#96** pipeline count | Target about 12–14 pipelines: sky, bed, fronds, flowers, pebbles, drift, curtains, White Curtain, spray, palms, dragonflies, tower; every pool always drawn with dormant zero-size slots so the first frame compiles them all. |
| **#144** effects behind the card are never seen | Anchors step outward; ledges `B1`–`B3` count only by their visible ends; stations are placed in free regions. |
| Gate on renderer kind, not backend (ADR-0019) | The world and post build identically for the WebGPU and WebGL2 backends. |

### 5.10 Tests (clone Rainbark's, then add)

| Test file | What it covers |
|---|---|
| `tests/unit/riverbloom-core.test.js` | Palette gate 0/7 with the script's hue maths; CVD worst pair ≥ 22 (Machado 2009, ΔE76); season table (6 rows, r_s values); `convectiveAt` phases and bounds; `reachFor` capped at 6; cell-code pack/unpack round trip; Jacobian wave vectors integer (tileable); per-channel `d` within 6%. |
| `tests/unit/riverbloom-plan.test.js` | Ledges ordered downstream per side; the far bend hides the horizon reach; drill candidates outside water and outside card rects; static kettles non-overlapping; flow field smooth (no reversals). |
| `tests/unit/riverbloom-bake.test.js` | fBm tiles seamlessly; mips present; ramp 256×6 reaches peak at x = 1 in every row; crest flat-topped. |
| `tests/unit/riverbloom-director.test.js` | Shadow-well `rowCodes`; combo break on the breaking lock; resume rule; B2B level and break inference; multiplayer COMBO stash; empty-row fallback; season line counting without `LEVEL_UP`; settings resets. |
| `tests/unit/riverbloom-composition.test.js` | The deep channel under the card; Los Ochos and the White Curtain outside card and HUD rects at aspects 0.46, 1.0, 1.33, 1.78, 2.37; `pickLedges` never returns a segment within 0.04 of the card and never repeats a ledge for two rows; stations in free regions; HUD mirroring. |
| `tests/unit/riverbloom-world.test.js` | `WORLD_METHODS`; dormant pools; `seek` determinism; reduced motion; kettle cap 8 with silting; tide lines cap 6; pebble skip rate limit; no gameplay path dims the cloud shadow (§3.9). |
| `tests/unit/riverbloom-theme.test.js` | Node graphs built for all six tiers with `forceWebGL: true` and no GPU; banned-API greps (no `ShaderMaterial`, `WebGLRenderer`, `mx_*`, `from 'three'`, absolute asset paths, `Data3DTexture`); flag literals; registry triple (`heavy-gpu`, `heavy`, not startup-eligible); icon exists. |
| `tests/unit/riverbloom-playground.test.js` | The effect's parameters equal the catalogue entries. |
| `tests/unit/riverbloom-shaders.test.js` | Each part built with `WGSLNodeBuilder` and `GLSLNodeBuilder` at High and Minimal: no warnings, each stage < 48 KB, no equal-edge `smoothstep`, no `mx_`, laid-out helpers emitted once (copy the inline helper from `tests/unit/himalayan-peak-shaders.test.js`). |
| `tests/unit/riverbloom-rename-migration.test.js` | For `OLD_ID` (clone `tests/unit/rainbark-rename-migration.test.js`). |

### 5.11 Verification commands

Minimal (every commit):
```
npm run typecheck
npx vitest run tests/unit/riverbloom- tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/theme-music-catalog.test.js tests/unit/odyssey-unique-themes.test.js \
  tests/unit/url-parameter-catalog.test.js tests/unit/dual-state-theme-tripwire.test.js \
  tests/unit/mobile-webgl2-validation.test.js tests/unit/theme-container-registry.test.js
npm run audit:theme-lifecycle && npm run check:palette && npm run check:boundaries
node scripts/architecture-fitness-check.mjs
npx eslint src/themes/riverbloom --ext .js
```
(`git add` new files before trusting the dual-state tripwire: it scans tracked files only. Adding any net line to
`src/main.js` or `src/core/game-modes/OdysseyMode.js` fails the architecture-fitness ceilings.)

Full (before a merge): `npm test`, `npm run lint:ci`, `node scripts/ts-ratchet-check.mjs`, `npm run perf:budgets:gate`,
`npm run check:release-gates`, `npm run build`, `npm run check:ip-strings`, `npm run check:pages-artifact`, plus the
visual proof: playground shots on both backends, the real game on both backends, and
`npm run validate:mobile:webgl2 -- --theme riverbloom` at Low and then `--quality Minimal` (PLAYBOOK.md has the port
workaround needed when a dev server already holds 5173).

### 5.12 Prototype the hero on the CPU first (the Rainbark lesson)

Rainbark's spec described its bark atlas as an anisotropic Voronoi mosaic. Prototyped on the CPU in numpy/PIL before any
shader (six versions, each compared side by side with photos of the real tree), that recipe **read as stained glass**
and was rejected (v1); thresholded fBm contours read as topographic rainbow rings and were rejected (v2); pointed lozenge
splats read as candy leaves or feathers and were rejected (v3); "ribbon splats over a cool slate matrix", refined over
three versions (v4–v6), passed. The details are in `docs/theme-concepts/rainbark.md` §10 (§10.3 is the version table).
Its two general lessons apply here directly: **a tessellation (every texel in some cell) can never read as the real
material**, and **a uniformly distributed value gives a rainbow** (Rainbark's age mixture had to be skewed, with mid ages
rare; Riverbloom's ripeness and class mixture per reach must be skewed the same way, one class dominating). Riverbloom's
hero is exactly the kind of material that fails the same way, twice over: a mosaic classifier is thresholded noise, and
"water so clear you read it as air" is invisible by design. So, before A1, in the session's scratchpad (never
committed):

1. **Plan.** A top-down 2D grid of the reach (25 m × 60 m at 2 cm): the diagonal channel, three ledges as warped steps,
   the terrace, depths 5–40 cm (2 m in kettles), and a smooth flow field.
2. **Mosaic and mats.** Classes from flow-aligned, anisotropic noise (frond-bed, sand, algae, patina), frayed edges at two
   scales; the frond mat as **line-integral convolution of white noise along the flow** (20–40 px kernel), coloured
   through the season ramp with per-patch ripeness variation.
3. **Water.** A tileable wave sum (8–12 sinusoids, integer wave vectors), the Jacobian caustic per channel with ε = 0.08
   and `d` from depth, flow-stretched; Fresnel against a cerulean gradient; Beer with σ = (0.42, 0.085, 0.06)/m; the
   refraction offset applied to the mosaic lookup; waterline bands and meniscus; a few glints.
4. **Render** from the §3.2 camera at 960×540 (per-pixel ray to the water plane, then down to the bed).
5. **Compare** side by side with two or three reference photos (§6) in a PIL montage, plus the same render with the
   water terms off (gate 2).
6. **Iterate** until it passes the §5.7 checklist, especially items 1, 3, 4 and 12. Typical failures and fixes:
   - **"A red carpet / seaweed on a floor"**: the water is too invisible. Strengthen waterlines, wakes and foam lines,
     raise the refraction break near ledges, and let the deep channel go properly teal.
   - **"Chicken wire" or a net**: caustic contrast too high in the shallows (koi-pond's look). Lower amplitude, stretch
     along the flow, blur by depth.
   - **"Hair", "grass", "pasta" or "flames"**: wrong frond proportions. Shorter, wider, ruffled locks that hug the bed,
     tips lifting only in fast water.
   - **"Camouflage" or "a rug"**: the mosaic is isotropic or too evenly mixed. Align every patch with the flow and let one
     class dominate per reach (crimson in fast shallows, jade behind ribs).
7. **Record** the passing parameters in `riverbloom-core.js` comments and in the theme's record doc. Never commit the
   reference photos.

Then, on the GPU, iterate each step against the local reference with the playground's `ref=/playground-refs/<file>&refMode=split`
overlay. `public/playground-refs/` is tracked: copy a reference there only for the session, never `git add` it, and delete
it before committing (or list it in `.git/info/exclude`).

---

## 6. Reference imagery to look for

Keep reference images in the session's scratchpad and use them with the playground's `ref=` overlay locally. **Do not
commit copyrighted images.** Commit an image only if it is verifiably public domain or the user's own, and record its
source next to it. Describe what you learned from a photo in the record doc instead of shipping the photo.

**The river (Caño Cristales, Serranía de la Macarena National Park, Meta, Colombia):**
- "Caño Cristales" with "Macarenia clavigera" (close-ups of the fronds: ruffle, length, how they comb)
- "Caño Cristales red river aerial" and "Caño Cristales drone" (the mosaic of the five colours from above; braids)
- "Caño Cristales Los Ochos" (the figure-eight pools and their depth colours)
- "Caño Cristales Los Cuarzos waterfall" (the White Curtain's model)
- "Caño Cristales Tapete Rojo" (the densest weed)
- "Caño Cristales potholes" or "giant's kettles quartzite" (kettle shapes, sand floors, pebbles)
- "Caño Cristales cloud shadow" and "Caño Cristales overcast" (what the colours lose without sun)
- "Caño Cristales dry season" (the La Sequía look: amber and straw weed, threads of water)
- "Serranía de la Macarena" (the tableland wall, thread falls, the savanna in front)

**Riverweeds elsewhere (the plant's look and flowering):** "Podostemaceae rapids", "riverweed flowering exposed rock",
"Hydrobryum" or "Cladopus" (Japanese riverweeds on river rock).

**Water so clear it reads as air:** "Rio da Prata Bonito clear water", "Rio Sucuri Bonito aquatic plants" (Mato Grosso do
Sul, Brazil: plants under crystal water seen from above), "Verzasca river clear water", "shallow stream sunlight caustics
rock" and "caustics shallow river bed" (the real look and scale of caustics in 5–40 cm of water).

**Kettles and potholes:** "Bourke's Luck Potholes" (Blyde River Canyon, South Africa), "Taylors Falls potholes" (Interstate
State Park, Minnesota and Wisconsin), "Gletschergarten Luzern" (glacier-garden potholes).

**Surroundings and sky:** "moriche palm Llanos" (*Mauritia flexuosa*, the fan palm of the gallery forests), "gallery
forest Llanos Orientales", "cumulus congestus tropical afternoon" and "cumulonimbus tower savanna" (the convective tower),
"tepui thread waterfalls" (thin falls on a cliff wall).

**Paintings for light and water (search the works; do not copy):**
- John Singer Sargent's stream watercolours, for example "Bed of a Torrent" and "Mountain Stream" (clear water over rock,
  broken light).
- Winslow Homer's Florida and Bahamas watercolours, for example "Homosassa River" and "The Turtle Pound" (tropical light
  on clear water).
- Joaquín Sorolla's beach paintings, for example "Children at the Seashore" (sunlight in shallow water on bodies and sand).

**What to take from each, and what not:** take the five colours' proportions, how fronds comb and lift, the waterline
contact, and caustic scale and contrast at real depths. Do not take any composition that frames the river with trees at
the screen edges, mirror-still water, a low sun or a rainbow over the falls (all on the avoid lists).
