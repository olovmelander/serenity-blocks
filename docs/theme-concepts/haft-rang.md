# Haft Rang: theme concept build document

| Field | Value |
|---|---|
| Name | **Haft Rang** (pronounced "haft rahng"; Persian for "seven colours"). It needs an English subtitle, and the name is a Stage 0 decision for the user (§3.14). Fallbacks from the proposal: "Seven Lights", "Orosi", "Sunglass". |
| Proposed id | `haft-rang` (registry group `biomes`; `abstract` if a light-art reading is preferred) |
| Logline | A garden pavilion on a desert morning, where the sun pours through seven colours of glass. Your board is one of its windows: every piece you set throws its colour across the carpet, every line you clear turns back into sunlight, and a chain of clears floods the woven garden with light. |
| Status | **Concept: not built.** Nothing under `src/` implements it. |
| Source | Design competition held on 2026-10-11 to replace the theme `cosmic-chimes`. Six concepts, three judges (art director, rendering lead, gameplay-feel designer), 0–10 per lens. The winner, Rainbark, is being built on branch `ccr-b2364ce7-64kjge` (commits `0c747dd` and `585ab55` so far). Haft Rang began as the seed "Haft Rang: orosi light plus Turrell". |
| Scores | Art director **8.5** (1st of 6) · Rendering lead **4.5** (6th of 6) · Gameplay feel **6.9** (6th of 6) · **Total 19.9 / 30: 5th of 6** |
| Date | 2026-10-11 |

**The six concepts and their totals**

| Rank | Concept | Art | Tech | Play | Total /30 | Build document |
|---|---|---|---|---|---|---|
| 1 | Rainbark (being built) | 8.0 | 8.5 | 8.4 | **24.9** | `docs/theme-concepts/rainbark.md` |
| 2 | Iris Springs | 7.5 | 6.5 | 8.6 | 22.6 | `docs/theme-concepts/iris-springs.md` |
| 3 | Painted Ages | 7.0 | 8.0 | 7.5 | 22.5 | `docs/theme-concepts/painted-ages.md` |
| 4 | Riverbloom | 6.0 | 6.0 | 8.0 | 20.0 | `docs/theme-concepts/riverbloom.md` |
| **5** | **Haft Rang** | **8.5** | **4.5** | **6.9** | **19.9** | this file |
| 6 | Sunfall | 6.5 | 5.5 | 7.2 | 19.2 | `docs/theme-concepts/sunfall.md` |

Haft Rang is the art director's winner and the rendering lead's last place. That split is the whole
story of this document: the picture and two of its beats are the best in the slate, and the cost,
scope and readability problems are real. §3 fixes them; build from §3 and §5, not from §1 alone.

