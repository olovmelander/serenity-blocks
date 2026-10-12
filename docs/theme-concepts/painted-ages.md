# Painted Ages — theme concept and build document

| | |
|---|---|
| **Display name** | **Painted Ages** (alternates if vetoed: "Strata", "Danxia" (丹霞, "rosy clouds", the geological term for these landforms), "Bandlands") |
| **Proposed id** | `painted-ages` (unused anywhere in `src`, `docs`, `data`, `public`, `tests`, `scripts` as of 2026-10-11) |
| **Logline** (as revised in §3) | *A sea of rainbow-striped badlands in raking morning light, where every line you clear is laid down as a new layer of rock. Your game runs back into the distance as deep time, and rain brings out its true colours.* |
| **Status** | **Concept — not built** |
| **Date** | 2026-10-11 |
| **Seed** | "Painted Strata": Zhangye Danxia (Gansu, China), fused with Serranía de Hornocal (Jujuy, Argentina) and Landmannalaugar (Iceland) |
| **Scores** (0–10 per judge) | Art director **7.0** · Rendering lead **8.0** · Gameplay feel **7.5** · **Total 22.5 / 30** |
| **Rank** | **3rd of 6.** Rainbark 24.9 (built), Iris Springs 22.6, **Painted Ages 22.5**, Riverbloom 20.0, Haft Rang 19.9, Sunfall 19.2. Per lens: 4th on art, 2nd on rendering, 4th on play. |

