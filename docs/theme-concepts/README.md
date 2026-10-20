# Theme concepts: the 2026-10-11 design competition

This folder holds every theme concept from the design competition held on **2026-10-11** to replace
the theme **Cosmic Chimes** (`cosmic-chimes`, a legacy DOM/CSS theme in the `cosmic` group). Six
concepts were developed in full and scored by three judges. The winner, **Rainbark**, took Cosmic
Chimes' slot in commit `585ab55` and is built (see
[`../RAINBARK_VISUAL_OVERHAUL_2026-10.md`](../RAINBARK_VISUAL_OVERHAUL_2026-10.md)). The other five are
written down here so that any of them can be built later.

Everything here is written for an engineer or agent in a **new Claude Code session on a fresh
clone**, with no access to the session that produced it. The working notes of that session are gone.
These files are the record: the six concept files, the shared procedure ([`PLAYBOOK.md`](PLAYBOOK.md)),
and snapshots of the analysis behind them ([`reference/`](reference/)).

**Words.** The repository has an IP policy (enforced in shipped files by `scripts/ip-string-gate.mjs`,
`npm run check:ip-strings`; it applies everywhere): never write the trademarked name of the original falling-block game, or its official spelling of the
piece name, in code, strings, comments, docs or commit messages. Say "falling-block", "pieces", "four
lines" or "quad". The existing identifiers `getTetrominoConfig` and `<id>-tetrominos.js` are fine.

---

## Start here: building a concept in a new session

1. Pick a concept from the table below and open its file.
2. Decide which existing theme it replaces. Every concept was written as if it would take Cosmic
   Chimes' slot, and that slot is now Rainbark's, so a new slot is needed. **PLAYBOOK §1 "Choosing a
   slot"** explains how to choose (replacing a theme is strongly recommended over adding a 62nd one)
   and gives a script that lists the candidates. Each concept file also lists the slots that fit it
   best (see the build map below: its Stage 0 section). It is a product decision: if you do not
   know, write "ask me" and the session will ask.
3. Start a new Claude Code session on this repository and paste:

```text
Build the <Name> theme described in docs/theme-concepts/<id>.md, replacing the theme <x>. Read docs/theme-concepts/PLAYBOOK.md first and follow it.
```

| Field | Meaning | Example |
|---|---|---|
| `<Name>` | The concept's display name from the table below | `Painted Ages` |
| `<id>` | The concept file's name, which is also the proposed theme id | `painted-ages` |
| `<x>` | The id of the existing theme it replaces (PLAYBOOK §1), or "ask me" | `moonrise-summit` |

For example: *Build the Painted Ages theme described in docs/theme-concepts/painted-ages.md, replacing
the theme moonrise-summit. Read docs/theme-concepts/PLAYBOOK.md first and follow it.*

PLAYBOOK §8 has a longer, ready-to-paste prompt with the working rules spelled out (branching,
playground-first, both-backend screenshots, critic loops, gates). Either works.

**To work on Rainbark** rather than start a new concept: it is built (environment, ambient life, the light
wheel and every gameplay beat); its record is [`../RAINBARK_VISUAL_OVERHAUL_2026-10.md`](../RAINBARK_VISUAL_OVERHAUL_2026-10.md).
For the first pass's architecture, start from [`../RAINBARK_HANDOVER_2026-10.md`](../RAINBARK_HANDOVER_2026-10.md):
its §4 lists where the code departs from [`rainbark.md`](rainbark.md) (its §5 work list is done: the
overhaul record lists what the last critic left as polish). Its slot is decided.

**The worked example of a slot change** is Cosmic Chimes → Rainbark (`585ab55`): the registry entry
replaced in place, `cosmic-chimes` aliased to `rainbark` in `RETIRED_THEME_IDS`, the authored song
retitled (audio unchanged), Odyssey orb 47 renamed "The Painted Giants", the old DOM container and
CSS deleted. PLAYBOOK §4 is that change generalised into a checklist;
[`reference/rename.md`](reference/rename.md) is the original Cosmic Chimes version.

---

## What is in this folder

