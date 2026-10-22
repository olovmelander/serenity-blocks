# Odyssey chapter audit — 2026-10-22

**A record.** Olov: *"I love odysseymode how it looks! But now i want you to continue to audit all
chapters in odyssey mode to really make sure the environments, visuals and graphics in odyssey
mode feels amazing!"* This followed the same day's chapter 6 pass, *"it feels like the black hole
drifts, i want it to be locked at the journey path we are moving on"*. That pass is recorded in
[ODYSSEY_CH6_COMPOSITION_2026-10.md](ODYSSEY_CH6_COMPOSITION_2026-10.md#2026-10-22--the-hole-rides-the-path)
and summarised below.

## How it was run

- **Gallery.** All eight chapters were captured in the real game. Each chapter had eight
  stations (local 0.02, 0.15, 0.30, 0.45, 0.60, 0.75, 0.88, 0.98), phase-locked
  (`--time 9 --env-time 30`). Settings were WebGPU, High, 1280×720 and pixel ratio 1, using a
  preload-patched copy of `scripts/odyssey-chapter-capture.mjs` against a private dev server.
  That makes 64 frames before and 64 after, with no console or WebGPU errors in either set.
- **Bisects.** The harness's `--hide=<name>` flag found which mesh owns a defect. Pixel
  statistics (mean colour, luma p10/p50/p90 of a region) decided what was flat and what was
  merely dim. Each fix was re-captured at its stations before moving on.
- **Seams.** Each touched seam was captured (`--seam`) and scored with
  `scripts/odyssey-seam-luma.mjs` before and after.

## What the gallery showed

| Chapter | Read | Verdict |
|---|---|---|
| 1 Earth Core | A great lava-lake opening and a lit shaft. Then, from local ~0.6, a flat olive "hole" up the shaft and featureless brown, then grey, fog for the last quarter. | **Fixed** (the steam) |
| 2 Deep Ocean | Atmospheric shafts and marine snow, but dark blurred blades at the frame's edges through the deep half. They read as smudges on the lens. | **Fixed** (the far ceiling) |
| 3 Surface World | A coherent stylised island: the cone, the flowers and the rainbow. An autumn crown near the lens at 0.6–0.75 is a saturated red blob. | Style; left |
| 4 Mountains | Holds up. The climb looks up the face at the end of the chapter (known: L27/L28). | Left (camera-rig item) |
| 5 Sky | The summit snow is a smooth white plaster cone at close range. The departure, twilight and aurora are lovely. | **Open** (see below) |
| 6 Space | Strong composition. The hole drifted against the rail, and the near nebula read as a cotton ball. | **Fixed** (both) |
| 7 Black Hole | A strong approach and warp. The city's lit window grids showed over the tunnel at local ~0.88, before its mouth opens. | **Fixed** |
| 8 Urban | Holds up: the neon canyon, the signs and the Retrosun. | Left |

## The fixes

### Chapter 1 — the steam climbs toward light (`composition/odyssey-steam-quench.js`)

The shell's average brightness is pinned to the cavern's (the luminance cap that keeps the 1→2
seam smooth), so the fix had to add form, not light. Pixel statistics found three causes of the
olive, flat look:

1. **A per-channel `min(0.96)` before exposure.** Where the eye looks up the shaft, the aperture,
   rays and billows sum past it. Red clipped first while green kept rising, so the fire-lit
   vapour came out tan and olive: a flat plateau exactly where the light should be. It is now a
   luminance soft shoulder that keeps the hue.
2. **A hard post-exposure ceiling.** The whole opening sat above it, compressed ~5×. It is now a
   knee, and the headroom went from 2.4× to 3.6× the cap.
3. **Too little structure for the exposure to keep.** Several changes:
   - darker smoke in the gaps (sooty ember on the warm side, sea-teal on the cool side) with less
     density lift (0.5 → 0.35)
   - backlit rims on the billows
   - rays that are visible (0.16–0.40, they were 0.05–0.15)
   - stronger streaming wisps (the climb's motion)
   - a hot core dimmed by the billows in front of it
   - less of the structureless broad aperture glow

   The added light is folded into the exposure reference (`STEAM_QUENCH_LIGHT_SHARE` 1.08), so
   the frame's median holds: local 0.6/0.75/0.88/0.98 measured 25/56/78/85 before and
   26/55/76/88 after.

A bisect showed that from local ~0.66 the next act's deep-ocean world draws behind the shell (by
design: the steam hides the hand-off), and that the grade only starts leaving chapter 1 at the
very end (`seamProgress` is smootherstepped), so neither was the olive's source.

**1→2 seam:** maxStep 29.7 → **25.9** luma per 0.01 p (limit 45). The climb's whole curve is
within ~3 luma of before.

![Chapter 1 late climb, before (top) and after (bottom), local 0.60/0.75/0.88/0.98](images/odyssey-audit-2026-10-22/ch1-steam.jpg)

### Chapter 2 — the far ceiling is calm (`world/odyssey-world-renderer.js`, water underside)

Hiding meshes one at a time found the blades in the water's own underside. Snell's window test
read the full swell normal on a ceiling 200–400 u away, so the swell pushed patches back and forth
across the 0.60–0.72 threshold. Waves that far off average out. The window's normal now flattens
toward vertical between 40 u and 180 u of **3-D** eye distance (the column looks straight up, so
the horizontal range overhead is ~0). Near the surface, the rippled rim and the caustic light are
untouched. **2→3 seam:** maxStep 36.1 before and 36.1 after, identical. The 1→2 seam was
re-scored after it: 25.9.

![Chapter 2, before (top) and after (bottom), local 0.15/0.30/0.45](images/odyssey-audit-2026-10-22/ch2-deep-water.jpg)

### Chapter 6 — the hole rides the path; the near nebula frays (`chapter-environments/cosmic-expanse.js`, `odyssey-nebula-field.js`)

- **The hole** (the earlier pass, recorded in the ch6 doc). It is placed in the spine's frame at
  the progress the eased eye stands at (`resolveOmenPathPlace`, and the camera controller's new
  `followProgress` published by the board). It holds one place against the rail all chapter and
  lands exactly on chapter 7's lock. In game it now stays on a fixed screen mark at every station.
  Before, it slid round the mark.
- **The nebula.** Its silhouette came from the first gas octaves, which are smooth across the
  whole mass, so its edge drew an oval. One more lattice octave (one texture fetch per nebula
  fragment) now erodes the outer shell only, by (1 − thickness), so the rims tear into lobes and
  wisps and the heart is untouched.

![Near nebula, before | after at local 0.60, before | after at 0.88](images/odyssey-audit-2026-10-22/ch6-nebula.jpg)

![The hole against a fixed screen mark, before (top) and after (bottom)](images/odyssey-audit-2026-10-22/ch6-black-hole.jpg)

### Chapter 7→8 — no city windows over the tunnel (`urban-dreams.tsl.js`)

The nearest towers fade in under the warp tunnel. Their window grids drew over its streaks before
the city was meant to be seen, an open item from the ch8 overhaul. The facade's lights (windows,
trim, ledges) are now multiplied by `seamReveal`, the 7→8 carry's mouth schedule that the signs,
lanterns, skybridges and traffic already ride. Chapter 8 proper is unchanged, because
`seamReveal` is 1 outside the window. **7→8 seam:** maxStep 20.5 before and 20.5 after, at a
station outside the window.

