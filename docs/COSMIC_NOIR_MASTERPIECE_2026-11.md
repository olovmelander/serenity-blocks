# Cosmic Noir — the living night (2026-11-18)

Status: **Reference** (audit, design and evidence of the 2026-11-18 pass; branch
`feature/cosmic-noir-masterpiece`, **not merged** when written). It builds on
[COSMIC_NOIR_LIGHTHOUSE_2026-11.md](COSMIC_NOIR_LIGHTHOUSE_2026-11.md) (the lighthouse, the stage,
the light in the air, the film, the director and the adapter are that build's) and replaces its
sea, its rock, its breaking waves and most of its event language.

Evidence: [reports/cosmic-noir-masterpiece/](../reports/cosmic-noir-masterpiece/) (listed in §8).

## 1. The ask

Olov, 2026-11-18: audit the theme thoroughly, then make it "one of the most visually stunning
themes in my game: a true graphical masterpiece". It should stay black and white ("using light,
shadow and contrast for its drama"), "feel varied over time, shifting and evolving as you play",
give every event "its own distinct effect ... with the biggest moments feeling the most
spectacular", and stay smooth and easy to read.

## 2. The audit: what was weak

Looked at in the playground on main before anything was changed (`before-*.jpg`):

| Part | What was wrong |
| --- | --- |
| The sea | Matte grey dunes of smoke. It did not read as a sea, and nothing in it was black. |
| The rock | Soft charcoal folds, like cloth. It was also drawn straight through the water to the foot of the frame (the sea was never walked in front of it), so its size was its drowned bulk. |
| The breaking wave | A blurred grey curtain in fat fingers, with a stippled box round it (its walk's jitter in the veil). Flat grey light. |
| The sky | A good galaxy, a uniform salt of stars, and nothing that ever changed. |
| Over time | The only change was the print's tone: sepia, selenium and cyanotype. That is colour, in a theme asked to be black and white, and it is the same picture in another tint. |
| Events | A lock was a faint grey smudge. One, two and three lines were "more rings". A twist was a brighter star filter. A perfect clear was a gold and blue tint. Only four lines (the flashbulb) had a mark of its own. |
| Pieces | Greys down to charcoal `#3c4049` on a board that is nearly black: the dark pieces were hard to read. |
| Kept | The lighthouse and its lantern room, the beams and the slats' shafts, the galaxy, the far light, the film (grain, dust, the flashbulb, the cue marks), the chain's spin-up, the light echoes. |

## 3. The picture now

**The sea is a dark sea** (`cosmic-noir-sea.js`). Three things lie in one place and each is lit its
own way:
- **The water** is black glass. It shows only what it mirrors, more at a glance than head-on: the
  night sky's own glow (a wave's far face is silver, its near face black: that is what models the
  waves), the galaxy as a long road toward the eye, the far light as a thread, the lamp as glints.
- **The smoke lying on it** in drifts is matte and takes the beam's pool, the slats' spokes and an
  echo's ring. It is a fifth of what it was: the smoke is now weather (§4), not the sea itself.
- **White water**: on a roller's crest and in the wash round the rock, whole while fresh and torn
  into lace as it ages. The lace is a baked field of cell walls (`bakeFoamLace`), combed along the
  wind.

**The rock** (`cosmic-noir-rock.js`) is shaped on the CPU and baked into a small volume of
distances that the shader reads: plane-cut lumps melted together, warped at two scales, in beds
that dip and wander (hard beds stand proud as ledges), cracked along ridges of noise. It is wet:
dark where the last wave washed it, mirroring the lamp as glints and the sky along its edges, and
**white water runs off it in threads** after every wave. The sea now stands in front of it, so it
is a skerry in the water; the tower's footing was raised to 2.3 over the sea to give it presence.

**The lighthouse** gained a plinth of dressed stone, a round-headed door, and the light that the
lantern and the gallery let fall on the rock under them.

**A breaking wave** (`cosmic-noir-spray.js`) is no longer a marched volume. It is two instanced
quads flown in closed form in the vertex stage:
- **the burst**: billows laid over the picture. Two in three are water (small, torn-edged, drawn
  out along their own flight, soon fallen back), one in three the mist round it (large, soft,
  thin, slow to go). Jets along the shore, a dark foot, a lit crown.
- **the drops**: bright streaks drawn along their flight, added to the picture.
A wave keeps its row for as long as it lives, so nothing in the air changes hands when the next one
breaks. What stands behind the tower is hidden by where the sight line meets the tower's cylinder.

**The sky** (`cosmic-noir-sky.js`) gained a cloud deck (a plane read from the sea's own baked field
at two scales that slide through each other, so its shapes change), lightning inside it, a fork of
lightning, and meteors.

**The print is black and white.** A stock's tone is now `STOCK_TONE` = 0.3 of its toner: the breath
of colour a paper has, never a colour of its own. The heat's split tone is scaled the same way.

## 4. The night's weather: never the same for long

`cosmic-noir-night.js` (three-free). Five acts, round and round, one every `NIGHT_STEP` = 110 s by
the clock, and a level-up moves the night one act on. The print's stock keeps its own 100 s clock,
so the two fall in and out of step.

| Act | The look |
| --- | --- |
| clear | The home act: a hard, clean night. The whole galaxy over a black sea, sharp stars, thin air. |
| scud | Torn cloud races across the galaxy, silver where it is thin. The sea begins to run. |
| squall | The sky closes. Rain slants through the beam (it shows only where there is light), the sea heaves, and sheet lightning opens the whole picture: the cloud from inside, the sea as pewter, the tower as a cut-out. |
| clearing | Ragged cloud going home, a long swell, the galaxy back and brighter, a flicker far out now and then. |
| fog | A bank on the water and thick air: the beams are solid bars, the galaxy a glow. |

Hot play brews a storm of its own on top of whatever act stands (`brew`: half a minute to come, a
minute to go): cloud, rain and lightning walk in as the surge holds.

By themselves, by the clock: a roller breaks on the rock every 6.25 s; the far light flashes twice
every 11 s; lightning falls on a grid of moments (one slot every 6.8 s, when the night is stormy);
a lone meteor may fall once in every 37 s.

Lightning is one soft swell a strike and a slow glow after it, never a strobe, and every flash is
multiplied by `flashScale()` where it is written (ADR-0021).

## 5. Event language

| Event | Its own answer |
| --- | --- |
| Lock | Two rings of light run out over the dark water beside the card, like a drop in a pond, over an ember that burns under the sea for a moment. A hard drop lands harder. |
| One, two lines | The lamp flares and a light echo per line runs out over the sea to the horizon (kept). |
| Three lines | A meteor crosses the sky over the board, from the galaxy's side. |
| Four lines | The flashbulb (kept), and **a great wave breaks over the rock at once**, harder than any roller: it goes over the gallery. The far light answers, and the sea surges. |
| Twist | The beam whips once round the sea (a turn it pays off smoothly), and the slats spin. A twist that clears nothing: half a turn. |
| Back-to-back | A fork of lightning falls to the sea beside the board, after the flashbulb has gone, right and left of the card by turns. A double ring (kept). |
| Chain | The lighthouse spins up and the blinds open (kept). |
| Perfect clear | The crown: the galaxy blazes and lets a shower of thirteen meteors go, a great wave breaks, two wide rings (kept), the blinds stand edge-on. |
| Level up | A reel change: the cue marks (kept), the film's gate rolls once (a frame line crosses the picture), the far light greets it, and the night turns one act on. |
| Heat | The lighthouse runs (kept), and a storm brews. |
| Game over | The iris closes on the lamp, as a silent picture ends. It opens for the next run, or by itself after 7 s, so the menu is never left in the dark. |

Reduced motion: no whip, no gate roll; the sea at 0.4 of its pace as before.

## 6. Tiers

| Tier | Burst billows | Drops | Rock cell | (the rest as before) |
| --- | --- | --- | --- | --- |
| Minimal | 330 | 300 | 0.16 | no wisps, no fine layer, one star lattice |
| Low | 510 | 510 | 0.16 | |
| Medium | 840 | 900 | 0.12 | |
| High | 1260 | 1410 | 0.085 | |
| Ultra | 1620 | 1950 | 0.085 | |
| Extreme | 1980 | 2520 | 0.085 | |

Every tier keeps the whole picture, every act and every event. The bakes (smoke, sea, foam lace,
rock) run in the theme's worker on a first visit; the rock takes 0.1 s (Low) to 0.6 s (High).

## 7. Validation

**Playground** (`?effect=cosmic-noir`, a private Vite, a private headless Chrome on real WebGPU,
RTX 5080 laptop, 30 fps cap). New parameters: `night=<0..4|name>` holds an act;
`event=…|spin|b2b|over|bolt|shower`. Console clean on every capture, on WebGPU and with
`forceWebGL=1`. Looked at: every act, every event, a wave's whole life, High, Low, Minimal,
Extreme, WebGL2, a 430 × 900 portrait frame.

**The real game** (the dev server in headless Chrome, single player, High, WebGPU, 30 fps):
six real hard drops through the keyboard (`counts.locks` rose with them: the director reaches the
world); three lines, four lines with a back-to-back, a twist, a perfect clear and a level-up fired
on the live world; then the board stacked to the top by real drops and the run ended by itself
(`gameOver` → `endRun` → the iris at 0.99 behind a readable game-over card). Console: the two
expected SteamCloud warnings, nothing else. Not done in the game: a played clear, versus,
Infinity, a quality change while it runs, a lost GPU device, a phone.

**Tests** (`tests/unit/cosmic-noir-*.test.js`, 197 tests in 8 files, all passing): the new
`cosmic-noir-night.test.js` pins the acts, the lightning (one swell, a pure function of the clock,
gated by the storm), a seek landing on the same weather as running there, the slow brew, and an
answer of its own for every event; the bake suite pins the foam lace and the rock (a footing under
the tower, clear of its box); the shader gate builds the backdrop, the air, the burst and the drops
to WGSL and GLSL at three tiers.

**Cost.** Capped at 30 fps, so an order of magnitude only (`profile=1&trackTimestamp=1&demo=1`,
1920 × 1080, 12 to 15 samples a run, main served beside the branch):

| | GPU p50 (ms) | GPU p95 (ms) |
| --- | --- | --- |
| main, High | 1.31 | 2.95 |
| this pass, High | 1.01 | 1.24 |
| this pass, High, squall (rain, cloud, lightning) | 1.50 | 4.37 |
| main, Minimal | 1.02 | 3.27 |
| this pass, Minimal | 0.56 | 0.91 |

The picture is cheaper than it was: the marched plume is gone (it was the dearest frame), and the
burst's sprites cost less. The squall is the dearest act. Not measured: an uncapped frame rate, the
fleet bench, an integrated GPU, a phone.

### Traps found (also in the skill's gotcha files)

- **Dots along every crest** once the sea was a mirror: the walk extrapolated near-misses. #1314.
- **A floating rock**: the sea was never walked in front of a pixel the rock covers. #1315.
- **No white water from a low eye**: foam on the sea at the shore is two pixels tall. #1316.
- **A lock that does not read** on mirror water: draw rings of light, finer than their swell. #1317.
- **A rock as drapery, then as brickwork**: shape it on the CPU with real noise and bake it. #1608.
- **A burst as fingers, a cumulus, popcorn**: two kinds of billow in one quad. #1742.
- **Weather that snaps in**, and a seek that no longer matches: brew slowly, keep clocks free of it. #1743.
- **Lightning that must not strobe.** #1423.

## 8. Files and evidence

`src/themes/cosmic-noir/`:
- new: `cosmic-noir-night.js` (the acts, the lightning), `cosmic-noir-rock.js` (the rock's shape
  and bake);
- rewritten: `cosmic-noir-spray.js` (the burst and the drops), the sea's light in
  `cosmic-noir-sea.js`;
- removed: `cosmic-noir-splash.js` (the marched plume);
- extended: `cosmic-noir-sky.js` (cloud, lightning, fork, meteors), `cosmic-noir-lighthouse.js`
  (the rock's volume, plinth, door, wet stone, white water), `cosmic-noir-volume.js` (rain, the sea
  in front of the rock), `cosmic-noir-world.js` (the weather, the events, the iris, the gate),
  `cosmic-noir-post.js` (the iris, the gate roll), `cosmic-noir-core.js` (`STOCK_TONE`, the wave
  rows, meteors), `cosmic-noir-bake.js` and the worker (`bakeFoamLace`, the rock),
  `cosmic-noir-theme.js` (`endRun`), `cosmic-noir-tetrominos.js` (the pieces), the icon.

`reports/cosmic-noir-masterpiece/`: `before-rest.jpg`, `before-sweep.jpg`, `before-events.jpg`
(main, before the pass); `rest-high-playground.jpg`, `acts-high-playground.jpg`,
`events-high-playground.jpg`, `wave-high-playground.jpg`, `squall-lightning-high-playground.jpg`,
`low-playground.jpg`, `minimal-playground.jpg`, `webgl2-playground.jpg`; `ingame-*.jpg` (the played
run); `icon-512.png`.

**Icon.** Re-baked from the new picture: `?effect=cosmic-noir&t=41.2&icon=1&iconFov=37&quality=Extreme&grain=0`
in a 720 × 720 window, the canvas itself (not a screenshot), centre square at 92 % dropped 3 %,
luminance only, black point 0.05, the 1.35 power, gain 1.75, a disc of 512.

## 9. Open

Nobody has watched it move: every judgement above is from stills and from numbers.

The owner's calls:
- **The sea is water now**, with the smoke as weather on it. This is the largest change of
  character in the pass.
- **The print's tones** are a third of what they were (sepia and cyanotype are a breath, not a
  colour). `STOCK_TONE` is the one number.
- **The weather**: five acts and their order, the rain's weight in the squall, how often lightning
  falls (and that hot play brews a storm at all).
- **Four lines**: the flashbulb is kept as it was (a white frame for a few frames) and the great
  wave added. Whether both are wanted.
- **The burst's look** at full size: its water is torn flakes; in stills they can read as blossom.
- **The rock** is low and wet; **the pieces** are lighter greys in two papers' tones.
- **The fog act** flattens the sea to a grey sheet.

Not checked: the checks listed as not done in §7; the phone lens (the galaxy is outside it, as
before); sound (a breaking wave, thunder and rain are silent).
