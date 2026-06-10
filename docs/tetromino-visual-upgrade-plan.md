# Tetromino Visual Upgrade Plan — Best-in-Class (Corrected, Definitive)

> **This document supersedes all earlier drafts.** The previous draft contained three
> load-bearing factual errors (a false Phaser API claim, a misdiagnosed triangle bug, and a
> per-cell bevel that violates the no-seam constraint). Every one is corrected below with
> file:line ground truth.

## Hard constraints (non-negotiable, from the user)

1. Tetrominoes remain geometrically accurate 4-block pieces but render as **ONE fused solid
   shape in a single color**.
2. **NO internal seams, dividers, spacing, strokes, bevels, or shadows** separating the
   constituent blocks. Lighting/gloss must be **CONTINUOUS across the whole fused shape**
   and/or only on its **OUTER perimeter**.
3. Applies to **BOTH** the main Phaser canvas and the next-queue HTML5 Canvas 2D preview.

Every technique in this plan is chosen to satisfy these. The single most important design
rule, repeated throughout:

> **Merge cells into one silhouette first; then shade only the whole-shape surface and its
> outer perimeter. Never shade per cell.**

---

## 0. Ground-truth corrections to the prior draft

These corrections are the foundation of the rewrite. Each is verified against vendored source.

### 0.1 `fillGradientStyle` was NOT removed from Phaser 4 — the prior plan's Phase 1 detour is deleted

The prior draft (lines 97, 109) claimed *"Phaser 4 removed `fillGradientStyle`"* and *"Phaser
Graphics API doesn't expose `createLinearGradient`"*, then built an entire DynamicTexture
caching detour on that premise. **Both claims are false.**

- `fillGradientStyle(topLeft, topRight, bottomLeft, bottomRight, aTL, aTR, aBL, aBR)` exists at
  `node_modules/phaser/src/gameobjects/graphics/Graphics.js:368`, WebGL handler
  `GraphicsWebGLRenderer.js:205` (`GRADIENT_FILL_STYLE`).
- The repo **already calls it** at `src/rendering/phaser/shared-effects.js:1272-1273` and
  `:1280-1281` (the beam effect). The defensive `if (beamGraphics.fillGradientStyle)` guards
  are harmless but unnecessary on rc.5.
- **Semantics (critical):** it is a **4-corner vertex-color/alpha interpolation**, *not*
  positional gradient stops. Per `Graphics.js:341-351`: each triangle is filled with a
  gradient on its own; there is no whole-path positional gradient.
  - `FILL_RECT` forwards all four corner tints `TL,TR,BL,BR` → a true 4-corner bilinear
    gradient across a rectangle (`GraphicsWebGLRenderer.js:302-305`).
  - `FILL_PATH` forwards only `TL,TR,BL` (drops `BR`) and applies them **per Earcut triangle**
    (`FillPath.js:51,144-146`) — so on a concave polygon the gradient is per-triangle, not
    smooth across the whole shape.
  - **Consequence for us:** because we fill the body as **per-cell `fillRect`s** (see §2), we
    can set `fillGradientStyle` once before the rect loop and every cell rect receives the same
    consistent 4-corner gradient computed in **piece-bounding-box space** — giving a continuous
    TL→BR directional gradient across the *whole fused shape* with zero internal seams. This is
    the supported, cheap, correct path.
  - **Caveat to state honestly:** because each cell rect is gradiented in its own local rect by
    `FILL_RECT`, to make the gradient continuous across the piece we must pass **per-cell corner
    tints sampled from the piece-bbox gradient** (compute the 4 tint colors for that cell's
    corners by lerping the bbox gradient). This is a few lines of arithmetic per cell, not a
    texture bake. Details in §3.1.

**Action:** delete the entire DynamicTexture-per-color gradient/specular caching scheme from
the old Phase 1/Phase 3a. It solved a problem that does not exist.

### 0.2 The triangle artifact is a CONTOUR-CHAINER bug, not (only) a hidden-row bug

The prior draft (lines 18-30) blamed only the hidden-row cell filter and prescribed *"remove the
`minWorldY` guard."* That is **necessary but insufficient** and misses the real root cause.

`buildOuterContour` (`base-board-scene.js:912-953`) builds directed outer edges, then chains them
through a map **keyed solely by start-vertex**:

```js
// base-board-scene.js:940-941
const edgeMap = new Map();
edges.forEach((e) => edgeMap.set(`${e.fx},${e.fy}`, e));   // start-vertex key
```