![Chapter 7 at local 0.88, before | after](images/odyssey-audit-2026-10-22/ch7-tunnel.jpg)

## Tried and reverted

**Chapter 5's summit, wind crust and glints.** Close-range sastrugi (a normal tilt plus a
crest/trough value shift) and view-dependent ice glints were tried on the near snow, gated by a
3-D footprint. Two results:

- At a believable amplitude the crust was invisible, because the snow sits in the ACES shoulder,
  where a ±5 % change is one or two display levels.
- Exaggerated to prove it was active, it drew as a regular ladder of horizontal stripes.

The camera is 100–300 u from the cone at these stations, too far for glints. Reverted.
**The real lever is the snow's place on the tone curve.** It is white enough that its lit detail
is compressed away. Moving it means re-balancing the mountain's exposure from afar and the 5→6
seam, a pass of its own.

## Still open

- **Chapter 5's summit** — see above.
- **Chapter 2's mid-water** is atmospheric but sparse. The whale shark and manta pass on their own
  clocks (38 s / 64 s) and are not in every frame; a frozen-clock gallery shows the water without
  them.
- **Chapters 3–5's painted style** (tree crowns, sticker clouds) is a style, not a defect; left.
- **The chapter 7 rail** crosses the hole's right side as a thin line when seen from chapter 6
  (the 6→7 hairpin, the real path). The hole cannot sit on it: chapter 7 keeps the hole
  camera-locked. Hiding the path beyond the seam while in chapter 6 would make the rail
  disappear into the hole. That is an owner call.

## Cost

- **Steam quench:** ALU only (a luminance dot, two soft shoulders, a rim band). It is one
  full-screen layer that exists only across the 1→2 window.
- **Nebula:** +1 lattice texture fetch per nebula fragment (the masses' additive hulls).
- **Water underside:** one `length` and one `normalize`/`mix` per ceiling fragment, inside the
  submerged branch.
- **Facades:** one multiply.
- **Chapter 6 hole:** one spine-frame evaluation per frame on the CPU (it was a cached point).

No new draws, pipelines or textures. GPU timings were not taken: the machine's GPUs are shared by
parallel sessions, and these deltas are below what an interleaved A/B can resolve under that load.

## Verification

- Tests: `tests/unit/odyssey-ch6-hero-framing.test.js` (the path lock; it fails on the old
  placement at the first station, 0.35 off the lock) and `tests/unit/odyssey-camera-controller.test.js`
  (`followProgress` names where the eased eye stands).
- All 200 Odyssey test files pass except `odyssey-level-briefing`, which fails identically without
  these changes. `odyssey-forest`'s bake-budget timing test failed under load and passes alone.
- `tsc`, the ts and lint ratchets, the architecture fitness ratchets and `depcruise` pass. The
  two lint errors in `OdysseyBoardController.js` (no-nested-ternary at lines 1437 and 4590) are
  pre-existing.
- Seams: 1→2 PASS (25.9), 2→3 PASS (36.1, unchanged), 7→8 PASS (20.5, unchanged).
