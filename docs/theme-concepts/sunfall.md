# Sunfall: theme concept build document

| Field | Value |
|---|---|
| Name | **Sunfall** (alternate: *Skywell*). The art judge called it "the best name in the slate" and "worth keeping even if the concept is not chosen". Rainbark did not take it. |
| Proposed id | `sunfall` (registry group `biomes`) |
| Logline | Sunlight pours into the world's largest cave like a waterfall. A lost jungle grows in that light and the cave breathes out its own clouds. Every move you make becomes weather, rain and new leaves. |
| Status | **Concept: not built.** Nothing under `src/` implements it. |
| Source | Design competition held on 2026-10-11 to replace the theme `cosmic-chimes`. Six concepts, three judges, 0–10 per lens. The winner, Rainbark, is being built on branch `ccr-b2364ce7-64kjge` (commits `0c747dd` and `585ab55` so far). Sunfall began as the seed "DOLINE" (researched candidate #19, alt name "Skylight Jungle": Hang Sơn Đoòng, Vietnam). |
| Scores | Art director **6.5** (5th of 6) · Rendering lead **5.5** (5th of 6) · Gameplay feel **7.2** (5th of 6) · **Total 19.2 / 30: 6th of 6** |
| Date | 2026-10-11 |

**The six concepts and their totals**

| Rank | Concept | Art | Tech | Play | Total /30 | Build document |
|---|---|---|---|---|---|---|
| 1 | Rainbark (being built) | 8.0 | 8.5 | 8.4 | **24.9** | `docs/theme-concepts/rainbark.md` |
| 2 | Iris Springs | 7.5 | 6.5 | 8.6 | 22.6 | `docs/theme-concepts/iris-springs.md` |
| 3 | Painted Ages | 7.0 | 8.0 | 7.5 | 22.5 | `docs/theme-concepts/painted-ages.md` |
| 4 | Riverbloom | 6.0 | 6.0 | 8.0 | 20.0 | `docs/theme-concepts/riverbloom.md` |
| 5 | Haft Rang | 8.5 | 4.5 | 6.9 | 19.9 | `docs/theme-concepts/haft-rang.md` |
| **6** | **Sunfall** | **6.5** | **5.5** | **7.2** | **19.2** | this file |

> **How to use this file**
>
> 1. Start a **new Claude Code session** on this repository. Give it the prompt template from
>    `docs/theme-concepts/README.md` ("Start here"), filled in with this file's path
>    (`docs/theme-concepts/sunfall.md`) and the slot; PLAYBOOK.md §8 has a longer ready-to-paste prompt.
> 2. Before anything else, read `docs/theme-concepts/PLAYBOOK.md`. It holds the steps every concept
>    shares: **§1 "Choosing a slot"** (which existing theme this one replaces, or whether it is added as a
>    new one), the rename and removal checklist (§4), the CI gates (§6), and the headless capture
>    tooling that works in cloud containers (§5).
> 3. **Compare against the fleet** side by side. The written catalogue of every theme (setting,
>    palette, motifs, "avoid reusing") is `docs/theme-concepts/reference/catalog.md`; pictures are
>    `docs/theme-screenshots/<id>.png` (the last fleet capture; can be stale, so prefer a fresh capture
>    of the current theme with PLAYBOOK §5's `shot.mjs`). For Sunfall the ones that matter most are
>    **crystal-cave, cinder-drift, bioluminescence, forest, fall, golden-forest, ocean, verdant-hills
>    and Rainbark** (Rainbark has no fleet screenshot yet: capture `effect=rainbark` in the playground).
> 4. Read `docs/theme-concepts/rainbark.md` §10 for the lesson that applies here: **prototype the hero
>    material on the CPU (numpy/PIL) and compare it with reference photos before writing any shader.**
>    For Sunfall that means the canopy seen from 90 m, the vault, and the column's cross-section (§5.12).
> 5. **Precedence inside this file.** §1 is the concept exactly as proposed. §2 is what the judges said.
>    **§3 amends §1, and where they disagree §3 wins.** §5 (the implementation plan) already includes
>    every §3 change. §4 lists what must not duplicate Rainbark.
> 6. Repo rules that apply throughout (`CLAUDE.md`): iterate in the playground first, **one small
>    effect per session**, and never call a WebGPU/TSL change done without a screenshot and a clean
>    console (ADR-0007, `docs/adr/0007-webgpu-tsl-definition-of-done.md`). Generated SFX are
>    unavailable: if a step seems to need them, stop and ask the user.
> 7. Words: never put the trademarked name of the falling-block game, or its word for a piece, in code,
>    strings, CSS or HTML (`npm run check:ip-strings`). Say "falling-block", "pieces", "four lines".
>    The house file name `<id>-tetrominos.js` and the constant `<ID>_TETROMINOS` are the established
>    convention and are fine.

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
| **the doline** | A roof collapse in a cave that lets the sky in (Son Doong has two). Here: the whole world, a chamber full of daylight with a jungle on its floor. |
| **the oculus** | The collapsed skylight in the vault, cropped by the top-left of the frame. A ragged hole fringed with surface forest, lianas and roots. |
| **the sunfall** | The column of white-gold sunlight that pours through the oculus onto the jungle. The hero. Also the theme's name. |
| **the foot** | Where the sunfall lands on the canopy (about 22 % across, 78 % down the 16:9 frame). |
| **the pool** | The pool of light on the canopy at the foot, where crowns blaze chartreuse. |
| **the vault** | The cave ceiling, lit softly from below by the green-gold bounce of the sunlit pool. |
| **the cloud deck** | The cave's own flat, pearl-grey cloud banks floating under the vault, with a burning gold-rimmed hole where the sunfall passes through. |
| **valley mist** | A low skin of mist over the canopy; incandescent in the pool. |
| **the far doline** | A second, small pale-green window of daylight about 1 km down the passage, with its own thin beam and jungle. |
| **the passage** | The colossal corridor (about 150 m high) running right and away from the chamber. |
| **the flowstone wall** | A 90 m wall of cream calcite curtains in the passage (after Son Doong's "Great Wall of Vietnam"). |
| **the stalagmite** | An 80 m stalagmite in silhouette (after the "Hand of Dog"). **[amended: §3.2, demoted]** |
| **gours** | Dry rimstone terraces in the foreground corners: scalloped calcite dams with moss on the lips and cave pearls in their dry pools. |
| **root curtains, strands** | Long aerial roots and lianas hanging from the top of the frame on both sides of the card. Where lock leaves grow. |
| **peacock spikemoss** | Iridescent blue *Selaginella* patches in the deepest shade between the gours (thin-film colour, view-dependent). |
| **swiftlets** | Cave swiftlets: small birds crossing the chamber, flaring white-gold when they cross the beam. **[amended: §3.8, demoted]** |
| **the vine fringe** | The hanging vines on the oculus rim. They comb the sunfall into lengthwise streaks (an animated gobo). |
| **gaps** | Ranked openings in the vine fringe (ranks 1–7). The combo opens them in a fixed order, each adding a shaft. |
| **sun stations** | Six sun positions across the oculus, selected by level and advanced by the clock: the light walks. |
| **weathers** | Four cave weathers on a clock: Clear Breath, Rising Mist, Monsoon Veil, Steam Hour. |
| **flush, young leaves, delayed greening** | Real tropical biology: many species flush their new leaves red, pink, bronze or white, and the leaves turn green later. The theme's colour language. |
| **Flush** | The lock beat: four young leaves in the piece's colour snap open on a strand. |
| **Shower** | The clear beat: a veil of rain through the oculus that glitters only where the light is. |
| **New Growth** | (Added in §3.5.) A band of crowns in the pool that flushes in a cleared row's own colours. |
| **the Snap** | (Added in §3.7.) The hard-drop beat, replacing the proposal's swiftlet "Startle". |
| **Inhale, Exhale** | The combo beat (mist drawn in, shafts multiply) and its release (one cloud rises out through the oculus). |
| **Sevenfold** | (Renamed in §3.11, was "Cathedral".) The chain-7 state: seven shafts. |
| **Cataract** | The four-line beat: a white waterfall drops 200 m through the sunfall. |
| **flood threads** | (Added in §3.10.) Thin waterfalls from the rim that hang while a back-to-back chain is live. |
| **Echo** | The far doline answering a back-to-back. |
| **the Turning** | (Added in §3.9, replacing "Leaf-turn".) The T-spin beat: the vine fringe turns, and the light pattern turns with it. |
| **Zenith Flush** | The perfect-clear beat: the sun stands vertical in the oculus and the whole jungle flushes. |
| **`dlSunlit`** | The analytic "is this point in direct sun" test: walk the point toward the sun to the ceiling plane and read one CPU-mipped oculus mask. The concept's best technique. |
| **`dlBow`** | The rainbow colour function (primary, secondary, Alexander's dark band). |
| **`bowSun`** | An art-directed sun direction that `dlBow` uses so the bow lands where the composition wants it. |
| **iris** | The world's exposure dial (`u.iris`); event lights are multiplied by it and the bloom knee follows it. |

---

## 1. The concept in full (as proposed)

Everything in this section is the proposal as the judges scored it, with every number kept. Where §3
changes something, a marker **[amended: §3.x]** points to the change. The proposal assumed it would take
Cosmic Chimes' slot (that slot is now Rainbark's); slot-specific parts are written here for "the theme this
one replaces" (see PLAYBOOK.md "Choosing a slot").

### 1.1 Name, id, logline

- **Display name:** **Sunfall**. At proposal time no theme, Odyssey chapter or doc in the repo used the
  word (checked with a grep of `src/` and `docs/`; re-check `src/`, `public/`, `tests/` and
  `scripts/` at Stage 0, because this folder now contains it). Alternate name: *Skywell*, also unused.
- **id:** `sunfall`. Registry group `biomes`. (The proposal noted this leaves the `cosmic` group that the
  replaced theme sat in; that is true of whichever slot it takes if the old theme was `cosmic`.)
- **Logline (as proposed):** *Sunlight pours into the world's largest cave like a waterfall. A lost jungle
  grows in that light and the cave breathes out its own clouds. Every move you make becomes weather,
  rainbows and new leaves.* **[amended: §3.4, "rainbows" is now one event; the header logline is the
  amended one]**

#### The seed as researched (candidate #19, "DOLINE", alt "Skylight Jungle")

The research survey (33 candidates, top 5; in full in `docs/theme-concepts/reference/research.md`, candidate #19)
ranked the seed 5th of its top five: "A sunbeam falling into a lost
jungle inside a cave, with its own clouds, is maximum atmosphere and depth, and daylight shafts set it apart from the
night caves (crystal-cave, bioluminescence). It ranks fifth because volumetric light is the main phone risk and
because 'cave' and 'jungle' each brush against existing themes." The seed as surveyed, before the proposal reshaped
it (kept here for completeness; the proposal below supersedes it):
- **Scene:** foreground wet limestone and a calcite rim pool by the board; midground a colossal cave with a jungle
  under the skylight; background a vertical sunbeam pouring in "like a waterfall", with cloud wisps near the ceiling
  and a river below.
- **Palette:** `#0D1311` cave dark, `#2D5A38` jungle, `#A3D46A` sunlit leaves, `#FFF0C4` beam, `#C9D3D2` cloud,
  `#6B7782` limestone, `#3B8FA0` river.
- **Moves:** the beam drifts with the sun, motes and mist swirl, swifts circle in the shaft, drips fall.
- **Gameplay ideas:** lock, a drop of light falls through the beam and the leaves shiver; clear, the beam brightens
  and a cloud forms at the ceiling; combo, the sun aligns and the beam widens, swifts swarm; four lines, the sun
  stands overhead and floods the cave, the cloud bank glows; T-spin, a mist vortex in the shaft.
- **Techniques:** an additive cone or slab beam with 3D noise and depth fade (or a half-resolution raymarch in a
  cylinder), height fog, instanced foliage cards.
- **Phone risk:** moderate to high (volumes). **Similarity:** moderate (caves in crystal-cave and bioluminescence;
  jungle in the forest themes; daylight sets it apart).

The proposal dropped the rim pool (mirror cliché), the river, motes and the dark cave palette, and made the day the
light.

#### How the seed was reshaped

The seed was "a sunbeam into a cave skylight with a jungle and clouds inside". As stated, that sits on three
avoid-lists in the fleet catalogue: crystal-cave ("caves and stalactites; light shafts through a vault"),
cinder-drift ("underground chamber, roof light shaft") and bioluminescence ("caves and grottos"). So the
concept was reshaped in three ways.

1. **This is not a dark cave with a shaft. It is a chamber full of daylight.**
   - The sunfall is the one light source and the hero. It is a column roughly 90 m across that fills a
     fifth of the frame.
   - The mist it lights makes the whole chamber glow, so the frame is high-key, green and gold.
   - The sunlit jungle lights the stone vault from below. The underside of the cave's own cloud deck glows
     gold where the beam punches through it.
   - Nothing in the scene emits light. There are no crystals, no fungi, no pool, no stalactite forest and
     no glow-worms.
2. **The camera looks across and down into an abyss, not down a hall.** It sits on a ledge high on the
   chamber wall, looking across a 200 m void to a jungle floor. No floor plane recedes to a vanishing
   point, and there is no tunnel converging on a glowing centre.
3. **The grammar is weather and growth, built from four true facts.** Together these produce a gameplay
   language no theme in the fleet uses:
   - Son Doong's own clouds, which form from the temperature difference at the dolines.
   - Its wet-season waterfalls into Doline 2.
   - Rainbows that form in cave-mouth fog.
   - The tropical "red flush" of young leaves (delayed greening).

#### Grounding facts (web research made for the proposal, 6 lookups)

**Son Doong**
- Two roof collapses (dolines) let the sun in. Sunbeams are strongest at the first doline and depend on the
  season.
- Mist forms in the big passages and drifts up toward the dolines. It comes from the temperature difference
  between the cave and the outside air, carried on a cold, damp current blowing out of the cave.
- Doline 2, the "Garden of Edam", is about 252 m deep from the rim to the jungle floor.
- Its trees are 30–50 m tall and unusually slender, because they race upward for light. Past the doline the
  light fails and only mosses and ferns grow.
- Rimstone pools occur throughout the cave. Near the Garden of Edam, cave pearls about 10 cm across sit in
  dried-out terrace pools.
- A flowstone wall 60–90 m high (the "Great Wall of Vietnam") stands in the cave. One stalagmite (the "Hand
  of Dog") is 80 m tall.
- Cave swiftlets were among the new species found there. Monkeys and flying squirrels live in Doline 2.
- After rain, a veil of waterfall pours into Doline 2 (photo record).
- (From the research survey) the openings are at least 90 m across and the main chamber is about 200 m high.

**Optics**
- At Stephen's Gap (Alabama), cool cave air meets hot outside air and forms a fog layer. Photographers have
  caught rainbows inside the cave entrance in that fog.

**Plants**
- *Selaginella willdenowii* and *S. uncinata* are shade spikemosses whose leaves shimmer metallic blue. The
  colour comes from thin-film interference in a layered cuticle. They grow only in deep shade under the
  canopy.
- 20–62 % of tropical woody species flush their young leaves red, pink, bronze or white with anthocyanins.
  The leaves turn green later ("delayed greening").

In-game copy must not state species facts; these are art direction.

### 1.2 The picture

#### Desktop 16:9 (the reference frame)

**Camera**
- It stands on a calcite ledge on the chamber wall, about 90 m above the jungle canopy and about 380 m from
  where the sunfall lands. The foot of the beam is about 13° below eye level, and the oculus rim sits about
  22° above it, right at the top edge of the frame.
- It is level or pitched down 2–4°, with a vertical FOV of about 52° (horizontal about 82° at 16:9).
- The sun is behind the viewer's left shoulder, 44–64° high. So the sunfall falls *away* from us and leans
  slightly right. Because it recedes, it reads as a solid column standing in space rather than a flat
  stripe. **[amended: §3.4, the bow geometry does not follow from this sun; see gap G2]**

**The hero, upper-left to lower-left**
- The **oculus**, the collapsed skylight, is cropped by the top-left of the frame. It is a ragged hole in the
  vault whose rim is fringed with the surface forest: leaning trunks, palms and long lianas. Pale tropical
  sky shows through, blue-white with drifting cumulus.
- From it pours the **sunfall**: a column of white-gold light, sharp-edged and combed lengthwise into
  parallel streaks where the light passes between the vines on the rim. It lands on the canopy at about
  22 % across and 78 % down the frame.
- Where it lands, the jungle **blazes**:
  - Crowns of 45 m slender trees glow chartreuse where light passes through the leaves.
  - Wet leaves throw tiny specular stars.
  - A low skin of mist over the canopy turns incandescent.
- Around the pool of light the forest falls away into deep blue-green shade.

**Overhead**
- The **vault** arches across the top fifth of the frame. It is lit softly from *below* by the green-gold
  bounce of the sunlit jungle. That glow on the ceiling is the scene's signature.
- Under the vault floats the **cave's own cloud deck**: flat, pearl-grey banks drifting toward the oculus.
  - Where the sunfall passes through the deck, it burns a bright elliptical hole with gold edges.
  - The deck thins as it is drawn up and out through the opening.

**Behind the card (centre)**
- Open air across the chamber: luminous, low-contrast blue-green mist and the faint far wall.
- This band is quiet on purpose. The post calm zone sits here and has almost nothing to suppress.

**Right third (depth)**
- The passage runs on to the right and away, a colossal corridor about 150 m high.
- A 90 m wall of cream flowstone curtains catches the bounce light.
- An 80 m stalagmite stands in silhouette against the haze. **[amended: §3.2]**
- About 1 km away at the end is the **second doline**: a small pale-green window of daylight. It has its own
  thin, distant sunfall and a smudge of lit jungle, all softened by aerial perspective into blue-grey-green.

**Foreground**
- **Dry rimstone terraces** fill the bottom-left and bottom-right corners: scalloped calcite dams with moss on
  their lips and cave pearls in their dry pools. They are lit only by soft bounce, with a wet sheen on the
  lips.
- In the deepest shade between them grow **peacock spikemoss** patches, which shimmer metallic blue as the
  camera drifts.
- **Hanging root curtains** come down out of the top of the frame on both sides of the card. These are long
  aerial roots and lianas let down from the surface forest: two or three crisp strands near the card on
  each side, several deeper strands softened by haze, and young leaves along their length.

**Light**
- **Key:** the sun through the oculus, white-gold. It warms toward amber at the slanting sun stations.
- **Fill:** sky light through the oculus, blue, falling top-down. It fades with distance into the passage.
- **Bounce:** the sunlit jungle pool, green-gold. It lights the vault, the underside of the cloud deck and the
  near walls from below.
- **Far fill:** the second doline, cool pale green.
- **Shadows:** there are no shadow maps and no lights. The roof *is* the shadow. Anything not inside the
  sunfall's projection through the oculus is in shade, and the vine fringe and canopy gaps act as a natural
  gobo.

**Why it has depth.** Five layers are separated by value, hue and haze:
1. The near root strands and terraces: dark, crisp, edged with green.
2. The sunfall and the lit canopy: the brightest values in the frame.
3. The cloud deck and the vault: mid values.
4. The far passage: low-contrast blue.
5. The far doline: a second, smaller light source deep in space that anchors the vanishing distance.

Scale cues add to it:
- The trees are tiny 45 m crowns.
- Swiftlets cross the beam as specks.
- Drips take seconds to fall through the light.
- A slow camera drift (±0.6 m) shifts the near strands against the far wall.

#### Ultrawide 21:9

- Vertical FOV is held and the horizontal FOV widens.
- The composition solver pins the sunfall at about 18 % across, so the extra width on the left shows more of
  the oculus rim and more lit canopy.
- On the right, the far doline moves to about 83 % and shows in full: its thin beam, a waterfall thread from
  its rim and its own small jungle.
- The 80 m stalagmite and the flowstone wall fill the band between the card and the far doline. The picture
  becomes a diptych: *near world / far world*, joined by the cloud deck.

#### Upright phone

- A vertical doline is the natural format for this place: sky at the top, jungle at the bottom, light joining
  them.
- **Camera:** about 90 m above the canopy, pitched up about +10°, vertical FOV about 68°. Sun-station lean is
  clamped to ±5° so the column never sweeps diagonally across the card.
- **Top band** (above the card):
  - The oculus: rim silhouette and blue sky.
  - The cloud deck, with its burning hole where the sunfall enters.
  - The first 40 m of the column.
- **Card band:** the column passes behind the left half of the card and is soft-clipped by the calm zone.
  Root strands hug the narrow margins. **[amended: §3.3, calm inside the beam material]**
- **Bottom band:** the sunfall's foot, an incandescent pool of canopy in glowing mist, with dry terraces and
  spikemoss at the bottom edge.
- The far doline is dropped; at most a faint glow shows lower-right.
- Lock reactions move to the lowest visible tips of the strands just above the card's top edge, at the
  piece's column. This mirrors the house fix of moving the hero above the card.

### 1.3 Palette

#### Core colours (scene-linear targets, shown as sRGB hex)

| # | Name | Hex | CIE L\* | Role |
|---|---|---|---|---|
| 1 | **Sunfall White** | `#FFF1CC` | 95 | Beam core and the brightest mist |
| 2 | **Oculus Sky** | `#BFDDF7` | 87 | Sky seen through the opening, and the blue fill |
| 3 | **Backlit Chartreuse** | `#B5E24C` | 84 | Leaves with sun shining through them in the pool |
| 4 | **Doline Emerald** | `#2A7F52` | 47 | Canopy body and moss in light; the end colour of delayed greening |
| 5 | **Understory Shade** | `#142A24` | 15 | Deepest green-black shadow (never pure black) |
| 6 | **Vault Limestone** | `#5F6B66` | 44 | Cool grey-green rock in bounce light |
| 7 | **Flowstone Cream** | `#E9DEC2` | 89 | Calcite curtains, terrace lips, cave pearls |
| 8 | **Cave-Cloud Pearl** / **Gilt Underside** | `#E4EBE8` / `#FFD27F` | 93 / 86 | Cloud deck, and the gold where the beam hits it |
| 9 | **Chamber Haze** | `#5D8087` | 51 | Aerial perspective toward the far passage |

(L\* values were computed for this file, D65, from the hexes.)

**Accents.** These come from real biology or optics and are kept small:
- **Flush Crimson** `#E8385E`: young leaves.
- **Peacock Fern** `#2F86F6`: the iridescent spikemoss, view-dependent. **[amended: §3.17, the O piece hex]**
- **The rainbow**: spectral, events only. **[amended: §3.4, four lines only]**

**Where this sits in the fleet's palette map.** This is the emerald-dominant, high-key daylight slot that the
catalogue listed as open. It is not verdant-hills' "grass green and sky blue", because 60 % of the frame is
stone and mist with strong light and shade. **[amended: §3.15, measured green budget]**

#### Variants: two native drivers instead of an hour wheel

**Driver 1, level: the sun's path across the oculus (a sundial you can see).** This change is *geometric*,
not a recolour:
- the column swings to a new angle;
- the pool of light slides across the canopy to a new patch of forest;
- different crowns light, and the shade moves with it.

Level n selects station (n−1) mod 6. The clock also advances one station every about 150 s, so Infinity mode
(which has no LEVEL_UP) still travels. **[amended: §3.14, level 1 starts at High Fall; the clock step timer
resets on level up]**

| Station | Sun / lean | Beam tint | Oculus sky | Look |
|---|---|---|---|---|
| First Reach | 46°, leaning away and right | `#FFD9A0` | `#F2DCC0` | The beam strikes the far wall high up; the jungle is shaded except a lit rim |
| Descent | 50° | `#FFE7B8` | `#D8E4EE` | The light slides down the wall onto the canopy's edge |
| High Fall (rest) | 54° | `#FFF1CC` | `#BFDDF7` | The canonical frame: a full pool on the jungle, bow-capable geometry |
| Long Column | 64° | `#FFF6E0` | `#B3D6F6` | Narrower and whiter; the pool directly below |
| Lean | 58°, leaning toward camera-left | `#FFE2A8` | `#D7DDE6` | Gold slant; long shadows from the slender trunks |
| Last Reach | 44° | `#FFC98A` | `#F0CFA8` | The light climbs the near wall; the jungle sinks into blue shade |

- Going from Last Reach back to First Reach happens *under a passing cloud* (see §1.4). The jump is never
  seen.
- The composition clamps lean so the foot stays in the left free space on landscape.

**Driver 2, clock: the cave's weather (its breathing).** Four weathers of about 110 s each, with 25 s
crossfades. The cycle is about 440 s, which does not divide evenly into the about 900 s sun cycle, so the
pairings keep changing.

| Weather | Mist | Look |
|---|---|---|
| **Clear Breath** (dry season) | ×0.5, `#DCE6E2` | Razor-edged column, crisp far doline, busy swiftlets, faint white fogbow in the mist **[amended: §3.4, no fogbow]** |
| **Rising Mist** (cold cave air meets warm jungle air) | ×1.8, `#E8EEEA` | The column becomes a solid pillar, the cloud deck hangs low and bright, the far doline is lost in haze |
| **Monsoon Veil** | ×1.4, `#C9D3D2`; beam cools to `#EEF2EA` | Rain falls through the oculus all the time; two or three waterfall threads hang from the rim; rainbow fragments come and go at the foot; the canopy is glossy **[amended: §3.10 and §3.4, no threads and no bow in weather]** |
| **Steam Hour** (after rain) | ×1.1, `#F2E6CC` | The sun heats the wet canopy and steam columns rise from the pool; everything glistens; humid gold haze |

### 1.4 Environmental animation (everything that moves)

| Element | Motion | Rate |
|---|---|---|
| Sunfall streaks | The comb of streaks drifts as the rim vines sway (the gobo is animated) | Vine sway period 7–11 s, ±0.6 m |
| Sunfall intensity | Breathes with mist density | ±6 %, period about 24 s |
| **Cloud crosses the sun** | A cumulus outside covers the sun: the column fades to 25 % and the cave turns blue, then light floods back | Every 70–110 s (seeded); 2.5 s fade, 1–3 s hold, 3 s return |
| Cloud deck | Drifts toward the oculus and is drawn up and out through it | 0.8 m/s drift, 0.5 m/s rise; flow-map crossfade every 8 s |
| Valley mist | Rolls along the passage and over the canopy | 1.2 m/s |
| Drips | Single drops fall from the rim through the beam, glinting (and showing one rainbow hue at the right angle) **[amended: §3.4, white-gold glints only]** | One every 1.5–4 s; terminal speed about 9 m/s, so a 200 m fall takes about 22 s |
| Passing showers | A veil of rain through the oculus (constant in Monsoon Veil) | Every 150–240 s, lasting 10–20 s |
| Waterfall threads | Two or three threads from the rim, accelerating in closed form (Monsoon Veil only) **[amended: §3.10, threads now mean back-to-back]** | Continuous |
| Steam columns | Twisting columns rising off sunlit crowns (Steam Hour only) | 3–6 columns, 1.5 m/s |
| Canopy | Crowns sway in the downdraft from the oculus; sparse random leaf glints | 0.05–0.1 Hz, ±0.4 m at the tops; glints small-area and randomised (no field twinkle) |
| Root curtains | Pendulum sway plus a slow travelling wave; leaves flutter | 0.12 Hz, ±0.3 m; flutter 0.5–1 Hz |
| Swiftlets | Pairs or trios carve long arcs across the chamber and flare white-gold when they cross the beam | Every 12–25 s, at 12–18 m/s |
| Far doline | Its beam shimmers; its own mist drifts | Slow |
| Spikemoss | Iridescent hue shifts with camera drift (thin-film by view angle) | Follows the camera |
| Camera | Slow drift ±0.6 m and yaw ±0.3°; pointer parallax on desktop (the near strands move most) | Period about 40 s |
| Sun station | The column swings and the pool walks | One station every about 150 s, 6 s transition |
| Weather | Mist, rain, steam and tint | About 110 s each, 25 s crossfade |

**Reduced motion:**
- drift and parallax ×0.4, and no camera sway;
- swiftlet flights cut to 30 %;
- leaf flutter off;
- showers thinner, and read through light rather than particle motion.

### 1.5 Gameplay event language (as proposed)

**The verbs.** Light **pours**, water **glitters and splits into colour**, the jungle **flushes**, the cave
**breathes**.

**What is left out.**
- Nothing flies out of the card edge.
- Nothing "holds the colour, then releases it on a wave".
- There are no blades of light at the cleared rows and no wave front per line.
- Four lines has no hush. T-spin has no spiral round the card. Level up has no palette wheel. Hard drop has
  no camera dip.

| Event | What you see (world-native) | Timing and scaling | Reads as |
|---|---|---|---|
| **Lock** **[amended: §3.6]** | **Flush.** On the hanging root strand just outside the card on the piece's side (columns 0–4 left, 5–9 right, outside the card and HUD), at the piece's row height, four young leaves (one per cell) snap open from tight buds, **flushed in the piece's colour**. They glow translucent where they catch light. The snap flicks 3–6 drops that glint as they fall. The leaves **stay as foliage** and green over about 18 s, through the piece colour, then bronze, then emerald (real delayed greening). Through a session the curtain grows lusher; the oldest leaves fold back into buds when their slot is reused. | Unfurl 0.45 s with overshoot; strand kick ±0.15 m; greening τ ≈ 18 s | "My piece grew leaves beside the board." Colour appears *in place*; nothing is flung |
| **Hard drop** **[amended: §3.7]** | **Startle.** The impact flushes the cliff swiftlets: 8–24 birds (scaled by drop distance) burst from crevices in the rock beside the card at the landing height. They fan out into the chamber, flare white-gold as they cross the sunfall and melt into the haze. The nearest strands jolt and shed a curtain of glinting drops. Folded into the lock, so you get one stronger moment. | Burst 2.5–4 s; at most one burst per 0.25 s (rate-limited) | A flock exploding off the wall, with no camera motion |
| **Line clear ×1** **[amended: §3.5]** | **Shower.** Rain sweeps over the oculus and a veil of drops pours down through the sunfall. Every lit drop glitters, and where the veil crosses the 42° rainbow angle it **splits into colour**: a faint primary-bow fragment kindles in the lit spray at the beam's foot. On the root strands, the leaves at the cleared rows' heights shake off their water, which ties the clear to its rows. | Veil 1.8 s; wet gloss 6 s | Glitter rain and a hint of rainbow |
| **Line clear ×2** **[amended: §3.5]** | A fuller veil, a clear primary bow, and the sunfall visibly thickens into a pillar while the drops pass. | 2.4 s; gloss 8 s | A clear rainbow |
| **Line clear ×3** **[amended: §3.5]** | A heavy downpour, primary **and** secondary bows with **Alexander's dark band** between them, and the canopy hissing with glints. | 3.2 s; gloss 10 s | A double rainbow inside a cave |
| (cascade waves) | Each gravity-cascade wave brings an *aftershower*, smaller and offset in time. | +0.6 s per wave | "The rain keeps coming" |
| **Four lines** **[amended: §3.12]** | **Cataract.** For 0.35 s a bright tongue of water slides over the oculus lip: native anticipation, not a hush. Then a white waterfall drops the full 200 m *through* the sunfall. It blazes where the beam lights it and turns slate-blue where it leaves the light. A spray cloud blooms off the canopy and **a full double rainbow stands in the spray**. Mist billows out through the chamber, swiftlets erupt from every wall and the canopy thrashes. The fall thins to threads over 5 s; the jungle glistens for 15 s. | 0.35 s lead, 5 s fall, 15 s wet tail. Exposure dips slightly (iris) so the fall reads as white water, not a white screen | The doline floods: unmistakable and huge |
| **Combo chain** (true combo) **[amended: §3.11]** | **Inhale.** Each link draws mist into the cave. The beam turns into a solid pillar, then **splits into more shafts** as gaps open in the rim's vine fringe, opening in a fixed order: 2 shafts at chain 2, up to 7. At 5 the cloud deck's underside gilds. At 6 the canopy starts to flush (crowns of young red, rose and bronze leaves light up across the pool). At 7 and above, **Cathedral**: a fan of seven shafts, incandescent mist, and the vault lit green-gold from below. | Mist density ×(1 + 0.22·(n−1)), capped at chain 8; one gap opens per link, 0.5 s each | The chain is *counted in shafts of light*; a glance tells you the chain length |
| **Combo release** (chain breaks; reported one lock late) **[amended: §3.11]** | **Exhale.** The gathered mist rolls together into one cloud that **rises up and out through the oculus**. The shafts close from the outside in, and the exhaled cloud's shadow briefly dims the sunfall as it passes through the opening, a natural full stop. A bigger chain makes a bigger, golden cloud. | 3–5 s; shafts close one per 0.25 s | The cave breathing out the combo |
| **Back-to-back** **[amended: §3.10]** | **Echo.** The far doline answers. One kilometre away its pale window brightens, its thin beam swells, and a tiny shower and rainbow glint inside it, as if the cave were calling back along its length. | 0.6 s rise, 3 s hold; layered on the four-line or T-spin clear it accompanies | The second world lights up |
| **T-spin** **[amended: §3.9]** | **Leaf-turn.** A gust swirls down through the oculus and *turns every leaf in the light*. A wave of **crimson-burgundy leaf undersides** races across the canopy (many shade plants have red undersides) and the root-strand leaves flip too. One wave per line (1–3), running from the piece's side. Luminance is held constant; this is a hue wave, not a flash. | 1.4 s per wave, 0.25 s stagger | The jungle *turns* as one, a literal T-*spin* |
| **Perfect clear** | **Zenith Flush.** The sun stands squarely in the oculus. The sunfall rights itself to vertical and widens to fill the whole opening, with every gap open. The mist goes incandescent, the vault is revealed, and **the whole jungle flushes at once**: every crown and every root leaf bursts into young-leaf colours (all seven piece colours scattered through the forest). It greens back over about 20 s. It arrives on its own later frame and needs no rows. | 1.2 s rise, 4 s peak, 20 s greening tail | The rarest event, and the most colourful frame in the theme |
| **Level up** **[amended: §3.14]** | **The light walks.** The sun advances one station across the oculus. The column swings to its new angle, the pool of light slides across the canopy (newly lit crowns flush briefly as the light reaches them) and the light's colour warms or cools. Going from the last station to the first happens under a passing cloud. | 3 s swing; flush 4 s | A moving sundial, not a recolour |
| **Game over / top-out** (window `gameOver`, GameModeManager `modeStopped`) | **The light leaves.** The sunfall lifts off the jungle, climbs the wall and narrows to a sliver at the rim. The doline cools to blue-green twilight, mist settles low over the canopy and the swiftlets stream home into the dark passage. A new session brings **Morning enters**: the beam slides back down the wall onto the forest. | 4 s out; 4 s back in | The day ending in the doline |
| **Idle (no play)** | **The doline breathes.** Drips glint through the beam. Swiftlet pairs cross. Every 70–110 s a cloud crosses the sun, dimming the cave and then flooding it again. Showers pass. Weather and sun drift on their clocks. After 30 s with no lock, the drips thicken slightly ("the cave fills the silence"). | See §1.4 | Alive, never static |
| **Meditation clicks** (`screen` position) | A drip burst at the click point: drops fall from there and glint, with a bow fragment if they cross the beam **[amended: §3.4, no bow]**. Click combos drive the **Inhale** dial. | Rate-limited | Touching the light |

**Photosensitivity and accessibility (as proposed; all kept).**
- There is no event flash on locks or on combo steps.
- The cataract and Zenith use an exposure lift of at most 0.25, a rise of at least 0.35 s, `max()` rather
  than sum, and an exponential decay of at least 0.6 s. Rapid four-line clears and cascades cannot stack into
  strobing (at most 3 lifts per second, enforced in the world).
- The bright white masses are large-area but slow. HDR is clamped before bloom.
- Drop glints are tiny and randomised in time, so they never twinkle in sync.
- The T-spin wave holds luminance steady and runs once per line. It never cycles red at 3 Hz or more.
- Under reduced motion:
  - bursts shrink to 30 %;
  - showers keep their light and rainbow but use fewer and slower drops;
  - the cataract keeps its rainbow and gloss but its spray billow is halved;
  - the camera never moves.

### 1.6 Piece colours (as proposed) **[amended: §3.17, CVD fix]**

The seven colours of a doline: four young-leaf flushes, the sunfall, the spikemoss shimmer and an orchid. The
palette gate scores **0/7**, computed with the same hue maths as `scripts/palette-guideline-check.mjs`.
**Every** role is deranged, and the hues are spread round the wheel.

| Shape | Name | Hex | Hue | Band the gate checks for this shape | Band this hue actually sits in |
|---|---|---|---|---|---|
| I | **Flush Crimson** (young-leaf anthocyanin) | `#E8385E` | 347° | cyan 160–210 | (red, a Z role) |
| O | **Peacock Fern** (iridescent *Selaginella*) | `#2F86F6` | 214° | yellow 32–75 | (blue, a J role) |
| T | **New-Growth Chartreuse** (backlit leaf) | `#A6DC3E` | 81° | purple 245–315 | none |
| S | **Sunfall Gold** | `#FFC23E` | 41° | green 90–170 | (yellow/orange) |
| Z | **Canopy Jade** | `#21C27E` | 155° | red 320–20 | (green, an S role) |
| J | **Bronze Flush** (copper young leaves) | `#DE6A27` | 22° | blue 200–250 | (orange, an L role) |
| L | **Doline Orchid** | `#A774F4` | 264° | orange 20–50 | (purple, a T role) |
| GARBAGE | **Wet Limestone** | `#3A4640` | (achromatic-ish) | — | — |
| CLEAN_GARBAGE | **Cave Pearl** | `#E6DDC9` | — | — | — |

(The hues were re-computed for this file with the script's formula; the proposal's values are exact to the
degree. The gate result 0/7 is confirmed.)

**Telling them apart (as proposed).**
- **Light pieces** (relative luminance about 0.6): T chartreuse and S gold are 40° apart in hue.
- **Mid pieces** (about 0.4): Z jade.
- **Darker saturated pieces** (0.2–0.27): I crimson, J bronze, O blue and L orchid, each at least 35° from the
  next.
- **Colour-blind risk:** for deuteranopes, chartreuse and gold approach each other, and so do crimson and
  bronze. The board's fused-shape gradient and rim keep the shapes readable, and the build should run a CVD
  simulation pass before final hexes. (Run for this file: the collapse is worse than predicted, O and L
  are nearly identical under protanopia. §3.17 fixes it.)

**How cells look.** Use `renderMode: 'solid'`, following Ocean's and Stillwater's lead, with no glow, pulse or
trail, so active, ghost, hold and next pieces stay crisp. The look is *a wet leaf in a sunbeam*:

```js
effects: { premium: true, phaser: {
  gradient: true,      // top light from the oculus: the upper edge one value lighter
  highlight: 0.22, shadow: 0.24,
  rim: true, rimAlpha: 0.5, rimWidthFactor: 0.05,   // the bright translucent edge of a backlit leaf
  gloss: true, glossAlpha: 0.18,                     // a dew sheen in the top-left
} }
```

The world takes each piece's colour for its **young leaves** (the Flush on lock) and for the colours scattered
through the forest on Zenith Flush. The rainbow is never a piece colour; it belongs to the light.

### 1.7 Rendering plan (TSL, three r186.1, WebGPU and WebGL2 backends)

#### Principles (house-conformant)

- All surfaces use `MeshBasicNodeMaterial`, self-shaded in scene-linear HDR from **one** uniform bag `u`.
  There are no scene lights, no shadow maps, no `ShaderMaterial`, no `mx_noise`, no compute and no MRT.
- There is **one scene pass and one post pass**. Sunfall needs **no render target of its own**:
  - no env target, because the sky shows only through the openings and is drawn directly as the far-plane
    backdrop;
  - no reflector, because there is no mirror water;
  - no sim targets, because every motion is closed-form.

  Only the bloom chain inside the post pipeline allocates targets.
- **Only 2D textures**, all baked on the CPU with CPU mips. There is no `Data3DTexture` and no `lut3D`. 3D
  mist noise uses Void Ember's 2D-lattice trick (`u.noise3`, two trilinear fields per fetch;
  `src/themes/void-ember/void-ember-tsl.js`).
- Events are closed-form slots in one compact `vec4` event table (64 rows or fewer, which keeps it safe for
  WebGL2 fragment uniform limits on low-end Mali). There is also one `InstancedInterleavedBuffer` per
  instanced family, written only when an event lands. `seek(t)` plus a fixed-step replay reproduces any
  frame.
- Every pool is always drawn. Dormant slots collapse to zero size, so the first frame compiles every
  pipeline.

#### The key trick: an analytic "sunlit" test

The roof is the occluder, so direct sun at any point `p` is exact in closed form:

```
q   = p.xz + S.xz * ((H_oculus - p.y) / S.y)      // walk p toward the sun up to the ceiling plane
m   = oculusTex.sample((q - oculusCentre) / oculusSpan + 0.5).level(lod)
lit = rimOpen(m.r) * (1 - fringe(m.g)) * gapOpen(m.b, u.shaftsOpen)
lod = log2(0.0093 * (H_oculus - p.y) / texelMetres)  // the sun's 0.53° disc → physically sized penumbra from CPU mips
```
**[amended: §3.16, `lod` uses the distance along the ray; the fringe moves to its own texture]**

- One texture fetch gives correct soft shadows and gobo streaks of the rim vines on **everything**: rock,
  canopy, mist, rain drops and birds.
- The **combo shafts** are the B channel: a field in which each gap cell carries a rank from 1 to 7. Gap n
  opens when `u.shaftsOpen ≥ n`, so the combo opens gaps in a fixed, designed order.
- The same mask `discard`s the ceiling mesh inside the opening, so the oculus silhouette and the beam's
  cross-section always match exactly.
- `dlSunlit(u, p)` is a plain JS builder (it reads a texture and uniforms), inlined into each material, per
  the house rule. Its maths helpers are laid-out pure `Fn`s.

#### Per element

| Element | Technique | Notes |
|---|---|---|
| **Sky** (`-sky.js`) | Far-plane one-triangle backdrop (Serenity Warp pattern), `renderOrder` last among opaque. An analytic tropical sky: zenith-to-horizon gradient, sun glare lobe, 2D-fBm cumulus whose crossing drives the "cloud crosses the sun" uniform, and the surface-forest silhouette from oculus A channel. | Shaded only where it shows: the oculus and the far doline. Almost free. |
| **Cave shell** (`-cave.js`) | CPU-built mesh: an elliptical vault cross-section swept along a curved passage (near chamber, far passage, far doline chamber), displaced by baked fBm, and the 80 m stalagmite as a noise-displaced lathe. Ceiling `discard` by the oculus mask; a second ceiling layer 6 m lower with an inset mask gives the rim thickness. **Shading:** limestone with bedding bands (sine of height plus warp); cream flowstone streaks (vertically stretched noise); algae and moss weighted by baked per-vertex light exposure plus live `lit`; wet sheen. **Lighting:** `lit × sunColour`; plus sky view factor (baked per vertex on the CPU by sampling 64 directions toward the oculus); plus **analytic bounce** from the pool, treated as a disc area light (`E ≈ ρ·E_pool·cosθ_n·cosθ_disc·A/(π d² + A)`) whose centre, radius and intensity follow the sun station. This is what lights the vault green-gold. **Haze:** `mix(col, hazeIn(u, d), 1 − exp(−σ·dist))` with luminous in-scatter, so the chamber reads as full of light. | About 30k triangles at High. Fine detail octave dropped in JavaScript on Low and Minimal (gotcha #135). **[amended: §3.16, CPU-first shape recipe]** |
| **Canopy** (`-jungle.js`) | CPU grid (64² to 256² by tier) displaced in the vertex stage from a baked `canopyTex` (R height of Voronoi crown domes, G crown id hash, B flush class, A cavity). Fragment: leaf-clump normals from two fBm scales; direct `lit` with crown-top self-shadowing; a **transmission** lobe (chartreuse where light passes through leaves); oculus-only sky fill; bounce; wet GGX-lite specular (written as products, no `pow`) driven by `u.wet`. **Flush:** per crown class, tinted toward the event colours (combo bloom and Zenith Flush use the 7 piece colours by crown hash, then green over τ). **Leaf-turn:** up to 3 front slots, each a moving band that mixes toward the burgundy underside at constant luminance. | Soft mist contact comes from the same height function, with no depth read. **[amended: §3.16, no Voronoi domes; §3.9, no leaf-turn fronts]** |
| **Emergent trees and understory** (`-jungle.js`) | 16–80 slender 40–50 m trunks (instanced 8-sided cylinders) with crown impostors: camera-facing quads carrying a procedural clump SDF and an SDF-gradient normal. Foreground ferns are instanced frond strips with vertex sway. **Peacock spikemoss** patches use analytic thin-film colour: `0.5 + 0.5·cos(2π(k·d·cosθ + φ_rgb))`, very low albedo, shade-only. | Scale cue. Spikemoss is the only "jewel" in the picture and it is reflected, not emitted. |
| **Sunfall** (`-beam.js`) | **Medium and up:** an oblique elliptic-cylinder **hull** mesh from the oculus plane to the canopy, sheared along S. It is drawn front-faced, premultiplied additive `vec4(rgb, 0)` and depth-tested, so near roots and rocks occlude it. The fragment solves the ray-cylinder entry and exit in sheared space in closed form, clamps by the canopy plane and the oculus plane, then **marches N steps** (10/16/24/32) with a static IGN jitter (`interleavedGradientNoise(screenCoordinate)`, so no temporal swimming). Each step does one mask fetch (`dlSunlit`) and one `u.noise3` fetch (mist patches times a height profile times `u.mistDensity`), accumulating Beer transmittance and a two-lobe HG phase (g = 0.78 forward, 0.25 back), multiplied by `u.iris`. All samples use `.level()`, so the reads are legal inside the loop. **Minimal and Low:** the **closed-form beam**. The analytic chord length L through the cylinder gives `I = σ_s·HG·L·½(mask(entry) + mask(exit))·(1 − e^{−σ_t L})/(σ_t L)`, costing 2 mask fetches and 1 noise fetch. The vine streak comb is preserved exactly; only the mist patchiness is lost. **Far doline beam:** the closed-form beam on every tier. | Cost scales with the hull's screen area, which the composition caps at about 30 % of the frame. **[amended: §3.3 and §3.16: TSL `Loop`, fewer steps, closed form as the base on every tier, 22 % cap]** |
| **Mist** (`-mist.js`) | **Cloud deck:** 2–8 horizontal noise sheets under the vault. **Valley mist:** 1–3 sheets over the canopy. **Exhale column:** a vertical billboard volume. **Spray cloud:** for the cataract and showers. **Steam columns:** Steam Hour. Each sheet does a domain-warped 2D fBm with wide ramps and `1 − exp(−τ)` (gotcha #116), flow-advected by two crossfaded layers, plus one `dlSunlit` fetch, which produces the **glowing hole** where the beam pierces the deck. It adds HG and ambient (sky view plus pool bounce from below, which gilds the deck's underside). The output is premultiplied "over". Contact with the canopy and walls is softened analytically from the height functions. Sheets near the camera fade with distance so no plane edge ever slices the view. | No depth reads. Fixed `renderOrder` bands. **[amended: §3.16, grazing fade and analytic valley haze]** |
| **Water** (`-water.js`) | **Drops** (drips, showers, cataract spray): instanced motion-blurred streak quads in clip space (Serenity Warp star pattern, at least 1.15 px wide and dimmed instead of going sub-pixel). Fall is closed-form with terminal velocity: `y = y0 − v_T(t − τ(1 − e^{−t/τ}))`. In the **vertex stage**: `lit = dlSunlit(p)`. A drop outside the light collapses to zero size, so it costs no fragment work and is invisible, exactly like real rain in a sunbeam. Drop colour is a **per-drop rainbow**: the angle from the antisolar point is computed with products (no `acos` of an unclamped value) and passed to a laid-out `dlBow(angle)` (primary band at 40.6°–42.4°, red outside; secondary at 50°–53.5°, reversed; Alexander's band between at 0.7×). The bow **emerges from the ensemble of drops** and needs no painted arc. The spray and mist sheets near the foot read the same `dlBow` weighted by water content, so the bow stays continuous. **Cataract:** a curved curtain ribbon from the rim with a flow-streak shader (noise stretched along the fall, UV advanced by the closed-form fall distance, frayed edges, foam at the foot), lit by `lit`, plus spray billboards. | Light budget per tier (gotcha #120): count × area × exposure is capped in the quality table. **[amended: §3.4, the bow is analytic on a spray shell and only on four lines]** |
| **Root curtains** (`-roots.js`) | 3–12 strands per side, as instanced world-space strips with camera-facing width (at least 1 px). Positions come from composition anchors outside the card and HUD union. Vertex sway: `x += A·s²·sin(ωt + k·s)` plus damped event kicks `e^{−t/τ}·sin(ω_k t)`. **Leaves:** instanced quads attached at (strand, s) with a procedural ovate SDF (midrib and veins) and translucency. Per-leaf state lives in an interleaved buffer (unfurl time, flush colour, greening epoch, strand, height), written once per lock. | One draw for strands, one for leaves. |
| **Swiftlets** (`-birds.js`) | Instanced quads with a scythe-wing SDF silhouette and a flap phase. Paths are closed-form (Bézier from slot seed and nest site, then ease out into the haze). In the vertex stage, `lit` flips the silhouette from dark to a white-gold rim when a bird crosses the beam. | 24–160 instances. **[amended: §3.8, 6–24]** |
| **Gours** (`-gours.js`) | CPU-built terrace mesh in the foreground (quantised noise contours with rounded lips), damp sheen and moss on the lips. **Dry pools** (the real Son Doong detail) avoid the mirror cliché entirely. Cave pearls are a small instanced low-poly sphere set. | Cheap; portrait shows it at the bottom. |
| **Post** (`-post.js`) | Scene pass (MSAA 4× on High and up), then bloom (Medium and up, the house max-channel soft knee, threshold following the iris), then one output pass: calm zones (house SDF soft-clip) → short **veiling glare** dragged from the bloom texture toward the oculus (6–10 taps, emitters limited to the oculus neighbourhood, per gotcha #103) → exposure and event lift → **"sunfall filmic"** (hue-preserving, k ≈ 0.5, whitening only above a peak of about 6) → grade (green-teal lifted shadows, warm-white highlights, saturation 1.06) → vignette → sRGB → grain and dither. | `usesMrtScenePass() → false`. **[amended: §3.3, the veiling-glare drag is removed]** |

**Render order:**
1. Opaque: cave 10, gours 12, canopy and trees 14, roots 16.
2. Sky backdrop 50.
3. Far mist 60.
4. Beam hull 70.
5. Water and birds 80.
6. Near mist and spray 90.
7. Leaves FX 95.

#### Parts, slots and uniforms

- **`SUNFALL_PARTS`:** `sky, cave, jungle, beam, mist, water, roots, birds, gours`. The URL catalogue
  (`captureThemes` in `src/ui/url-parameters/theme-parameters.js`) gets one row:
  `['sunfall', 'sunfall', 'Sunfall', 'sky, cave, jungle, beam, mist, water, roots, birds, gours']`.
- **Event slots (as proposed; §5.4 has the amended table):**

  | Slot type | Count |
  |---|---|
  | showers | 4 |
  | bow boost | 2 |
  | cataract | 1 |
  | bird bursts | 6 (× per-instance seeds) |
  | leaf-turn fronts | 3 |
  | echo | 2 |
  | zenith | 1 |
  | exhale | 2 |
  | light-walk | 1 |
  | dusk/morning | 1 |
  | lock leaves | ring buffer of 48 locks × 4 leaves per side group |

- **Integrated, wrapped scalars:** `shaftsOpen`, `mistDensity`, `wet`, `flushAll`, sun station phase, weather
  weights `vec4`, `cloudCover`, `iris`.

#### Cost per tier (estimates, to be measured in the playground)

| | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Pixel ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |
| Sunfall | closed-form | closed-form + 1 mist slice | march 10 | march 16 | march 24 | march 32 |
| Mist sheets (deck + valley) | 2 | 3 | 4 | 6 | 7 | 8 |
| Canopy grid | 64² | 96² | 128² | 192² | 256² | 256² |
| Emergent trees | 16 | 24 | 36 | 48 | 64 | 80 |
| Root strands per side / leaves | 3 / 96 | 4 / 160 | 6 / 256 | 8 / 384 | 10 / 512 | 12 / 640 |
| Drops | 300 | 600 | 1,200 | 2,400 | 4,000 | 6,000 |
| Swiftlets | 24 | 32 | 64 | 96 | 128 | 160 |
| Detail octaves (shell and canopy) | 2 | 2 | 3 | 4 | 5 | 5 |
| Steam columns / far shower | 0 / off | 2 / off | 3 / off | 4 / on | 6 / on | 6 / on |
| Bloom | off | off | 0.33 res | 0.45 | 0.5 | 0.5 |
| MSAA | — | — | — | 4× | 4× | 4× |
| **Estimated GPU frame time** | about 2.5 ms (2021 phone, portrait) | about 4 ms (phone) | about 5–6 ms (laptop iGPU, 1080p) | about 6–7 ms (iGPU 1080p) | about 4 ms (discrete GPU, 1440p) | about 5 ms (discrete GPU, 1440p) |

**High-tier split (iGPU, 1080p, estimated):** sunfall march 1.5 ms · post (bloom and output) 1.0 ms · mist
1.0 ms · canopy 0.7 ms · cave 0.5 ms · particles 0.4 ms · trees and understory 0.3 ms · gours 0.2 ms · roots
0.1 ms. (The rendering lead called the beam figure optimistic. ADR-0016: no perf claim without a verified
instrument; treat every number here as a target to measure.)

**What Minimal and Low drop:**
- the beam march (the streaked, crisp closed-form beam is kept);
- MSAA and bloom;
- half the mist sheets;
- steam columns and the far shower;
- the secondary bow in mist (the per-drop secondary is kept);
- the fine canopy and shell octaves (the term is removed in JavaScript, not replaced with a constant);
- swiftlet flap detail.

**Every tier keeps the whole picture and every event** (house rule).

**Phone strategy:**
- The portrait composition removes the far passage and far doline. Their instance counts and visibility are
  set by the composition, because the house sets `frustumCulled = false`.
- The beam hull is shorter on screen. Calm zones cover the column behind the card.
- The tier defaults by device class follow the house. Low or Minimal on phones keeps one opaque pass, bounded
  by the canopy grid, plus 2–3 mist sheets, the closed-form beam and at most 600 drops.

#### WebGL2-backend risks and their guards (as proposed)

- **Nested `select` with `Fn` calls (#89):** the `lit` builders fold their conditions into one `select`,
  with values built as `.toVar()` first.
- **Texture reads inside the march loop:** always `.level(n)`. A loop of constant length per tier is unrolled
  in JavaScript, with no `Loop` over a uniform. **[amended: §3.16, a TSL `Loop` instead; JS unrolling
  re-emits `dlSunlit` at every step]**
- **Uniform limits:** one `vec4` event table of 64 rows or fewer. Slot data for leaves and birds lives in
  interleaved instance buffers, keeping 8 or fewer vertex buffers (#99, WebGPU) and 12 or fewer uniform
  buffers (#102).
- **Half-float mips:** built on the CPU. There are no half-float render targets of our own; bloom falls back
  exactly as the house does.
- **`exp()` of signed distances (#71):** bounded with `exp(max(d, 0)·−k)` everywhere. Captured on portrait.
- **NaN from `pow` (#94):** Schlick and GGX written as products; every cosine clamped.
- **Precision:** the world spans about 1.2 km in fp32, which is fine. Phases are wrapped before upload.
- **Shader size (#81):** every multi-call helper is laid out and pure (`dlHash21`, `dlHG`, `dlBow`,
  `dlThinFilm`, `dlRoundSdf`, `dlBeamChord`). There are about 12 materials and about 12 pipelines, well under
  the Sakura failure mode (#96).

#### Module split (as proposed; §5.2 has the amended list)

```
src/themes/sunfall/
  sunfall-core.js         three-free: chamber/oculus dims, sun stations, weathers, palettes, event timings,
                          CPU mirrors of dlSunlit/dlBow (tests + aiming), mulberry32, smooth, approach
  sunfall-plan.js         seeded layout: crown sites, emergent trees, strand anchors, gours, nests, far doline
  sunfall-tsl.js          createSunfallUniforms (one bag u, one vec4 event table), laid-out hashes,
                          CPU bakes → fbmTex (half-float, CPU mips), oculusTex (RGBA8: rim SDF, vine fringe,
                          gap ranks, surface silhouette; CPU mips), canopyTex, latticeTex (2D-lattice noise3),
                          builders dlSunlit / dlMist / dlHaze, Fns dlHG / dlBow / dlThinFilm / dlBeamChord
  sunfall-sky.js  sunfall-cave.js  sunfall-jungle.js  sunfall-beam.js  sunfall-mist.js
  sunfall-water.js  sunfall-roots.js  sunfall-birds.js  sunfall-gours.js
  sunfall-world.js        SunfallWorld: parts, camera rig, choreography, slots, seek/replay (theme + playground)
  sunfall-director.js     clone of ocean-director (+ shape/cells from serenity-warp), ComboTracker true combo
  sunfall-composition.js  clone + '#online-main-board canvas'; adds strandAnchors(), beamAnchor(), portrait rig
  sunfall-post.js         SunfallPost + POST_LOOK per tier + createPassThroughPipeline
  sunfall-quality.js      QUALITY Minimal..Extreme, tierFor()
  sunfall-theme.js        BaseTheme adapter (clone), flags sunfallTime/FixedDt/Parts/FalseColor/ForceWebGL
  sunfall-tetrominos.js   palette above
  sunfall-theme-icon.png  oculus → white-gold column → glowing canopy, rainbow fragment at its foot, one swiftlet
                          [amended: §3.2, the icon has no rainbow and no swiftlet]
src/playground/effects/sunfall.effect.js
  standard params (event=lock|drop|clear|quad|tspin|perfect|levelUp, lines, row, u, combo, level, locks,
  parts, quality, board, icon, px, py, bloom, noPost, falseColor, reduce, statsHud, demo) + weather=, station=
tests/unit/sunfall-{core,director,composition,world,theme}.test.js
```

The tests (as proposed) pin: the `dlBow` angles; the CPU mirror of `dlSunlit` against the shader maths; the
palette gate at 0/7; `SUNFALL_PARTS` matching the URL catalogue; every tier building its graphs without a GPU.

**Playground-first order (as proposed):** sky, cave and beam (the frame), then mist, then canopy, then water
and rainbow, then roots, birds and gours, then events. One effect per session (TDR rule), with a screenshot at
High, Low and portrait plus the `forceWebGL` leg before porting. **[amended: §5.6, an opaque-first order and
a CPU lab first]**

### 1.8 Why it will be breathtaking, and why it resembles nothing in the fleet (as proposed)

#### Why it will be breathtaking

- **A single overwhelming light.** A solid column of white-gold daylight standing in a green stone cathedral,
  combed into streaks by vines, gives the clearest, most painterly light in the game. **[amended: §4.2, keep
  the word "cathedral" out of Sunfall's copy and code; Rainbark's logline uses it]**
- **Weather indoors.** A cloud deck under a stone ceiling with a burning hole where the sun passes through it
  is a picture nobody has seen in a game theme. It is also true of Son Doong.
- **Rainbows inside a cave.** Rain glittering only where the light touches it, then splitting into a double
  bow, makes the most satisfying clear in the fleet, and it emerges from physics, one coloured drop at a time.
  **[amended: §3.4]**
- **Two worlds in one frame.** The near doline and the far doline 1 km away give extreme, legible depth (dark
  root strands, blazing jungle, mid-value vault, blue passage, distant window of day).
- **Living colour that grows.** Young-leaf flushes in seven colours, iridescent blue spikemoss in the shade,
  and a whole forest flushing on a perfect clear: colour that belongs to biology and light, never neon.
- **A grammar you understand at a glance:** leaves grow where your piece landed; rain falls when you clear;
  shafts multiply as your chain grows; the cave breathes out when it breaks; the doline floods on four lines;
  the light walks when you level.

#### The three closest existing themes and the precise differences

1. **crystal-cave ("the resonant hall")** is a dark, timeless underground hall seen *down its length*: a black
   mirror pool runs down the middle; neon gemstone prisms supply the light; its skylight shaft is a thin pale
   accent upper-left; glow-worms and stalactite chandeliers hang overhead. **Sunfall** differs on each point:
   daylight is the only light, and it is the hero (20 % of the frame); no crystals, pool, glow-worms or
   stalactites; the camera looks *across and down* into a 200 m void with a jungle floor and weather; the
   palette is emerald, white-gold and limestone instead of neon jewel tones; events are weather and growth
   instead of "crystals ring and sprout".
2. **cinder-drift (magma chamber)** is an underground chamber in a heat-spectrum palette: a lava floor of
   glowing crust plates; a lavafall on the left; a *cold blue night* shaft through a roof hole on the right;
   fire fountains on clears. **Sunfall's** light is warm *daytime* sun from above. Its floor is a living
   canopy, not lava. Its "fall" is of light and, on four lines, white water with a rainbow. Its mood is airy
   and humid where cinder-drift's is infernal, and it has no embers, no basalt and no glowing seams.
3. **bioluminescence ("the living grotto")** is a dark flooded grotto: emissive teal and lime mushrooms;
   jellyfish of light and glow-worms; a mirror pool; "light stored then released". **In Sunfall nothing emits
   light.** Every colour is sunlight transmitted, scattered or split. There is no pool, and the colour comes
   from leaf biology and optics rather than glow. The grammar never stores light.

**Also checked:**
- *verdant-hills*: its green is a pastoral open-air midday. Sunfall's green is chiaroscuro inside stone, with
  no cumulus-sky vista, kites or meadow.
- *fall* and *forest*: they use shafts through a canopy *from above*. Sunfall's shaft comes through rock into a
  canopy *below the viewer*, and nothing is thrown from the card.
- *ocean*: sun shafts underwater. Sunfall has no water volume, caustics or fish.
- *nimbus-veil* and *sky-children*: a sea of clouds seen from above. Sunfall's clouds sit *under a ceiling*,
  seen from the side.
- *parhelion*: ice-halo optics. A rainbow in spray is different optics, and it never forms a ring across the
  sky.

#### Fleet clichés avoided (checklist, as proposed)

None of the following appear: moon, aurora, snow or ice, horizon sun disc, mirror water, tree frames at the
screen edges, hero peak, lanterns, ribbons, floating crystals, meteors, motes as the main particle, a vortex
round the board, the spark-to-site-that-holds-the-colour grammar, blades of light at cleared rows, a wave front
per line, a hush before four lines, a T-spin spiral, an hour or palette wheel, a camera dip.

### 1.9 Top risks and mitigations (as proposed)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **"Another cave with a light shaft"** (crystal-cave and cinder-drift). | Commit to high key: luminous mist, the green-gold glow on the vault, the cloud deck and the canopy pool are all visible *at rest*, before any event. The icon shows oculus, column, jungle and a rainbow fragment, never a dark tunnel. Judge the rest frame in false colour: the mean frame luminance must sit well above the fleet's dark-cave themes. **[amended: §3.2, measured targets; no rainbow in the icon]** |
| 2 | **Volumetric cost on phones.** | The closed-form beam on Minimal and Low (2–3 fetches, streaks kept). March steps by tier. The hull's screen area is capped by composition. Mist sheets 2–8. No render targets of our own. Drops outside the light are culled in the vertex stage. Measure in the playground with `profile=1`, starting with the Low portrait capture. |
| 3 | **Board readability with a bright column.** | On landscape the column is composed into the left free space, with its lean clamped. On portrait it passes behind the card and is soft-clipped by the calm zone. The beam's HDR peak behind any calm rect is kept under the clip knee. Showers and bows happen at the beam's foot, outside the card. |
| 4 | **The rainbow is not in frame for some sun geometry.** A bow is a 42° cone round the antisolar point; with a near-vertical sun it falls out of view. | From the rest camera (foot about 13° below eye level), the bow-capable stations put the sun behind-left at 46–55°, where the bow crosses the column at its foot. Checked by hand: with the sun at 50° and a 20° azimuth offset, the foot sits about 40° from the antisolar point, so the bow crosses the column just above the foot; at 55° it sits about 44.5° away, so the bow lands in the spray just below the foot. Long Column (64°) and Lean (58°) rely on `bowSun`: `dlBow` reads this uniform, which eases toward an art-directed direction placing the bow centre at the composed foot whenever true geometry would miss it. Zenith (vertical sun) never needs a bow. **[amended: §3.4, gap G2: the hand check holds only for a different sun azimuth]** |
| 5 | **Green monotony and mud** (and verdant-hills overlap). | Strong value structure: blue-grey-green shade (`#142A24`, `#5D8087`) against white-gold light. Flush crimson, bronze and peacock-blue accents. Four weathers and six stations recombine the look. Grade the shadows teal and the highlights warm, never olive. **[amended: §3.15]** |
| 6 | **Rain reads as "rainy window" noise.** | Drops exist visually *only inside the light*, as glitter, never as grey streaks. Showers are short and event-bound. Every veil pays off in colour (the bow). **[amended: §3.5, the payoff is New Growth, not a bow]** |
| 7 | **Photosensitivity** on the cataract and Zenith (big white areas) and on the T-spin hue wave. | Rise of at least 0.35 s, `max()` not sum, at most 3 lifts per second, HDR clamped before bloom, the iris dips during the cataract, glints randomised. The T-spin wave holds luminance and runs once per line. The Phaser board's own four-line flash stacks on top, so the theme's lift stays at 0.25 or less. |
| 8 | **Lock visibility on portrait** (strands in narrow margins). | Strand-tip fallback above the card's top edge at the piece column. On landscape the strands sit outside the card and HUD union, chosen from live rects (cards and HUD read at +0, +0.5 and +1.5 s, per the house). |
| 9 | **Transparency layering** (hull, sheets, rain, birds, leaves). | A fixed `renderOrder` band per family. Everything additive is premultiplied `vec4(rgb, 0)` and everything occluding is "over". Mist contact is softened analytically from height functions (no depth read). The beam hull is depth-tested so near strands occlude it. |
| 10 | **Busy screen in heavy play** (showers, shafts, birds, leaves at once). | Director priority: perfect > four lines > T-spin > clear > hard drop > lock. One shower veil at a time (later clears extend and intensify it). Bird bursts rate-limited. The leaf ring buffer is capped per side. The combo dial is a smooth scalar, so it never stacks objects. |
| 11 | **Integration surface** (rewritten generically). The replaced theme may be used by an Odyssey level or chapter pool, and by tests as an exemplar. | Add a `RETIRED_THEME_IDS` alias `OLD_ID → sunfall` (murmuration and Rainbark precedent), keep `V2_LEVEL_THEME_IDS` frozen, and rewrite any test that used the old theme as its exemplar to use a remaining theme. Worked example: commit `585ab55` (Cosmic Chimes → Rainbark) retitled Odyssey level 47 ("Singularity Gate" → "The Painted Giants", `transitionIn: 'crossfade'`, new description and tip), swapped the id in place in the chapter 6 pool (`src/core/odyssey/data/chapters.js`), deleted `tests/unit/mobile-wrapper-policy.test.js` (its two DOM-quality tests existed only for Cosmic Chimes' DOM container) and repointed `tests/unit/mobile-webgl2-validation.test.js` to a remaining theme. PLAYBOOK §4.4 lists the tests to update, delete and add. |

### 1.10 Sources (web lookups made for the proposal)

- [Discover Wildlife: Hang Son Doong cave](https://www.discoverwildlife.com/environment/hang-son-doong-cave)
- [Oxalis: Doline 2, the Garden of Edam](https://oxalisadventure.com/the-garden-of-edam-inside-son-doong-cave/)
- [Oxalis: geology and geomorphology of Son Doong](https://oxalisadventure.com/geology-and-geomorphology-son-doong-cave/)
- [Oxalis: the Great Wall of Vietnam](https://oxalisadventure.com/great-wall-of-vietnam/)
- [Lonely Planet: Hang Son Doong](https://www.lonelyplanet.com/vietnam/north-central-vietnam/phong-nha-cave/attractions/hang-son-doong/a/poi-sig/1529542/357910)
- [National Geographic: Vietnam cave](https://www.nationalgeographic.com/magazine/article/vietnam-cave) (the research survey cited the 2011-01 issue URL, `nationalgeographic.com/magazine/2011/01/vietnam-cave`)
- [Google Arts & Culture: Son Doong, the world's largest cave](https://artsandculture.google.com/story/son-doong-the-world-s-largest-cave-quang-binh-tourism-department/JQUxotl1KwFsJQ?hl=en)
- [Fstoppers: Son Doong Doline 2 waterfall after rain](https://fstoppers.com/entry/506163)
- [HuffPost UK: rainbow shining into a giant cave (Stephen's Gap fog)](https://huffingtonpost.co.uk/amp/entry/cave-rainbow-pictures_n_1851325)
- [Wikipedia: Selaginella willdenowii](https://en.wikipedia.org/wiki/Selaginella_willdenowii)
- [PMC: blue iridescence in shade-plant leaves](https://pmc.ncbi.nlm.nih.gov/articles/PMC2988267)
- [FIU: ultrastructural basis of blue iridescence in Selaginella](https://digitalcommons.fiu.edu/cas_bio/16)
- [Wikipedia: Leaf flushing](https://en.wikipedia.org/wiki/Leaf_flushing)
- [PMC: why so many tropical species flush young leaves red](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7041174/)
- [Jungle Boss: Son Doong cave animals](https://junglebosstours.com/explorer/tourism-blog/son-doong-cave-animals)
- [Oxalis: life at Son Doong cave](https://oxalisadventure.com/life-at-son-doong-cave/)
- (Research survey) [SilverKris: Son Doong](https://silverkris.singaporeair.com/inspiration/nature-adventure/sightseeing/danang-son-doong)

---

## 2. What the judges said

Three judges scored all six concepts, each through one lens, 0–10. Quotes are verbatim or close paraphrase;
every number is theirs. The decision record (why Rainbark won, what it grafted) is in
`docs/theme-concepts/rainbark.md`.

### 2.1 Art director: 6.5 (5th of 6)

**Lens.** Beauty, originality against the 61-theme catalogue (setting, palette, composition, motifs and FX
grammar), wow factor, the potential for depth, atmosphere and lighting, how the theme reads as a still and in
motion, surprise, and the name. "I was strict about resemblance."

**Strengths.**
- **"The biggest single wow image":** a solid white-gold column of daylight in a green stone chamber, combed
  into streaks by the rim's vines.
- **A cloud deck under a stone ceiling,** with a burning hole where the beam passes through. "That picture is
  unique."
- **The vault is lit green-gold from below** by the sunlit jungle.
- **The near and far dolines form a diptych** with extreme, legible depth.
- **Good event beats:**
  - the combo is counted in shafts that open in a fixed order;
  - breaking a chain exhales one cloud up and out through the oculus;
  - level up walks the light across the jungle like a sundial;
  - rain glitters only where the light touches it.
- **"The best name in the slate."**

**Weaknesses.**
- **The core image is on three avoid lists:** crystal-cave ("caves and stalactites; light shafts through a
  vault"); cinder-drift ("underground chamber, roof light shaft"); bioluminescence ("caves and grottos").
- **Its hero device, the volumetric shaft, is the fleet's most reused light.** Forest, fall, golden-forest,
  ocean, crystal-cave, cinder-drift and nimbus-veil all use one. "The user would say 'another cave with a
  beam' before noticing the jungle."
- **More overlaps:** the third rainbow, swiftlet flocks (bird flocks are common in the fleet), the T-spin
  leaf-turn as "one wave per line" (item 5 of the house FX grammar, listed in `docs/theme-concepts/README.md`
  "The house gameplay-FX grammar"), and lock leaves that hold the piece colour and green over 18 s.
- **Green monotony is a real risk.**

**Worth grafting (the judge's list for Sunfall).**
- The `dlSunlit` oculus mask: one fetch gives exact soft shadows, a gobo and a beam cross-section.
- Combo links counted as shafts opening in a fixed order.
- The exhale on chain break.
- Drops that exist visually only inside the light.
- An emergent per-drop bow, if a bow is used at all.
- Delayed greening (red young-leaf flush) as a colour language.
- A swiftlet startle on hard drop.
- A far-world echo for back-to-back.
- **The name "Sunfall"** is worth keeping even if the concept is not chosen.

**Findings across the slate that bear on Sunfall** (the art judge's cross-cutting section):
1. **"The rainbow has become the slate's own cliché."** Three concepts make a physically placed bow a headline
   payoff: Iris Springs (four lines and back-to-back), Painted Ages (chain release) and **Sunfall (every clear
   plus four lines)**. The fleet already has rainbow motifs in tornado, chromadelic-highway and singing-bowl.
   "Whichever concept wins should use the bow at most once, as a grace note, never as the signature."
2. **"Almost every lock is still a softened version of the house 'the world holds the colour'."** Something in
   the piece's colour appears beside the card at the piece's height, then fades over 18–90 s: "Iris blooms,
   Painted Ages fans, Riverbloom blushes, Sunfall leaves, Rainbark bands." Only Haft Rang breaks the pattern
   for real (its Sun Rug is a live image of the board, so a colour lasts exactly as long as its piece is on
   the board).
3. **Composition template.** Every concept puts a hero on the left and a secondary on the right, the template
   the catalogue asks us to break. Haft Rang does the most with it (cause on the right, effect on the left).
4. **Lighting slot.** Golden hour is the fleet's most overused light (halcyon, himalayan, sunset, summer, fall,
   tornado, golden-forest, waves, shifting-sands, nimbus, sky-children). High sun or morning daylight is the
   open slot.

**Verdict line on Sunfall:** "Sunfall's name and its exhale and shaft-count beats are worth grafting, but its
cave-and-beam core is already in the fleet twice." And for whatever wins: use the rainbow no more than once;
keep the decay world-native ("bleach, green, ripen"), never "held then released"; source a clear's colours from
the real cells of the cleared row.

### 2.2 Rendering lead: 5.5 (5th of 6)

**Lens.** Can it be built in three r186 TSL so it looks right on WebGPU and on the WebGL2 backend? Cost on
phones and iGPUs? Procedural without models? How cheap does it look if it falls short? Compile and pipeline
cost? Does the board stay readable? "Look-per-millisecond is the main thing I reward. I penalise concepts whose
beauty depends on volumetrics, refraction passes or extra render targets."

One-line verdict: "The best single trick on the table (the projected-oculus sunlit mask). But the picture *is*
a marched light column, mist sheets and a procedural cave and canopy. That is exactly the dependency the lens
penalises."

**Strengths.**
- **"`dlSunlit` is the best single technique in the six concepts."** Walk P toward the sun to the ceiling plane
  and take one fetch of a CPU-mipped oculus mask. The LOD comes from the sun's 0.53° disc, which gives
  physically sized soft shadows and the vine gobo on everything: rock, mist, drops and birds. The B channel
  holds the ranked gaps the combo opens.
- **Drops outside the light collapse to zero size in the vertex stage,** so rain costs nothing where it is
  invisible.
- **Per-drop `dlBow` plus the same `dlBow` on the mist sheets** keeps the bow continuous.
- **A closed-form chord beam on Minimal and Low** keeps the streaks.

**Weaknesses.**
- **The picture is volumetric.** A marched hull, 10–32 steps over up to 30 % of the frame in the scene pass;
  2–8 mist sheets, near spray sheets, and luminous in-scatter haze. "Take the light column and mist away and
  little is left. The High estimate (beam 1.5 ms) is optimistic."
- **The planned 10–32-step march is JS-unrolled,** with the inline texture builder (`dlSunlit`) re-emitted at
  every step, which bloats the WGSL (gotchas #81, #101). "It must be a TSL `Loop` with `.level()` reads."
- **The procedural cave shell, stalagmite and flowstone wall** are "the classic 'noise blob' failure without
  models". "The canopy seen from 90 m as a displaced Voronoi grid risks reading as green bubble wrap."
- **On portrait the brightest HDR object passes behind the card.** "The calm zone has to fight it."

**Where Sunfall sits in the judge's graft ranking** (graftable ideas ranked by value to the winner):
1. **Sunfall `dlSunlit`:** a projected-occluder mask with mip-LOD penumbra. "Adopt Sunfall's formulation (the
   LOD from the sun's disc) and its *ranked gap channel*: Rainbark's combo could open more canopy gaps in a
   fixed order, so the chain is counted in sunflecks." (Rainbark did this; §4.1.)
2. **Sunfall vertex-stage culling of unlit drops plus per-drop bow:** "drips and flakes in Rainbark only glint
   inside flecks." (Rainbark did the culling, not the bow.)
- Item 8 of the same ranking (from Painted Ages): "Analytic bow plus slab in-scatter: use it if any winner shows
  a bow, rather than particle-only bows." This applies to Sunfall's one remaining bow (§3.4). The same judge, on
  Iris Springs: "At that density [2,400 spray particles] a bow looks speckled, not banded."

**Verdict line:** "Sunfall's and Haft Rang's beauty is volumetric and architectural, which is exactly what this
lens penalises. Their best tricks (`dlSunlit`, `castLight`, the Sun Rug) should be grafted, not built as whole
themes."

### 2.3 Gameplay-feel designer: 7.2 (5th of 6)

**Lens.** How spectacular, colourful, satisfying and world-native each event is; readability at 1–3 locks per
second; whether combos escalate and release clearly; novelty against the house FX grammar; clean mapping to
board positions; photosensitivity; how the theme feels after 20 minutes. Frequency weighting: a 20-minute
session has roughly 600–900 locks, 150–250 clears, 10–40 four-line clears, a few T-spins and almost no perfect
clears. "Lock and clear set the feel of the session. Four lines and perfect clears are the moments players
remember."

One line: "Combo counted in shafts of light is excellent, and the lock leaves are good. A rainbow on every clear
wears thin. Bird bursts on every hard drop tire. B2B and T-spin are weak."

**Per beat.**
- **Lock (Flush).** Four leaves, one per cell, snap open on the root strand beside the card at the piece's row
  height, in the piece's colour, and green over about 18 s. "Good, tactile, living."
- **Hard drop (Startle).** 8–24 swiftlets burst from the wall beside the card on every hard drop. "Many players
  hard-drop nearly every piece, so a 20-minute session becomes constant flock explosions in peripheral vision.
  The 0.25 s rate limit does not solve it."
- **Clear (Shower).** Rain falls through the beam and a bow forms. "It scales beautifully with lines: 1 line a
  fragment, 2 a primary bow, 3 a double bow with Alexander's band." But:
  - it plays in the beam far to the left, not at the cleared rows (only a leaf shake ties it to the rows);
  - at 150+ clears a session, the rainbow becomes wallpaper;
  - four lines then has no bow of its own, since three lines already earns the double bow.
- **Combo (Inhale).** One new shaft of light per link, up to seven, then the gathered cloud is exhaled out
  through the oculus on release. **"The most countable combo gauge in the set."**
- **Weak beats:**
  - B2B: "a 1 km-away window brightening, tiny on screen";
  - T-spin: "hue waves, one per line, which is the house 'wave front per line' in letter, and a weak spin
    metaphor".
- **Perfect clear (Zenith Flush)** "is strong".

**Ideas the judge offered the winner "from doline"** (useful to Sunfall itself as a checklist of what worked):
- A discrete per-link counter: one new shaft, splash or column per link.
- Clear line count picks the optic tier: a fragment, then a primary bow, then a double bow. (Superseded for
  Sunfall by the one-bow rule, §3.4.)
- One leaf per cell on lock.
- Water visible only where the light is.

**Engineering note for every concept.** All six put a reward on the combo release, and the house `ComboTracker`
reports a break one lock late. PIECE_LOCK and wave 1's LINE_CLEAR are emitted in the same synchronous tick, so
the director can infer at `flush()` that a lock with no clear in the frame breaks the chain, and deliver
`combo(0)` on the breaking lock itself.

**Ideas from the other concepts that the judge recommended across the slate** (and that §3 uses here): a
persistent T-spin record (Riverbloom's kettle); T-spin as one rotational click of every pattern at once (Haft
Rang's lattice); the lock spanning the piece's rows (Rainbark's peel band); real cell colours via the shadow well
(Painted Ages); a saturation lift instead of exposure flashes (Iris Springs); native anticipation instead of a
hush (Rainbark's creak).

### 2.4 Why it did not win

Sunfall placed 5th on every lens and 6th overall (19.2/30). The art judge saw its core as "already in the
fleet twice" (cave plus beam) and its rainbow as the slate's cliché; the rendering lead penalised a picture that
"*is* a marched light column, mist sheets and a procedural cave and canopy"; the play judge found its two most
frequent secondary beats (bird bursts on hard drop, a bow on every clear) tiring and its B2B and T-spin weak.
All three praised the same things: the hero image, the cloud deck with its burning hole, the green-gold vault,
`dlSunlit`, the shaft-counted combo, the exhale and the name. Rainbark took four of Sunfall's ideas (§4.1).

§3 fixes every named weakness. It cannot remove the cave from a doline; it can make the doline read as daylight,
weather and jungle first, which is what the measured frame budget in §3.2 enforces.

---

## 3. Required changes before building

**This section overrides §1.** Every weakness a judge named has a fix below, plus the cross-cutting findings
and the gaps found while writing this document (numbers for the gaps were computed for this file). §5 is already
written against these fixes. Values marked *starting value* are design proposals to tune in the playground,
not measurements.

### 3.1 Every named weakness, and its fix

| Judge | Weakness | Fix (details in the subsection named) |
|---|---|---|
| Art | The core image is on three avoid lists (crystal-cave, cinder-drift, bioluminescence) | **Doline, not cave** (§3.2): a measured frame budget at rest (open sky ≥ 5 %, canopy ≥ 25 %, lit mist and deck ≥ 15 %, rock ≤ 45 %, rock darker than L\* 20 ≤ 3 %; tone-mapped mean L\* ≥ 50 and at least 15 above the brightest of the three cave themes' reference snapshots). No stalactites; the 80 m stalagmite demoted to a 21:9-only haze silhouette; the vault always lit from below. Thumbnail test at 80 px: "daylight jungle" must be read before "cave". The icon shows canopy, deck hole and column: no rainbow, no bird, no dark tunnel. |
| Art | The volumetric shaft is the fleet's most reused light (forest, fall, golden-forest, ocean, crystal-cave, cinder-drift, nimbus-veil) | **A pillar, not rays** (§3.3): a crisp-edged solid body with both ends visible (the gold-rimmed hole in the deck, the elliptical pool on the canopy); a lengthwise streak comb at ≤ 25 % modulation, never radial; **no screen-space shafts** (the proposal's veiling-glare drag toward the oculus is removed) and no `GodraysNode`; no other shaft in the rest frame except the far doline's thin one; the bounce (vault and deck underside) is the second light at rest. Accepted side by side with the forest, fall, ocean, crystal-cave and cinder-drift references. |
| Art | The third rainbow in the slate | **The bow appears once** (§3.4): only on four lines, in the cataract's spray, a full double bow with Alexander's dark band. Nowhere else: no bow on clears, combos, back-to-back, the perfect clear, drips, meditation, weather or the icon; no fogbow. |
| Art | Swiftlet flocks (bird flocks are common in the fleet) | **Swiftlets demoted** (§3.8): pairs and trios as scale specks only, 6–24 instances by tier (was 24–160); no burst on hard drop; four lines scatters 6–12 from the near walls. |
| Art | The T-spin leaf-turn is "one wave per line" (house pattern) | **The Turning** (§3.9): the vine fringe turns one 15° notch per line about the column axis, so the streak comb and the light on the canopy turn with it; the turn persists for the session. No travelling front. |
| Art | Lock leaves hold the piece colour and green over 18 s (a softened "the world holds the colour") | **Pigment that matures** (§3.6): the leaves never glow; their colour ends by the world's own delayed greening (a decay the judge lists as world-native: "bleach, green, ripen"), time-normalised so it is seen at 1–3 locks/s; a clear matures the leaves at the cleared rows at once. Nothing is ever released to another site. |
| Art | Green monotony | **A measured colour budget** (§3.15): green hues (70–170°, C\* > 15) ≤ 45 % of the non-card frame; near-neutrals (stone, cream, pearl mist) ≥ 30 %; warm light ≥ 6 %; five crown greens plus about 6 % of crowns in a muted natural flush at rest; teal shadows, never olive. |
| Tech | The picture is volumetric; the High beam estimate (1.5 ms) is optimistic | **The closed-form beam is the base on every tier** (§3.3, §3.16): Simpson's rule over the analytic chord (3 mask fetches, 1 noise fetch) with an analytic density profile. The march (Medium and up) only adds mist patchiness, with 6/8/12/16 steps (was 10/16/24/32). Hull capped at 22 % of the frame (was 30 %). **Opaque-first acceptance:** with `parts=sky,cave,jungle,gours` the frame must already read as a sunlit doline. Budget targets in §3.16. |
| Tech | The JS-unrolled march re-emits the `dlSunlit` builder at every step (#81, #101) | **A TSL `Loop`** with a constant per-tier end, every read `.level()`, `dlSunlit` emitted once in the body (§3.16). Gated by the shader-size test (< 48 KB per stage). |
| Tech | Procedural cave shell, stalagmite and flowstone wall: the "noise blob" failure; the canopy as a displaced Voronoi grid reads as "green bubble wrap" | **CPU lab first** (Stage A0, §5.12): a canopy of clumped crowns (power-law sizes, sub-clumps, dark gaps, emergents), never Voronoi domes; a vault built from geology (bedding steps, breakdown blocks, a broken oculus rim) with designer-controlled cross-sections, not more noise; flowstone as vertically draped ribbed curtains (anisotropy ≥ 6:1). Accepted against reference photos before any shader. |
| Tech | On portrait the brightest HDR object passes behind the card | **Calm inside the beam material** (§3.3): the beam multiplies itself by `1 − 0.85·calmMask(screenUV)` before the post, capping its display value behind the card at 0.5; the density profile puts the column's brightest parts at the deck crossing (top band) and the foot (bottom band). |
| Play | A rainbow on every clear wears thin; four lines then has no bow of its own | §3.4 (the bow is four lines only) and **a new clear** (§3.5): Shower (colourless glitter in the light) + **Ripening at the rows** + **New Growth in the row's own colours**. |
| Play | Bird bursts on every hard drop tire | **The Snap** (§3.7): the hard drop is a stronger version of the lock on the same strand (kick ±0.4 m, faster unfurl, 12–20 drops). At most one swiftlet may flit out, at most once per 8 s. |
| Play | The clear plays far left; only a leaf shake ties it to the rows | **Ripening at the rows** (§3.5): at each cleared row's height on both root curtains, the leaves shiver, shed a bead curtain into the outer lanes and mature to emerald in 1.2 s, so the colour leaves exactly the rows you cleared. |
| Play | Back-to-back is "a 1 km-away window brightening, tiny on screen" | **Flood threads** (§3.10): while the chain lives, 1–3 waterfall threads (one per B2B level) fall the full 200 m from the oculus rim through the sunfall; the far doline's Echo stays as the grace note on each B2B event. Threads are removed from the Monsoon Veil weather so they always mean B2B. |
| Play | T-spin is a weak spin metaphor | **The Turning** (§3.9): the light itself turns, one notch per line, and stays turned. Count = lines. |
| Play | The combo break reaches the theme one lock late | **Infer the break on the breaking lock** (§3.11). Clone `src/themes/rainbark/rainbark-director.js`, which already does it. |
| Cross-cutting | Rainbow is the slate's cliché | §3.4 (once). |
| Cross-cutting | Decay must be world-native, never "held then released" | Leaves green on the world's clock (§3.6); New Growth bands green too (§3.5); the combo's cloud leaves through the oculus as weather, not as a released light (§3.11). §3.19 checks the wording and the look. |
| Cross-cutting | A clear's colours from the real cells of its row | **Shadow well** (Rainbark director) → each New Growth band carries its row's 10 cell colours, left to right (§3.5). |
| Cross-cutting | Combo break inferred on the breaking lock | §3.11. |
| Cross-cutting | Avoid the house FX grammar listed in `docs/theme-concepts/README.md` | Checked item by item in §3.19. |
| Cross-cutting (art) | Composition template: hero left, secondary right | Kept, with cause and effect: the far doline is the second sun of the same cave; it answers back-to-backs (Echo) and its thin beam is the near column's twin. The cloud deck drifts from the far passage to the near oculus, joining the two halves. |
| Cross-cutting (art) | Golden hour is overused; high sun is the open slot | Stations stay at 44–64° sun elevation, no sun disc in frame, no peach or lavender sky. The two warm stations (First Reach `#FFD9A0`, Last Reach `#FFC98A`) are the warmest the theme gets. |
| Gap G1 (this file) | The proposed piece palette collapses under colour-vision deficiency: **O/L ΔE 1.1 under protanopia** (ΔL\* 1.0), T/S 6.5 (protanopia) and 7.1 (deuteranopia) | Adjusted O, T, Z and L hexes; worst pair now ΔE 19.5; gate still 0/7 (§3.17). |
| Gap G2 (this file) | The proposal's hand check of the bow geometry holds only if the antisolar point sits about 20° in azimuth from the **foot's** direction. With the sun "behind the left shoulder" as written (antisolar point 20° right of the view centre), the foot is **50.7–55.0°** from the antisolar point at 46–55° sun elevation: secondary-bow territory, never the primary (40.6–42.4°) | The one bow always uses an art-directed `bowSun` solved from the composition (`solveBowSun`, §3.4), pinned by a unit test for every layout preset. |
| Gap G3 (this file) | The `lod` formula uses the vertical height to the ceiling, not the distance along the sun ray, so it underestimates the penumbra by 1/sin(elevation) (×1.31 at 50°) | `d = (H_oculus − p.y)/S.y`; `lod = clamp(log2(0.0093·d/texelMetres), 0, maxMip)`, the formulation Rainbark's `rbFleck` uses (§3.16). |
| Gap G4 (this file) | `dlBow` "reads `bowSun`" but is listed as a laid-out helper; laid-out helpers must not capture uniforms (#95) | `dlBow(cosθ)` takes the cosine to the antisolar direction as a parameter; the caller computes it from `u.bowSun` (§3.4). |
| Gap G5 (this file) | Level n → station (n−1) mod 6 makes level 1 First Reach ("the jungle is shaded except a lit rim"): the first frame a player sees is the dimmest station; and a clock step can land right after a level-up (double step) | Level 1 starts at **High Fall**; the 150 s clock-step timer resets on every level up (§3.14). |
| Gap G6 (this file) | The lock-leaf ring is small: the §1.7 leaf budget (96–640 leaves for both curtains, 4 per lock) holds only about 12–80 locks per side by tier, and the proposal's ring (48 locks per side) still turns over in 30–100 s at 1–3 locks/s split over two sides, so a leaf can be reused before 18 s of greening has shown | Greening τ is time-normalised to slot pressure (§3.6). |
| Gap G7 (this file) | Near-strand drops (lock, Snap, clear bead curtains) sit in shade, so "drops outside the light collapse to zero" would hide them | Near beads (within 40 m of the camera) use a separate look: short, small, sky-lit, alpha ≤ 0.35. Oculus showers keep the strict "only in the light" rule (§3.7). |
| Gap G8 (this file) | The combo's 7+ name "Cathedral" repeats Rainbark's logline ("a cathedral of colossal painted giants") | Renamed **Sevenfold** (§3.11). |
| Gap G9 (this file) | The proposal gives no renderer clear colour, presentation key colour or fallback glyph | Clear colour `0x5D8087` (Chamber Haze, L\* 51); key colour `'#B5E24C'`; glyph `'sprout'` (§5.1). |

### 3.2 Doline, not cave: the frame budget and the cave signifiers

The rest frame must read as **daylight, weather and jungle** first. Measure on the tone-mapped 16:9 rest
shot (`effect=sunfall&t=40&level=1`, §5.6) with the card area excluded. Part shares are measured by diffing
`parts=` captures (for example `parts=sky,cave` against `parts=sky,cave,jungle` counts canopy pixels); a small
PIL script in the session scratchpad is enough.

| Region | Target share of the non-card frame |
|---|---|
| Open sky (through the oculus and the far doline) | ≥ 5 % |
| Canopy (lit pool and shaded forest) | ≥ 25 % |
| Lit mist and cloud deck | ≥ 15 % |
| Rock (vault, walls, flowstone, gours) | ≤ 45 % |
| Rock darker than L\* 20 | ≤ 3 % |
| Mean L\* of the whole tone-mapped frame | ≥ 50 |

Measure the same mean L\* (tone-mapped, card area excluded) on crystal-cave, cinder-drift and
bioluminescence: preferably fresh captures of the current themes made with PLAYBOOK §5's scripts (each has a
playground effect: `effect=crystal-cave`, `effect=cinder-drift`, `effect=bioluminescence`), otherwise their
fleet screenshots `docs/theme-screenshots/<id>.png` (these can be stale). Their written catalogue entries are in
`docs/theme-concepts/reference/catalog.md`. Record the four numbers in the theme's record doc, and require
Sunfall to be at least 15 L\* above the brightest of the three.

**Cave signifier rules.**
- No stalactites, no stalactite chandeliers, no crystals, no pools or mirrors, nothing emissive (as proposed).
- **The 80 m stalagmite is demoted:** absent on 16:9, 4:3 and portrait; on 21:9 only, deep in haze at ≤ 30 %
  contrast against the haze, never silhouetted against the far doline's window. Cut it entirely if the 21:9
  shot still reads "cave".
- **The vault is always lit from below** (the pool bounce) in every rest frame: mean vault L\* ≥ 35 after the
  tone map. A dark ceiling is the crystal-cave and cinder-drift read.
- **The oculus is big enough to be a window, not a chimney:** at least 4 % of the frame shows sky and the
  rim's forest silhouette with drifting cumulus (the top edge crops it).
- Gours stay in the bottom corners, dry, at most 8 % of the frame.
- The flowstone wall stays (warm cream catching bounce reads as a cliff), but at mid value, never brighter
  than the lit canopy.

**First-read test.** Put the 80 px thumbnail of the rest shot next to 80 px thumbnails of the nine themes named
in the "How to use" box (item 3). It must read as "daylight jungle in a sinkhole" before "cave". If it does not, the fixes in order
are: more canopy share (lower the camera pitch by 1–2°), a brighter vault bounce, a larger oculus, then a
smaller rock share on the right (move the passage wall further away).

**The icon** shows the oculus rim with hanging roots at the top, the gold-rimmed hole in the deck, the column,
and the glowing pool with two crimson flushing crowns. **No rainbow** (the bow is one event, and the icon must not
promise it), no swiftlet, no dark tunnel.

### 3.3 A pillar, not rays

The house god-ray look (forest, fall, golden-forest, ocean, nimbus-veil) is soft radial streaks from a light
source, drawn in screen space or with `GodraysNode`. Sunfall's column must read as **a solid body of light
standing in space**, not as rays.

1. **Crisp edges.** The only softening is the sun-disc penumbra from the mask mips: 0.0093·d, about 1–2 m at
   100–200 m on a column about 90 m across. No extra blur.
2. **Both ends visible in every layout.** The top end is the elliptical, gold-rimmed hole in the cloud deck
   (Gilt Underside `#FFD27F`); the bottom end is the elliptical pool on the canopy. On desktop both sit in the
   left free space; on portrait the deck hole sits in the top band and the pool in the bottom band. The
   composition solver enforces it and a composition test pins it.
3. **The streak comb runs lengthwise** (parallel to the column axis) and stays subtle: modulation ≤ 25 % of the
   column's radiance at rest (≤ 35 % in Clear Breath). It drifts with the vine sway. It never fans out radially
   and never converges on a point on screen.
4. **No screen-space shafts.** The proposal's output-pass "veiling glare dragged from the bloom texture toward
   the oculus" is removed. No `GodraysNode`, no rush. Glare comes from bloom only.
5. **No other shafts at rest.** The far doline's beam is at most 1/8 of the near column's screen width.
   Combo shafts (§3.11) are separate columns, each with its own pool, and only while a chain is live.
6. **The bounce is the second light** and must be visible at rest: the vault lit green-gold from below,
   brightest above the pool's projection, and the deck's underside gilded.
7. **Density profile (starting values).** The column is visible because of mist, so shape where the mist is:

   ```
   ρ(y) = u.mistDensity · ( ρ_deck · bump(y; y_deck, 18 m)                 // the cloud deck crossing
                          + ρ_valley · exp(−max(y − y_canopy, 0) / 25 m)    // the valley mist skin (bounded exp, #71)
                          + ρ_air )                                         // humid air everywhere
   ρ_air = 0.25 · ρ_valley
   ```

   so the column is brightest where it cuts the deck and where it meets the canopy, and a steady, moderate
   band between them.
8. **Portrait calm inside the material.** The beam fragment multiplies its output by
   `1 − 0.85 · calmMask(screenUV)`, where `calmMask` is a soft rounded-rect mask from a `vec4` uniform
   `u.cardRect` (the card's screen rect in pixels, top-left origin, written by the world from the composition's
   layout on every `setLayout`; Rainbark's spec plans the same uniform for its curls, rainbark.md §4, and its
   `rbRoundBoxSdf` in `src/themes/rainbark/rainbark-tsl.js` is the rounded-box SDF to clone as `dlRoundSdf`),
   so its display value behind the card stays ≤ 0.5 before the post's own calm clip. The post never has to
   fight it.

Accept with the opaque-first shot (§5.6 A2: the doline must read sunlit without the beam), the beam shots
(A3), and a side-by-side against the forest, fall, ocean, crystal-cave and cinder-drift references.

### 3.4 The bow appears once (four lines only), and it is analytic

**Where.** The full double rainbow (primary, secondary, Alexander's dark band) stands in the cataract's spray
on four lines (§3.12). That is the theme's only bow. Removed from: the clear (all line counts), the combo, the
Echo, the perfect clear, ambient drips, meditation clicks, the Monsoon Veil weather's "rainbow fragments", the
Clear Breath fogbow, and the icon. Drops elsewhere glint white-gold only.

**How (the rendering lead's recommendation for any bow: analytic, not particle-only).**
- A **spray shell**: a soft half-ellipsoid mesh round the cataract's foot (about 120 m wide, 70 m tall,
  starting values), premultiplied "over", with density from `u.noise3` times the spray envelope. Each fragment
  computes `cosθ = dot(V, A)` where `A` is the antisolar unit vector from `u.bowSun`, and adds
  `dlBow(cosθ) · waterContent · lit`.
- Spray drops and spray billboards add glints tinted by the same `dlBow`, so particles and shell agree.
- **`dlBow(cosθ)` is pure** (laid out, no captured uniforms; gotchas #93, #95) and works in cosine space so no
  `acos` is needed. Band edges as cosines: primary 40.6°–42.4° → cos 0.75927–0.73846 (red on the outside, at
  the larger angle); secondary 50°–53.5° → cos 0.64279–0.59482 (reversed: red on the inside); between them
  (Alexander's dark band, cos 0.73846–0.64279) the sky-light term is multiplied by 0.7. Keep every edge pair
  distinct (gotcha #69).
- **`solveBowSun(layout, aspect)`** in core (three-free) returns the antisolar direction that places the
  primary arc through the spray at the composed foot: the angle between the foot direction and `A` is
  41.5° ± 0.5°, with `A` below the horizon and on the far side of the foot from the card. The world eases
  `u.bowSun` toward it during the 0.35 s lead. The visible arc is limited to where the spray is: never a sky
  arc and never a full ring.

**Why the solver is mandatory (gap G2).** Rest camera: foot at azimuth about −26° (22 % across a 82° horizontal
FOV) and elevation about −13° to −15°. If the antisolar point sits 20° in azimuth from the foot, the angle is
37.1° (sun at 46°), 40.5° (50°), 43.9° (54°) and 44.8° (55°): the proposal's hand check. But "the sun behind the
viewer's left shoulder" puts the antisolar point about 20° *right of the view centre*, and then the angle is
50.7°, 52.5°, 54.5° and 55.0° for the same sun elevations (foot at −13°; with the foot at −15° each is about
1.5° smaller, 49.3–53.4°): past the primary bow, at or beyond the secondary. True geometry and the composition
disagree, so the bow is art-directed every time.

**Unit tests** (`sunfall-core.test.js`): `dlBowCpu` band edges and ordering; `solveBowSun` lands within
41.5° ± 0.5° for aspects 0.46, 1.0, 1.33, 1.78 and 2.37 and keeps `A` below the horizon.

### 3.5 Clear, amended: Shower, Ripening at the rows, New Growth

The play judge's three problems (far from the rows, rainbow wallpaper, no bow left for four lines) and the
cross-cutting rule (a clear's colours come from the real cells of its row) are fixed together. The clear keeps
the Shower as its weather and gains two row-exact parts.

| Lines | What you see | Timing |
|---|---|---|
| **×1** | **Shower:** rain sweeps over the oculus and a veil of drops pours down through the sunfall, glittering white-gold only where the light is (no colour). The column thickens slightly while the drops pass (density +10 %). **Ripening at the rows:** on **both** root curtains, the leaves at the cleared row's height shiver, shed a short bead curtain that falls in the outer lanes, and **mature to emerald** (their flush runs to `#2A7F52` in 1.2 s). The colour leaves exactly the row you cleared. **New Growth:** where the veil reaches the canopy, one band of crowns across the pool breaks into young leaves in the **cleared row's own 10 colours**, left to right as the cells sat on the board (shadow well), then greens over τ 18 s. | Veil 1.8 s; ripening 1.2 s; band unfurl 0.8 s starting 0.9 s after the veil starts; wet gloss 6 s |
| **×2** | A fuller veil (density +20 %), two rows ripen, two bands of New Growth | Veil 2.4 s; gloss 8 s |
| **×3** | A heavy downpour, the canopy hissing with glints (density +30 %), three rows ripen, three bands | Veil 3.2 s; gloss 10 s |
| (cascade waves) | An aftershower per wave, smaller and +0.6 s later; each wave's rows ripen and add their bands | +0.6 s per wave |

**Rules.**
- One shower veil at a time; a later clear extends and intensifies it (as proposed).
- **Timing is stylised.** Real drops at about 9 m/s take about 22 s to fall 200 m. The veil is spawned along the
  whole column height at once (drops already in flight, fading in over 0.3 s and out over 0.5 s), so it reaches the
  canopy immediately and New Growth can start 0.9 s in. Ambient drips keep the real fall time.
- **Band placement:** bands are chords across the pool, perpendicular to the camera's view on the canopy,
  stacked from the pool's far edge toward its near edge in slot order; 8 slots (4 on Minimal, 6 on Low; §5.8),
  oldest reused.
  The left-to-right order of the 10 colours matches screen left to right.
- **Row codes** come from the director's shadow well (Rainbark's director: up to 4 rows × 10 cell codes, lowest
  row first). Unknown cells (code 7) become the natural bronze flush `#9C5A3A` (*starting value*).
- New Growth uses saturated piece colours as leaf albedo (pigment, not light): lit by the pool's sun, so it
  blazes where it is in the sunfall and is shaded at the pool's edge, like every other leaf.
- Infinity mode: rows come from `viewportOrigin`; online multiplayer has no cascade count (always 1).

**Why this is not the house grammar.** Nothing fires from the card edge; there is no blade of light at the rows
(the strands' ripening is a colour change of existing leaves, non-emissive); no wave front per line (each band
unfurls in place); nothing is released (the strand colour matures where it is; the canopy colour is new growth
brought by the rain, on the world's own clock).

### 3.6 Lock, amended: the Flush is pigment that matures

Kept from the proposal: four young leaves, one per cell, snapping open from tight buds on the strand just outside
the card on the piece's side (columns 0–4 left, 5–9 right), unfurl 0.45 s with overshoot, strand kick ±0.15 m,
3–6 drops flicked, the leaves stay as foliage, the curtain grows lusher through a session.

Changed:
- **Each leaf at its own cell's row height**, so the four leaves reproduce the piece's vertical extent (the
  row-span idea the play judge praised in Rainbark's peel).
- **No glow.** Leaves are pigment (albedo = the piece colour, sRGB to linear) lit by the strand's light: sky
  fill through the oculus plus pool bounce, plus `dlSunlit` translucency only where the sunfall actually reaches.
  The strand light near the card is normalised so a freshly opened leaf displays within ΔE 10 of the piece hex:
  it must match the board.
- **Greening is time-normalised under slot pressure.** Per side group with S lock slots and an exponential
  moving average λ of locks per second on that side: `τ_eff = clamp(0.6 · S / λ, 6 s, 18 s)`. At rest and in
  slow play τ = 18 s (as proposed); in fast play the leaf reaches bronze and emerald before its slot is reused,
  so the colour language stays visible. The end colour, Doline Emerald `#2A7F52` (L\* 47), is at least 22 L\*
  darker than the light pieces and differs in hue from the dark ones, so every piece still reads at unfurl.
- **A clear matures the leaves at the cleared rows at once** (§3.5).
- The oldest leaves fold back into buds when their slot is reused (as proposed).
- Phone: strand tips above the card's top edge at the piece's column (as proposed).
- Settings: `pieceLockRipple` off → no Flush and no Snap.

### 3.7 Hard drop, amended: the Snap

The Startle (8–24 swiftlets per hard drop) is removed. The hard drop folds into the same lock as one stronger
moment, on the same strand:
- strand kick ±0.4 m (was ±0.15) as a damped double oscillation, `e^{−t/0.5 s}` (bounded, #71);
- the four leaves unfurl in 0.3 s with a stronger overshoot;
- `12 + distance/2` drops flicked, capped at 20;
- at most one swiftlet flits out of the nearest crevice, with probability `min(1, distance/20)`, at most once
  per 8 s;
- at most one Snap per 0.25 s (as proposed); no camera motion.

**Near beads (gap G7).** The strands are in shade, so drops flicked from them would vanish under the strict
"only in the light" rule. Drops spawned within 40 m of the camera (lock, Snap, the clear's bead curtains) use a
**near-bead** look: 0.1–0.2 m streaks, at least 1.15 px wide, lit by sky fill, alpha ≤ 0.35, glinting brighter
only if they cross a lit patch. The oculus showers keep the strict rule (zero size outside the light), so
showers never read as grey "rainy window" streaks.

### 3.8 Swiftlets demoted

- Ambient: pairs or trios every 12–25 s at 12–18 m/s, flaring white-gold in the beam (as proposed), as scale
  specks only.
- Instances 6 / 8 / 12 / 16 / 20 / 24 by tier (was 24–160).
- No bursts on hard drop (§3.7). Four lines: a scatter of 6–12 from the near walls (was "every wall").
  Game over: 3–6 stream home.
- Under reduced motion: flights cut to 30 % (as proposed).

### 3.9 T-spin, amended: the Turning

| Time | What happens |
|---|---|
| 0–0.4 s | A gust swirls down through the oculus; the rim's hanging vines visibly twist. |
| 0.4 s on | The vine fringe **turns one notch (15°) per line** about the column axis: 1, 2 or 3 notches, each 0.6 s eased, 0.25 s apart. The streak comb inside the sunfall slides round the column, and the dappled light on the pool turns with it: different crowns catch the light. |
| after | **The turn persists.** The fringe stays at its new angle for the session (notches accumulate and wrap at 24 = 360°); `resetSession` restores 0. The light on the jungle carries your T-spins. |

- Count = lines. One rotational click of the whole light pattern (the Haft Rang graft the play judge called "the
  cleanest T-spin"), plus a persistent record (the Riverbloom graft).
- Not a wave front (nothing travels across the frame), not a spiral round the card (the column is in the left
  free space), no hue wave, no red field. The proposal's crimson leaf-underside waves are removed.
- **Implementation:** the vine fringe moves out of `oculusTex` (G channel) into its own `fringeTex` (R8, CPU
  mips), sampled at `rot(u.fringeAngle) · (q − oculusCentre)`. `oculusTex` keeps R (rim SDF), B (gap ranks) and
  A (surface silhouette) and never rotates, so the hole in the roof never moves. One extra fetch per
  `dlSunlit`.
- Under reduced motion: the turn completes in a 0.6 s crossfade of the two fringe angles.

### 3.10 Back-to-back, amended: flood threads and the Echo

The director reports `b2b(level)`: 1–3 for successive back-to-back events, 0 when it infers a break (a wave-1
clear with fewer than 4 lines and no T-spin; no producer ever sends `active: false`).

| Time | What happens |
|---|---|
| On each B2B event | **Echo** (kept): the far doline's window brightens, its thin beam swells (0.6 s rise, 3 s hold). **No bow** in it. |
| 0–1.5 s after reaching level n | **Flood threads:** n thin waterfalls (n = 1–3) hang from fixed stations on the oculus rim, left to right, falling the full 200 m through the sunfall. Each blazes white-gold where the beam lights it, turns slate-blue in shade, and raises a small spray skirt where it meets the canopy. |
| If the B2B came with four lines | The cataract does not stop: it thins into the threads (§3.12). The flood carries on while the chain lives. |
| While live | Threads persist and are counted at a glance (threads = B2B level). |
| Break | Threads thin to drips over 3 s. |

- **Weather amendment:** Monsoon Veil loses its waterfall threads (rain veil and glossy canopy only), so threads
  always mean back-to-back.
- **Distinct from Rainbark's sunshower:** no rain over the whole world, no global wetness or sheen change tied to
  B2B; threads are discrete, counted, and anchored to the four-line cataract.
- **Implementation:** one ribbon material for the cataract, the threads and the far doline's own thread (an
  instanced curtain ribbon: flow-streak noise stretched along the fall, UV advanced by the closed-form fall
  distance, frayed edges, foam at the foot, lit by `dlSunlit`). A shipped waterfall shader to read first:
  `createWaterfallTSL` in `src/rendering/odyssey/chapter-environments/surface-world.tsl.js` (Odyssey chapter 3;
  playground `effect=ch3-waterfall`).

### 3.11 Combo, amended: Inhale and Exhale, the release on the breaking lock

Kept: the chain is **counted in shafts**. Shafts = min(chain, 7) for chain ≥ 2; one gap opens per link, 0.5 s
each, in the fixed rank order of the gap channel; mist density ×(1 + 0.22·(n − 1)), capped at chain 8; at 5 the
deck's underside gilds; at 6 the canopy starts to flush; at 7 and above the seven-shaft state, renamed
**Sevenfold** (gap G8).

Changed or made precise:
- **Each shaft is a full column** from its own fringe gap to its own pool on the canopy. The chain is counted
  twice at a glance: columns in the air and pools on the canopy. Pool stations sit inside the left free space,
  never on surfaces next to the card.
- **A gap opening is a fringe event:** the vines part visibly at the rim and a few drops fall. No leaf-bit puff
  (that is Rainbark's, from Iris Springs).
- **The chain-6 canopy flush uses natural flush colours** (red `#B8343F`, rose `#C9607A`, bronze `#9C5A3A`,
  *starting values*), not piece colours, so it never competes with New Growth or Zenith Flush.
- **Exhale is delivered on the breaking lock.** At `flush()`, a player slot with a staged lock, no staged clear
  and a reported combo > 0 sends `combo(0)` now; the tracker's later 0 is suppressed; a clear that arrives late
  (asynchronous multiplayer) within 0.6 s resumes the chain without replaying the Exhale. Clone the logic and
  tests from `src/themes/rainbark/rainbark-director.js` and `tests/unit/rainbark-director.test.js`.
- Exhale as proposed: shafts close from the outside in, one per 0.25 s; the gathered mist rolls into one cloud
  that **rises up and out through the oculus**, its shadow briefly dimming the sunfall as it passes (3–5 s); a
  bigger chain makes a bigger, golden cloud (size ∝ peak). It always rises; it never rolls down a surface
  (Rainbark's vapour roll does).
- Meditation click combos drive the same Inhale dial (as proposed).

### 3.12 Four lines, amended: the Cataract carries the one bow

As proposed: a 0.35 s bright tongue of water slides over the oculus lip (native anticipation, no hush); a white
waterfall drops the full 200 m through the sunfall (stylised: its leading edge reaches the canopy 1.2 s after the
lead, about 5× faster than free fall), blazing where lit and slate-blue out of the light; a spray
cloud blooms off the canopy; mist billows; the canopy thrashes; the fall thins to threads over 5 s; the jungle
glistens 15 s (`u.wet`).

Changed:
- **The bow:** the theme's only rainbow, a full double bow with Alexander's dark band in the spray, analytic on
  the spray shell, placed by `solveBowSun` (§3.4).
- **Swiftlets:** a scatter of 6–12 from the near walls, not an eruption from every wall.
- **Back-to-back:** if the chain is live, the fall thins into 1–3 threads that stay (§3.10).
- **Exposure:** measured mean-luminance lift ≤ +0.25 stop on the tone-mapped frame, rise ≥ 0.35 s, decay
  τ ≥ 0.6 s, `max()` combining, at most 3 lifts per second, with the iris dip so the fall reads as white water.
  The Phaser board's own four-line flash (gold, 0.4 alpha, 0.22 under reduced motion) stacks on top, which is why
  the theme stays at 0.25.

### 3.13 Perfect clear: Zenith Flush (kept, with two notes)

As proposed: the sun stands squarely in the oculus; the sunfall rights itself to vertical and widens to fill the
opening with every gap open; the mist goes incandescent; the vault is revealed; every crown and every root leaf
flushes in the seven piece colours by crown hash; greening back over about 20 s; 1.2 s rise, 4 s peak, 20 s tail;
it arrives on its own later frame with `rows: []`.

Notes:
- **No bow** (vertical sun, and the bow is four lines only).
- **The vertical column must stay in the left free space:** it drops straight down from the oculus centre, so
  the composition must keep the oculus centre's projection at x ≤ 0.2 on 16:9 (and in the top band on portrait).
  Measured lift ≤ +0.25 stop, same rules as the cataract.

### 3.14 Level up and the station order (gap G5)

- **Station index** = `(2 + (level − 1) + k) mod 6`, where 2 is High Fall and k counts the clock steps taken
  this session (cumulative; reset only by `resetSession`). The 150 s step timer restarts at every level up, so a
  clock step never lands within 150 s of a level up and the light never double-steps; because k never decreases,
  the light never walks backwards. A cold start at level L (a quality rebuild, the playground's `level=`) uses
  k = 0. Level 1 rests on High Fall, the canonical frame; the walk then runs High Fall → Long Column → Lean →
  Last Reach → (under a cloud) First Reach → Descent → High Fall.
- **The wrap** (Last Reach → First Reach) is scheduled under a forced cloud crossing (`cloudCover` → 0.75 for the
  6 s transition).
- Level up: 3 s swing; newly lit crowns flush briefly (4 s) in the natural flush colours. Infinity has no
  LEVEL_UP, so the clock alone walks the light.
- The first ambient cloud crossing is seeded at t ≥ 70 s, so the reference shots at `t=40` are never under a
  cloud.
- **The weather clock starts at Clear Breath at t = 0** (order Clear Breath → Rising Mist → Monsoon Veil →
  Steam Hour, about 110 s each, the 25 s crossfade starting at the end of each), so `t=40` is pure Clear Breath,
  the reference weather. `weatherWeights(t)` in core implements this; the playground's `weather=` overrides it.

### 3.15 Green monotony: a measured colour budget

On the tone-mapped rest frame (card excluded):

| Measure | Target |
|---|---|
| Pixels with hue 70–170° and C\* > 15 | ≤ 45 % |
| Near-neutral pixels (C\* < 12: limestone, cream, pearl mist) | ≥ 30 % |
| Warm light (hue 40–75°, L\* > 80: beam, deck hole, pool highlights) | ≥ 6 % |
| Hue of the darkest 10 % of pixels | 160–200° (teal), never 60–90° (olive) |

- **Crown palette** (*starting values*): five greens by crown hash: olive `#5E7A3A`, emerald `#2A7F52`,
  blue-green `#2E6E60`, yellow-green `#7FA343`, dark `#1E4A36`; value jitter ±12 % per crown.
- **Baseline flush:** about 6 % of crowns at rest in muted natural flush (bronze `#9C5A3A`, rose `#B0566A`, both
  at about 70 % of event chroma) and static. Real tropical canopies always have some flushing crowns; event
  flushes stay distinguishable because they are saturated, in the light, and arrive with motion.
- Grade: green-teal lifted shadows, warm-white highlights, saturation 1.06 (as proposed).

### 3.16 Rendering fixes (the rendering lead's list, plus the gaps)

1. **The beam base is closed form on every tier.** Over the analytic chord [entry, exit] of length L, evaluate
   three points with Simpson's rule:
   `I ≈ (L/6) · (f(entry) + 4·f(mid) + f(exit)) · u.iris`, with `f(p) = σ_s(p) · HG(cosθ) · dlSunlit(p) · T(p)`,
   σ_s from the analytic density profile (§3.3) and one `u.noise3` fetch at the midpoint for patchiness. Three
   mask fetches (plus three fringe fetches, §3.9) and one noise fetch. This is the whole beam on Minimal and Low.
2. **The march is a TSL `Loop` and only adds patchiness** on Medium and up:
   ```js
   Loop({ start: int(0), end: int(STEPS), type: 'int', condition: '<', name: 'bm' }, ({ bm }) => { … })
   ```
   STEPS is a JavaScript integer per tier (6 / 8 / 12 / 16 on Medium / High / Ultra / Extreme), fixed at build
   time, so the bound is constant and the body is emitted once: one `dlSunlit`, one `u.noise3` read, Beer and
   two-lobe HG accumulation (g = 0.78 forward, 0.25 back), static IGN jitter. Every texture read inside uses
   `.level()`. If the march blows its budget, drop steps; never drop the closed form.
3. **Hull area cap 22 %** of the frame on every desktop preset (was 30 %); the composition enforces it and a
   test pins it.
4. **Opaque-first.** `parts=sky,cave,jungle,gours` must already read as a sunlit doline: the pool of light on
   the canopy, the vault lit from below, crisp `dlSunlit` shadows. If it does not, no amount of beam and mist
   will save it.
5. **CPU-first canopy and shell** (Stage A0, §5.12). Canopy: crowns of 6–25 m in a power-law size distribution,
   each built of 5–30 sub-clumps (a cauliflower silhouette), dark gaps between crowns covering 10–25 % of the
   area, emergent crowns breaking above the surface, crown-top self-shadow from the sun direction, per-crown hue
   and value from §3.15. **Never Voronoi domes.** Shell: bedding planes as horizontal steps, breakdown blocks
   as large angular facets from the collapse, a broken oculus rim with hanging vegetation, flowstone as vertical
   ribbed drapery (anisotropy ≥ 6:1); the vault and passage cross-sections are designer-controlled spline
   profiles in core (`CHAMBER_PROFILE`), with noise only as detail. If the shell still reads as a noise blob
   after one session, add more hand-placed structure (profile control points, block facets), not more noise.
6. **`lod` along the ray (gap G3):** `d = (H_oculus − p.y)/S.y`;
   `lod = clamp(log2(max(0.0093·d, texelMetres)/texelMetres), 0, maxMip)`.
7. **Pure helpers (gap G4):** `dlBow(cosθ)`, `dlHG(cosθ, g)` (written `x·sqrt(x)` with x ≥ 1e-4, #94),
   `dlThinFilm(cosθ, k, d)`, `dlBeamChord(...)`, `dlRoundSdf`, `dlHash21`: laid out, no captured textures or
   uniforms. Texture reads live only in inline builders (`dlSunlit`, `dlMist`, `dlHaze`).
8. **Valley mist at grazing angles.** The camera sees the valley mist at about 13° below horizontal, near
   grazing. Carry the valley mist mostly with an analytic height-fog term in the canopy, tree and cave shading
   (like Rainbark's `rbAir`); keep the sheets few, wide-ramped, and faded by `smoothstep(0.04, 0.22, |V.y|)`.
9. **Budgets** (targets; measure with `profile=1&trackTimestamp=1`; ADR-0016):

   | Target | Budget |
   |---|---|
   | High, iGPU 1080p × 1.15 | ≤ 6.5 ms GPU total; beam ≤ 1.2 ms; mist ≤ 1.0 ms |
   | Medium | ≤ 5 ms |
   | Low, phone portrait × 0.85, WebGL2 leg | ≤ 9 ms |
   | Minimal, phone | ≤ 6 ms |
   | First-frame compile | about 15 pipelines + post (§5.9, #96) |

10. **Last-resort fallback if the beam is still over budget:** render the beam material at half resolution
    with the house's `rtt(node, null, null, { resolutionScale: 0.5 })` pattern (Sunset and Ocean use it for
    their marches) and composite it in the output pass. This needs a depth-aware upsample at near occluders
    (the strands), so try it only after steps, hull cap and tier changes.

### 3.17 Piece colours, amended (CVD fix, gap G1)

Computed for this file with Machado et al. 2009 simulation at severity 1.0, ΔE76 in CIELAB (D65), the same
method the sibling concept documents used; hues with the formula of `scripts/palette-guideline-check.mjs`.

**The proposal's palette fails:**

| Vision | Worst pairs (ΔE76, ΔL\*) |
|---|---|
| Normal | O/L 32.6 (2.8), S/J 42.2, I/J 44.1 |
| Protanopia | **O/L 1.1 (1.0)**, **T/S 6.5 (3.8)**, Z/J 28.7 |
| Deuteranopia | **T/S 7.1 (2.9)**, **O/L 12.4 (5.5)**, **I/Z 13.4 (10.0)** |
| Tritanopia | I/J 20.0 (4.2), O/Z 23.9 |

Peacock blue and orchid are almost identical to a protanope, which the proposal did not predict.

**Amended palette** (I, S, J, garbage and clean garbage unchanged):

| Shape | Name | Hex | Hue | Rel. luminance | L\* | Gate band (avoided) |
|---|---|---|---|---|---|---|
| I | Flush Crimson | `#E8385E` | 347.0° | 0.208 | 52.7 | cyan 160–210 |
| O | Peacock Fern (deepened) | `#4781F6` | 220.1° | 0.237 | 55.8 | yellow 32–75 |
| T | New-Growth Chartreuse (leafier) | `#8BC85F` | 94.9° | 0.476 | 74.6 | purple 245–315 |
| S | Sunfall Gold | `#FFC23E` | 41.0° | 0.602 | 81.9 | green 90–170 |
| Z | Canopy Jade (lighter) | `#45BC90` | 157.8° | 0.392 | 68.9 | red 320–20 |
| J | Bronze Flush | `#DE6A27` | 22.0° | 0.260 | 58.0 | blue 200–250 |
| L | Doline Orchid (orchid magenta) | `#C168C4` | 298.0° | 0.252 | 57.3 | orange 20–50 |
| GARBAGE | Wet Limestone | `#3A4640` | — | | | |
| CLEAN_GARBAGE | Cave Pearl | `#E6DDC9` | — | | | |

Palette gate: **0/7** (still fully deranged).

| Vision | Worst pairs after the fix (ΔE76, ΔL\*) |
|---|---|
| Normal | T/Z 34.3 (5.7), S/J 42.2, O/L 42.7 |
| Protanopia | T/S 20.6 (2.9), O/L 22.3 (4.7), T/J 24.2 |
| Deuteranopia | **T/J 19.5 (12.1)** (the worst pair overall), I/Z 21.2, I/T 21.7 |
| Tritanopia | I/J 20.0 (4.2), T/Z 22.9, O/Z 23.0 |

Worst pair overall ΔE 19.5 (Rainbark's is 19.4). Re-run the simulation if any hex changes, and check the board
under protanopia and deuteranopia filters. The CVD script is printed in PLAYBOOK §2.8 (save it as `cvd.mjs` in
the session scratchpad); for this palette:

```
node cvd.mjs '{"I":"#E8385E","O":"#4781F6","T":"#8BC85F","S":"#FFC23E","Z":"#45BC90","J":"#DE6A27","L":"#C168C4"}'
```

It prints `gate 0/7` and, as worst pairs, T/Z 34.3 (none), T/S 20.6 (prot), T/J 19.5 (deut) and I/J 20.0
(trit), matching the table above (checked). The cell look (`renderMode: 'solid'`, the `phaser` effects block in
§1.6) is unchanged. Lightness groups after the fix: light S; mid-light T and Z; dark saturated I, O, J and L.

### 3.18 The name and the slot (Stage 0 questions)

- **Name:** keep "Sunfall" (the art judge's favourite name in the slate; Rainbark did not take it). Re-grep
  `src/`, `public/`, `tests/` and `scripts/` for "sunfall" before committing to the id (this documentation folder
  will match, which is fine). Alternate: *Skywell*.
- **Slot:** decide with PLAYBOOK.md §1 "Choosing a slot" which theme Sunfall replaces (`OLD_ID`), or whether it
  is added as a new theme. **It is a product decision: ask the user** unless the session prompt names the slot.
  PLAYBOOK §1a prints the facts to put in front of them (group, orb, song, whether each theme has had a modern
  rebuild). Adding a 62nd theme (PLAYBOOK §1b) breaks counts pinned by tests (such as the 61-entry music
  catalogue) and the invariant that every non-starter theme has exactly one Odyssey orb, so it needs a campaign
  change.
- **Slot facts for Sunfall's neighbours** (checked at commit `585ab55`; re-run PLAYBOOK §1a's script): its
  closest themes all have modern rebuilds (`<id>-world.js` plus a playground effect), so replacing one throws
  away finished work: crystal-cave (orb 2, chapter 1, authored song), cinder-drift (orb 1, chapter 1, authored),
  bioluminescence (orb 5, chapter 1, authored), golden-forest (orb 13, chapter 3, placeholder song), fall (orb 17,
  chapter 3, placeholder), verdant-hills (orb 20, chapter 4, placeholder), ocean (orb 6, chapter 2, authored),
  nimbus-veil (orb 30, chapter 5, placeholder). Forest is never replaced (it is the starter). PLAYBOOK §1a's
  default candidates are the themes without a rebuild, for example mountain (orb 24 "Mountain Stillness",
  chapter 4, placeholder song, a legacy DOM theme). Put two or three such options to the user, with the note
  that a biomes-group daylight theme sits most naturally in an Earth chapter.
- **If the replaced theme holds an Odyssey orb:** keep the orb's slot; retitle it in Sunfall's tone (suggestion:
  "Garden Under Stone"), use `transitionIn: 'crossfade'`, and rewrite the description; keep
  `V2_LEVEL_THEME_IDS` frozen; the `RETIRED_THEME_IDS` alias keeps saves and rewards working.

### 3.19 House FX grammar check

The authoritative list is `docs/theme-concepts/README.md` "The house gameplay-FX grammar (do not reskin it)",
items 1–10 plus its "other overused motifs". This table checks every item, plus the fleet catalogue's avoid lists
and the judges' findings:

| House pattern (README item) | Sunfall (amended) |
|---|---|
| (1) A spark or wisp of the piece's colour leaves the card into a site that keeps that light | Absent. Leaves grow on a strand in the world at the piece's rows; nothing leaves the card; pigment, not light. |
| (2) A ring runs out from under the board's foot or the piece's column | Absent. The lock is leaves opening on a strand; the Snap is a strand kick and beads. No ring, ripple or shock front anywhere. |
| (3) A site holds the piece's colour for ~30 s, then a clear releases it | Absent. The leaf colour matures on the world's clock (delayed greening, time-normalised), or at once when its rows clear. Nothing is released anywhere. Keep leaves non-emissive. |
| (4) Blades of light at the cleared rows; twin jets from both card edges | Absent. Ripening at the rows is a colour change of existing leaves (non-emissive) plus falling beads in the outer lanes; New Growth is on the canopy in the world. |
| (5) One wave front per line | Absent. The leaf-turn waves are removed; New Growth bands unfurl in place; the Turning is a rotation, not a front. |
| (6) Four lines: hush or darkening, then a flare | Absent. Native anticipation (the tongue of water); lift ≤ +0.25 stop under an iris dip. |
| (7) A spiral, wheel, garland or creatures circling the card | Absent. Nothing circles the card; swiftlets cross the chamber far from it. The Turning rotates the light pattern about the beam's own axis in the left free space, never round the card. |
| (8) An hour wheel of palettes | Absent. The level walks the sun geometrically (the same column swings and the pool moves to other crowns); the clock drives weather. Neither is a palette swap. |
| (9) Camera dip or kick on hard drop | Absent. The camera never reacts to events. |
| (10) Combo as one world-scale dial, often circling the board, or a persistent structure that collapses on chain break | Partly shared, and deliberately different: the chain is **counted** (one column and one pool per link, in a fixed rank order), the mist density is a smooth dial underneath, nothing circles, and the release is weather leaving (one cloud rising out through the oculus while the columns close outside-in), not a structure falling. Keep the count legible; never let the columns merge into one glow. |
| (other) Rain and lightning are on the overused-motif list | Rain is Sunfall's clear, so it is held to three rules: it exists visually only inside the light (zero size elsewhere, §1.7 Water), it is confined to the oculus column (never full-frame, never on a window), and each veil is short and event-bound. No lightning, ever. |
| (other) Fireflies, motes and bokeh; leaves or petals thrown from the card; floating crystals; rings and hoops; vortex | Absent. Motes are never the main particle; leaves are grown on strands, never thrown; no crystals, rings or vortices. |
| Prism ring or rainbow arc across the sky on four lines | Absent. The one bow lives only in the cataract's spray. |
| Exposure flash on clears | Absent. Clears change density, gloss and colour, never exposure. |
| God rays / screen-space shafts from a light source | Absent. No post shafts, no `GodraysNode` (§3.3). |
| Bird flocks as a reaction | Reduced to a 6–12 scatter on four lines only. |

---

## 4. Overlap with Rainbark

Rainbark (`docs/theme-concepts/rainbark.md`; code in `src/themes/rainbark/`) is colossal painted eucalyptus
trunks in blue air over a mist floor; its events are material (peel on lock, shed on clear, the Great Moult on
four lines), its combo counter is canopy-gap sun pools, and its back-to-back is a sunshower. Of all six concepts
Sunfall gave Rainbark the most. A Sunfall build must keep its own identity next to it.

### 4.1 What Rainbark already took from Sunfall

From Rainbark's graft table (`docs/theme-concepts/rainbark.md` §0.2 "What is grafted from the runners-up"; the combo details are its §6.6, `rbFleck` its §4.5):

| Sunfall idea | How Rainbark uses it | What Sunfall keeps, and how to stay distinct |
|---|---|---|
| **Ranked gaps in the occluder: one gap opens per combo link, in a fixed order** | **Canopy gaps.** Each link drops a big pinhole sun-pool (about 2 m on the Elder trunk, ×1.6 brighter than ambient flecks) and a short slanted shaft (5 m) onto the near trunks, at 7 fixed stations on the peel lanes; the chain is "counted in pools of light" (pools = chain − 1); each opening has a puff of 12 leaf bits | Sunfall's is the original and stays its combo, but it must look different: **full-height columns** (about 200 m) through the oculus fringe, each with its own pool on the canopy far below, seen across and down; count = number of columns (= chain, up to 7); gaps open as visible vine partings at the rim, **no leaf-bit puffs**; stations on the canopy floor in the left free space, **never sun pools on vertical surfaces next to the card**. |
| **`dlSunlit` formulation:** penumbra from the sun's 0.53° disc, read from CPU mips | `rbFleck`: one fetch gives physically sized sunflecks that grow softer and larger with distance below the canopy | Shared plumbing is fine. Sunfall's occluder is **one big ragged opening plus a fringe**, so its look is one crisp pillar and its shadow, not dapple. Do not add ambient dappled flecks to Sunfall's near surfaces as a look. |
| **Drops that exist only inside the light** | Drips, the gust veil and the B2B sunshower glint only where `rbFleck > 0` | Fine: it is physics. Sunfall's lit rain is **the clear's Shower inside one column**; Rainbark's is grove-wide. Keep Sunfall's showers confined to the oculus column. |
| **The exhale on chain break** | A vapour roll that slides **down** off the Elder and Sister One into the mist during "the Set" | Sunfall's Exhale is **one cloud rising up and out through the oculus**, dimming the sunfall as it passes. Opposite direction, a single object. Keep it rising; never a roll down a surface. |

Ideas the judges offered from Sunfall that Rainbark did **not** take, and that therefore remain Sunfall's own:
the name, delayed greening as a colour language, one leaf per cell on lock, a far-world echo for back-to-back
(Rainbark replaced its own faint "Answer" with the Sunshower), the swiftlet startle (dropped here too, §3.7),
clear line count picking an optic tier (moot under the one-bow rule), and the cloud deck with its burning hole.

### 4.2 New similarity risks now that Rainbark exists

| Risk | Why it is real | Mitigation in a Sunfall build |
|---|---|---|
| **Two themes count the combo in light** | Rainbark's gap pools came from Sunfall | §4.1: columns over a far canopy versus pools on near trunks; different scale, place and count rule. Never put pools on surfaces near the card. |
| **Two high-key daylight nature themes in `biomes`** | Rainbark took the "high sun / morning daylight" slot the art judge called open | Sunfall is **enclosed by stone** (a ceiling, walls, a framed opening) with a green-gold and cream palette and one hero light; Rainbark has no ceiling, no ground, no horizon. Keep Sunfall's haze Chamber Haze `#5D8087` (teal grey-green, L\* 51), never Rainbark's Terpene Haze `#8FA6D8` (blue-violet, L\* 68): ΔE 29.9 apart. Sunfall's trees are tiny 45 m crowns far below; no tall trunk ever stands near the camera. |
| **Mist below the camera** | Rainbark's mist floor is seen steeply below between trunks | Sunfall's valley mist is a thin skin over a **visible canopy**, never bottomless; its signature vapour is the cloud deck **under a ceiling**. |
| **Rain as a reward** | Rainbark's B2B Sunshower is rain plus grove-wide wetness while the chain lives | Sunfall's rain is the clear's short veil in one column; its B2B is discrete, counted flood threads (§3.10). No grove-wide rain, no global wetness or sheen tied to B2B. |
| **Colour ageing as the decay** | Rainbark's bark ripens chartreuse → … → maroon; its bands ripen away | Different medium and direction: Sunfall's leaves mature from the piece colour through bronze to emerald (green is the end state). Never bark-like patches, never strips. |
| **Gilded underlight** | Rainbark's mist top lights the trunks from below | Sunfall's bounce comes from the sunlit pool onto a stone ceiling; the geometry differs (ceiling versus trunks). Fine. |
| **Shafts in haze** | Rainbark draws 3 ambient slab shafts (Medium and up) and 7 combo slabs | Sunfall has one hero column and combo columns, no ambient slabs, no screen-space shafts (§3.3). |
| **Restart rite** | Rainbark's Mistfall, then "morning returns" as the mist drains | Sunfall's "Morning enters" is the beam sliding back down the wall onto the forest: a geometric light move, no mist drain. |
| **Words** | Rainbark's logline uses "cathedral" | Sunfall's chain-7 state is **Sevenfold** (§3.11); avoid "cathedral" in Sunfall's copy and code. |
| **Piece palettes** | Same-shape ΔE between the amended Sunfall palette and Rainbark: I 125.6, O 126.9, T 25.3, S 120.7, Z 42.7, J 53.3, L 41.1. Closest cross-shape pair: Sunfall J `#DE6A27` vs Rainbark O `#F07A2A`, ΔE 7.7 | Acceptable: only T is within ΔE 30 for the same shape, and the CVD constraints decided T. Players never see both palettes at once. |
| **Birds** | Rainbark has lorikeets (2–5, bright) | Sunfall's swiftlets are dark specks that flare only in the beam; no colourful birds. |
| **Registry group** | Both `biomes` | Fine; the group only sorts the picker. |

### 4.3 What a Sunfall build must not borrow back from Rainbark

No bark, peeling, curls, girdles or shed sheets; no colossal trunks as the hero or near the camera; no dappled
sunflecks as an ambient look or a mechanic on near surfaces; no blue air as the aerial-perspective target; no
grove-wide sunshower or wetness as the back-to-back; no camera climb on level up; no "Floor" reveal on the perfect
clear; no leaf-bit puffs; no vapour rolling down a surface. If a step drifts toward any of these, stop and re-read
§1.5 and §3.

---

## 5. Implementation plan

The house pattern is the "masterpiece rebuild" layout of `src/themes/serenity-warp/`, as cloned by Rainbark
(`src/themes/rainbark/`, commit `585ab55` and later). Rainbark is the closest working precedent: same three r186
stack, same director extensions (shadow well, combo-break inference, B2B level), same rename procedure. Read its
files before writing new ones. Precedents for specific parts: Void Ember's 2D-lattice `noise3`
(`src/themes/void-ember/void-ember-tsl.js`); Serenity Warp's far-plane backdrop and clip-space streak quads; the
Odyssey chapter 3 waterfall (`createWaterfallTSL`, `src/rendering/odyssey/chapter-environments/surface-world.tsl.js`).

### 5.1 Stage 0: slot, rename and scaffold

1. **Choose the slot** with PLAYBOOK.md §1 "Choosing a slot" (and §3.18 here): `OLD_ID`, or a new theme. It is
   the user's decision; ask unless the session prompt names it. Confirm the name. Work on a feature branch.
2. **Stage 0a (one small commit, PLAYBOOK §3.1):** write `sunfall-core.js` (the three-free constants and maths
   of §5.2 that the director, world, effect and tests share: piece codes, `STATIONS`, `WEATHERS`, `TIMING`,
   `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`) and `sunfall-tetrominos.js` (the §3.17 palette); run
   `npm run check:palette` and the CVD script (§3.17); commit. Rainbark's equivalent is `0c747dd`.
3. **Stage 0b (PLAYBOOK §3.2): the scaffold and the rename**, split by file ownership (adapter, world frame,
   rename), then integrated. PLAYBOOK §4.2 is the full ordered rename checklist; commit `585ab55` (Cosmic Chimes
   → Rainbark) is its worked example. Sunfall's values for it, `OLD_ID → sunfall`:
   - registry entry in place in `src/themes/theme-registry.js` (`group: 'biomes'`, add to
     `HEAVY_GPU_THEME_IDS`, from which `resourceProfile: 'heavy-gpu'` and `performanceClass: 'heavy'` follow);
     `RETIRED_THEME_IDS` gains `['OLD_ID', 'sunfall']`; `V2_LEVEL_THEME_IDS`
     (`src/core/odyssey/odyssey-progress-schema.js`) stays frozen;
   - the song (PLAYBOOK §4.3): `git mv` the music file to `sunfall.mp3`; if it is an authored recording, rewrite
     the ID3 TIT2 title to "Sunfall" keeping the file length exactly (a placeholder copy is only renamed); rename
     the track key, add a `RETIRED_TRACK_KEYS` entry, update `src/core/progression/theme-music-catalog.js`,
     regenerate `public/assets/music/songs.json` with `node generate-songs.js`, and **tell the user the recording
     is unchanged, only retitled**; `CREDITS.md` line "Sunfall (titled "<old title>" until <month year>)";
   - the Odyssey orb, if the old theme has one (`src/core/odyssey/data/levels.js`, `src/core/odyssey/data/chapters.js`): §3.18;
   - `src/core/odyssey/theme-presentation.js` key colour `'#B5E24C'` (Backlit Chartreuse);
   - `src/ui/serenity-hub/ThemesTab.js` fallback glyph `'sprout'` (it exists in
     `src/ui/components/cosmic-icons.js`);
   - container CSS in `public/styles/main.css`: `#sunfall-theme { background: #5d8087; overflow: hidden; }`, and the
     container in `index.html` if the old theme had one;
   - `captureThemes` row (§1.7) in `src/ui/url-parameters/theme-parameters.js`; the playground parameters in
     `src/ui/url-parameters/playground-parameters.js` (§5.5); `docs/URL_PARAMETER_REFERENCE.md`;
   - `MOBILE_WEBGL2_NODE_IDS` in `scripts/lib/mobile-webgl2-validation.mjs`;
   - the icon in `src/themes/sunfall/` and mirrored to `public/assets/themes/sunfall-theme-icon.png`; delete the
     old icons;
   - living docs that name the old theme; a rename migration test cloned from
     `tests/unit/rainbark-rename-migration.test.js`; rewrite any test that used the old theme as its exemplar.
4. **Clear colour:** `0x5D8087` (Chamber Haze, L\* 51), so the 2.5 s container fade never flashes white or black.
5. **Scaffold (the adapter and world-frame owners of Stage 0b):** clone Rainbark's adapter, director,
   composition, quality and post; a minimal world that draws only the sky and satisfies `WORLD_METHODS` from
   day one (every event already recorded into its slots); the playground effect with every §5.5 parameter
   catalogued. Delete the old theme folder and obsolete tests per the checklist. Then the integrator checklist
   of PLAYBOOK §3.2: the minimal gates (§5.11), a known-good control capture to prove the harness, playground
   shots on both backends for rest, `board=1`, phone, Minimal, Low, `falseColor=1` and every `event=` value
   (a clean console on every code path, although little draws yet), the real game and switch-away on both
   backends, the phone validator at Low and Minimal, the full suite once, then commit.
6. **Never add a net line to `src/main.js` or `src/core/game-modes/OdysseyMode.js`** (architecture-fitness
   ceilings are at their limit): swap ids in place.

### 5.2 Files (`src/themes/sunfall/`)

| File | Role |
|---|---|
| `sunfall-core.js` | Three-free: world plan in metres (`CHAMBER_PROFILE` spline cross-sections, oculus centre and span, ceiling height `H_oculus`, canopy height, passage, far doline); `STATIONS` (6, §1.3) and `stationFor(level, clockSteps)` (§3.14); `WEATHERS` (4) and `weatherWeights(t)`; `cloudSchedule(seed)` (first crossing ≥ 70 s); `TIMING`; `EVENT_ROWS`; piece codes; `planDoline(seed, tier)` (crown sites, emergent trees, strand anchors, gours, nests, far doline; the proposal's `sunfall-plan.js` folded in, as Rainbark folds `planGrove` into core); CPU mirrors `sunlitAt(p)` and `dlBowCpu(cosθ)`; `solveBowSun(layout, aspect)`; `densityAt(y)` (§3.3); `greeningTau(S, λ)` (§3.6); `packCodes`/`unpackCodes`; `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`. |
| `sunfall-bake.js` | Three-free typed-array bakes, deterministic by seed: `bakeOculus` (RGBA8: R rim SDF, B gap ranks 1–7, A surface-forest silhouette; G unused; CPU mips), `bakeFringe` (R8 vine fringe, CPU mips), `bakeCanopy` (R height, G crown id, B flush class, A cavity: the §3.16 clumped-crown model from the CPU lab), `bakeFbm` (+ CPU mips), `bakeLattice` (for `noise3`), `bakeShellVertexData` (sky view factor over 64 directions, light exposure). |
| `sunfall-tsl.js` | `createSunfallUniforms` (`u`, `events`, `palette`, counts); `DataTexture` wrappers; laid-out pure helpers (`dlHash21`, `dlHG`, `dlBow`, `dlThinFilm`, `dlBeamChord`, `dlRoundSdf`, `dlSchlick` (products), `dlFilmic`, `dlDecodeCode`); inline builders that read `u` and textures (`dlSunlit`, `dlDensity`, `dlMist`, `dlHaze`, `dlBounce`, `dlSkyFill`); `export *` from core. |
| `sunfall-sky.js` | Far-plane backdrop triangle: tropical sky, cumulus (drives `cloudCover`), surface-forest silhouette, far doline window. |
| `sunfall-cave.js` | Shell mesh (chamber, passage, far doline chamber), double ceiling with the oculus discard, flowstone, the 21:9-only stalagmite; limestone shading, bounce, sky fill, haze. |
| `sunfall-jungle.js` | Canopy grid, emergent trees and crown impostors, ferns, peacock spikemoss; flush classes, New Growth bands, Zenith Flush, wet gloss. |
| `sunfall-beam.js` | The sunfall hull (closed form + Loop march), combo shaft columns (closed form), the far doline beam. |
| `sunfall-mist.js` | Cloud deck sheets (the burning hole), valley mist sheets, the Exhale cloud, the cataract spray shell (with `dlBow`), steam columns. |
| `sunfall-water.js` | Drops (oculus showers with vertex culling; near beads), the cataract, flood threads and the far doline thread (one ribbon material), drips, meditation drip bursts. |
| `sunfall-roots.js` | Strands (instanced strips) and leaves (instanced quads, interleaved per-leaf state). |
| `sunfall-birds.js` | Swiftlets (6–24). |
| `sunfall-gours.js` | Dry terraces, moss lips, cave pearls. |
| `sunfall-world.js` | `SunfallWorld` with every `WORLD_METHODS` method (`build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`) plus `onB2B(level)`, `onGameOver()`, `onSessionStart()`; camera rig; timed queue; slot rings; station and weather clocks; fringe angle; writes `u`. Exports `REST_RIG`, `fovForAspect`, `SUNFALL_PARTS = ['sky', 'cave', 'jungle', 'beam', 'mist', 'water', 'roots', 'birds', 'gours']`. |
| `sunfall-director.js` | Clone of `rainbark-director.js`: try/finally delivery, `broke` flag, `shape`/`cells`, shadow well with `rowCodes`, combo-break inference on the breaking lock, B2B live level with break inference, the multiplayer pending-COMBO stash, hard-drop `distance`. Rename identifiers only. |
| `sunfall-composition.js` | Cloned readers (with `'#online-main-board canvas'`) plus presets (desktop 16:9, 21:9, 4:3, portrait for aspect < 0.62), HUD mirroring; `beamAnchor` (oculus, deck hole and foot in the left free space; hull ≤ 22 %), `strandAnchors` (outside the card and HUD union by ≥ 0.02), pool stations for the combo columns, the portrait strand-tip lock line, the far doline placement, `bowFoot` input to `solveBowSun`. |
| `sunfall-post.js` | `SunfallPost` (`RenderPipeline`), knee bloom following the iris, one output pass (calm zones, bloom, exposure and event lift, sunfall filmic, grade, vignette, sRGB, grain, dither; **no shafts**), FXAA on Medium, MSAA 4× on High and up, `POST_LOOK`, `createPassThroughPipeline`, `falseColor`. |
| `sunfall-quality.js` | `QUALITY` (§5.8), `QUALITY_NAMES`, `tierFor`. |
| `sunfall-theme.js` | Clone of `rainbark-theme.js`: ids, flags (`sunfallTime`, `sunfallFixedDt`, `sunfallParts`, `sunfallFalseColor`, `sunfallForceWebGL`), renderer with WebGL2 fallback and GPU-loss handling, `CLEAR_COLOR` `0x5D8087`, layout reads on frame time, calm zones, settings. Sink: `lock`, `clear`, `combo` → max over players, `levelUp`, `b2b` → `world.onB2B` (max over players); window `gameOver` and `modeStopped` → `world.onGameOver(); resetSession()`; `modeStarted` → `world.onSessionStart()` (Morning enters). |
| `sunfall-tetrominos.js` | §3.17 palette, `renderMode: 'solid'`, the §1.6 `effects` block, `version: 2` (as Rainbark, Ocean and Stillwater, the solid-render precedents). Export `SUNFALL_TETROMINOS` and reference it from the theme (the palette gate warns on a dead config). |
| `sunfall-theme-icon.png` | 512² 8-bit RGBA, circular (§3.2 content). Mirror to `public/assets/themes/sunfall-theme-icon.png`. |
| `src/playground/effects/sunfall.effect.js` | Mounts the same world and post (`capture: true`), events through a real director, imports only `three/webgpu` plus its own theme modules. |

URL catalogue row (`captureThemes`): `['sunfall', 'sunfall', 'Sunfall', 'sky, cave, jungle, beam, mist, water, roots, birds, gours']`.

### 5.3 Director and sink contract

```
sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, rowCodes, screen })
sink.combo(n, player)        // true combo; 0 = broke, inferred on the breaking lock; idempotent vs the tracker's late 0
sink.b2b(level, player)      // 0..3; 0 inferred from a non-difficult wave-1 clear (no producer sends active:false)
sink.levelUp(level)
```

World reactions: `lock` → Flush (or Snap when `hardDrop`); `clear` → Shower + Ripening + New Growth (lines 1–3),
Cataract (lines 4), the Turning (`tspin`), Zenith Flush (`perfect`, standalone, `rows: []`); `combo` → Inhale or
Exhale; `b2b` → flood threads and Echo; `levelUp` → the light walks; `gameOver` → the light leaves;
`onSessionStart` → Morning enters.

Event facts to respect (from the event-bus survey): subscribe only to `PIECE_LOCK, HARD_DROP, LINE_CLEAR, COMBO,
TSPIN, B2B, PERFECT_CLEAR, LEVEL_UP`, each gated by `this.isActive && !this.isPaused`; there is no bus event for
hold, game over, garbage, soft drop, move or rotate, and referencing one fails `tests/unit/event-contract.test.js`;
the bus `COMBO.comboCount` is cascade depth, not the true combo (ADR-0011), so derive the combo with
`ComboTracker` per player slot; the HARD_DROP `piece` is pooled (copy it synchronously); visible row = board row
− 4; Infinity uses `viewportOrigin`; local multiplayer has no TSPIN, B2B, LEVEL_UP or PERFECT_CLEAR and no cascade
count on LINE_CLEAR; TSPIN arrives only on wave 1 with ≥ 1 line; PERFECT_CLEAR arrives in a later frame with no
rows; game over is the window `gameOver` event (single player and Infinity) or GameModeManager `modeStopped`;
meditation sends LINE_CLEAR and COMBO with a `position` and no board. Settings: `pieceLockRipple` off → no Flush or
Snap; `backgroundComboEffects` off → no event reactions, the ambient world continues; reduced motion = the setting
or `prefers-reduced-motion`.

### 5.4 The event table (`u.events`, one vec4 `uniformArray`, live rows compacted, counts in int uniforms)

A suggested layout (adjust, but keep one array and ≤ 64 rows):

| Block | Slots × rows | Rows | Contents |
|---|---|---|---|
| Shower veils | 4 × 1 | 4 | birth, duration, density boost, cascade wave |
| New Growth bands | 8 × 2 | 16 | (chord centre x, z, angle, birth); (packed codes cells 0–4, packed codes 5–9, τ, intensity). 3 bits per code, 15 bits per float: exact in fp32 |
| Cataract | 1 × 2 | 2 | (birth, lead, leading-edge time, intensity); (antisolar `bowSun` xyz, bow weight) |
| Flood threads | 3 × 1 | 3 | rim station, birth, end time (or −1 while live), width |
| Echo | 2 × 1 | 2 | birth, strength |
| Exhale | 2 × 1 | 2 | birth, peak chain, cloud size, rise speed |
| Zenith | 1 × 1 | 1 | birth, strength |
| Light walk | 1 × 1 | 1 | from station, to station, birth, forced-cloud flag |
| The light leaves / Morning enters | 1 × 1 | 1 | birth, direction (±1) |
| Turning | 1 × 1 | 1 | from angle, to angle, birth, notches |
| Swiftlet scatters | 2 × 1 | 2 | origin wall code, birth, count, seed |
| Meditation drip bursts | 4 × 1 | 4 | world point xyz, birth |
| Globals | — | 4 | (shaftsOpen, mistDensity, wet, flushAll); (station phase, cloudCover, iris, fringeAngle); (weather weights); (b2b level, chain, reduced, spare) |
| **Total** | | **43** | |

Lock leaves and strand kicks live in the instance buffers of `sunfall-roots.js` (one interleaved buffer for
static data, one `DynamicDrawUsage` buffer written on lock), not in uniform rows. Swiftlet and drop seeds live in
their instance buffers. Globals may be plain `uniform()`s instead; they are listed for completeness. The second and
last `uniformArray` is `u.palette` (vec4 rows: 8 piece colours in linear, 5 crown greens, 3 natural flush colours).
Two arrays at most per stage (gotcha #102).

### 5.5 Playground parameters

Every parameter must be catalogued in `src/ui/url-parameters/playground-parameters.js` with `scope` naming
`sunfall` and `sources` naming the effect file; `tests/unit/url-parameter-catalog.test.js` fails on any literal
`params.get('x')` that is not catalogued.

| Param | Meaning |
|---|---|
| `t` | Fixed time (phase-locked; `seek(t)` every frame) |
| `quality` | Minimal…Extreme; default High |
| `level` | 1–12; default 1 (High Fall) |
| `station` | 0–5, overrides the level's station (0 First Reach … 5 Last Reach) |
| `weather` | 0–3, holds a weather (Clear Breath, Rising Mist, Monsoon Veil, Steam Hour) |
| `cloud` | 0–1, holds the cloud-crossing phase (1 = fully covered) |
| `board`, `statsHud` | Mock board with the real selectors (calm zones and aims exercised) |
| `locks=<n>` | Pre-play n locks (alternating sides and pieces) |
| `event` | `lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`, `levelUp`, `release`, `b2b`, `gameOver`, `morning` |
| `eventAge` | Seconds after the event; default 0.4 |
| `eventLevel` | Default level + 1 |
| `lines` | 1–4; default 2 |
| `row`, `u` | Default 9 and 0.3 |
| `piece`, `turns`, `color` | Piece shape, quarter turns, colour override |
| `dist` | Hard-drop distance; default 14 |
| `cascade` | Waves for `clear`; default 1 |
| `combo=<n>` | Hold a chain |
| `peak=<n>` | For `release`; default 6 |
| `b2b=<0–3>` | Hold the flood threads at that level |
| `fringe=<n>` | Hold n accumulated Turning notches |
| `reduce`, `parts`, `noPost`, `falseColor`, `bloom` | Reduced motion, part filter, post off, false colour, bloom override |
| `px`, `py` | Hold the pointer |
| `icon`, `iconFov`, `iconYaw`, `iconPitch` | Icon frame |
| `demo` | 40 s loop of locks, clears, chains, four lines, T-spin and B2B |

Page-level parameters (`forceWebGL=1`, `profile=1&trackTimestamp=1`, `ref=…&refMode=split`, `paused=1`) belong to
the playground runtime and need no catalogue entry for this effect.

### 5.6 Staged build order with acceptance shots

Each step is **one small effect per session** (CLAUDE.md). Each ends with playground screenshots (wait for
`window.__PLAYGROUND_READY__ === true`, then a few animation frames or `window.__PLAYGROUND__.seek(t)`), a clean
console (no WGSL, GLSL or validation errors), `window.__PLAYGROUND__.diagnostics()` read back, and one Low-tier
capture. In a cloud container use the headless Chromium + SwiftShader tooling printed in PLAYBOOK §5 (it
includes the harness-only `GPUTexture.createView` swizzle shim that Chromium 141 needs with three r186, and the
real-game and switch-away scripts). Software rendering is slow (1–5 fps): iterate at 960×540, accept at
1920×1080. Look at every PNG: a clean console is not proof it looks right.

All queries below follow `/playground.html?`. Viewports: **D** = 1920×1080, **W** = 2560×1080, **P** = 390×844
(DPR 1), **Q** = 1440×1080 (4:3). ★ = capture on both backends (add `&forceWebGL=1`). The reference frame is
`effect=sunfall&t=40&level=1` (High Fall, Clear Breath, no cloud).

**Stage A: environment**

| Step | Work | Acceptance shots |
|---|---|---|
| **A0** | **CPU lab, no shader** (numpy/PIL, in the session's scratchpad, never committed; §5.12): the canopy heightfield and crown colours rendered from the rest camera with the sun, transmission and the pool mask; the chamber cross-sections and oculus rim; the oculus and fringe masks; a CPU still of the closed-form beam (density profile, streak comb). Compare side by side with reference photos (§6). Write down the parameters that passed. | Montage of render vs reference. Pass only if the canopy does not read as bubble wrap, a broccoli field or Voronoi domes; the vault is not a noise blob; the oculus reads as a collapse, not a crater lip or a circle; the beam reads as a solid pillar with crisp edges, not rays. |
| **A1** | Sky backdrop + cave shell + oculus mask + `dlSunlit` on the shell (sun patch, sky fill, pool bounce as a disc light, haze). | ★ `effect=sunfall&t=40&level=1&parts=sky,cave` @D · same @P · `effect=sunfall&t=40&level=1&parts=sky,cave&falseColor=1` @D. Vault lit from below (mean L\* ≥ 35); the oculus ≥ 4 % sky. |
| **A2** | Canopy, emergent trees, ferns, spikemoss, gours (opaque world complete). | ★ **opaque-first:** `effect=sunfall&t=40&level=1&parts=sky,cave,jungle,gours` @D (must already read as a sunlit doline: pool of light, lit vault, crisp shadows) · `…&quality=Minimal` @D · `effect=sunfall&t=40.5&level=1&parts=sky,cave,jungle,gours&px=0.2&py=0.8` @D (no shimmer under parallax). Hero checklist §5.7 items 7–8. |
| **A3** | The sunfall: closed form first, then the Loop march; hull cap; streak comb; calm inside the material. | ★ `effect=sunfall&t=40&level=1&parts=sky,cave,jungle,gours,beam&quality=Low` @D (closed form) · ★ same with `quality=High` @D (march adds patchiness only) · `effect=sunfall&t=40&level=1&parts=sky,cave,jungle,gours,beam&board=1` @P (≤ 0.5 display behind the card) · `…&falseColor=1` @D. Checklist items 1–3, 9. |
| **A4** | Mist: cloud deck with the burning hole, valley mist, analytic valley haze, grazing fade. | ★ `effect=sunfall&t=40&level=1&parts=sky,cave,jungle,gours,beam,mist` @D · `effect=sunfall&t=40&level=1&px=0.8&py=0.2`, then `t=40.5` and `t=41` @D (no slices or seams) · `effect=sunfall&t=40&level=1&weather=1` @D (Rising Mist: solid pillar, low deck) · `effect=sunfall&t=40&level=1&weather=3` @D (Steam Hour). Checklist items 4–6. |
| **A5** | Ambient water (drips, passing showers, no colour), roots and ambient leaves, swiftlet pairs, far doline and its beam and thread. | ★ `effect=sunfall&t=40&level=1` @D (full rest) · `effect=sunfall&t=40&level=1&weather=2` @D (Monsoon Veil: rain glitter only in the light, no threads, no bow) · ★ `effect=sunfall&t=40&level=1&quality=Low&forceWebGL=1` @P. |
| **A6** | Stations and the clock, weathers, cloud crossings, composition presets, HUD mirroring, camera drift and parallax, reduced motion. | `effect=sunfall&t=40&level=1` … `level=6` @D (the light walks; level 5 is First Reach after the wrap) · `effect=sunfall&t=40&level=1&cloud=1` @D · ★ `effect=sunfall&t=40&level=1&board=1` @D, @W, @Q, @P · `effect=sunfall&t=40&level=1&board=1&reduce=1` @D. Frame budget (§3.2) and colour budget (§3.15) measured and recorded. Unit tests pin: foot, pool, deck hole and strands never under card or HUD rects at aspects 0.46, 1.0, 1.33, 1.78 and 2.37; hull ≤ 22 %; both column ends visible on every preset. **Before Stage B:** the side-by-side thumbnail test against the reference snapshots. |

**Stage B: gameplay FX**

| Step | Work | Acceptance shots (all after `effect=sunfall&t=40&level=1&board=1&`) |
|---|---|---|
| **B1** | Flush and Snap: leaves at their cells' rows, pigment lighting, greening with slot pressure, strand kicks, near beads; director wiring; lanes. | ★ `event=lock&piece=L&u=0.15&row=12&eventAge=0.2` @D (buds snapping) · `event=lock&piece=L&u=0.15&row=12&eventAge=1.0` @D (open; colour matches the board within ΔE 10) · `event=lock&piece=S&u=0.85&row=8&eventAge=1.0` @D (right strand) · `locks=12&event=lock&piece=T&u=0.2&row=15&eventAge=9` @D (a curtain of mixed ages: piece colours, bronze, emerald) · `event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.25` @D (Snap: big kick, bead spray, no flock) · ★ `event=lock&piece=T&u=0.2&row=10&eventAge=0.8` @P (strand-tip lock above the card, legible). |
| **B2** | Shower, Ripening at the rows, New Growth from the shadow well, cascades. | ★ `locks=10&event=clear&lines=3&row=16&eventAge=1.2` @D (veil in the column, three rows shivering on both strands, bands unfurling) · `locks=10&event=clear&lines=2&row=17&eventAge=4` @D (bands in the rows' own colours; those rows' leaves emerald) · `locks=10&event=clear&lines=1&row=18&eventAge=0.9` @D · `event=clear&lines=1&row=18&cascade=3&eventAge=2.2` @D (aftershowers) · `locks=10&event=clear&lines=3&row=16&eventAge=1.2&falseColor=1` @D (only glints above the knee). No colour in the rain anywhere. |
| **B3** | Combo: columns and pools in rank order, vine partings, mist inhale, deck gilding at 5, natural flush at 6, Sevenfold; Exhale; break inference. | ★ `combo=2` @D · `combo=4` @D (four columns, four pools) · ★ `combo=7` @D (Sevenfold) · `event=release&peak=6&eventAge=0.8` @D (columns closing outside-in) · `event=release&peak=6&eventAge=2.5` @D (the cloud passing out through the oculus, sunfall dimmed) · `combo=5` @P. Director tests: break on the breaking lock, resume rule. |
| **B4** | Cataract and the one bow: the tongue, the fall (leading edge at the canopy 1.2 s after the 0.35 s lead, stylised; the spray and bow peak about 2.2 s after the event), spray shell with `dlBow`, `solveBowSun`, wet tail, swiftlet scatter, measured lift. | `event=quad&row=16&eventAge=0.2` @D (the tongue over the lip) · ★ `event=quad&row=16&eventAge=2.2` @D (the fall through the beam and the double bow in the spray) · `event=quad&row=16&eventAge=5` @D (thinning, the jungle glistening) · `event=quad&row=16&eventAge=2.2&falseColor=1` @D · `event=quad&row=16&eventAge=2.2` @P and @W. Mean-luminance lift ≤ +0.25 stop measured between `eventAge=0` and the peak. |
| **B5** | The Turning (fringe texture, rotation, persistence); flood threads and Echo; director B2B level. | `event=tspin&lines=2&u=0.2&row=13&eventAge=0.9` @D (mid-turn: streaks sliding round the column) · `event=tspin&lines=2&u=0.2&row=13&eventAge=4` @D (turned; the pool's light pattern changed) · `fringe=6` @D · `b2b=2` @D (two threads) · ★ `b2b=1&event=quad&row=16&eventAge=6` @D (the cataract thinned into one thread that stays) · `event=b2b&eventAge=1.0` @D (Echo, no bow). |
| **B6** | Zenith Flush; the light walks; the light leaves and Morning enters; idle drips; meditation drip bursts; multiplayer strands. | ★ `event=perfect&eventAge=2.5` @D (vertical column inside the left free space; every crown flushed) · `event=perfect&eventAge=14` @D (greening back) · `event=levelUp&eventLevel=2&eventAge=1.5` @D (column mid-swing) · the full query `effect=sunfall&t=40&level=4&board=1&event=levelUp&eventLevel=5&eventAge=3` @D (the wrap under a cloud; written out because a second `level=` would be ignored) · `event=gameOver&eventAge=4` @D (a sliver at the rim, twilight) · `event=morning&eventAge=2` @D · `reduce=1&event=tspin&lines=1&eventAge=1` @D. |

**Stage C: post, tiers, phone, icon, docs**

| Step | Work | Acceptance |
|---|---|---|
| **C1** | Post: calm zones with `board=1`, knee bloom following the iris, sunfall filmic, grade, vignette, grain and dither, FXAA/MSAA, false colour. No shafts. | ★ `effect=sunfall&t=40&level=1&board=1` @D (board readable; the column and pool in the free space) · `effect=sunfall&t=40&level=1&falseColor=1` @D. |
| **C2** | Quality tiers (§5.8); Minimal and Low captures; the WebGL2 leg on every starred event shot. | `effect=sunfall&t=40&level=1&board=1&quality=Minimal` @D · ★ `effect=sunfall&t=40&level=1&board=1&quality=Low&forceWebGL=1&event=clear&lines=2&row=17&eventAge=0.9` @P. Measure Low on the phone viewport with `profile=1&trackTimestamp=1`. |
| **C3** | Portrait, 21:9 and 4:3 passes: beam anchors, deck hole in the top band, pool in the bottom band, strand lanes, far doline, bow solver, stalagmite (21:9 only). | ★ `effect=sunfall&t=40&level=1&board=1&event=quad&row=16&eventAge=2.2` @W, @Q, @P. |
| **C4** | Icon frame (PLAYBOOK §2.9); the theme end to end in the real game on both backends (`game.mjs`); switching away leaves no canvas (`switch-away.mjs` prints `clean switch-away`); the phone validator at Low and Minimal; tests; docs: the record `docs/SUNFALL_VISUAL_OVERHAUL_<yyyy-mm>.md` (precedent `docs/SERENITY_WARP_VISUAL_OVERHAUL_2026-10.md`; it holds the §3.2 and §3.15 measurements and the CPU-lab parameters), curated small webp captures under `docs/sunfall-captures/`, a `docs/ARCHITECTURE_INDEX.md` row, and any new gotcha rows in both `.claude/skills/webgpu-threejs-tsl/SKILL.md` and `.agents/skills/webgpu-threejs-tsl/SKILL.md` (kept byte-identical by a test). Then the final adversarial review (PLAYBOOK §3.6) and the full gates. | Icon: `effect=sunfall&t=40&level=1&icon=1&iconFov=30&iconYaw=-20&iconPitch=6` (square 512×512; tune yaw and pitch so the deck hole, column and pool stack on the circle's left third with two crimson crowns in the pool; no bow, no bird). Real-game and phone runs as in PLAYBOOK.md. |

### 5.7 Art checklist for the hero (the sunfall, the pool and the bounce) and the canopy

Accept A0–A4 only when every item holds, judged against reference photos side by side:

1. **A solid pillar.** Crisp edges (penumbra only from the sun disc), a body you could walk round, an elliptical
   cross-section visible at both ends.
2. **Streak comb** lengthwise, ≤ 25 % modulation, drifting with the vine sway; never radial, never converging.
3. **Brightness profile:** brightest at the deck crossing and the foot, a steady moderate band between; no
   banding or swimming from the march (static IGN jitter; compare `t=40` and `t=40.5`).
4. **The deck hole:** a gold-rimmed ellipse (`#FFD27F`), the deck thinned round it and drawn up through the
   opening.
5. **The pool:** crowns blazing chartreuse by transmission, specular stars small and sparse (no field twinkle),
   an incandescent mist skin, falling off into blue-green shade at a soft edge.
6. **The bounce:** the vault lit green-gold from below, brightest above the pool; nearby walls warmer.
7. **Canopy:** clumped crowns 6–25 m, emergents, dark gaps, five greens plus a little natural flush; never
   Voronoi domes or bubble wrap; fades into the mean colour by pixel footprint at distance (`fwidth` mean blend,
   the Painted Ages graft) so nothing shimmers under the camera drift.
8. **Value structure:** near strands and gours dark and crisp; the column and pool the brightest; deck and vault
   mid; passage low-contrast blue; the far doline a small pale-green window.
9. **False colour:** only the beam core, the deck hole's rim, pool highlights and specular stars above the bloom
   knee.
10. **Frame and colour budgets** (§3.2, §3.15) met and recorded.
11. **Seen whole, it reads as "a sunlit jungle in a sinkhole"**, not "a cave with a beam", not god rays, not a
    rainforest seen from a plane.

### 5.8 Quality tiers (amended)

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Pixel-ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |
| Beam base (closed form, Simpson 3) | on | on | on | on | on | on |
| Beam march steps (patchiness only) | 0 | 0 | 6 | 8 | 12 | 16 |
| Combo shaft columns (closed form) | 7 | 7 | 7 | 7 | 7 | 7 |
| Mist sheets (deck + valley) | 2 | 3 | 4 | 6 | 7 | 8 |
| Analytic valley haze | on | on | on | on | on | on |
| Canopy grid | 64² | 96² | 128² | 192² | 256² | 256² |
| Emergent trees | 16 | 24 | 36 | 48 | 64 | 80 |
| Root strands per side / leaves | 3 / 96 | 4 / 160 | 6 / 256 | 8 / 384 | 10 / 512 | 12 / 640 |
| New Growth band slots | 4 | 6 | 8 | 8 | 8 | 8 |
| Drops (showers + spray + beads) | 300 | 600 | 1,200 | 2,400 | 4,000 | 6,000 |
| Spray shell + analytic bow | on | on | on | on | on | on |
| Flood threads | 3 | 3 | 3 | 3 | 3 | 3 |
| Swiftlets | 6 | 8 | 12 | 16 | 20 | 24 |
| Detail octaves (shell and canopy) | 2 | 2 | 3 | 4 | 5 | 5 |
| Steam columns / far shower | 0 / off | 2 / off | 3 / off | 4 / on | 6 / on | 6 / on |
| Bloom (resolution) | off | off | 0.33 | 0.45 | 0.5 | 0.5 |
| AA | none | none | FXAA | MSAA 4× | MSAA 4× | MSAA 4× |

Every tier keeps the whole picture and every event (the Flush, Snap, Shower with rows and New Growth, Cataract
with its bow, the combo columns, Exhale, the Turning, flood threads, Echo, Zenith Flush, the light walk). Drop
octaves and taps as whole terms in JavaScript, never by substituting a constant (gotchas #72, #135). Budgets
are §3.16 item 9. Scope cuts if over budget, in order: march steps, then steam columns and the far shower, then
emergent-tree count, then mist sheets on Medium, then the half-resolution beam fallback (§3.16 item 10). Never
cut: the closed-form beam, the deck hole, the bounce, the Flush, Ripening and New Growth, the Cataract's bow, the
combo columns, the Exhale, the Turning, flood threads, Zenith Flush.

### 5.9 TSL and WebGL2/WebGPU guards that matter for this concept

Gotcha numbers refer to the table in `.claude/skills/webgpu-threejs-tsl/SKILL.md`, numbered by line at commit
`5d3478d` (search the symptom text if the lines have moved). The `webgpu-threejs-tsl` skill auto-loads on this work.

| Guard | Where it bites in Sunfall |
|---|---|
| **#81 / #101** an inline `Fn` is re-emitted at every call; a JS `forEach` emitting TSL bloats `main()` | The beam march: one TSL `Loop` with a constant per-tier end; `dlSunlit` emitted once in its body. The combo columns: a `Loop` over the live shaft count, never seven JS copies. |
| **#89** nested `select` round `Fn` calls fails on the WebGL2 backend only (`addToStack`) | `dlSunlit`'s `rimOpen · (1 − fringe) · gapOpen`, `dlBow`'s band choice, flush-class selects, near-bead vs shower drop look. Fold into one `select(a.and(b), v, f)` with `v.toVar()` built first. |
| **#71** an unbounded `exp` turns a region black, often only on tall portrait screens | Beer `exp(−σ_t·L)` in the beam, the valley-mist profile `exp(−max(y − y_canopy, 0)/25)`, haze `1 − exp(−σ·dist)`, strand kicks `e^{−t/τ}`, the drop fall `τ(1 − e^{−t/τ})`, greening curves. Bound every argument; capture portrait early. |
| **#94** NaN from `pow` of a base a hair below zero spreads through the bloom chain | HG (`x·sqrt(x)`, x ≥ 1e-4), Schlick and GGX-lite on wet leaves (products), the thin-film cosine, the bow cosine. Clamp every cosine. |
| **#93 / #95** laid-out helpers must not capture textures or uniforms | `dlBow(cosθ)` takes the cosine; `bowSun`, `shaftsOpen` and `fringeAngle` are read by the inline builders and passed in. |
| **#102** more than 12 uniform buffers per stage fail WebGPU validation | Two `uniformArray`s only (`u.events`, `u.palette`). |
| **#99** more than 8 vertex buffers fail on WebGPU | Leaves, strands, drops, swiftlets, trees and ferns: interleaved instance buffers (one static, one dynamic per pool). |
| **#110 / #155** loops over live rows; named loops hand their index under that name | Distinct names: `bm` (march), `cs` (combo shafts), `sh` (showers), `gb` (growth bands), `th` (threads); read the index by that name. |
| **#87 / #88** interpolated instance attributes carry last-bit noise | Crown ids, flush classes, leaf colour codes, strand ids and swiftlet seeds as integers read with `floor(x + 0.5)`. |
| **#68** a branch reads zeros from shared nodes | Root-pin `lit`, density, `wet` and the flush weight with `.toVar()` before any `If`. |
| `.level()` inside `If` and `Loop` | Every mask, fringe, noise and canopy read inside the march, the shaft Loop and event branches. |
| **#104 / #116** baked fBm at mip 0 with large gain is serrated; narrow `smoothstep` on noise is confetti | Cloud deck and valley sheets: wide ramps, `1 − exp(−τ)`, `.level(2.0)` for large-gain reads. |
| **#136** and the container's 3D-texture failure | Mist `noise3` via the 2D-lattice trick; never `Data3DTexture` or `lut3D` (they fail WebGPU validation on the cloud container's SwiftShader). |
| **#113** orientation of hand-made texture lookups | The oculus and fringe are `DataTexture`s addressed `(q − c)/span + 0.5`; pin the orientation with a unit test (CPU `sunlitAt` vs the bake at a known asymmetric point). |
| **#69** equal-edge `smoothstep` is a hard WGSL error | Gap opening `smoothstep(n − 0.5, n + 0.5, shaftsOpen)`, the bow's band edges, any edge built from data: never equal. |
| **#135 / #72** dropping a term by a constant or a zero uniform | Tiers drop octaves and march terms in JavaScript. |
| **#147 / #120** sub-pixel particles become blobs on phones; additive light must be budgeted | Drops ≥ 1.15 px wide and dimmed below that (as proposed); total drop light (count × area × exposure) capped per tier. |
| **#90 / #117** premultiplied blending; a part captured alone is black | Beam, shafts and glints write `vec4(rgb, 0)`; capture additive parts with an opaque part (`parts=sky,cave,…`). |
| **#100 / #129** backdrop last among opaque; transparent quads picking up depth haze | Sky backdrop at renderOrder 50 with `LessEqual` and no depth write; mist, beam, water and leaves in the fixed renderOrder bands of §1.7. |
| **#105** MSAA extrapolates varyings on thin strips | Clamp interpolated coordinates in strands, threads and streak quads on the MSAA tiers. |
| **#92** camera-facing strips culled | Strands and threads `DoubleSide`. |
| **#134** event lights and the iris | Every event light × `u.iris`; the bloom knee follows the iris. |
| **#122** polynomial S-curves outside 0..1 | Clamp before the sunfall filmic's contrast curve. |
| **#103** screen-space shaft artefacts | Not applicable: there are no screen-space shafts (§3.3). Do not add any. |
| **#96** pipeline count | Target about 15: sky, cave, canopy, trees, ferns, spikemoss, gours, beam hull, shaft columns, mist, spray shell, drops, ribbons (cataract and threads), strands, leaves, swiftlets (some can share materials). Every pool always drawn with dormant zero-size slots so the first frame compiles them all. |
| **#144** effects behind the card are never seen | Strand anchors, pool stations and the foot step outward past the card and HUD rects. |
| ADR-0019: gate on renderer kind, not backend | The world and post build identically for the WebGPU and WebGL2 backends. |

### 5.10 Tests (clone Rainbark's, then add)

| Test file | What it covers |
|---|---|
| `tests/unit/sunfall-core.test.js` | Palette gate 0/7 with the script's hue maths; CVD worst pair ≥ 19 (Machado 2009, ΔE76); `dlBowCpu` band edges in cosine space; `solveBowSun` at 41.5° ± 0.5° for aspects 0.46, 1.0, 1.33, 1.78, 2.37; `stationFor` (level 1 → High Fall; the step timer restarts on level up; the station never walks backwards; the wrap flagged for a forced cloud); `cloudSchedule` first crossing ≥ 70 s and deterministic; `weatherWeights` sum to 1 and are pure Clear Breath at t = 40; `greeningTau` bounds; `densityAt` positive and bounded; `packCodes` round-trip; `sunlitAt` against hand-computed points (inside, fringe, outside, a ranked gap opening at its rank). |
| `tests/unit/sunfall-bake.test.js` | Oculus mask: rim closed, gap ranks 1–7 present, distinct and ordered; fringe and fBm tile seamlessly; mips present; canopy crown-size distribution and gap fraction in the §3.16 ranges. |
| `tests/unit/sunfall-director.test.js` | Clone of the Rainbark director tests: shadow-well `rowCodes`; combo break on the breaking lock; resume rule; B2B level and break inference; multiplayer COMBO stash; empty-row fallback; settings resets. |
| `tests/unit/sunfall-composition.test.js` | Foot, pool, deck hole, pool stations and strands outside card and HUD rects at aspects 0.46, 1.0, 1.33, 1.78, 2.37; hull ≤ 22 %; both column ends visible; HUD mirroring; portrait strand-tip lock line; the oculus centre at x ≤ 0.2 on 16:9 (Zenith). |
| `tests/unit/sunfall-world.test.js` | `WORLD_METHODS`; dormant pools; `seek` determinism (two seeks compare equal); reduced motion; fringe angle persists until `resetSession`; threads follow `onB2B(level)`; New Growth slots wrap oldest first. |
| `tests/unit/sunfall-theme.test.js` | Node graphs built for all six tiers with `forceWebGL: true` and no GPU; banned-API greps (no `ShaderMaterial`, `WebGLRenderer`, `mx_*`, `GodraysNode`, `from 'three'`, absolute asset paths); flag literals; registry triple (`heavy-gpu`, heavy, not startup-eligible); icon exists. |
| `tests/unit/sunfall-playground.test.js` | The effect's parameters equal the catalogue entries. |
| `tests/unit/sunfall-shaders.test.js` | Each part built with `WGSLNodeBuilder` and `GLSLNodeBuilder` at High and Minimal: no warnings, each stage < 48 KB, no equal-edge `smoothstep`, no `mx_`, laid-out helpers emitted once, the march body emitted once (copy the inline helper from `tests/unit/himalayan-peak-shaders.test.js`). |
| `tests/unit/sunfall-rename-migration.test.js` | For `OLD_ID` (clone `tests/unit/rainbark-rename-migration.test.js`). |

### 5.11 Verification commands

Minimal (every commit):
```
npm run typecheck
npx vitest run tests/unit/sunfall- tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/theme-music-catalog.test.js tests/unit/odyssey-unique-themes.test.js \
  tests/unit/url-parameter-catalog.test.js tests/unit/dual-state-theme-tripwire.test.js \
  tests/unit/mobile-webgl2-validation.test.js tests/unit/odyssey-save-migration.test.js \
  tests/unit/theme-music-preferences.test.js tests/unit/theme-collection.test.js \
  tests/unit/development-collection-access.test.js tests/unit/theme-container-registry.test.js \
  tests/unit/theme-capture-orchestrator.test.js tests/unit/odyssey-difficulty-balance.test.js \
  tests/unit/theme-lifecycle-audit.test.js
npm run audit:theme-lifecycle && npm run check:palette && npm run check:boundaries
node scripts/architecture-fitness-check.mjs
npx eslint src/themes/sunfall --ext .js
```
(`git add` new files before trusting the dual-state tripwire: it scans tracked files only.)

Full (before a merge): `npm test`, `npm run lint:ci`, `node scripts/ts-ratchet-check.mjs`,
`npm run perf:budgets:gate`, `npm run check:release-gates`, `npm run build`, `npm run check:ip-strings`,
`npm run check:pages-artifact`, plus the visual proof: playground shots on both backends, the real game on both
backends, and `npm run validate:mobile:webgl2 -- --theme sunfall` at Low and then `--quality Minimal`
(PLAYBOOK §5.8 has the port workaround needed when a dev server already holds 5173). The Electron-based validators
(`scripts/validate-all-themes.mjs`, Electron playground captures) and the chrome-devtools MCP are not available in
cloud containers; PLAYBOOK §5 describes the headless Chromium + SwiftShader replacement, and PLAYBOOK §6 is the
authoritative gate list (it may have grown since this file was written).

### 5.12 Prototype the hero on the CPU first (the Rainbark lesson)

Rainbark's spec described its bark atlas as an anisotropic Voronoi mosaic. Prototyped on the CPU before any
shader, that recipe **read as stained glass** and was rejected; thresholded fBm contours read as topographic
rainbow outlines and were rejected; pointed lozenge splats read as candy leaves; a fourth model ("ribbon splats"
over a cool grey matrix) passed after three refinements (v4–v6; v6 chosen). The details are in
`docs/theme-concepts/rainbark.md` §10. Sunfall's riskiest surfaces are
exactly the kind that fail this way, and the rendering lead named them:

1. **The canopy seen from 90 m.** The proposal's `canopyTex` is "Voronoi crown domes", which the rendering lead
   predicted would read as "green bubble wrap". In numpy/PIL: generate the crown heightfield (§3.16 item 5),
   shade it from the rest camera with the station's sun (Lambert plus a transmission lobe where light passes
   through, crown-top self-shadow, the pool mask from the oculus projection, a haze ramp with distance), render
   at 960×540, and put it beside two or three aerial rainforest-canopy photos and Son Doong doline photos (§6).
   Iterate until it reads as forest at 90 m and at 400 m.
2. **The vault and the oculus rim.** Render the chamber cross-sections as a silhouette and value study (bounce
   from below, sky fill from the opening) and compare with Son Doong doline photos looking up. It must read as a
   collapse in bedded limestone, not a smooth tube or a noise blob.
3. **The column.** A CPU still of the closed-form beam over a flat grey stand-in scene (density profile,
   fringe mask, streak contrast) is cheap and shows at once whether it reads as a pillar or as rays.

Keep scripts and comparisons in the session scratchpad. Record the passing parameters in `sunfall-core.js`
comments and in the theme's record doc. Never commit the reference photos.

---

## 6. Reference imagery to look for

Keep reference images in the session's scratchpad and compare with PIL montages (PLAYBOOK §5.9). The
playground's `ref=/playground-refs/<file>&refMode=split` overlay reads from `public/playground-refs/`, which is
**served and tracked**: a copyrighted photo may sit there only briefly for a local session, must never be
`git add`ed, and must be deleted before any commit (dragging the image onto the playground window is safer: it
puts nothing in the repo). **Do not commit copyrighted images anywhere.** Commit an image only if it is verifiably
public domain or the user's own, and record its source next to it. Cite source URLs in docs instead.

**The doline (Hang Sơn Đoòng, Phong Nha-Kẻ Bàng, Vietnam).**
- "Son Doong Doline 1 sunbeam" and "Son Doong first doline light" (the column, its edges, its mist).
- "Son Doong Garden of Edam" / "Son Doong Doline 2 jungle" (the canopy from above, slender trees, the light
  pool).
- "Son Doong cave clouds" / "Son Doong fog doline" (the cloud deck under the ceiling).
- "Son Doong Doline 2 waterfall after rain" (the Fstoppers entry in §1.10: the cataract and flood threads).
- "Great Wall of Vietnam Son Doong" (the flowstone wall), "Hand of Dog stalagmite" (only for the 21:9 silhouette).
- "Son Doong cave pearls", "Son Doong rimstone pools dry" (the gours).
- Photographers and works: Carsten Peter's photographs for National Geographic's January 2011 feature on the cave;
  Ryan Deboodt's Son Doong photography and aerial footage; Martin Edström's 360° Son Doong documentation (National
  Geographic, Google Arts & Culture story in §1.10). All copyrighted: view only.

**Other skylights into caves and sinkholes (for the light, the roots and the scale).**
- "Hang En cave entrance light" (Phong Nha, near Son Doong).
- "Xiaozhai Tiankeng", "Dashiwei Tiankeng primeval forest" (Guangxi, China: forests at the bottom of giant
  sinkholes, seen from the rim).
- "Sótano de las Golondrinas sunbeam" and "Golondrinas swifts" (Mexico: a vertical light shaft, and swifts
  spiralling out of a pit: the swiftlet reference).
- "Cenote Ik Kil hanging roots", "Cenote Suytun light beam" (Yucatán: root curtains hanging into a sunlit void;
  avoid the mirror-water shots).
- "Stephen's Gap rainbow" (Alabama: a rainbow in cave-mouth fog; the HuffPost source in §1.10).

**Optics.**
- "rainbow in waterfall spray", "double rainbow Alexander's dark band" (band widths, the dark band's value, how
  much arc shows in spray).
- "sunbeam rain glitter backlit" (rain visible only in light).

**Plants and the colour language.**
- "Selaginella willdenowii iridescent", "peacock spikemoss" (the blue sheen in shade).
- "tropical red leaf flush", "delayed greening young leaves", "Amherstia nobilis new leaves", "Brownea new
  leaves", "Saraca new leaves" (limp, hanging red, pink and bronze young leaves: the Flush and New Growth).
- "rainforest canopy from above drone", "tropical forest canopy aerial" (crown clumping, gaps, emergents, colour
  variety: the CPU lab's targets).

**Birds.** "cave swiftlet flight" (*Aerodramus*): small, dark, scythe-winged.
