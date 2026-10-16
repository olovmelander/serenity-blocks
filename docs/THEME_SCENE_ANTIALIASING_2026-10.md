# Scene antialiasing in ten themes (2026-10-16)

Olov found the edges of High Coast's trees and islands "not as high resolution" as Sky Children's,
and asked for the same fix in High Coast, Fall, Forest, Golden Forest, Midsommar (`summer`),
Moonlit Greenhouse, Sakura Twilight, Shifting Sands, Stillwater and Verdant Hills.

## What was wrong

Every one of these themes draws its scene through a post stack: `pass(scene, camera)` into a
render target of its own, graded, then one full-screen quad to the canvas. The renderer's
`antialias` option only multisamples the CANVAS, which receives that one quad, so it never
reaches the picture. Sky Children's pass takes 4× MSAA from High up (`samples: 4`); here:

| Theme | Before | Why it read as low resolution |
|---|---|---|
| High Coast | `samples: 0`, no FXAA, any tier | Every edge one sample per pixel: trunks, islands, 22 000 tree crowns, the pine's alpha-tested needles |
| Fall, Forest, Golden Forest, Midsommar, Sakura Twilight, Verdant Hills | `samples: 0` + FXAA on every post tier | FXAA softens the whole frame and still steps on thin trunks, needles and grass. Low and Minimal draw straight to the canvas, which IS multisampled: the higher tiers had the worse edges |
| Shifting Sands | MSAA only on Ultra and Extreme, no FXAA | High and below had no antialiasing at all |
| Stillwater | MSAA from High up, then "the brush" (a Kuwahara wash) | Each pixel takes the mean of whichever 3 × 3 quadrant round it is calmest; along a silhouette one quadrant always lies wholly on one side, so the brush redrew every edge on the pixel grid (2-3 px steps). Medium and Low had no antialiasing |
| Moonlit Greenhouse | MSAA from High up, FXAA on Medium | The leaves, the lattice and the moths are cut-outs: a discard covers a whole pixel, so MSAA does not smooth them. Low had no antialiasing |

The display here runs at a device pixel ratio of 1 (1600 × 900, see the machine memory), so no
supersampling hides it either. The pixel-ratio caps were the same as Sky Children's or higher.

## What changed

`src/themes/shared/scene-antialias.js` holds the one table: `sceneSamples(quality, antialias)` is
4 on High, Ultra and Extreme with the game's Antialiasing setting on, else 0.

| Theme | High and up | Medium and Low |
|---|---|---|
| High Coast | 4× MSAA; the pine's needles cut out by three's `alphaTest` + `alphaToCoverage` (the same threshold sharpened to a pixel) | FXAA |
| Fall, Forest, Golden Forest, Midsommar, Sakura Twilight, Verdant Hills | 4× MSAA, no FXAA over it; the shadow-rig prime target and the lake mirrors (Golden Forest, Midsommar, Sakura) take the same sample count | FXAA as before (Medium); Low and Minimal unchanged |
| Shifting Sands | 4× MSAA (High added) | FXAA |
| Stillwater | MSAA as before; the brush fades out where a hard edge crosses its window (busiest minus calmest quadrant variance, `smoothstep(0.0015, 0.008, …)`), so silhouettes keep the MSAA and washes inside forms are untouched; the tarn mirror takes the pass's samples | FXAA |
| Moonlit Greenhouse | MSAA as before plus FXAA over it, for the cut-out edges | FXAA (Low added; Medium as before) |

Rules that came with it:
- A material drawn into targets of two sample counts compiles two pipelines. The mirrors
  (`reflector({ samples })`) and the forest family's shadow-rig prime target follow the pass, so
  the pipeline count is what it was (STATIC_STARTUP_AUDIT P3); Stillwater's ~23 duplicate
  pipelines are gone the same way.
