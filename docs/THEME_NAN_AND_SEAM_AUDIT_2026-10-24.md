# Theme shader audit: NaN and mip seams (2026-10-24)

**A record.** This follows [THEME_SHADER_AUDIT_2026-10-23.md](THEME_SHADER_AUDIT_2026-10-23.md), which
fixed per-object values read interpolated. This round hunted two more failure classes from the
TSL guide that cause black flashes, specks and hairlines, across every theme and the Odyssey:
a power, root or log of a negative number, and the mip a texture read takes where its coordinates
leap. It also moves the last five themes off a raw window `resize` listener.

## 1. How a NaN becomes a black block

`pow(x, y)` is `exp2(y · log2 x)`. For `x < 0` it is undefined in WGSL and GLSL, and GPUs return
NaN. So do `sqrt` and `log` of a negative. `pow2`, `pow3` and `pow4` are products, safe for any sign.

What a NaN pixel then does depends on the theme's bloom:
- **three's stock bloom high pass** keeps the NaN, and its blur carries it through every mip.
  The composite's `max(0)` turns the whole footprint black: a block up to the size of the frame.
  Among those audited, Aurora, Crystal Cave, Wolfhour, Murmuration, Parhelion and the Odyssey
  use it.
- **A high pass that takes `max(tap, 0)`** stops the spread on D3D and Metal (WGSL leaves `max`
  of a NaN unspecified). The pixel itself still reads the scene colour, so it shows black or
  tinted.

A base goes negative in four ways, all found:
1. **By design:** a square or cube of a signed value, written as `pow(x, 2.0)`. It is safe only
   where the compiler happens to turn it into multiplies.
2. **Rounding:** `1 − dot(N, V)` of two unit vectors, about −1e-7 where a face looks straight
   at the eye.
3. **MSAA:** with a multisampled scene pass (High and up), a pixel on a triangle's edge is shaded
   once at its centre, even when that centre lies off the triangle. Its varyings are then
   extrapolated: a `uv()` runs past 0 or 1, furthest on slivers and at a cone's tip. The repo
   had already fixed this in five places, each with a comment (Chromadelic Highway's streaks,
   Geode's facets, Rainbark's strips, the Odyssey's skybridges and Earth Core's ley lines).
4. **`sin` of float32 π**, which is about −8.7e-8, under a fractional power.

## 2. What was fixed

Found by read-only passes over the code (themes a–g, h–r, and s–z with `src/rendering` and
`src/ui`), with a second pass for MSAA alone over each range. Every site was re-read before
changing it.

**Confirmed on screen** (see section 4 for how):

| Theme | Where | How | On a GPU | Fix |
|---|---|---|---|---|
| Aurora | Meteor trails (`aurora-sky.js`) | MSAA: `uv().x` below 0 past each trail's tail, under `pow(…, 2.4)` | A black block, up to the whole frame, on nearly every frame a meteor flies: 3-line clears, T-spins, combos of 3+, perfect clears, fevers (stock bloom) | `uv().x` clamped ([image](theme-shader-audit/aurora-meteor-tails.png)) |
| Lunara | Spires and pillars (`lunara-crystals.js`) | MSAA: `aFacet.y` past 1 one pixel above every spire's point, under `pow(1 − t, 2.6)` and two more; a pillar's top edge likewise | A dark speck or blotch at each spire tip, every frame | `t` clamped to [0, 1], as `geode-crystals.js` does; the pillar's base clamped ([image](theme-shader-audit/lunara-spire-tips.png)) |
| Summer | Reeds and bulrush heads (`summer-shore.js`) | MSAA: the head's `spike` ramp past 1 and a reed's root past 0 take a colour channel below 0, under `pow(…, 0.7)` | About 200 flecks a frame along the shore and, doubled, in the lake's reflection, High and up | `spike` and the colour saturated ([image](theme-shader-audit/summer-reeds.png)) |

**From the code, the same mechanisms:**