`Map.set` **overwrites** on duplicate keys. At any vertex where **two outer edges start at the
same pixel** — i.e. every concave/pinch corner — one edge is silently dropped. The walk
(`current = edgeMap.get(...tx,ty)`) then jumps across the gap, and `fillPath` closes the polygon
with a straight `lineTo` → **the diagonal "red triangle."** This fires for **Z/S/T/J/L** (all
concave) and **every concave/holed locked cluster**, completely independent of hidden rows.
There are **three** independent edge-drop mechanisms, all converging on the same artifact:

1. **Map-key start-vertex collision** (`:940-941`) — the canonical Z-piece pinch at cell-vertex
   `(1,1)`.
2. **`Math.round` vertex aliasing** (`:927-930`) — fractional `originY` (animated/cascade pieces,
   `:860-862`) or non-integer `blockSize` collapses two distinct vertices to one key, manufacturing
   collisions even on otherwise-safe shapes.
3. **Hidden-row row-skip vs full-matrix `has()`** (`:924` skips whole rows, but `has()` at
   `:914-917` still consults the full matrix) — a piece straddling `hiddenRows` emits an
   inconsistent edge graph (missing top run), again closed by a diagonal. Hits the active piece
   at spawn (`y = HIDDEN_ROWS - 2 = 2`).

`buildOuterContour` also **cannot** represent holes or multiple loops: it traces exactly one loop
from `edges[0]` and stops at `:949` (`if (!current) break`). Cascade clusters
(`physics.js:71-146`) and garbage (`garbage.js:677-696`) are routinely **concave, holed, or
multi-run** — the comment at `:903-904` ("Tetrominos are simply connected") is **false for locked
clusters**. So any plan that relies on a single chained contour polygon for the **fill** is
fundamentally unsafe.

**The robust fix (decisive):** *decouple the body fill from the contour.* Fill the body as
**per-cell overlapping opaque rects in one pass** (the proven seamless trick already in
`drawBlock:1028` and `drawPieceStyledUnified:664`). Per-cell `fillRect` at alpha 1.0, NORMAL
blend, with a 0.25–0.5px overlap, produces a perfect seamless union with **zero chaining
fragility and zero possible diagonal** — topology-proof for concave, holed, and multi-run
shapes alike. The contour is then used **only** for the outer rim/bevel (where a dropped edge is
cosmetically harmless and, for the active piece, can be hardened — see §2.2). This is the change
the prior plan never proposed and is the heart of the rewrite.

### 0.3 The camera does NOT clip hidden rows — so hidden-row handling must be explicit

Prior draft lines 23-25 assumed *"the camera positions so hidden rows are off-screen — no
clipping needed."* **False.** `configureCamera` (`:592-602`) sets
`camera.setBounds(0, 0, width, height)` where `height = (rows + hiddenRows) * blockSize` — the
**bounds include the hidden rows** — and merely `centerOn`s the visible band. There is **no mask,
scissor, or crop anywhere** in `src/rendering/phaser` (verified: 0 matches for
`setMask|setCrop|scissor|clipRect`). The hidden rows sit *above* the centered viewport but are
within the scrollable region. Therefore the per-cell `worldY < minWorldY` guard is **load-bearing**
for keeping spawn-region cells from drawing into the visible band of the wrong neighbour — but the
**active piece legitimately occupies hidden rows at spawn** and must drop in smoothly.

**Correct hidden-row handling** (replaces "just delete the guard"):

- Keep a **per-cell** visibility decision (not a per-row early `return`), so the edge graph stays
  consistent. In the new per-cell fill path, simply **skip drawing a cell whose `worldY <
  hiddenRows`** in non-infinity mode — exactly as the old per-cell paths did
  (`drawPieceOutline:1048`, `canvas-drawing-utils:429` style). Per-cell rects have no chain to
  break, so partial spawns render the correct visible subset with no diagonal.
- For the **active piece drop-in** we want the piece to slide in smoothly from above rather than
  pop row-by-row. Wrap the dynamic `pieceGraphics` in a **WebGL Mask filter** (see §1.4) bounded
  to the visible playfield rect `(0, hiddenRows*blockSize, cols*blockSize, rows*blockSize)`. This
  gives a clean clip edge so cells crossing the boundary are clipped mid-cell, not culled whole.
  This is optional polish; the per-cell skip is the correctness floor.

### 0.4 The locked board is drawn PER-PIECE, not as a merged cluster

