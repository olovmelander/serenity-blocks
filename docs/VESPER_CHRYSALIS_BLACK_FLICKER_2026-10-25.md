# Vesper Chrysalis: the black flicker as it starts (2026-10-25)

**A record.** The report, with a screenshot from Serenity mode: "Vesper Chrysalis theme flickers
in black on the full screen when starting it". The screenshot showed the left two thirds of the
frame black, the edge to the scene stippled, the lake and crystals on the right still drawn.

This is a second cause, separate from the forced resizes fixed in
[STILLWATER_FAR_TREES_AND_VESPER_FLASHES_2026-10-23.md](STILLWATER_FAR_TREES_AND_VESPER_FLASHES_2026-10-23.md).

## How it was checked

Real game in Electron 44 on the RTX 5080 (`force_high_performance_gpu`), a private Vite server, a
shown off-screen 1920 × 1200 window. Two scratch harnesses:

- **Film:** boot, save Vesper as the background, start Serenity mode (or start it on Forest and
  switch to Vesper as the world arrows do), capture the page every ~30 ms for 12 s, and read back
  the scene pass and the bloom's targets after every frame Vesper draws, counting texels whose
  half-float exponent bits are all set (Inf or NaN).
- **Sweep:** stop the theme's loop, step the world to fixed times (`seek(t)`, then one frame), and
  count non-finite texels in the scene pass; with every part, without each part, and each part alone.

## What happened

- From world time 1.1 s to 5.1 s after the theme starts, 1 to 6 scene pixels came out **+/-Inf in
  all three channels**, on the silhouette of the left stand's small crystal (about x 9 %, y 58 %).
- The bloom's bright pass reads four taps and keeps the hue with `c · min(1, 7 / max(c))`. For an
  Inf tap that is `Inf · 0 = NaN`; `max(tap, 0)` before it does not help, Inf is not negative.
  The blur chain carried the NaN through every mip: **349,920 non-finite texels**, the bloom
  output's left 75 %, from one scene pixel.
- The output pass adds the bloom and the heart shafts (the bloom sampled along the ray to the
  chrysalis, at a per-pixel random offset). Every pixel that touched the NaN went black; the
  shafts' random offsets made the stippled edge. In the capture the frames went **wholly black**
  (mean luma 2.3 against 73) and back to the scene, over and over, for about 4 s.
- It is not only at the start. Sweeping world time 0 to 240 s in 0.25 s steps: **101 of 961
  times** had the Inf pixel, in bursts at 1–4.5, 25–28, 60–64, 80–84, 125–131, 168–171 and
  192–201 s. The start always lands in the first burst, since the clock starts at 0.
- Bisect: without the spires, 0 hits; the spires alone, all of them.

## The cause

The crystals are flat-shaded; each triangle carries its barycentric distance to the facet's
edges (`vSpireEdge`), for the hairline glint along an edge and a light falloff toward it,
`thinner = exp(-7 · toEdge)`. Inside a facet `toEdge` is 0 to 1.

At High and up the scene pass has 4× MSAA. A pixel on a triangle's edge is shaded once at its
centre, even when the centre lies off the triangle, and its varyings are then extrapolated. On a
facet seen almost edge-on, a sliver on screen, a pixel's width off the triangle is many times the
triangle's own width in barycentric terms: `toEdge` runs far negative, and `exp` of it overflows
the half-float scene target (65,504). The camera's slow sway turns that facet edge-on now and
then, which is why it came in bursts. The 2026-10-24 audit
([THEME_NAN_AND_SEAM_AUDIT_2026-10-24.md](THEME_NAN_AND_SEAM_AUDIT_2026-10-24.md)) hunted the
same MSAA extrapolation under `pow`, `sqrt` and `log`; this is its sibling under `exp`, an Inf
rather than a NaN.

## The fix

1. **The source** (`vesper-chrysalis-shore.js`): `thinner = exp(max(toEdge, 0) · -7)`. Inside a
   facet nothing changes; off it the falloff is 1, its value at the edge.
2. **A guard** (`vesper-chrysalis-post.js`): the post reads the scene finite, an Inf or NaN texel
   as black, in each of the bloom bright pass's four taps and in the output pass after the
   fringe's taps (`vc_finiteRgb`). The test is on the bits (exponent all ones), since WGSL has no
   `isNan` and a compiler may fold `x != x` away; it compiles to `bitcast<u32>` in WGSL and
   `floatBitsToUint` in GLSL. So one bad texel from any part, now or later, stays one pixel.

## Measured

| Run (RTX 5080, 1920 × 1200) | Before | After |
|---|---|---|
| Sweep 0–240 s, High: times with a non-finite scene texel | 101 / 961 | **0 / 961** |
| Start Serenity on Vesper, High: frames read back with a non-finite texel (world time 0–10.6 s) | 65 of 189 | **0 of 213** |
| Same run: darkest page capture after the scene is up (mean luma, 0–255) | 2.3, black | **51.3** |
| Step Forest → Vesper in Serenity, Ultra: frames with a non-finite texel (world time 0–4.4 s) | n/a | **0 of 88** |
| Guard alone: every crystal pixel forced to Inf (120,178 texels) | n/a | bloom output **0** non-finite; the frame stays, the crystals black |

The crystals look as they did: the clamp touches only pixels shaded off a facet.

**Regression test.** `tests/unit/vesper-chrysalis-finite.test.js` compiles the spires and the
post for WGSL and GLSL: the facet falloff reaches `exp` only clamped at 0, and the output pass
and every tap of the bloom's bright pass read the scene through the bit test. All six fail on
the previous commit and pass now. All ten Vesper test files pass (277 tests).

## Not checked

- The integrated Radeon 610M, and Edge itself (the report's browser). The cause is in the shader
  maths, not the adapter, and the guard holds on either; but no capture was taken there.
- Other themes for the same `exp` class. A theme with three's stock bloom high pass keeps an Inf
  as the NaN that blacks out the frame, like this one did.
