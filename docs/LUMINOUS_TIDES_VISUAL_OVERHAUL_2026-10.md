# Luminous Tides — the glowing shore

Implemented 2026-10-13 on `feature/luminous-tides-masterpiece`, with Three.js 0.186.1. A from-scratch
rebuild in place: it replaces the earlier theme in full (a classic `WebGLRenderer` scene with an
`EffectComposer`, a `ShaderMaterial` Gerstner plane, point-sprite plankton and a bloom pass, whose
picture was an almost black sea under a black sky with faint cyan patches). The id, the name, the
song and the Odyssey orb (7) stay. The rebuild keeps the theme's subject, a sea that glows with
bioluminescent plankton, and takes it ashore: the owner's reference photographs were of glowing
surf on a night beach, so that is the picture. This document records the shipped design and what
was verified. It is a reference, not a backlog.

## The picture

A night beach, seen standing on wet sand at the edge of the swash. The sea in front of the eye is
full of dinoflagellates that flash blue when the water is shaken, so it is dark wherever it is calm
and alight wherever it is torn: the lip of each wave as it breaks, the foaming bore it turns into,
the leading edge of the swash running up the sand in lobes, the lace the backwash leaves on the wet
sand, and every drop that falls into it. That light is mostly sparks, tiny points at three sizes,
more of them lit the harder the water is shaken, with a fainter glow following the foam's threads.

The shore runs from the foot of the frame out to a vanishing point in the margin right of the card:
the open sea and its diagonal lines of surf fill the left and the middle; the beach curves away on
the right under a dark tree line of palms and low jungle to a forested headland. Low over the sea on
the left lies a far coast whose town glows warm in the cloud over it and lays the long streaks of
its lamps on the calm water beyond the surf (the warm-against-electric-blue contrast of the
reference photos). Overhead, cloud lit orange from beneath, or stars and the Milky Way.

The card stands in the middle of the frame. The horizon stands at 40 % from the top (30 % on a tall
screen, with the eye turned a little toward the sea), so the water and the beach are most of the
picture, and everything that happens beside the card happens on water the frame shows.

## The one idea

**The sea answers the board with its own light.** Everything the board does disturbs the water, and
disturbed water glows: a lock is a drop falling into the surf, a clear is a wave thrown at the
shore, a chain is rain. Nothing glows that the plankton would not make glow.

## Event language

| Play | The shore |
| --- | --- |
| Lock | A drop of the piece's colour falls out of the night into the water beside the card (on the side its column is nearer; a piece low on the stack falls into the near swash, one high up falls out in the surf), bursts in a crown of glowing droplets, the first of them in the piece's colour and the rest in the sea's blue, with a jet climbing out of the middle; the water round it flares into sparks and dies away. A drop on the right falls on the wet sand of the swash zone (dry sand has no light in it). |
| Hard drop | The drop falls from higher and lands harder: a taller crown, more droplets, a wider flare. |
| Clear | The sea throws a wave of light for every line, one after another: each stands up beside the card glowing from within, breaks (the break running along the shore both ways from beside the card, a curtain of glowing spray thrown off its lip), and runs in as a bore and up the sand as a swash. |
| T-spin | A shoal of fish darts through the shallows, each streaking light behind it. |
| Four lines | A great set wave (2 m) stands up out in the bay, glowing from within above the horizon, breaks along the whole shore in a curtain of spray and floods the beach to the eye's feet. |
| Perfect clear | The same, and the whole bay lights to the horizon for a while. |
| Chain of clears | Rain: a sprinkle at two, a shower at four, a downpour from six; every drop is a spark and a ripple on the sea and the wet sand, big drops near the eye throw small crowns of their own, streaks fall past the lens, the cloud thickens and the stars go. It eases off when the chain breaks. |
| Level up | The night turns one step further (below), eased over 4.5 s, and the bay shimmers once. |
| The clock, with no play at all | **The night turns by itself, slowly, whatever the level**: one step every 100 s, on its way 70 % of the time (`wheel = clock / 100 + levels gained`, a rest of 0.15 at each end). A level adds a step on top of where the clock has carried it, so the light never waits for a level. |
| New run | The drops, waves, shoal and rain go; the night goes on from where it was. A rebuild in place (a quality change, a lost device) hands the clock, the level and the wheel over whole. |

## The nights

Six nights on a wheel, in the order it turns (`NIGHTS` in `luminous-tides-core.js`). The sea's light
goes round its hues in order (cyan, azure, blue, cobalt, teal, sea-green) so two neighbours never mix
through grey; it leads each turn a little and the sky trails it.

| Night | The sky | The sea's light |
| --- | --- | --- |
| Afterglow | The last of the sunset low over the far coast, lavender above, cloud lit amber | cyan |
| Harbour | Full night, a low cloud deck lit orange from beneath by the town | azure |
| Starfield | Clear and moonless: stars and the Milky Way, the town a faint band | electric blue |
| Deep | Overcast and dark, the cloud's base faintly warm | cobalt, at its brightest |
| Blue hour | Before dawn: deep blue, a violet glow low on the right | teal |
| Sea mist | Mist over the water, the town's lamps haloed, the glow diffused | sea-green |

## How it is built

