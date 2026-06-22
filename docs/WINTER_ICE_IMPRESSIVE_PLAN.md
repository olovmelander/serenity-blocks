# Winter Ice — "shinier / icier / more impressive" plan

_Grounded in an 8-agent audit (codebase + live Blender MCP). 2026-06-21._

## The question

"Now that we have PolyHaven + Sketchfab in Blender, can we use anything from there for the
ice to make it look more shiny / icy / impressive?"

## Verdict — external assets ≈ no; procedural = yes

The ice is a single flat, **unlit** `MeshBasicNodeMaterial`
([`createWinterLakeNodeMaterial`](../src/themes/winter/winter-materials.js)) on a 4200×1100
plane. It has **no lighting, no roughness/metalness channel, and no normal input**, so every
"shiny" cue is computed analytically from a constant +Y normal.

That makes external assets architectural no-ops here:

- **PolyHaven** — verified live in Blender: **no ice and no frost category**, only 8
  photoscanned *snow-ground* assets. A normal/roughness map can't plug into an unlit
  material; snow albedo clashes with the painterly palette and muddies under WinterPipeline
  (exposure 0.82 + ACES + cold tint). The **only** honest use is a faint greyscale snow
  **luminance** grain at the *shore seam* (clone `detail-texture.js`; planar `baseUv*8`;
  gate by `(1-centreGlow)`; tier-gate off on Low). Impact ~2.
- **Sketchfab** — viable **only** as **shape donors** re-shaded with the theme's own flat
  `makeTreeMat` (discard the PBR material, `computeVertexNormals()`, re-colour). The shapes
  worth donating (icicles, shore floes) are cheaper built procedurally. At most **one**
  CC-BY ice chunk (e.g. "Ice Cluster", UID `4d2271f8bf7f400e9a5c8f10812a32de`, 1886 faces)
  as a foreground hero beside the moon column — **only if** the procedural slab reads too
  clean. Prefer CC-BY over CC-BY-SA (share-alike taxes the whole project).

The real wins are **procedural, cheap, grade-safe, single-pass** — they fix the actual
problem: highlights ride a dead-flat normal, so they read as paint, not surface.

## Ranked plan

| # | Lever | Kind | Impact/Effort | Status |
|---|-------|------|:---:|:---:|
| 1 | **fbm frost normal** → faceted ice plate (every highlight becomes relief) | procedural | 5 / 2 | ✅ shipped |
| 2 | **Sub-surface cyan glow** + StormDirector flare (combos light the ice) | procedural | 4 / 1 | ✅ shipped |
| 3 | **Anisotropic streak specular** (polished/skated-ice glints) | procedural | 4 / 2 | ✅ shipped |
| 4 | **Frost rim** at the shoreline (reuses edge mask) | procedural | 3 / 1 | ✅ shipped |
| 5 | **Parallax fake-depth** — look *into* a thick ice slab + snow bed beneath | procedural | 4 / 3 | ⏳ next |
| 6 | PolyHaven snow **luminance** shore-grain (`detail-texture.js` clone) | polyhaven | 2 / 2 | optional |
| 7 | Procedural **icicles + shore floes** (re-shade pattern, no import) | procedural | 4 / 3 | optional |
| 8 | ONE re-shaded CC-BY ice-chunk hero | sketchfab | 3 / 3 | fallback only |
| 9 | **Real planar reflection** (`reflector()`, proven in halcyon-apex) | reflection | 5 / 5 | ⏳ flagged, isolated session |

## Shipped (ranks 1–4) — verified in playground, 162–177 fps, no console errors

All in [`winter-materials.js`](../src/themes/winter/winter-materials.js)
`createWinterLakeNodeMaterial`, driven by `uStorm` from the effect's storm intensity
([`winter-wonderland.effect.js`](../src/playground/effects/winter-wonderland.effect.js) update loop):

- **Frost normal**: two decorrelated noise fields tilt the +Y normal (`uFrostStrength`);
  Fresnel recomputed from the perturbed normal; a `facet` slope term gates the sparkle.
- **Sub-surface glow**: `centreGlow * uLakeColor * (0.22 + uStorm*0.9)` with a slow breath;
  added to colour **and** emissive (in-game MRT bloom amplifies; harmless flat in playground).
- **Streak specular**: directional `pow(abs(sin(sDir*uStreakFreq)), 22)` windowed by a
  low-freq density noise, Fresnel-gated; sparkle also stretched (`v*40`) to read elongated.
- **Frost rim**: `edgeMask*(1-edgeMask)*4` × `uCrackColor`, reusing the shoreline edge mask.

New uniforms exported from the material: `uStorm, uFrostStrength, uStreakAngle, uStreakFreq`.

## Constraints (load-bearing)

- `useMRT:false` → **no bloom**; glow comes from material brightness + the emissive add.
- WinterPipeline grade in-game (the playground is flat NoToneMapping) → **overshoot bright**
  in the playground; the graded in-game look needs a user capture to confirm.
- New uniforms MUST be added to the material's returned `uniforms` object or the per-frame
  hooks silently no-op.
- Screenshot-first; **one small effect per session** (full-journey captures TDR-crash the iGPU).

## Avoid

- Refractive/high-poly/PBR "realistic" ice GLBs (clash + budget + NC/SA licenses).
- Decoding a PolyHaven **normal** map into the unlit ice (no ice asset exists; snow bumps
  muddy under the grade) — author facets procedurally instead.
- **Caustics** — they read as *liquid* water, fighting the frozen identity. Use the
  sub-surface glow for "light in the ice".
- Sampling shore detail on worldXZ (the lake has stable UVs — use planar `baseUv*8`).
- Shipping `reflector()` without a `?winterReflect` flag + the faked-column fallback, or as
  `onBeforeRender` (it must render before the WinterPipeline composer — misty-lake precedent).