> **How to use this file**
>
> 1. Start a new Claude Code session on the repo and give it the ready-to-paste prompt in
>    [PLAYBOOK.md §8](PLAYBOOK.md#8-a-ready-to-paste-prompt-for-the-new-session) (or the one in
>    [`docs/theme-concepts/README.md`](README.md), the folder index, if it carries its own), naming
>    this file as the concept to build.
> 2. Read [`docs/theme-concepts/PLAYBOOK.md`](PLAYBOOK.md) **first**. It holds everything that is
>    the same for every theme: choosing a slot (replace a theme or add one), the adapter and
>    director to clone, the rename and retirement procedure, the headless capture tooling for a
>    cloud container, and the CI gates. This file only adds what is specific to Painted Ages.
> 3. Reference snapshots of the existing fleet (text: setting, palette, FX, motifs to avoid) are in
>    [`docs/theme-concepts/reference/`](reference/) (`catalog.md`, `catalog.json`). The last fleet
>    captures are `docs/theme-screenshots/<id>.png` (shifting-sands, himalayan-peak, solar-eclipse
>    and mountain exist there; capture parhelion and rainbark from their playground effects with
>    PLAYBOOK §5's `shot.mjs`). Compare against shifting-sands, himalayan-peak, solar-eclipse,
>    parhelion and rainbark before porting anything.
> 4. **Precedence:** §3 (required changes) overrides §1 (the original proposal) wherever they
>    disagree. §5 (the build plan) already folds §3 in. §4 says what not to duplicate from Rainbark.
> 5. Follow `CLAUDE.md`: playground first, a screenshot and a clean console before calling any
>    WebGPU/TSL step done, and one small effect per session.
> 6. Gotcha numbers written `#NN` are line numbers in the gotcha table of
>    `.claude/skills/webgpu-threejs-tsl/SKILL.md` as of commit `585ab55`. If that file has
>    changed, search the table for the symptom quoted next to the number.

**Contents**

- [0. Origin: the research seed](#0-origin-the-research-seed)
- [1. The concept in full (original proposal, preserved)](#1-the-concept-in-full-original-proposal-preserved)
- [2. What the judges said](#2-what-the-judges-said)
- [3. Required changes before building](#3-required-changes-before-building)
- [4. Overlap with Rainbark](#4-overlap-with-rainbark)
- [5. Implementation plan](#5-implementation-plan)
- [6. Reference imagery to look for](#6-reference-imagery-to-look-for)

---

## 0. Origin: the research seed

The concept grew out of candidate #4 of a 33-candidate inspiration survey ("PAINTED STRATA";
alternates Danxia, Stratumlands, Rainbow Ridge). The survey ranked it **2nd of its top 5**:
"The best metaphor: cleared rows literally become geological layers painted in the blocks'
colours, so each session leaves its record on the land. The colour is rich and varied, the
heightfield is cheap, and golden hour gives strong form. Rain on four lines ('wet rock is more
vivid' is a real effect) makes a dramatic, earned payoff. It risks reading as 'another mountain
theme' if the stripes are not bold."

What the seed contained (kept here because the survey is not in the repo):

- **Facts:** ferric iron makes purplish and brick reds; ferrous iron makes grey-green and
  blue-grey; limonite gives yellow and chlorite gives sage. The layers were tilted by Tibetan
  uplift, and rain makes the colours noticeably richer.
- **Seed palette:** `#C2412E` ferric red, `#E5834B` apricot, `#F2C46B` limonite gold, `#F6E6C8`
  cream sandstone, `#74ADA0` chlorite sage, `#9B83B6` lavender grey, `#3A2E4D` plum shadow.
- **Seed scene:** foreground, a crisp ridge crest beside the board with a weathered boardwalk;
  midground, rows of sawtooth ridges striped with tilted bands, each silhouetted against the next;
  background, pale snow peaks in golden haze (dropped by the proposal, which uses the Chevron Face
  instead); light, raking golden hour with warm sunlit faces and lavender shadow faces; an optional
  Iceland variant with steam vents, black obsidian and green moss (the proposal adopted it as the
  basin).
- **Seed moves:** cloud shadows sweeping the ridges, a slow time-lapse sun drift, dust devils,
  sand veils off the crests, hawks circling, distant rain curtains.
- **Seed gameplay:** lock = a glint of sediment in the piece's colour settles on the ridge at the
  same height; clear = the row becomes a new stratum in the nearest ridge (a 1D `DataTexture`
  palette updated per clear); combo = tectonic uplift; four lines = a rain squall, wet
  saturation and a rainbow; T-spin = a dust devil carrying coloured sand.
- **Seed techniques:** domain-warped ridged-noise heightfield oriented as monoclines; strata from
  `dot(worldPos, tiltedNormal)` plus warp, sampled from the palette texture; triplanar erosion
  detail; aerial perspective and height fog; light-space cloud shadows; a wetness lerp (lower
  roughness, darker and more saturated albedo). Phone risk low to moderate (a 128² to 256² grid per
  tier).
- **Survey's similarity note:** low to moderate. Closest were mountain and himalayan-peak (cool and
  snowy), shifting-sands (warm desert), and the faint rock-strata value steps in Odyssey's
  terrain (`src/rendering/odyssey/world/odyssey-ground-palette.js`, `ODYSSEY_GROUND_STRATA`).
- **Fleet-wide finding that motivated it:** almost the whole roster is night, dusk or void, so "a
  high-key, mineral-saturated daylight or golden-hour palette is the biggest open slot", and no
  theme is "terrestrial-geological in daylight".

---

## 1. The concept in full (original proposal, preserved)

> This is the proposal as it was judged, with every number kept. It was written to take the
> slot of a theme being replaced (in this round that was Cosmic Chimes, a slot Rainbark now
> holds; see §4.3 and PLAYBOOK.md "Choosing a slot"). **Several items here are superseded by §3**:
> the golden-hour clock, the sand pours, sand veils and heat shimmer, the near sunshower, the
> silt veil from the card flanks, the spray-bow, the small-chain rainbows and the piece hexes.

### 1.1 Name, id, logline

- **Display name:** Painted Ages. **id:** `painted-ages`, registry group `biomes`.
- **Original logline:** *A golden-hour sea of rainbow-striped badlands where every line you clear
  is laid down as a new layer of rock. Your game runs back into the distance as deep time, and
  rain brings out its true colours.*

**The fusion.** **Zhangye Danxia** supplies the sawtooth hogback ridges and their wavy bands.
**Serranía de Hornocal** (Cerro de los 14 Colores) supplies the far range, whose dissected
flatirons make giant zigzags of colour. **Landmannalaugar** supplies the near basin: pastel
rhyolite with sulfur crusts, moss and a glassy obsidian flow, with steam vents breathing. One
coherent geological province is seen at the moment of the day when it looks its best.

**The core idea: the land is a timeline.** New strata are laid down beside the card. Every
older stratum steps one band further away, so looking deeper into the picture means looking
further back in your game. Everything the world does is a geological or weather process: grain
flow, deposition, folding, unconformity, flash flood, erosion, rain and ashfall. Nothing is a
spark that flies out and holds a colour.

### 1.2 The picture

**Painter's description (16:9 desktop, the reference frame).** We stand high on a crest of pale,
wind-scoured rhyolite at the very end of a clear afternoon. The camera is **140 m** above the
floor of the wash, pitched down **7°**, with a **42°** vertical field of view, so the horizon
sits about a third of the way down the frame.

- **Light.** The sun is out of frame, **9° up**, about **128° to the left** of the view
  direction, low over our left shoulder.
  - Every ridge is cross-lit. Faces turned to the left burn honey-gold. Faces turned to the right
    drop into lavender and violet shadow, lit only by the cobalt sky.
  - Down in the gullies the shadows warm again with orange bounce light off the sunlit red walls
    (the "reflected glow" of red-rock canyons).
  - Long cast shadows run to the right, each ridge laying its shadow across the next.
  - No sun disc, no god rays and no horizon sunset are in frame. The light itself is the subject,
    as it rakes over the surfaces.
- **Foreground (0–120 m).** Our crest runs across the bottom of the frame: cream regolith with
  wind ripples and a few camel-thorn shrubs. A weathered plank boardwalk with rope rails dips into
  the lower-left corner for human scale and a lead-in line toward the basin. Under the card the
  ground drops away into the wash, which lies in plum shadow, keeping the board's backdrop calm and
  dark-mid in value.
- **Left of the card (150–600 m): the Rhyolite Basin.**
  - A pastel knoll of cream, rose and sulfur-yellow rhyolite, with three to five fumaroles
    steaming white-gold in the low light.
  - Emerald moss in the shaded hollows.
  - A black obsidian lava tongue that glints like wet glass as it spills down into the wash.
  - Behind the basin the first hogback rises with its striped flank in full sun: the **left
    deposition front**, where new strata appear and where sand pours run.
- **Right of the card (near to far): the Ranks.**
  - Hogback after hogback recedes on a diagonal toward the upper right. Their strike runs about
    **35°** to the view, so they make perspective lines, not stacked horizontal silhouettes.
  - Each ridge is banded vermilion, apricot, gold, cream, sage, rose and lavender. The bands are
    wavy, cut into V-shapes by dense rills, and sharp-edged where they break the skyline.
  - The first ridge beside the card is the **right deposition front**.
  - A boardwalk staircase zigzags down one ridge in the middle distance for scale.
  - Pale braided gravel washes wind between the ridges: the channels the flash flood will fill.
- **Behind the card (9–11 km): the Chevron Face.** A range face **1.2 km** high, dissected by
  evenly spaced gullies into flatiron triangles. Its folded limestone beds read as huge zigzags in
  fourteen colours, held in the oldest, deep-time palette.
- **Sky.**
  - Deep, dry, high-altitude cobalt overhead (`#2B56B9`), easing to a pale turquoise-white at the
    horizon (`#D5E8EC`).
  - A faint warm glow lines the left edge of the frame, toward the off-screen sun.
  - Ahead and to the right lies the antisolar side, slightly brighter near the horizon.
  - Above the Chevron Face hangs a stack of **lenticular clouds** (a *pile d'assiettes*), glassy
    lens-shaped plates whose sun-facing rims glow rose-gold: the sky's own strata, rhyming with
    the rock.

**Why it has depth.**
1. **Overlap:** sawtooth crest lines step back in diagonal ranks.
2. **Texture gradient:** band frequency per screen pixel rises with distance. Near bands carry 10
   visible laminae; far ridges read as fine pinstripes; the Chevron Face reads as broad zigzags.
3. **Cast shadows:** each ridge's shadow on the next makes the spacing explicit.
4. **Valley haze:** warm dust pools in the washes with density `exp(-height/40 m)`, so every
   successive valley sits in a slightly thicker gold veil: layered depth without misty silhouettes.
5. **Aerial perspective:** gentle and dry, drifting toward the pale turquoise horizon. Far
   colours desaturate slowly, never to grey.
6. **Value contrast:** steam plumes white against lavender shadow; obsidian black against cream.
7. **Scale cues:** the boardwalks, shrubs and stairs.
8. **Wetness:** after rain the air is washed of dust. The haze thins, the view lengthens and the
   colours sharpen. Depth itself responds to play.

**21:9.** Vertical FOV **36°**. Left: the whole fumarole basin, the obsidian flow reaching the
frame edge, a second boardwalk spur. Right: more ranks and an ambient virga curtain trailing over
the far horizon. The Chevron Face widens behind. Card and HUD stay centred, flanked by the two
deposition fronts.

**Upright phone (aspect < 0.62).** The camera yaws **6° right** and pitches **−3°**, with a
**64°** vertical FOV; the horizon sits about **28%** from the top.
- **Above the card:** cobalt sky, the lenticular stack and the Chevron Face: where the rainbow,
  the sky strata of a perfect clear and the head of the flood are seen.
- **Below the card:** the near hogback flanks (the deposition fronts) and the steaming rhyolite
  basin: where sand pours land and new strata appear. On a phone, chutes are picked by board
  column instead of by row height.

### 1.3 Palette

**World colours (albedo unless noted).**

| Name | Hex | Role |
|---|---|---|
| Danxia Vermilion | `#C8432B` | ferric (hematite) red beds, the signature band |
| Apricot Sandstone | `#E6915A` | warm interbeds |
| Limonite Gold | `#EDBE5C` | yellow beds, sunlit crests |
| Bleached Cream | `#F2E2C2` | partings between strata, regolith, ash beds |
| Chlorite Sage | `#7DAA93` | ferrous grey-green beds |
| Rhyolite Rose | `#DD8E98` | Landmannalaugar pastel, Danxia "rosy" beds |
| Shadow Lavender | `#9686B8` | sky-lit shadow faces (light colour × albedo) |
| Plum Depth | `#3A2C4E` | deep gullies, the wash behind the card |
| Altitude Cobalt → Horizon Pale | `#2B56B9` → `#D5E8EC` | sky |

**Accents:** Sulfur `#E8D23A` · Moss Emerald `#4E9A3C` · Obsidian `#1D1A23` · Sunlight (light
colour) `#FFC877` · Rain-gold streaks `#FFE3A8` · Belt-of-Venus rose `#E9A4B4` · Earth-shadow blue
`#5E6E9E`.

The proposal claimed this territory unclaimed in the fleet: high-key golden daylight on a
multi-hue mineral palette under ultramarine. Not apricot dusk (shifting-sands), not amber
monochrome (golden-forest), not lavender sunset (nimbus-veil), not cobalt-and-snow (parhelion).

**What changes the look (world-native drivers, no hour wheel).**
1. **Dry ↔ Wet (driven by play).** Wetness `W` (0..1, varies over space) rises with rain and
   floods and dries by evaporation.
   - **Dry:** a chalky, high-key pastel land. Strata at about 70% chroma, faint dust haze, matte.
   - **Wet:** albedo **×0.65**, chroma **×1.35**, a glossy sheen on sunlit crests, small puddles in
     hollows reflecting cobalt sky, thinner haze, steam lifting as the land dries.
   - Sunlit faces dry first (**τ ≈ 35 s**), shadow faces later (**τ ≈ 70 s**), so a drying front
     follows the light. *Rain is how the player sees the true colours of their game:* the
     "mineralised" record colours return toward the exact piece hues when wet.
2. **The Long Golden Hour (the clock).** The sun never sets in play. Elevation breathes between
   **5° and 14°** over **7 minutes**; azimuth sways **±8°** over about **10 minutes**
   (incommensurate periods). At 14° the light is honey-gold `#FFD08A` with short lavender shadows.
   At 5° it is amber-rose `#FFAE7A`, with long violet shadows and only the crests burning.
   *(Superseded by "The Long Morning", §3.5.)*
3. **Formations (deposited lines / level).** Every **15 strata** (one level) close a formation.
   Each formation carries its own base mineral cast, and the tilts of older ones accumulate:
   - I Danxia red beds
   - II Rhyolite pastels
   - III Yacoraite chevron limestones (ochre, magenta-purple, green, cream)
   - IV Bentonite hills (lavender, blue-grey, cream)
   - V Copper series (turquoise, malachite, rust)
   - VI Gypsum whites (white, rose, gold)

   Over a long game the land becomes a stack of formations at different tilts. It never cycles
   back to an identical frame.
4. **Weather (the combo).** Clear, then building, then sunshower, then after-rain bow (§1.5).
5. **Sky strata (perfect clear).** The lenticulars take the record's colours.
6. **Last light (game over).** The sun drops to **1°**. The Earth's shadow and the Belt of Venus
   rise in the sky ahead, and the land goes blue-violet with rose crests.

### 1.4 Environmental animation (everything that moves)

| Element | Motion | Rate |
|---|---|---|
| Sun | elevation 5↔14°, azimuth ±8° (sinusoids, incommensurate) | 420 s and 610 s periods; ×4 during the game-over and restart transitions |
| Lenticular stack | shape stationary (standing wave); internal texture advects through it | flow 6 m/s left→right; rims breathe ±4% over 90 s; stack drifts 0.5 m/s |
| Lenticular shadow | soft patch on the Chevron Face follows the stack | follows the stack |
| Valley dust haze | noise advects downwind; density breathes | 1.5 m/s; ±15% over 60 s; ×0.4 when wet (rain washes the air) |
| Sand veils off crests | per-crest gust slots (hashed time windows) | one every 12–25 s per emitter, 3–5 s each, grains 4 m/s; **off when wet** *(removed in §3)* |
| Fumaroles (3–5) | plume rise, sway, puffs | rise 1.2 m/s, sway 0.15 Hz, puff every 6–14 s; density ×1.8 when wet |
| Drying steam | wisps off sunlit wet faces | rate ∝ W·sunlit, rise 0.6 m/s, 6 s life |
| Far virga | one ambient curtain crossing the far horizon (never over the near land outside a combo) | every ~150 s, 40 s crossing |
| Shrubs | shiver on gusts | 0.8 Hz, small amplitude |
| Heat shimmer | over dry, sunlit gravel washes (post UV offset) | 1.2 Hz noise; off when wet; High tier and up *(removed in §3)* |
| Puddles | shrink with W; rain dimples only while raining | follows W |
| Camera | breathing sway; pointer parallax (desktop, not touch, not reduced motion) | ±0.25°, 23 s / 31 s; parallax ±1.2° |
| Strata | **still between events.** Rock moves only when the game writes to it, which keeps every deposition step legible | — |

**Reduced motion:** sway and parallax off; veils and steam ×0.4; strata steps crossfade instead
of sliding; rain streaks ×0.3, and slower.

### 1.5 Gameplay event language (original)

**The grammar is sediment, water and time.** Locks pour loose sediment. Clears turn rows into
rock. Chains bring weather, and breaking a chain lets the sky reward you. Big plays flood, fold,
carve or tilt the land. Nothing flies out of the card into a store of light, no row blades or
one-front-per-line waves are used, there is no hush, no spiral round the card, no hour wheel and
no camera dip.

**Where colours come from.** `LINE_CLEAR` carries only row indices. The director therefore keeps
a three-free **shadow well**: a 10×24 grid of colour codes (Infinity rows keyed sparsely), filled
from each `PIECE_LOCK` snapshot (`shape` matrix, `x`, `y`, `color`) and collapsed on each clear.
A cleared row's laminae are the **real 10 cell colours, left to right**. Unknown cells (garbage,
a desync, local-MP gaps) fall back to a ring of recent lock colours. Garbage cells become
**obsidian laminae**, so garbage rows enter the record as black volcanic-glass horizons.
Meditation and Odyssey synthetic clears, which have no rows, use the current formation's base
minerals.

| Event | World verb | What you see | Scaling and readability |
|---|---|---|---|
| **Lock** | Grain flow | A ribbon of fine sand **in the piece's colour** spills over the lip of the nearest hogback beside the card (the chute whose crest point sits nearest the piece on screen; on a phone, the column picks a chute below the card). It pours down the sunlit flank in about **1.1 s**, grains glinting, while a soft lit haze lifts off its edges and drifts downwind, and spreads into a small fan at the foot. The fan is loose sediment, not a store of light: the next clear **buries** it under the new stratum (it fades in **0.6 s** as the band slides over it), or it weathers into the ground in about **12 s**. | Up to **12 fans**. Small, gravity-driven, calm: an hourglass trickle, comfortable at one lock per second. "My colour poured down the hill next to the board." |
| **Hard drop** | Slump | The crest at that chute shears. The pour is wider (**×1.6 plus distance/20**), a dust burst rolls up into the light, **6–12 rock chips** bound down the slope on closed-form ballistic hops, and the fan is larger. | Size grows with drop distance. No camera motion. |
| **Line clear ×1/2/3** | Deposition | Each cleared row becomes a stratum: **10 laminae** (its cells, mineralised) plus a cream parting. **Lowest row first, 0.15 s apart**, so the board's stack order is kept in the rock. Per row: **(a)** a veil of silt in that row's colours *sifts down* from the card flanks at the row's height onto the deposition front; **(b)** the **whole record across the landscape steps one band away from the viewer**: every stripe on every ridge glides one notch down-dip with a **0.9 s** ease; **(c)** the new band appears on the fresh face beside the card with a warm wet sheen that dries to rock in **2 s**. At 3 lines the near crests also shed sand veils. | Count the new bands to count the lines; their colours are your rows. The motion spans the landscape and has no front. |
| **Four lines** | Flash flood | At **0.15 s** a white-gold surge breaks at the canyon heads under the Chevron Face. Over **3 s**, **four braided streams**, each tinted by one cleared row's dominant colours, race down the washes toward the viewer. The water is opaque, silt-laden pigment with foam lit gold. **Ephemeral waterfalls** pour off the ledges of the near hogbacks either side of the card, like the red waterfalls of a desert storm; their spray carries a small spray-bow opposite the sun. From **4 to 10 s** the water drains, leaving glossy saturated washes and a thick **flood bed** (the four strata deposited at once, visible on the wash floors). Near-land wetness reaches **0.8**. | No hush, no white flash. "The land flooded with my colours." The biggest single moment. |
| **Combo (true combo): escalation** | The weather builds | **2:** the base of the lenticular stack darkens, a congestus billows over the Chevron Face, grey-violet virga with gold-lit tips. **3:** the virga reaches the far range as a rain shaft lit gold on its sun side; a cloud shadow crosses the far ridges. **4:** the shower reaches the middle distance; ridges under it go dark and jewel-saturated; first puddles glint. **5:** **sunshower overhead**, gold rain streaks across the frame, near ridges glisten. **6:** rills of water shine down the near gullies. **7+:** small falls off the near ledges; steam wherever the sun touches. | Rain comes closer and heavier each step. Saturated and bright, never grey. No lightning. |
| **Combo: release** (`combo(0)`) | The bow | Within **1.2 s** the rain thins and the curtain retreats right and back. From **0.6 to 2.5 s** **the rainbow blooms** over the right-hand vista, centred on the true antisolar point, legs landing in the valleys against dark wet ridges. Size follows the peak: **2–3** partial arc; **4–5** full primary; **6–7** double bow with Alexander's dark band and brighter sky inside the primary; **8+** supernumerary fringes and full wetness. The bow fades over **12–18 s**; the land dries over **45–60 s** with steam. | The reward lands on the release, so breaking a chain becomes a celebration. |
| **Back-to-back** | Folding | The newest strata near the card **buckle into chevrons** (Hornocal zigzags) over **1.2 s**, with a soft dust shrug along the near crests. Each B2B deepens the fold, **up to 4 steps**. The fold persists while the B2B chain lives; when the director infers a break (a wave-1 clear with fewer than 4 lines and no T-spin), the folds relax over **8 s**. | Persistent: "my back-to-backs bent the earth". |
| **T-spin** | Hoodoo | A striped pinnacle is **turned out of the slope** beside the card, on the T's side. In a **1.4 s** time-lapse, erosion strips the rock around it while its strata **twist round it like clay on a wheel**, then settle. **1, 2 or 3** cap stones for a single, double or triple (**18, 28 or 40 m** tall). It stands **25 s**, then crumbles in a dust slump. **Up to 3** at once. | A new landform; the spin is in its stripes. Nothing circles the card. |
| **Perfect clear** | Sky strata | The lenticular stack piles into a **tower of 9 plates**, each glowing in the colour of one of the last 9 strata, newest on top, rose-gold rims. The land below takes their coloured skylight. Holds **10 s**, then dissolves plate by plate from the top over **6 s**. | Standalone moment (arrives a frame after the clears). "The sky remembers the land." |
| **Level up** | Unconformity | The **whole existing record tilts 6° further** over **2.5 s**, like a slow page turn. A pale ash marker bed is laid as the base of a new formation with a new mineral cast (I→VI). Modes without `LEVEL_UP` (Infinity, MP) advance every **15 deposited lines**; `LEVEL_UP` resyncs. | Over a session the land shows angular unconformities. A geological progress record replaces the hour wheel. |
| **Game over / top-out** (window `gameOver`, `modeStopped`) | Ash seal and last light | A slow glittering ashfall settles a **white tuff bed** over the newest strata, sealing the game into the record. The sun sinks to **1°** over **6 s**: crests turn rose, washes fill with blue shadow, and ahead **the Earth's shadow and the Belt of Venus** rise over the Chevron Face (true view with the sun behind). On the next `modeStarted` the light returns over **4 s**. The sealed game marches away as new strata arrive. | Gentle, not punishing. Ash beds separate one game from the next. |
| **Idle / no play** | The land breathes | Sun drift, sand veils, steam, flow through the lenticulars, far virga. After about **90 s** without a lock the land is fully dry and afternoon haze thickens a little. In menus (no card visible) the camera drifts along the crest (**±4° yaw over 80 s**). | Beautiful on its own; nothing waits on the player. |

**Photosensitivity.** No full-frame flash; the brightest moments are the rainbow fading in, a
sheen and spray glints. Any exposure lift is capped at **+0.15** and at most **1 per second**
(combined with `max`, never added). No lightning. Rain streaks hold constant brightness. HDR is
clamped before bloom.

**Multiplayer.** All players deposit into one shared record, each in their own piece colours.
Chutes aim at each player's own board. The weather follows the maximum chain on screen.

### 1.6 Piece colours (original)

Pieces are named after **mineral pigments**, the colours this land is made of. Palette gate
**0/7** (hues by the gate's HSL method).

| Shape | Pigment | Hex | Hue | Guideline band (not matched) |
|---|---|---|---|---|
| I | Red Ochre (hematite) | `#D8452E` | 8° | cyan 160–210 |
| O | Azurite | `#3A6CD4` | 221° | yellow 32–75 |
| T | Turquoise | `#1FB3A6` | 175° | purple 245–315 |
| S | Orpiment (gold) | `#F0BE2E` | 45° | green 90–170 |
| Z | Lepidolite (lavender) | `#9B7AD6` | 262° | red 320–20 |
| J | Rhyolite Rose | `#EC8AA2` | 345° | blue 200–250 |
| L | Terre Verte (celadonite) | `#5DBB73` | 134° | orange 20–50 |
| GARBAGE | Obsidian | `#2A2630` | — | — |
| CLEAN_GARBAGE | Bleached Tuff | `#E6DCC8` | — | — |

- Claimed hue spacing every 40–50° with HSL-lightness separation from Turquoise (0.41) to Rose
  (0.73). *(§3.6 shows the perceptual lightness is nearly equal for T, J and L and that three
  pairs collapse under colour-vision deficiency; use the revised hexes there.)*
- **Cell look:** `renderMode: 'solid'` with the Phaser gradient, highlight, shadow and rim keys,
  as Ocean does. Each cell is a **polished slab of the mineral, lit by the world's sun**: warm
  highlight on the upper-left edge, lavender-tinted lower-right shadow, thin cream rim like a
  sandstone parting.
- **Stretch:** two faint horizontal laminae inside each cell, only if the board renderer can do
  it without per-frame cost.
- No glow, pulse or shimmer: ghost, hold, next and multiplayer views stay readable.
- **The world mineralises these hues** when it lays them into rock: mix **28%** toward the
  formation's rock tone, chroma **×0.85** when dry, with grain. Wetness restores them toward the
  exact piece colour, so bands look geological when dry and rain reveals your true colours.

### 1.7 Rendering plan (TSL, three r186, WebGPU and WebGL2)

House rules throughout: self-shaded `MeshBasicNodeMaterial`s, no scene lights, scene-linear HDR;
one sky function of direction; pure laid-out helpers; no `mx_noise`, **no `Data3DTexture` and no
`lut3D`** (every texture 2D); one packed vec4 `uniformArray` event table; closed-form, slot-based
events with `seek(t)`, and every pool always drawn with dormant slots; **one scene pass plus one
post pass**.

**1. Terrain bake** (CPU, at build, three-free, seeded `mulberry32`).
- A domain about **8 × 11 km**. Height is a **cuesta/hogback generator**: an asymmetric sawtooth
  profile across strike (gentle side and steep side), domain-warped ridged-noise relief, plus
  dense dendritic rill erosion on the slopes. Hand-placed hero forms: the near crest, the
  rhyolite knoll, the first hogbacks flanking the view, the Chevron Face.
- Outputs: **view-fan mesh positions** (dense near the eye, log-spaced outward, because the camera
  is nearly fixed); `RGBA8` normal+cavity map; `RGBA8` **horizon map** (horizon elevation for 1–4
  sun azimuths across the sway, for soft analytic shadows); `RGBA8` mask map (moss, sulfur and
  vent, obsidian, puddle basins); **flow accumulation**, giving wash channels as polylines for the
  flood, ledge points for waterfalls, and about **40 sand chutes** (downhill polylines from crest
  points on the near ridges); hoodoo and vent sites.
- Bake at **256²** (Minimal) up to **1024²** (Ultra/Extreme). Budget **40–120 ms**; can move to a
  worker later.

**2. Strata record.**
- `DataTexture` **16 × 512 `RGBA8` (32 KB)**, a ring buffer. Each row is one stratum. Columns 0–9:
  the laminae; column 10: the mean; column 11: the parting; column 12: properties (thickness
  scale, formation id, wet response).
- Prefilled with procedural base formations (deep time). A deposit writes one row and calls
  `addUpdateRange` (r186 `Texture.updateRanges`), falling back to a full 32 KB re-upload. That is
  effectively free. *(Checked against `node_modules/three` r186: only the classic `WebGLRenderer`
  honours `Texture.updateRanges`; `WebGPURenderer` ignores them on both backends, so every deposit
  is a full 32 KB upload via `needsUpdate = true`. Still effectively free; see §5.11.)*
- Strata older than the ring use an analytic **basement** function (a baked 1D palette strip).

**3. The strata function** (land material, inline builder `strataAt(P)`).

`z_s = dot(P, n_f) + warp(P.xz)·A + fold(P)`
- `n_f` is the current formation's tilted bed normal. Beds dip toward the viewer, so at equal
  height nearer means younger.
- `k = (Z_top − z_s)/h`, with `h ≈ 4 m`.
- Row = `(newestRow − floor(k)) mod 512`. Lamina = `fract(k)·12` (10 laminae plus 2 parting).
- **Anti-aliasing:** `fwidth(k)` (exported by `three/tsl`) blends laminae toward the mean, then
  the mean toward the neighbouring strata, so far ridges never moiré.
- **Formations:** a `Loop` over at most **6** rows (normal, base offset, row start), so angular
  unconformities are true discontinuities.
- **Folds:** `fold = A_b2b · smoothTri(dot(P.xz, strike)/λ) · nearMask`.
- **Deposition step:** the eased datum `Z_top` is integrated by the world, never computed as time
  × a changing rate.
- **Surface overlays:** dip-slope dust cover (gentle slopes pale, steep scarps clean bands);
  desert-varnish streaks (vertically stretched baked fBm); moss in shaded hollows, sulfur blooms
  round vents, obsidian (black albedo, sharp specular); lock fans (a `Loop` over at most **12**
  slots: radial tint, fading); flood-bed tint (channel mask × age), ash bed, wetness.
- **Lighting:** sun = Lambert with slight wrap (sandstone) × horizon-map soft shadow
  (`smoothstep(hz−p, hz+p, sunElev)`); sky fill = hemispherical, cobalt from above, warm ground
  bounce from below; cavity-weighted **red-rock bounce** in gullies; wet GGX-lite sheen (products,
  no `pow` of negatives); puddles reflect `skyColour(reflect(V, N))`, analytic, no render target.
- **Atmosphere:** dry aerial perspective plus warm valley haze `exp(-(y−floor)/40)`, with a faint
  antisolar opposition brightening.

**4. Sky:** house backdrop triangle at the far plane, drawn last among opaques.
- Analytic gradient, plus a warm glow toward the left edge.
- **Rainbow:** `θ = angle(dir, antisolar)`. Primary spectral ramp at **40.4–42.3°**. Secondary at
  **50.4–53.4°**, reversed, **×0.43**. Brighter sky inside the primary; Alexander's band darkened.
  Supernumerary `cos²` fringes on High and up. Masked by rain-curtain coverage. The same term is
  added as in-scatter in the land shader, weighted by the rain slab between eye and surface, so
  the bow's legs stand in front of the ridges.
- **Belt of Venus / Earth shadow:** an elevation band in the antisolar sky, driven by sun elevation.
- **Lenticulars:** **2–7** analytic ray–ellipsoid plates. Thickness feeds Beer extinction and an HG
  phase; edges eroded with baked 2D fBm; texture advects through a fixed shape. Plates take record
  colours on a perfect clear (the sky shader samples the record texture inline, never inside a
  laid-out `Fn`).
- **Storm deck and virga:** a growing flattened ellipsoid plus vertical streak noise below its base.

**5. Rain.**
- **Curtains:** **3–6** world-space vertical sheets with downward-scrolling streak noise, lit gold
  on the sun side, fading with height (virga).
- **Near sunshower:** an instanced capsule-strip pool in the vertex stage. Closed-form fall:
  positions hashed in a camera box, **9 m/s** with a wind slant; length from speed × exposure;
  brightness from the sun's phase; size floored at about one buffer pixel (#147); constant
  brightness per streak. *(Removed in §3: no camera-space rain.)*

**6. Flood.** Channel ribbons (triangle strips conformed to the terrain, raised along the normal,
drawn after the land with depth test). Front progress along arc length `s`; silt colours braided
per channel from the four rows; foam streaks scrolled along `s`; rim foam; a sun glint. **1–4**
waterfall sheets at ledge points with falling streak noise and a mist puff at the foot. Spray
from the shared pool.

**7. Air pool.** **One** instanced soft-quad pool serves dust, sand pours (particles following
chute polylines), silt veils, sand veils, ash, chips and spray. Kind, colour and start time are
integer-coded in a single `InstancedInterleavedBuffer` (keeps under the 8-vertex-buffer limit,
#99) and written only at event time. Motion is closed-form in the vertex stage.
**Steam:** **2–10** camera-facing noise sheets with Beer and HG lighting toward the low sun, faded
by height above the vent (no depth texture needed).

**8. Hoodoos.** An instanced lathe pinnacle with cap stones (**3 slots**). Growth is a vertex
displacement up from the ground. They use the **same `strataAt`**, so their bands match the land,
plus a decaying helical twist of the strata coordinate while they spin up.

**9. Post** (`painted-ages-post.js`, house pipeline). Scene pass with MSAA on High and up.
Max-channel knee bloom on Medium and up with a high (daylight) threshold: only wet glints, rain
highlights and spray bloom. Output pass: calm zones (soft clip over cards and HUD); heat shimmer
(High+, a 2-tap UV offset masked to dry sunlit low land, away from calm zones) *(removed in §3)*;
**"painted filmic"** hue-preserving tone map (knee about **0.55**, gentle shoulder, little
whitening, for high-key daylight); grade: warm highlights, lavender shadow lift, saturation
**1.06**; light vignette, low grain, dither. No shafts and no rush (the sun is off-screen): one of
the cheapest post stacks in the fleet.

**Quality tiers** ("every tier keeps the whole picture and every event"): see the revised table in
§5.10. **Estimated GPU time** at the tier's pixel ratio (iGPU-class guess, to be measured):
Minimal ~1.5 ms · Low ~2.3 ms · Medium ~3.5 ms · High ~5 ms · Ultra ~6.5 ms · Extreme ~8 ms. The
terrain fragment dominates (about 60%: 5–7 fetches and two small loops); sky ~0.3 ms; particles
0.5–1.2 ms depending on overdraw; flood ~0.3 ms only while it runs; post 0.6–1.1 ms.
(ADR-0016: perf claims need a verified instrument; treat these as targets.)

**Phone strategy.** Portrait framing from the composition module (`fovForAspect`, yaw +6°). The
view-fan mesh puts vertices only where the lens looks. No raymarching anywhere (clouds are
analytic plates, steam is sheets). Rain count scales with buffer area; sizes floored at a buffer
pixel. Low or Minimal tier plus the house pixel-ratio caps. The record texture is tiny and every
bake is 2D `RGBA8`, so there is no half-float target dependency in the scene. Capture portrait at
Low and Minimal before calling it done (#71, #135, #147).

**Risks on the WebGL2 backend.** Nested `select` with `Fn` inside (#89): fold all conditions into
one select. Keep every event row in **one** vec4 `uniformArray` (#102). Interleave instance
attributes (#99). Bound every `exp` term before masking (#71). No `pow` of near-negative bases
(#94). `fwidth` and vertex-stage `.level(0)` reads are fine on both backends.
`DataTexture.updateRanges` may fall back to a full upload (32 KB, acceptable). Validate
`forceWebGL=1` in the playground for every part.

**Module split** (mirrors the house; the full revised file table is §5.2):

```
src/themes/painted-ages/
  painted-ages-core.js          three-free: palettes, FORMATIONS, mineralise(), StrataRecord ring,
                                ShadowWell, sun path, cue timings, mulberry32/smooth/approach
  painted-ages-bake.js          three-free CPU: hogback heightfield, normals/cavity, horizon map,
                                flow accumulation → channels/ledges/chutes, sites, view-fan mesh
  painted-ages-tsl.js           shared uniform bag `u`, hashes, record sampler, strataAt(), light,
                                haze and skyColour() builders, texture factories
  painted-ages-sky.js           backdrop (gradient, rainbow, Belt of Venus, lenticulars, storm deck,
                                virga) + rain curtains
  painted-ages-land.js          terrain mesh + material (strata, folds, uplift, wetness, puddles,
                                fans, flood bed, ash, moss/sulfur/obsidian)
  painted-ages-water.js         flood ribbons + waterfalls
  painted-ages-air.js           shared particle pool, rain streaks, steam sheets
  painted-ages-hoodoo.js        T-spin spires
  painted-ages-world.js         PaintedAgesWorld (house WORLD_METHODS + onB2B, onGameOver)
  painted-ages-post.js          RenderPipeline + POST_LOOK + pass-through fallback
  painted-ages-director.js      ocean-director base + shape/cells + shadow well + B2B-break inference
  painted-ages-composition.js   layout rects (+ '#online-main-board canvas'), chute picking, framing
  painted-ages-quality.js       QUALITY / QUALITY_NAMES / tierFor
  painted-ages-theme.js         BaseTheme adapter (renderer, GPU loss, capture flags, calm zones)
  painted-ages-tetrominos.js, painted-ages-theme-icon.png
src/playground/effects/painted-ages.effect.js
```

- **Parts** for `?paintedAgesParts=`: `sky, land, water, air, steam, hoodoo`.
- **Playground parameters:** the house set (`event=lock|drop|clear|quad|tspin|perfect|levelUp`,
  `eventAge`, `lines`, `row`, `u`, `piece`, `combo`, `level`, `locks`, `board`, `quality`, `reduce`,
  `parts`, `bloom`, `noPost`, `falseColor`, `icon`…), plus theme-specific `wet=`, `sun=`,
  `formation=`, `release=<peak>` (rainbow), `b2b=<n>` and `gameover=1`. *(§5.5 renames the last
  three to the house form Rainbark uses: `event=release&peak=`, `b2b=`, `event=gameOver`.)*
- **Capture determinism:** the record is rebuilt from the prefill plus replayed events on `seek(t)`.

**Icon (original):** a striped hogback flank in raking gold light, a rainbow leg landing in a dark
wet valley, and a rose-rimmed lenticular in cobalt sky. *(§3 removes the rainbow leg.)*

### 1.8 Why it will be breathtaking, and why it resembles nothing in the roster

**Why breathtaking:**
- **The fleet's only high-key, mineral-saturated daylight world.** The roster is overwhelmingly
  night, dusk and void. This theme is bright, warm, crisp and colourful edge to edge, with the
  natural richness of one of Earth's most colourful landscapes. *(Rainbark, built since, is also a
  bright daylight world; see §4.2.)*
- **Raking light is the hero.** Lit flanks against lavender shadows give every ridge sculptural
  form; the slow sun drift makes the land feel alive without anything artificial moving.
- **It means something.** The land is your game laid out as deep time: the near hills show what you
  just did, the far hills show how you started, and ash beds separate your games.
- **The weather choreography is new.** A chain brings rain; breaking it blooms a physically placed
  rainbow over wet, jewel-bright rock. A four-line clear floods the badlands with rivers of your
  colours. A perfect clear stacks the sky into strata.
- **Grounded optics give quiet realism.** The bow sits at the antisolar point, wet stone saturates,
  the Belt of Venus rises at low light, the opposition effect brightens the land ahead, dust stops
  blowing when the land is wet, and sunlit faces dry first.

**The three closest themes and the exact differences (as proposed):**
1. **shifting-sands** (warm desert, sandstone mesas, golden ring on lock, spice blows): no dunes,
   no sand sea; hard banded rock badlands with hogbacks, flatirons, rhyolite and obsidian; dry
   cobalt sky, not apricot-to-rose dusk; sun off-frame behind us, not twin suns in frame;
   multi-hue mineral palette, not apricot and ochre; a deposition-and-weather grammar, no rings
   across the ground, no creature, no dust geysers.
2. **himalayan-peak / mountain / solar-eclipse** (peaks, layered ranges): no hero peak, no snow, no
   cloud sea, no alpenglow on ice; ridges are fully lit striped surfaces on a diagonal, never
   misty silhouette layers stacked horizontally; daylight, not dawn or totality; the combo brings
   weather, not sun elevation; the far range is a zigzag of colour, not a cut-out.
3. **chromatic-impasto** (the board "paints a permanent picture"): a lit 3D geological landscape,
   not a canvas; the record is a timeline that moves (buried, stepped away, tilted, folded,
   flooded, carved); no brush strokes, whorls, gold leaf or impasto; colours are mineralised and
   revealed by rain.

**Brushes, defused:** golden-forest (golden hour, but multi-hue with cobalt, no sun disc, no lake);
tornado (rainbow *ribbons* there; here a meteorological bow and no storm); verdant-hills (cloud
shadows there; here only the lenticular's shadow, no "clouds part" payoff); rainy-window /
voltage-storm (rain, but sunlit on bright land, no grey, no lightning); the mirror-water trope
(none: puddles are small, the flood is opaque and moving).

### 1.9 Top risks and mitigations (as proposed)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Reads as a candy "rainbow road"**: piece hues laid into rock look garish | Mineralise (mix 28% toward rock tone, chroma ×0.85 dry, grain), cream partings, base formations dominate mid and far, chalky dry default; rain is when colour peaks. Judge only through the tone-mapped pipeline, in false colour first. |
| 2 | **Reads as "another mountain or desert theme"** | Bold bands at every distance, diagonal ranks, cobalt sky, sun off-frame, Chevron zigzags, steam and obsidian accents. Review side by side with shifting-sands, himalayan-peak and solar-eclipse captures before porting. |
| 3 | **Moiré or shimmer on fine stripes**, worst at phone pixel ratios | `fwidth`-driven laminae→mean→neighbour blending, averaged basement far away, MSAA High+; capture Minimal at 390×844. |
| 4 | **Board readability** against busy stripes and global band motion | Calm zones; the wash behind the card is plum shadow at mid value; steps are 0.9 s eases only on events; reduced motion crossfades; nothing animates inside the card rect. |
| 5 | **Shadow-well desync** (garbage, cascades, Infinity, local MP) | Purely cosmetic. Unknown cells fall back to a recent-lock colour ring; reset on session reset; unit-test the well against the physics cascade order. |
| 6 | **Terrain cost and vertex count on phones** | View-fan mesh baked for a near-fixed camera; tiered vertex counts; analytic shadows from the horizon map; no raymarch or extra passes. |
| 7 | **Scope** (flood, hoodoo, folds, formations) | Build order: terrain/strata/sky/light → record and deposition → rain and bow → flood → folds, hoodoo, unconformity, sky strata, ash seal. Each stage shippable. One small effect per WebGPU session. |
| 8 | **Determinism and seek** with a mutable record texture | Record event log replayed from the deterministic prefill on `seek`; persistence off in capture mode. |
| 9 | **Flood ribbons float or z-fight** | Same bake heights; offset along the normal; drawn after the land with depth test; channels smoothed on the CPU. |
| 10 | **Rainbow and phone lens**: a direction-space cone stretches near frame edges (#153) | Physically correct, accepted. The bow is centred right of the card; on a phone mostly above it; check the arc radius in portrait captures. |
| 11 | **Photosensitivity** in long chains and fast cascades | No flashes, no lightning, constant-brightness streaks, exposure lifts at most once per second via `max` and capped; WCAG 2.3.1. |
| 12 | **Headless verification**: `Data3DTexture` fails in the cloud container's headless WebGPU | Every texture 2D `RGBA8` or a CPU-mipped half-float 2D. |
| 13 | **Odyssey context**: the replaced theme's Odyssey orb and chapter pool will show this theme | Map via the `RETIRED_THEME_IDS` alias; a bright badlands under a level name chosen for another theme is a tone shift to flag to the user (rename the orb as Rainbark renamed orb 47 to "The Painted Giants"). |

### 1.10 Reference facts used, and sources

- **Zhangye colours:** reds from ferric iron oxides (hematite); greens and greys from chlorite and
  reducing conditions; yellows from limonite. The beds were tilted into monoclines by the uplift
  that raised the Tibetan Plateau. They look most vivid after rain, when the surface darkens and
  contrast deepens.
- **Wet stone:** a smooth water film concentrates surface reflection into a narrow specular lobe
  and fills the micro-pits; the diffuse (coloured) subsurface light then dominates, so wet rock
  reads darker and more saturated.
- **Vinicunca:** red from iron oxide, green from chlorite, yellow from limonite and iron sulfides,
  white from quartz and carbonate sandstone; purple and brown attributions are uncertain.
- **Hornocal:** the "14 colours" are calcareous Yacoraite Formation layers, eroded at an angle into
  repeating triangular figures; best light in the afternoon.
- **Landmannalaugar / Brennisteinsalda:** silica-rich rhyolite coloured by iron (red), sulfur
  (yellow) and moss (green); the black Laugahraun obsidian field from the 1477 eruption; active
  sulfur vents and steam.

Sources: [WorldAtlas: Zhangye Danxia](https://www.worldatlas.com/articles/zhangye-danxia-national-park-china.html) ·
[GoAsia: Zhangye Danxia](https://goasia.cc/en/article/zhangye-danxia-national-geopark) ·
[TravelOfChina: Danxia landform](https://www.travelofchina.com/danxia-landform-description/) ·
[IntoTravelChina: Colorful Danxia](https://intotravelchina.com/en/attractions/zhangye_attraction/zhangye-colorful-danxia.html) ·
[Zhangye Geopark (official)](https://www.zhangyegeopark.cn/en/h-col-102.html) ·
[Explorersweb: Zhangye Danxia](https://explorersweb.com/natural-wonders-chinas-zhangye-danxia/) ·
[Atlas Obscura: Zhangye Geopark](https://www.atlasobscura.com/places/zhangye-national-geopark) ·
[Wikipedia: Vinicunca](https://en.wikipedia.org/wiki/Vinicunca) ·
[Kuoda Travel: Rainbow Mountain colours](https://www.kuodatravel.com/blog/how-did-rainbow-mountain-get-its-colors/) ·
[Rove.me: Hornocal](https://rove.me/es/to/argentina/hornocal-mountains) ·
[Billiken: Serranías de Hornocal](https://billiken.lat/interesante/serranias-de-hornocal-un-paraiso-multicolor-escondido-en-jujuy/) ·
[Todo Jujuy: Cerro de 14 colores](https://www.todojujuy.com/pais/el-magico-cerro-14-colores-jujuy-visitar-vacaciones-n252258/amp) ·
[Guide to Iceland: Landmannalaugar](https://guidetoiceland.is/travel-iceland/drive/Landmannalaugar) ·
[Perlan: Brennisteinsalda](https://perlan.is/articles/brennisteinsalda-volcano) ·
[Smithsonian Photo Contest: Brennisteinsalda](https://photocontest.smithsonianmag.com/photocontest/detail/brennisteinsalda/) ·
[askamathematician: wet stones](https://askamathematician.com/2012/06/q-why-do-wet-stones-look-darker-more-colorful-and-polished) ·
[Indiana Public Media: wet weather, brighter colours](https://indianapublicmedia.org/amomentofscience/we-weather-means-brighter-colors.php)

---

## 2. What the judges said

Three judges scored all six concepts independently, each from one lens, 0–10.

| Lens | Score | Rank among 6 | One line |
|---|---|---|---|
| Art director (beauty, originality against the 61-theme catalogue, wow, depth, lighting, still and motion, surprise, name) | **7.0** | 4th | Best landscape light and name, but golden hour next to shifting-sands. |
| Rendering lead (buildable in three r186 TSL on WebGPU and WebGL2, phone/iGPU cost, procedural, compile cost, readability; look per millisecond) | **8.0** | 2nd | Opaque terrain, analytic sky and the cheapest post of the six. The main risk is the terrain *shape*. |
| Gameplay feel (lock, clear, combo, four lines, T-spin, perfect, level; readability at 1–3 locks/s; novelty; photosensitivity; 20-minute feel) | **7.5** | 4th | Strongest "game as record" idea and a clever rainbow on release, but lock and clear, its two most frequent beats, are its least visceral. |

### 2.1 Art director: 7.0 (4th)

**Strengths.**
- **The strongest form-giving light of the landscape concepts:** raking light, honey flanks
  against sky-lit lavender shadow faces, and red-rock bounce in the gullies.
- **The composition avoids the stacked-silhouette cliché.** Ridges recede in diagonal ranks, and a
  Hornocal chevron face stands behind the card.
- **The sky rhymes with the land:** a lenticular stack forms "sky strata" above the rock strata.
- **The best metaphor:** the land is your game as deep time. The whole record steps one band away
  on every clear, a novel motion across the whole landscape with no front.
- **Wetness reveals your true colours.**
- **The name is strong and descriptive.**

**Weaknesses.**
- **The Long Golden Hour sits in the fleet's most overused light.** The research lists the
  "gold/peach low sun with lavender" palette as taken. (Golden hour is used by halcyon, himalayan,
  sunset, summer, fall, tornado, golden-forest, waves, shifting-sands, nimbus and sky-children.
  "High sun or morning daylight is the open slot. Painted Ages is the only concept that stays at
  golden hour.")
- **Heavy overlap with shifting-sands:** warm sandstone, violet shadows, sand veils off the crests
  (spindrift there), heat shimmer and an escarpment. At thumbnail size it risks reading as "the
  other warm desert".
- **Rows written into the world as stripes already exist** in stellar-drift (latitude streaks) and
  astral-weave (weft threads); chromatic-impasto's avoid list names "the board paints a permanent
  picture".
- **The rock is still between events,** so this is the weakest landscape in motion.
- **The rainbow is again a payoff,** and saturated piece-colour bands risk candy stripes.

**Worth grafting (from Painted Ages into a winner).** The shadow well (the real colours of a
cleared row's cells, left to right); the record stepping away as deep time; wetness that
saturates; B2B as folding that persists while the chain lives; level up as an unconformity tilt;
the ash-bed seal plus the Belt of Venus at game over; the lenticular "sky strata" perfect clear;
raking light with sky-lit lavender shade plus coloured bounce.

**Verdict line:** "Painted Ages has the best landscape light and name, but sits in golden hour next
to shifting-sands."

### 2.2 Rendering lead: 8.0 (2nd)

**Strengths.**
- **Almost entirely opaque.** One view-fan terrain mesh (18k–240k vertices) plus a far-plane
  analytic sky. Lenticulars are analytic ray–ellipsoid plates inside the sky, with no marching. The
  post has no shafts, rush or fringe: the cheapest of the six. Credible estimates: Minimal ≈ 1.5
  ms, High ≈ 5 ms.
- **The strata function is pure shader home ground.** A dipping-plane coordinate plus a warp gives
  a row lookup into a 16×512 RGBA8 record ring. The AA plan is `fwidth(k)`: laminae blend to the
  stratum mean, then the mean blends to its neighbours. "It is the only concept that tackles its
  moiré problem properly up front."
- **Lighting is cheap and proven.** Raking light uses a horizon map, which Shifting Sands already
  proved (`src/themes/shifting-sands/shifting-sands-terrain.js` marches a horizon tangent per
  sub-grid vertex, so lower suns cast longer shadows for free). Cavity term, red-rock bounce, wet
  GGX-lite sheen; puddles reflect the analytic sky.
- **Events are mostly uniform writes into one shader:** the record step is one eased datum; folds
  and tilts are uniforms; wetness is a single parameter (albedo ×0.65, chroma ×1.35, sheen up),
  "a huge visual payoff for nothing"; the rainbow is analytic in the sky plus a rain-slab-weighted
  in-scatter on the land so the bow's legs stand in front of ridges.
- **No volumetrics, no extra RT, all 2D RGBA8 textures:** the safest headless and WebGL2 profile.

**Risks.**
1. **Terrain shape is the single point of failure.** Under-delivered, it becomes generic
   ridged-noise hills with candy stripes. The hogback/cuesta sawtooth is simple; the *rills* that
   cut the bands into V-shapes are what make Danxia and Hornocal read, and procedural dendritic
   erosion is real work. Budget a playground session for the heightfield alone. Ship the bake as a
   small PNG, or move it to a worker, so the 40–120 ms build does not land at theme start on phones.
2. **Horizon-map resolution** (about 10 m texels at 768² over 8 km) gives soft near cast shadows:
   fine at 150–600 m. If the near crest needs crisp shadows, add a finer local patch.
3. **Flood ribbons conformed to terrain** risk z-fighting: same bake heights, a normal offset and a
   small depth bias.
4. **The formation `Loop` (≤6) plus the fan `Loop` (≤12)** make a large land fragment. Keep helpers
   laid out and pure, and gate the size with the `--shaders` capture.

**Graftable (as the judge ranked them for a winner):** #3 the `fwidth` mean-blend AA; #4 wetness as
one global material parameter (albedo ×0.65, chroma ×1.35); #8 the analytic bow plus slab
in-scatter, "if any winner shows a bow, rather than particle-only bows".

**Verdict line:** "Painted Ages is equally cheap and fully opaque, but it rests on procedural
badlands terrain, which is a harder art problem."

### 2.3 Gameplay feel: 7.5 (4th)

Frequency weighting used by this judge: a 20-minute session has roughly **600–900 locks,
150–250 clears, 10–40 four-line clears**, a few T-spins and almost no perfect clears. Lock and
clear set the feel; four lines and perfect clears are the remembered moments.

- **Lock (grain flow):** calm, but "a fine trickle of colour on a striped ridge is the
  lowest-contrast lock here".
- **Clear (deposition):** each row laid down as a stratum whose laminae are the actual 10 cell
  colours is "the strongest 'your game becomes the world' idea on the table". However the beat
  itself is a **0.9 s global** step of every stripe on every ridge, repeated **150–250 times a
  session**; it is a large-area motion behind and beside the board; its payoff is intellectual
  ("the record moved a notch"), not visceral.
- **Four lines (flash flood):** four braided streams tinted by the cleared rows, ephemeral
  waterfalls and a spray-bow. "Excellent."
- **Combo:** rain approaches one step per link (spatially readable). Breaking the chain blooms a
  rainbow sized by the peak chain. "**Rewarding the release is the cleverest combo idea in the
  set.**" Weakness: the combo break reaches the theme **one lock late**, so the main payoff lands
  on the lock after the one that broke the chain.
- **The rest are strong and persistent:** B2B chevron folds that stay; a T-spin hoodoo whose strata
  twist; the perfect clear's lenticular stack in the record's colours; the level's unconformity
  tilt; the game over's ash bed and Belt of Venus.
- **Overall:** weakest on the two most frequent beats, so the minute-to-minute feel is the flattest
  of the top four.

**Grafts this judge proposed from Painted Ages into others:** a bow (or fogbow) on release, sized by
the peak chain; real cell colours via the shadow well; a persistent B2B landform; an ash or white
sinter bed between games.

**Grafts this judge proposed from others, relevant here:** a discrete per-link counter (one new
shaft, splash or column per link); the lock spanning the piece's rows; native anticipation instead
of a hush; a saturation lift instead of exposure flashes; a T-spin record that lasts the level.

**Engineering note (all concepts):** `PIECE_LOCK` and wave 1's `LINE_CLEAR` are emitted in the same
synchronous tick, so the director can infer at `flush()` that a lock with no clear in the frame
breaks the chain and deliver `combo(0)` on the breaking lock itself. "This matters most for
strata's rainbow."

### 2.4 Slate-wide findings that apply to this concept

From the art director, affecting every score:
1. **The rainbow has become the slate's own cliché.** Three concepts made a physically placed bow a
   headline payoff (Iris, Painted Ages, Sunfall), and the fleet already has rainbow motifs in
   tornado, chromadelic-highway and singing-bowl. "Use the bow at most once, as a grace note, never
   as the signature."
2. **Almost every lock is still a softened "the world holds the colour".** Something in the piece's
   colour appears beside the card, then fades over 18–90 s; Painted Ages' fans are named.
3. **Composition template.** Every concept puts a hero on the left and a secondary on the right,
   the template the catalogue asks us to break.
4. **Lighting slot.** Golden hour is the fleet's most overused light; Painted Ages is the only
   concept that stays there.

And the closing instruction, "whatever wins": use the rainbow no more than once; keep decay
world-native (bleach, green, ripen), never "held then released"; source a clear's colours from the
real cells of the cleared row.

### 2.5 Why it did not win

Rainbark scored 24.9 and was built. Painted Ages finished 0.1 behind Iris Springs. The rendering
lead called it "the strong runner-up" on cost; the art and play lenses held it back on golden hour,
shifting-sands overlap, motion between events, and its low-contrast lock and intellectual clear.
Rainbark grafted five of its ideas (§4.1).

---

## 3. Required changes before building

Build the version described by this section, not the original. Each row is a judge's named
weakness and the concrete fix. §3.4–3.6 restate the event language, light, ambient motion and
piece colours with the fixes applied, so a builder has one authoritative version.

### 3.1 Every named weakness, and its fix

| Judge | Weakness | Fix |
|---|---|---|
| Art | Golden hour is the fleet's most overused light; "gold/peach low sun with lavender" is taken | **The Long Morning** (§3.5). Sun **12°–22°** up, still behind-left (~128° from the view in the proposal; the base azimuth is now solved per layout, about 114°–140°, so the bow lands in frame: §3.3 #11) so the cross-light, long shadows and red-rock bounce survive. Light colour **`#FFE6C4` at 12° → `#FFF3E0` at 22°** (warm white, not honey). Deeper cobalt overhead. Gold and rose appear only in the brief game-over low light. |
| Art | Heavy overlap with shifting-sands: warm sandstone, violet shadows, sand veils (its spindrift), heat shimmer, escarpment; "the other warm desert" at thumbnail size | Remove **sand veils** and **heat shimmer** entirely. The lock is a **scree run** of rock grit and chips, never a sand pour (§3.4). White morning light, not dusk. Landmannalaugar accents (white steam, black obsidian, emerald moss, a braided meltwater stream) visible in **every** layout. **Thumbnail gate:** a 128×72 downscale of shot 1 must show ≥4 distinct band hues on the near ranks (CIEDE2000 ≥ 15 between neighbours), the cobalt sky, white steam and black obsidian, and no peach/ochre region over 50% of the land; review it beside `docs/theme-screenshots/shifting-sands.png` (or a fresh capture) and its catalogue entry in `docs/theme-concepts/reference/catalog.md`. |
| Art | Rows as stripes exist in stellar-drift (latitude streaks) and astral-weave (weft threads); chromatic-impasto's avoid list names "the board paints a permanent picture" | The record is **geology, not a picture**: every band carries grain, desert varnish and the V-cuts of rills (the "rule of Vs", §5.7); dip slopes carry a dust cover that mutes the bands; bed thickness varies; the record recedes, is buried, tilted and folded. No band ever appears at a cleared row's screen height on a surface beside the card, and nothing mirrors the board. |
| Art | "The rock is still between events": the weakest landscape in motion | Keep the rule that **strata** move only on events, and add world-native motion around them (§3.5): **6–10 fumaroles** with at least 2 plumes visible in every layout; a perceptible **shadow crawl** (azimuth ±6° over 150 s); **far showers** always walking somewhere beyond the 4th rank; a **braided meltwater** stream in the basin with flowing glints; the existing lenticular flow and haze drift. |
| Art | The rainbow is again a payoff | The bow is used **once**: only as the combo **release**, and only for peak chains **≥ 5**. The four-line spray-bow is removed; the icon has no rainbow. Smaller releases get "the sun returns" (§3.4). |
| Art | Saturated piece-colour bands risk candy stripes | Keep mineralisation (28% toward rock tone, chroma ×0.85 dry, grain) **plus** a measurable rest-frame rule: on a dry rest frame the mean band chroma is **≤ 0.6×** the piece colours' chroma, and in `falseColor=1` no dry land exceeds the bloom knee. Judge only through the tone-mapped pipeline. |
| Tech | Terrain shape is the single point of failure; procedural rills are real work | **Stage A0 CPU lab** (§5.6) before any shader: prototype the hogback heightfield with stream-power rill erosion in numpy, render it from the real camera, and compare against reference photos. Then **Stage A1** is a heightfield-only playground session with flat shading (`view=shade`). Acceptance is the §5.7 checklist. |
| Tech | The 40–120 ms bake lands at theme start on phones | Measure on the Low tier. If the synchronous seeded bake is ≤ 40 ms, keep it. Otherwise ship a precomputed binary (`src/themes/painted-ages/assets/painted-ages-terrain.bin`, loaded with `new URL('./assets/…', import.meta.url)` as `src/themes/winter/winter-ghosts.js` loads `snow-ghosts.bin`, which `scripts/winter/bake-ghosts.mjs` writes; a `scripts/painted-ages/bake-terrain.mjs` reusing `painted-ages-bake.js` would follow that precedent), with a synchronous 128² fallback bake so the first frame still shows land; or move the bake to a Worker. Never fetch with an absolute path (theme tests ban `'/assets/…'`). |
| Tech | Horizon map ~10 m texels at 768² over 8 km gives soft near shadows | Add a **near horizon patch**: 512² over the nearest 1.5 km (~3 m texels) on Medium and up, blended into the far map by distance. |
| Tech | Flood ribbons z-fight | Same bake heights; offset **0.3–0.6 m** along the normal; `polygonOffset` depth bias; drawn after the land with depth test; channels smoothed on the CPU. The braided meltwater ribbons use the same recipe. |
| Tech | Formation `Loop` (≤6) + fan `Loop` (≤12) make a large land fragment | Laid-out pure helpers only; loop ends are live counts (`u.formationCount`, `u.fanCount`); the fan loop runs inside `If(nearMask)`; textures stay out of laid-out helpers (#93). Gate the land module's WGSL with the capture script's `--shaders` report and keep it under ~100 KB (a 20-call inline simplex lake reached 113 KB, and a JS-unrolled loop produced a 135 KB `main()`; both are in the gotcha table). |
| Play | The lock is the lowest-contrast lock in the slate | **Scree run on a pour lane** (§3.4): the coloured grit lands on a pale, dust-covered, unbanded dip slope (Bleached Cream, chroma ≤ 0.1), so it reads against neutral ground. On screen the run is **≥ 1 cell wide** and **≥ 4 cells long** (floored, #147); its head sits at the piece's screen height where a chute allows; **3–5 chips** bounce; the fresh grit is **+12%** luminance for **1 s**. |
| Play | The clear is a 0.9 s global step ×150–250 a session, large-area motion, an intellectual payoff | Make the beat **visceral and local**, and the global motion **small**: a wet **slurry sheet** in the row's colours slides down the deposition front from the crest and **settles** with a dust shrug and a sheen; the near record (≤ 1.5 km) slides one band in **0.6 s** with a **3%** overshoot (a settle); beyond 1.5 km the shift is a **0.3 s crossfade** (far bands are sub-pixel); the land seen through the card rect never animates. |
| Play | The combo break reaches the theme one lock late | The director infers the break at `flush()` and sends `combo(0)` on the breaking lock. **Copy `src/themes/rainbark/rainbark-director.js`**, which already does this (and the shadow well, the B2B level with break inference, the local-MP cascade stash and hard-drop distance). Themes are islands, so copy it into the new folder; do not import it. |
| Play | Weakest on the two most frequent beats | The two fixes above, plus a **discrete per-link combo beat** (one more rank goes wet per link, §3.4), so the minute-to-minute feel has a countable rhythm. |

### 3.2 Cross-cutting findings, applied

| Finding (slate-wide) | How it applies here | Fix |
|---|---|---|
| The rainbow is the slate's own cliché; use it at most once | Original used it on every release (from peak 2), in the quad spray, and in the icon | Release only, peak ≥ 5 (§3.4). Nowhere else. |
| Decay must be world-native, never "held then released" | Lock fans faded in 12 s (a softened hold) | A fan is **loose sediment that stays** until the next clear **buries** it: it is incorporated into the new stratum as the band slides over it (0.6 s). Beyond 12 fans the oldest merges into a neutral talus tint over 2 s. Wetness dries by evaporation (sunlit faces first). Hoodoos crumble. The bow fades as the curtain dissolves. No glow is ever stored and released. |
| A clear's colours come from the real cells of its row | Already the concept's shadow well | Keep; implement by copying Rainbark's director (`rowCodes`, 10 codes per row, lowest row first). |
| Infer the combo break on the breaking lock | The release is this concept's main combo payoff | Rainbark director rule (c) (the director row of [`rainbark.md`](rainbark.md) §7, and the header of `src/themes/rainbark/rainbark-director.js`): a slot with a staged lock, no staged clear and a reported combo > 0 sends `combo(0)` now; the tracker's later 0 is suppressed; a late clear before the next lock resumes the chain. |
| Avoid the house FX grammar ([`reference/catalog.md`](reference/catalog.md), "Gameplay-FX grammar the rebuilt fleet already shares") | See the checklist below | Every row passes after the §3.4 fixes. |
| Composition template: hero left, secondary right | Original: Rhyolite Basin left, Ranks right, two deposition fronts flanking the card | Read the frame as **one diagonal sweep**: the near crest under the boardwalk at lower left, ranks crossing behind the card and receding to the upper right (strike 35°). The basin is a **low foreground pocket**, never a flank hero mass: its top stays below 40% of frame height on 16:9. The two fronts sit at **different depths** (left front nearer and lower, right front farther and higher). |
| Lighting slot: golden hour is overused | Original "Long Golden Hour" | The Long Morning (§3.5). |

**House FX grammar checklist** (the fleet's ten habits, as listed under "Gameplay-FX grammar the
rebuilt fleet already shares" in [`reference/catalog.md`](reference/catalog.md); research.md's
"one shared gameplay grammar" note in [`reference/research.md`](reference/research.md) says the
same):

| # | House habit | Painted Ages after §3 |
|---|---|---|
| 1 | Lock emits light/particles from the card edge at the piece's height in the piece colour | Passes: the scree starts at a world chute head on a deposition front and never starts in or crosses the card rect + 0.5 cell margin. |
| 2 | A ring runs out from under the board's foot | Passes: no rings. |
| 3 | The world holds the piece colour ~30 s, a clear releases it | Passes: fans are buried into the stratum, never released as light. |
| 4 | Clears send blades of light at the row heights, or twin jets from both card edges | **Original failed** (silt veil "from the card flanks at the row's height", the same form the art judge marked down in Riverbloom's sluice). Fixed: the slurry comes down from the front's crest, a world location independent of row height. |
| 5 | One wave front per cleared line | Passes: the record step has no front; the four flood streams are per row but run down existing washes as rivers. |
| 6 | Four lines "holds its breath" (0.2–0.33 s hush), then a flare | Passes: the surge breaks at 0.15 s with no darkening. |
| 7 | T-spin = a spiral or wheel round the card | Passes: the hoodoo twists about its own axis beside the card. |
| 8 | Level up turns the hour | Passes: unconformity tilt; the sun clock never steps on level. |
| 9 | Hard drop = camera dip | Passes: no camera motion on any event. |
| 10 | Combo = one world-scale dial | Mitigated: the weather is a world dial, but each link is a discrete, countable wet rank. |

### 3.3 Issues found while writing this document (not raised by the judges)

| # | Issue | Fix |
|---|---|---|
| 1 | **Piece colours collapse under colour-vision deficiency.** Simulated with the Machado 2009 matrices at full severity in linear sRGB, distances in CIEDE2000: protanopia T–J **6.4**, O–Z **7.5**; tritanopia T–L **3.7**; deuteranopia J–L **10.3**. The proposal's "lightness separation" was HSL lightness; perceptually T, J and L sit at CIE L* **66, 68, 69**. (For comparison, Rainbark's worst pair by the same method is 11.4.) | Use the revised palette in §3.6 (worst pair **13.2**, gate still 0/7), then re-check it against the board background and both garbage colours, and run `npm run check:palette`. |
| 2 | The original clear's silt veil left the card flanks at the row's height: house grammar #4 | Fixed in §3.4 (slurry from the crest). |
| 3 | The original combo step 5 "sunshower overhead" with gold streaks across the frame collides with **Rainbark's B2B "Sunshower"** (in-lens drops glinting in sunflecks) | No camera-space rain anywhere. Rain exists only as world-space curtains ≥ 150 m away, with streak texture inside the curtain volumes. Never use the word "sunshower". |
| 4 | parhelion's avoid list includes "cobalt-and-gold daylight" (its snowfield sits under cobalt sky with gold light) | The Long Morning's warm-white light plus multi-hue rock clears it; never add snow, ice, halos or a monolith. |
| 5 | voltage-storm's avoid list includes rain and storm clouds; rainy-window's includes grey storm palette and rain streaks | The storm deck stays a far congestus over the Chevron Face, never a ceiling; at every combo step at least **60%** of the sky stays clear cobalt and the sun keeps shining on the dry ranks; curtains are grey-violet with sunlit edges; no lightning, no grey palette. |
| 6 | pyrestorm's avoid list includes ash; himalayan-peak's includes alpenglow pink/gold | Tuff and ash beds are white, quiet sediment (no embers, no volcano, no red). The rose crests of the game-over low light are brief and muted (crest tint ≤ `#E9A4B4` at 40% mix). |
| 7 | Garbage is not on the bus, so the shadow well cannot tell garbage from "never seen" | Use Rainbark's director rule: cells the well never saw are code 7; a wholly unknown row is dealt from the last 8 lock codes. Painted Ages renders code-7 cells in a partly known row as **obsidian laminae** (most such cells are garbage). |
| 8 | Rainbark's director caps the B2B level at 3 (`MAX_B2B = 3`); the concept folds up to 4 steps | In the copied director set `MAX_B2B = 4`, or map 3 levels onto the 4 fold amplitudes. |
| 9 | The braided meltwater added in §3.1 must not become the mirror-water trope | Shallow braids over gravel: glints and sky tint only, no reflection of ridges, channels 3–8 m wide, never a sheet across the bottom of the frame. |
| 10 | Tornado's avoid list includes "amber storm light" | Curtains' sun-side edges are pale gold-white, never amber; the land under rain is jewel-saturated, not orange-lit. |
| 11 | **The bow's geometry against the framing (found by the doc verifier).** With the sun 128° left of the view axis, the antisolar point is **52° right** of it and 12°–22° below the horizon: outside the 16:9 frame (horizontal FOV ≈ 68.6°, so ±34.3°), and the arcs' tops (20°–30° above the horizon) are above the frame top (≈ 14° at pitch −7°, vertical FOV 42°). So only the **left legs** of the bows are in frame. Measured at the horizon with the sun at 12°: primary legs at az **11–13°** right, secondary (50.4°–53.4°) at **−0.4° to +2.7°**. At 1920×1080 the card's half-width is about **7.2°** (stylesheet fallback layout: board 300 px, card ≈ 1.19 × board), so the peak 6–7 secondary and Alexander's band would sit **behind the card**. On a 390×844 portrait (yaw +6°, horizontal FOV ≈ 32°, az −10° to +22°), at 20° elevation above the card the primary lies at az ≈ 27°, off the right edge. | Solve the **base sun azimuth per layout** in `painted-ages-composition.js` (`solveSunAzimuth(layout, aspect)`): pick the azimuth (clamped to 105°–145° left) so that, across the whole ±6° sway and at sun 12° and 22°, the above-horizon parts of both bows stay outside the card/HUD rects + margin and inside the frame. Rough spherical-geometry estimates with card + margin ≈ 8°: **≈ 114°–116° left at 16:9** (antisolar ≥ 64°–66° right); **≈ 140° left on portrait** (antisolar ≈ 40° right puts both arcs above the card). The cross-light stays raking from behind-left either way. Below the horizon the legs may pass behind the card (calm zones hide them). Verify with acceptance shot 12 at D and P. |

### 3.4 The revised event language (authoritative; replaces §1.5's table)

Grammar unchanged: **sediment, water and time.** Zones used below, far to near: **CF** = the
Chevron Face (9–11 km), **R5…R1** = hogback ranks (about 6, 4, 2.5, 1.5 and 0.8 km), **R0** = the
two deposition fronts (150–600 m).

| Event | World verb | What you see | Scaling, readability, safety |
|---|---|---|---|
| **Lock** | Scree run | A short run of rock grit and chips **in the piece's colour** slides down a chute on the nearest deposition front's **pour lane** (a pale, dust-covered, unbanded dip slope). Chute = the one whose head is nearest the piece's centroid on screen, outside the card/HUD rect + 0.5 cell; on a phone the board column picks a chute below the card. **1.1 s** descent; **3–5** small chips hop on closed-form ballistic arcs; a dust plume lifts and drifts downwind; fresh grit **+12%** luminance for **1 s**. It comes to rest as a small **talus fan** that stays until buried (§3.2). | ≥ 1 cell wide, ≥ 4 cells long on screen. Up to **12 fans**. Comfortable at 1–3 locks/s. Reduced motion: no chips, 0.6 s run. |
| **Hard drop** | Slump | Same chute; the crest shears. Run **×1.6 + distance/20** wider, a dust burst, **6–12** larger chips, larger fan. | Dust-burst brightness rate-limited to 1/s. No camera motion. |
| **Line clear ×1/2/3** | Deposition | Per cleared row, **lowest first, 0.15 s apart**: **(a)** a wet **slurry sheet** carrying the row's 10 cell colours (left to right across its width, mineralised) slides down the fresh face of a deposition front **from the front's crest**, **0.45 s**, and settles with a dust shrug; **(b)** the new bed shows a wet sheen that dries to rock in **2 s**, **+10%** luminance for **1 s**; **(c)** the record steps one band down-dip: near (≤ 1.5 km) slides in **0.6 s** ease-out with **3%** overshoot, far is a **0.3 s** crossfade; the land behind the card rect never animates; **(d)** fans on that front are buried into the bed. At 3 lines the near crests shrug rock dust (no sand veils). Alternate fronts per row when both are on screen. | Count the settling sheets to count the lines; their colours are your rows; the stacking keeps board order. Cascade waves deposit as each wave arrives. |
| **Four lines** | Flash flood | As §1.5: surge at **0.15 s** under the CF; over **3 s** four braided streams (one per row's dominant colours) race down the washes toward the viewer, opaque silt-laden pigment with gold-white foam; **ephemeral waterfalls** off the near ledges; **no spray-bow**; drain **4–10 s**; a thick **flood bed** remains; near-land wetness **0.8**. The braided meltwater joins the flood and runs silt-coloured for 20 s. | No hush, no white flash, no exposure lift: the payoff is saturation and motion. |
| **Combo escalation** (true combo) | The weather walks in | Combo **n** wets **n − 1** zones, far to near: **2** → congestus and virga over the CF, the CF goes wet; **3** → R5; **4** → R4; **5** → R3, first puddles glint; **6** → R2, rills shine down its gullies; **7** → R1; **8** → R0, small falls off the near ledges, steam where the sun touches; **9+** → the curtain holds over R0 and thickens (puddle dimples). Each link is a **discrete beat**: the curtain's leading edge advances one zone in **0.5 s** and that zone darkens to jewel-wet in a **0.4 s** sweep (W 0 → 0.8). Rain is world-space curtains only. | Count the wet ranks to read the chain. Sky ≥ 60% clear cobalt at every step; never grey; no lightning. |
| **Combo release** (`combo(0)` on the breaking lock, peak ≥ 2) | The sun returns | **All peaks:** within **1.2 s** the curtain retreats right and back; the sun floods the wet ranks, which flare jewel-bright (saturation and sheen, **+15%** luminance over 0.6 s, no exposure lift); drying steam rises from sunlit wet faces; the land dries over **45–60 s** (sunlit τ 35 s, shadow τ 70 s). **Peak ≥ 5 only:** the theme's single **rainbow** blooms from 0.6 to 2.5 s over the right-hand vista on the true antisolar point (primary at 40.4–42.3°). **Peak ≥ 6** adds the secondary at 50.4–53.4°, ×0.43, with Alexander's dark band. **Peak ≥ 8** adds supernumerary fringes (High+) and full wetness. The bow fades over **12–18 s**. What is in frame is the arcs' left legs, right of the card (§3.3 #11). | The reward lands on the release. Bow rare (a few times per session). |
| **Back-to-back** | Folding | The newest strata near the card buckle into **chevrons** over **1.2 s** with a dust shrug along the near crests; each B2B deepens the fold, up to **4** steps; persists while the chain lives; on the director's inferred break the folds relax over **8 s**. | Persistent landform. |
| **T-spin** | Hoodoo | As §1.5: a striped pinnacle turned out of the slope on the T's side in a **1.4 s** time-lapse, strata twisting about its own axis; **1/2/3** cap stones (**18/28/40 m**); stands **25 s**, crumbles in a dust slump; up to **3**. *(Optional: stand for the whole level, oldest crumbling when a fourth arrives.)* | Never circles the card. |
| **Perfect clear** | Sky strata | As §1.5: **9-plate** lenticular tower in the last 9 strata's colours, newest on top, rose-gold rims; the land takes their coloured skylight; holds **10 s**, dissolves from the top over **6 s**. | Standalone (`rows: []`, a later frame). |
| **Level up** | Unconformity | As §1.5: the record tilts **6°** further over **2.5 s**; a pale tuff marker bed opens the next formation (I→VI). Infinity/MP advance every **15** deposited lines. | Reduced motion: crossfade. |
| **Game over** (`gameOver`, `modeStopped`) | Tuff seal and low light | A slow ashfall settles a **white tuff bed** over the newest strata. The sun sinks to **1°** behind us over **6 s** (×4 clock), so the **Earth's shadow** and the **Belt of Venus** rise over the CF ahead; crests turn muted rose, washes fill with blue shadow. On `modeStarted` the morning light returns over **4 s**. | The only moment of rose/gold light in the theme. |
| **Idle** | The land breathes | §3.5 ambient motion. After **90 s** without a lock the land is fully dry. In menus (no card) the camera drifts along the crest, **±4° yaw over 80 s**. | Nothing waits on the player. |
| **Meditation / Odyssey synthetic clears** | Deposition | No rows: beds in the current formation's base minerals; meditation clicks deposit on the front nearest the click (`screen`). | Rate-limit dust bursts for rapid click combos. |
| **Multiplayer** | Shared record | All players deposit into one record in their own colours; chutes aim at each player's own board; the weather follows the maximum chain on screen; folds follow the maximum B2B level. | — |

**Photosensitivity (unchanged and binding).** No full-frame flash; exposure lifts (if any) ≤ +0.15,
≤ 1 per second, combined with `max`; no lightning; constant-brightness curtain streaks; HDR clamped
before bloom; WCAG 2.3.1. The Phaser board already flashes gold on big clears, so the theme adds no
flash of its own on four lines.

### 3.5 Revised light, ambient motion and look drivers

**The Long Morning (replaces The Long Golden Hour).** Sun direction stays behind-left (~128° from
the view in the proposal; the base azimuth is now solved per layout, about 114° at 16:9 to 140° on
a portrait phone, §3.3 #11), so the antisolar point is ahead-right and the bow is placeable: at 22°
elevation the primary's top stands about 20° above the horizon, at 12° about 30°. Both are above
the 16:9 frame top (≈ 14°), so what is seen is the legs rising out of the right-hand valleys.

| Sun elevation | Light colour | Shadows |
|---|---|---|
| 22° (high end) | `#FFF3E0` | shorter, blue-lavender sky fill |
| 12° (low end) | `#FFE6C4` | long, crossing the next rank |
| 1° (game over only) | `#FFAE7A` | Earth's shadow `#5E6E9E`, Belt of Venus `#E9A4B4` ahead |

Keep from the original: sky `#2B56B9` → `#D5E8EC`, the warm glow at the left edge (fainter), the
sky-lit lavender shadow faces (`#9686B8` on warm albedos, bluer on cream beds), the red-rock
bounce, the opposition brightening, the warm valley haze `exp(-(y−floor)/40)` (bounded, #71).

**Ambient motion (replaces §1.4).**

| Element | Motion | Rate |
|---|---|---|
| Sun | elevation 12↔22°, azimuth ±6° | 420 s and 150 s periods (incommensurate); ×4 during game-over and restart transitions |
| Shadow crawl | follows the azimuth sway: terminators glide visibly along ridges | as above |
| Lenticular stack | standing shape, texture advects | flow 6 m/s; rims ±4% over 90 s; drift 0.5 m/s; its soft shadow follows on the CF |
| Valley haze | advects downwind, breathes | 1.5 m/s; ±15% over 60 s; ×0.4 when wet |
| Fumaroles (**6–10**; ≥ 2 plumes visible at 16:9, 21:9 and portrait) | rise, sway, puffs, bend downwind | rise 1.2 m/s, sway 0.15 Hz, puff every 6–14 s; density ×1.8 when wet |
| Drying steam | wisps off sunlit wet faces | rate ∝ W·sunlit, rise 0.6 m/s, 6 s life |
| Far showers | one always present beyond R4 (≥ 4 km), grey-violet with sunlit edges, with a cloud shadow beneath; never nearer than R4 outside a combo | drift 6–10 m/s; each ~90 s, crossfading into the next |
| Braided meltwater (basin floor) | glints flow along 3–8 m channels | 1.5 m/s, always on |
| Shrubs | shiver on gusts | 0.8 Hz, small |
| Puddles | shrink with W; dimples only while raining | follows W |
| Camera | breathing sway; pointer parallax (desktop, not touch, not reduced motion) | ±0.25°, 23 s / 31 s; parallax ±1.2° |
| Strata | still between events (design rule) | — |
| **Removed** | sand veils off crests; heat shimmer | — |

Reduced motion: sway and parallax off; steam and showers ×0.4; strata steps crossfade; curtain
streaks ×0.3 and slower; shadow crawl halved.

**Look drivers (keep from §1.3 except the clock):** Dry ↔ Wet (W, albedo ×0.65, chroma ×1.35,
sunlit τ 35 s, shadow τ 70 s); Formations I–VI every 15 strata with accumulating tilt; Weather
(the combo); Sky strata (perfect clear); Low light (game over).

### 3.6 Revised piece colours (colour-vision safe candidate)

Same pigments and roles; values re-spread so CIE L* separates the pairs that collapsed. Gate still
**0/7**. Method: Machado 2009 simulation (protan, deutan, tritan at full severity) in linear sRGB,
CIEDE2000 distances. Treat these as the starting point and re-verify after any change.

| Shape | Pigment | Original | **Candidate** | HSL hue | CIE L* |
|---|---|---|---|---|---|
| I | Red Ochre | `#D8452E` | **`#D8432C`** | 8° | 50 |
| O | Azurite | `#3A6CD4` | **`#4C74E9`** | 225° | 52 |
| T | Turquoise (deep, chrysocolla) | `#1FB3A6` | **`#0E726F`** | 178° | 43 |
| S | Orpiment | `#F0BE2E` | **`#F0C02D`** | 45° | 80 |
| Z | Lepidolite (pale lilac) | `#9B7AD6` | **`#B7AADE`** | 255° | 72 |
| J | Rhyolite Rose | `#EC8AA2` | **`#D3739A`** | 336° | 60 |
| L | Terre Verte (pale celadon) | `#5DBB73` | **`#81CA8B`** | 128° | 75 |
| GARBAGE | Obsidian | `#2A2630` | `#2A2630` | — | — |
| CLEAN_GARBAGE | Bleached Tuff | `#E6DCC8` | `#E6DCC8` | — | — |

| Vision | Original worst pairs (ΔE00) | Candidate worst pairs (ΔE00) |
|---|---|---|
| Normal | T–L 17.2, O–Z 18.2 | Z–J 21.7, O–Z 24.2 |
| Protanopia | **T–J 6.4**, **O–Z 7.5** | T–J 13.2, S–L 14.2 |
| Deuteranopia | J–L 10.3, O–Z 13.0 | S–L 17.0, J–L 17.2 |
| Tritanopia | **T–L 3.7**, S–J 11.4 | O–T 14.1, I–J 15.2 |

Checks still to do on the build: T (L* 43) against the board background, Z and S against Bleached
Tuff, and a board screenshot under protanopia/deuteranopia filters. The cell look stays as §1.6
(solid mode, sun-lit slab, cream rim, no glow, pulse or shimmer). The world mineralises these hues
(28% toward rock tone, chroma ×0.85 dry) and wetness restores them.

---

## 4. Overlap with Rainbark

Rainbark (`src/themes/rainbark/`, commits `0c747dd` and `585ab55`, design in
[`docs/theme-concepts/rainbark.md`](rainbark.md)) is the winner of this round: colossal painted
eucalyptus trunks in blue air over a floor of mist; locks peel the bark, clears shed girdles, four
lines is the Great Moult; canopy-gap sun pools count the combo; the B2B state is a sunshower;
level up climbs the grove. A Painted Ages build must keep its own identity next to it.

### 4.1 What Rainbark already borrowed from Painted Ages

| Painted Ages idea | Rainbark's version | Keep in Painted Ages? How it stays distinct |
|---|---|---|
| **Shadow well:** a cleared row's real 10 cell colours | The ring under a shed girdle **ripens into the row's own colours**, left to right, then ages away | **Keep** (it originated here). Painted Ages lays them down as permanent strata that recede as deep time and are buried, tilted and folded; never a ring at row height on a vertical surface beside the card. |
| **Wetness as one material parameter** | B2B sunshower and Great Moult: albedo ×(1 − 0.2·wet), chroma ×(1 + 0.3·wet), gloss up | **Keep** as the core colour story (rain reveals true colour; mineralised hues return to the exact piece hues). Make it rock-specific: drying fronts that follow the light, puddles, steam off drying faces, washed air (haze ×0.4). |
| **A B2B state that persists while the chain lives** | **The Sunshower** (grove-wide rain, stepping heavier per B2B) | **Keep the persistence, not the weather:** Painted Ages' B2B is a landform (chevron folds). Never put rain on B2B. |
| **`fwidth` mean-blend anti-aliasing** | Far-rank bark fades to the group mean by pixel footprint | Keep: a technique, not a look. |
| **The reward lands on the release, sized by the peak** | **The Set:** a curl curtain scaled by the peak chain, plus a vapour roll | **Keep.** Painted Ages releases with "the sun returns" and, for peak ≥ 5, the bow: light and optics, never falling material. |
| **B2B break inference** (wave-1 clear < 4 lines, no T-spin) and the judges' combo-break inference | Implemented in `rainbark-director.js` | Shared infrastructure: copy the director. |

### 4.2 New similarity risks now that Rainbark exists

| Risk | Why | Guard |
|---|---|---|
| **Sunshower** | Original combo step 5 was a "sunshower overhead" with gold streaks across the lens; Rainbark's B2B is "the Sunshower" with in-lens drops glinting in sunflecks | No camera-space rain at all (§3.3 #3); rain is distant curtains on the land; never the word "sunshower". |
| **Two bright, saturated, natural full-spectrum daylight worlds under blue** | The fleet's "high-key daylight" slot is now partly Rainbark's | Rainbark: high sun, blue aerial haze as the depth device, vertical, no ground and no horizon. Painted Ages: low raking morning light (≤ 22°), a horizontal landscape with a horizon, warm haze in the washes, a dry pale-turquoise horizon. Never use blue aerial haze as the main depth device; never drop the horizon. |
| **Mist floor vs valley haze** | Both put soft atmosphere low in the frame | Painted Ages' haze is thin, warm and confined to washes (`exp(-h/40 m)`); wash floors stay visible; never a white floor. |
| **Material reveal locks** | Rainbark's peel reveals a band in the piece's colour on bark; Painted Ages' lock is grit in the piece's colour | Different motions: Rainbark unzips and curls; Painted Ages slides, bounces and comes to rest as a talus fan on neutral ground. |
| **Row colours appearing on the world at clear** | Rainbark places ring segments at each cleared row's screen height on trunks | Painted Ages deposits from the front's crest, independent of row height, and the whole record steps away. |
| **Discrete combo counter** | Rainbark counts the chain in canopy-gap sun pools | Painted Ages counts in wet ranks; never pools of light, gaps or shafts. |
| **Underlit atmosphere** | Rainbark tints its mist top with the bark colour above it | Painted Ages' steam is lit by the low sun (Beer + HG), not by the ground colour. |
| **Piece palettes** | Both are full-spectrum natural pigments; J is rose/ruby and T green-teal in both | Low risk; acceptable. Do not copy Rainbark's satin "bark tile" cell look: Painted Ages cells are polished mineral slabs with a cream parting rim. |
| **Icon** | Rainbark's icon is one painted bole with a peeling strip | Painted Ages' icon is a striped hogback flank in raking light with a rose-rimmed lenticular in cobalt sky; no rainbow, no tree. |

### 4.3 The slot

Rainbark now occupies the slot this concept was written for (Cosmic Chimes was retired into it:
`RETIRED_THEME_IDS` in `src/themes/theme-registry.js` gained `['cosmic-chimes', 'rainbark']`, the
song was retitled, Odyssey orb 47 became "The Painted Giants"). A Painted Ages build therefore
needs its own slot. Follow [PLAYBOOK.md §1 "Choosing a slot"](PLAYBOOK.md#1-choosing-a-slot):

- **Recommended (PLAYBOOK §1a): replace an existing theme, and ask the user which one.** It is a
  product decision; do not guess. Run the PLAYBOOK §1a facts script first. Retire the old id with
  the same procedure as the worked example, the Cosmic Chimes → Rainbark change (commits `0c747dd`
  and `585ab55`; PLAYBOOK §4 is the generalised checklist), with
  `tests/unit/rainbark-rename-migration.test.js` and
  `tests/unit/murmuration-rename-migration.test.js` as test templates.
- **Only if the user insists (PLAYBOOK §1b): add a 62nd theme.** That breaks pinned counts
  (`odyssey-unique-themes`, `theme-music-catalog`, `theme-collection`,
  `development-collection-access`, `music-collection-ui` tests) **and** the invariant that every
  non-starter theme has exactly one Odyssey orb, so it also needs a new orb or a bonus route, a
  song or a `painted-ages-placeholder-song.mp3` byte copy of `blood-moon.mp3`, and
  `songs.json` regenerated. PLAYBOOK §1b lists every file.

**Candidates to put to the user** (from the PLAYBOOK §1a facts script run on this branch on
2026-10-12; re-run it, the fleet changes). Prefer a theme without a masterpiece rebuild and with
subject overlap:

| Candidate | Orb, chapter, name, role | State | Song | Fit for Painted Ages |
|---|---|---|---|---|
| `mountain` | orb 24, ch4 "Mountains & Thin-Air Ascension", "Mountain Stillness", `release` | legacy DOM/CSS, `light`, no `world.js`, no effect, not in the phone validator | placeholder | **Best fit.** Listed among this concept's closest themes (§1.8), so replacing it removes a near-duplicate; chapter 4 is the mountain chapter; a `release` beat suits a calm daylight badlands. The orb name could stay or become e.g. "The Painted Ages". |
| `moonrise-summit` | orb 26, ch4, "Peak Transcendence", `boss` | legacy, `light`, no `world.js`, no effect | placeholder | Good chapter fit; a night moon-and-peaks theme becoming bright day is a tone shift on a boss orb. |
| `sakura-twilight` | orb 19, ch4, "Mountain Base", `arrival` | no `world.js` (has an effect) | placeholder | Chapter fit; loses the fleet's only cherry-blossom theme. |
| `pyrestorm` | orb 4, ch1 "Earth Core & Subterranean Origins", "Molten Flow", `test` | no `world.js`, no effect | placeholder | Geological chapter; but pyrestorm's avoid list (ash, volcano) is exactly what §3.3 #6 steers away from. |

Whichever slot: if it has an Odyssey orb, rename the orb only if the level name does not fit a
bright badlands, use a crossfade transition, update the orb's copy, and set the presentation colour
in `src/core/odyssey/theme-presentation.js` (suggest `'#c8432b'`, Danxia Vermilion). Tell the user
the song keeps the old theme's audio under the new title (no music generation is available).

---

## 5. Implementation plan

House style is the Serenity Warp rebuild as refined by Rainbark. Clone, then rename; rewrite only
the content modules. PLAYBOOK.md has the generic adapter, director and rename steps; this section
gives what is specific to Painted Ages.

### 5.1 Identity and registry

| Field | Value |
|---|---|
| Theme id | `painted-ages` |
| Class | `PaintedAgesTheme` (`src/themes/painted-ages/painted-ages-theme.js`, `export default`), `super('painted-ages')` |
| World / Post / Director | `PaintedAgesWorld`, `PaintedAgesPost`, `PaintedAgesDirector` |
| Constants | `PAINTED_AGES_TETROMINOS`, `PAINTED_AGES_PARTS`, `PAINTED_AGES_EVENT_HANDLERS`, `LOG_PREFIX = '[Painted Ages]'` |
| Capture prefix | `paintedAges`: `?paintedAgesTime=`, `?paintedAgesFixedDt=`, `?paintedAgesParts=`, `?paintedAgesFalseColor=`, `?paintedAgesForceWebGL=` (literal strings in `-theme.js`, as sibling tests require) |
| URL catalogue row | `['painted-ages', 'paintedAges', 'Painted Ages', 'sky, land, water, air, steam, hoodoo']` in `captureThemes` (`src/ui/url-parameters/theme-parameters.js`), added only once `painted-ages-theme.js` and `painted-ages-world.js` exist |
| Registry | `group: 'biomes'`; add to `HEAVY_GPU_THEME_IDS` (gives `resourceProfile 'heavy-gpu'`, `performanceClass 'heavy'`, `startupEligible false`); add to `MOBILE_WEBGL2_NODE_IDS` in `scripts/lib/mobile-webgl2-validation.mjs` |
| Clear colour | Suggest `0x5a4a66` (Plum Depth lifted to a mid value) so the container fade never flashes white or black; container CSS `#painted-ages-theme { background: #5a4a66; overflow: hidden; }`, or the lazy `ensureThemeContainer` path that serenity-warp and parhelion use |
| ThemesTab fallback glyph | `'mountain'` (keyed by display name in `src/ui/serenity-hub/ThemesTab.js`) |
| Music, Odyssey | Depend on the slot (§4.3) |

### 5.2 Files

| File | Role | Start from |
|---|---|---|
| `painted-ages-core.js` | Three-free: `PALETTE`, `FORMATIONS` (I–VI casts, tilt step 6°), `mineralise(rgb, rockTone, wet)`, `StrataRecord` (512-row ring + event log for `seek`), `PIECE_CODE`, sun path (`sunAt(t)`), `ZONES` (CF, R5…R0), `TIMING` (every number in §3.4), `EVENT_ROWS`, `cellsFromMatrix`, `approach`, `smooth`, `mulberry32` | `rainbark-core.js` helpers |
| `painted-ages-bake.js` | Three-free typed-array bakes: hogback heightfield + rills (from the A0 lab), normals+cavity, far horizon map (1–4 azimuths) + near patch, mask map, flow accumulation → wash channels, ledges, ~40 chutes and pour lanes, vent/hoodoo sites, braided meltwater polylines, view-fan mesh; basement palette strip; baked 2D fBm with CPU mips. Deterministic by seed. | new |
| `painted-ages-tsl.js` | `createPaintedAgesUniforms` (`u`, one vec4 `events` array, counts as int uniforms), `DataTexture` wrappers (record: `NearestFilter`, no mips), laid-out pure helpers (hashes, `smoothTri`, filmic), inline builders `strataAt`, `paSun`, `paSkyColour`, `paHaze`, `paWet`, `paEvents`; `paFxMaterial` (premultiplied); `paPart`. `export *` from core. | `rainbark-tsl.js` |
| `painted-ages-sky.js` | Backdrop: gradient, warm edge, lenticular plates + their shadow term, storm deck, virga, far showers, Earth shadow/Belt of Venus, the bow (release only) | `rainbark-sky.js` frame |
| `painted-ages-land.js` | View-fan terrain mesh + material: strata, folds, tilt, wetness, puddles, fans, flood bed, tuff beds, moss/sulfur/obsidian, dust cover, varnish, horizon shadows, bounce, haze, bow in-scatter | new |
| `painted-ages-water.js` | Flood ribbons, waterfalls, braided meltwater | new |
| `painted-ages-air.js` | One interleaved instanced pool (grit, chips, dust, slurry, spray, ash), curtain sheets with streak texture, steam sheets | new |
| `painted-ages-hoodoo.js` | Lathe pinnacle, 3 slots, shares `strataAt` | new |
| `painted-ages-world.js` | `PaintedAgesWorld`: the house `WORLD_METHODS` (`build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`) plus `onB2B(level)`, `onGameOver()`, `onSessionStart()`; timed queue; slot rings; the integrated datum `Z_top`, fold and tilt eases; record writes; exports `REST_RIG`, `fovForAspect`, `PAINTED_AGES_PARTS` | `rainbark-world.js` frame |
| `painted-ages-director.js` | **Copy of `rainbark-director.js`** with mineral codes; `MAX_B2B = 4` (§3.3 #8) | `rainbark-director.js` |
| `painted-ages-composition.js` | Cloned compositor (with `'#online-main-board canvas'`), plus `pickChute(layout, player, u, rows)`, front/pour-lane screen points, card keep-out, and `solveSunAzimuth(layout, aspect)` (the per-layout base sun azimuth that keeps the bow's legs clear of the card, §3.3 #11) | `rainbark-composition.js` |
| `painted-ages-post.js` | `PaintedAgesPost`, `POST_LOOK` per tier, `createPassThroughPipeline`: calm zones, high-threshold max-channel bloom, "painted filmic" (knee ≈ 0.55), grade (warm highlights, lavender shadow lift, saturation 1.06), vignette, grain, dither; no shafts, rush, fringe or shimmer | `rainbark-post.js` |
| `painted-ages-quality.js` | `QUALITY` (§5.10), `QUALITY_NAMES`, `tierFor` | `rainbark-quality.js` |
| `painted-ages-theme.js` | Clone of the Rainbark adapter: ids, flags, clear colour, renderer + GPU-loss rebuild, layout reads on frame time, calm zones, settings; sink `lock`, `clear`, `combo` (max over players), `b2b` (max over players), `levelUp`; `gameOver`/`modeStopped` → `world.onGameOver(); resetSession()`; `modeStarted` → `world.onSessionStart()` | `rainbark-theme.js` |
| `painted-ages-tetrominos.js` | §3.6 palette, `version: 2`, `renderMode: 'solid'`, Phaser gradient/highlight/shadow/rim keys | `rainbark-tetrominos.js` shape |
| `painted-ages-theme-icon.png` | 512² circular, from the icon frame (§5.9); copy to `public/assets/themes/painted-ages-theme-icon.png` | — |
| `src/playground/effects/painted-ages.effect.js` | Mounts the same world + post (`capture: true`), events through a real director; imports only `three/webgpu` + its own modules | `rainbark.effect.js` |

### 5.3 Director and sink contract

Exactly Rainbark's (see the header of `src/themes/rainbark/rainbark-director.js`):

```
sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, rowCodes, screen })
sink.combo(n, player)     // 0 = broke; delivered on the breaking lock; idempotent vs the tracker's late 0
sink.b2b(level, player)   // 0..4 here; 0 inferred from a non-difficult wave-1 clear
sink.levelUp(level)
```

World mapping: `rowCodes` (10 per row, lowest row first) → one record row: columns 0–9 the
mineralised lamina colours, 10 the mean, 11 the parting (Bleached Cream), 12 the properties
(thickness scale, formation id, wet response). Code 7 in a partly known row → obsidian.

### 5.4 Event table and uniforms (proposed layout)

One `uniformArray(rows, 'vec4')` (#102), live rows compacted to the front each frame, counts in
int uniforms, loops named distinctly (#110, #155):

| Block | Slots × rows | Row A | Row B |
|---|---|---|---|
| formations | 6 × 2 | bed normal xyz, base offset (m) | first record row, row count, mineral cast id, tilt (°) |
| fans | 12 × 2 | centre xz (m), radius (m), start t | colour rgb (linear), buried-at t |
| runs (lock/drop) | 6 × 2 | chute id, start t, width scale, hard (0/1) | colour rgb, chip count |
| beds (deposits) | 4 × 2 | front id, start t, record row, wet | mean rgb, thickness |
| flood | 4 × 1 | channel id, start t, record row, drain t | — |
| hoodoos | 3 × 2 | site xz, start t, lines | twist phase, crumble t, height |
| weather | 1 × 2 | wet-zone count, curtain edge (zone units), release peak, release t | deck growth, virga, bow strength, — |

About **68** rows. Scalars (`u.datum`, `u.fold`, `u.tilt`, `u.sunDir`, `u.wetGlobal`, plate
colours) are plain uniforms; the record is its own 16×512 `DataTexture`.

### 5.5 Playground effect and parameters

Every parameter the effect reads must be catalogued in `src/ui/url-parameters/playground-parameters.js`
with `scope` naming `painted-ages` and `sources` naming the effect file (the URL catalogue test and
the sibling-style playground test enforce this).

| Param | Meaning |
|---|---|
| `t` | Fixed time (reference shots use `t=40`) |
| `quality` | Minimal…Extreme; default High |
| `level` | Formations present (1–8); default 3 |
| `board`, `statsHud` | Mock board with the real selectors (calm zones and chute keep-out exercised) |
| `locks=<n>` | Pre-play n locks (alternating fronts and pieces) |
| `deposits=<n>` | Pre-deposit n seeded strata (mid-session look); default 0 |
| `event` | `lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`, `levelUp`, `release`, `b2b`, `gameOver` |
| `eventAge` | Seconds after the event; default 0.4 |
| `eventLevel` | Default level + 1 |
| `lines` | 1–4, default 2 |
| `row`, `u` | Default 9 and 0.3 |
| `piece`, `turns`, `color` | Piece shape, quarter turns, colour override |
| `dist` | Hard-drop distance, default 14 |
| `cascade` | Waves for `clear`, default 1 |
| `combo=<n>` | Hold a chain (wet zones = n − 1) |
| `peak=<n>` | For `release`, default 6 |
| `b2b=<0–4>` | Hold the folds |
| `wet=<0–1>` | Override global wetness |
| `sun=<deg>` | Override sun elevation (1–22) |
| `formation=<1–6>` | Override the current formation's cast |
| `view=shade\|strata\|full` | Debug view for Stage A (catalogue it, or remove it before merge) |
| `reduce`, `parts`, `noPost`, `falseColor`, `bloom` | Reduced motion, part filter, post off, false colour, bloom override |
| `px`, `py` | Hold the pointer |
| `icon`, `iconFov`, `iconYaw`, `iconPitch` | Icon frame |
| `demo` | 40 s loop of locks, clears, chains, quad, T-spin and B2B |

### 5.6 The CPU lab first (Stage A0)

**The Rainbark lesson** (details in [`rainbark.md`](rainbark.md)): Rainbark's spec described its
hero bark as an anisotropic Voronoi patch atlas. Prototyped on the CPU in numpy and compared side by
side with reference photos, it read as **stained glass / tie-dye** and was rejected; thresholded
fBm contours read as topographic rainbow rings and pointed lozenge splats as candy leaves. "Ribbon
splats" over a cool slate matrix (first tried in v4, chosen as v6 of six CPU prototypes) matched.
All of that happened before step A1, so no shader time was spent on the wrong model. **Do the same for Painted Ages' hero (terrain shape + strata) before
writing any shader.**

Work outside the repo (the new session's scratchpad directory); commit nothing from the lab except
the parameters that pass (as comments and constants in `painted-ages-bake.js` / `-core.js`). The
lab's numpy + PIL setup and montage helpers are described in [`rainbark.md`](rainbark.md) §10.

1. **Heightfield** (numpy, 512² over a 4 × 4 km near window first, then the full 8 × 11 km domain at
   1024²):
   - Hogback profile across strike: an asymmetric sawtooth `saw(s) = s < a ? s/a : (1 − s)/(1 − a)`
     with `a ≈ 0.75` (gentle dip slope, steep scarp), ridge spacing **600–1200 m**, amplitude
     **80–220 m**, strike **35°** to the view, domain warp ~150 m, ridged fBm relief 20–40 m.
   - Rills: **stream-power erosion** (`dh = −K·A^0.5·S` with D8 flow accumulation A and slope S,
     plus a little diffusion), 60–200 iterations. Target: knife-edged interfluves and V gullies
     every **10–30 m** on the flanks (badlands drainage density).
   - Hand-place the near crest, the basin knoll, the two fronts at different depths, and the CF.
2. **Render from the real camera** (140 m above the wash, pitch −7°, vertical FOV 42°, 960×540): a
   vectorised column ("voxel space") raymarcher over the heightfield is enough.
3. **Colour:** the §1.7 strata function (`z_s`, `k`, row, lamina, partings), mineralised base
   formations, dust cover on gentle dip slopes, Lambert wrap × horizon shadow + cobalt sky fill +
   cavity red bounce, sun at 12° and 22° from behind-left, aerial perspective and the bounded
   valley haze. Apply a filmic curve (knee 0.55) before judging.
4. **Compare** in a PIL montage (render | render | reference photo) against Zhangye and Hornocal
   photographs (§6). Iterate until the §5.7 checklist passes. Also render the wet variant
   (albedo ×0.65, chroma ×1.35) and the 128×72 thumbnail beside `docs/theme-screenshots/shifting-sands.png` downscaled the same way.
5. **Never** copy reference photos into the repo; keep them in the scratchpad. If you use the
   playground's `ref=…&refMode=split`, the image must be user-supplied or licence-clear and must
   not be committed.

### 5.7 Hero art checklist (terrain + strata)

Accept the terrain and strata only when all hold at 16:9, 21:9 and portrait:

- [ ] **Rule of Vs:** where tilted beds cross a gully they bend into V shapes (beds dipping
      downstream more steeply than the gully floor point their V downstream); horizontal beds
      follow contours. This, more than colour, sells "real strata".
- [ ] Ridges read as **sawtooth hogbacks** (steep scarp one side, long dip slope the other), not
      rounded noise hills.
- [ ] **Rills:** dense V gullies cut every flank; interfluves knife-edged; skyline crests serrated.
- [ ] Bands are **wavy** and vary in thickness (thin laminae to thick beds); never ruler-straight or
      evenly spaced.
- [ ] **Partings** read near (cream lines); mid-distance bands read as pinstripes; the CF reads as
      broad zigzags of colour.
- [ ] Dip slopes carry a pale **dust cover**; steep scarps show clean bands; desert-varnish streaks
      run down scarps.
- [ ] Raking light gives each ridge a lit face and a sky-lit lavender-blue face, with orange bounce
      in gullies and cast shadows crossing the next rank.
- [ ] **No moiré or crawl** at Minimal on 390×844 and in a live (unfixed `t`) capture under camera
      breathing.
- [ ] Dry rest frame: mean band chroma ≤ 0.6× piece chroma; base formations dominate mid and far;
      nothing reads as candy stripes.
- [ ] The 128×72 thumbnail passes the gate in §3.1 (not "the other warm desert").
- [ ] Wet variant: darker, jewel-saturated, puddles reflect cobalt, haze thinner.

### 5.8 Staged build order

One small effect per session (CLAUDE.md; full-journey captures have crashed a dev iGPU). Every step
ends with playground screenshots on **both backends** (`&forceWebGL=1` for WebGL2), a clean console,
`__PLAYGROUND__.diagnostics()` read back, and one Low-tier capture. Use the headless capture tooling
in PLAYBOOK.md §5 (`shot.mjs`, `game.mjs`, `switch-away.mjs`; Chromium + SwiftShader, with the
harness-only `GPUTexture.createView` swizzle shim for Chromium 141 vs three r186). All queries
below go after `/playground.html?effect=painted-ages&`.

**Stage 0: scaffold and slot.** Clone adapter, director, composition, post and quality from
Rainbark; build a minimal world (sky gradient only) satisfying `WORLD_METHODS`; registry entry,
`HEAVY_GPU_THEME_IDS`, URL catalogue row, `MOBILE_WEBGL2_NODE_IDS`, container, ThemesTab glyph,
playground effect with every parameter catalogued; do the slot work (§4.3, PLAYBOOK.md). Acceptance:
`t=40` renders on both backends; the real game boots into the theme cleanly on both backends; the
phone validator passes at Low and Minimal; PLAYBOOK §6.1's minimal gate list is green.

**Stage A: environment.**

| Step | Work | Acceptance |
|---|---|---|
| **A0** | CPU lab (§5.6), no repo code | Montage passes §5.7 against reference photos; parameters recorded |
| **A1** | Heightfield bake in `painted-ages-bake.js`, view-fan mesh, flat-albedo shaded land, bake timing logged | `t=40&parts=sky,land&view=shade` at 1920×1080, 2560×1080 and 390×844: sawtooth ranks on the diagonal, rills, the two fronts at different depths |
| **A2** | Record texture (prefill I–VI), `strataAt` with formations loop, laminae AA, light (wrap sun, horizon shadow + near patch, sky fill, red bounce), dust cover, varnish | `t=40&level=3&parts=sky,land`; `level=1`; `level=6` (unconformities); `deposits=60`; `quality=Minimal&t=40&level=3` at 390×844 (no moiré); a live capture for crawl |
| **A3** | Sky: gradient, warm edge, lenticular plates and their shadow, aerial perspective, valley haze, Earth shadow and Belt of Venus | `t=40&level=3`; `sun=12`; `sun=22`; `sun=1` |
| **A4** | Basin and detail: fumaroles (steam sheets), obsidian, moss, sulfur, braided meltwater, shrubs, boardwalks, puddle basins; the wetness parameter | `t=40&level=3&wet=0` and `wet=1` side by side; ≥ 2 plumes visible at all three viewports |
| **A5** | Ambient: far showers, shadow crawl, lenticular flow, haze drift; reduced motion | `t=40` vs `t=115` (shadows and shower visibly moved); `reduce=1` |

**Stage B: gameplay FX.**

| Step | Work | Acceptance shots (§5.9) |
|---|---|---|
| **B1** | Scree run + slump: air pool, chute picking, pour lanes, talus fans, keep-out | 3, 4, 5, and 18 (phone) |
| **B2** | Deposition: director copy (`rowCodes`), slurry sheet, bed write (one record row, `needsUpdate`), datum step with the near/far split, fan burial, cascades, synthetic rows | 6, 7, plus `event=clear&lines=2&cascade=2&eventAge=1.2` |
| **B3** | Flash flood: ribbons, waterfalls, spray, flood bed, meltwater joins | 8, 9 |
| **B4** | Weather: curtains, wet zones, deck, virga; release with the bow gate; director break inference tests | 10, 11, 12 |
| **B5** | B2B folds; T-spin hoodoos | 13, 14 |
| **B6** | Sky strata; unconformity; tuff seal and low light; session start; meditation; multiplayer (shared record, per-board chutes) | 15, 16, 17 |

**Stage C: post, tiers, phone, icon.**

| Step | Work |
|---|---|
| **C1** | Post: calm zones tuned with `board=1`; bloom threshold high (only wet glints, foam, spray, bow); painted filmic; grade; `falseColor` check |
| **C2** | Tiers (§5.10); Minimal and Low captures; WebGL2 leg on every starred shot |
| **C3** | Portrait and 21:9 passes: chute picking by column on phones, bow arc in portrait (#153), plumes visible, keep-out |
| **C4** | Icon frame; adapter end to end in the real game; tests; docs (`docs/PAINTED_AGES_VISUAL_OVERHAUL_<yyyy-mm>.md` plus a captures folder, as the siblings do) |

### 5.9 Acceptance shots

Viewports: **D** 1920×1080, **W** 2560×1080, **P** 390×844 (DPR 1). `quality=High` unless stated.
★ = capture on both backends.

| # | Proves | Query (after `effect=painted-ages&`) | VP |
|---|---|---|---|
| 1★ | Reference picture: diagonal ranks, raking morning light, strata with Vs, CF zigzags, lenticulars, steam, obsidian | `t=40&level=3` | D |
| 2★ | Board readability: card over the plum wash, calm zones, no motion behind the card | `t=40&level=3&board=1` | D |
| 3 | Scree run mid-slide on the pour lane, chips, dust | `t=40&level=3&board=1&event=lock&piece=L&u=0.15&row=12&eventAge=0.6` | D |
| 4 | Talus fans on both fronts after locks | `t=40&level=3&board=1&locks=10&event=lock&piece=I&u=0.85&row=15&eventAge=1.4` | D |
| 5 | Slump: wide run, dust burst, chips | `t=40&level=3&board=1&event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.35` | D |
| 6★ | Deposition ×3 mid-beat: slurry sheets settling, wet beds | `t=40&level=3&board=1&locks=10&event=clear&lines=3&row=16&eventAge=0.5` | D |
| 7 | After the step: three dried beds in the rows' colours, record moved, fans buried | same as 6 with `eventAge=2.4` | D |
| 8★ | Flash flood: four coloured streams, waterfalls, no bow | `t=40&level=3&event=quad&row=16&eventAge=2.0` | D |
| 9 | Drained: glossy washes, flood bed | `t=40&level=3&event=quad&row=16&eventAge=9` | D |
| 10★ | Combo ×5: CF, R5, R4, R3 wet; curtain over R3; ≥ 60% clear sky | `t=40&level=3&board=1&combo=5` | D |
| 11 | Release after peak 4: sun returns, no bow | `t=40&level=3&board=1&event=release&peak=4&eventAge=1.5` | D |
| 12★ | Release after peak 7: double bow, Alexander's band, legs in front of ridges, both legs clear of the card and HUD (§3.3 #11); repeat at P (arcs above the card) and with `sun=12` and `sun=22` | `t=40&level=3&board=1&event=release&peak=7&eventAge=2.5` | D, P |
| 13 | B2B folds held at 3 | `t=40&level=3&board=1&b2b=3` | D |
| 14 | Hoodoo mid-twist (2 caps) | `t=40&level=3&board=1&event=tspin&lines=2&u=0.2&row=13&eventAge=0.8` | D |
| 15★ | Sky strata: 9-plate tower in record colours | `t=40&level=3&deposits=20&event=perfect&eventAge=4` | D |
| 16 | Unconformity mid-tilt; then the long-session stack | `t=40&level=3&event=levelUp&eventAge=1.4`; `t=40&level=6&deposits=90` | D |
| 17 | Tuff seal and low light: Earth shadow, Belt of Venus | `t=40&level=3&event=gameOver&eventAge=5` | D |
| 18★ | Phone portrait: chute below the card, lock legible, CF and lenticulars above | `t=40&level=3&board=1&event=lock&piece=T&u=0.2&row=10&eventAge=0.6` | P |

**Required sweep** (all clean): `t=40&level=3&wet=1`; `sun=12` and `sun=22`; levels 1, 2, 4, 6, 8;
ultrawide `t=40&level=3&board=1` at W; Low on WebGL2
`quality=Low&forceWebGL=1&board=1&t=40&level=3&event=clear&lines=2&eventAge=0.8` at P; Minimal
`quality=Minimal&t=40&level=3&board=1` at D; false colour `falseColor=1&t=40&level=3` (only wet
glints, foam and spray exceed the knee); reduced motion `reduce=1&event=levelUp&eventAge=0.6`; the
128×72 thumbnail montage beside shifting-sands, himalayan-peak, solar-eclipse, parhelion and
rainbark.

**Icon frame** (512×512, circular crop):
`t=40&level=3&icon=1&iconFov=30&iconYaw=-18&iconPitch=6&wet=0.5` (tune yaw and pitch). It must show
one striped hogback flank in raking light with its V-cut bands, a wet gleam on one band, and a
rose-rimmed lenticular in cobalt sky. One hero motif; no rainbow, no sun disc, no tree, no dune.

### 5.10 Quality tiers (revised; "every tier keeps the whole picture and every event")

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Terrain vertices | 18k | 32k | 64k | 110k | 170k | 240k |
| Bake size | 256² | 384² | 512² | 768² | 1024² | 1024² |
| Near horizon patch (1.5 km) | — | — | 256² | 512² | 512² | 512² |
| Horizon azimuths | 1 | 2 | 3 | 3 | 4 | 4 |
| Laminae (always on) + detail | no detail normal, no bounce | 1 octave | 2 octaves + bounce | 2 + grain | 3 + micro-rills | 3 + micro-rills |
| Lenticular plates | 2 | 3 | 4 | 5 | 6 | 7 |
| Curtain sheets | 3 | 3 | 4 | 5 | 6 | 6 |
| Curtain streaks (inside curtain volumes, ≥ 150 m) | 120 | 300 | 700 | 1400 | 2200 | 3000 |
| Air pool | 48 | 96 | 160 | 256 | 384 | 512 |
| Steam sheets (≥ 2 plumes always visible) | 2 | 3 | 4 | 6 | 8 | 10 |
| Flood ribbons (channels × segments) | 6×24 | 8×32 | 10×48 | 12×64 | 12×96 | 14×128 |
| Braided meltwater (channels × segments) | 3×24 | 4×32 | 6×48 | 8×64 | 8×96 | 10×128 |
| Waterfalls | 1 | 2 | 2 | 3 | 4 | 4 |
| Puddles | tint | tint | sky reflection | + rain dimples | + | + |
| Supernumeraries | no | no | no | yes | yes | yes |
| Shrubs | 0 | 200 | 400 | 800 | 1200 | 1600 |
| Post | no bloom | no bloom | bloom 0.33 | MSAA, bloom 0.45 | bloom 0.5 | bloom 0.5 |
| Pixel-ratio cap (house) | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |

Heat shimmer is gone from every tier. Drop detail **terms** in JavaScript, never by substituting a
constant 0.5 for a noise octave (#135). First cuts if over budget: shrubs, then meltwater segments,
then steam sheets above 4, then Ultra/Extreme extras. Never cut: strata, scree, deposition, flood,
weather, release, folds, hoodoo, sky strata, unconformity, tuff seal.

### 5.11 TSL / WebGPU / WebGL2 guards for this concept

- [ ] **No 3D textures, no `lut3D`, no `mx_noise`.** `Data3DTexture` writes fail WebGPU validation
      in the cloud container's headless Chromium/SwiftShader; every texture here is 2D.
- [ ] **Record texture:** `NearestFilter`, no mips, read with `.level(0)` at texel centres
      `((col + 0.5)/16, (row + 0.5)/512)`; a mip or linear blend of a ring buffer is garbage, and
      the laminae AA is analytic from `fwidth(k)`. Unit-test the row addressing (`DataTexture` data
      row 0 is `v ≈ 0`).
- [ ] **`strataAt` is an inline builder** (it reads uniforms and the record texture): call it once
      per material (land, hoodoo, and the sky's plate colours read the record inline). Textures and
      uniforms never enter a laid-out `Fn` (#93/#95: "unresolved value 'nodeUniformN'").
- [ ] **Loops:** formation loop and fan loop over live counts, distinct `name`s; a named loop hands
      its index over under that name (`({ f })`, `({ fan })`) (#110, #155). No JS-unrolled per-slot
      TSL (#101).
- [ ] **Samples inside `If` branches** (fans, flood bed, bow in-scatter) use `.level(n)`.
- [ ] **WebGL2-only:** no nested `select` with `Fn` calls inside (#89, "`addToStack` VarNode.build()");
      fold conditions into one `select(a.and(b), …)` with the value built as a `.toVar()` first.
- [ ] **WebGPU-only:** ≤ 8 vertex buffers (#99): the air pool's kind/colour/start live in one
      `InstancedInterleavedBuffer`; ≤ 12 uniform buffers per stage (#102): one events array.
- [ ] **Integer-coded instance data** (pool kind, chute id) decoded with `floor(x + 0.5)` (#87).
- [ ] **Bounded exponents** (#71): valley haze `exp(-max(y − floor, 0)/40)`, Beer terms, bow
      falloff; capture portrait before calling any of it done.
- [ ] **No `pow` of near-negative bases** (#94): GGX-lite sheen and Schlick written as products;
      clamp cosines.
- [ ] **Equal `smoothstep` edges are a hard WGSL error** (#69): guard the horizon-shadow penumbra
      `p > 0`.
- [ ] **Wide ramps on fBm** (#116) for lenticular edges, steam and curtain coverage, read at
      `.level(2)` where serration shows (#104).
- [ ] **Sub-pixel strips under MSAA** (#105): clamp interpolated `s` on flood/meltwater ribbons and
      streaks.
- [ ] **Sizes floored at a buffer pixel** (#147) for grit, chips, streaks; **additive light budgeted
      per tier** (count × area × exposure) for curtains and spray (#120).
- [ ] **Additive parts captured alone are black** (#117): test with an opaque part
      (`parts=land,air`).
- [ ] **Clamp before polynomial curves** in the grade (#122); judge only tone-mapped, false colour
      first (#112, #149).
- [ ] **Skyline rule** (#140): the low sky behind the CF stays brighter than anything in it.
- [ ] **Formation palettes on banded surfaces** (#143): a table texture with one row per formation,
      per-band timing on level-up.
- [ ] **Lock effects behind the card are never seen** (#144): chute picking excludes the card rect.
- [ ] **Direction-space shapes on a portrait lens** (#153): check the bow's arc at 390×844; draw any
      disc-like element in the image plane.
- [ ] **Overlapping fans** capped with the house pool formula (#157).
- [ ] **Bloom knee follows the iris** if any exposure moves (#134).
- [ ] **Record uploads:** three r186's `WebGPURenderer` ignores `Texture.updateRanges` on both
      backends (only the classic `WebGLRenderer` honours them), so a deposit is a full 32 KB
      upload via `needsUpdate = true`: fine at one per cleared row. Do not build anything that
      assumes partial uploads.
- [ ] **Precision:** integrate `Z_top`, fold and tilt eases with dt and wrap phases before upload;
      never `time × changing rate`.
- [ ] **First frame compiles everything:** every pool always drawn with dormant zero-size slots;
      `getWarmupRoots() → []`, `usesMrtScenePass() → false`.
- [ ] Banned in theme code (sibling tests grep for them): `new ShaderMaterial(`, `new WebGLRenderer(`,
      `mx_*(`, `from 'three'`, absolute `'/assets/…'` paths, `.wgsl/.glsl` files, `EffectComposer`,
      `compileComputeAsync`, `buildsPipelinesAsync`. Use `THREE.Timer`, not the deprecated `Clock`.

### 5.12 Tests and verification

Clone Rainbark's test set and adapt:

| Test | Covers |
|---|---|
| `painted-ages-core` | Palette gate 0/7 and CVD worst pair ≥ 12 (pin the §3.6 hexes); `mineralise` maths; record ring wrap; formation tilt accumulation; sun path; a CPU mirror of `strataAt` (k → row, lamina) round-tripping the record addressing |
| `painted-ages-bake` | Deterministic by seed; hogback asymmetry; ~40 chutes all downhill; channels connected; horizon map monotonic for lower suns; near patch agrees with the far map at its edge; bake time logged |
| `painted-ages-director` | Copied from `rainbark-director.test.js`, plus code 7 → obsidian and `MAX_B2B = 4` |
| `painted-ages-composition` | Chute heads and pour lanes never inside card/HUD rects at aspects 0.46, 1.0, 1.78, 2.37; phone chute by column; `solveSunAzimuth` keeps the above-horizon parts of both bows (radii 40.4°–53.4°) outside the card/HUD rects + margin over the whole ±6° sway, at sun 12° and 22°, at the same aspects, and stays within 105°–145° left |
| `painted-ages-world` | `WORLD_METHODS`; dormant pools; seek determinism (two seeks equal; record rebuilt from prefill + replayed log) |
| `painted-ages-theme` | Node graphs built for all six tiers with `forceWebGL: true` and no GPU; banned-API greps; the five capture flags as literals; heavy-GPU triple |
| `painted-ages-playground` | Effect params equal the catalogue |
| slot migration | Only if a theme is retired (templates: `rainbark-rename-migration.test.js`, `murmuration-rename-migration.test.js`) |

Verification commands, the full CI list and the real-game and phone validator invocations are in
PLAYBOOK.md. Remember `git add` before trusting `dual-state-theme-tripwire` (it scans tracked files
only), and never put the IP-gated words in user-visible strings (say "four lines").

---

## 6. Reference imagery to look for

No reference photograph may be copied into the repo. Look, describe, cite the URL, and compare in a
scratchpad montage. Licence-clear images (for example CC-licensed Wikimedia Commons files) may be
used temporarily as a playground `ref=` but are still not committed.

**The three source places (the fusion).**

| Place | What to study | Search terms |
|---|---|---|
| **Zhangye Danxia**, Gansu, China (Binggou and Qicai scenic areas) | Sawtooth hogbacks; wavy red/orange/yellow/grey-green bands; dense rills and the V-cuts where bands cross them; dusty pastel when dry, saturated after rain; boardwalks and stairs for scale | "Zhangye Danxia after rain", "Zhangye Danxia boardwalk", "Qicai Danxia aerial", "Danxia rills" |
| **Serranía de Hornocal** (Cerro de los 14 Colores), Humahuaca, Jujuy, Argentina | Triangular flatirons from evenly spaced gullies; folded Yacoraite beds as zigzags; ochre, magenta-purple, green, cream; afternoon light | "Serranía de Hornocal", "Cerro de los 14 colores", "Hornocal flatirons" |
| **Landmannalaugar**, Iceland (Brennisteinsalda, Bláhnúkur, Laugahraun) | Pastel rhyolite (orange, yellow, rose, pale green, blue-grey); sulfur crusts round steaming vents; emerald moss; the black Laugahraun obsidian flow (1477); braided glacial rivers over gravel | "Brennisteinsalda steam", "Laugahraun obsidian", "Landmannalaugar braided river", "rhyolite mountains Iceland" |

**Supporting landforms.**
- **Vinicunca** (Rainbow Mountain, Peru): banded slopes, colour attribution.
- **Painted Hills**, John Day Fossil Beds, Oregon: rounded bentonite hills in red, gold, lavender
  and black (formation IV's cast); "Painted Hills wet vs dry".
- **Painted Desert / Petrified Forest**, Arizona; **Bisti/De-Na-Zin**, New Mexico; **Zabriskie
  Point**, Death Valley: badland drainage density and dust-covered dip slopes.
- **Waterpocket Fold** (Capitol Reef) and **San Rafael Reef**, Utah; **Dakota Hogback** and **the
  Flatirons**, Colorado: monoclines, hogbacks and flatiron geometry.
- **Coyote Buttes "The Wave"**: lamination inside a bed (Ultra-tier micro-detail only).
- **Uluru waterfalls after rain**, Grand Canyon and Utah flash floods: ephemeral red waterfalls
  and silt-laden floods for the four-line clear.

**Geology and optics references.**
- The **rule of Vs** (structural geology textbooks; "rule of Vs geology map") for how tilted beds
  cross valleys.
- **Lenticular clouds / pile d'assiettes** (Sierra Nevada wave clouds, Mount Fuji, Patagonia).
- **Belt of Venus and Earth's shadow** photographs, and Les Cowley's *Atmospheric Optics*
  (atoptics.co.uk) for primary and secondary bow radii, Alexander's dark band and supernumeraries.
- **Wet vs dry rock** comparison photographs (the darker, more saturated wet look).

**Painters for light and colour handling.** Thomas Moran (Grand Canyon and Yellowstone canvases:
raking light on banded walls); Georgia O'Keeffe's Ghost Ranch red hills (banded hills as simple
masses); Maynard Dixon and Ed Mell (planar desert light and bold cloud shapes). Study them for
simplification and value structure, not for copying.