- Multisampled depth still feeds `GodraysNode`, High Coast's shafts and Verdant Hills' cloud
  march: three loads it per sample (`texture_depth_multisampled_2d`).
- With the Antialiasing setting off nothing new is added: no MSAA, and no new FXAA. Each theme
  keeps what it had before (the forest family its FXAA, Stillwater and Moonlit Greenhouse their
  MSAA).
- Alpha-to-coverage only after a capture: Moonlit Greenhouse's authors measured it turning
  sub-pixel leaflets into a grey screen door on this machine and turned it off; on High Coast's
  pine the crops show smooth needle edges and no stipple, so it stays there.
- The playground's `msaa=<n>` reaches all ten effects (the forest family on the shared entry,
  High Coast with an entry of its own), so a capture can compare 0 and 4 on one build.

## Evidence

**Captures** (RTX 3070 laptop, WebGPU, 1600 × 852, `t=10`): every theme at High from the branch
and from `main` side by side, plus the tiers that gained FXAA (High Coast, Stillwater and Shifting
Sands at Medium, Moonlit Greenhouse at Low). Crops enlarged 3× by pixel replication show the
steps on trunks, branches, needles, island tree lines, the butte and Stillwater's trunks gone, and
the forest family's FXAA blur gone with them. No console error or WebGPU validation message on
any shot; Forest, High Coast and Stillwater also drew on the WebGL2 backend with MSAA.

**Frame rate in the real game at the owner's cap** (120 fps; the panel's rAF is ~131 Hz, so a held
cap reads ~130), Single Player at High, a switch in play from Aurora, then 6 s at rest and two 8 s
storms of locks, drops, clears, combos and T-spins (the play-feel probe of
THEME_PERF_FLEET_2026-10.md §9). Two rounds per arm, before (`main`) and after (this branch) in
alternating order:

| Theme | At rest: before / after | Storms: before / after |
|---|---|---|
| High Coast | 129-130 / 129-130 | 114-129 / 128-130 |
| Fall | 129-130 / 130 | 130-131 / 130 |
| Forest | 129 / 130 | 130-131 / 130-131 |
| Golden Forest | 130 / 130 | 118-131 / 130-131 |
| Sakura Twilight | 130-131 / 130 | 129-130 / 118-130 |
| Shifting Sands | 130-131 / 131 | 130-131 / 127-132 |
| Stillwater | 131 / 130-131 | 129-131 / 130-131 |
| Moonlit Greenhouse | 130-131 / 130-131 | 129-131 / 130-131 |
| Verdant Hills | 126-129 / 125-128 | 107-128 / 109-131 |
| Midsommar (first pass, a loaded machine) | 76-96 / 88-94 | 88-103 / 89-103 |

Single dips (114, 117, 118 fps) appear in both arms alike: load from other work on the machine.
Midsommar was measured again with three rounds per arm on a quiet machine:

| Midsommar | At rest | First storm | Second storm |
|---|---|---|---|
| Before (`main`) | 129-131 | 129-131 | 117-123 |
| After (this branch) | 130-131 | 128-131 | 122-126 |

The second storm's dip is the theme's own effect work and is there without MSAA too. Verdant
Hills switched in play in a separate check: 130 fps at rest with MSAA and without; under storms
122 with MSAA and 128.5 without in one run each, while the two-round A/B above shows no
consistent difference (both arms ranged 107-131). Its rerun was stopped on the owner's call.

## Traps met on the way

- **A first A/B read High Coast at 1 fps and Verdant Hills at 1-31 fps with MSAA.** It was outside
  load in one four-minute window (both "after" runs fell into it back to back); the same build
  switched in play an hour later held 130 fps with MSAA on and off. Measure each theme in
  several alternating rounds and log the GPU's load per run before believing a regression.
- The first pass read Midsommar at 76-103 fps on `main` and on the branch alike; the rerun on a
  quiet machine held 129-131. One pass per arm on a busy machine can blame any theme.