| Module | What it is |
| --- | --- |
| `luminous-tides-core.js` | Three-free: the shore's frame (`toShore`, `fromShore`: along-shore `a`, across `s`), the ground's profile, the surf (one train of crests with a warped phase, a hash-and-set height per crest, break lines over a wandering sandbar, a bend along each crest, the CPU twin `surfHeight`), the swash (ballistic run-up), the six nights and their wheel, the noise bakes |
| `luminous-tides-tsl.js` | The night sky as one function of a direction (`skyColour`: air, the warm glow, the far coast and its lamps, the cloud deck lit from beneath, stars and the Milky Way) and the shore's pure helpers laid out once (`lt_shoreOf`, `lt_sandOf`, `lt_surfPhaseOf`, `lt_crestOf`, `lt_breakOf`, `lt_swashOf`, `lt_lampField`) |
| `luminous-tides-shore.js` | The hero: one fan mesh round the eye's foot carries the sea and the beach; the vertex stage stands the crests and the board's waves up; the fragment draws the water (its mirror of the night, the lamps' streaks), the sand (grain, wind ripples, a wrack line, wet gloss) and the light (lip, bore, foam, swash edge, backwash lace, rain, splashes, the board's waves), as sparks (`lt_sparkLayer`, three sizes) over a glow that follows the foam |
| `luminous-tides-land.js` | One upright strip along the back of the beach: canopy, palms (curved trunks, drooping fronds), the headland, nearly black against the night |
| `luminous-tides-spray.js` | Three-free: the spray off every breaking lip, solved in closed form from the moment each crest reaches its break line along each strip of shore, and along the board's waves' peel |
| `luminous-tides-glows.js` | One additive layer of camera-facing glows (droplets, falling drops, spray, the shoal) that stretch into streaks along their velocity; and the rain streaks (closed form) |
| `luminous-tides-world.js` | The world: uniforms, the event tables (splashes, waves), the camera rig, the wheel, the board's events |
| `luminous-tides-post.js` | One scene pass, hue-preserving bloom (Medium and up), calm zones over card and HUD, a hue-preserving filmic curve, the night's grade, vignette, grain, FXAA |
| `luminous-tides-frame.js` | Where the horizon stands, where a drop falls beside the card |
| `luminous-tides-theme.js`, `-director.js`, `-composition.js` | The adapter, the event stager and the layout reader, cloned from Sunset |

Nothing is loaded: every texture is baked on the CPU at build (two RGBA noise fields).

## Tiers

Every tier keeps the whole picture and every event (`luminous-tides-quality.js`): tiers cut the fan
mesh, ripple layers, spark sizes (1 to 3), cloud slices, the mirror's cloud, pool sizes, rain
streaks, spray and palm density. Bloom from Medium up.

## Reproduce

Playground: `playground.html?effect=luminous-tides&t=24&night=2&quality=High&board=1`, plus
`event=lock|drop|clear|quad|tspin|perfect|levelUp&eventAge=<s>` (`lines`, `row`, `u`, `color`),
`combo=<n>` (rain from two), `level=<n>`, `night=<0..6>`, `locks=<n>`, `parts=sky,shore,land,glows,rain`,
`falseColor=1`, `noPost=1`, `P.<TUNE name>=<value>`, `icon=1`.

The icon is the moment the great set wave breaks under the harbour night's town glow:
`t=30&night=1&quality=Ultra&icon=1&iconYaw=0.3&iconPitch=0.04&iconFov=34&event=quad&eventAge=2.05`,
captured square (the window gave 1400 × 852), centre-cropped at x 0.45, lifted (saturation 1.18,
contrast 1.1, brightness 1.08) and cut to a 512 px circle on a transparent ground. A positive
`iconYaw` turns the lens to the left (toward the sea).

## Verification

Pictures: `docs/luminous-tides-overhaul/nights.jpg` (the six nights, playground, WebGPU on the
RTX 3070, board mock on), `ingame.jpg` (the real game on WebGPU: rest, hard drops, a two-line clear,
a chain in the rain, four lines at 0.7 s and 2.2 s), `drift.jpg` (the clock alone, below).

- **Playground**, WebGPU (RTX 3070, `nvidia ampere`) and the WebGL2 backend (RTX and SwiftShader):
  every night, every event at several ages (`lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`,
  `levelUp`, a held chain of six), the Minimal and Low tiers, `falseColor=1` (only the sparks and
  the wave cores pass the bloom knee), a phone frame (390 × 844) and a wide one. Clean consoles.
- **The real game**, single player on the dev server with real hard drops and the app's own bus
  (clears, a chain of seven, four lines, level 2, a live High → Medium rebuild, switching away):
  WebGPU on the RTX (about 125 fps, the display's cap, an observation on a loaded machine, not a
  measurement) and the WebGL2 backend (about 130 fps); both clean, the rebuild keeps the clock, the
  level and the wheel (1.50 → 1.54), switching away leaves Forest and no canvas behind.
- **The clock alone** (`luminousTidesFixedDt=100`, level 1, no clears): the wheel ran 0.11 → 3.60
  over 360 s of the theme's clock, afterglow → harbour → starfield → deep → blue hour.
- **The phone validator** (`scripts/validate-mobile-webgl2.mjs`, software WebGL2): pass at Low and
  Minimal; its portrait, landscape and effects pictures read clean.
- **Tests**: 135 theme tests in six files (core, world, director, composition, theme shell with the
  real world and post at every tier, the shader gate: every material built by the WGSL and the GLSL
  node builders at High and Minimal, no warnings, each stage under 64 KiB, laid-out helpers pure).
  Full suite 888 of 891 files; the three reds are this machine's known ones (the TTS recorder's
  symlink EPERM, the Swedish-locale briefing, the Odyssey cloud-field bake budget under load, which
  passes alone 12/12).
- **Gates**: lint 0 errors in the new files, lifecycle audit, import boundaries, palette gate (64
  palettes, 0 matches, 0 warnings: the legacy format warning is gone), URL catalogue test.

Not done: a perf-lane reading; a real phone; the multiplayer and Odyssey layouts were not captured.
The icon was chosen from SwiftShader renders (the WebGL2 backend of the same code and post).
