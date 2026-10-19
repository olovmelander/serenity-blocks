# Grainfields — performance pass (2026-10-19)

Goal (Olov): 130+ fps at **Extreme** on the RTX 3070 laptop, the look kept. This display's frame
cadence in Electron is ~131.6 Hz (see the machine notes), so "130+" means every vsync: a 7.6 ms
frame for CPU and GPU together.

## Result

Real game, Single Player, Grainfields pinned, Extreme, 1600×852 window, renderScale 1, 4× MSAA,
RTX 3070 Laptop on mains power. GPU time from WebGPU timestamp queries on every pass.

| | before | after |
|---|---|---|
| Extreme, vsync: fps through rest, a storm of clears, five level-ups (every hour) | 75–81 | **130.2–131.0** |
| Extreme, vsync: GPU ms a frame (p50, worst) | 11.5–12.6 | 5.1–6.0, worst 6.9 |
| Extreme, uncapped: fps / GPU ms | 85 / 10.7 | 155–157 / 5.4–5.5 |
| Ultra, uncapped | 93 / 9.8 | 165 / 5.0 |
| High, uncapped | 108 / 8.1 | 166 / 4.1 |

The theme's CPU (its whole `stepFrame`, three's encoding included) stays at ~2.5 ms a frame. One
100 ms hitch in ten five-second windows around level-ups is not the theme's: its long-animation-
frame record holds 6 ms of script and its frame and GPU times are normal (the original code, at
80 fps, hides such a hitch in its own unevenness).

## Where the time went

Removing one part at a time (uncapped, before): the barley **8.6 ms**, the shelterbelts 1.1 ms,
everything else (sky, land, Lapporten, herd, geese, beams, motes) inside the noise; the post (the
light in the air at half resolution, bloom, output) 0.6 ms. With the barley's colour made trivial
the scene fell from 10.5 to 4.0 ms; making its vertex stage trivial changed nothing. So: pixels.
Some 64 000 clumps of ribbons a pixel or two wide (4 M triangles) each light every 2×2 block they
touch, the field behind the crest's near rows is drawn many times over, and under 4× MSAA the
stems' alpha-to-coverage alone cost ~1.4 ms.

## What changed

All in `grainfields-grain.js` unless named. Savings are scene-pass GPU ms at Extreme, uncapped:
the first four each measured alone against the original, the last two on top of the first four.

| change | saved | picture (playground, same frame, 10 views) |
|---|---|---|
| clumps drawn nearest first (sorted once: the eye never moves) | 2.2 ms | identical |
| what is constant over a clump (tone, sheen, sun through the deck, events) or linear along a plant (the air: `aerialParts` in `grainfields-light.js`) lit per vertex | 1.4 ms | no pixel over 2/255 off but a few isolated ones |
| a pixel the coverage drops is not lit (a branch round the colour) | 0.5 ms | identical |
| bands by distance (`GRAIN_BANDS`): stems and ears with fewer rows beyond 8 m and 17 m | 0.8 ms | sub-pixel outlines: 2–10 % of pixels move > 2/255 |
| shelterbelt bark beyond 320 m is its stems alone (`BARK_LIMBS_TO`, `grainfields-forest.js`) | 0.2 ms | 0.01–0.8 % of pixels |
| under MSAA the stems are drawn opaque, apart from the ears (`STEM_CUT`) | 1.4 ms | see below |

**The stems.** With alpha-to-coverage a stem kept less than its ribbon: the coverage's soft edge
dropped about a fifth of a pixel from each side, and on stems a pixel wide or less it left a
dithered speckle of the dark stand floor between the plants. Opaque stems are cut to the part of
the ribbon the coverage kept (|w| < 0.925, with the normal the full ribbon interpolated there) and
trimmed 0.2 px a side, so the stand's tone matches (mean signed difference within ±0.3/255 in the
storm, the dusk and the event frames, +0.7 and +1.2/255 in the golden hour and the morning). What
cannot match is the dither: 15–26 % of pixels move by more than 2/255. Up close the old stand is
grainier and the new one draws its stems as clean thin lines; at the size the game shows it the
two are hard to tell apart (scratch `.cache/grain/perf/sheet-ab.png` in the worktree: the golden
hour and the morning, before | after). The clean edges should also shimmer less as the barley
sways.

## Tried and dropped

- A depth pre-pass of the barley (colour pass at `depthWrite` off, alpha-to-coverage kept):
  pixel-identical, **slower** (+1.4 ms) — the cost of alpha-to-coverage here is in writing partial
  sample masks on millions of thin stems, not in lighting hidden ones.
- Alpha-to-coverage off everywhere (a plain mask): −2 ms, but floored stems break into dotted
  lines (a pixel kept only where its centre lies on the ribbon).
- Culling clumps outside the frame (the vertex stage is cheap): −0.04 ms.
- The trees' deck shadow per vertex, spray order, thinner far crowns, drawing sprays before bark:
  no measurable change (the belts are bound by triangles, ~2 M foliage).
- 2× MSAA: WebGPU allows 1 or 4 samples only.

## How it was measured

Scratch tooling in the Grainfields worktree, `.cache/grain/perf/` (not in the repo):

- `probe.mjs` — Electron on a dev server: boots the game, pins the theme and settings (reloading
  once when render scale or antialiasing change, since both are read at start), wraps the theme's
  `stepFrame` and its parts, and reads rAF intervals, presents, long animation frames, and GPU ms per
  pass through `gpu-ts-inject.js` (timestamp queries added to every render pass, keyed by target).
  `--uncapped` adds `disable-gpu-vsync` + `disable-frame-rate-limit`. Variants are URL queries,
  plus `rs=`, `q=`, `aa=0` tokens.
- `make-jobs.mjs` + `.cache/grain/batch-capture.mjs` — playground captures of the same frame
  (`t=30`, five hours, a clear, four lines, close-ups of near ears, the mid field and two belts);
  `diff.mjs` (per-pixel stats, heat map, `--rect=`), `crops.mjs`, `sheet.mjs`.
- `table.mjs` — one line per variant and phase.

Every GPU run held the shared GPU lock; the machine was on mains power.