| Theme | Where | How | On a GPU |
|---|---|---|---|
| Golden Forest | Ribbons' edges, fireflies' tails, grass roots | MSAA (`pow(1 − across², 1.5)`, `pow(st.y, 1.6)`, a colour below 0) | A dotted black line along each ribbon (NaN · `uLevel` 0 is still NaN), specks behind fireflies |
| Odyssey, old chapter 2 | Deep-ocean god rays (`deep-ocean.tsl.js`) | MSAA at each cone's tip, in the colour | A black block at each shaft tip. Off the default path: with `?odysseyOneWorld=0`, after a One World build failure, and in its playground effect |
| Summer, Verdant Hills | Meadow grass roots | MSAA: `st.y` below 0 takes a channel below 0 | Rare specks in dry patches |
| Sakura Twilight | Grass tips (`pow(st.x, 2.5)`) | MSAA at the root, mostly under the ground | Rare specks beyond about 50 m |
| Cinder Drift | Lava falls' source edge (`sqrt(along)`) | MSAA | Latent: only noise coordinates |
| Odyssey | Act I light shafts, chapter 6 aurora crown | MSAA at a cone's tip and the crown's top | Latent: the floor hides the tips; the crown's alpha is clamped |
| Serenity Warp, Shifting Sands, Sunfall, Odyssey sky | Gaussians and an ease of signed values (`pow(x, 2.0)`, `pow(k − 1, 3.0)`) | By design | Wherever the compiler keeps `pow`. Sunfall's is in the vertex stage, where a NaN drops the bud's triangles |
| Odyssey deep ocean | Caustics, `pow((c1 + c2)/2 + 0.5, 4)` of two sines | By design, down to −0.5 | As above (old chapter 2) |
| Lunara, Neon District, Rainbow Terraces, Chiral Gold, Aurora, Stellar Drift, Stillwater, Synthwave Sunset (six), the Odyssey (twelve) | Rims and Fresnel terms, `1 − dot(N, V)` | Rounding | A NaN pixel where a face looks at the eye; with stock bloom a block |
| Summer, Golden Forest | Garland tips, ribbons' far end (vertex) | `sin` of π | A dropped triangle at the very end |

**The fixes** follow one rule:
- a square, cube or fourth power of a signed value becomes `pow2`, `pow3` or `pow4`;
- otherwise the base is clamped where it is made: `clamp(uv, 0, 1)`, `saturate(colour)`,
  `max(1 − across², 0)`, `clamp(dot, 0, 1)`.

Each MSAA clamp carries a comment saying why, as the earlier five do. Inside the triangle every
clamp is a no-op.

## 3. Mip seams

A texture read picks its mip from how fast its coordinates change between neighbouring pixels.
Where they leap (across an atlas's cells, or across `atan`'s cut at ±π), the read takes the
smallest mip: a hairline of the texture's mean.

- **Neon District's lettering.**
  - **The fault:** every sign, shop name, ticker and the combo counter reads its glyphs from one
    atlas. Between two letters the coordinate leaps to another cell, so that column of pixels
    read the atlas's mean. That shortened the glyph distance, and the sign's glow
    (`exp(−17 d)`) lit a bright 1–2 px dash between letters.
  - **The fix:** `ndGlyphFootprint` (`neon-district-text.js`) takes the footprint from the
    character cell instead. The cell wraps there too, so of it and the same point wrapped at the
    cell's middle, the slower rate is used.
  - **Captured:** 3,077 px change, the dashes gone ([image](theme-shader-audit/neon-district-glyph-seams.png)).
- **Luminous Tides' crests.** Each crest's sections are read with the wave's index, which steps
  on every crest line, right where the lip burns. The footprint now comes from the along-shore
  coordinate alone. Captured: 227 px along the crests.

**Checked and left as they are** (a seam in the code, but nothing on screen):
- **Rainbow Terraces' veil at the bow's crest** (`chainVeil`). The wrap does cross the crest in
  view. Scaling the veil 40× along that line moves the bow by up to 420 levels, so the seam's
  ±20 % is about 2. Captured at four times: at most 2 levels.
- **Rainbow Terraces' Milky Way clots and lanes.** Not reproduced: the wrap is in view only a few
  minutes of each 26-minute turn, at night.