`drawBoardFromGrid:744-767` iterates `gameState.lockedPieces` and calls `buildOuterContour`
**per piece**. Two same-color locked pieces resting flush produce **two separate contours**, so
beveling/stroking each contour draws a bevel **along the seam where they touch** — a forbidden
internal seam between adjacent same-color blocks. Worse, the "arbitrary concave cluster" the
research targets is **never assembled**. Any outer-perimeter effect on the locked board must
operate on a **merged silhouette of same-color-adjacent cells built from `boardGrid`**, not on
per-piece shapes. See §4 for the merge step.

### 0.5 Per-cell bevels are rejected outright — they ARE the forbidden seam

Prior draft Phase 5 (`drawCellBevel`, lines 282-315) drew a bevel per cell and hand-waved that
internal strips *"cancel out perceptually."* They do not. On a shared vertical edge, the left
cell paints a dark right-shadow strip and the right cell paints a bright left-highlight strip —
adjacent dark+light = a **visible embossed line down the middle of the piece**: precisely the
grid seam the user forbade. **All per-cell bevels are deleted from this plan**, on both the Phaser
and canvas paths. Bevel/rim/gloss attach to the **fused outer silhouette only**.

---

## 1. Real Phaser 4.0.0-rc.5 API surface (the tools we will actually use)

Verified against `node_modules/phaser/` (`package.json` → `4.0.0-rc.5`). Renderer is
**WebGL-only** (`src/main.js:1564-1565`).

| Need | Correct API | Notes |
|---|---|---|
| Directional gradient on body | `graphics.fillGradientStyle(tl,tr,bl,br, aTL,aTR,aBL,aBR)` then `fillRect` per cell | `Graphics.js:368`. 4-corner vertex lerp; `FILL_RECT` uses all 4 corners. Compute per-cell corner tints from bbox gradient (§3.1). |
| Flat fill | `graphics.fillStyle(colorInt, alpha)` then `fillRect` | Resets gradient state. |
| Outer rim stroke | `graphics.lineStyle(w, color, alpha)` + `strokePath()` | `Graphics.js:301,521`. Stroke the merged contour ONLY. |
| Additive glow | `graphics.setBlendMode(Phaser.BlendModes.ADD)` … `NORMAL` | `BlendMode.js`; `ADD===1`. Each blend switch flushes a batch — group same-blend draws. |
| Radial specular / `shadowBlur` / `clip` | **CanvasTexture**: `textures.createCanvas(key,w,h)` → real 2D ctx → `refresh()` | `CanvasTexture.js:86,521`. **DynamicTexture has NO 2D context under WebGL** (`DynamicTexture.js:145,155`) — do not use it for radial gradients. |
| Bake a static layer to a texture | `textures.addDynamicTexture(key,w,h)` → `draw()/stamp()/fill()` → **`render()`** | `DynamicTexture.js:292,786`. The `render()` flush is **mandatory** in Phaser 4. GPU framebuffer, no 2D ctx. |
| Clip a GameObject to a polygon (WebGL) | **Mask filter**, not BitmapMask | `BitmapMask` is **GONE** (0 matches in src). `setMask()` no-ops + warns under WebGL (`components/Mask.js:55-59`). |

### 1.4 WebGL polygon clipping (the only correct way in this game)

`gameObject.enableFilters()` then
`gameObject.filters.internal.addMask(maskSource, invert, viewCamera, viewTransform, scaleFactor)`
(`components/Filters.js:237`, `FilterList.addMask:463`, `filters/Mask.js`). `maskSource` may be a
texture key or a GameObject (a Graphics drawing the white clip polygon — auto-rendered to a
DynamicTexture and kept in sync). **`Graphics` itself does not mix in `Filters`** (only `Mask`,
`Graphics.js:75,93`), so a Graphics object can be a *mask source* but cannot itself be filter-
masked. To clip `pieceGraphics`, either (a) draw the active piece into a filter-capable object
(Image/Sprite/Shape) and `addMask`, or (b) accept the per-cell `worldY < hiddenRows` skip (§0.3)
which needs no mask at all. **Recommendation:** ship the per-cell skip first (zero risk); add the
Mask filter for smooth drop-in only if the row-pop is visually objectionable.

---

## 2. The fix architecture: decouple FILL from CONTOUR

This section is the core of the rewrite and resolves the triangle bug, the seam constraint, and
the concave-cluster problem simultaneously.

### 2.1 Body fill — per-cell overlapping opaque rects, one pass (topology-proof, seamless)

Replace `fillFusedShape`-as-body-fill with a per-cell rect fill. For each filled cell of the
shape (after per-cell hidden-row skip):