> **How to use this file**
>
> 1. Start a **new Claude Code session** on this repository. Give it the prompt template from
>    `docs/theme-concepts/README.md`, filled in with this file's path (`docs/theme-concepts/haft-rang.md`).
> 2. Before anything else, read `docs/theme-concepts/PLAYBOOK.md`. It holds the steps every concept
>    shares: **"Choosing a slot"** (which existing theme this one replaces, or whether it is added as a
>    new one), the rename and removal checklist, the CI gates, and the headless capture tooling that
>    works in cloud containers.
> 3. Reference snapshots of the existing fleet, for side-by-side similarity checks, are in
>    `docs/theme-concepts/reference/`. For this concept compare against chromadelic-highway, ice-temple,
>    crystal-cave, neon-dusk, synthwave-sunset, aether-tides, chromatic-impasto, moonlit-greenhouse,
>    sakura-twilight, halcyon-apex and rainbark.
> 4. Read `docs/theme-concepts/rainbark.md` for the lesson that applies here: **prototype the hero
>    material on the CPU (numpy/PIL) and compare it with reference photos before writing any shader**
>    (§5.12 says what to prototype for Haft Rang).
> 5. **Precedence inside this file.** §1 is the concept exactly as proposed. §2 is what the judges said.
>    **§3 amends §1, and where they disagree §3 wins.** §5 (the implementation plan) already includes every
>    §3 change. §4 lists what must not duplicate Rainbark.
> 6. **Two Stage 0 questions go to the user before any code:** the name (§3.14) and the Persian-heritage
>    review of the look (§3.2). The second is a hard gate the art judge set as a condition of adoption.
> 7. Repo rules that apply throughout (`CLAUDE.md`): iterate in the playground first, **one small effect
>    per session**, and never call a WebGPU/TSL change done without a screenshot and a clean console
>    (ADR-0007, `docs/adr/0007-webgpu-tsl-definition-of-done.md`). Generated SFX are unavailable: if a step
>    seems to need them, stop and ask the user.
> 8. Words: never put the trademarked name of the falling-block game, or its word for a piece, in code,
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
| **kushk** | A garden pavilion. The theme's building is a *kushk* of octagonal *hasht-behesht* plan (the Safavid palace-pavilion type). |
| **orosi** | Tall walnut sash windows of girih lattice with coloured glass in the gaps, typical of Qajar and Zand garden houses. The sashes slide vertically in grooves. |
| **girih / khatam** | Persian geometric strapwork: star-and-polygon lattices. *Khatam* here means the 8-pointed star-and-cross family. |
| **came** | The walnut bar of the lattice between panes (the word is borrowed from stained-glass lead cames). |
| **pot-metal glass** | Glass coloured through its body; real panes vary slightly in value and carry small "seedy" bubbles. |
| **shamseh** | A radiating sunburst medallion; here, the glass fanlight that crowns each orosi bay. |
| **haft-rangi** | Seven-colour glazed tilework. Here it faces the dado and the arch spandrels. |
| **chahar bagh** | The fourfold garden plan: a central water channel crossed by a second, with four planted quarters. Garden carpets weave it seen from above. |
| **jub** | The stone watercourse running down the garden avenue. |
| **chadar** | A carved, scalloped stone chute in the jub that turns falling water into a white shimmer. |
| **takht** | A low raised platform for sitting. The camera sits at its edge. |
| **iwan** | A vaulted hall face open on one side; here the great recess behind the game card. |
| **chini-khaneh** | A wall of vessel-shaped niches (ewer, flask, bowl), from the music room of the Ali Qapu palace. |
| **aineh-kari** | Mirror mosaic. In §1 it faces the muqarnas; §3.2 reduces it to sparse inlays in a wooden ceiling. |
| **muqarnas** | Corbelled honeycomb vaulting. In §1 it turns the octagon into a dome; **removed in §3.2**. |
| **hurno** | A small square roof light at the crown, framed knife-edged so it reads as a flat tile of sky (James Turrell's skyspace effect). |
| **eslimi** | Floral arabesque scrolls. |
| **abrash** | Colour banding in a carpet from different dye lots. |
| **windcatcher** | The tall adobe ventilation tower of desert towns (Dowlat Abad's is 33.8 m). |
| **Wedgework** | James Turrell's light works in which light reads as a solid wall. Here: the dust-lit slabs of coloured air. |
| **Ganzfeld** | Turrell's "complete field" of coloured light in which depth disappears. Here: the perfect clear. |
| **the sun wall** | The two (at 21:9 and Extreme, three) glazed orosi bays right of the card. The only light source. |
| **the Sun Rug** | The board's own image, cast by the sun through the card (treated as one more window) onto the carpet. |
| **sash set** | One of seven interchangeable sets of sashes (girih family plus lead glass) that the level and clock rotate. |
| **`castLight(P, N)`** | The analytic gobo: for any point, where did its sunlight cross the glass and what colour was the glass there. |
| **BoardGlass** | The three-free mirror of each board's cells that feeds the Sun Rug (in §3.4 it is fed from the director's shadow well). |
| **Irrigation** | The combo: light fills the carpet's woven channels like water, then the real garden's jub. |
| **the quiet margin** | A ~40 px band round every card and HUD rect where cast-pattern detail softens. |

---

## 1. The concept in full (as proposed)

Everything in this section is the proposal as the judges scored it, with every number kept. Where §3
changes something, a marker **[amended: §3.x]** points to the change. The proposal assumed it would
take Cosmic Chimes' slot; slot-specific parts are written here for "the theme this one replaces"
(see PLAYBOOK.md "Choosing a slot").

The proposal built on two candidates of the pre-competition research survey (#20 "Haft Rang" and #32
"Ganzfeld"; the survey ranked Haft Rang 4th of its top five, citing cultural sensitivity and that "a
closed interior gives less extraordinary-landscape depth than the user asked for"), used seven web
lookups (sources in §1.10), and was checked against the catalogue of the existing themes (61 at the
time) and the fleet-wide avoid list (§1.8).

### 1.1 Name, id, logline

- **Display name: Haft Rang.** It is Persian for "seven colours". The name has three meanings, and all
  three are in the theme:
  - *haft-rangi* is the seven-colour tile craft of Persian palaces and garden houses;
  - the pavilion's windows are glazed in exactly seven colours of glass, plus clear;
  - the game has seven pieces, and each piece *is* one of those glass colours.
- **id:** `haft-rang`.
  - Registry group: `biomes`. It is a place on Earth (the replaced theme may have been in another group,
    as Cosmic Chimes was in `cosmic`); `abstract` is the alternative if a light-art reading is preferred.
  - Files: `src/themes/haft-rang/haft-rang-*.js`.
  - Capture prefix `haftRang`: `?haftRangTime=`, `?haftRangFixedDt=`, `?haftRangParts=`,
    `?haftRangFalseColor=`, `?haftRangForceWebGL=`.
- **Logline:** *A garden pavilion on a desert morning, where the sun pours through seven colours of glass.
  Your board is one of its windows: every piece you set throws its colour across the carpet, every line
  you clear turns back into pure sunlight, and a chain of clears floods the woven garden with light.*
- **The big idea in one line:** in this garden, light behaves the way water does in a Persian garden.
  Sunlight comes in through coloured glass, lands in pools, runs along the woven channels of a garden
  carpet, and finally flows out down the real garden's watercourse.

#### What it fuses (all secular)

| Source | What it gives the theme |
|---|---|
| Qajar and Zand garden houses: Dowlat Abad in Yazd, Borujerdi House in Kashan, Narenjestan-e Qavam in Shiraz | **Orosi**: tall walnut sash windows of girih lattice with coloured glass in the gaps, which link the room to the garden. Dowlat Abad also gives a garden pavilion, the 33.8 m adobe windcatcher, cypress and pomegranate trees. |
| Ali Qapu's music room (a palace) | The wall of **vessel-shaped niches** (*chini-khaneh*): deep niches cut in the shape of ewers and flasks. |
| Persian **garden carpets** (*chahar bagh*) | A woven picture of a walled garden seen from above: a central water channel crossed by a second channel, four planted quarters, borders. |
| James Turrell | The philosophy. Light is a *thing*, not just illumination. Wedgework shows light reading as a solid wall. The Ganzfeld is a "complete field" of coloured light in which depth disappears. |
| Nasir al-Mulk's early-morning light, 7 to 8 am | **Only a reference for how coloured light behaves** (pools on wool, slow creep, morning only). None of its architecture, function or layout is used. |

**The secular line, enforced in the art bible.** The building is a *kushk* (garden pavilion) of an
octagonal *hasht-behesht* plan, the type of the Safavid palace pavilion. These rules hold everywhere:
- No calligraphy, no mihrab, no prayer-hall rows of columns, no rows of prayer rugs.
- No domes with finials and no minarets in the view. The skyline beyond the garden wall is mud-brick
  vaults and a **windcatcher**.
- Ornament is limited to geometric girih, floral *eslimi* scrolls, cypress, pomegranate, rose and garden
  motifs.

**[amended: §3.2]** The art judge found these rules necessary but not sufficient: the light-on-carpet
vocabulary itself evokes the Nasir al-Mulk mosque. §3.2 adds a heritage-review gate and further changes.

### 1.2 The picture

#### Painter's description (16:9 desktop, the reference frame)

**The room.** We are seated at the edge of a low *takht* inside the octagonal hall of a garden pavilion,
about an hour after sunrise.
- Eye height 1.2 m above the carpet, 6 m from the hall's centre.
- The camera looks north-north-east, pitched 5° up, with a 50° vertical field of view (horizontal
  half-angle 39.7°). The horizon sits at about y 0.59.
- The hall is 16 m across its flats and 9 m to the cornice. Above that, three tiers of muqarnas squinches
  turn the octagon into a dome **[amended: §3.2, a coffered wooden ceiling instead]**.
- We see five of its eight faces: two glazed **sun-wall** faces on the right, the great **iwan** behind the
  card, a **garden arch** upper left, and the **niche wall** far left.

The live solo layout (card x 0.41–0.59, y 0.15–0.85; HUD x 0.635–0.71, `fallbackLayout`) leaves two broad
free fields. The picture is built so that **the right field is the source of light and the left field is
where the light lands.**

**Right of the card: the sun wall** (x 0.62–1.0, floor to y 0.02). Two bays of orosi rise the full 8.5 m
height and recede obliquely toward the right edge.
- **Frames.** Dark walnut frames, three sash columns by four sash tiers, each bay crowned by an arched
  fanlight with a radiating *shamseh* (sunburst) of glass.
- **The lattice** is a khatam of eight-pointed stars and crosses. Every gap holds pot-metal glass in the
  seven colours, plus clear panes through which the garden outside shows as backlit plane-tree leaves,
  glowing translucent green.
- **The sun stands just beyond this wall**, about 60° right of the view axis and 18–30° high. It is
  **never in frame** at any aspect.
- **How the glass glows.** It is backlit, so it blazes the way stained glass only does when the sun is
  behind it. Each pane is a slightly different value of its colour, as real pot-metal glass is. Seedy
  bubbles catch pinpricks of sun. The walnut cames are rimmed with a hairline of gold where the sun grazes
  them.
- **The open sash.** In the near bay one lower sash is raised. A sheer gauze curtain hangs in the gap,
  breathing in the breeze and glowing white-gold. Unfiltered sun pours through it onto the floor at the
  bottom right as a white patch printed with the gauze's soft folds.
- **The HUD** sits over the lower sashes of the far bay. Its calm zone softens the glass there, which is
  the only place the light is allowed to be quiet.

**Left of the card: where the light lands.** **[amended: §3.3, the arch is widened]**
- **The garden arch** (x 0.13–0.38, y 0.05–0.58).
  - A tall four-centred arch with turquoise-and-lapis haft-rangi spandrels frames the garden avenue, lit
    from the right by the morning sun.
  - Two files of Mediterranean cypresses, 14–18 m tall, recede for about 140 m. Between them runs the stone
    *jub* (watercourse), which steps down through six carved *chadar* chutes, each a white shimmer of
    rippled water.
  - Beside the avenue: beds of damask roses and pomegranate shrubs, and plane trees behind the cypresses.
  - At the end stands a gate pavilion. Beyond the ochre adobe garden wall, a 33 m windcatcher rises from
    the vaults of the town. A pale violet desert ridge lies low in the haze, 25 km away.
  - The sky is the clean, high, pale cerulean of a desert morning.
- **The niche wall** (x 0.0–0.13, plus the corner at 21:9).
  - A field of vessel-shaped niches (ewer, flask, bowl) is cut 15 cm into warm lime plaster above a 1.2 m
    tile dado.
  - The coloured beams from the sun wall cross the whole hall and land here. Each niche catches a different
    colour, and each niche lip throws a crisp shadow into its own pool.
- **The floor**, lower left (x 0.05–0.40, y 0.60–1.0).
  - One great garden carpet: a madder field, indigo borders, and the woven chahar-bagh channels (indigo
    with woven wave lines) crossing it.
  - Long sheared lozenges of coloured light from the sun wall lie over it, every lozenge printed with the
    girih lattice: crisp near the glass, softening with distance as real sun-shadows do.
  - **The Sun Rug** fans out from the card's lower-left corner (described below).
- **The air.** Between the sun wall and the floor hang **slabs of coloured light**. These are Turrell's
  Wedgework made of dust: crisp-edged where they leave the glass and softening as they travel.
  - The slabs cross in front of and behind the card on the diagonal from upper right to lower left
    **[amended: §3.13, never behind the card]**.
  - They are brightest where they point most nearly at us, which is real forward scattering.
  - Fine dust glitters only *inside* the slabs, and a speck that drifts from a rose slab into a lapis slab
    changes colour as it crosses.

**The Sun Rug: the card in the world.** **[amended: §3.4]** The game card stands in the hall like one more
window, a free-standing orosi sash set on the carpet with the sun behind it. The theme models its panes
from gameplay events, so its glass is the board.
- **What it shows.** The sun throws the board's image forward and to the left across the carpet as a long,
  sheared lattice of light, stretched about 2.2× along the light at the mean sun height.
  - Empty cells are clear glass: warm sun crossed by thin walnut lattice lines.
  - Locked cells are panes of their colour.
- **Which end is which.** The far end of the image (the board's floor, where the stack lives) lies at the
  card's foot. The near end (the board's empty top) reaches toward us. So **the higher the stack climbs,
  the further its colours walk across the carpet toward you.** This is a quiet, physical danger gauge.
- **Placement.** The Rug's direction is a composition parameter, solved from the live card rect so that it
  always lands on visible free floor: lower left on landscape, below the card on an upright phone, and
  never under the HUD.

**Top band** (y 0–0.12). The muqarnas cornice and squinches are faced with *aineh-kari* (mirror mosaic).
Thousands of tesserae catch the coloured beams as moving glints over warm bounce light.
**[amended: §3.2, coffered wooden ceiling with sparse mirror inlays]**

#### Light

| Source | How it behaves |
|---|---|
| **The sun** | The only key light. It is warm white (#FFF1D0) and enters only through glass or the open sash. |
| **Bounce** | The madder carpet throws a red-umber bounce up the plaster (#4B2D25 in the shadows). The plaster above the pools glows pale peach. |
| **Sky** | Cool cerulean, through the arch and the clear panes. It cools the shadow sides of the cypresses. |

**Value structure.** The hall is mid-to-high key, not a dark interior:
- shadowed plaster sits at about 0.35–0.5 (linear);
- coloured pools on the carpet are 0.8–2.5;
- backlit glass is 2–6, which is what blooms;
- the white sun patches are about 3–4;
- the sky in the arch is 1.3–1.8.

This fills the high-key daylight slot that the pre-competition survey flagged as the roster's biggest
gap (almost every rebuild is set at dusk, night or in space).

#### Why it has depth

There are seven planes, each with its own depth cue:
1. **Carpet pile at the camera's feet.** The knots resolve, there is wool sheen, and the Rug is big and near.
2. **The air of the hall.** Light slabs cross at 2–10 m, at different depths in front of and behind the
   card, with clear parallax as the camera breathes.
3. **The architecture** at 6–12 m: niche shadows, oblique orosi bays, muqarnas tiers overhead.
4. **The arch threshold**, a hard frame between the warm interior and the cool exterior.
5. **The avenue** at 20–140 m: cypresses diminishing in a regular rhythm, which is a perspective ruler, plus
   the jub's chutes.
6. **Gate, wall and windcatcher** at 140–400 m, with aerial perspective.
7. **The desert ridge and sky** at 25 km, a pale band.

**Light itself measures distance.** The penumbra of every cast lattice line widens in proportion to its
distance from the glass (the sun's 0.53° disc), so near pools are crisp and far ones soft. The eye reads
this as space without knowing why.

#### 21:9 (2560×1080)

- **Card and HUD:** the card shrinks to x 0.43–0.57 and the HUD sits at 0.60–0.66.
- **Left:** gains the whole arch with more avenue, and the niche wall turns its corner into view.
- **Right:** shows both orosi bays fully plus a third bay on the east face, with the open-sash curtain
  nearer the frame edge.
- **The sun** stays out of frame: 60° against a 47.4° half-angle, which leaves margin for the camera sway.

#### 16:10 and short laptops (1280×720)

The card fills y 0.06–0.94, so only the side fields remain. The composition holds because all of its
content is lateral: the source is on the right and the landing is on the left. The Rug shortens and the
solver swings it further left.

#### Upright phone (390×844)

The card fills x 0.16–0.84 and y 0.15–0.85. What remains is a frame: a top band of 123 px, a bottom band
of 123 px, and side strips of 64 px.
- **The camera** yaws 25° toward the sun wall and pitches 10° up.
- **Top band (the hero).** The upper sashes and the shamseh fanlight of the near orosi blaze edge to edge,
  with muqarnas glints above **[amended: §3.2, ceiling-inlay glints]**. At the crown is the *hurno* (roof
  light): a small square opening that, framed knife-edged in the Turrell way, reads as a flat painted tile
  of cerulean sky.
- **Side strips.** The light slabs descend diagonally through both strips, so the eye follows the light
  from its source (top) to where it lands (bottom) *behind* the card.
- **Bottom band.** The Sun Rug comes straight toward the camera (the solver aims it down the screen),
  crossed by the carpet's channels, with the glazed tile margin at the very bottom **[amended: §3.4, the
  Rug lies across the band]**.
- **The garden** appears on the phone only as backlit leaves through the open sash in the top band. On a
  phone the glass is the hero.

#### Camera behaviour

- **Rest motion:** a slow breathing sway of ±2 cm at 0.05 Hz, plus pointer parallax of ±1.5°.
- **No camera move on any gameplay event.** The house hard-drop dip is deliberately absent.
- **Reduced motion:** a static camera and no parallax.

### 1.3 Palette

#### The environment (9 named colours)

| Name | Hex | Role |
|---|---|---|
| **Sunglass** | `#FFF1D0` | Direct sun through clear panes; the brightest light in the hall |
| **Gach** | `#EEDFC4` | Lime-plaster walls and the vessel niches |
| **Madder** | `#8E1E2C` | The carpet field (madder-root red) |
| **Indigo** | `#1D2B57` | Carpet borders and the woven water channels |
| **Walnut** | `#3F2519` | Orosi frames, girih lattice, the lines of the cast lattice |
| **Kashi Turquoise** | `#2A9C94` | Ground of the haft-rangi tile dado and the spandrels |
| **Desert Morning** | `#CFE3EC` | Sky and garden haze |
| **Cypress** | `#25442F` | Garden trees, cooled by sky on their shadow side |
| **Umber Bounce** | `#4B2D25` | Plaster in shade, lit by the carpet's red bounce |

#### The seven glasses (shared with the pieces; see §1.6)

| Glass | Hex |
|---|---|
| Saffron | `#E8781A` |
| Lapis | `#2646B8` |
| Damask Rose | `#F98BBE` |
| Banafsheh (violet) | `#A47BF2` |
| Firuzeh (turquoise) | `#0B8A80` |
| Pomegranate | `#C42131` |
| Pistachio | `#C9E263` |
| Clear | Sunglass |

**Cast-light colour.** The light a glass casts is its transmittance normalised to a peak channel of 1, so
it is brighter and more saturated than the glass's body colour. Overlapping pools add (see §1.7)
**[amended: §3.11, the mixing formula and per-glass pool gain]**.

For builders, the normalised cast colours (computed for this document: sRGB → linear, divided by the
largest channel; Y = Rec. 709 luminance of the normalised colour):

| Glass | Hex | Linear RGB | Cast colour (normalised) | Y |
|---|---|---|---|---|
| Saffron | `#E8781A` | (0.807, 0.188, 0.010) | (1.00, 0.23, 0.01) | 0.38 |
| Lapis | `#2646B8` | (0.019, 0.061, 0.479) | (0.04, 0.13, 1.00) | 0.17 |
| Damask Rose | `#F98BBE` | (0.947, 0.258, 0.515) | (1.00, 0.27, 0.54) | 0.45 |
| Banafsheh | `#A47BF2` | (0.371, 0.198, 0.888) | (0.42, 0.22, 1.00) | 0.32 |
| Firuzeh | `#0B8A80` | (0.003, 0.254, 0.216) | (0.01, 1.00, 0.85) | 0.78 |
| Pomegranate | `#C42131` | (0.552, 0.015, 0.031) | (1.00, 0.03, 0.06) | 0.24 |
| Pistachio | `#C9E263` | (0.584, 0.761, 0.125) | (0.77, 1.00, 0.16) | 0.89 |
| Clear (Sunglass) | `#FFF1D0` | (1.000, 0.880, 0.631) | (1.00, 0.88, 0.63) | 0.89 |

The 5× luminance spread (lapis 0.17 to pistachio 0.89) is a gap the proposal did not address (§3.11).

#### What changes, and why it is not an hour wheel

The time of day never turns: it is always the same hour of a desert morning. Four world-native drivers
vary the look instead.

**A. The sash change (driven by level, plus the clock).**
- **The mechanism.** Real orosi sashes slide vertically in grooves. Here, the pavilion keeps **seven sash
  sets** in the wall cavities.
  - Each set is a different girih family with a different lead glass. Every set carries all seven colours,
    so every piece colour always has a pane.
  - On a level up, the current sashes rise into the cavity and the next set descends.
- **What you see.** A **hard-edged front** sweeps down every window and, through the light, across every
  projected surface: floor, niches, slabs, muqarnas glints. The old pattern stays above the front and the
  new one appears below it, over 2.4 s. It is a physical wipe of light, not a palette cross-fade.
- **Clock and other modes.** The clock also advances a set after every 150 s of active play. In Infinity
  (no LEVEL_UP), a set also advances after 15 lines; in local and online multiplayer, the clock alone
  drives it.

| # | Set | Lead glass | Accents | Lattice |
|---|---|---|---|---|
| 1 | *Za'feran* (saffron) | Saffron | Pomegranate, clear | 8-fold khatam |
| 2 | *Lajvard* (lapis) | Lapis | Firuzeh, clear | 10-fold stars **[amended: §3.10, 6-fold]** |
| 3 | *Golab* (rosewater) | Damask Rose | Violet, Pistachio | 12-fold shamseh |
| 4 | *Sarv* (cypress) | Pistachio | Firuzeh, Saffron | 8-fold, split petals |
| 5 | *Anar* (pomegranate) | Pomegranate | Saffron, Rose | 10-fold **[amended: §3.10, 6-fold]** |
| 6 | *Banafsheh* (violet) | Banafsheh | Lapis, Rose | 12-fold |
| 7 | *Firuzeh* (turquoise) | Firuzeh | Pistachio, Lapis | 8-fold with crosses |

**B. The sun's walk (clock).**
- The sun follows a slow closed-form loop with a 360 s period: azimuth 54–66°, elevation 18–30°. It is a
  "held morning", not a rising sun.
- Every pool and slab drifts, at most 3 cm/s near the glass and 8 cm/s at the far wall. Pools lengthen and
  shorten, and the Rug's stretch breathes between 1.7× and 3.1× **[amended: §3.4, 1.4–2.2×]**.
- It is deterministic in `seek(t)`.

**C. The air (gameplay and ambient).**

| State | What it looks like |
|---|---|
| **Still** | Thin slabs, crisp pools. This is the rest state. |
| **Breeze** | Curtains billow and leaf dapple moves. Triggered by clears and an idle breath. |
| **Dust** | Solid slabs. Triggered by hard drops and long chains **[amended: §3.6, hard drops lift only local dust]**. |
| **Veil** | A thin high cloud passes every 3–5 min: the sun drops 30%, the penumbra widens 3×, and every pool goes soft for about 20 s, then sharpens again. |

**D. The curtains (lifecycle).** Open while playing. Drawn on game over: diffuse light, no edges, no
beams. Gathered back on a new run.

### 1.4 Environmental animation (everything that moves)

**[amended: §3.3, more motion]**

| Element | Motion | Rate |
|---|---|---|
| Sun's walk | Closed loop (§1.3 B); every pool, slab, glint and penumbra follows | 360 s period |
| Sash sets | Clock advance (§1.3 A) | Every 150 s of active play |
| Dust density | Slow rise of 1.5 cm/s; lateral drift with the breeze 0–20 cm/s; two noise octaves (0.6 m, 0.15 m) evolving | 0.05/s |
| Dust glints (motes) | Closed-form Lissajous drift per mote; colour taken from the light at the mote's position, so it changes as the mote crosses a slab edge; a twinkle when it crosses a lattice line | Periods 9–23 s, amplitude 5–25 cm |
| Gauze curtain (open sash) | Billow from summed travelling waves; gusts every 18–35 s raise it ×3 for 3 s; its folds print moving soft shadows in the white sun patch | 0.12–0.2 Hz, 3–15 cm |
| Leaf dapple | The plane tree outside the near bay modulates the sun through that bay with moving soft spots (komorebi through glass) | Drift 0.3 m/s, flutter 0.5–1.2 Hz, depth 10–25% |
| Cypresses | Very slight sway, phase-offset per tree | 0.12 Hz, ±0.5° |
| Plane-tree canopies | Leaf shimmer; backlit leaves seen through the clear panes glow | Noise scroll 0.2/s |
| Jub and chadar chutes | Flow-map scroll over the carved scallops; white sparkle; small ripples in the level runs | 0.8 m/s on the chutes, 0.2 m/s in the runs |
| Mirror-work vault | Glints shift with the sun's walk and the camera sway | Follows the sun |
| Glazed tiles | Soft coloured reflections of the glowing glass slide with the camera sway (each hand-made tile tilts slightly differently) | Follows the camera |
| Pigeon cameo | A pigeon lands on an outer sill. Its silhouette appears on the glass and *in one pool on the floor*; it preens, then flies off | Every 45–120 s, lasting 3–5 s |
| Veil | A thin cloud softens the light (§1.3 C) | Every 3–5 min, 20 s each |
| Garden haze | Faint brightening near the horizon on the sun side as the sun walks | Follows the sun |

Nothing in the world blinks or strobes. Every ambient change is slower than 0.5 Hz, except the leaf
flutter, which is small in area and amplitude.

### 1.5 Gameplay event language (as proposed)

#### The grammar

The world has five physical verbs, and every event is built from them:
- **cast:** light through glass draws the panes' image on whatever it falls on;
- **mix:** overlapping coloured light adds, toward white;
- **reveal:** dust makes light a solid thing;
- **flow:** in this garden, light behaves like water;
- **slide:** sashes and curtains move in their grooves.

Two rules follow from this:
- **Nothing ever flies out of the card.** Light does not travel as a projectile; it is cast instantly and
  shows where it lands.
- **The world never "holds" a colour for show.** The Sun Rug shows a colour exactly as long as that piece
  is in the board, because it is the board's own light.

#### The event table

| Event | Beat name | What you see (timing) | Why it is native, and why it is not house grammar |
|---|---|---|---|
| **Lock** **[amended: §3.4]** | *Sun-catch* | **Landing.** In the Sun Rug, the piece's four cells land as four panes of its colour, stretched along the light, exactly where its rows and column throw. **Sequence:** a thin glint runs down the card's dust slab to the Rug (0.18 s). The new panes bloom to 1.5× and settle (τ 0.35 s), and the carpet pile under them sparkles. **Mixing:** where the new colour overlaps sunlight from the sun wall it adds, so rose over turquoise turns pale lilac. **Lifetime:** the colour stays exactly as long as the piece is in the board. | The light is *cast*, not sent: there is no wisp, no flight and no target object. The persistence is real, because it is a live image of the board, not a 30 s hold that a clear releases. |
| **Hard drop** **[amended: §3.6]** | *Dust* | **The thud lifts carpet dust.** For about 1.6 s every slab in the hall thickens into a solid Wedgework wall of coloured air. Density rises ×3 near the floor and settles from the bottom up. **Also:** the new panes land with an extra-bright core, and the gauze curtain flinches inward. **Strength:** 0.3 + 0.7·min(1, distance/18). | Turrell's "light as a thing" is triggered by a physical cause (dust). There is no camera dip or shake. |
| **Line clear ×1, ×2, ×3** **[amended: §3.5]** | *Clear glass* | **Flare:** each cleared row's stripe in the Rug flares. Its ten colours slide together and add up to white-gold sun (0.12 s rise, 0.25 s merge). The glass is gone, so the stripe is pure sunlight, the theme's namesake physics run backwards. **Run-off:** the white light cannot stay. It runs off the Rug into the nearest woven channel of the carpet as one pulse whose reach grows with lines: 1 line reaches the first junction, 2 lines the cross channel, 3 lines a whole quarter. It fades over 1.6 s. **Slide:** the image of the rows above then slides down toward the card's foot, matching the board's own collapse. | Stripes *lie on the floor* inside the cast image, mixing colour into white. Nothing beams out of the card. There is one flow pulse whose volume scales with lines, not one wave front per line. |
| **Four lines** **[amended: §3.7]** | *Haft Rang* | **0.0 s:** the four stripes go white. **0.1–0.6 s:** every sash of the sun wall rises together, lowest tier first. The hall floods with clear morning sun: exposure eases up by at most +0.45 stop and there is no flash frame. The dust ignites into one great slab of white air. **0.7–2.1 s:** the sashes fall back tier by tier, top first, and each tier re-cuts the white flood into one glass colour. The hall ends crossed by **seven stacked slabs**: pomegranate, saffron, pistachio, firuzeh, lapis, banafsheh, rose. They lie over the carpet and up the niche wall like a spectrum the room has woven. **2.1–6 s:** the seven bands pour into the carpet's channels, run the whole woven garden at once, cross the threshold, and run down the avenue's jub to the far gate. **By 7 s:** faded. | White light splitting into seven colours is *haft rang* itself. There is no hush and no flare out of darkness: the room opens, floods, then splits. |
| **Combo chain** (true combo, `ComboTracker`) **[amended: §3.9]** | *Irrigation* | The carpet's woven channels fill with light like water, fed from the Rug. **Each step adds a band** in the colour of the piece whose lock made the clear, so the channels carry ordered coloured bands (newest nearest the Rug). **Escalation:** **2** a thread lights the head channel; **3** it reaches the central medallion pool, which brims with a disc of light; **4** the cross channel's four arms run to the borders and the woven wave lines shimmer; **5** the side channels of the four quarters fill and the guard stripes catch light; **6** the woven trees bloom in their own colours (cypress pistachio, pomegranate crimson, roses rose); **7** the light leaves the carpet, runs over the threshold into the garden's jub, and the first chadar chute shimmers in colour (seen through the arch); **8** each chute down the avenue lights in turn; **10+** the far gate's arch fills with light and the hall's dust thickens into slabs. **Release on break:** the light keeps flowing downstream and empties. The head channel goes dark first and the far reaches last (2–3 s). From 7 up, the last colour visibly runs out through the far gate. | A garden irrigated with light is the theme's core surrealism. The meter is spatial (how far the light has run), so it is readable at a glance. It does not circle the board, it is not a vortex, and it is not a single intensity dial. |
| **Back-to-back** | *The mirrors answer* | A cascade of coloured glints runs through the muqarnas mirror-work from the sun wall across the vault (0.9 s). The vault keeps a coloured sheen for the life of the streak, with strength ×1, ×2 or ×3+. A non-difficult clear (detected by the director) lets it fade over 3 s. **[amended: §3.2, the glints run through the ceiling's mirror inlays]** | Aineh-kari is a real secular palace craft. It plays at the top of the screen, a different place from every other beat. |
| **T-spin** | *The lattice turns* | Every girih star in every window turns one step (45° for 8-fold, 36° for 10-fold, 30° for 12-fold) with a 0.35 s spring and a glint along every came. Each star's petals hold different colours, so the **whole projected pattern** on floor, niches, slabs and vault clicks one notch, like a kaleidoscope. **Doubles and triples:** a T-spin double or triple gives 2 or 3 clicks, 0.18 s apart. **The piece itself:** the T's own rose panes twist into place in the Rug. **[amended: §3.10, 60° for the 6-fold sets; petals must differ in colour]** | The rotation belongs to the lattice's symmetry and happens everywhere at once. There is no spiral or wheel round the card. |
| **Perfect clear** **[amended: §3.8]** | *Ganzfeld* | **0–1.4 s:** dust rises everywhere into a luminous coloured fog, and walls, glass and floor lose their edges. **1.4–7 s:** the hall is one field of coloured light with no depth, Turrell's "complete field". It breathes slowly through the current sash set's colours: at least 0.9 s per hue, luminance held constant, no red step. **7–9.5 s:** the fog thins from the glass outward and reveals the pavilion re-glazed. The Rug is a clean lattice of white sun (the board is empty), the woven garden is fully lit and draining, and a new sash set stands in the windows. | It is a real artwork's phenomenon, and the rarest event gets the most surreal image. It is calm, not explosive. |
| **Level up** | *Sash change* | The sash change of §1.3 A: a hard-edged front of new light wipes down every window and across every lit surface (2.4 s). The new set's girih family and lead colour take over the room. | A mechanical, physical wipe. The time of day does not turn and there is no palette cross-fade. |
| **Game over / top-out** (window `gameOver`, `modeStopped`) | *Curtains drawn* | Sheer silk curtains unfurl across every orosi from the sides (1.6 s). The light loses its edges: pools blur into soft washes of mingled colour, the slabs vanish (diffuse light makes no beams), the Rug fades to a faint glow, and the channels drain. The hall waits in soft rose-amber. **On `modeStarted`:** the curtains gather back in 1.2 s and every edge snaps crisp, which is the reveal. | Lifecycle expressed by textile and light, with no darkness and no collapse. |
| **Idle, no play** | *The morning holds* | **After 20 s:** dust settles and the slabs fade to a whisper over 40 s. **Breeze:** every 25–40 s a breeze from the garden lifts the gauze and stirs the dust, so the slabs come back softly for about 8 s. **Ongoing:** leaf dapple drifts over the pools, the pigeon cameo plays, the jub sparkles, and the sun walks. **Every 150 s:** a sash change. | Ambient life of the place itself. |

#### Readability at a glance (each beat has its own place and signature)

| Beat | Where it plays | Scale |
|---|---|---|
| Lock | Lower left (the Rug) | Small |
| Hard drop | The whole air **[amended: §3.6, the card's own beam]** | Medium |
| Clear | The Rug, then the carpet channels | Medium |
| Four lines | The right wall, then the whole hall, then the garden | Large |
| Combo | The carpet network, then the garden avenue | Grows |
| B2B | The vault, top | Distinct |
| T-spin | Every pattern, a rotational click | Distinct |
| Perfect | The whole field | Largest |
| Level | A moving wipe | Distinct |
| Game over | Softening | Distinct |

#### Accessibility and photosensitivity

**Exposure.** Only the four-line beat (at most +0.45 stop, eased over 0.4 s) and the perfect-clear beat
(at most +0.35 stop over at least 1.2 s) lift exposure. `flash = max(flash, x)` never stacks.
**[amended: §3.7 and §3.8, +0.25 and +0.2 stop of measured mean luminance]**

**Other limits:**
- White clear stripes are each at most about 6% of the screen, ramp up in at least 0.12 s, and pass a
  global limiter of at least 0.35 s between luminance peaks. Rapid cascades therefore cannot strobe
  (WCAG 2.3.1). **[amended: §3.5, no white stripes at all]**
- There is never a saturated-red full field. The Ganzfeld hue walk holds luminance and skips the
  pomegranate step.
- HDR is clamped before bloom.
- Calm zones keep the card and HUD readable through every beat, including the Ganzfeld.

**Reduced motion:**
- No sway and no parallax.
- The T-spin click becomes a 0.6 s cross-fade, and the sash change a 1.2 s cross-fade.
- Dust slabs ×0.5, curtain billow ×0.3.
- The Ganzfeld hue walk runs at half speed and 30% less saturated **[amended: §3.8, one held hue]**.
- No pigeon.
- Irrigation keeps its reach but drops its shimmer.

#### Other modes

| Mode | Behaviour |
|---|---|
| **Local multiplayer** | Each card is its own window and casts its own Rug (up to 5 slots). Local multiplayer sends no TSPIN, B2B or LEVEL_UP, so sash sets follow the clock. Its cascade depth arrives only as COMBO, which precedes the wave's LINE_CLEAR, so it is stashed and applied to the next clear of the same slot. |
| **Online multiplayer** | Slot 0, with `#online-main-board canvas` added to the selectors. |
| **Infinity** | Rug rows come from `viewportOrigin`. Mirror cells not reconfirmed for 120 s age out (self-healing). Sash sets advance every 15 lines or 150 s. |
| **Meditation** (`serenity`) | There is no card, so each click *catches the sun* at the click: a pane-shaped pool of the next glass colour lands on the floor or wall under the pointer. Click combos irrigate the carpet. |
| **Odyssey** | Synthetic clears with empty rows use the bottom rows (19−i), as the siblings do. If the replaced theme owns an Odyssey orb, Haft Rang inherits it through the retired-id alias (`RETIRED_THEME_IDS` in `src/themes/theme-registry.js`); worked example: Cosmic Chimes' orb 47 passed to Rainbark (§5.1). |

### 1.6 Piece colours (as proposed) **[amended: §3.12, S/Z/J remapped away from Rainbark]**

The pieces are the seven glasses. Each one is named for something in the garden.

| Shape | Glass | Hex | Hue | Standard-guideline band (hue) | Match? |
|---|---|---|---|---|---|
| **I** | Saffron (the long bar is a sunbeam) | `#E8781A` | 27° | cyan (160–210) | no |
| **O** | Lapis (the square tile) | `#2646B8` | 227° | yellow (32–75) | no |
| **T** | Damask Rose | `#F98BBE` | 332° | purple (245–315) | no |
| **S** | Banafsheh (violet) | `#A47BF2` | 261° | green (90–170) | no |
| **Z** | Firuzeh (turquoise) | `#0B8A80` | 175° | red (320–20) | no |
| **J** | Pomegranate | `#C42131` | 354° | blue (200–250) | no |
| **L** | Pistachio | `#C9E263` | 72° | orange (20–50) | no |
| GARBAGE | Walnut came (smoked glass in dark wood) | `#2E2522` | | | |
| CLEAN_GARBAGE | Seedy clear glass | `#B9AE9F` | | | |

**Palette gate:** 0/7, the house ideal (the same as Summer, Ocean, Verdant Hills, Galaxy and Aether Tides).
It is computed with the gate's own `hexToHue` (`scripts/palette-guideline-check.mjs`, `npm run check:palette`;
it fails if all seven shapes land in their bands and warns at 6/7).

**Colour-blind separation.** Deuteranopia, protanopia and tritanopia simulated (Machado 2009 matrices,
severity 1, applied in linear RGB) with CIE ΔE76 between every pair of pieces. **Re-verified for this
document; the numbers hold.**

| Vision | Closest pair | ΔE |
|---|---|---|
| Deuteranopia | I and L | 22 |
| Protanopia | T and Z | 22 |
| Tritanopia | I and J | 24 |
| Normal | O and S | 29 |

The set was tuned by value (lapis dark, violet light, rose light, turquoise deep) because the first draft
collapsed lapis and violet to ΔE 1 under protanopia.

**How the cells look on the board** (Phaser premium path, `renderMode: 'solid'`). The aim is pot-metal
glass in lead:
- `effects.phaser`: `{ gradient: true, highlight: 0.28, shadow: 0.2, rim: true, rimAlpha: 0.62, rimWidthFactor: 0.07, gloss: true, glossAlpha: 0.1 }`.
- **Gradient:** a lighter centre, as glass is when backlit.
- **Rim:** a dark walnut rim that reads as the came.
- **Gloss:** one faint gloss stroke.
- **What it avoids:** no glow, pulse or shimmer, so the next queue, the ghost, opponent views and Canvas
  previews stay clean.
- **The ghost** is a clear-glass outline.

**In the world** the same colours appear as *light*, normalised and brighter (§1.3). A piece's body colour
on the board and its cast pool on the carpet are visibly the same glass seen two ways.

### 1.7 Rendering plan (TSL, three r186.1, WebGPU with the WebGL2 backend)

**[amended: §3.10 for scope and cost; §5 has the amended plan]**

#### House principles kept

- Every surface is a self-lit `MeshBasicNodeMaterial` reading one shared uniform bag `u`, scene-linear HDR.
  There are **no scene lights, no shadow maps, no `ShaderMaterial`, no compute and no MRT.**
- The **only render targets** are the post pipeline's own. There is no env target and no planar
  reflector: tiles reflect the glass analytically.
- **Noise:**
  - a CPU-baked 2D fBm (half-float with CPU mips);
  - one 256² RGBA8 lattice texture for 3D value noise, using the Void Ember 2D-lattice trick (`u.noise3`,
    one fetch, two fields; precedent `src/themes/void-ember/void-ember-tsl.js`).
  - **No `Data3DTexture`, no `lut3D`, no `mx_noise`.**
- Events write numbers into preallocated slots and a timed queue, so `seek(t)` plus a fixed-step replay
  reproduces any frame. Rate-varying phases (sun walk, flow front, dust drift) are integrated and wrapped.
- Every pool is always drawn, with dormant slots at zero size, so the first frame compiles every pipeline.
- **One scene pass and one output pass.**

#### The heart: `castLight(P, N)`, an analytic gobo with physical penumbra

Every lit surface, and every air sample, asks one question: *where did the sunlight reaching this point
cross the glass, and what colour was the glass there?*

```
// for each source window w (sun-wall bays A, B [, C at 21:9/Extreme], board windows 0..n-1)
t   = dot(w.origin - P, w.normal) / dot(toSun, w.normal)  // distance back to the glass plane
q   = P + toSun * t                                       // crossing point
uv  = vec2(dot(q - w.origin, w.right), dot(q - w.origin, w.up)) / w.size
pen = t * (SUN_DIAMETER_RAD * (1 + 2*veil)) + footprint(P) // penumbra, glass units
T   = glass_w(uv, pen)                                    // rgb transmittance, soft cames
sun += SUN_RGB * T * insideSoft(uv, pen) * dapple_w(uv) * (1 - curtain_w(uv))
light = sun * max(dot(N, toSun), 0) + bounce(P, N) + sky(N) * ao
```

(`SUN_DIAMETER_RAD` = 0.53° ≈ 0.00925 rad. Guard the division: `dot(toSun, w.normal)` must be bounded
away from zero with a signed epsilon, and `t ≤ 0` means the point is on the sun side of the glass.)

**Glass function (`glass_w`) for the sun-wall bays.** These are analytic girih, so no glass texture
exists **[amended: §3.10, a small CPU-baked glass image for far pools, air and reflections]**.
- `hrGirih(p, fold, turn)` is a **laid-out pure `Fn`**. From the lattice coordinate it returns
  `vec4(cellCode, petal, sdfToCame, cellSize)`. The fold is 8, 10 or 12, and `turn` is the T-spin rotation
  of each star about its centre.
- **Colour:** `palette[hash(cellCode, petal, set)]`, with the set's lead weights and a ±6% pot-metal jitter
  per pane.
- **Penumbra blending:** `mix(cell, bayMean, smoothstep(0.25, 1.0, pen / cellSize))`.
- **The came:** `smoothstep(hw - pen, hw + pen, |sdf|)`, where `hw` is the half-width of the walnut bar.
- **Result:** antialiased at any distance, with the moiré killed by physics. Far pools wash toward the
  bay's mean colour, exactly as real stained-glass light does.

**Board windows (the Sun Rug).**
- Each board window is the live card rect projected onto a virtual vertical plane at the card's depth.
  `composition.js` solves this, together with the art-directed Rug direction for each aspect band.
- **Glass:** one 64×32 RGBA8 `DataTexture` atlas holds 5 slots of 10×20 cells with gutters.
  - `rgb` = glass colour (clear where the cell is empty); `a` = lock sequence number mod 256.
  - Nearest filtering is used for the cell code; came lines are analytic. A second `LinearFilter` read
    gives the soft penumbra, and per-slot mean colours sit in the palette array.
  - It is updated only on events, about 800 bytes with `needsUpdate`.
- **Animated pieces:**
  - **Landing bloom:** compares `a` with the lock-time table.
  - **Clear flare:** compares the row with up to 4 flaring rows per slot.
  - **Collapse slide:** a closed-form row remap from at most 4 cleared rows.

**Cost.**
- Two to four ray–plane tests per point. The girih is evaluated only for windows whose softened quad
  contains `uv`, inside `If(inside)`.
- Most points see one window. Surfaces facing away (`dot(N, toSun) ≤ 0`) skip everything.
- Additive mixing where pools overlap is capped hue-preservingly, `hue / Σw³ · (Σw / (Σw + 1)) · 2`
  (gotcha #157 in `.claude/skills/webgpu-threejs-tsl/SKILL.md`), so three pools never burn to flat white
  **[amended: §3.11, #157 gives the hue to the strongest pool and would erase the mixing this theme is about]**.

#### Per element

| Element | Technique | Notes |
|---|---|---|
| **Sky and garden backdrop** (`-sky.js`) | One analytic function of direction: a cerulean zenith falling to a dust-white horizon; a warm aureole on the sun side (the sun is off-frame); low haze. A **backdrop variant** for views *through glass*: direction-space canopy silhouettes of plane trees, backlit and translucent green, plus a refraction wobble from seedy glass (fBm-gradient offset 0.01). | Drawn as a far-plane triangle, last among the opaques (gotcha #100). |
| **Garden through the arch** (`-garden.js`) | Ground plane with procedural gravel, beds and rose dots. **Jub and chadar chutes:** a scalloped normal pattern plus a flow-map scroll and sparkle. Moving water in narrow stone, never a still mirror. **Cypresses:** instanced camera-facing impostors, with an analytic flame silhouette as an SDF and a normal rebuilt from the SDF, so they are side-lit from the right and sky-cooled on the left; vertex sway. **Plane trees:** billboards with baked leaf noise. **Gate, wall, windcatcher:** low-poly boxes with procedural adobe. Aerial perspective is bounded, `exp(-max(d,0)·k)` (gotcha #71). | Small screen area, so cheap. The combo flow front continues into the jub (beyond carpet distance 1), which keeps it continuous. **[amended: §3.10, far garden painted in the backdrop]** |
| **Floor** (`-hall.js`) | **Carpet:** a colour map plus an aux map (channel mask, geodesic distance `d` from the medallion along the channel network, motif class, pile AO). It is CPU-baked from one deterministic design (chahar-bagh borders, guards, madder field, indigo channels with woven wave lines, cypress, pomegranate and rose motifs, *abrash* dye-lot banding). A build-time script writes it to two PNGs (≤ 400 KB each), with a runtime CPU fallback. **Wool:** a soft sheen lobe at grazing angles, and pile fBm on Medium and up. **Tile margin:** glazed haft-rangi tiles reflect the glass analytically. The reflected ray hits the window planes and `glass_w` is called with `pen` set by roughness. Each tile gets a hashed normal tilt (hand-made unevenness), so the reflection breaks up and never forms a mirror. | `castLight` plus the carpet maps. The channel flow is evaluated here. |
| **Walls, dado, iwan** | Lime plaster with baked trowel fBm, and a haft-rangi tile dado (a CPU-baked tile atlas). Bounce comes from a CPU-computed room-average sunlight colour, which follows the sash set and the board colours, times AO. | |
| **Niche wall** | An analytic heightfield SDF of staggered vessel niches (ewer, flask, bowl; 15 cm deep). Parallax mapping (4/8/12/16 steps). **Self-shadow:** a short march along `toSun` in the heightfield (4–8 steps), so each lip throws its shadow into its own pool. `castLight` runs at the displaced point. | Flat normal from the SDF on Low and Minimal. |
| **Muqarnas and mirror-work** **[amended: §3.2, replaced]** | A CPU mesh generator: 2–4 corbelled tiers of concave cells (6–12 triangles each). Mirror tesserae get a hashed facet normal; the reflected view ray hits the window planes and `glass_w` gives coloured glints. A B2B sweep front and streak sheen come from uniforms. **Hurno:** a knife-edged square that is unlit flat sky colour (the Turrell aperture). | 6k–25k triangles by tier. |
| **Orosi glass** (`-orosi.js`) | Backlit glass, seen directly: `SUN·T·(0.35 + 0.65·HG(dot(V, toSun), g 0.7))` plus `sky·T` plus, through clear cells, the backdrop function along the view ray. Plus seedy-bubble pinpricks (hash in cell space), pot-metal jitter and gold rim light on the cames where the sun grazes. **Frames:** walnut geometry. **Sashes:** a per-tier vertical offset uniform; cells that slide out of the frame show open air. **Gauze curtain:** a cloth sheet with travelling-wave vertex displacement; translucent (it transmits the sun) and it receives `castLight`. **Silk curtains** (game over): sheets sliding on a uniform, which also multiply `curtain_w` into `castLight` and widen the penumbra (diffusion). | The same `hrGirih` is used for the glass and for the light it casts, so they can never disagree. |
| **Air slabs** (`-air.js`) **[amended: §3.10, analytic chord plus a few glass-image taps]** | **One full-screen triangle in the scene pass**, drawn after the opaques, additive premultiplied (CustomBlending One/OneMinusSrcAlpha with `vec4(rgb, 0)`, gotcha #90). **Geometry:** for each window, the analytic ray against the swept prism (window quad × `toSun`). **March:** N samples inside `[t0, t1]`, clipped by the room's analytic floor and wall planes, so no depth buffer is needed. **Per sample:** `density(x) · SUN · glass_w(uv(x), pen(x)) · HG(g 0.55)`. **Density:** haze plus 2 octaves of `u.noise3` plus event terms (dust puffs, chain dust, Ganzfeld). **Speed-ups:** interleaved-gradient jitter on the start (hidden by grain), and an **early out inside the card rects**, since slabs behind the card are invisible. | This is the main per-tier cost lever. Phase is written as products and the cosine clamped (gotcha #94). |
| **Dust glints** | Instanced quads (`InstancedBufferGeometry`, 2 attributes) with closed-form drift. The vertex stage evaluates `castLight` at the mote, which gives its colour and visibility. Brightness follows HG toward the camera. Size is floored at 1.15 buffer px with dimming below that (gotcha #147). | They are invisible outside slabs by construction, so they never become a bokeh field. |
| **Channel flow (Irrigation)** | `lit = mask · smoothstep(F + soft, F, d) · ring(F - d) · shimmer(noise(d·k - t·v))`. `F` is the integrated flow front and `ring` is a 10-entry colour ring of chain steps. **Drain:** a second front `F_drain` advances behind. Because `d` is the flow coordinate, the shimmer flows *along* the channels for free. **Clear run-off:** a short-lived front injected at the Rug. **Four lines:** sets `F = 1 + avenue`. | One aux fetch plus one noise fetch. |
| **Ganzfeld** | Every material ends with `mix(col, field, gz · (1 - exp(-max(dist,0)·k)))`, so near things stay faintly present and depth dissolves. Dust density rises globally. The post collapses local contrast toward the bloom mip outside calm zones. | One uniform and one mix; no extra pass. |

#### Event plumbing (one table, as in the house)

`u.events = uniformArray(rows, 'vec4')` with **at most 48 rows**: lock landings 8, clear stripes 8, dust
puffs 4, flow fronts and colour ring 12, sash tiers and the four-line phase 6, plus one row each for the
T-spin click, mirror sweep, Ganzfeld, sash-change front, curtain, pigeon, veil and dapple. A second array
holds the palette (7 glasses plus clear, 7 sash-set weight rows, slot means): at most 32 rows. That is
**two uniform buffers** in total, well under the 12-per-stage limit (gotcha #102).

The world compacts live rows and loops `Loop({ start: int(0), end: u.count, ..., name })` with distinct
names (gotchas #110 and #155).

**The board-light mirror** lives in `-core.js`. It is three-free and unit-tested
**[amended: §3.4, fed from the director's shadow well, plus garbage-push inference]**:
- `BoardGlass` holds 5 slots × 10×20 colour indices.
- **On lock:** stamp the occupied cells of the locked orientation.
- **On clear:** flare, then remove the reported rows and shift down.
- **Reset:** on run start and on perfect clear.
- **Self-healing:** a clear row that the mirror thinks is not full borrows its neighbours' colours; in
  Infinity and online, cells untouched for 120 s age out.
- It is ambient light, so a stale cell is never a gameplay error.

#### Post (`-post.js`)

The house `RenderPipeline`, with these specifics:
- **Scene pass:** MSAA on High and up.
- **Bloom:** max-channel knee bloom (threshold 1.0, knee 0.5, hue-preserving high-pass clamp). It catches
  the backlit glass, the white sun patches and the irrigation fronts. The threshold follows the exposure
  (iris).
- **Output pass:**
  - calm zones (the house SDF clip);
  - bloom, then exposure plus the capped flash;
  - **"glass filmic":** a hue-preserving max-channel shoulder (k 0.5) that whitens only above a peak of 6,
    so saturated pools stay saturated while the sun patches whiten;
  - grade: shadows lean umber, highlights cream, saturation 1.08;
  - vignette 0.28, then sRGB, then grain 0.012 and dither.
- **Ganzfeld helper:** `mix(S, bloomLowMip, gz·(1 - calm)·0.6)`.
- **No rush, fringe or screen-space shafts.** The slabs are real geometry-free volumes.
- **Fallback:** `createPassThroughPipeline` with AgX if the post throws.

#### Quality tiers (content `QUALITY`; every tier keeps the whole picture and every event)

**[amended: §5.8]**

| | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Pixel-ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |
| Girih | 8-fold stars, no split petals, set lattices simplified | + petals | full families, seedy glass | + pot-metal jitter, bubbles | = | = |
| Air slabs | 1 analytic sample per window (mid-slab colour × thickness) | 3 samples | 5 | 8 | 12 | 16 |
| Dust glints | 0 | 120 | 300 | 600 | 1000 | 1600 |
| Sun Rug / board windows | full | full | full | full | full | full |
| Channel flow | flat glow, no shimmer | 1-octave shimmer | 2 octaves | + specular glints | = | = |
| Niche wall | albedo + baked AO | SDF normal | parallax 4 | parallax 8 + shadow 4 | 12 + 6 | 16 + 8 |
| Muqarnas | 2 tiers, sheen only | 2 tiers, static glints | 3 tiers, sun glints | 3 + facet jitter | 4 | 4 |
| Tile reflections | constant sheen | 1 sample | 1 sample + tilt | 2 samples | 3 | 4 |
| Carpet maps | 1024×512 | 1024×512 | 2048×1024 | 2048×1024 + pile fBm + sheen | = | = |
| Garden | sky, ground, 10 cypresses, static water | 16 + flow | 24 | 32 + plane shimmer | 40 | 48 |
| Curtains | static planes | 8×16 | 16×32 | 24×48 | 32×64 | 32×64 |
| Third sun-wall bay | off | off | off | 21:9 only | 21:9 only | always |
| Bloom / MSAA | off (an analytic glass-glow term near windows) | off | 0.33 res | 0.45 + MSAA 4× | 0.5 + MSAA | 0.5 + MSAA |
| Est. draw calls / triangles | ~18 / 12k | ~20 / 16k | ~24 / 30k | ~26 / 45k | ~28 / 60k | ~30 / 80k |
| Est. GPU frame (to be verified, ADR-0016) | phone 3–4 ms | phone 5–6 ms | iGPU 1080p 6–8 ms | iGPU 9–11 ms; dGPU 3–4 ms | dGPU 4–5 ms | dGPU 5–7 ms |

**What Minimal and Low drop:** marched slabs (they become single-sample analytic sheets), glints, parallax
and self-shadow, petal splitting, plane shimmer and bloom.

**What they keep:** the analytic gobo with physical penumbra, the Sun Rug, every event beat, the irrigation
network and the sash mechanics. The picture's identity is the cast light, and it is cheap.

#### Phone strategy

- **Fill rate is the cost.** The scene is mostly flat surfaces running `castLight`, which costs on the
  order of 150–250 ALU and 3–5 fetches per pixel.
- **Mitigations:**
  - pixel-ratio caps;
  - `If(dot(N, toSun) > 0)` and inside-quad early outs;
  - slab marching skipped inside card rects;
  - the per-aspect camera puts most phone pixels on the glass (top band) and the Rug (bottom band), which
    are among the cheapest surfaces;
  - the garden is barely drawn on portrait.
- **Startup:**
  - the carpet arrives as two PNGs (or a 1024 CPU bake in a microtask);
  - the girih is analytic, so no glass textures are baked;
  - the board atlas is 8 KB.
- **No render targets beyond post**, so nothing depends on half-float support.

#### WebGL2-backend and headless risks

| Risk | Mitigation |
|---|---|
| Nested `select` with `Fn` calls inside the girih code fails only on WebGL2 (gotcha #89) | Arithmetic, `mix` and `step` folding; one `select` per value built as `.toVar()` |
| Shader size: `castLight` is inlined into about 7 materials | `hrGirih`, `hg`, `noise3` and `roundBox` are laid-out pure `Fn`s (no captured uniforms or textures, gotchas #93/#95); the builder stays small; budget-check the largest WGSL module with the existing `--shaders` capture hook (`scripts/capture-breathing-headless.mjs`) **[amended: §3.10]** |
| Loop bounds | Board-window loop ≤ 5 and slab march ≤ 16, with uniform counts and named loops |
| NaN | HG and Fresnel written as products; cosines clamped (gotcha #94) |
| `exp` overflow on tall portraits (gotcha #71) | Every exponent bounded |
| Thin cames in MSAA | Analytic AA from `u.pixelAngle` and clamped varyings (gotcha #105) |
| Headless verification | No `Data3DTexture`, no `lut3D`, no compute, no MRT, so it runs on a cloud container's SwiftShader leg |
| A lone additive part captured with `noPost=1` is black | Keep `sky` in captures (gotcha #117) |

#### Module split (as proposed; §5.2 has the amended list)

```
src/themes/haft-rang/
  haft-rang-core.js         three-free: glasses, sash sets, piece map, sun-walk closed form,
                            BoardGlass mirror, irrigation integrator, EVENT_ROWS, timings,
                            per-aspect composition anchors, mulberry32/smooth/approach
  haft-rang-tsl.js          createHaftRangUniforms (u), hashes, noise3 (2D lattice), hrGirih,
                            castLight/glass/backdrop builders, material + geometry helpers,
                            CPU bakes (carpet fallback, tile atlas, plaster fBm, board atlas)
  haft-rang-sky.js          morning sky + garden-through-glass backdrop (one direction function)
  haft-rang-garden.js       avenue, jub + chadar, cypress/plane impostors, gate, wall, windcatcher
  haft-rang-hall.js         carpet floor + tile margin, walls/dado/iwan, niche wall, muqarnas, hurno
  haft-rang-orosi.js        glass, walnut frames, sashes, gauze + silk curtains
  haft-rang-air.js          full-screen slab march + dust glints
  haft-rang-fx.js           timed-queue stagers: landings, stripes, run-off, sash/quad, click,
                            mirror sweep, ganzfeld, sash change, curtains, cameo, veil
  haft-rang-world.js        HaftRangWorld (house contract: build, bindCamera, showOnlyParts,
                            setViewport, setLayout, setReducedMotion, seek, resetSession,
                            restCamera, updateCamera, onLock, onClear, onCombo, levelUp,
                            update, getPostState, getState, dispose; + onGameOver/onRunStart)
  haft-rang-post.js         RenderPipeline, POST_LOOK per tier, pass-through fallback
  haft-rang-director.js     ocean try/finally + broke flag, SW shape/cells, B2B-break detection,
                            MP cascade stash, meditation positions
  haft-rang-composition.js  SW composition + '#online-main-board canvas' + board-window/Rug solver
  haft-rang-quality.js      QUALITY tiers, tierFor
  haft-rang-theme.js        BaseTheme adapter (clone of SW/sunset adapter)
  haft-rang-tetrominos.js   §1.6
  haft-rang-theme-icon.png  icon-lens frame: shamseh fanlight blazing over a carpet of coloured pools
src/playground/effects/haft-rang.effect.js
```

(SW = `src/themes/serenity-warp/`, the house's reference "masterpiece rebuild". Since the competition,
`src/themes/rainbark/` is the closer precedent; clone from it.)

**Parts** (`?haftRangParts=` and the effect's `parts=`): `sky, garden, hall, carpet, orosi, curtains, air, motes`.

**Effect params:** the house set (`event=lock|drop|clear|quad|tspin|perfect|levelUp`, `lines`, `row`, `u`,
`piece`, `turns`, `combo`, `level`, `locks`, `board`, `quality`, `reduce`, `parts`, `noPost`, `bloom`,
`falseColor`, `px`, `py`, `icon*`, `demo`). It adds four, all catalogued in `playground-parameters.js`:
- `set=0..6` (sash set);
- `sun=0..1` (sun-walk phase);
- `idle=1`;
- `curtains=1`.

**Tests:** `-core` (mirror, irrigation, sun walk, palette gate 0/7), `-director`, `-world`, `-composition`
(Rug solver lands in free space at 16:9, 21:9, 1280×720 and 390×844), `-theme`. This follows the
playground-first loop in `CLAUDE.md`, one part per capture session.

### 1.8 Why it would be breathtaking, and why it resembles nothing in the fleet

#### Why it would be breathtaking

- **Stained glass in sunlight is among the most loved interior images on Earth**, and nothing in the game
  is like it.
  - The fleet is overwhelmingly dusk, night or space. This is a bright, saturated, warm morning interior
    that opens onto a sunlit garden, filling the high-key daylight slot.
- **Light becomes the material.**
  - Crisp coloured slabs hang in the air, pools print the lattice onto wool, plaster niches and glazed
    tile, and colours mix where the light overlaps.
  - The physical penumbra (sharp near the glass, soft far away) gives a truthfulness that the eye feels
    before it understands.
- **The board is part of the world, literally.**
  - The card is a window, and its light lies on the carpet as the Sun Rug. Every lock changes the room,
    every clear turns colour back into sunlight, and the rising stack walks its colours toward you.
  - No other theme casts the board's own contents into the world.
- **The surreal turn is gentle and unforgettable.** Light flows like garden water: a combo floods the woven
  garden, then the real one, and runs down the avenue to the far gate.
- **The four-line and perfect-clear moments come from art and physics, not explosions:**
  - white sun splitting into seven slabs of colour, which is *haft rang*;
  - a Turrell Ganzfeld in which the room dissolves into pure coloured light.
- **Depth on seven planes**, from carpet knots at your feet to a desert ridge 25 km away, framed by
  architecture.

#### The three closest themes, and the precise differences

| Closest theme | What overlaps | Precise differences |
|---|---|---|
| **chromadelic-highway** | The only other "stained glass" surface. Its tagline is "The board is the sun." | Chromadelic is a night space highway: a neon ROYGBIV road *lit from within*, running to a vanishing point under ring arches, with planets. Haft Rang is daylight on Earth, with no travel and no vanishing point. The glass is real windows lit by an *off-frame sun*, and its colour exists only as *cast light* on wool, plaster and tile. The palette is pot-metal glass and earth materials (madder, walnut, lime), not neon on violet-black. The FX grammar (cast, mix, dust, flow, slide) shares nothing with lane bands and ring cascades. Where Chromadelic's board is the sun, Haft Rang's board is a *window the sun shines through*. |
| **ice-temple** | An architectural interior with ribs and columns, light through a translucent material, a hall seen from inside. | Ice Temple is cold, polar night, a cathedral-like nave of hexagonal ice with a glowing Great Crystal behind the board and aurora. Haft Rang is warm, morning, a secular octagonal garden pavilion of walnut, lime plaster and wool. Its light source is never in frame and nothing glows behind the card. There are no cracks, aurora or moon. |
| **crystal-cave** (and geode) | Coloured light passing through a translucent mineral, a light shaft, saturated jewel colours. | Those are dark caves of *faceted crystals* with prismatic fans, spectral dispersion and a vault skylight. Haft Rang has no facets, gems or prisms and no dispersion. Its colours come from flat glass panes and appear as sharp-edged projected patterns with physical penumbra. Its light enters sideways through windows in daylight, not down a shaft into darkness. |

#### Near-collisions also checked

| Theme | The overlap | Why Haft Rang differs |
|---|---|---|
| **neon-dusk / synthwave-sunset** | Lock lights piece-shaped cells in a glass or grid floor | Haft Rang's cells are *projected sunlight* inside a live, sheared image of the whole board, with penumbra and additive mixing. They are not lit tiles in a neon grid. **[amended: §3.4, the art judge still saw a collision]** |
| **moonlit-greenhouse** | A glazing grid and a window | Girih, not a rectilinear grid; morning, not a moon. |
| **chromatic-impasto** | "The board paints a permanent picture" | The Sun Rug is a live mirror. Cleared rows vanish from the light because they vanish from the glass. |
| **sakura-twilight** | Garden props | Persian, not Japanese. No blossom, lanterns, foxes or torii. |
| **halcyon-apex** | Dawn and architecture | No temple, no sun disc in frame, no lagoon or crystals. |
| **nimbus-veil / rainbow-terraces** | Golden motes | Haft Rang's dust exists only inside light slabs and takes their colours. |

#### The fleet avoid list, item by item

| Item | Haft Rang |
|---|---|
| Moon | none |
| Aurora | none |
| Snow or ice | none |
| Golden low sun on the horizon | never in frame |
| Turquoise lagoon or mirror lake | none (the only water is the moving jub, far away) |
| Blossom | none |
| Trees framing the screen | none (the cypresses are a vista through an arch) |
| Hero peak | none (a faint far ridge only) |
| Lanterns | none |
| Flags or ribbons | none |
| Petals or leaves thrown from the card | none |
| Floating crystals | none |
| Meteors | none |
| Night palette | none |

#### The house FX grammar, item by item

| House convention | Haft Rang |
|---|---|
| Lock light from the card edge | It is cast, not sent |
| Ring under the board | none |
| 30 s held colour released by a clear | It is a live mirror instead |
| Blades of light or twin jets | none; stripes lie in the Rug and turn white |
| One wave per line | One run-off pulse that scales with lines |
| Hush, then flare | Open, flood, split |
| T-spin spiral round the card | A lattice click everywhere |
| Level hour wheel | A sash-change wipe; the hour never turns |
| Hard-drop camera dip | Dust instead |

### 1.9 Top risks and mitigations (as proposed)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Cultural or religious sensitivity, or orientalist pastiche** | Strictly secular typology and references: garden houses and palaces only. The art bible bans calligraphy, mihrab, minarets, prayer-hall layout and religious symbols (§1.1). Craft fidelity over kitsch: real materials (walnut, lime, wool, pot-metal glass) and Turrell-like restraint (large calm fields of light). Persian terms are used respectfully, and the name means only "seven colours". Ask a Persian-heritage reviewer to look at the icon and captures before shipping. **[amended: §3.2, the review becomes a Stage 0 and Stage C gate]** |
| 2 | **"An interior is not a landscape"** (the research survey ranked the seed 4th for this) | The garden arch gives a 140 m avenue plus a desert skyline at 16:9 and 21:9. Seven depth planes (§1.2). Physical penumbra and forward-scattered slabs as depth cues. The combo literally carries light out into the landscape. **[amended: §3.3]** |
| 3 | **Readability: a patterned, busy world next to the board; the Rug competing with the card** | Calm zones (house SDF clip) over the card and HUD. The Rug's intensity is capped below the sun-wall pools, with low contrast and soft far penumbra. Pattern detail in `castLight` softens within about 40 px of a card rect (a "quiet margin"). Motion near the card happens only on events. The solver never lands the Rug under the card or HUD. **[amended: §3.4, §3.13]** |
| 4 | **Board-mirror divergence** (garbage is not on the bus; cascade gravity; Infinity scrolling) | It is ambient light, not gameplay. Self-healing rules (§1.7). Reset on run start and on perfect clear. Infinity uses viewport rows plus a 120 s age-out. A wrong cell reads as just another pane. **[amended: §3.4, garbage-push inference]** |
| 5 | **Fill-rate cost on phones** | Analytic gobo with early outs. Slab marching is the tier lever (1 to 16 samples), skipped behind cards. Per-aspect framing puts phone pixels on cheap surfaces. Profile on the WebGL2 leg at Low and Minimal before claiming budgets (ADR-0016). |
| 6 | **WebGL2 compile size and backend-only failures** | Laid-out pure helpers, no nested `select` (gotcha #89), two uniform buffers in total, no 3D textures or RTs. Capture both backends and portrait for every part. Keep to one part per session (the TDR rule in `CLAUDE.md`). |
| 7 | **Additive overlaps burning to white; saturated pools clipping** | Gotcha #157 cap, a hue-preserving "glass filmic" that whitens only above peak 6, false-colour checks (gotcha #149) before judging colour. **[amended: §3.11]** |
| 8 | **Photosensitivity** (white stripes on fast cascades; four-line flood; Ganzfeld hue walk) | Caps and limiter (§1.5): at most +0.45 stop, eased; 0.35 s minimum spacing; stripes at most 6% of screen; Ganzfeld at constant luminance with at least 0.9 s per hue and no red step; reduced-motion variants. **[amended: §3.5, §3.7, §3.8]** |
| 9 | **Moiré and shimmer of fine lattice lines at distance or under camera sway** | Analytic AA from the pixel footprint plus physical penumbra blur. Dust glints floored at 1.15 px (gotcha #147). Check at Minimal and Low (gotcha #135: drop the term in JS, never by substituting 0.5). |
| 10 | **Portrait composition** (64 px side strips, 123 px bands) | A dedicated per-aspect camera: the glass hero is on top and the Rug comes toward the camera at the bottom; slabs read diagonally in the strips. A composition test at 390×844 plus screenshots before porting. |
| 11 | **Startup cost of the carpet bake** | Baked PNG pair generated by a node script from the same deterministic code; 1024 CPU fallback in a microtask; the girih is analytic, so no glass bake is needed. |
| 12 | **Colour-blind separation** | Checked by simulation: ΔE at least 22 for deuteranopia, protanopia and tritanopia (§1.6). Pieces never rely on glow; the board keeps the rim and gradient treatment. |
| 13 | **An Odyssey orb inherits a garden pavilion** (Cosmic Chimes' orb was level 47, "Singularity Gate", chapter 6) | A deliberate move away from space if the replaced theme is a space theme. Route it through the retired-id alias map, as was done for electric-dreams-v3 → murmuration and cosmic-chimes → rainbark. |

### 1.10 Reference facts used (web lookups made for the proposal)

- **Orosi** are coloured-glass windows built from girih, popular in Iran from the 17th to the 19th century.
  They are layered planes that link the room to the garden (H. Koliji, *Built on Light*):
  https://archnet.org/publications/10202
- **Orosi as lattice windows** covered by coloured glass, used to decorate the room and control light
  (Borujerdi House, Kashan): https://archimage.lib.ttu.edu/items/show/18011
- **Regional variation** in orosi pattern, colour and technique (Qajar Hamedan and Kermanshah; Amol and
  Tabriz): https://hsi.kashanu.ac.ir/article_115530.html?lang=en and
  https://jjhjor.alzahra.ac.ir/article_7046.html?lang=en
- **Qajar glass colours** (red, blue, green, yellow) and sunlight broken into colour across interiors:
  https://revistas.ute.edu.ec/index.php/eidos/article/download/998/816?inline=1
- **Dowlat Abad Garden, Yazd:** a pavilion with stained-glass lattice windows; the 33.8 m adobe windcatcher,
  the tallest in the world; cypress and pomegranate; UNESCO 2011:
  - https://en.wikipedia.org/wiki/Dowlatabad_Garden
  - https://www.chasingtheunexpected.com/beneath-yazd-tallest-wind-catcher-beautiful-dolat-abad-garden/
  - https://www.visitouriran.com/blog/dowlat-abad-garden-in-yazd
- **James Turrell:**
  - light as a physical "thing"; the Ganzfeld as a "complete field" in which depth and shape are lost:
    https://www.lacma.org/sites/default/files/Turrell_LACMA_Brochure_052213_.pdf and
    https://gagosian.com/exhibitions/2024/james-turrell-at-one/
  - Wedgework light reading as a solid wall: https://Artsandculture.google.com/story/igUxQ60w_TnrKw
- **Garden carpets:** the chahar-bagh plan (a central channel crossed by a second channel, four planted
  quarters; small carpets keep their channels large):
  - https://www.metmuseum.org/art/collection/search/447583
  - https://www.metmuseum.org/perspectives/eternal-springtime-wagner-garden-carpet
  - https://hali.com/articles/the-jaipur-garden-carpet/
- **Coloured-light behaviour:** best in early morning (about 7–8 am) and gone by noon. This is a
  light-behaviour reference only:
  - https://mymodernmet.com/nasir-al-mulk-pink-mosque/
  - https://maverickbird.com/outside-india/nasir-al-molk-mosque-the-pink-mosque-of-shiraz/
- **Ali Qapu**, a palace music room with deep wall niches and vessel motifs in stucco:
  https://en.wikipedia.org/wiki/Ali_Qapu

---

## 2. What the judges said

The three judges read all six proposals in full. Their notes on Haft Rang are reproduced or closely
paraphrased below, with every concrete number kept.

### 2.1 Art director: 8.5 (1st of 6)

**Lens.** Beauty, originality against the 61-theme catalogue (setting, palette, composition, motifs and FX
grammar), wow factor, depth, atmosphere and lighting, how the theme reads as a still and in motion,
surprise, and the name. "I was strict about resemblance."

**Findings across the slate that bear on Haft Rang.**
- "Almost every lock is still a softened version of the house 'the world holds the colour'... Only Haft
  Rang breaks the pattern for real. Its Sun Rug is a live image of the board, so a colour lasts exactly as
  long as its piece is on the board."
- Every concept puts a hero on the left and a secondary on the right. "Haft Rang does the most with it:
  the right field is the light source and the left is where the light lands, so the split carries cause
  and effect."
- Golden hour is the fleet's most overused light; "high sun or morning daylight is the open slot."

**Strengths.** "This is the only concept that truly looks like nothing else in the fleet. Its nearest
neighbours are a neon stained-glass road in space (chromadelic) and a cold ice nave (ice-temple), and
neither is close."
- **Light is the subject.** Backlit pot-metal glass blazes, coloured pools print the lattice onto wool,
  plaster and tile, colours mix where pools overlap, and Turrell-style slabs of coloured air hang in the room.
- **The penumbra is physical:** crisp near the glass, soft far away. "That is a depth cue the eye feels
  before it understands it."
- **"The still is a 9."** Stained-glass morning light on a madder carpet is among the most loved interior
  images on Earth.
- **"The Sun Rug is the most surprising idea in the slate."** The board is a window, the sun casts its
  contents across the carpet, and a rising stack walks its colours toward you. "The world reads the game,
  not just its events."
- **The quad is art-literate.** White light floods in, then splits into seven slabs, which is *haft rang*
  itself.
- **The perfect clear is a Ganzfeld,** calm rather than explosive.
- **The name is excellent conceptually:** seven colours, seven glasses, seven pieces.

**Weaknesses.**
- **It is an interior.** The user asked for extraordinary landscapes, and the garden arch helps only partly.
- **Motion is the slowest in the slate.** The sun walks, dust drifts, a curtain breathes and a pigeon
  visits, so the theme reads far better as a still than in motion.
- **Cultural risk.** "The visual vocabulary (coloured light on a carpet, muqarnas, haft-rangi tile) *is*
  the look of the Nasir al-Mulk mosque. The secular rules remove the mihrab and calligraphy, but many
  viewers will still read the room as a mosque."
- **Execution risk.** Procedural architecture (girih, muqarnas, a carpet bake, niches) is where procedural
  work most easily looks cheap.
- **The lock collides on the surface.** Four panes of the piece's colour lighting on the floor is
  neon-dusk's and synthwave's lock (both light piece-shaped tiles in a glass or grid floor), and aether-tides'
  footprint echo is on its avoid list.
- **The name is opaque** and needs an English subtitle.

**Worth grafting (into any winner).** The `castLight` analytic gobo, whose penumbra grows with distance
from the glass; the Sun Rug, the board cast as world light; the irrigation combo (light flows like water
through channels, a meter you read by how far it has run); white light splitting into seven colours for
four lines; the Ganzfeld perfect clear; the sash-change wipe for level up; dust that thickens the slabs on
a hard drop; motes that take the colour of the slab they drift through; curtains drawn on game over.

**Verdict.** "Haft Rang wins on this lens. It is the most original, the most surprising and the best lit of
the six, and it is the only one that fully breaks the fleet's 'hold the colour' grammar." **Adopt it only
with two conditions:**
1. A Persian-heritage review of the look, beyond the planned ban list. "The light-on-carpet vocabulary
   itself evokes the Pink Mosque."
2. More motion. Graft in Rainbark-style leaf dapple through the clear panes, a livelier jub and garden, and
   a breeze that animates the slabs.

Cross-slate rules for whatever wins: use the rainbow no more than once; keep the decay world-native
(bleach, green, ripen), never "held then released"; source a clear's colours from the real cells of the
cleared row (Painted Ages' shadow well, now in `src/themes/rainbark/rainbark-director.js`).

### 2.2 Rendering lead: 4.5 (6th of 6)

**Lens.** Can it be built in three r186 TSL so it looks right on WebGPU and on the WebGL2 backend? Cost on
phones and iGPUs; procedural without models; how cheap it looks if it falls short; compile and pipeline
cost; board readability. "Look-per-millisecond is the main thing I reward. I penalise concepts whose beauty
depends on volumetrics, refraction passes or extra render targets."

One-line verdict: "`castLight` is beautiful and cheap per surface. But it needs a procedural Persian
interior (orosi, muqarnas, niches, carpet, garden) and a full-screen girih slab march: the highest scope,
compile and fill risk, and the busiest backdrop behind the card."

**Strengths.**
- **`castLight` is a gorgeous idea and cheap per surface:** two to four ray–plane tests and one laid-out
  girih evaluation; penumbra proportional to the distance back to the glass gives physical AA and kills
  moiré; cast pools mix additively, capped by #157.
- **The Sun Rug** (the board's own cells cast as light into the world from a 64×32 atlas) is "the most
  original board-to-world coupling on the table."

**Weaknesses.**
- **Scope of procedural hard-surface interior:** octagonal hall, orosi frames and sashes, a muqarnas
  generator with mirror tesserae, a parallax niche wall with a self-shadow march, a tile-dado atlas, a
  2048×1024 carpet design bake, cypress impostors, gate, wall and windcatcher. "Without models, interiors
  are where procedural work looks cheap first."
- **The air slabs are a full-screen march in the scene pass** (3–16 samples per window × 2–4 windows), and
  each sample evaluates the girih. The concept's own estimate is the worst: iGPU High 9–11 ms, phones
  3–6 ms on Minimal and Low.
- **`castLight` is inlined into about 7 materials,** "the largest compile and WGSL footprint of the six."
- **"Analytic 10-fold girih is genuinely hard,** because it does not fold onto a square or hex lattice.
  Limit it to 8-fold and 12-fold."
- **Readability is the weakest.** "A lattice-patterned room with slabs crossing behind the card and the Rug
  beside it is the busiest backdrop of the six."

**Graftable.** "Haft Rang Sun Rug (board cells as light in the world): if wanted in Rainbark, the board's
last pieces already persist as fresh bark bands. Keep it there, with no atlas mirror needed." Overall:
"Sunfall's and Haft Rang's beauty is volumetric and architectural, which is exactly what this lens
penalises. Their best tricks (`dlSunlit`, `castLight`, the Sun Rug) should be grafted, not built as whole
themes."

### 2.3 Gameplay-feel designer: 6.9 (6th of 6)

**Lens.** How spectacular, colourful, satisfying and world-native each event is; readability at 1–3 locks
per second; whether combos escalate and release clearly; novelty against the house FX grammar; clean
mapping to board positions; photosensitivity; how the theme feels after 20 minutes. Frequency weighting:
a 20-minute session has roughly 600–900 locks, 150–250 clears, 10–40 four-line clears, a few T-spins and
almost no perfect clears. "Lock and clear set the feel."

One-line verdict: "Contains the two best single beats in the set (Irrigation combo, lattice-click T-spin).
Its frequent beats copy the board (Sun Rug) or flood the whole hall (dust), and its four-line exposure
lift is the riskiest."

- **Combo (Irrigation)** "is the best spatial gauge on the table": light fills the woven carpet channels
  like water, one coloured band per link, reaching the garden's jub at 7 and the far gate at 10, then
  draining downstream on release.
- **T-spin (the lattice turns)** "is the cleanest T-spin": every girih star in every window clicks one
  notch, and the whole projected pattern clicks with it. Count = lines.
- **Lock (Sun-catch).** The mapping is exact, but it is **"a second copy of the board in peripheral
  vision."** "The rising stack walking toward the player adds anxiety rather than satisfaction, and any
  mirror desync (garbage, Infinity, MP) is visible to an attentive player."
- **Clear.** The Rug's rows flare white-gold, which **duplicates the Phaser board's own clear animation**.
  It also puts a luminance flare on every clear, against the house rule of "flashes only on quad/perfect"
  (it is small-area and limited to one per 0.35 s, so borderline).
- **Hard drop (Dust)** thickens every slab in the hall ×3 for 1.6 s. "Under habitual hard drops the air
  becomes permanently solid, and the beat stops meaning anything."
- **Four lines.** "Thematically perfect, but at **+0.45 stop** it is the largest exposure lift of any
  concept, and it stacks on the board's own 0.4 gold screen flash. Project guidance caps this around 0.36."
- **Perfect clear (Ganzfeld).** A full-field saturated hue walk at constant luminance, at least 0.9 s per
  hue, with no red step. "It passes WCAG, but it is the most aggressive full-field colour event proposed."

**Ideas the judge offered other concepts from Haft Rang:** a spatial combo meter of "light or water flowing
along channels" where reach equals chain length; T-spin as one rotational click of every pattern at once;
B2B in its own screen region (the top band).

**Engineering note for every concept:** the house `ComboTracker` reports a break one lock late. PIECE_LOCK
and wave 1's LINE_CLEAR are emitted in the same synchronous tick, so the director can infer at `flush()`
that a lock with no clear in the frame breaks the chain, and deliver `combo(0)` on the breaking lock itself.
Irrigation's drain is a release reward, so this applies (§3.9).

### 2.4 Why it did not win

From the decision record in `docs/theme-concepts/rainbark.md`: Rainbark scored 24.9/30. "The art judge
ranked Haft Rang first (8.5 against Rainbark's 8.0), but that is not enough to overrule":
- Haft Rang is an **interior**, and the brief asks for extraordinary *landscapes*.
- It carries a real cultural-reading risk: the room reads as the Nasir al-Mulk mosque.
- The rendering lead scored it lowest of the six (4.5). Its cost is a procedural Persian interior, a
  full-screen girih slab march, and the busiest backdrop behind the card.

Haft Rang lost 4 points to Rainbark on rendering and 1.5 on play while winning art by 0.5. §3 attacks
exactly those: scope and cost (§3.10), readability (§3.4, §3.13), the frequent beats (§3.4–§3.6), the two
big exposure events (§3.7, §3.8), and the cultural reading (§3.2). The interior-versus-landscape objection
can be softened (§3.3) but not removed; whoever picks this concept should know that.

---

## 3. Required changes before building

**This section overrides §1.** Every weakness a judge named has a fix below, plus the cross-cutting
findings of the competition and the gaps found while writing this document. §5 is already written against
these fixes.

### 3.1 Every named weakness, and its fix

| Judge | Weakness | Fix (details in the subsection named) |
|---|---|---|
| Art | It is an interior; the user asked for extraordinary landscapes | **Open the garden face** (§3.3): the arch widens to x 0.08–0.38, y 0.03–0.60 at 16:9; the garden (sky, avenue, jub, skyline) fills ≥ 22% of the non-card pixels at 16:9 and ≥ 30% at 21:9; fountain jets and a livelier avenue; the combo and four lines carry light out to the far gate. This softens the objection; it cannot remove it. |
| Art | Motion is the slowest in the slate; reads better as a still | **A motion floor** (§3.3): at any moment of a 16:9 rest frame at least four independent motions are visible (curtain billow, breeze curtains of dust travelling along the slabs, jub jets and chute sparkle, plane-tree canopy sway through the clear panes, cypress sway, motes); breeze cycles every 12–20 s while playing; pigeon cameo every 30–60 s. Leaf dapple stays a soft modulation, never pinhole flecks (that is Rainbark's look, §4.2). |
| Art | Cultural risk: coloured light on a carpet, muqarnas and haft-rangi tile *are* the Nasir al-Mulk look | **The house, not the mosque** (§3.2): a Persian-heritage review as a Stage 0 gate and again at Stage C; muqarnas removed (a coffered walnut ceiling with khatam panels and sparse mirror inlays instead); domestic cues on the takht (bolster, brass tray of tea glasses catching the light, a bowl of pomegranates); tile limited to dado and spandrels, never rose-dominant; one great carpet, never rows; the saffron set is the reference, icon and default; Golab (rose) never in the icon or marketing frames. |
| Art | Execution risk: procedural architecture looks cheap | **CPU lab first** (§5.12) for the girih families, the carpet and a massing render; **scope cuts** (§3.10); the architecture is reduced to large calm planes of lime plaster (Turrell restraint) and the ornament is concentrated where it is analytic and strong: the glass, its cast light and the carpet. |
| Art | The lock collides with neon-dusk/synthwave (both light piece-shaped tiles in a glass or grid floor) and aether-tides' footprint echo | **The Rug is never a crisp copy** (§3.4): new panes merge into one continuous, sheared, lattice-printed, penumbra-softened image of the whole board on wool; no outline, no ring, no glass floor, no separate footprint; landing bloom 1.2× (was 1.5×). |
| Art | The name is opaque | **Stage 0 decision with an English subtitle** (§3.14). |
| Tech | Scope: octagonal hall, orosi, muqarnas generator, parallax niches with self-shadow, tile atlas, carpet bake, impostors, gate, wall, windcatcher | **Cut list** (§3.10): no muqarnas generator; tile dado drawn by the same `hrGirih` with a tile palette (no tile atlas); gate, wall, windcatcher, far cypress files and ridge painted in the backdrop function (zero geometry); niche self-shadow on High and up only; the carpet design prototyped on the CPU first. |
| Tech | The air slabs are a full-screen march, every sample evaluating the girih; worst cost estimate of the six (iGPU High 9–11 ms) | **Analytic chord plus glass-image taps** (§3.10): each slab is an analytic ray–prism chord with in-scatter `density·L·SUN·T̄·HG`; T̄ is read from a small CPU-baked glass image (mip by penumbra and chord length); 1/2/3/4/5/7 taps by tier; the girih is **never** evaluated in the air. Slabs early-out inside card and HUD rects. |
| Tech | `castLight` inlined into about 7 materials: the largest compile and WGSL footprint | **Restructured** (§3.10): the window hit and the girih are laid-out pure `Fn`s taking every value as a parameter; only three materials call `castLight` (floor, wall shell, curtains); glass, ceiling, garden and air do not. Gated by a shader-size test (each stage < 48 KB, §5.10). |
| Tech | Analytic 10-fold girih is hard (does not fold onto a square or hex lattice) | **8-, 6- and 12-fold only** (§3.10): sets 2 (*Lajvard*) and 5 (*Anar*) become 6-fold star-and-hexagon families on the hex lattice. |
| Tech | Readability is the weakest: lattice room, slabs behind the card, Rug beside it | **A calm field behind the card** (§3.13): the iwan's back wall is plain lime plaster that no pool or slab reaches; slab prisms are solved to stay ≥ 0.03 outside the card and HUD rects; the quiet margin; motion near the card only on events. |
| Play | Lock: a second copy of the board in peripheral vision; the rising stack walking toward you adds anxiety; mirror desync visible | **The Rug amended** (§3.4): softened (hammered-glass penumbra floor, ≤ 0.6× the sun-wall pools, lattice at 35% contrast), the stack's base inside the quiet margin, the board's top pointing across the carpet and never toward the camera, constant intensity at any height; fed from the director's shadow well with a garbage-push inference. |
| Play | Clear: the Rug's white-gold flare duplicates the board's own clear animation and puts a luminance flare on every clear | **Slide, pour, mix** (§3.5): the cleared panes slide out of the image (the stripe becomes plain clear-glass sun, never brighter); their ten real colours pour into the nearest channel as threads that braid and mix toward white-gold as they run, at pool luminance. No flare at all. |
| Play | Hard drop: every slab ×3 for 1.6 s; habitual hard drops make the air permanently solid | **Local, saturating dust** (§3.6): a low puff in the card's own beam and on the carpet under the Rug only; saturating gain so repeated drops plateau at ≤ 1.6× base; settle τ 1.2 s; rate limit 0.25 s. Hall-wide Wedgework only for chains ≥ 10, four lines and the perfect clear. |
| Play | Four lines: +0.45 stop is the largest exposure lift of any concept, and it stacks on the board's 0.4 gold screen flash; guidance caps around 0.36 | **≤ +0.25 stop of measured mean frame luminance** (§3.7), rise ≥ 0.4 s, peak placed after the board's own flash has decayed (measured in the real game), under an iris dip; the flood is an *area* of clear sun, not brightness. |
| Play | Perfect clear: the most aggressive full-field colour event proposed | **A gentler Ganzfeld** (§3.8): chroma ≤ 0.35 of the lead glass's cast colour mixed into lit plaster; walks only the set's three colours at ≥ 2.0 s per hue; luminance constant within ±5%; depth dissolve capped at 75%; the glass stays as a glowing anchor; ≤ +0.2 stop; field phase 3.6 s (was 5.6 s); reduced motion holds one hue. |
| Play | (engineering note) the combo break reaches the theme one lock late | **Infer the break on the breaking lock** (§3.9). Clone `src/themes/rainbark/rainbark-director.js`, which already does it. |
| Cross-cutting | The rainbow is the slate's own cliché: use it at most once | The four-line split into **seven stacked slabs in spectral order** is the theme's one rainbow (§3.7). The Ganzfeld walks only the set's own three colours, the irrigation bands follow piece order, and nothing else is ever laid out in spectral order. |
| Cross-cutting | Decay must be world-native, never "held then released" | Already true and kept: the Rug is a live mirror (a colour lasts as long as its piece is on the board), irrigation drains downstream, dust settles, the B2B sheen fades as a status light. The Infinity/online 120 s age-out becomes a 4 s fade "as the sun moves off" (§3.4), never a pop. |
| Cross-cutting | Take a clear's colours from the real cells of its row | The poured threads carry the cleared row's ten cell colours, left to right, from the mirror (director `rowCodes` as the fallback) (§3.5). |
| Cross-cutting | Infer the combo break on the breaking lock | §3.9. |
| Cross-cutting | Count the combo discretely; reward the release, sized by the peak chain | Bands are countable (a walnut guard line between links, §3.9). The drain *is* the release: its run-out time scales with the peak (2 s at peak 2 up to 3 s at peak ≥ 8, the §1.5 range), and from peak 7 the last band visibly runs out through the far gate (§3.9). |
| Cross-cutting | Avoid the house FX grammar listed in `docs/theme-concepts/README.md` | Checked item by item in §3.15. |
| Gap (this file) | Gotcha #157's cap gives the hue to the strongest pool, which erases the additive mixing that is one of the theme's five verbs | **A different overlap rule** (§3.11): sum linear pool colours (true additive mixing), then compress the level with a hue-preserving max-channel shoulder to ≤ 2.5. |
| Gap (this file) | "Rose over turquoise turns pale lilac" is not what these glasses do | With these cast colours rose + firuzeh = (1.01, 1.27, 1.39), a pale blue-white; rose over lapis gives lilac (§3.11). Fix the copy and the acceptance expectations, not the physics. |
| Gap (this file) | Cast-pool luminance spreads 5× (lapis 0.17, pomegranate 0.24 … pistachio 0.89), so dark glasses read as shadows | **Per-glass pool gain** (§3.11): every pool's luminance floored at 0.35 of a clear-glass pool, hue kept. |
| Gap (this file) | The piece colours collide with Rainbark's on the same shapes: S ΔE 10.5 (Banafsheh vs Bloom Violet), Z 21.9, J 26.4 | **Remap S, Z and J** (§3.12): S Pomegranate, Z Banafsheh, J Firuzeh. Same seven glasses, gate still 0/7, colour-blind separation unchanged; worst same-shape ΔE to Rainbark becomes 71. |
| Gap (this file) | Garbage is not on the event bus, so in multiplayer the mirror drifts by whole rows | **Garbage-push inference** (§3.4): a lock overlapping mirror-filled cells (or a clear of a row the mirror holds as not full) shifts the mirror up by the smallest k that resolves it and fills smoked garbage glass. |
| Gap (this file) | Aineh-kari mirror mosaic is as strongly associated with shrines as with palaces | Mirror is reduced to **sparse inlays** in a coffered wooden ceiling, the palace usage (§3.2). |
| Gap (this file) | A star turned by its own symmetry step looks unchanged unless its petals differ in colour | Every star in every set carries **at least two distinct petal colours** (asserted in a core test), so the T-spin click is always visible (§3.10). |
| Gap (this file) | The level wipe sweeps a hard edge across the whole frame; if two sets differ in mean light it becomes a large moving luminance edge | Sets are balanced to **equal mean cast luminance within ±10%** (asserted in a core test) (§3.10). |
| Gap (this file) | Four lines begins with "the four stripes go white", contradicting the amended clear | The four stripes turn to clear glass and pour like any clear, reaching the whole carpet (§3.7). |
| Gap (this file) | On an upright phone the Rug "comes straight toward the camera" | It lies **across** the bottom band (§3.4). |

### 3.2 Cultural reading: the house, not the mosque

The art judge's first condition. The secular ban list (§1.1) stays and is extended; none of this is
optional.

**The gate (Stage 0, before code; again at Stage C).**
- Show the user the concept, this section and a mood board (reference links only, §6). Ask the user to
  arrange a review by someone of Persian heritage, and record the outcome in the theme's record doc
  (`docs/HAFT_RANG_VISUAL_OVERHAUL_<date>.md`, §5.6 C4).
- Repeat with the icon and the acceptance captures at Stage C. **Do not ship without that sign-off.** An
  agent cannot do this review itself; it must ask.

**Changes to the picture.**

| Change | Detail |
|---|---|
| **No muqarnas** | The octagon is roofed by a **coffered walnut ceiling** at 9 m: deep square and octagonal coffers with *khatam-kari* star panels and painted *eslimi* floral coffers, the palace-porch ceiling type of Safavid and Qajar garden pavilions (for example the talar of Chehel Sotoun, Isfahan). The *hurno* stays as a knife-edged square opening at the centre coffer. This also removes the muqarnas mesh generator (§3.10). |
| **Mirror only as inlay** | Aineh-kari survives only as **small mirror stars inset in the coffer centres and along the cornice** (palace precedent: the mirror halls of Golestan Palace in Tehran and Narenjestan-e Qavam in Shiraz). It never covers a vault. The B2B "mirrors answer" cascade runs along these inlays (§3.15). |
| **Domestic cues** | On the takht at the camera's edge, lower right or lower left depending on the Rug's side: a cylindrical bolster (*poshti*) in a striped textile, a **brass tray of tea glasses** (*estekan*) whose glass catches the coloured beams as small caustic glints, and a **bowl of pomegranates**. These read "home", not "hall of prayer". Keep them small (≤ 3% of the frame) and out of the calm zones. |
| **Tile** | Haft-rangi tile only on the 1.2 m dado and the arch spandrels; grounds Kashi Turquoise, lapis, ochre and white; floral and geometric only; **never rose-dominant** (the Pink Mosque's tile is). Large fields of plain lime plaster dominate the walls. |
| **One carpet** | One great garden carpet. Never several rugs in rows; the camera never looks along a row of anything. |
| **No colonnade** | No row of columns anywhere; the iwan and arch are wall openings. |
| **The reference set** | Set 1 *Za'feran* (saffron lead) is the rest look at level 1, the icon frame, the reference captures and any marketing frame. Set 3 *Golab* (rose lead) stays in rotation but is never used for the icon or a showcase still, because rose light on a carpet is the famous photograph of Nasir al-Mulk. |
| **Copy** | The picker description and Odyssey copy say "a garden pavilion" or "a garden house". Persian words are used only for crafts and garden parts. No religious vocabulary anywhere in code, strings or docs. |
| **Light reference stays private** | Nasir al-Mulk's morning light remains a behaviour reference for how pools look on wool. No element of that building (its columns, its tile, its plan, its orientation) is modelled, and its photographs are never used as `ref=` overlays in committed docs. |

### 3.3 More landscape and more motion

The art judge's second condition, plus the interior objection.

**Composition at 16:9 (replaces the §1.2 left-field numbers).**

| Element | §1.2 | Amended |
|---|---|---|
| Garden arch | x 0.13–0.38, y 0.05–0.58 | **x 0.08–0.38, y 0.03–0.60** (a wider four-centred arch; the threshold sill at y 0.60) |
| Niche wall | x 0.0–0.13 | **x 0.0–0.08** at 16:9; the full corner returns at 21:9 |
| Floor | x 0.05–0.40, y 0.60–1.0 | unchanged |
| Garden share of non-card pixels | not specified | **≥ 22% at 16:9, ≥ 30% at 21:9** (measured in the composition test from the solver's rects) |

**What is added outside.**
- **Fountain jets** in the jub's level runs between chutes, as in the spring-fed channels of Persian
  gardens (Bagh-e Fin in Kashan is the reference): 6–12 small vertical jets, 0.4–0.9 m tall, each a
  flickering white plume with sparkle; moving water only, never a still surface.
- **Plane trees in wind:** canopy sway 0.2–0.4 Hz, ±1.5°; leaf shimmer as §1.4; they show through the clear
  panes as moving backlit green.
- **Cypress sway** raised from ±0.5° to ±0.8° (0.12 Hz, phase-offset per tree).
- Optional, small: a hoopoe or sparrows on the gravel path, a 4–6 s cameo every 60–120 s. No flocks (bird
  flocks are common in the fleet).

**What is added inside.**
- **Breeze curtains of dust:** density waves that travel *along* each slab at 0.3–0.6 m/s (a 1D noise in
  the slab's own coordinate, amplitude 0.25 of density), cycling every 12–20 s while a session is live and
  every 25–40 s at idle. This is the "breeze that animates the slabs" the judge asked for.
- **Gauze curtain:** continuous billow (0.12–0.2 Hz, 8–15 cm, raised from 3–15 cm), gusts every 18–35 s.
- **Pigeon cameo** every 30–60 s (was 45–120 s), lasting 3–5 s; its silhouette in one pool.
- **Motion floor (acceptance):** in any 2 s window of the rest shot at 16:9, at least four of these move
  visibly: curtain, dust curtains, jets/chutes, plane trees, cypresses, motes, pigeon.
- **Leaf dapple** keeps §1.4's numbers (depth 10–25%, soft spots inside the clear-pane pools only). Do not
  turn it into discrete pinhole flecks: that is Rainbark's signature (§4.2).

### 3.4 The Sun Rug, amended

The judges disagree here: art calls it the slate's most surprising idea, play calls it a second copy of
the board. Keep the idea; change the reading.

| Property | §1 | Amended |
|---|---|---|
| Edge sharpness | Physical penumbra from the card plane (crisp at the card's foot) | The card's sash is treated as **hammered (seedy) glass**: Rug penumbra = `max(t·0.00925·(1 + 2·veil), 0.22·cell)`. Never a crisp copy. |
| Lattice in the Rug | As strong as the sun-wall pools | Came lines at **35% contrast** of the sun-wall pools' lattice |
| Intensity | "Capped below the sun-wall pools" | **≤ 0.6×** the sun-wall pools' level, **constant at any stack height** (no danger tint, no brightening) |
| Direction | Board's empty top reaches toward the camera | The stack's base lies at the card's foot, **inside the 40 px quiet margin**; the board's top points **across the carpet**, sideways (leftward on landscape), never down the screen toward you. The Rug's light direction is already art-directed rather than taken from the sun (§1.2 "Placement"), so choose it mostly lateral. Solver constraint (y measured down the screen): the far end's screen y ≤ the card's bottom edge + 0.10, and in depth it comes no more than 1 m nearer the camera than the base. |
| Stretch | 2.2× mean, breathing 1.7–3.1× | **1.4–2.2×** (mean 1.8×) |
| Phone (390×844) | Straight toward the camera, down the screen | **Across the bottom band**, left to right under the card, so it shows the stack's base, not a growing column |
| Landing | Glint 0.18 s; bloom 1.5×, τ 0.35 s; pile sparkle | Glint 0.18 s kept; bloom **1.2×**, τ 0.35 s; ≤ 12 pile glints; **no outline, no ring, no separate footprint**: the new panes join the one continuous image |
| Mirror source | `BoardGlass` in core, stamped from events | The **director's shadow well** (clone `rainbark-director.js`: per player slot, 5 slots, a sparse table of the latest 64 absolute board rows, hidden rows included, stamped from PIECE_LOCK snapshots, cleared rows removed and the rows above dropped; a 24-row board never fills it, and Infinity's tall grid uses the same absolute rows) exposes `boardCodes(slot)` after each flush; the world writes the 64×32 atlas from it. `BoardGlass` remains as the three-free atlas packer and the healing rules. |
| Garbage (multiplayer) | Not handled beyond "self-healing" | **Garbage-push inference:** if a locked piece's cells overlap cells the mirror holds as filled, or a clear reports a row the mirror holds as not full, shift the mirror up by the smallest k (1–8) that resolves it, and fill the k new bottom rows with smoked garbage glass (`#2E2522`) with one seeded clear gap per row. |
| Age-out (Infinity, online) | Cells untouched for 120 s age out | Kept, as a **4 s fade** "as the sun moves off" |
| Settings | Not specified | `pieceLockRipple` off: no glint, no bloom, no sparkle; the image still updates silently. `backgroundComboEffects` off: the Rug shows the empty board (clear-sun lattice) and no event reacts; the ambient world continues. |

**Why this answers both judges.** The Rug still makes the board part of the world, a colour still lasts
exactly as long as its piece, and a clear still takes its row's light away. But the image is soft,
low-contrast and lies across the floor like any other pool, so it is never a second board to read, and a
tall stack only lengthens a soft pool sideways.

### 3.5 Clear, amended: slide, pour, mix

| Time | What happens |
|---|---|
| 0–0.25 s | **Slide.** The cleared rows' panes slide sideways out of the Rug's image, toward the nearest woven channel (the sash verb). The stripe left behind is clear glass: warm sun at exactly the level of an empty cell. **No flare; nothing is ever brighter than clear-glass sun.** |
| 0.15–1.2 s | **Pour.** The row's light runs off the Rug into the nearest channel as **ten coloured threads in the row's own left-to-right cell colours** (from the mirror; the director's `rowCodes` as the fallback; for an empty-row synthetic clear, the set's lead and accents). Two rows give twenty threads, braided thicker. |
| 0.3–1.6 s | **Mix.** As the threads run they braid and **add toward white-gold** (the namesake physics run backwards, now spread over metres of channel at pool luminance ≤ 1.2 linear, never a flash). Reach: 1 line the first junction, 2 lines the cross channel, 3 lines a whole quarter. One pulse per clear, not one per line. |
| 0.25–0.6 s | **Collapse.** The image of the rows above slides down toward the card's foot, matching the board's own collapse (closed-form row remap from ≤ 4 cleared rows). |
| then | The run-off fades over 1.6 s after reaching. |

- **Cascade waves:** each later wave adds its threads to the same pulse and extends the reach by one
  junction.
- **Photosensitivity:** the beat lifts no luminance anywhere; the §1.5 stripe limiter is no longer needed
  but the global 0.35 s spacing between any two luminance peaks stays.
- **Reads as:** "the row's colours poured off the floor into the garden's channels."

### 3.6 Hard drop, amended: local, saturating dust

- **Where:** only in the card's own beam (the slab between the card window and the Rug) and on the carpet
  under the Rug, 0.4–1.2 m tall. The sun-wall slabs do not react.
- **Gain:** strength `k = (0.3 + 0.7·min(1, distance/18))·0.6`; puff density `D += k·(1 − D/Dmax)` with
  `Dmax = 0.6` above base, so repeated drops plateau at ≤ 1.6× base density.
- **Timing:** rise 0.12 s, settle τ 1.2 s from the bottom up; rate limit one puff per 0.25 s per slot.
- **Kept:** the new panes land with a slightly brighter core (+15%), and the gauze curtain flinches inward
  (≤ 4 cm).
- **Hall-wide Wedgework** (every slab thickening) is reserved for combo ≥ 10, four lines and the perfect
  clear.
- **No camera motion.**

### 3.7 Four lines, amended

| Time | What happens |
|---|---|
| 0.0 s | The four cleared stripes turn to clear glass (no white flare) and their forty threads start to pour (§3.5), reaching the whole carpet. |
| 0.1–0.6 s | Every sash of the sun wall rises together, lowest tier first. The hall floods with clear morning sun. **Measured mean frame luminance rises ≤ +0.25 stop** over the rest frame, ramp ≥ 0.4 s, multiplied by an iris dip so event lights stay within ×1.5 of the bloom knee; the peak is placed **after the board's own gold flash has decayed** (measure its timing in the real game at step B4 and set the delay; default 0.5 s). The flood is an *area* of clear sun (the white air slab and the clear-glass pools), not a brightness spike. |
| 0.7–2.1 s | The sashes fall back tier by tier, top first, each tier re-cutting the flood into one glass colour. The hall ends crossed by **seven stacked slabs: pomegranate, saffron, pistachio, firuzeh, lapis, banafsheh, rose**. This spectral order is **the theme's only rainbow**. |
| 2.1–6 s | The seven bands pour into the carpet's channels, run the whole woven garden at once, cross the threshold, and run down the avenue's jub to the far gate. |
| by 7 s | Faded. |

- **Reduced motion:** the sash rise and fall become two 0.6 s cross-fades; the flood is ≤ +0.15 stop.
- `flash = max(flash, x)` never stacks.

### 3.8 Perfect clear, amended: a gentle Ganzfeld

| Time | What happens |
|---|---|
| 0–1.4 s | Dust rises everywhere into a luminous fog; walls, glass and floor lose their edges. |
| 1.4–5.0 s | **The field.** Colour = `mix(litPlaster, castColour(lead), 0.35)` (chroma ≤ 0.35 of the lead's cast colour). It walks only **lead → accent 1 → accent 2 → lead** of the current set, **≥ 2.0 s per hue**, luminance constant within ±5%. A pomegranate accent is skipped (no saturated red field). Depth dissolve capped at **75%**: near geometry keeps ≥ 25% of its contrast. The sun wall's glass glows through as a soft anchor. Calm zones intact. Exposure ≤ +0.2 stop over ≥ 1.2 s. |
| 5.0–7.5 s | The fog thins from the glass outward and reveals the pavilion re-glazed: a new sash set in the windows, the Rug a clean lattice of clear sun (the board is empty), the woven garden fully lit and draining. |

- **Reduced motion:** one hue (the lead's) held, no walk; fog density ×0.5.
- **Reads as:** "the room dissolved into light and came back new." It is still the rarest event and still
  surreal, but no longer a full-field saturated hue cycle.

### 3.9 Combo: Irrigation kept, release on the breaking lock

The play judge's favourite beat; keep §1.5's escalation table exactly, with four additions:
- **Countable bands:** a thin walnut-dark guard line (one woven pick wide) separates consecutive bands, so
  two links of the same colour still count as two.
- **The release is delivered on the breaking lock.** Clone `src/themes/rainbark/rainbark-director.js`: at
  `flush()`, a slot with a staged lock, no staged clear and a reported combo > 0 sends `combo(0)` now; the
  tracker's later 0 is suppressed; a late clear before the next lock resumes the chain.
- **Resume rule:** a combo rise within 0.6 s of a release (asynchronous multiplayer clears) keeps the light
  flowing without restarting the drain.
- **The release is sized by the peak** (the cross-slate "reward the release" rule): drain time
  `2 + min(1, (peak − 2)/6)` s, so 2 s at peak 2 and 3 s at peak ≥ 8; from peak 7 the last band runs out
  through the far gate, as §1.5 says. Nothing flashes on release; the reward is the visible run-out.

### 3.10 Rendering: scope cuts, cost and compile size

**Scope cuts (they also lower the "looks cheap" risk).**

| Element | §1.7 | Amended |
|---|---|---|
| Muqarnas + mirror tesserae (CPU mesh generator, 6k–25k triangles) | Built | **Removed.** Coffered ceiling: a few boxes and planes; the khatam star panels and mirror inlays are drawn by `hrGirih` in the ceiling's fragment shader (no `castLight`; bounce + glints only). |
| Tile dado (CPU-baked tile atlas) | Built | **`hrGirih` with a tile palette** (turquoise, lapis, ochre, white) and a glaze sheen. No atlas. |
| Gate pavilion, garden wall, windcatcher, ridge, far cypress files | Low-poly boxes + impostors | **Painted in the backdrop function** in direction space (silhouettes with aerial perspective), zero geometry. Only the near cypresses (≤ 24), near plane trees and the jub are geometry. |
| Niche wall | Parallax 4–16 + self-shadow 4–8 everywhere from Medium | Parallax 4/8/12 on Medium/High/Ultra+; **self-shadow on High and up only**. |
| Garden through glass | Direction-space canopy silhouettes | Kept (cheap). |

**`castLight` restructured.**
- `hrWindowHit(P, toSun, origin, right, up, normal, size, penK)` → `vec4(uv, t, pen)`: a **laid-out pure
  `Fn`**; every value passed in (gotchas #93/#95).
- `hrGirih(p, fold, turn)` → `vec4(cellCode, petal, sdfToCame, cellSize)`: laid-out pure, as proposed.
- `hrCastLight(P, N)` is a thin **inline builder** that loops the live windows (`Loop` over `u.winCount` ≤ 8,
  named `win`), reading the window rows from a small `uniformArray` and calling the two helpers.
- **Only three materials call it:** the floor (carpet + tile margin), the wall shell (plaster, dado, niches,
  iwan; one material with region codes) and the curtains. The glass evaluates the girih directly; the
  ceiling, the garden and the air never call it.

**The glass image (new, small).** For everything that sees the glass blurred (far pools, the air slabs,
tile and inlay reflections), read a **CPU-baked per-bay glass image** instead of evaluating the girih:
- RGBA8 `DataTexture`, rgb = pane colour, a = came coverage; 64×96 per bay on Minimal and Low, 96×144 on
  Medium, 128×192 on High and up; CPU mips.
- Baked three-free in `haft-rang-bake.js` from a **CPU mirror of `hrGirih`** (same maths, unit-tested to
  agree with the shader at sample points), in a microtask on build, on each sash change, and at the end
  state of each T-spin click. During the 0.35 s click spring the slabs cross-fade from the start image to
  the end image.
- `glass_w` becomes `mix(cell, glassImage.sample(uv).level(lodFrom(pen)), smoothstep(0.25, 1.0, pen/cellSize))`,
  and evaluates the girih only when `pen/cellSize < 1` (near pools).

**Air slabs: analytic chord, not a girih march.**
- Per window: the analytic ray against the swept prism (window quad × `toSun`) gives `[t0, t1]`, clipped by
  the room's analytic floor and wall planes. Chord `L = t1 − t0`.
- In-scatter = `density·L·SUN·T̄·HG(g 0.55)`, with T̄ the glass image read at the chord midpoint's glass uv
  with a mip from the chord's projected length on the glass. The prism edges soften with `pen(t)`.
- Extra **noise taps** along the chord for dust texture (density only, plus one glass-image read each):
  0/1/2/3/4/6 on Minimal…Extreme (so 1/2/3/4/5/7 samples in all), interleaved-gradient jitter.
- Early out inside card and HUD rects; slab prisms never cross the card (§3.13).

**Girih families: 8-, 6- and 12-fold only.**

| # | Set | Lead | Accents | Lattice (amended) | T-spin click |
|---|---|---|---|---|---|
| 1 | *Za'feran* | Saffron | Pomegranate, clear | 8-fold khatam (square lattice) | 45° |
| 2 | *Lajvard* | Lapis | Firuzeh, clear | **6-fold star-and-hexagon (hex lattice)** | 60° |
| 3 | *Golab* | Damask Rose | Violet, Pistachio | 12-fold shamseh (hex lattice) | 30° |
| 4 | *Sarv* | Pistachio | Firuzeh, Saffron | 8-fold, split petals (square) | 45° |
| 5 | *Anar* | Pomegranate | Saffron, Rose | **6-fold interlaced hexagrams with kite petals (hex)** | 60° |
| 6 | *Banafsheh* | Banafsheh | Lapis, Rose | 12-fold (hex) | 30° |
| 7 | *Firuzeh* | Firuzeh | Pistachio, Lapis | 8-fold with crosses (square) | 45° |

- A star turned by its own symmetry step is geometrically unchanged; only its petal colours move. Every
  star in every set therefore carries **≥ 2 distinct petal colours** (core test), or the click is invisible.
- Square and hex families alternate, so consecutive sets always change lattice type.
- **Balance:** each set's mean cast luminance (after the §3.11 pool gain) is within ±10% of the others
  (core test), so the 2.4 s hard-edged level wipe is a change of pattern and hue, never a large luminance
  edge crossing the screen. Balance it with each set's share of clear panes: a lapis-led set needs more
  clear glass than a pistachio-led one.

**Cost targets.** The proposal's per-tier estimates (§1.7) were never measured; ADR-0016 requires a
verified instrument. With the cuts above, target **Low ≤ 6 ms on a phone at 390×844** and **High ≤ 8 ms on
an iGPU at 1080p**, measured with `profile=1&trackTimestamp=1` in the playground and the phone validator
(§5.11). Scope cuts if over budget, in order: motes on Medium, niche parallax, tile reflection samples,
third bay, garden jets count. Never cut: `castLight` with physical penumbra, the Sun Rug, the slabs (at
least the analytic chord), irrigation, the sash mechanics, every event beat.

### 3.11 Pools: the mixing rule and the per-glass gain

**Why not gotcha #157.** #157 (`hue / Σw³ · (Σw / (Σw + 1)) · 2`) gives the hue to the strongest pool. It is
right for themes that hold a colour per site. Here **mixing is the subject** ("mix" is one of the five
verbs), so the hue must come from the sum.

**The rule (one laid-out pure helper, `hrMixPools`).**
```
C  = Σ castColour_i · gain_i · w_i               // true additive mixing, linear RGB
m  = max(C.r, C.g, C.b)
S  = m <= 1 ? m : 1 + (Pmax − 1)·(1 − exp(−(m − 1)/(Pmax − 1)))   // Pmax = 2.5; bounded exp (#71)
C' = C · (S / max(m, 1e-4))                       // hue-preserving: every channel scaled alike
```
- Overlaps whiten because the true sum whitens, never because a channel clips. Three or more pools cap at a
  peak channel of 2.5, inside the §1.2 pool range (0.8–2.5).
- **What the mixes really look like** (normalised cast colours): rose + firuzeh = (1.01, 1.27, 1.39), a pale
  blue-white; rose + lapis = (1.04, 0.40, 1.54), lilac; saffron + firuzeh = (1.01, 1.23, 0.86), a pale
  yellow-green. The proposal's "rose over turquoise turns pale lilac" was wrong; use these.

**Per-glass pool gain.** Cast luminance spreads 5× across the glasses (§1.3 table: lapis 0.17, pomegranate
0.24, banafsheh 0.32, saffron 0.38, rose 0.45, firuzeh 0.78, pistachio 0.89). Physically right, but on wool
the lapis and pomegranate pools would read as shadows and the Rug's cells would not separate.
`gain_i = max(1, 0.35·Y_clear / Y_i)` with `Y_clear` = 0.89 lifts lapis ×1.83 and pomegranate ×1.30 and
leaves the rest alone. Applied to pools, the Rug and the slabs; **not** to the glass seen directly (backlit
glass is already far above the knee).

### 3.12 Piece colours, amended (keep away from Rainbark)

Rainbark (`src/themes/rainbark/rainbark-tetrominos.js`) also spends the whole spectrum on its pieces, and
three of Haft Rang's shapes landed on nearly the same colours:

| Shape | Haft Rang (§1.6) | Rainbark | ΔE76 |
|---|---|---|---|
| S | Banafsheh `#A47BF2` | Bloom Violet `#B98AF2` | **10.5** |
| Z | Firuzeh `#0B8A80` | Glaucous Teal `#1A93AC` | **21.9** |
| J | Pomegranate `#C42131` | Ruby Bark `#D23468` | **26.4** |

A search over all 5,040 assignments of the seven glasses that keeps the gate at 0/7 and keeps I, O, T and L
gives this remap (S, Z and J rotate):

| Shape | Glass | Hex | Hue | Band | Match? | ΔE76 to Rainbark's same shape |
|---|---|---|---|---|---|---|
| **I** | Saffron (the sunbeam) | `#E8781A` | 27° | cyan 160–210 | no | 82 |
| **O** | Lapis (the square tile) | `#2646B8` | 227° | yellow 32–75 | no | 128 |
| **T** | Damask Rose | `#F98BBE` | 332° | purple 245–315 | no | 115 |
| **S** | **Pomegranate** | `#C42131` | 354° | green 90–170 | no | 86 |
| **Z** | **Banafsheh** (violet) | `#A47BF2` | 261° | red 320–20 | no | 71 |
| **J** | **Firuzeh** (turquoise) | `#0B8A80` | 175° | blue 200–250 | no | 98 |
| **L** | Pistachio | `#C9E263` | 72° | orange 20–50 | no | 143 |
| GARBAGE | Walnut came | `#2E2522` | | | | |
| CLEAN_GARBAGE | Seedy clear glass | `#B9AE9F` | | | | |

- **Gate:** 0/7 (recomputed for this document with the gate's hue bands).
- **Colour-blind separation is unchanged**, because it depends only on the set of seven colours, not on
  which shape wears which. The closest pairs are the same *glasses* as in §1.6, now on these shapes:

  | Vision | Closest pair (glasses) | Shapes after the remap | ΔE |
  |---|---|---|---|
  | Deuteranopia | Saffron / Pistachio | I / L | 22 |
  | Protanopia | Damask Rose / Firuzeh | T / J | 22 |
  | Tritanopia | Saffron / Pomegranate | I / S | 24 |
  | Normal | Lapis / Banafsheh | O / Z | 29 |

  Pin these four pairs in the core test by glass name.
- The T keeps its rose panes (the T-spin's "the T's own rose panes twist into place" still holds).
- `effects.phaser` and the ghost stay as §1.6.

### 3.13 Readability behind and beside the card

- **The calm field.** The iwan behind the card is a plain lime-plaster back wall, lit only by soft bounce
  (0.4–0.6 linear), with no lattice pool landing on it. The sun-wall bays' light is aimed left and down by
  the geometry; the composition solver rejects any sun-walk phase whose pools would reach the iwan's card
  region.
- **No slab behind the card.** The solver checks every slab prism's screen projection against the card and
  HUD rects + 0.03 for the whole sun walk (azimuth 54–66°, elevation 18–30°) and shortens or reorients the
  offending bay's beam (the bays are fictional; move them). The air shader also early-outs inside the rects.
- **Quiet margin.** Lattice contrast in `castLight` fades to the pool mean within 40 px of any card or HUD
  rect (in buffer pixels scaled by the pixel ratio).
- **Motion near the card only on events.** The pigeon, jets and curtain are all ≥ 0.05 of the screen away
  from the card rect.
- **The HUD** keeps its calm zone over the far bay's lower sashes.
- **Target to measure in C1:** in the `board=1` rest shot, the tone-mapped luminance standard deviation in a
  0–40 px ring round the card is ≤ 0.08, and the mean in that ring differs from the card's own background by
  ≤ 0.15.

### 3.14 The name (a Stage 0 question for the user)

Options, with the recommendation first:
1. **Haft Rang**, with an English subtitle wherever the name is shown in full: "Haft Rang — the house of
   seven glasses". Keeps the triple meaning (tile craft, seven glasses, seven pieces).
2. "Seven Lights" (plain English, loses the craft meaning).
3. "Sunglass" (the brightest light in the hall; risks reading as eyewear).
4. "Orosi" (precise, more opaque than Haft Rang).

Whatever is chosen, the id stays `haft-rang` unless the user picks option 2–4, in which case derive the id
from the name before Stage 0's rename work.

### 3.15 House FX grammar check (amended)

The canonical list is in `docs/theme-concepts/README.md`. Item by item:

| House convention | Haft Rang (amended) |
|---|---|
| A spark or wisp of the piece's colour leaves the card edge into an object that keeps it (~30 s) | Nothing leaves the card. The light is cast instantly; the Rug is a live mirror, not a holder. |
| A ring under or round the board | None. |
| Blades of light or twin jets from both card edges at the cleared rows | None. Cleared panes slide out of the floor image and pour into a channel on one side. |
| One wave front per line | One run-off pulse per clear; lines scale its thread count and reach. |
| Four lines: a hush (lights sink), then a flare | Open, flood, split: no darkening, ≤ +0.25 stop. |
| T-spin: spiral, vortex or wheel round the card | Every lattice star clicks one symmetry step in place, everywhere at once. |
| Level up: an hour wheel or palette cross-fade | A mechanical sash-change wipe; the hour never turns. |
| Hard-drop camera dip or shake | Local dust in the card's beam; no camera motion. |
| Combo as one intensity dial "charging" the world, or levitation | A spatial reach meter: light flows down channels, counted in bands. |
| B2B as a faint echo | The ceiling's mirror inlays answer in their own screen region (the top band) and hold a sheen while the streak lives. |

---

## 4. Overlap with Rainbark

Rainbark (`docs/theme-concepts/rainbark.md`; code in `src/themes/rainbark/`) is colossal painted
eucalyptus trunks in blue air over a mist floor; its events are material (peel on lock, shed on clear,
moult on four lines), its combo counter is canopy-gap sun pools, and its B2B is a sunshower. It was the
competition's winner and borrowed two of Haft Rang's ideas. A build of Haft Rang must keep its own identity
next to it.

### 4.1 What Rainbark already took from Haft Rang

From Rainbark's graft table ("What is grafted from the runners-up", in `docs/theme-concepts/rainbark.md`):

| Haft Rang idea | How Rainbark uses it | What Haft Rang keeps |
|---|---|---|
| Cause and effect across the frame: the light source on the open right, the light landing on the left | Rainbark's sun enters from the open right and lands on the Elder trunk's card-facing face, where the peels are | Haft Rang's version is literal and coloured: a **glass wall** is the source and **pools of coloured light on a carpet, niches and tile** are the landing. Keep it; it is the concept's origin. The two thumbnails differ completely (warm interior vs blue forest air), but do not add a vertical hero on the left. |
| The board's pieces live in the world | Rainbark's last ~12 pieces stand as fresh bark bands beside the card and **ripen away** by the world's clock | Haft Rang's version is a **live mirror of the whole board**: a colour lasts exactly as long as its piece is on the board and leaves on its clear. Never let Rainbark's "recent pieces that fade" creep in (no age-out during normal single-player play). |

The judges also offered other Haft Rang ideas as grafts that Rainbark did **not** take: `castLight`, the
irrigation meter, the white-to-seven split, the Ganzfeld, the sash wipe, slab-coloured motes, curtains on
game over, the lattice-click T-spin, B2B in the top band. They remain Haft Rang's own.

### 4.2 New similarity risks now that Rainbark exists

| Risk | Why it is real | Mitigation in a Haft Rang build |
|---|---|---|
| **Sun pools with physical penumbra** | Rainbark's `rbFleck` uses the same physics as `castLight` (penumbra from the sun's 0.53° disc) for white-gold pinhole sunflecks, and its combo is counted in big sun pools | Haft Rang's pools are **coloured, geometric, lattice-printed lozenges on horizontal wool and plaster**; Rainbark's are soft white-gold ellipses on vertical bark. Never use white pinhole flecks or leaf-shadow dapple as a major element; dapple stays a ≤ 25% modulation inside clear-pane pools (§3.3). |
| **Combo counted in pools of light** | Rainbark: "big pools with beams = chain − 1" at fixed stations | Haft Rang's meter is **reach along channels** (bands of light flowing like water). The medallion pool at ×3 is a step on the path, not a counter. Never add discrete per-link pools or beams. |
| **Two full-spectrum themes in high daylight** | Both use all seven hues in bright light | Haft Rang is a **warm interior** (madder, walnut, lime, saffron rest set) with the spectrum in glass and light; Rainbark is cool slate-blue bark in blue air. Compare 80 px picker thumbnails side by side before Stage B; Haft Rang's must read warm and architectural. |
| **Piece palettes** | S ΔE 10.5, Z 21.9, J 26.4 before the fix | Remapped in §3.12 (worst same-shape ΔE 71). |
| **A hard-edged front sweeping the world** | Rainbark's moult front runs down every trunk on four lines | Haft Rang's front is the **level** sash change: a straight horizontal wipe of lattice pattern and hue, mechanical, 2.4 s. Do not use a front on four lines (the quad is open, flood, split). |
| **Restart rite** | Rainbark: "morning returns" as the mist drains | Haft Rang: the silk curtains gather back in 1.2 s and every edge snaps crisp. Textile and light, no mist. |
| **Registry group** | Both `biomes` | Fine; the group only sorts the picker. |
| **Wetness or rain as reward** | Rainbark's Sunshower (B2B) and Moult deepen colours with wetness | Haft Rang has no rain and no wetness. Its water is the jub and the channels' light-as-water metaphor only. |

### 4.3 What a Haft Rang build must not borrow back from Rainbark

No bark, peeling, curls or shed strips (curtains slide, they never peel); no canopy-gap pools or white
gobo flecks as a mechanic; no mist floor or abyss; no blue air as the aerial-perspective target (Haft
Rang's garden haze is Desert Morning `#CFE3EC` toward a dust-white horizon); no rain, sunshower or
wetness; no camera climb on level up (no camera move on any event at all); no "floor reveal" on the perfect
clear. If a step drifts toward any of these, stop and re-read §1.5 and §3.

---

## 5. Implementation plan

The house pattern is the "masterpiece rebuild" layout of `src/themes/serenity-warp/`, as cloned by Rainbark
(`src/themes/rainbark/`, commit `585ab55` and the work after it). Rainbark is the closest working
precedent: the same three r186 stack, the same director extensions (shadow well, combo-break inference, B2B
level), the same rename procedure. Read its files before writing new ones. Everything below already
includes the §3 amendments.

### 5.1 Stage 0: slot, questions, rename and scaffold

1. **Ask the user the two Stage 0 questions:** the name (§3.14) and the Persian-heritage review (§3.2). Do
   not start Stage A until the review is arranged (the review itself can happen in parallel with Stage A,
   but its verdict gates Stage C).
2. **Choose the slot** with [PLAYBOOK.md §1 "Choosing a slot"](PLAYBOOK.md#1-choosing-a-slot): which theme
   Haft Rang replaces (call it `OLD_ID`; recommended, PLAYBOOK §1a), or whether it is added as a 62nd theme
   (PLAYBOOK §1b: that breaks the counts pinned by tests, such as the 61-entry registry and music
   catalogue, **and** needs a new Odyssey orb or a bonus route, because every non-starter theme has exactly
   one orb). **It is a product decision: ask the user; do not guess.** The concept was written for Cosmic
   Chimes' slot, which Rainbark now holds (`585ab55`), so Haft Rang needs a slot of its own.

   **Candidates to put to the user** (from the PLAYBOOK §1a facts script, run on this branch on
   2026-10-12; re-run it, the fleet changes). Orb numbers are the assembled campaign's (`LEVEL_CONFIGS`),
   as the script prints them; the authored entries in `src/core/odyssey/data/levels.js` carry different
   literal ids (`moonlit-greenhouse` is `id: 15` there), so find an orb by its `theme.primary`. Prefer a theme without a masterpiece rebuild (no `world.js`,
   no effect) and with subject overlap (this concept's "compare against" list is in the header):

   | Candidate | Orb, chapter, name, role | State | Song | Fit for Haft Rang |
   |---|---|---|---|---|
   | `moonlit-greenhouse` | orb 14, ch3 "Surface World & Living Landscapes", "Glasshouse Reverie", `teach` | legacy DOM/CSS + 2D canvas, `light`, no `world.js`, no effect, not in the phone validator | authored (`moonlit-greenhouse.mp3`) | **Best fit.** It is in this concept's near-collision list (§1.8: "a glazing grid and a window"), so replacing it removes the overlap instead of living beside it; a glass building opening on a garden in the Earth-surface chapter; the orb name "Glasshouse Reverie" can even stay. Note that this orb runs in **Infinity** (`baseMode: 'infinity'`, a 10×26 board with 6 pre-filled starting rows): Rug rows come from `viewportOrigin`, sash sets advance every 15 lines or 150 s, and the pre-filled rows never reach the bus (they show as clear glass in the Rug until cleared; keep the garbage-push inference multiplayer-only so they cannot shift the mirror). |
   | `misty-lake` | orb 11, ch3, "Lakeside Awakening", `arrival` | legacy classic WebGL, no `world.js`, no effect | authored | **Taken:** Grainfields replaced it on 2026-10-18 (orb 11 is now "Grainfields"). It was: chapter fit (Earth surface, daylight works); no subject overlap; loses a night lake. |
   | `rainy-window` | orb 31, ch5 "Sky & Atmospheric Drift", "Storm Surge", `test` | legacy classic WebGL, `urban`, no `world.js`, no effect | authored | **Taken:** Sunbraid replaced it on 2026-10-20 (orb 31 is now "The Turning Suns"). It was: a window theme, so some subject overlap; but a grey storm orb in the sky chapter becoming a bright pavilion is a tone shift. |
   | `singing-bowl` | orb 56, ch7, "Recursive Infinity", `boss` | legacy classic WebGL, `meditation`, no `world.js`, no effect | placeholder | Weak: abstract chapter, boss beat; only if the user wants the calm interior there. |

   Whichever slot: if `OLD_ID` is itself the *target* of an existing `RETIRED_THEME_IDS` alias (today
   `rainbow-terraces`, `pyrestorm`, `murmuration`, `rainbark`), re-point that alias to `haft-rang` too:
   `resolveThemeId` follows only one hop.
3. **Worked example:** commits `0c747dd` and `585ab55` replaced Cosmic Chimes with Rainbark.
   [PLAYBOOK.md §4](PLAYBOOK.md#4-rename-and-retire-checklist) is that change generalised into a 21-step
   ordered checklist; follow it for `OLD_ID → haft-rang`, with these Haft Rang values:
   - registry entry in place in `src/themes/theme-registry.js` (`group: 'biomes'`; add to
     `HEAVY_GPU_THEME_IDS`); `RETIRED_THEME_IDS` gains `['OLD_ID', 'haft-rang']`;
   - the song: an **authored** recording is retitled (ID3 TIT2 rewritten, audio bytes and file length
     unchanged, PLAYBOOK §4.3; track key renamed; `RETIRED_TRACK_KEYS` entry; tell the user the recording is
     unchanged); a **placeholder** is only renamed (`haft-rang-placeholder-song.mp3`, never retitled: it must
     stay a byte copy of `blood-moon.mp3`) and still gets the `RETIRED_TRACK_KEYS` row; either way regenerate
     `public/assets/music/songs.json` with `node generate-songs.js`;
   - the Odyssey orb (every non-starter theme has one) keeps its slot, mechanics, victory and stars, with
     new copy and `transitionIn: 'crossfade'`; rename it only if its name does not fit a sunlit garden
     house (suggested name "The House of Seven Glasses"; "Glasshouse Reverie" can stay); copy "a garden
     house where the morning pours through coloured glass" (no religious words), in both the base
     `metadata` and `LEVEL_PHASE2_OVERRIDES`; swap the id in the chapter list
     (`src/core/odyssey/data/chapters.js`);
   - `src/core/odyssey/theme-presentation.js` key colour: suggest `'#E8781A'` (Saffron);
   - ThemesTab fallback glyph (`src/ui/serenity-hub/ThemesTab.js`): suggest `'sun'` (never `'temple'`);
   - the static `<div id="haft-rang-theme" class="theme-container">` in `index.html` (in place of the old
     one) and the container CSS in `public/styles/main.css`:
     `#haft-rang-theme { background: <clear colour>; overflow: hidden; }`;
   - the `captureThemes` row in `src/ui/url-parameters/theme-parameters.js`:
     `['haft-rang', 'haftRang', 'Haft Rang', 'sky, garden, hall, carpet, orosi, curtains, air, motes']`;
   - playground parameter catalogue entries; the phone validator list; CREDITS and living docs; a rename
     migration test cloned from the Rainbark one.
4. **Clear colour:** a warm mid-dark value so the 2.5 s container fade never flashes white or black,
   taken from the scene: suggest `0x6B4E40` (Umber Bounce lifted toward Gach).
5. **Scaffold:** clone Rainbark's adapter, director, composition, quality and post; a minimal world that
   draws only the sky and satisfies `WORLD_METHODS` from day one; the playground effect. Delete the old
   theme folder and obsolete tests per the checklist. Run the minimal verification list (§5.11) before
   Stage A.

### 5.2 Files (`src/themes/haft-rang/`)

| File | Role |
|---|---|
| `haft-rang-core.js` | Three-free: `GLASSES` (seven + clear, hexes, normalised cast colours, pool gains §3.11), `SASH_SETS` (§3.10 table: lead, accents, lattice family, fold, clear share), `PIECE_GLASS` (§3.12 map), `TIMING`, `EVENT_ROWS`; `sunWalk(t)` (closed form, 360 s, az 54–66°, el 18–30°); `veilAt(t)`, `breezeAt(t)`, `pigeonSchedule(t)`; the irrigation integrator (front `F`, drain `F_drain`, colour ring of ≤ 10 bands, resume rule); `girihCpu(p, fold, turn)` (CPU mirror of `hrGirih`); `mixPools(...)` (CPU mirror of `hrMixPools`); `BoardGlass` (atlas packer, healing rules, 4 s age-out); `packCodes`/`unpackCodes` (10 codes × 3 bits in two floats); per-aspect composition anchors; `cellsFromMatrix`, `approach`, `smooth`, `mulberry32`. |
| `haft-rang-bake.js` | Three-free typed-array bakes, deterministic by seed: `bakeCarpet(size)` (colour map + aux map: channel mask, geodesic distance `d` from the medallion, motif class, pile AO; chahar-bagh borders, guards, madder field, indigo channels with woven wave lines, cypress, pomegranate and rose motifs, *abrash*), `bakeGlassImage(set, bay, size)` (+ CPU mips), `bakeFbm` (+ mips), `bakeLattice` (for `noise3`), `bakePlaster`. A node script (`scripts/` per PLAYBOOK) writes the carpet PNG pair (≤ 400 KB each) from the same code; runtime fallback bakes 1024×512 in a microtask. |
| `haft-rang-tsl.js` | `createHaftRangUniforms` (`u`, `events`, `windows`, `palette`, counts); `DataTexture` wrappers (board atlas: NearestFilter view for codes + LinearFilter view for penumbra; glass images; carpet maps); laid-out pure helpers (`hrHash21`, `hrHash31`, `hrGirih`, `hrWindowHit`, `hrMixPools`, `hrHg` (products, clamped), `hrSchlick` (products), `hrGlassFilmic`, `hrRoundBoxSdf`, `hrDecodeCode`); inline builders that read `u` and textures (`hrCastLight`, `hrGlass`, `hrBackdrop`, `hrBounce`, `hrChannelFlow`, `hrGanzfeld`, `hrAirChord`). `export *` from core. |
| `haft-rang-sky.js` | Backdrop triangle at the far plane: sky, aureole, haze, far garden (gate, wall, windcatcher, far cypress files, ridge) in direction space; the through-glass variant (plane canopies, seedy wobble). |
| `haft-rang-garden.js` | Near garden geometry: ground (gravel, beds, rose dots), jub with six chadar chutes and the fountain jets, near cypress impostors (≤ 24, instanced, SDF flame silhouette), near plane trees. |
| `haft-rang-hall.js` | Floor (carpet + tile margin), wall shell (plaster, dado via `hrGirih` tile palette, iwan, niche wall, arch reveal), coffered ceiling with khatam panels and mirror inlays, the hurno, takht props (bolster, tray of tea glasses, pomegranates). |
| `haft-rang-orosi.js` | Sun-wall bays (2, or 3 at 21:9 / Extreme): glass, walnut frames, sashes (per-tier offsets), the shamseh fanlights, gauze curtain, silk curtains. |
| `haft-rang-air.js` | Full-screen slab chord pass (premultiplied additive) and the dust glint pool. |
| `haft-rang-fx.js` | Timed-queue stagers writing event rows: landings, pours, dust puffs, irrigation fronts, sash rise/fall, quad phases, T-spin clicks, mirror sweep, Ganzfeld, sash-change front, curtains, cameos, veil, breeze. |
| `haft-rang-world.js` | `HaftRangWorld` with every `WORLD_METHODS` method (`build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`) plus `onB2B(level)`, `onGameOver()`, `onSessionStart()`, `setBoardCodes(slot, codes)`; camera rig per aspect (breath ±2 cm at 0.05 Hz, parallax ±1.5°); timed queue; slot rings; glass-image rebakes in microtasks; writes `u`. Exports `REST_RIG`, `fovForAspect`, `HAFT_RANG_PARTS = ['sky', 'garden', 'hall', 'carpet', 'orosi', 'curtains', 'air', 'motes']`. |
| `haft-rang-director.js` | Clone of `rainbark-director.js`: try/finally delivery, `broke` flag, `shape`/`cells`, shadow well with `rowCodes`, combo-break inference on the breaking lock, B2B live level with break inference, the multiplayer pending-COMBO stash, hard-drop `distance`, meditation positions. **Adds** `boardCodes(slot)` (10×20 visible codes after each flush) and the garbage-push inference (§3.4). |
| `haft-rang-composition.js` | Cloned readers (with `'#online-main-board canvas'`) plus presets (desktop 16:9, 21:9, short laptop, portrait aspect < 0.62, HUD mirroring); `solveRug(layout, aspect)` (§3.4 constraints); `solveBays(layout, aspect)` (slab prisms ≥ 0.03 outside card and HUD rects over the whole sun walk; pools never on the iwan's card region); garden-share measure; anchors for props, jets, pigeon. |
| `haft-rang-post.js` | `HaftRangPost` (`RenderPipeline`): knee bloom (threshold 1.0, knee 0.5, hue-preserving high-pass clamp, threshold follows the iris), one output pass (calm zones, bloom, exposure + capped flash, glass filmic shoulder k 0.5 whitening above peak 6, grade umber shadows / cream highlights / saturation 1.08, vignette 0.28, sRGB, grain 0.012, dither), Ganzfeld helper `mix(S, bloomLowMip, gz·(1 − calm)·0.6)`, FXAA on Medium, MSAA 4× on High and up, `POST_LOOK`, `createPassThroughPipeline` (AgX), `falseColor`. |
| `haft-rang-quality.js` | `QUALITY` (§5.8), `QUALITY_NAMES`, `tierFor`. |
| `haft-rang-theme.js` | Clone of `rainbark-theme.js`: ids, flags (`haftRangTime`, `haftRangFixedDt`, `haftRangParts`, `haftRangFalseColor`, `haftRangForceWebGL`), renderer with WebGL2 fallback and GPU-loss handling, layout reads on frame time (never from handlers), calm zones, settings. Sink: `lock` → `world.onLock` + `world.setBoardCodes`, `clear` → `world.onClear` (+ codes), `combo` → max over players, `levelUp`, `b2b` → `world.onB2B` (max over players); window `gameOver` and `modeStopped` → `world.onGameOver(); resetSession()`; `modeStarted` → `world.onSessionStart()` (curtains gather back). |
| `haft-rang-tetrominos.js` | §3.12 colours and §1.6 `effects.phaser`. The file name follows the repo convention. |
| `haft-rang-theme-icon.png` | 512² 8-bit RGBA, circular. The saffron-set shamseh fanlight blazing over a corner of carpet with lattice-printed pools and one mixing overlap, one slab of coloured air. No arch silhouette, no rainbow, no rose set. Mirror to `public/assets/themes/haft-rang-theme-icon.png`. |
| `src/playground/effects/haft-rang.effect.js` | Mounts the same world and post (`capture: true`), events through a real director, imports only `three/webgpu` plus its own theme modules. |

### 5.3 Director and sink contract

```
sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, rowCodes, screen })
sink.combo(n, player)        // true combo; 0 = broke, inferred on the breaking lock; idempotent vs the tracker's late 0
sink.b2b(level, player)      // 0..3; 0 inferred from a non-difficult wave-1 clear (no producer sends active:false)
sink.levelUp(level)
director.boardCodes(slot)    // 10×20 visible codes (0..6 glasses by piece, 7 garbage, 255 empty) after each flush
```
Event facts to respect (full payloads per mode, and the mode-by-mode checklist in its §11, are in
`docs/theme-concepts/reference/events.md`; the adapter lifecycle is in `reference/adapter.md`): subscribe only to `PIECE_LOCK, HARD_DROP, LINE_CLEAR, COMBO, TSPIN, B2B,
PERFECT_CLEAR, LEVEL_UP`; the bus `COMBO.comboCount` is cascade depth, not the true combo (ADR-0011); the
HARD_DROP `piece` is pooled (copy synchronously); visible row = board row − 4, clamped 0..19; Infinity uses
`viewportOrigin`; local multiplayer has no TSPIN/B2B/LEVEL_UP/PERFECT_CLEAR and no cascade count on
LINE_CLEAR; online multiplayer has no `player` (slot 0); PERFECT_CLEAR arrives in a later frame with no rows
(a standalone moment); game over is the window `gameOver` event (single player and Infinity) or
GameModeManager `modeStopped` (Odyssey has no window `gameOver`). Settings: `pieceLockRipple` off → no
landing glint, bloom or dust; `backgroundComboEffects` off → no event reactions and an empty Rug, the
ambient world continues.

### 5.4 The event table and uniform arrays

Three `uniformArray`s per stage at most (gotcha #102): `u.events` (vec4, ≤ 64 rows, live rows compacted,
counts in int uniforms), `u.windows` (vec4, 8 windows × 4 rows = 32: origin + size, right, up, normal +
kind), `u.palette` (vec4, ≤ 32: 7 glasses + clear with gains, 7 set weight rows, slot means). Suggested
event layout:

| Block | Slots × rows | Rows | Contents |
|---|---|---|---|
| Lock landings | 8 × 1 | 8 | slot, top and bottom row, lock sequence (matches atlas alpha), birth time |
| Clear pours | 8 × 2 | 16 | slot, row, channel id, birth time; packed codes A and B (5 × 3 bits each), reach, cascade wave |
| Dust puffs | 4 × 1 | 4 | slot, density, birth time, strength k |
| Irrigation | 12 | 12 | `F`, `F_drain`, band count, colour ring (10 codes packed), run-off fronts |
| Sashes and the quad | 6 | 6 | per-tier offsets, quad phase, flood, split progress |
| Singles | 9 × 1 | 9 | T-spin click (turns, phase), mirror sweep and B2B level, Ganzfeld, sash-change front, curtain (gauze gust, silk), pigeon, veil, dapple, breeze |
| **Total** | | **55** | |

Loop names (gotchas #110 and #155): `win` (windows), `ld` (landings), `cp` (pours), `dp` (dust), `ir`
(irrigation bands). The board atlas, glass images and carpet maps are textures, not uniform rows.

### 5.5 Playground parameters

Every parameter must be catalogued in `src/ui/url-parameters/playground-parameters.js` with `scope` naming
`haft-rang` and `sources` naming the effect file; the URL-parameter catalogue test fails on any literal
`params.get('x')` that is not catalogued.

| Param | Meaning |
|---|---|
| `t` | Fixed time (phase-locked; `seek(t)` every frame) |
| `quality` | Minimal…Extreme; default High |
| `level` | 1–14; default 1 (set = (level − 1) mod 7) |
| `set` | 0–6, overrides the level's sash set |
| `sun` | 0–1, holds the sun-walk phase |
| `veil` | 0–1, holds the veil (penumbra ×(1 + 2·veil), sun −30%·veil) |
| `dust` | 0–1, holds the ambient dust density |
| `idle` | 1 = idle state (slabs whispering, breeze cycle 25–40 s) |
| `curtains` | 0–1, holds the silk curtains drawn to that fraction |
| `board`, `statsHud` | Mock board with the real selectors (calm zones, Rug solver, bay solver exercised) |
| `stack=<n>` | Fill the mirror's bottom n rows with a seeded stack (one gap per row, so no clears) |
| `locks=<n>` | Pre-play n locks (alternating pieces and columns) |
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
| `b2b=<0–3>` | Hold the mirror sheen level |
| `reduce`, `parts`, `noPost`, `falseColor`, `bloom` | Reduced motion, part filter, post off, false colour, bloom override |
| `px`, `py` | Hold the pointer |
| `icon`, `iconFov`, `iconYaw`, `iconPitch` | Icon frame |
| `demo` | 40 s loop of locks, clears, chains, four lines, T-spin and B2B |

### 5.6 Staged build order with acceptance shots

Each step is **one small effect per session** (`CLAUDE.md`). Each ends with playground screenshots (wait
for `window.__PLAYGROUND_READY__ === true`, then a few animation frames or `window.__PLAYGROUND__.seek(t)`),
a clean console (no WGSL, GLSL or validation errors), `window.__PLAYGROUND__.diagnostics()` read back, and
one Low-tier capture. On a dev machine use the `chrome-devtools` MCP; in a cloud container use the headless
Chromium + SwiftShader tooling printed in full in PLAYBOOK.md §5 (`shot.mjs`, `game.mjs`, `switch-away.mjs`; it includes the harness-only
`GPUTexture.createView` swizzle shim that Chromium 141 needs with three r186). Look at every PNG: a clean
console is not proof it looks right.

All queries below follow `/playground.html?`. Viewports: **D** = 1920×1080, **W** = 2560×1080, **L** =
1280×720 (short laptop), **P** = 390×844 (DPR 1). ★ = capture on both backends (add `&forceWebGL=1`).
Reference time `t=48`, level 1 (set *Za'feran*).

**Stage A: environment**

| Step | Work | Acceptance shots |
|---|---|---|
| **A0** | **CPU lab, no shader** (§5.12; numpy/PIL in the session's scratchpad, never committed): the seven girih families as glass and as cast pools at 1, 4 and 9 m with the penumbra formula; the carpet design bake; a massing render of the hall at the 16:9 camera with analytic pools; the Rug at stack heights 4, 10 and 16. Compare side by side with reference photos (§6). Write down the parameters that passed. | Montages of render vs reference. Pass only if the glass reads as Persian orosi lattice (not a church window, a Voronoi mosaic or a kaleidoscope), the pools read as sunlight on wool, the carpet reads as a garden carpet, and the room reads as a house (§3.2), not a mosque. Show the massing montage to the user for the heritage review. |
| **A1** | Sky and backdrop: zenith-to-horizon gradient, aureole, haze, far garden in direction space (gate, wall, windcatcher, far cypress files, ridge), the through-glass variant. | ★ `effect=haft-rang&t=48&parts=sky` @D · same @W · same @P · `effect=haft-rang&t=48&parts=sky&falseColor=1` @D (sky in the arch 1.3–1.8 linear). |
| **A2** | Hall shell, static: carpet maps (bake + PNG pair), plaster, dado (`hrGirih` tile palette), iwan, arch reveal, coffered ceiling and hurno, niche wall, takht props; `hrCastLight` from **one** bay with a fixed 8-fold glass. | ★ `effect=haft-rang&t=48&parts=sky,hall,carpet` @D · `…&falseColor=1` @D (plaster in shade 0.35–0.5, pools 0.8–2.5) · `…&quality=Minimal` @D · same @P. Checklist §5.7 items 6, 9, 10, 11. |
| **A3** | Orosi: both bays (+ the third at 21:9), frames, sashes, shamseh fanlights, all seven families, backlit glass, seedy pinpricks, gold rims, glass-image bakes, tile and inlay reflections, `hrMixPools` and pool gains, sun walk, veil. | ★ `effect=haft-rang&t=48&parts=sky,hall,carpet,orosi` @D · same @W · `…&set=1` / `set=2` / `set=5` @D (6-fold and 12-fold read; petals differ) · `…&sun=0` and `sun=0.5` @D (pools moved, penumbra changed) · `…&veil=1` @D (every pool soft) · `…&falseColor=1` @D (glass 2–6, nothing else above the knee except sun patches). Checklist items 1–9, 12, 13. |
| **A4** | The Sun Rug: `solveRug`, board atlas, hammered-glass penumbra floor, 35% lattice, ≤ 0.6× level, quiet margin, `solveBays` and the calm iwan field. | ★ `effect=haft-rang&t=48&board=1&stack=8` @D · same @L · same @P (Rug across the bottom band) · `effect=haft-rang&t=48&board=1&stack=16` @D (a tall stack lengthens a soft pool sideways, never toward the camera) · `effect=haft-rang&t=48&board=1&stack=8&falseColor=1` @D. Unit tests: Rug on free floor and slabs outside card/HUD + 0.03 at aspects 0.46, 1.6, 1.78 and 2.37 plus the 1280×720 layout (card y 0.06–0.94), over the whole sun walk. Checklist item 14. |
| **A5** | Air: analytic chord per window, glass-image taps, dust density (haze + `noise3`), breeze curtains, motes (slab-coloured, floored at 1.15 px). | ★ `effect=haft-rang&t=48&parts=sky,hall,carpet,orosi,air,motes` @D · `…&dust=1` @D (Wedgework read) · `effect=haft-rang&t=48&px=0.8&py=0.2` and `t=48.5`, `t=49` @D (no banding, crawl or slices) · `effect=haft-rang&t=48&quality=Low&forceWebGL=1` @P. |
| **A6** | Garden and life: near cypresses and plane trees, jub with chutes and jets, gauze curtain, leaf dapple, pigeon, sash sets via `level`, camera rig per aspect, idle state. | ★ `effect=haft-rang&t=48` @D (full rest) · `effect=haft-rang&t=48&level=2` … `level=7` @D · `effect=haft-rang&t=48&idle=1` @D · `effect=haft-rang&t=48&board=1&reduce=1` @D · `effect=haft-rang&t=48&board=1` @W, @L, @P. Motion floor (§3.3) checked on a 2 s sequence at `t=48…50`. Garden share ≥ 22% (D) and ≥ 30% (W) from the composition test. |

**Stage B: gameplay FX**

| Step | Work | Acceptance shots (all after `effect=haft-rang&t=48&board=1&`) |
|---|---|---|
| **B1** | Sun-catch and Dust: director clone (`boardCodes`, garbage-push inference), atlas writer, landing glint and 1.2× bloom, local saturating dust, curtain flinch. | ★ `stack=6&event=lock&piece=L&u=0.15&row=14&eventAge=0.1` @D (glint in the card's beam) · `stack=6&event=lock&piece=L&u=0.15&row=14&eventAge=0.6` @D (panes joined, no outline) · `stack=6&event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.3` @D (low puff in the card's beam only) · `locks=30&event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.3` @D (habitual drops plateau ≤ 1.6×) · ★ `stack=6&event=lock&piece=T&u=0.5&row=12&eventAge=0.6` @P. Director tests: garbage-push inference, codes after each flush. |
| **B2** | Clear: slide, pour (threads in the row's real colours), mix in the channel, collapse; cascades. | ★ `stack=8&event=clear&lines=1&row=19&eventAge=0.2` @D (panes sliding, stripe = clear sun, no flare) · `stack=8&event=clear&lines=3&row=18&eventAge=0.8` @D (thirty threads braiding) · `stack=8&event=clear&lines=3&row=18&eventAge=1.6` @D (whitening down the channel; image collapsed) · `stack=8&event=clear&lines=1&row=19&cascade=3&eventAge=1.2` @D · `stack=8&event=clear&lines=2&row=18&eventAge=0.8&falseColor=1` @D (nothing above clear-sun level). |
| **B3** | Irrigation: bands, guard lines, escalation 2–10+, the jub and chutes through the arch; release drain on the breaking lock; resume rule. | ★ `combo=3` @D (medallion brims) · `combo=5` @D (quarters filled, bands countable) · ★ `combo=8` @D (chutes lit through the arch) · `combo=11` @D (far gate lit, hall dust) · `event=release&peak=8&eventAge=1.5` @D (draining downstream, head dark first) · `combo=5` @P. Director tests: break on the breaking lock, resume within 0.6 s. |
| **B4** | Four lines: stripes to clear glass and pouring, sash rise, flood (≤ +0.25 stop measured), white air, tier-by-tier split into seven slabs, bands to the far gate. Measure the board's own gold flash in the real game and set the peak delay. | ★ `stack=8&event=quad&row=18&eventAge=0.3` @D (sashes rising) · ★ `stack=8&event=quad&row=18&eventAge=0.9` @D (flood) · ★ `stack=8&event=quad&row=18&eventAge=1.9` @D (seven slabs) · `stack=8&event=quad&row=18&eventAge=4` @D (bands down the jub) · `stack=8&event=quad&row=18&eventAge=1.9` @P · `stack=8&event=quad&row=18&eventAge=0.9&falseColor=1` @D. Log mean frame luminance across `eventAge=0…3` in 0.1 s steps: peak ≤ +0.25 stop over rest, ramp ≥ 0.4 s. |
| **B5** | T-spin click (glass-image end state, 0.35 s spring, 2–3 clicks 0.18 s apart); B2B mirror cascade and sheen; level sash-change wipe. | `event=tspin&lines=2&u=0.2&row=13&eventAge=0.2` @D (first click mid-spring) · `event=tspin&lines=2&u=0.2&row=13&eventAge=0.6` @D (two notches; pools rotated) · `b2b=2` @D (ceiling sheen) · `event=b2b&eventAge=0.5` @D (cascade through the inlays) · ★ `event=levelUp&eventLevel=3&eventAge=1.2` @D (front mid-wipe, no luminance edge) · `reduce=1&event=tspin&lines=1&eventAge=0.3` @D (cross-fade). |
| **B6** | Ganzfeld (amended); curtains drawn on game over and gathered on restart; idle rules; meditation (sun-catch at the pointer); multiplayer Rugs per card. | ★ `event=perfect&eventAge=0.8` @D (fog rising) · ★ `event=perfect&eventAge=3` @D (field: low chroma, near geometry ≥ 25%) · `event=perfect&eventAge=7` @D (re-glazed, Rug clean) · `event=gameOver&eventAge=2` @D (curtains drawn, no beams) · `curtains=1` @P · `reduce=1&event=perfect&eventAge=3` @D (one hue). |

**Stage C: post, tiers, phone, icon, docs**

| Step | Work | Acceptance |
|---|---|---|
| **C1** | Post: calm zones with `board=1`, knee bloom and iris, glass filmic, grade, FXAA/MSAA, false colour, the Ganzfeld helper. | ★ `effect=haft-rang&t=48&board=1&stack=8` @D (the §3.13 ring targets measured) · `effect=haft-rang&t=48&falseColor=1` @D. |
| **C2** | Quality tiers (§5.8); Minimal and Low captures; the WebGL2 leg on every starred event shot; shader-size test. | `effect=haft-rang&t=48&board=1&quality=Minimal` @D · ★ `effect=haft-rang&t=48&board=1&stack=8&quality=Low&forceWebGL=1&event=clear&lines=2&row=18&eventAge=0.8` @P. Measure Low at P and High at D with `profile=1&trackTimestamp=1` against the §3.10 targets. |
| **C3** | Portrait, 21:9 and short-laptop passes: Rug, bays, garden share, props, calm field. | ★ `effect=haft-rang&t=48&board=1&stack=8&event=quad&row=18&eventAge=1.9` @W, @L, @P. |
| **C4** | Icon; the theme end to end in the real game on both backends; switching away leaves no canvas; the phone validator at Low and Minimal; tests; docs (`docs/HAFT_RANG_VISUAL_OVERHAUL_<date>.md`, `docs/haft-rang-captures/`, a `docs/ARCHITECTURE_INDEX.md` row); **the heritage review of the icon and captures, recorded in the doc**. | Icon: `effect=haft-rang&t=48&level=1&icon=1&iconFov=30&iconYaw=38&iconPitch=14&combo=4` (square 512×512; tune yaw and pitch so the fanlight sits upper right and one mixing overlap of pools sits on the lower-third intersection). Real-game and phone runs as in PLAYBOOK.md. |

### 5.7 Art checklist for the hero (the orosi glass and its cast light)

Accept A0, A2, A3 and A4 only when every item holds, judged against reference photos side by side:

1. **Persian lattice.** Star-and-polygon girih with walnut cames of constant width (8–12% of the cell),
   regular and interlaced; never organic lead lines, figures or irregular Voronoi polygons; never one
   radial mandala centred on the screen (kaleidoscope).
2. **Pot-metal glass.** Each pane ±6% in value from its neighbours of the same colour; seedy pinpricks
   visible only in the near bay; gold hairline on the cames' sun side.
3. **Backlit blaze.** Glass seen directly at 2–6 linear; clear cells show backlit green plane leaves and sky
   with a slight seedy wobble (offset 0.01).
4. **Physical penumbra.** Pool lattice lines crisp within ~1 m of the glass and gone by ~6 m (washed to the
   glass-image mean); measure a penumbra width in pixels at two distances and check it scales with `t`.
5. **Sheared lozenges.** Pools are long sheared parallelograms along the light, printed with the lattice,
   oriented consistently with the sun azimuth.
6. **On wool, not decals.** Pool light multiplies the carpet colour and pile (knots visible in near pools),
   with wool sheen at grazing angles; on plaster it shows trowel texture; in niches each lip throws its own
   crisp shadow (High and up).
7. **Mixing.** Two overlapping pools add (§3.11 values); three never burn to flat white; the brightest
   overlap peak channel ≤ 2.5.
8. **Every glass is a colour.** Lapis and pomegranate pools read as colour, not shadow (pool gain).
9. **Value structure** in false colour: plaster in shade 0.35–0.5, pools 0.8–2.5, glass 2–6, sun patches
   3–4, arch sky 1.3–1.8.
10. **Restraint.** Plain plaster and plain carpet field (no lattice on them) cover ≥ 35% of the non-card
    wall and floor area at 16:9; ornament is concentrated in glass, pools and carpet borders.
11. **A house.** The §3.2 list holds: no muqarnas, no colonnade, no rows of rugs, tile never rose-dominant,
    takht props present; every arch in the picture opens onto the garden or holds glass (a blind pointed
    arch can read as a mihrab).
12. **Seven sets.** All seven read as different lattices and leads (`set=0…6`); consecutive sets alternate
    square and hex; mean cast luminance within ±10%.
13. **No moiré or crawl** under camera breath and pointer parallax at Minimal and Low.
14. **The Rug** meets §3.4: soft, ≤ 0.6× level, base in the quiet margin, far end never toward the camera,
    across the band on phones.

### 5.8 Quality tiers (amended)

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Pixel-ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |
| Girih | families simplified, no split petals | + petals | full families, seedy glass | + pot-metal jitter, bubbles | = | = |
| Glass image per bay | 64×96 | 64×96 | 96×144 | 128×192 | 128×192 | 128×192 |
| Air: chord + noise taps (samples in all) | 1 | 2 | 3 | 4 | 5 | 7 |
| Breeze dust curtains | on | on | on | on | on | on |
| Dust glints | 0 | 120 | 300 | 600 | 1000 | 1600 |
| Sun Rug / board windows | full | full | full | full | full | full |
| Channel flow | flat glow, no shimmer | 1-octave shimmer | 2 octaves | + specular glints | = | = |
| Niche wall | albedo + baked AO | SDF normal | parallax 4 | parallax 8 + shadow 4 | parallax 12 + shadow 6 | parallax 12 + shadow 8 |
| Ceiling (coffers, khatam, inlays) | inlay sheen only | + static glints | + sun glints | + facet jitter | = | = |
| Tile and inlay reflections (glass-image reads) | constant sheen | 1 | 1 + tilt | 2 | 3 | 4 |
| Carpet maps | 1024×512 | 1024×512 | 2048×1024 | 2048×1024 + pile fBm + sheen | = | = |
| Near cypresses (instanced) | 6 | 8 | 12 | 16 | 20 | 24 |
| Far garden (backdrop) | full | full | full | full | full | full |
| Jub jets | 0 (chute sparkle only) | 4 | 6 | 8 | 10 | 12 |
| Curtains (gauze and silk grid) | static planes | 8×16 | 16×32 | 24×48 | 32×64 | 32×64 |
| Third sun-wall bay | off | off | off | 21:9 only | 21:9 only | always |
| Bloom (resolution) | off (analytic glass-glow term near windows) | off | 0.33 | 0.45 | 0.5 | 0.5 |
| AA | none | none | FXAA | MSAA 4× | MSAA 4× | MSAA 4× |
| Pipelines (target) | ≤ 14 | ≤ 14 | ≤ 15 | ≤ 16 | ≤ 16 | ≤ 16 |

Every tier keeps the whole picture and every event (the Rug, irrigation, the seven-slab split, the click,
the Ganzfeld and the curtains included). Drop octaves, taps and terms in JavaScript, never by substituting
0.5 (gotcha #135). GPU cost targets are those of §3.10 until measured (ADR-0016).

### 5.9 TSL and WebGL2/WebGPU guards that matter for this concept

Gotcha numbers refer to the table in `.claude/skills/webgpu-threejs-tsl/SKILL.md` (numbered by line at
commit `5d3478d`; search the symptom text if the lines have moved). The `webgpu-threejs-tsl` skill
auto-loads on this work; the house rendering patterns and the quoted gotchas are collected in
`docs/theme-concepts/reference/rendering.md`.

| Guard | Where it bites in Haft Rang |
|---|---|
| **#89** nested `select` round `Fn` calls fails on the WebGL2 backend only (`addToStack`) | `hrGirih`'s cell and petal classification, the fold switch (6/8/12), the window-kind switch (bay vs board) and the tile-vs-glass palette choice. Fold to arithmetic (`mix`, `step`) or one `select(a.and(b), v, f)` with `v.toVar()` built inside the laid-out helper. A WebGPU-only check misses it: capture both backends at A3. |
| **#93 / #95** laid-out helpers must not capture textures or uniforms | `hrGirih`, `hrWindowHit`, `hrMixPools`, `hrHg`, `hrSchlick`, `hrGlassFilmic` stay pure; window rows, palette rows and texture reads live in the inline builders and are passed in as values. |
| **#81 / #101** inline `Fn`s re-emitted per call; JS-unrolled per-element TSL | One `Loop` over `u.winCount` windows, never a JS `forEach` over windows; the per-window maths in laid-out helpers so it is emitted once. Check the largest module with the shader-size test (< 48 KB per stage). |
| **#69** equal-edge `smoothstep` is a hard WGSL error | The came `smoothstep(hw − pen, hw + pen, abs(sdf))` and `insideSoft(uv, pen)` collapse to equal edges when `pen` reaches 0 at the glass plane: always `pen = max(pen, 1e-4)`; same for slab prism edges and the Rug's penumbra floor. |
| **#94** NaN from `pow` of a base a hair below zero, spread by the bloom chain | Henyey–Greenstein in glass (g 0.7), air (g 0.55) and motes: write `(1 + g² − 2g·cosθ)^1.5` as `x·sqrt(x)` with x clamped ≥ 1e-4; Schlick Fresnel on tile and wool sheen as products; clamp every cosine. |
| **#71** an unbounded `exp` turns a region black, often only on tall portrait screens | Aerial perspective `exp(−max(d, 0)·k)`, the Ganzfeld depth term `1 − exp(−max(dist, 0)·k)`, the `hrMixPools` shoulder, dust settle curves. Capture portrait at A1 and A5. |
| **#102** more than 12 uniform buffers per stage fail WebGPU validation | Exactly three `uniformArray`s (events, windows, palette); everything else plain uniforms or textures. |
| **#110 / #155** live rows compacted; named loops hand their index under that name | Loops `win`, `ld`, `cp`, `dp`, `ir`; read the index as `({ win })` etc. |
| **#87 / #88 / #98** interpolated codes carry last-bit noise; atlas mips pick garbage at cell boundaries | Board atlas codes read from a NearestFilter view at `.level(0)` and decoded with `floor(a·255 + 0.5)`; the LinearFilter view only for the penumbra blend; instance seeds as integers. Pin in a test that atlas row 0 is the board's bottom visible row. |
| `.level()` inside `If` and `Loop` | Every texture read inside the window loop, the event loops and the `If(inside)` branch (glass images, board atlas, carpet aux map, fBm, lattice). |
| **#68** a branch reads zeros from shared nodes | Root-pin (`.toVar()`) `toSun`, `N`, the carpet aux sample and the dust density before any `If`. |
| **#90 / #117** premultiplied additive; a part captured alone is black | The air pass and motes write `vec4(rgb, 0)` with CustomBlending One/OneMinusSrcAlpha; capture `air`/`motes` together with an opaque part (`parts=sky,hall,carpet,orosi,air`). |
| **#100 / #139** backdrop last among opaques; group order | Sky triangle after the hall, garden and orosi with depth test on and depth write off; renderOrder set per mesh, Group order left at 0. |
| **#105** MSAA extrapolates varyings on thin strips | Thin cames and the curtain hems: clamp interpolated lattice coordinates; analytic AA from `u.pixelAngle`. |
| **#147 / #120** sub-pixel particles become blobs on phones; additive light budget | Motes floored at 1.15 buffer px, dimmed below; total mote light capped per tier; jets' sparkle budgeted. |
| **#104 / #116** baked fBm at mip 0 with large gain is serrated; narrow `smoothstep` on noise is confetti | Dust density and breeze curtains use wide ramps and `.level(2.0)` for large-gain reads. |
| **#122** polynomial S-curves outside 0..1 | Clamp before any contrast curve in the glass filmic and grade. |
| **#134 / #149 / #112** bloom knee follows the iris; judge colour in false colour; ACES exposure trap | The knee follows the exposure; read `falseColor=1` before judging any pool colour; judge only through the tone-mapped pipeline. |
| **#144** effects behind the card are never seen | The Rug solver and bay solver keep every landing outside card and HUD rects. |
| **#96** pipeline count | Target ≤ 16 pipelines (§5.8): sky, floor, wall shell, ceiling, props, orosi glass, frames, curtains, garden ground, cypresses, plane trees, jub, air, motes; every pool always drawn with dormant zero-size slots so the first frame compiles them all. |
| **#136** and the container's 3D-texture failure | `noise3` via the 2D-lattice trick; never `Data3DTexture` or `lut3D`. |
| **#157** pool overlap cap | **Deliberately not used** (§3.11); `hrMixPools` instead. Record why in a code comment so a later reviewer does not "fix" it. |
| Gate on renderer kind, not backend (ADR-0019) | The world and post build identically for the WebGPU and WebGL2 backends. |

### 5.10 Tests (clone Rainbark's, then add)

| Test file | What it covers |
|---|---|
| `tests/unit/haft-rang-core.test.js` | Palette gate 0/7 with the script's hue maths; same-shape ΔE76 to Rainbark ≥ 60 for every shape; the four CVD pairs by glass name (≥ 22); `SASH_SETS`: lattice families only 6/8/12, square/hex alternate, every star ≥ 2 petal colours, mean cast luminance within ±10%; `sunWalk` bounds and period; irrigation integrator (reach per link, drain order, drain time 2–3 s by peak, resume within 0.6 s); `packCodes` round-trip; `girihCpu` fixtures; `mixPools` (hue preserved, peak ≤ 2.5, the §3.11 example mixes); pool gains. |
| `tests/unit/haft-rang-bake.test.js` | Carpet maps deterministic; geodesic `d` monotonic along the channel network; glass image equals `girihCpu` at sample points; mips present; PNG pair under 400 KB each. |
| `tests/unit/haft-rang-director.test.js` | Shadow-well `boardCodes` after locks and clears; garbage-push inference; combo break on the breaking lock; resume rule; B2B level and break inference; multiplayer COMBO stash; `rowCodes`; empty-row fallback; settings resets. |
| `tests/unit/haft-rang-composition.test.js` | Rug on free floor, far end never toward the camera, never under card or HUD, at aspects 0.46, 1.6, 1.78 and 2.37 plus the 1280×720 layout (card y 0.06–0.94); slab prisms ≥ 0.03 outside card and HUD rects over the whole sun walk; no pool on the iwan's card region; garden share ≥ 22% (16:9) and ≥ 30% (21:9). |
| `tests/unit/haft-rang-world.test.js` | `WORLD_METHODS`; dormant pools; `seek` determinism; reduced motion; atlas row orientation. |
| `tests/unit/haft-rang-theme.test.js` | Node graphs built for all six tiers with `forceWebGL: true` and no GPU; banned-API greps (no `ShaderMaterial`, `WebGLRenderer`, `mx_*`, `from 'three'`, absolute asset paths); flag literals; registry triple (`heavy-gpu`, `heavy`, not startup-eligible); icon exists. |
| `tests/unit/haft-rang-playground.test.js` | The effect's parameters equal the catalogue entries. |
| `tests/unit/haft-rang-shaders.test.js` | Each part built with `WGSLNodeBuilder` and `GLSLNodeBuilder` at High and Minimal: no warnings, each stage < 48 KB, no equal-edge `smoothstep`, no `mx_`, laid-out helpers emitted once (copy the inline helper from `tests/unit/himalayan-peak-shaders.test.js`). |
| `tests/unit/haft-rang-rename-migration.test.js` | For `OLD_ID` (clone the Rainbark rename test). |

### 5.11 Verification commands

Minimal (every commit):
```
npm run typecheck
npx vitest run tests/unit/haft-rang- tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/theme-music-catalog.test.js tests/unit/odyssey-unique-themes.test.js \
  tests/unit/url-parameter-catalog.test.js tests/unit/dual-state-theme-tripwire.test.js \
  tests/unit/mobile-webgl2-validation.test.js tests/unit/theme-container-registry.test.js
npm run audit:theme-lifecycle && npm run check:palette && npm run check:boundaries
node scripts/architecture-fitness-check.mjs
npx eslint src/themes/haft-rang --ext .js
```
(`git add` new files before trusting the dual-state tripwire: it scans tracked files only. Adding any net
line to `src/main.js` or `src/core/game-modes/OdysseyMode.js` fails the architecture-fitness ceilings.)

Full (before a merge): `npm test`, `npm run lint:ci`, `node scripts/ts-ratchet-check.mjs`,
`npm run perf:budgets:gate`, `npm run check:release-gates`, `npm run build`, `npm run check:ip-strings`,
`npm run check:pages-artifact`, plus the visual proof: playground shots on both backends, the real game on
both backends, and `npm run validate:mobile:webgl2 -- --theme haft-rang` at Low and then
`--quality Minimal` (PLAYBOOK.md has the port workaround needed when a dev server already holds 5173).

### 5.12 Prototype the hero on the CPU first (the Rainbark lesson)

Rainbark's spec described its bark atlas as an anisotropic Voronoi mosaic. Prototyped on the CPU before any
shader, that recipe **read as stained glass** and was rejected; thresholded fBm contours read as
topographic rainbow outlines and were rejected; pointed lozenge splats read as candy leaves or feathers and
were rejected; a fourth model ("ribbon splats" over a cool slate matrix) passed. The details are in
`docs/theme-concepts/rainbark.md`. The lesson is general: a material described in words can read as
something else entirely once it is pixels, and finding out in numpy costs minutes where finding out in TSL
costs sessions.

For Haft Rang the risk is inverted: the hero **is** stained glass, so it must read as the right kind. The
failure modes to look for are a church window (organic lead lines, figures), a Voronoi mosaic (irregular
polygons of flat colour: exactly what Rainbark's rejected atlas looked like), a kaleidoscope (one radial
mandala), a disco (overlapping round spots of saturated colour), and a mosque interior (§3.2). So, before
A2 and A3:
- **Girih families.** In numpy, implement `girihCpu(p, fold, turn)` for the seven §3.10 families. Render
  each as backlit glass (960×540, cames 8–12% of the cell, ±6% pot-metal jitter) and as a cast pool on a
  madder field at t = 1, 4 and 9 m using `pen = t·0.00925` and the came `smoothstep`. This code becomes the
  CPU mirror in `haft-rang-core.js` and the fixture source for the shader test.
- **The carpet.** Prototype `bakeCarpet` (borders, guards, madder field, indigo channels with woven wave
  lines, motifs, *abrash*) and check it reads as a chahar-bagh garden carpet at the camera's distance and
  grazing angle, not as a map or a maze.
- **Massing.** A ray–plane render of the hall at the §1.2 camera (flat-shaded planes, the arch with a sky
  gradient, two bays, analytic pools with `castLight` maths, the Rug at stack 4/10/16). Judge composition,
  the value structure (§5.7 item 9) and the "house, not mosque" reading. This is the image to show the user
  for the heritage review.
- **Mixing.** Render two and three overlapping pools with `mixPools` and check the §3.11 colours.
- Put every render side by side with two or three reference photos (§6) in the session scratchpad only.
  Iterate until the §5.7 checklist passes. Record the passing parameters in `haft-rang-core.js` comments
  and in the theme's record doc. **Never commit the reference photos.**

---

## 6. Reference imagery to look for

Keep reference images in the session's scratchpad and use them with the playground's `ref=` overlay
locally (`ref=/playground-refs/x.png&refMode=split`, from a local, uncommitted file). **Do not commit
copyrighted images.** Commit an image only if it is verifiably public domain or the user's own, and record
its source next to it.

**Orosi windows and their light (garden houses and palaces):**
- "Dowlat Abad Garden Yazd orosi" and "Dowlatabad windcatcher pavilion interior" (the pavilion, its stained
  lattice sashes, the windcatcher)
- "Borujerdi House Kashan orosi", "Tabatabaei House Kashan stained glass" (sash proportions, walnut frames)
- "Narenjestan-e Qavam Shiraz" (garden house, mirror work in a palace setting)
- "orosi window Iran", "khatam-kari", "girih pattern 8-fold", "girih 12-fold shamseh" (lattice families)
- "Qajar stained glass sash window museum" (pane colours, seedy glass, came profiles)
- "stained glass light pools on floor", "coloured light through lattice on carpet" (pool shape, penumbra
  with distance; the Nasir al-Mulk morning photographs are the best-known example and may be used **only**
  as a private light-behaviour reference)
- "dust in sunbeams through stained glass" (slab density, forward scattering)

**Ceilings, niches and tile (palace usage):**
- "Chehel Sotoun talar ceiling", "Persian coffered wooden ceiling khatam" (the §3.2 ceiling)
- "Golestan Palace Hall of Mirrors", "aineh-kari palace" (mirror as inlay; avoid shrine interiors)
- "Ali Qapu music room niches" (the vessel-shaped *chini-khaneh*)
- "Qajar haft-rangi tile dado turquoise" (dado colours; avoid rose-dominant tile)

**The garden:**
- "Bagh-e Fin Kashan fountains channel" (the jub with fountain jets)
- "Eram Garden Shiraz cypress avenue", "Persian garden chadar chute", "Dowlatabad garden pool cypress"
- "Mediterranean cypress avenue morning light", "plane tree backlit leaves" (through the clear panes)
- "Yazd windcatcher skyline", "Yazd mud-brick vaults rooftops" (the skyline beyond the wall)

**The carpet:**
- "Wagner Garden Carpet" (Burrell Collection, Glasgow), "Jaipur garden carpet" (HALI article above), the
  Metropolitan Museum garden carpet (collection item 447583)
- "madder red carpet field indigo border", "abrash carpet" (dye-lot banding)
- "Persian carpet pile close up raking light" (wool sheen, knots)

**James Turrell:**
- "James Turrell Wedgework" (light read as a solid wall)
- "James Turrell Ganzfeld", "Aten Reign Guggenheim 2013" (the complete field; the §3.8 field should stay
  calmer and paler than these)
- "James Turrell Skyspace" (the knife-edged roof opening, the *hurno*)

**Avoid as references** (they pull toward the wrong reading): mosque prayer halls, shrine mirror interiors,
church rose windows, disco and stage lighting, kaleidoscope images.