| File | What it is |
|---|---|
| [`README.md`](README.md) | This index: the competition, the concepts, the judges' findings, the fleet clichés, every researched candidate |
| [`PLAYBOOK.md`](PLAYBOOK.md) | The shared build procedure for any concept: choosing a slot, the module split and lifecycle contract, the staged build order, the rename and retire checklist, visual verification in a cloud container (headless Chromium + SwiftShader capture scripts printed in full), gates and commands, house rules, gotchas, and the starter prompt |
| [`rainbark.md`](rainbark.md) | **Rainbark**, the winner: the definitive spec, the bark art-direction lesson, the judges' notes |
| [`iris-springs.md`](iris-springs.md) | **Iris Springs**: proposal, judges' notes, required changes, build plan. Built 2026-10-12 as a new theme (the 63rd), **Thermal Bloom** (`thermal-bloom`, the Chapter 1 bonus); record: [`../THERMAL_BLOOM_VISUAL_OVERHAUL_2026-10.md`](../THERMAL_BLOOM_VISUAL_OVERHAUL_2026-10.md); handover: [`../THERMAL_BLOOM_HANDOVER_2026-10.md`](../THERMAL_BLOOM_HANDOVER_2026-10.md) |
| [`painted-ages.md`](painted-ages.md) | **Painted Ages**: same structure |
| [`riverbloom.md`](riverbloom.md) | **Riverbloom**: same structure |
| [`haft-rang.md`](haft-rang.md) | **Haft Rang**: same structure |
| [`sunfall.md`](sunfall.md) | **Sunfall**: same structure |
| [`reference/`](reference/) | Snapshots of the analysis taken at `5d3478d` (see [Reference snapshots](#reference-snapshots)) |

Each concept file has a "How to use this file" box and a precedence rule. The five unbuilt concepts
share one layout: §0 glossary or origin, §1 the concept in full as proposed, §2 what the judges said,
§3 required changes before building (these override §1), §4 overlap with Rainbark (what not to
duplicate), §5 implementation plan (already folds in §3), §6 reference imagery to look for.
rainbark.md is laid out differently: §0–§9 are the definitive spec, §10 the bark lesson (which
overrides §4.3's atlas recipe and the old end of §3.1's age ramp), §11 the judges, §12 what changed
from the original proposal, §13 the proposal's background (name, originality, sources). Notes
marked **A2 build** and "Build status at the time of writing" (under §7.1) record where the build in
progress already departs from the spec; the code wins.

### Build map: where each concept file keeps what you need

The section numbers for each build step, so a new session can go straight to them. Section 3 of
each unbuilt concept overrides section 1; section 5 already folds section 3 in.

| Step | Rainbark | Iris Springs | Painted Ages | Riverbloom | Haft Rang | Sunfall |
|---|---|---|---|---|---|---|
| Stage 0: slot facts and candidates, name, user questions | done (`585ab55`; §1 records the slot) | §5.1, name §3.14 | slot §4.3, identity §5.1 | §5.1, name §3.13, code names §3.14 | §5.1 (name §3.14 **and** the Persian-heritage review §3.2) | §5.1, name and slot §3.18 |
| Piece colours (authoritative) | §3.5 | §3.13 | §3.6 | §3.12 | §3.12 | §3.17 |
| Event language (what to build) | §6 | §1.5 as amended by §3.5 and §3.7–§3.12 | §3.4 (replaces §1.5) | §3.17 (replaces §1.5) | §1.5 as amended by §3.2 and §3.4–§3.10 | §1.5 as amended by §3.4–§3.14 |
| Module list, director contract, event table | §7.1, §7.2, §4.11 | §5.2, §5.3, §5.4 | §5.2, §5.3, §5.4 | §5.2, §5.3, §5.4 | §5.2, §5.3, §5.4 | §5.2, §5.3, §5.4 |
| Playground parameters | §7.1 | §5.5 | §5.5 | §5.5 | §5.5 | §5.5 |
| Staged build order | §7.3 | §5.6 | §5.8 | §5.6 | §5.6 | §5.6 |
| Acceptance shots | §8 (with the required sweep and the icon frame) | in §5.6 | §5.9 | in §5.6 | in §5.6 | in §5.6 |
| Quality tiers | §4.13 | §5.8 | §5.10 | §5.8 | §5.8 | §5.8 |
| WebGPU / WebGL2 guards | §4.14 | §5.9 | §5.11 | §5.9 | §5.9 | §5.9 |
| Tests and verification commands | §7.1 (tests), §8 (sweep) | §5.10, §5.11 | §5.12 | §5.10, §5.11 | §5.10, §5.11 | §5.10, §5.11 |
| Hero prototype on the CPU first | §10 (done: ribbon splats; §10.8 re-runs it) | §5.12 | §5.6 (Stage A0) | §5.12 | §5.12 | §5.12 |
| Compare against (fleet neighbours) | forest, fall, moonlit-forest (Spring took its slot 2026-10-18), golden-forest, stillwater, chiral-gold, ice-temple, nimbus-veil, rainbow-terraces (§13.3, §11.1) | halcyon-apex, geode, cinder-drift, pyrestorm, luminous-tides, parhelion, rainbark | shifting-sands, himalayan-peak, solar-eclipse, mountain, parhelion, rainbark | koi-pond, ocean, halcyon-apex, waves, verdant-hills, rainbark | chromadelic-highway, ice-temple, crystal-cave, neon-dusk, synthwave-sunset, aether-tides, chromatic-impasto, moonlit-greenhouse, sakura-twilight, halcyon-apex, rainbark, kaleidosonic (owns a kaleidoscope as its chain and its T-spin turn since 2026-10-13: rework the four-line projection and the T-spin twist) | crystal-cave, cinder-drift, bioluminescence, forest, fall, golden-forest, ocean, verdant-hills, rainbark |
| Best-fit slots the file suggests (ask the user) | — | pyrestorm or luminous-tides (subject overlap); misty-lake (Grainfields took it 2026-10-18) or moonlit-greenhouse (chapter fit) | **mountain** (best fit; High Coast took it 2026-10-13); moonrise-summit, sakura-twilight, pyrestorm | none named: run the PLAYBOOK §1a script | **moonlit-greenhouse** (best fit); misty-lake (Grainfields took it 2026-10-18), rainy-window (Sunbraid took it 2026-10-20), singing-bowl (Kaleidosonic took it 2026-10-13) | an un-rebuilt theme in an Earth chapter, for example mountain (High Coast took it 2026-10-13); its close neighbours are all rebuilt |

The stage names (0a core and palette, 0b scaffold and rename, A environment, B effects, C post,
tiers, phone, icon and docs, then the final adversarial review) are PLAYBOOK §3's.

---

## The six concepts

Scores are 0–10 per judge; the total is out of 30. Lens ranks are in brackets.

| Rank | Concept | Id | The picture in one line | Inspiration | Art | Tech | Play | Total | Status |
|---|---|---|---|---|---|---|---|---|---|
| **1** | [**Rainbark**](rainbark.md) | `rainbark` | A cathedral of colossal rainbow-barked giants rising out of a floor of luminous mist in blue air; every piece you set peels the grove, every line you clear makes it shed, every chain opens the canopy one pool of sunlight at a time. | The rainbow eucalyptus (*Eucalyptus deglupta*) of Mindanao and New Guinea, scaled ×2.3; Blue Mountains eucalyptus haze | 8.0 (2nd) | **8.5** (1st) | 8.4 (2nd) | **24.9** | **Winner.** Took Cosmic Chimes' slot (`585ab55`); environment built and merged, gameplay effects still to build ([handover](../RAINBARK_HANDOVER_2026-10.md)) |
| 2 | [**Iris Springs**](iris-springs.md) | `iris-springs` | A bright, steaming basin of living colour seen from an overlook at late morning; the board's heat paints the springs, terraces fill and turn to stone, and combos wind a geyser up until it erupts. | Grand Prismatic Spring (rings, underlit steam), Mammoth Hot Springs (terraces), Castle Geyser and Old Faithful (eruption cycle), Champagne Pool and Spotted Lake (accent pools) | 7.5 (3rd) | 6.5 (3rd) | **8.6** (1st) | 22.6 | Concept, not built |
| 3 | [**Painted Ages**](painted-ages.md) | `painted-ages` | A sea of rainbow-striped badlands in raking morning light; every line you clear is laid down as a new layer of rock, your game runs back into the distance as deep time, and rain brings out its true colours. | Zhangye Danxia (Gansu, China), Serranía de Hornocal (Jujuy, Argentina), Landmannalaugar (Iceland) | 7.0 (4th) | 8.0 (2nd) | 7.5 (4th) | 22.5 | Added as a Chapter 4 completion reward; [build record](../PAINTED_AGES_VISUAL_OVERHAUL_2026-10.md) |
| 4 | [**Riverbloom**](riverbloom.md) | `riverbloom` | The river of five colours at the peak of its bloom: crimson riverweed streams under glass-clear rapids in high tropical sun, and every move boils, spills, ripens, drills or flowers the river. | Caño Cristales, Serranía de la Macarena (Meta, Colombia), and its riverweed *Macarenia clavigera* | 6.0 (6th) | 6.0 (4th) | 8.0 (3rd) | 20.0 | Concept, not built |
| 5 | [**Haft Rang**](haft-rang.md) | `haft-rang` | A garden pavilion on a desert morning where the sun pours through seven colours of glass; the board is one of its windows, so every piece throws its colour across the carpet and a chain floods the woven garden with light. | Secular Qajar and Zand garden houses (orosi sash windows, vessel niches), Persian garden carpets, James Turrell's light-as-material; Nasir al-Mulk's morning light only as a reference for how coloured light behaves | **8.5** (1st) | 4.5 (6th) | 6.9 (6th) | 19.9 | Concept, not built |
| 6 | [**Sunfall**](sunfall.md) | `sunfall` | Sunlight pours into the world's largest cave like a waterfall; a lost jungle grows in that light, the cave breathes out its own clouds, and every move becomes weather, rain and new leaves. | Hang Sơn Đoòng (Vietnam) and its two skylight dolines | 6.5 (5th) | 5.5 (5th) | 7.2 (5th) | 19.2 | Concept, not built |

Each concept began from a seed. Five seeds were the research round's top five
([`reference/research.md`](reference/research.md)): Prismatic Springs (#1) → Iris Springs, Painted
Strata (#4) → Painted Ages, Liquid Rainbow (#9) → Riverbloom, Haft Rang (#20) → Haft Rang, Doline
(#19) → Sunfall. The sixth was a **wildcard** (any subject); its proposer chose the rainbow eucalyptus
over about 40 other wildcards, the same subject as research candidate #13 Rainbow Bark, and it became
Rainbark.

### In one paragraph each: why it scored what it did

- **Rainbark.** The strongest landscape and the best look-per-millisecond: the full spectrum lives in a
  cheap fragment material (bark) on one instanced draw, the air is closed-form, every event is a row
  read by an existing shader, and the board sits on the calmest field of any concept. The freshest
  event grammar (peel, shed, moult) and the most memorable four-line clear (the Great Moult). Risks
  the judges named: the flanking-trees composition, "another forest", bark reading as camouflage or
  tie-dye, the cloud tide brushing the sea-of-clouds trope, a combo you cannot count, motion beside the
  card, and "wound/bleed" language for the kino. The spec (rainbark.md §0.3) fixes each one.
- **Iris Springs.** The best palette (cobalt, turquoise, sinter cream, lemon, orange, rust: the open
  high-key daylight slot without golden hour) and the best combo arc (one preplay splash per link, an
  eruption, a steam-phase release). Held back by flat front light (the sun is behind the camera), half
  its beauty riding on camera-facing steam sheets and billboard geysers that look cheap when
  under-delivered, a Chalice geyser doing too many jobs, and a rainbow as a key payoff.
- **Painted Ages.** The best metaphor (the real colours of each cleared row become rock, and the record
  steps back as deep time) and the strongest form-giving landscape light, fully opaque and cheap to
  render. Held back by sitting in golden hour next to shifting-sands, rock that is still between
  events, and lock and clear beats (its two most frequent) that are its least visceral. Its terrain
  shape is the single point of failure.
- **Riverbloom.** The most alive ambient motion and the best individual beats (kettle-drilling T-spin,
  standing-wave B2B, the riverweed flowering on a perfect clear, drought and first rain). Held back by
  caustics already owned by koi-pond and ocean, a clear that reskins the house twin jets, 26k
  alpha-tested fronds that degrade hard on phones, water that is hard to make read as water in a
  still, and the weakest name.
- **Haft Rang.** The art director's winner: the only concept that looks like nothing else, with light
  as the subject and the Sun Rug (the board cast as light on the carpet). The rendering lead's last
  place: a procedural Persian interior, a full-screen girih slab march, `castLight` inlined into about
  seven materials, and the busiest backdrop behind the card. It is an interior (the brief asked for
  landscapes), it moves slowly, and its look evokes the Nasir al-Mulk mosque, so it needs a
  Persian-heritage review.
- **Sunfall.** The biggest single wow image (a solid white-gold column of daylight in a green stone
  chamber) and the best name in the slate. Held back because a cave with a light shaft is on three
  avoid lists (crystal-cave, cinder-drift, bioluminescence), its beauty is volumetric (a marched light
  column, mist sheets) and its procedural cave risks the "noise blob" look, a rainbow on every clear
  wears thin, and bird bursts on every hard drop tire.

---

## How the competition was run

| Step | What happened | Where it lives now |
|---|---|---|
| 1. Understand | Read-only surveys of the codebase at `5d3478d`: the theme adapter and lifecycle (porting from Serenity Warp), the rendering house style and TSL gotchas, the gameplay events and their payloads, the CI gates and tests, and the rename surface for retiring Cosmic Chimes. Plus a visual catalog of all 60 other themes, each with a list of motifs to avoid. | [`reference/`](reference/) (adapter, rendering, events, ci, rename, catalog) |
| 2. Research | 49 web searches across geothermal and mineral sites, karst and water, living colour, caves, sky optics, and art and materials. **33 candidates**, a table of high-risk rejects, and a ranked top five. | [`reference/research.md`](reference/research.md); summarised [below](#all-33-researched-candidates) |
| 3. Concepts | Six full proposals, one per seed (the top five plus a wildcard). Each gives a name, id and logline; a painter's description for desktop, ultrawide and upright-phone layouts; a palette with the piece colours checked against the palette gate; environmental animation; a gameplay event language for every event; a rendering spec in three r186 TSL with quality tiers; a module plan; risks; and a comparison against the catalog and the other concepts. | Section 1 of each concept file |
| 4. Judging | Three independent judges scored all six, each through one lens (below). | Section 2 (or §11 in rainbark.md) of each concept file; cross-cutting findings [below](#what-the-judges-found-across-all-six) |
| 5. Synthesis | Scores summed. The art judge ranked Haft Rang first (8.5 against Rainbark's 8.0), but that was not enough to overrule: Haft Rang is an interior while the brief asked for extraordinary landscapes, it carries a real cultural-reading risk, and the rendering lead scored it lowest (4.5). No judge said another concept was clearly more beautiful **and** original **and** feasible. **Rainbark was built.** Its definitive spec grafts the best ideas of the runners-up and fixes every weakness a judge named. The five other concept files each gained a "required changes" section with the same treatment. | rainbark.md §0 (grafts and fixes); §3 of each other concept file |
| 6. Art-direction lab | Before the first shader, the bark was prototyped on the CPU (numpy and PIL) and compared side by side with reference photos. The spec's anisotropic Voronoi atlas looked like **stained glass**; "ribbon splats over a cool slate matrix" was chosen, and the old end of the bark ramp moved from maroon to slate. This lesson applies to every concept: prototype the hero material on the CPU first. | rainbark.md §10; PLAYBOOK §7.3 |
| 7. Build | Stage 0 done: the core and palette (`0c747dd`), the frame and the rename (`585ab55`). The environment (Stage A) and the gameplay effects (Stage B) are in progress. | rainbark.md §7.3; PLAYBOOK §3 |

**The three lenses.**

| Judge | Lens | Rewards | Penalises |
|---|---|---|---|
| Art director | Beauty; originality against the 61-theme catalog (setting, palette, composition, motifs, FX grammar); wow; depth, atmosphere and lighting; how it reads as a still and in motion; surprise; the name | Originality; strict about resemblance to anything in the fleet | Rainbows as signature, golden hour, the house "hold the colour" grammar |
| Rendering lead | Can it be built in three r186 TSL so it looks right on WebGPU **and** the WebGL2 backend; cost on phones and iGPUs; procedural without models; how cheap it looks if it falls short; compile and pipeline cost; board readability | **Look per millisecond** | Beauty that depends on volumetrics, refraction passes or extra render targets |
| Gameplay-feel designer | How spectacular, colourful, satisfying and world-native each event is; readability at 1–3 locks per second; combo escalation and release; novelty against the house FX grammar; clean mapping to board positions; photosensitivity; how it feels after 20 minutes | Frequency-weighted: a 20-minute session has roughly **600–900 locks, 150–250 clears, 10–40 four-line clears**, a few T-spins and almost no perfect clears. Lock and clear set the feel; four lines and perfect clears are what players remember | Beats that tire at high frequency, motion beside the card, negative feedback when the player struggles |

---

## What the judges found across all six

These findings bear on any concept, including ones not yet written.

### Art director

1. **The rainbow had become the slate's own cliché.** Three concepts made a physically placed bow a
   headline payoff (Iris Springs on the quad and B2B, Painted Ages on the chain release, Sunfall on
   every clear and the quad), and the fleet already has rainbow motifs in tornado,
   chromadelic-highway (and singing-bowl, until Kaleidosonic replaced it). **Use a bow at most once, as a grace note, never as the
   signature.**
2. **Almost every lock was still a softened "the world holds the colour".** Something in the piece's
   colour appears beside the card at the piece's height, then fades over 18–90 s (Iris blooms,
   Painted Ages fans, Riverbloom blushes, Sunfall leaves, Rainbark bands). Only Haft Rang broke it: its
   Sun Rug is a live image of the board, so a colour lasts exactly as long as its piece is on the
   board.
3. **Composition template.** Every concept put a hero on the left and a secondary on the right, the
   template the catalog asks to break. If you keep the split, make it carry meaning (Haft Rang: the
   right field is the light source, the left is where it lands).
4. **Lighting slot.** Golden hour is the fleet's most overused light (halcyon-apex, himalayan-peak,
   sunset, summer, fall, tornado, golden-forest, waves, shifting-sands, nimbus-veil, rainbow-terraces).
   **High sun or morning daylight is the open slot.**
5. **Whatever wins:** use the rainbow no more than once; keep the decay world-native (bleach, green,
   ripen), never "held then released"; source a clear's colours from the real cells of the cleared row
   (Painted Ages' "shadow well").

Verdict: Haft Rang won this lens, on condition of a Persian-heritage review and more motion. Rainbark
was the strongest landscape and the safe second (break the flanking-tree symmetry, drop the
"wound/bleed" kino). Iris Springs had the best palette held back by flat front light; Painted Ages the
best landscape light and name in golden hour next to shifting-sands; Sunfall's name and its exhale and
shaft-count beats were worth grafting; Riverbloom donated its kettle and flowering beats.

### Rendering lead

**Verdict:** build Rainbark, with Painted Ages as the strong runner-up. Rainbark buys the most beauty
per millisecond: the full spectrum in a cheap fragment material on one instanced draw, closed-form
atmosphere, every event a row read by an existing shader, the calmest field behind the board, and a
vertical world that fits upright phones. Painted Ages is equally cheap and fully opaque but rests on
procedural badlands terrain, a harder art problem. Iris Springs and Riverbloom lean on techniques that
look cheap when under-delivered (sheet steam and billboard geysers; dense alpha-tested fronds).
Sunfall's and Haft Rang's beauty is volumetric and architectural.

Repo precedents the rendering lead checked (useful for any concept):
- Verdant Hills ships 18k near + 40k far grass clumps at High, so dense instanced foliage is in a range
  the house has shipped.
- Ocean paints a tileable RGBA8 light-pattern `RenderTarget` with `generateMipmaps`, verified on both
  backends: precedent for a caustic or pattern target.
- Shifting Sands bakes horizon tangents on the CPU for terrain shadows: precedent for a horizon map.
- r186 `Texture.addUpdateRange` exists, but on the WebGPU texture path it falls back to a full upload
  (irrelevant for a small record texture).
- `fwidth` is exported from `three/tsl`.

**Graftable techniques, ranked by value** (all six concepts are mined for these in their files):
1. **Sunfall's `dlSunlit`:** a projected-occluder mask with mip-LOD penumbra taken from the sun's 0.53°
   disc (one fetch gives physically sized soft shadows and a gobo), plus a *ranked gap channel* so a
   combo opens gaps in a fixed order. (Rainbark adopted both.)
2. **Vertex-stage culling of unlit drops** (drops outside the light collapse to zero size) plus a per-drop
   bow.
3. **Painted Ages' `fwidth` mean-blend AA:** fine detail fades to its mean colour by pixel footprint.
4. **Wetness as one global material parameter** (Painted Ages: albedo ×0.65, chroma ×1.35, sheen up).
5. **Iris Springs' underlighting from the ground colour:** steam or mist takes its colour from what lies
   beneath it, sampled analytically.
6. **Riverbloom's "surface as a function":** shade any thin layer (wet film, water over a bed) inside
   the host material instead of adding a transparent layer.
7. **Haft Rang's Sun Rug:** the board's cells cast as light into the world.
8. **Painted Ages' analytic bow plus slab in-scatter:** if any theme shows a bow, use this, not a
   particle-only bow (2,400 spray particles look speckled, not banded).

Rules of thumb from this lens: the hero should be a **material, not a volume**; marches must be TSL
`Loop`s with `.level()` reads, never JS-unrolled (WGSL bloat, gotchas #81 and #101); ID textures are
never linearly filtered or mipmapped (sample nearest at `.level(0)`, AA analytically); camera-facing
sheets show their slices at grazing angles (let analytic fog carry density, fade sheets by view angle);
an always-drawn "extra scene" for a rare event adds pipelines and first-frame compile (paint it in the
backdrop instead); procedural architecture and noise-blob caves are where procedural work looks cheap
first.

### Gameplay-feel designer

- **Lock and clear set the feel** of a session; design them first and make them calm at 2 locks per
  second.
- **Count the combo with discrete beats** (one splash, shaft or pool per link at fixed places); a gauge
  that only speeds something up cannot be read at a glance (×3 and ×5 look alike).
- **Reward the release**, sized by the peak chain (Painted Ages' rainbow on release was the cleverest
  combo idea).
- **The combo break reaches the theme one lock late** (`ComboTracker` resets in `notePieceLocked`;
  [`reference/events.md`](reference/events.md) §11 item 8). Engineering fix for every concept:
  PIECE_LOCK and wave 1's LINE_CLEAR are emitted in the same synchronous tick, so the director can infer
  at `flush()` that a lock with no clear in that frame breaks the chain and deliver `combo(0)` on the
  breaking lock itself. Rainbark's director does this.
- **Map the lock to the piece's rows** (Rainbark's peel strip spans them) and make anything that falls
  move **away** from the card, never across it; thin ambient motion while a run is live.
- **Persistent states read best:** B2B as a standing shape or weather that lasts while the chain lives;
  a T-spin that leaves a record (a kettle, a scar); a perfect clear that reveals what the session
  accumulated.
- **Saturation, not exposure.** The board already flashes gold (0.4) on four lines; project guidance
  caps a theme's exposure lift around +0.36 stop (Haft Rang's +0.45 was the riskiest). Flashes belong to
  quad and perfect clear only. No full-field saturated hue walks as a routine event.
- **Do not punish struggle** (Riverbloom's "sun credit" dimmed the world on every lock that cleared
  nothing) and **do not let an idle hero event look like an unearned reward** (Iris Springs' idle
  eruption during play).
- **Hard drops are frequent** (many players hard-drop nearly every piece): a big burst on each one
  becomes peripheral noise (Sunfall's swiftlet flocks); a rate limit does not fix it.
- **Do not copy the board into the world** as a second live image beside it (Haft Rang's Sun Rug adds
  anxiety as the stack rises, and any desync shows).

**Ideas worth grafting, by source concept:**
- *Painted Ages:* a bow (or fogbow) on release sized by the peak chain; real cell colours via the
  shadow well; a persistent B2B landform; an ash or white sinter bed between games.
- *Riverbloom:* B2B as a standing shape in moving water; a T-spin that leaves a permanent record; hard
  drops feeding a persistent collection (kettle pebbles); a perfect clear in which the world goes still
  and clear before it blooms; a restart rite (the first rain); everything flowing toward the viewer.
- *Haft Rang:* a spatial combo meter of light or water flowing along channels (reach = chain length);
  a T-spin as one rotational click of every pattern at once; B2B given its own screen region.
- *Sunfall:* a discrete per-link counter; the clear's line count picking the optic tier (fragment,
  primary bow, double bow); one leaf per cell on lock; water visible only where the light is.
- *Rainbark:* the lock spanning the piece's rows; four lines resetting the world's age (a readable
  "time since the last four-line clear"); a perfect clear revealing what the session accumulated; a
  T-spin scar that lasts the level; native anticipation (a creak) instead of a hush.
- *Iris Springs:* one preplay splash per combo link; bleach-to-white decay that a clear rescues by
  sealing it into stone; gravity cascade waves extending a physical cascade; a saturation lift instead
  of exposure flashes; a steam-phase release lasting 4 + 2 × peak seconds; a secondary bow and standing
  fogbow as the B2B status light.

---

## Fleet clichés and the house FX grammar to avoid

From the `_fleet-conventions` entry of the visual catalog
([`reference/catalog.md`](reference/catalog.md) Part 0, with each part's cross-cutting list) and
research §0 ([`reference/research.md`](reference/research.md)). A new concept that repeats these will
be seen as another variant. Check every idea against the per-theme "Avoid reusing" lines in the
catalog too.

### Compositions already used heavily

- **Big moon, top right, blue night:** forest, wolfhour, winter, sakura-twilight,
  ice-temple (moon on the left), sunset (at night). Six themes. Moons also in lunara,
  moonrise-summit, moonlit-greenhouse, blood-moon, koi-pond (in the water).
- **Framing trees left and right, open vista in the middle:** forest, fall, summer, sakura-twilight,
  winter, aurora; also golden-forest, verdant-hills, koi-pond (maple), stillwater.
- **A still mirror of water under the board** (planar `reflector()` on Medium and up is the default
  technique): halcyon-apex, vesper-chrysalis, lunara, chiral-gold, ice-temple, golden-forest, summer,
  stillwater, crystal-cave, koi-pond, sunset, sakura-twilight, aurora,
  winter, starlight, bioluminescence, waves, luminous-tides, fluid-dreams, voltage-storm,
  moonrise-summit, moonlit-greenhouse (pond), neon-district, neon-dusk, synthwave-sunset. Salt-flat mirrors (Uyuni) and "tufa or
  pillars standing in a still lake" land in the same place.
- **Hero mountain or peak:** himalayan-peak, wolfhour, mountain, aurora, sakura-twilight, winter,
  halcyon-apex, ice-temple; silhouette ridge layers with mist in solar-eclipse, moonrise-summit,
  lunara; a U-shaped glacial gate (Lapporten) on the horizon in grainfields.
- **Low sun on the horizon with god rays:** halcyon-apex, himalayan-peak, sunset, summer, fall,
  tornado, golden-forest, shifting-sands, waves; a big sun at the vanishing point beside the board in
  nimbus-veil, neon-dusk, synthwave-sunset, stellar-velocity, chromadelic-highway, parhelion.
- **Aurora curtains:** aurora, winter, ice-temple, lunara, moonrise-summit,
  stillwater, vesper-chrysalis, stellar-drift.
- **Crystals and gems:** geode, crystal-cave, lunara, halcyon-apex, vesper-chrysalis, ice-temple (so
  opal, Naica and quartz-led concepts are high risk).
- **Hexagonal columns:** cinder-drift (columnar basalt), ice-temple (rules out Giant's Causeway and
  Fingal's Cave).
- **Seas of clouds:** nimbus-veil, rainbow-terraces (tepui and Zhangjiajie concepts are only partly safe).
- **Radial tunnel to a glowing centre:** geode, serenity-warp, waves (the eye of the tube).
- **One hero object in the free space left of the card, secondary right;** upright phones move the
  hero above the card.
- **Space:** nebulae, stars, ringed planets, black discs (galaxy, aether-tides, serenity-warp,
  starlight, black-hole, supernova, void-ember, cosmic-noir, solar-eclipse, astral-weave,
  stellar-velocity, stellar-drift, chromadelic-highway, blood-moon). The user asked for no more space
  themes.

### Time of day and palettes already taken

- **Dusk and night dominate.** Almost every rebuild is set at dusk, night or in the void. The bright,
  saturated exceptions are verdant-hills (windy day), summer, halcyon-apex (dawn) and nimbus-veil
  (golden), and most other sunlit themes sit at golden hour or dusk (golden-forest, waves,
  shifting-sands, fall, tornado, himalayan-peak, sunset, rainbow-terraces). **A high-key,
  mineral-saturated daylight palette was the biggest open slot.** (The research said "daylight or
  golden hour"; the art judge narrowed it to high sun or morning daylight, because golden hour is
  the fleet's most overused light. Rainbark now uses high-sun blue air; Iris Springs, Painted Ages'
  morning revision and Riverbloom also aim there.)
- Navy or ink night with a silver-white moon (forest, wolfhour, ice-temple, winter,
  starlight, moonrise-summit, moonlit-greenhouse).
- Oxygen-green and magenta aurora on dark teal (aurora, winter, ice-temple).
- Gold, peach and orange low sun with lavender sky (halcyon-apex, himalayan-peak, sunset, tornado,
  fall, summer); amber-gold monochrome (golden-forest); apricot and rose dusk (shifting-sands, waves).
- Turquoise or jade water (halcyon-apex, ocean, koi-pond, waves).
- Pink and lilac (sakura-twilight, himalayan-peak alpenglow, sunset, halcyon-apex rose hour).
- Snow white and ice blue (ice-temple, winter, himalayan-peak, aurora, mountain, parhelion).
- Violet, magenta and blue space gas (galaxy, aether-tides, serenity-warp); violet, magenta and cyan
  neon on dark (fluid-dreams, lunara, murmuration, crystal-cave, nebula-flow); magenta, cyan and plum
  neon (neon-dusk, neon-district, chromadelic-highway); tangerine and coral dusk over teal-indigo with
  bulb gold, flamingo and mint lights (synthwave-sunset, a seaside pier since 2026-10-20).
- Teal and cyan glow on black (bioluminescence, luminous-tides); gold and orange on black (chiral-gold,
  black-hole, void-ember, supernova); heat spectrum (cinder-drift, pyrestorm); crimson monochrome
  (blood-moon); greyscale (cosmic-noir, wolfhour).
- Peach and lavender pastel clouds (nimbus-veil); cyan day to gold meadow (rainbow-terraces); saturated
  grass green and sky blue (verdant-hills); black-light neon on near-black pearl (kaleidosonic);
  cobalt and gold snow (parhelion); coral, jade and cobalt sunlight on pale ground with cyan, magenta
  and gold shadows (sunbraid).
- **Piece palettes:** many reuse the same soft pastel set (amber I, lavender O, mint T, pink S, indigo
  Z, cream J, pale cyan L). Pick a distinct, saturated set tied to the world.

### The house gameplay-FX grammar (do not reskin it)

Nearly every 2026-10 rebuild shares this grammar, in these words: *"a locking piece sends a spark or
wisp of its own colour out of the card into X, which keeps that light; a clear fires the cleared rows
out of the card as blades of light and sends a wave, one front per line; a chain of clears charges or
wakes the world; four lines hold its breath."*

1. **Lock: light leaves the card edge at the piece's height, in the piece's colour**, and flies to a
   site (halcyon wisp, himalayan wind-horses, winter sparks, sunset lantern arc, tornado sparks, ocean
   sinking light, forest firefly puff, fall leaf puff, summer petals, sakura glint, galaxy seed,
   stillwater wisp, vesper moth, stellar-velocity bolt, chromatic-impasto stroke, voltage-storm arc…).
2. **Lock: a ring runs out from under the board's foot or the piece's column** (ice-temple, halcyon,
   himalayan, winter, tornado, ocean, sakura, summer, aurora, forest moss wave, koi,
   golden-forest, starlight, waves, bioluminescence, neon-dusk, neon-district, stillwater, vesper,
   cinder-drift, stellar-drift; shifting-sands with sand).
3. **The world holds the piece's colour for about 30 s and a clear releases it** with a radial wave
   (halcyon crystals, himalayan flags, winter sky, ocean colonies, tornado ribbons, sunset lanterns,
   galaxy nurseries, geode crystals, bioluminescence caps, aether stars, starlight stars, lunara spires,
   voltage-storm towers, void-ember loops, stillwater wisps, vesper lilies, stellar-velocity hoops).
4. **Clear: "blades of light" leave the card at the cleared rows' heights, or twin jets from both card
   edges** (halcyon, himalayan, ice-temple, winter; forest, fall, summer, sakura; galaxy, aether, geode,
   bioluminescence, golden-forest, verdant-hills, serenity-warp, cinder-drift, neon-district,
   stellar-velocity, vesper, astral-weave).
5. **Clear: one wave front per line travels through the world** (halcyon, himalayan, ice-temple,
   forest, and most of the rebuilds above).
6. **Four lines: the world "holds its breath"** (a 0.2–0.33 s near-dark hush), then flares (halcyon,
   himalayan, ice-temple, winter, ocean, galaxy, aether, geode, bioluminescence, koi-pond,
   serenity-warp, cinder-drift, neon-district, stillwater, vesper, stellar-velocity, fluid-dreams,
   chromatic-impasto, voltage-storm, void-ember, chiral-gold), often with a screen ripple.
7. **T-spin: a spiral or wheel spins up round the card** (forest, fall, summer, sakura, himalayan,
   winter; ice-temple turns its snow vortex; "something twists into a pinwheel" in most others).
8. **Level up turns an "hour wheel" of 4–7 named palettes**, which also drifts on its own clock
   (about 80–240 s per step): forest, halcyon, himalayan, ice-temple, ocean, sunset, winter, tornado,
   summer, koi-pond, geode, bioluminescence, serenity-warp, starlight, waves, galaxy, aether-tides,
   solar-eclipse, supernova, voltage-storm, stillwater, stellar-velocity, stellar-drift, vesper. (The
   mechanism is fine for variety; the content should differ.)
9. **Hard drop: a camera dip or jolt** (halcyon, himalayan, winter, tornado).
10. **Combo is one world-scale dial**, often something circling or winding round the board or a
    centre (koi fish ring, golden-forest firefly river, verdant ribbon whirl, aether maelstrom, galaxy
    rings, geode crystal rings, fall leaf vortex, summer flower crown), or a persistent structure that
    collapses on chain break (vesper wings, astral-weave petals, stillwater figures, neon-district
    charge, cinder-drift fissures). True consecutive combo uses one `ComboTracker` per player; the bus
    `COMBO` event is cascade depth (ADR-0011).

Other overused motifs: fireflies, floating motes and bokeh; lanterns; flags and ribbons; petals or
leaves thrown from the card; floating crystals; meteors and shooting stars on combo; rings and hoops;
vortex, whorl and gyre; rain and lightning.

**The new grammar to look for:** the world **records, deposits, fills, erupts, grows, peels or flows**
rather than absorbing sparks. Unused verbs found by the surveys: pieces becoming growth (strata,
terraces, coral, accreting stalactites), flows that fill basins, pigment diffusion, architecture assembling (sound made visible
as standing waves was one until Kaleidosonic took it, 2026-10-13).

### Tech house style (keep this; it is infrastructure, not a motif)

`WebGPURenderer` from `three/webgpu` with the WebGL2 backend as fallback; every surface a self-shaded
`MeshBasicNodeMaterial` from shared uniforms and one sky function; no lights, no `ShaderMaterial`, no
MaterialX noise (baked CPU noise instead), no compute in new work; closed-form, slot-based events with
`seek(t)` determinism and nothing allocated at event time; one scene pass, a max-channel-knee bloom,
one output pass with calm zones over the card and HUD (`usesMrtScenePass()` false); six tiers
(Minimal…Extreme); module split `core / tsl / parts / world / director / composition / post / quality
/ theme`. Since the competition, two more rules: **no 3D textures** (`Data3DTexture`, `texture3D`,
`lut3D` fail WebGPU validation on the cloud container's SwiftShader) and **prototype the hero
material on the CPU first**. Details: PLAYBOOK §2 and §7.

### The piece palette gate

`npm run check:palette` (`scripts/palette-guideline-check.mjs`) screens the first hue of each shape
against the Guideline bands: I cyan 160–210°, O yellow 32–75°, T purple 245–315°, S green 90–170°,
Z red 320–20°, J blue 200–250°, L orange 20–50°. **It fails at 7/7 and warns at 6/7.** 0/7 is the
house ideal (Summer, Ocean, Verdant Hills, Galaxy, Aether Tides, Rainbark).

### Rainbark is now part of the fleet

Anything a new concept takes from Rainbark is now a collision: colossal painted or rainbow-barked
trunks; bark or skin peeling, shedding or moulting as the event grammar; blue aerial-perspective haze
over saturated material; a mist floor seen between trunks; pinhole sunfleck gobos on a hero surface;
canopy gaps or pools of light opening one per combo link; a vertical world with no ground or horizon;
the camera climbing a storey per level; amber resin beads; a sunshower for back-to-back; the world's
age as a record of time since the last four-line clear; a perfect clear revealing a floor carpeted
with the session's debris. Its full entry is §61 of [`reference/catalog.md`](reference/catalog.md).
The other five concept files each say what not to duplicate from Rainbark.

---

## All 33 researched candidates

The research round's full list, so a future session can pick a subject that was not developed.
Palettes (hex), scene breakdowns, gameplay sketches, techniques and sources for every candidate are in
[`reference/research.md`](reference/research.md). "Closest existing themes" is the researcher's
similarity check against the fleet at `5d3478d`; add `rainbark` to it for anything with giant trees,
bark or blue haze. Phone risk: **Low** = heightfield or plane shaders, a few sheets, instanced
particles; **Moderate** = UV-offset refraction, several volume sheets, more geometry; **High** =
transmission or dispersion passes, raymarched volumes, many lights.

### A. Geothermal and mineral worlds

| # | Candidate (alternate names) | Real inspiration | The idea in one line | Closest existing themes (similarity) | Phone risk | Status |
|---|---|---|---|---|---|---|
| 1 | **Prismatic Springs** (Prismara, Thermal Prism, Caldera Bloom) | Grand Prismatic Spring, Yellowstone | A huge spring in perspective (cobalt eye, turquoise lip, yellow, orange and rust microbial bands) under backlit steam glowing teal from below; heat expands the rings, four lines erupt a geyser with a rainbow in the spray | Low: pyrestorm (geysers, but dark volcanic orange), halcyon-apex (turquoise water) | Low | Developed as **Iris Springs**; research rank 1 |
| 2 | **Travertine / Cotton Castle** | Pamukkale, Huanglong, Mammoth Hot Springs terraces | Scalloped white terraces whose pools hold the sunset sky in turquoise, peach and rose; rows map to terraces and a clear overflows the cascade tier by tier | Low–moderate: still water near the board (halcyon-apex, golden-forest) | Low–moderate | Merged into Iris Springs (its terraces) |
| 3 | **Dallol Acid Garden** (Sulfur Bloom) | Danakil Depression, Ethiopia | Neon chartreuse terraces, steaming green acid pools ringed with rust, lacy salt pillars, pink dawn through vapour; a lock crystallises a salt flower in the piece's colour | Low: pyrestorm, geode. Aesthetic risk: neon chartreuse can look toxic and fight yellow and green pieces | Low–moderate | Open; better as an accent inside a basin concept |
| 4 | **Painted Strata** (Danxia, Stratumlands, Rainbow Ridge) | Zhangye Danxia, with Vinicunca and Landmannalaugar | Sawtooth ridges striped with tilted colour bands under raking light; each cleared row becomes a new stratum in its blocks' colours, so the land records the game | Low–moderate: mountain, himalayan-peak (cool, snowy), shifting-sands (warm desert), Odyssey's faint terrain strata | Low–moderate | Developed as **Painted Ages**; research rank 2 |
| 5 | **Blue Fire Caldera** (Ijen, Sulfur Lantern) | Kawah Ijen, Java | Rivers of electric-blue burning sulfur running down black slopes before dawn, yellow sulfur crusts, a milky turquoise acid lake | Moderate: cinder-drift, pyrestorm (volcano), voltage-storm and the neon set (electric glow at night); night again | Low–moderate | Open; a runner-up ("spectacular but another night volcano") |
| 6 | **Mineral Mosaic** | Spotted Lake (British Columbia); Champagne Pool and Devil's Bath (Wai-O-Tapu, New Zealand) | An aerial-oblique basin of polka-dot pools in green, blue, yellow, pink, lime and antimony orange; each cleared line evaporates into a new pool tinted by its blocks | Low; weak on depth and drama | Low | Open; better as a detail layer (Iris Springs uses it for accent pools) |
| 7 | **Iron River** | Río Tinto, Spain | A wine-red and orange acid river over ochre and black mud terraces with jade seeps; the current carries coloured ribbons, a clear deposits iron terraces | Moderate: could read as desert (shifting-sands) or a blood palette (blood-moon); less beautiful than the others | Low | Open |
| 8 | **Firefall** | Horsetail Fall, Yosemite, in February | A blue-grey granite wall in winter shade with one thread of waterfall glowing molten orange at sunset; each clear brightens the fall | Moderate: a single hero element; the lava look is close to cinder-drift | Low | Open |

### B. Water, karst and tropical rivers

| # | Candidate (alternate names) | Real inspiration | The idea in one line | Closest existing themes (similarity) | Phone risk | Status |
|---|---|---|---|---|---|---|
| 9 | **Liquid Rainbow** (Cristales, River of Five Colours) | Caño Cristales, Colombia | Crimson and magenta riverweed streaming in shallow clear rapids over pale potholed sandstone, caustics everywhere, a table mountain behind; a five-colour combo ladder | Low–moderate: koi-pond (water garden), ocean (reef plants), waves | Moderate | Developed as **Riverbloom**; research rank 3 |
| 10 | **Lençóis Lagoons** (Bedsheet Dunes) | Lençóis Maranhenses, Brazil | White dunes with turquoise, emerald and cobalt rain lagoons in the hollows under towering cumulus; four lines bring a downpour that fills new lagoons, then sun and a rainbow | Moderate: shifting-sands (dunes), though the palette is the opposite | Low | Open; a runner-up ("lovely airy palette, too close to shifting-sands in genre") |
| 11 | **Marble Chapels** | Capillas de Mármol, General Carrera Lake, Patagonia | Swirled blue, white and grey marble arches with caustics dancing on the walls over glacial turquoise water, seen from boat level | Moderate: a cave over water (crystal-cave, geode) | Low–moderate | Open |
| 12 | **Turquoise Cascades** | Plitvice; Jiuzhaigou (Five Flower Lake) | Stepped turquoise lakes joined by hundreds of small falls through forest, sunken trees in clear water; a clear overflows one lake into the next | Moderate: forest and lake (golden-forest, fall) | Moderate | Absorbed into #2 |

### C. Living colour (plants and animals)

| # | Candidate (alternate names) | Real inspiration | The idea in one line | Closest existing themes (similarity) | Phone risk | Status |
|---|---|---|---|---|---|---|
| 13 | **Rainbow Bark** (Deglupta) | Rainbow eucalyptus groves, Maui and Mindanao | A misty rainforest of colossal trunks streaked green, blue, purple and orange; each cleared line peels a strip of bark, revealing fresh chartreuse that ages over the session | Moderate: trees (forest, golden-forest; moonlit-forest until Spring replaced it, 2026-10-18) | Moderate | **Taken:** the same subject became **Rainbark** (the wildcard, now built) |
| 14 | **Desert Bloom** (Desierto Florido) | Atacama flowering desert | Ochre hills carpeted in magenta malva under snowy Andes volcanoes and an ultra-clear sky; a clear sends a wave of bloom, four lines bring El Niño rain and a full bloom | Moderate: meadows (summer, verdant-hills), desert (shifting-sands) | Low–moderate | Open |
| 15 | **Wisteria Veil** | Kawachi Fuji wisteria tunnels, Japan | A tunnel of hanging purple, pink and white racemes in dappled light | **High:** sakura-twilight (blossoms, Japanese, pink and purple) | Moderate (many instances) | Rejected |
| 16 | **Nemophila Hills** | Hitachi Seaside Park, Japan | Hills of baby-blue flowers merging with sea and sky; red kochia in autumn | **High:** verdant-hills (rolling hills on a bright day) | — | Rejected |
| 17 | **Flamingo Salt Pans** | Lake Natron (Tanzania), Lake Hillier (Australia) | Crimson and pink brine patterns and white salt polygons, a volcano in haze, flocks of flamingos; a clear lifts a flock as a pink ribbon | Moderate: flocks (murmuration), salt plain (the mirror trope) | Low–moderate | Open |
| 18 | **Dragonblood Plateau** | Socotra | Umbrella-crowned dragon's blood trees on knife-edged limestone, bottle trees, sea fog rolling up at dusk; resin beads glow on lock | Low–moderate; the colour is muted, so less spectacular (Rainbark now uses amber resin beads) | Low–moderate | Open |

### D. Caves and architecture of light

| # | Candidate (alternate names) | Real inspiration | The idea in one line | Closest existing themes (similarity) | Phone risk | Status |
|---|---|---|---|---|---|---|
| 19 | **Doline** (Skylight Jungle) | Hang Sơn Đoòng, Vietnam | A vertical sunbeam pouring through a collapsed ceiling into a colossal cave with a jungle beneath and clouds forming inside | Moderate: caves (crystal-cave, bioluminescence), jungle (forest themes); daylight sets it apart | Moderate–high (volumes) | Developed as **Sunfall**; research rank 5 |
| 20 | **Haft Rang** (Orosi, Prism Pavilion, Rose Light) | Nasir al-Mulk's stained-glass morning light, with Turrell's light-as-material | A secular garden pavilion of orosi windows throwing pools of coloured light across carpets; a lock lights a pane in the lattice and its patch lands on the carpet; four lines ignite a sunburst medallion | Low: serenity-warp (stained-glass pieces only), chromatic-impasto (paint). Risk: cultural and religious sensitivity; keep it secular | Low–moderate | Developed as **Haft Rang**; research rank 4 |
| 21 | **Glass Garden** | Chihuly installations (Persians, chandeliers, reeds) | A dusk garden of towering blown-glass forms; a lock blows a glass bud in the piece's colour, combo assembles a chandelier, four lines ignite the sunburst | Moderate: moonlit-greenhouse (conservatory), crystal-cave, geode | **High** (transmission pass; needs an environment-only refraction fallback) | Open |
| 22 | **Nautilus Nacre** | Mother-of-pearl and the chambered nautilus | Inside the logarithmic chambers of a colossal nautilus with nacre walls shifting pink, green, blue and gold; each four-line clear grows a new chamber | Moderate–high: geode ("inside a cavity"), serenity-warp (spiral) | Low–moderate | Open |

### E. Sky and atmosphere phenomena (most collide with the roster)

| # | Candidate (alternate names) | Real inspiration | The idea in one line | Closest existing themes (similarity) | Phone risk | Status |
|---|---|---|---|---|---|---|
| 23 | **Tepui Falls** (Lost World, Roraima) | Mount Roraima and Kerepakupai Merú (Angel Falls) | Black hoodoos, rose-quartz pools and pitcher plants on a tepui summit; a waterfall leaps off the edge and dissolves into mist over a sea of clouds at sunrise | Moderate–high: the cloud sea (nimbus-veil, rainbow-terraces), quartz (geode, lunara) | Moderate | Open |
| 24 | **Pillar Mist** (Shan Shui) | Wulingyuan and Zhangjiajie | More than 3,000 quartzite-sandstone pillars rising from valley mist, possibly drawn as an ink landscape | Moderate: mist and clouds (nimbus-veil), painted style (chromatic-impasto), peaks (himalayan-peak) | — | Open |
| 25 | **Roll Cloud Dawn** | The Morning Glory cloud, Burketown | A roll cloud up to 700 km long at dawn | **High:** nimbus-veil, rainbow-terraces | — | Rejected |
| 26 | **Kelvin-Helmholtz Billows** | Kelvin-Helmholtz clouds and mammatus at sunset | Breaking-wave cloud billows | **High:** nimbus-veil, tornado (mammatus), voltage-storm | — | Rejected |

### F. Abstract art and materials

| # | Candidate (alternate names) | Real inspiration | The idea in one line | Closest existing themes (similarity) | Phone risk | Status |
|---|---|---|---|---|---|---|
| 27 | **Suminagashi** ("floating ink") | Japanese marbling, 12th century | An infinite pale water surface on washi; a lock drops concentric ink rings in the piece's colour, a clear combs them into marbling, four lines lift the paper to reveal the print | Moderate: chromatic-impasto (paint), fluid-dreams (liquid), koi-pond (Japanese pond); fairly flat and 2D | Low | Open |
| 28 | **Thin Film** (Bubbleglass) | Soap-film interference and Marangoni swirls | Giant drifting soap films and bubbles over a pale landscape, swirling interference bands and black spots before popping; a clear pops a row of bubbles | Moderate: fluid-dreams (thin-film liquid drops) | Low | Open |
| 29 | **Oscillator Garden** | Belousov–Zhabotinsky reaction waves | A vast petri landscape of travelling chemical spirals in orange and blue; a lock seeds a wave, a T-spin seeds a spiral (shear is the real trigger) | Moderate: abstract and 2D (nebula-flow, fluid-dreams) | Low–moderate (ping-pong render targets) | Open |
| 30 | **Topographic Arches** | Roger Dean's floating islands and arches | Biomorphic stone arches and floating islands with waterfalls pouring into the void, alien flora | Moderate–high: floating islands (rainbow-terraces, halcyon-apex); reads as derivative of Avatar | — | Open (weak) |
| 31 | **Ten Largest** | Hilma af Klint's *The Ten Largest* (1907) | A 3D walk through her pastel tempera spirals, petals and looping script | Moderate: painterly worlds (chromatic-impasto); niche reference | — | Open |
| 32 | **Ganzfeld** (Skyspace) | James Turrell | A minimal elliptical room whose oculus frames a sky shifting through impossible gradients | Low, but too sparse to be breathtaking | — | Borrowed as a lighting idea by Haft Rang (its perfect clear) |
| 33 | **Weather Project** | Olafur Eliasson, Tate Modern (2003) | A semicircular sun of mono-frequency lamps doubled by a mirror ceiling, in mist, leaving a yellow and black duotone | Moderate–high: big-sun pictures (parhelion, solar-eclipse, sunset, synthwave-sunset) | — | Rejected |

### High-risk rejects (checked; each collides with a named theme)

| Idea | Closest existing theme |
|---|---|
| Waitomo glow-worm cave | **bioluminescence** (already has glow-worms picking out the vault) |
| Naica crystal cave | crystal-cave, geode |
| Opal play-of-colour | geode |
| Giant's Causeway / Fingal's Cave | cinder-drift (columnar basalt), ice-temple |
| Salar de Uyuni mirror | halcyon-apex, lunara, vesper-chrysalis (mirror trope) |
| Abraham Lake bubbles / Baikal ice | ice-temple (black ice, cracks under the surface) |
| Vatnajökull blue ice cave | ice-temple, winter |
| Brinicle | ice-temple and ocean (also too obscure to read) |
| Catatumbo lightning | voltage-storm |
| Light pillars / Brocken glory | parhelion (ice-crystal halo optics) |
| Noctilucent clouds | aurora, nimbus-veil |
| Mono Lake tufa | mirror trope |
| Kusama infinity rooms | starlight, galaxy (fields of infinite points), kaleidosonic (a jewel in every cell of an endless lattice) |
| Ferrofluid | cosmic-noir, void-ember (dark and black) |
| Cymatics | kaleidosonic (Chladni floors and standing-wave veins; singing-bowl before it) |
| Tsingy limestone needles | No collision, but grey and hostile with little colour payoff |

Source URLs for each are in [`reference/research.md`](reference/research.md).

### The research round's ranking

1. **Prismatic Springs** (#1, with #2's terraces in the foreground and #3 and #6 as mineral accents): one
   coherent hydrothermal basin (Yellowstone really holds Grand Prismatic, the Mammoth terraces and
   geysers together); fills the high-key daylight slot; spectrum-wide but natural colour; no crystals,
   mirrors or cosmos; cheap backlit steam; a new grammar (heat expands rings, clears raise steam and
   fill terraces, four lines erupt a geyser). Risks: the aerial "eye" must stay readable beside the
   card (oblique overlook, not top-down); steam must not wash out the board.
2. **Painted Strata** (#4): the best metaphor (cleared rows become geological layers in the blocks'
   colours); risks reading as "another mountain theme" unless the stripes are bold.
3. **Liquid Rainbow** (#9): the only candidate whose spectacle is moving colour inside clear running
   water; believable shallow water costs more and is harder on phones.
4. **Haft Rang** (#20): the most surprising idea, an interior made of coloured light; cultural
   sensitivity, and less "extraordinary landscape" depth.
5. **Doline** (#19): maximum atmosphere and depth with daylight shafts; volumetric light is the main
   phone risk, and "cave" and "jungle" each brush existing themes.

Runners-up: Travertine (#2, better merged into #1), Blue Fire Caldera (#5, another night volcano),
Lençóis Lagoons (#10, too close to shifting-sands in genre).

### Other wildcard subjects considered (and why they were dropped)

The Rainbark proposer weighed about 40 free subjects. The shortlist it rejected:

| Wildcard | Why it was dropped |
|---|---|
| Reverse waterfalls on emerald pali cliffs | Narrow palette; would have been the fourth rainbow concept |
| Macaw clay-lick cliff | The house "held colour until a clear" grammar; creature risk |
| Laguna Colorada | Overlaps Iris Springs' mineral colour basin |
| White Desert chalk | Desert collisions |
| Antelope Canyon | Shifting-sands, Painted Ages, and the roof-shaft cliché |
| Seashell cellular-automaton growth | The same "record" metaphor as Painted Ages |
| Qinglü blue-green painted peaks | Layered ridges with mist; painting overlap with chromatic-impasto |
| Pop-up paper | Layered-silhouette cliché |
| Coloured smoke | Nebula look-alike |
| Physarum | Off-putting |
| Aerochrome infrared | Reads as a filter gimmick |
| Lichen macro | Too obscure |
| Fata Morgana | Mirror trope |

**Writing a new concept from one of these?** Use the six concept files as templates (section 1 shows
what a complete proposal contains), check it against [`reference/catalog.md`](reference/catalog.md)
and the clichés above, and have it judged on the three lenses before building. Then follow
PLAYBOOK.md as for any other concept.

---

## Reference snapshots

[`reference/`](reference/) holds the analysis the concepts were written from. Every file carries the
header "Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers
drift, verify against the current code". Where a snapshot and PLAYBOOK.md disagree, PLAYBOOK wins: it
was written later and folds in what the Rainbark build learned.

**Two themes were rebuilt after the snapshot**, so their catalog entries describe the old themes:
**Moonlit Greenhouse** (now a Victorian palm house at night with a lily canal, lanterns, night flowers and
the Queen of the Night; [`docs/MOONLIT_GREENHOUSE_VISUAL_OVERHAUL_2026-10.md`](../MOONLIT_GREENHOUSE_VISUAL_OVERHAUL_2026-10.md))
and **Nebula Flow** (now a Pillars-of-Creation stellar nursery; [`docs/NEBULA_FLOW_VISUAL_OVERHAUL_2026-10.md`](../NEBULA_FLOW_VISUAL_OVERHAUL_2026-10.md)).
Read those records instead of their catalog entries, and check `git log` for any later rebuilds before
judging resemblance.

| File | What it holds | Read it when |
|---|---|---|
| [`reference/catalog.md`](reference/catalog.md) | The visual catalog of all **61** themes: icon, setting, time of day, palette and piece colours, motifs, motion, gameplay FX, tech and **"avoid reusing"** for each; the fleet-wide conventions (Part 0) and each survey's cross-cutting lists. Cosmic Chimes is not in it (it was the theme being replaced, and it no longer exists); Rainbark was added as §61 from its spec. | Checking a concept for resemblance; choosing what to avoid; picking a slot |
| [`reference/catalog.json`](reference/catalog.json) | The same catalog as a JSON array (fields `id`, `name`, `setting`, `timeOfDay`, `dominantPalette`, `keyMotifs`, `motion`, `gameplayFx`, `tech`, `motifsToAvoidReusing`; one `_fleet-conventions` pseudo-entry) | Scripted checks |
| [`reference/research.md`](reference/research.md) | The 33 researched candidates in full (scene, palette hexes, moves, gameplay, techniques, phone risk, similarity, source URLs), the rejects and the top five | Picking a new subject |
| [`reference/adapter.md`](reference/adapter.md) | The theme adapter and lifecycle contract: the exact call graph from discovery to dispose, id-specific identifiers, director, composition, quality tiers, and the recipe for cloning Serenity Warp's adapter | Stage 0; any lifecycle bug |
| [`reference/rendering.md`](reference/rendering.md) | The rendering house style: file layout of a rebuild, the world object, the post pipeline in detail, TSL idioms, the quoted gotchas, performance practices, the playground effect contract | Writing any TSL |
| [`reference/events.md`](reference/events.md) | Gameplay events: the bus, canonical emitters, field semantics, emission order within one lock, emit sites per mode, lifecycle signals, director pattern, board-to-screen mapping, accessibility, mode-specific gotchas | Writing the director and the event language |
| [`reference/ci.md`](reference/ci.md) | CI workflows, what each gate asks of a theme, the tests a theme swap touches, how sibling tests are structured, which validators run in a cloud container, booting the real game headless, minimal and full command lists | Before every commit |
| [`reference/rename.md`](reference/rename.md) | The rename and removal surface for retiring Cosmic Chimes, **already executed** in `585ab55` | As the worked example behind PLAYBOOK §4 |

**Pictures of the existing themes** are not in `reference/`: use `docs/theme-screenshots/<id>.png`
(the last fleet capture of each theme; **parhelion and rainbark have none**, so capture them from
their playground effects, `effect=parhelion` and `effect=rainbark`, with PLAYBOOK §5.3's `shot.mjs`),
the capture folders named in each catalog entry, and each theme's icon
(`src/themes/<id>/<id>-theme-icon.png`). Where a concept file asks you to compare against
"snapshots in `docs/theme-concepts/reference/`" (for example Sunfall's mean-L\* check against
crystal-cave, cinder-drift and bioluminescence), read the theme's catalog entry there and measure the
image in `docs/theme-screenshots/`. Better still, capture the current theme yourself with the scripts
in PLAYBOOK §5, because those PNGs can be stale.

**What is deliberately not in the repo:**
- **Reference photographs.** The two photos of real *Eucalyptus deglupta* bark used for Rainbark's art
  direction are copyrighted (TopTropicals' catalogue page for the species,
  <https://toptropicals.com/catalog/uid/eucalyptus_deglupta.htm>). They are described in rainbark.md
  §10.1. Never commit a copyrighted reference image anywhere, including `public/playground-refs/`
  (which is served); cite its URL instead.
- **The capture scripts** (`shot.mjs`, `game.mjs`, `switch-away.mjs`) and the phone-validator port
  shim: printed in full in PLAYBOOK §5, to be saved in each session's scratchpad, never in the repo.
- **The CPU bark lab** scripts and renders. The chosen script (`bark6.py`, numpy and Pillow) is
  printed in full in rainbark.md §10.8 with the exact arguments that reproduce the chosen render
  (save it outside the repo); the five rejected versions are described in §10.3 and the chosen
  model in §10.4.

---

## Rules that apply to every concept

- `CLAUDE.md`: iterate in the playground first; never call a WebGPU/TSL change done without a
  screenshot on both backends and a clean console (ADR-0007); **one small effect per session**.
- Read `docs/ARCHITECTURE_INDEX.md` and `docs/adr/` before structural changes (ADR-0007, 0011, 0016,
  0018, 0019 and 0020 bind theme work).
- Generated SFX are unavailable (the wrapper's machine is gone). If a step needs new audio or any asset
  you cannot make in code, stop and ask the user. Replacing a theme keeps its song under the new title;
  tell the user the audio is unchanged.
- No downloads, no 3D textures, no `ShaderMaterial`, no MaterialX noise, no window resize listeners,
  and no net new lines in `src/main.js` or `src/core/game-modes/OdysseyMode.js` (both at their
  architecture-fitness ceilings).
- The IP word rule at the top of this file.