```js
// Pseudocode for the Phaser body fill (NORMAL blend, alpha 1.0)
graphics.fillStyle(colorInt, alpha);            // or fillGradientStyle for §3.1
for each filled cell (lx,ly) with worldY >= hiddenRows (non-infinity):
    const px = Math.round((originX + lx) * bs);
    const py = Math.round((originY + ly) * bs);
    const w  = Math.round((originX + lx + 1) * bs) - px;
    const h  = Math.round((originY + ly + 1) * bs) - py;
    graphics.fillRect(px - 0.25, py - 0.25, w + 0.5, h + 0.5);   // overlap fuses seams
```

Why this is correct:
- **No chain, no map, no diagonal** — immune to the §0.2 bugs for the body.
- The 0.5px overlap (already proven in `drawBlock:1028`) eliminates sub-pixel AA gaps so adjacent
  cells fuse into one seamless solid at alpha 1.0 / NORMAL blend (each cell's overlap is fully
  opaque, so double-coverage is invisible — confirmed by Phaser FILL_RECT semantics).
- Works identically for active piece, animated pieces, locked clusters, holed shapes, and garbage
  runs. **One implementation, all paths.**
- **Do NOT** use `fillPath` with multiple `moveTo` sub-paths for the body (Phaser does no boolean
  union — each sub-path is triangulated and filled independently → double-coverage seams visible
  under alpha<1 or ADD; `GraphicsWebGLRenderer.js:135-153`).

### 2.2 Contour — used ONLY for the outer rim/bevel, and hardened

Keep `buildOuterContour` for the **perimeter polygon only** (rim stroke, glow silhouette). Harden
it so the rim doesn't show its own diagonal:

- **Key the edge map by directed half-edge with a turn rule.** Replace the start-vertex map
  (`:940-941`) with a multimap of edges-by-start-vertex; when the walk reaches a vertex with
  multiple candidates, pick the successor that turns **most clockwise** (for CW outer winding).
  This resolves pinch/concave collisions deterministically. ~20 lines.
- **Round once, consistently.** For animated pieces, round the **origin** to a stable sub-pixel
  grid or snap vertices to a shared rounding so `Math.round` cannot alias two real vertices to
  one key (§0.2 mechanism 2).
- **Support multiple loops** for the merged locked board (§4): collect all edges, repeatedly pick
  an unused edge as a new loop start until all are consumed; return an array of loops (outer +
  holes). Stroke/fill each loop; for a fill, use even-odd winding so holes subtract.

Because the body is already filled by §2.1, a residual contour glitch only ever affects the thin
rim — far less catastrophic than a triangle across the body — but the turn-rule fix above removes
it entirely for the active piece. Effort to harden: **Small–Medium**; correctness payoff: high.

### 2.3 Hidden-row handling (replaces "delete the guard")

- Remove the **row-level early `return`** at `:924` (it desyncs the edge graph). Replace with a
  **per-cell** skip in both the body-fill loop and the edge-generation loop: skip a cell entirely
  when `!isInfinityMode && (originY + ly) < hiddenRows`. Crucially, make `has()` agree — treat a
  skipped cell as **absent** so the boundary edge is emitted correctly.
- Remove the redundant broad culls only where they double-guard incorrectly; keep the cheap
  bounding cull at `:750` (`pieceBottom <= startRow || pieceTop >= endRow`) for performance, but
  drop `:751`'s `pieceBottom <= hiddenRows` reliance on the row-level guard.
- In Infinity mode, `minWorldY` is `-Infinity` and everything renders — that pieces already render
  fine there is independent confirmation the bug is the chainer, not the clip.

---

## 3. Premium depth, chosen per render path (decisive)

All techniques operate on the **fused silhouette**. Per-cell bevels (old Phase 5) are rejected
(§0.5). Per-edge trapezoid bevels (old Phase 2) are rejected because concave (270°) corners make
adjacent inset strips **overlap and cross** (double-darkening X-blotches in every armpit of
T/S/Z/J/L and every notch of a locked cluster) while convex corners leave mitered gaps — correct
handling needs a true polygon-offset/straight-skeleton miter, which is fragile. We use
distance-from-edge / vertex-gradient techniques that wrap concave corners for free.

### 3.1 Active piece (small, fast, every frame) — directional gradient + outer rim. **Recommended.**

The active piece is at most 4 cells; keep it a live `Graphics` redrawn each frame (caching to a
texture would add a render-to-texture pass costing more than it saves — Report 2 §6).

**Step A — directional surface gradient (continuous across the whole shape).**
Compute the piece bounding box in pixels. Build a TL→BR light ramp from the themed base color:

- Top-left corner tint:  `lighten(base, +14% L)` (HSL: keep H,S; `L = min(L+14, 96)`).
- Bottom-right corner tint: `darken(base, −16% L)`.
- Other two corners: linear interp at their bbox position.

Then, for each filled cell, set `fillGradientStyle` with the **four corner colors sampled from the
bbox gradient at that cell's four corners** (bilinear lerp of the 4 bbox corner tints by the
cell's normalized x/y in the bbox), and `fillRect` the cell. Because every cell is sampled from
one continuous bbox gradient, the result is a **single continuous gradient across the fused shape**
with no seams. This replaces the old multi-pass alpha-overlay hack.

> HSL color math (fixed H,S; move L only — preserves saturation in highlights):
> highlight `L + 12…18pp` (clamp ≤96), face = base `L`, shadow `L − 12…20pp`. The cheaper
> rgba-overlay analog (white `0.18–0.30`, black `0.20–0.35`) is acceptable for the tiny
> next-queue but prefer HSL-L on the main canvas.

**Step B — outer rim (Fresnel-style) on the merged contour ONLY.**
After the body fill, stroke the (hardened, single-loop) contour once:
`graphics.lineStyle(Math.max(1, bs*0.04), 0xffffff, rimAlpha)` → `strokePath()` over the contour
points. This is the Tetris-Effect signature and, being on the outer perimeter only, never creates
an internal seam. `rimAlpha` defaults ~0.45 and is **theme-driven and reduced-motion-gated**
(§6). On already-bright colors (yellow J `#ffff00`, cyan S `#00ffff` — `constants.js:31-39`) cap
rim alpha lower (≤0.3) to preserve contrast.