- **Winter's young crater's rays, Stellar Velocity's far sky, Vesper Chrysalis's halo spokes.**
  Each is read by `atan` with no footprint, and Winter's rays tile 18.85 times a turn. Fixed in
  a draft, none moved a pixel in the captured views: the rays term doesn't reach the image, and
  the far sky sits behind the canyon. The draft was dropped.

**A normal first read inside a branch**, the guide's third class, was checked across the same
range and not found.

## 4. How it was checked

**SwiftShader shows no NaN from `pow`.**
- A compute test in the capture browser returns `pow(−1e-7, 2.4) = 1.6e-17`: its `log2` ignores
  the sign. Its `sqrt(−1e-7)` is NaN.
- So for the `pow` fixes, a before/after pair can only show what else changed. Where the old
  base was negative, SwiftShader drew `|x|^y`, a GPU draws NaN, and the fix draws the clamped value.
- Pairs at High, 1920 × 1080, `t=12` (pixels changed by more than 6 of 765):
  - **None changed:** Aurora (with meteors in flight), Lunara, Chiral Gold, Cinder Drift,
    Serenity Warp, Shifting Sands, Stellar Drift, Sunfall, Synthwave Sunset, Stillwater and
    Verdant Hills. Golden Forest changed 1 pixel, with its ribbons out.
  - **Summer: 188**, in the shore band where the map below has its spots.
  - **Sakura Twilight: 3**, at grass roots (`|x|^2.5` there before).
  - **The Odyssey (1280 × 720):** the world, Earth Core, the whale pass, the orb design and the
    path beacons are unchanged.
- **Six Odyssey views aren't deterministic at a fixed `t`:** Cosmic Expanse, chapter 7, the deep
  ocean, two of Surface World and the mountain peaks. Two captures of the same code differ as much
  as before and after do, so they show only that the code compiles and renders.
- No capture logged a WebGPU validation error or a console error.

**Maps of where the old base goes negative.**
- For the MSAA cases, a worktree at the previous commit, served on its own port, marked every
  pixel where the old base is negative. Each of those is a NaN on a GPU.
- Captured that way (High, 1920 × 1080, `t=12`):
  - Lunara: 8 spire tips, each one pixel above the point;
  - Aurora: the tail end of every meteor in flight (4 spots);
  - Summer: 197 spots, among the near reeds and as 2×2 flecks in the half-resolution reflection.

**Checks:**
- **Unit tests:** the full suite, 22,503 passed.
  - Three Odyssey test files timed out while two software-GPU browsers held the machine's four
    cores; run alone, they pass (26 tests).
- **Static checks:** the lint ratchet at its baseline, with no file gaining a warning or an
  error; the typecheck; the TS ratchet; dependency boundaries; the release gates; IP strings;
  the production build (with an 8 GB heap, as before) and its boot closure; the pages artifact;
  the perf budgets.
- Fitness: the resize-listener ratchet moved from 18 to 13 (section 5).
- The theme lifecycle audit passes.

## 5. Five themes take the window's size from the viewport broadcaster

Chromadelic Highway, Neon Dusk, Nimbus Veil, Synthwave Sunset and Wolfhour still sized their
canvas from a raw window `resize` listener. That is the F11 storm the viewport broadcaster
(`src/utils/viewport.js`, plan §4.4) exists to end: every event of a drag or a fullscreen
transition set the canvas's size again, blanking it until the next frame.
- **Now:** each subscribes to `EVENTS.VIEWPORT_RESIZED`, which is debounced and fires only on a
  real change of size or pixel ratio.
- **And:** each sizes its canvas through `BaseTheme.sizeRenderer`, only when the size or pixel
  ratio differs.
- **Test:** Synthwave Sunset's asserts no raw listener, a resize on the broadcast, and none after
  `stop()`.
- **Fitness:** `architecture-fitness.json` locks the shrink in (resize listeners 18 to 13).

## 6. Open

- **Nothing here ran on a GPU.** Worth a look on the laptop at High:
  - Aurora: a 3-line clear, for the meteors;
  - Lunara's spire tips;
  - Summer's shore and its reflection;
  - Neon District's signs.
- **Earth Core's basalt columns** still hash an interpolated facet normal (see the previous
  record).