**Step C — optional center specular blip.** A small soft radial highlight near top-center reads as
gloss. Phaser Graphics has no radial gradient; bake **one** small white radial CanvasTexture
(`textures.createCanvas`) at startup and `add.image` it over the piece bbox with ADD blend, scaled
to the bbox. One texture, reused for all pieces/colors (it's white). Gate behind theme +
reduced-motion. **Effort small; optional.**

### 3.2 Arbitrary concave LOCKED clusters — merged silhouette + distance-based inner shading

Locked clusters are concave/holed/unbounded; pre-baking per shape is infeasible. Two viable
routes; pick by effort budget:

- **Route 1 (recommended, no shader): merged contour + inner shadow/highlight via offset-stroke +
  clip.** On a CanvasTexture (so we have real Canvas2D), for the **merged** board silhouette
  (§4): fill flat, then do the inner-shadow pass — stroke the union path with a dark translucent
  `shadowColor`, `shadowBlur=r`, positive offset, **double `lineWidth`** so the outer half is
  outside, then `globalCompositeOperation='destination-in'; fill(unionPath)` to keep only the
  inward blur; repeat with a light `shadowColor` + negative offset for the inner highlight. This
  is **distance-from-edge** driven, so it wraps every concave 270° notch correctly with **no
  internal seams** (interior shared edges never get stroked because we stroke the *union
  perimeter* only). Render the CanvasTexture as one Image; `refresh()` only on board-dirty.
- **Route 2 (best-looking, needs a WebGL shader pass): SDF `min()`-union bevel.** Render the
  cluster as one quad; in the fragment shader evaluate `d = min over cells of sdBox(...)`
  (union — seam-free by construction), recover the normal `N = normalize(vec3(dFdx(d), dFdy(d),
  k))`, and shade `base*(0.6+0.4*diff) + rim*pow(1-N.z,3) + spec`, with `1 - smoothstep(0,
  fwidth(d), d)` for free AA. Concavity-proof. Use only if a custom WebGL pipeline is in scope;
  otherwise Route 1 is production-proven and sufficient.

Because the board is mostly static, either route is **baked and re-baked only on board-dirty**
(§5) — not per frame.

### 3.3 Ghost piece — EXCLUDED from all depth effects

`drawGhostPiece` (`:867-885`) fills the fused shape at one shared pulse alpha specifically so the
ghost reads as a single translucent silhouette. **Do not** apply gradient, bevel, rim, specular,
or glow to it — a white rim/bevel on a translucent white-ish ghost turns it into a bright bordered
box competing with the active piece. The ghost keeps its current single-alpha fused fill (migrated
to the per-cell rect body fill of §2.1 at ghost alpha, with the existing perimeter outline at
`:609-643` retained as its *only* edge treatment). Gate the pulse behind reduced-motion (§6).

### 3.4 Next-queue preview — fused silhouette gradient + outer rim, baked once

Static, small, off the hot path (`next-queue-ui.js:126-179` → `drawPieceSolid` →
`drawPieceStyledUnified`, `canvas-drawing-utils.js:572`). The fused-shape renderer already fills
one combined path (`:657-667`). Add depth to **that** path:

1. **Tight bounding box.** `SHAPES` are padded (I is 4×4 with blank rows `constants.js:62-67`;
   T/S/Z/J/L are 3×3 with blank rows/cols). The current sizing uses raw `rows/cols`
   (`next-queue-ui.js:132-133`), so I renders undersized/off-center. **Trim empty rows/cols
   before sizing**: compute occupied bounds, size and center on the trimmed extent.
2. **Continuous directional gradient** across the trimmed bbox via `createLinearGradient(gx1,gy1,
   gx2,gy2)` clipped to the union path (already supported for `gradient` mode at `:684-714`;
   extend `solid` mode to also use a gentle base→shade ramp). rgba-overlay color math is fine here.
3. **Inner shadow/highlight on the union perimeter only** (the §3.2 Route-1 offset-stroke + clip
   recipe, scaled down) — or, minimally, a single outer rim stroke on the perimeter for a clean
   look. **No per-cell bevel.**
4. **Smoothing management.** The preview sets `imageSmoothingEnabled = false` (`:157`, `:585`) for
   crisp pixels, then `drawPieceStyledUnified` flips it to `true` only at the very end (`:765`)
   before `restore()`. Diagonal bevel/gradient edges need smoothing **on**; slot the depth pass in
   **before** `restore()` and set `imageSmoothingEnabled = true` for that pass, restoring state
   after. Verify the DPR transform (`:135,142-148,153`) covers the new pass.

---

## 4. Merging the locked board into a seamless silhouette (the missing step)

Outer-perimeter effects on the locked board require a **union polygon of same-color-adjacent
cells**, not per-piece contours (§0.4). Build it from `boardGrid` (the authoritative occupancy +
color/id grid), not from `lockedPieces`:

1. For the visible row range, group filled cells into connected regions by **render color**
   (themed color, with garbage as its own group). Adjacent same-color cells fuse; the boundary
   between two *different* colors is a legitimate visible edge.
2. For the **body fill**, you do not even need the union polygon — fill every cell with the
   per-cell overlapping rect (§2.1) using its themed color. Adjacent same-color cells fuse
   automatically (no seam); adjacent different-color cells naturally show their color boundary.
   **This is the simplest correct body path and needs no merge at all.**
3. For **outer-perimeter depth** (rim/inner-shadow), trace the union contour **per color group**
   with the multi-loop, hole-aware contour (§2.2) so the rim hugs the true outer silhouette of
   each fused color region and never runs along an internal same-color seam.

This makes the locked board honor the no-seam rule while still differentiating colors, and gives
the bevel/rim a real concave cluster to wrap.

---

## 5. Performance

Respect the existing dual-layer split (`update:705-718`): **static** `boardGraphics` redraws only
on `_boardDirty`; **dynamic** `pieceGraphics` redraws every frame.

- **Active piece + ghost (dynamic):** live `Graphics`, redrawn each frame. ≤4 cells × a few rects
  + one rim stroke is trivial. Do **not** texture-cache these.
- **Locked board (static):** bake to a **texture** and re-bake only on dirty.
  - **CanvasTexture** if using the Route-1 inner-shadow (needs Canvas2D `shadowBlur`): draw the
    merged board with depth, `refresh()` on dirty, display via one Image. Best visual richness.
  - **DynamicTexture** if staying GPU-side (gradient + rim only): `clear()` dirty region,
    `draw()/stamp()` changed cells, then **`render()`** (mandatory), display via one Image.
- **Infinity-mode caveat (corrected):** `_boardDirty` is set on **every camera scroll** via
  `_checkVisibleRowRangeDirty:216-226`, not just on lock/clear. A naive per-piece contour walk on
  every scroll tick would re-bake hundreds of pieces. Mitigations: (a) bake the board to a texture
  and **scroll the textured quad** instead of re-tracing geometry; only re-bake when *cells*
  change, not when the viewport moves; (b) restrict any contour tracing to the visible row range.
- **Blend batching:** each `setBlendMode` switch flushes a WebGL batch (`BlendMode.js:48-50`).
  Group all ADD-blend glow/specular draws together, then switch back to NORMAL once.
- **No unbounded texture minting.** Themed colors are continuous (combo tints via `_adjustColor`
  produce arbitrary ints). **Never** key a texture cache by hex color. The specular blip is a
  single **white** texture reused for all colors; gradients are computed inline (no per-color
  texture).

---

## 6. Theme system, ghost, garbage, accessibility

### 6.1 Theme integration (`tetromino-style-manager.js`)

The manager today exposes only `getStyleForPiece` → `{color, renderMode, effects,
rendererOverrides}` (`:87-98`) and `getAllColors` (`:104`). The Phaser path currently ignores all
of it. Add:

- `getPhaserEffects(pieceType)` returning `{ gradient: bool, gradientStrength, rim: {color,
  alpha, width}, specular: {enabled, alpha}, glow: {color, alpha, blend} }`, derived from the
  active theme's `effects` + `rendererOverrides.phaser`.
- **Honor `renderMode` and `rendererOverrides.phaser`** so a theme can set `renderMode:'solid'`
  (or a future accessibility/no-bevel theme) and **opt out** of gradient/rim/specular/glow. The
  new Phaser effects must be **conditional on these**, never hardcoded.

### 6.2 Ghost — see §3.3. Explicitly skip gradient/rim/specular/glow.

### 6.3 Garbage blocks

`drawBoardFromGrid:758-762` and `drawAnimatedPieces:852-855` already special-case `GARBAGE`/
`CLEAN_GARBAGE` (gray `#808080`/`#a0a0a0`, no theming). The new effects must **exempt or
down-weight** garbage: keep it **matte/inert** (no bright rim, no specular, minimal or no
gradient) so it stays visually distinct from playable pieces. Garbage should never look like
glossy crystal.

### 6.4 Accessibility

- **`prefers-reduced-motion`:** gate the specular pulse, glow pulse, and the existing ghost pulse
  (`_getPulseIntensity:1096-1102`). When set, render static (no animated alpha). No reduced-motion
  handling exists today — add a single shared check feeding all pulse/glow code.
- **Contrast / colorblind:** the white outer rim at high alpha on already-saturated colors can
  *reduce* readability. Cap rim alpha ≤0.3 on light base colors; keep the body's themed color as
  the dominant, unambiguous identifier (do not let gloss wash out hue). Consider a theme flag to
  disable rim entirely for an accessibility palette.

---

## 7. Phased plan (effort + impact, ordered)

| Phase | What | Files / anchors | Effort | Impact |
|---|---|---|---|---|
| **0** | **Decouple fill from contour.** New per-cell overlapping-rect body fill; per-cell hidden-row skip; remove row-level `return` at `:924`. Fixes the triangle for ALL shapes. | `base-board-scene.js` `drawCurrentPiece:887`, `drawBoardFromGrid:744`, `drawAnimatedPieces:842`, `drawGhostPiece:867`, `buildOuterContour:912` | Small | **Blocker / High** |
| **0b** | **Harden `buildOuterContour`** for rim use: directed half-edge map + CW turn rule; consistent rounding; multi-loop/hole support. | `buildOuterContour:912-953` | Medium | High (kills residual rim diagonal) |
| **1** | **Directional gradient on active piece** via `fillGradientStyle` per-cell-corner sampling (§3.1A). Delete old DynamicTexture detour. | `base-board-scene.js` `drawCurrentPiece`; new `fillFusedGradient` helper | Small | Med-High |
| **2** | **Outer rim** on merged contour for active piece (and per-color locked groups). NORMAL/ADD, theme-gated. | `base-board-scene.js`; `tetromino-style-manager.js` (`getPhaserEffects`) | Small | High |
| **3** | **Locked-board merged silhouette** (§4) + baked depth (Route 1 CanvasTexture inner-shadow, or gradient+rim). Dirty-only re-bake; Infinity scroll = move quad. | `base-board-scene.js` `drawBoardFromGrid`; new merge + bake | Medium-High | High |
| **4** | **Center specular blip** (one shared white CanvasTexture, ADD, top-center), theme + reduced-motion gated. | `base-board-scene.js`; startup texture build | Small | Medium |
| **5** | **Next-queue upgrade**: tight bbox trim, continuous gradient, perimeter rim/inner-shadow, smoothing management. **No per-cell bevel.** | `next-queue-ui.js:126-179`, `canvas-drawing-utils.js:572-767` | Small-Med | High |
| **6** | **Theme + a11y wiring**: `getPhaserEffects`, honor `renderMode`/`rendererOverrides.phaser`, `prefers-reduced-motion` gate, garbage exemption, ghost exclusion. | `tetromino-style-manager.js`, all draw paths | Small | Med (correctness) |

**Recommended order:** 0 → 0b → 5 (next-queue is the first thing the eye hits and is low-risk) →
1 → 2 → 6 → 3 → 4.

---

## 8. Verification checklist

**Correctness (triangle bug):**
- [ ] Spawn each of I,O,T,S,Z,J,L; confirm **no diagonal/triangle** at spawn (active piece
      straddling `hiddenRows`).
- [ ] Z and S pieces (canonical pinch at cell-vertex (1,1)) render as full, correct silhouettes
      at every rotation.
- [ ] Animated/cascading pieces at fractional `animationOffset` show no diagonal (rounding-alias
      case, §0.2 mechanism 2).
- [ ] A cascade cluster with a **hole** (interior cell of different color) renders the body
      correctly (per-cell fill) and the rim wraps the hole (multi-loop contour).
- [ ] Garbage row with gaps (`[[1,1,1,0,1,1,...]]`) renders each run correctly (per-cell fill, no
      chain).

**No-seam constraint:**
- [ ] Zoom in on every piece on the main canvas: **no internal line, bevel, shadow, or rim**
      between constituent blocks of one fused shape.
- [ ] Two adjacent same-color locked pieces show **no seam** where they touch; a color boundary
      shows only between *different* colors.
- [ ] Next-queue pieces show **no internal grid line** (per-cell bevel removed).

**Hidden rows / camera:**
- [ ] Active piece drops in from the hidden zone smoothly (per-cell skip; optional Mask-filter
      clip gives mid-cell clipping).
- [ ] No cell renders above the visible playfield band in non-infinity mode.
- [ ] Infinity mode: scrolling re-uses the baked board quad; pieces render correctly with
      `minWorldY = -Infinity`.

**Premium depth (per path):**
- [ ] Active piece: continuous TL→BR gradient across the whole shape; outer rim on perimeter only.
- [ ] Locked board: continuous inner-shadow/highlight wraps concave notches with no internal seam.
- [ ] Ghost: single translucent silhouette, **no** gradient/rim/specular/glow.
- [ ] Garbage: matte/inert, visually distinct from playable pieces.
- [ ] Next-queue: I-piece fills width and is centered (tight bbox); gradient continuous;
      bevel edges anti-aliased (smoothing on for depth pass).

**Theme / API / a11y:**
- [ ] `fillGradientStyle` path renders (no fallback to flat) — confirms the API is present.
- [ ] A `renderMode:'solid'` theme disables gradient/rim/specular/glow via
      `rendererOverrides.phaser`.
- [ ] `prefers-reduced-motion: reduce` disables specular/glow/ghost pulse (static render).
- [ ] No texture is keyed by piece hex color (no unbounded minting); specular texture is a single
      shared white texture.
- [ ] Rim alpha capped on bright colors; piece hue remains the dominant identifier.

**Performance:**
- [ ] Locked board re-bakes only on `_boardDirty`, not per frame.
- [ ] Active piece stays a live Graphics (no per-frame render-to-texture).
- [ ] ADD-blend draws are grouped to minimize batch flushes.

---

## 9. Key files (with anchors)

- `src/rendering/phaser/base-board-scene.js`
  - `drawBoardFromGrid:734-768` (locked board, per-piece — needs merge §4)
  - `drawAnimatedPieces:842-865`, `drawGhostPiece:867-885`, `drawCurrentPiece:887-898`
  - `buildOuterContour:912-953` (triangle root cause §0.2; harden for rim §2.2)
  - `fillFusedShape:963-973` (keep for rim/contour; body moves to per-cell rects §2.1)
  - `drawBlock:998-1029` (the proven 0.25px-overlap rect trick to reuse)
  - `configureCamera:592-602` (bounds include hidden rows; no clip §0.3)
  - `_getPulseIntensity:1096-1102` (reduced-motion gate §6.4)
- `src/rendering/canvas/canvas-drawing-utils.js`
  - `drawPieceStyledUnified:572-767` (fused path; add depth, manage smoothing §3.4)
  - body fill `:657-667`, gradient mode `:684-714`, perimeter stroke `:725-763`
- `src/ui/next-queue-ui.js` — `drawPiece:126-179` (tight bbox trim §3.4)
- `src/rendering/tetromino-style-manager.js` — `getStyleForPiece:87-98`; add
  `getPhaserEffects` §6.1
- `src/rendering/phaser/shared-effects.js:1272-1285` — **proof `fillGradientStyle` exists/works**
- `src/core/constants.js` — `COLORS:30-40`, `SHAPES:61-97` (padding), `BLOCK_SIZE`,
  `HIDDEN_ROWS=4`
- `src/core/physics.js:71-146` — `findConnectedComponents` (concave/holed clusters)
- `src/core/garbage.js:677-696` — garbage single-row-with-holes shape
