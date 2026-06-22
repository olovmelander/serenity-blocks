# Winter ground — "thick fluffy snow layer" plan

_Grounded in a 7-agent investigation (film/AAA + stylized-game research, TSL/WebGPU
feasibility, codebase audit) + an adversarial completeness check. 2026-06-21._

## The ask

The foreground snow ground "feels flat." Make it feel like a **thick, fluffy snow
layer** — deep, soft, billowy, light-scattering.

## Root cause — it's two problems, not one

The audit + critique converged on this: the ground fails the "thick fluffy" test on
**two independent axes**, and the obvious fix only addresses one.

1. **Shading (soft / fluffy):** the ground is lit like an opaque painted sheet. The
   colorNode uses a single **hard** `clamp(dot(N, moonDir), 0, 1)` with no wrap, a
   **near-black shadow floor** (`uDeep 0x0a1f3d`), and **no subsurface glow / valley
   occlusion**. Real snow is a strong *multiple-scatterer*: soft terminator, luminous
   **blue** (never black) shadows, edges that glow when backlit. A hard terminator is
   the #1 "flat painted plane" tell.

2. **Form / silhouette (thick / deep) — the part the obvious plan misses:** the camera
   sits only ~358 units above the ground looking *along* it toward the lake/peaks. At
   that grazing angle, **shading changes barely read** — what reads is the *silhouette*
   and *profile*. And the current form says "thin coat":
   - The displacement is **symmetric value noise** → a wavy *sheet*, not convex domes.
   - The lake-basin blend **flattens the shore to a knife-edge** (`h *= 0.05 + 0.95*basin`)
     — a hard seam at the ice is the single most damning "thin sheet" tell in frame.
   - Amplitude (130 over a 12000×7000 plane) reads as gentle undulation, not deep powder.

**So:** a wrap+SSS+AO pass alone would come back "softer, but still looks like a thin
sheet." The first wave must change **form**, not just shading.

## Decision: stay UNLIT, extend the hand-faked shader (do NOT switch to MeshStandard)

The ground is 50–70% of the lower screen on an iGPU already at ~88 fps. A lit
`MeshStandardNodeMaterial` adds the full PBR path (~40–60 ALU/fragment → modelled **~36 fps**)
and breaks the all-unlit painterly grammar every other surface uses (sky, moon, lake,
rocks). The fluffy levers — wrap light, backlit SSS, valley AO, crest highlight, billowy
form — are **all hand-faked-friendly** (~10 extra ALU total → ~77–85 fps) and let us
**overshoot warm/bright** to survive the in-game WinterPipeline grade (exposure 0.82 +
ACES + cold tint), which a physically-based material would fight. Precedent: the summer
meadow grass reads fluffy via an *unlit* backlit-SSS term, no PBR.

All hooks below are in `buildFacetedSnowDrifts` → [winter-wonderland.effect.js:255-340](../src/playground/effects/winter-wonderland.effect.js#L255-L340).

## Wave 1 — "Minimum Viable Fluffy" — ✅ SHIPPED & playground-verified (2026-06-21)

Implemented in `buildFacetedSnowDrifts`; ~134–210 fps, no console errors, foxes still
ground-follow. Tuning landed at: `amp 205`, `lipAmp 105`, billow octaves `0.44/0.36/0.22`
(broad/mid/fine), `uWrap 0.4`, `uLit 0xcfe0f8`, cool floor `uSky 0x213f73 / uShadow 0x18305a
/ uGround 0x111f3c`, `uSssTint 0x8c9cd9 @ 0.24`, dimmed grain `norStrength 0.5 / tooth
[0.9,1.08]`. **Lesson:** first attempt over-lifted the shadow floor + over-wrapped → washed
out and the dome form vanished (the critic predicted this); pulling contrast back + adding a
mid-scale drift octave is what made the pillows read. The foreground now reads as soft rolling
deep drifts with blue-shadowed valleys + a snow bank at the shore. **In-game grade still needs
a user capture.**

Chosen so a **single capture** changes both silhouette *and* shading — the only way
"thick layer" can be judged true/false. Form levers are **vertex-only (free on the
fragment hot path)**.

| # | Lever | Kind | Impact | Effort | Perf |
|---|-------|------|:---:|:---:|:---:|
| 1 | **Billowy rounded displacement** — `abs/billow` FBM + `smoothstep` round → convex domes, not a wavy sheet | vertex (CPU) | 5 | 2 | 1 |
| 2 | **Lake-edge snow LIP** — a raised rounded shore hump before the basin flatten, so the snow shows its *cut depth* at the ice instead of a knife-edge | vertex (CPU) | 5 | 2 | 1 |
| 3 | **Near-field amplitude bump** — raise `amp` ~130→~190 (and/or a distance-gated near octave) so drifts under/ahead of the camera have real vertical presence | vertex (CPU) | 4 | 1 | 1 |
| 4 | **Wrap / half-Lambert** — replace hard `dot` with `clamp((ndl+w)/(1+w),0,1)` (then square for contrast) → soft scattering terminator | fragment | 5 | 1 | 1 |
| 5 | **Cool sky-bounce + backlit SSS floor** — lift `uDeep`→a periwinkle sky-ambient; add a view-gated translucency lobe `pow(clamp(dot(-N,moonDir)+wrap,0,1),2.5)` so ridges glow and shadows go luminous blue | fragment | 5 | 2 | 1 |
| 6 | **Dim the PolyHaven `nor_gl` tooth** 0.7→~0.35 (and ease the diffuse tooth) — the photoreal grain (added last session) *fights* the soft-pillow target; cutting it is a **net perf gain** that funds 4+5 | fragment | 3 | 1 | −1 |

**Wave-1 TSL specifics**

- **#1 billow** (loop ~line 275): `billow = abs(2*valueNoise-1)` summed 2–3 octaves; round
  with `b=smoothstep(0,1,billow); b=b*b*(3-2*b); h=pow(b,1.4)*amp`. Keep
  `computeVertexNormals` (smooth, already set).
- **#2 lip** (basin blend ~line 284): where `basin` is in a narrow shoreward band, add a
  positive half-cosine hump before the flatten so the snow rolls over into the ice.
- **#4 wrap** (line ~313): `uWrap≈0.55`; `litAmount = clamp(moonWrap²·0.7 + upFace·0.45, 0,1)`.
- **#5 floor/SSS** (lines ~316): `skyAmb = mix(uGround, uSky, saturate(N.y*.5+.5))`;
  `uSky≈0x2a4c86`, `uSssTint≈vec3(.55,.62,.85)*0.30`. **Overshoot brighter than looks right.**
- **#6**: `norStrength 0.7→~0.35`, `tooth [0.82,1.16]→[0.9,1.08]`.

## Wave 2 — finishing pass — ✅ SHIPPED (#7,#8,#10), #9 deferred (2026-06-21)

Cheap, and #7/#8 share a baked-attribute pass (`aHeight`, `aOcclusion`) computed in the CPU
displace loop. Verified at ~161 fps, no console errors, foxes still ground-follow.

| # | Lever | Impact | Effort | Perf | Status |
|---|-------|:---:|:---:|:---:|:---:|
| 7 | **Valley AO** from a baked per-vertex concavity attribute → darkens troughs so the form reads as depth | 4 | 2 | 1 | ✅ |
| 8 | **Crest highlight** — `aHeight` brightens mound tops with a cream-warm dusting (bulge toward the moon) | 3 | 1 | 1 | ✅ |
| 9 | **Accumulation collars** — a build-time Gaussian mound where snow piles against rocks / spruce / peak bases (kills the "decal sitting on snow" look) | 3 | 3 | 1 | ⏳ deferred — needs object XZ positions passed into the builder; low visibility at the current framing (rocks/trees sit at screen edges) |
| 10 | **Sparse half-vector sparkle** — gate the existing glint by view+light half-vector + time twinkle → crisp dry-powder crystals (one layer only) | 2 | 2 | 2 | ✅ |

**Wave-2 impl:** the displace loop now stores `hArr` and bakes two `BufferAttribute`s —
`aHeight` (normalized) and `aOcclusion` (grid 4-neighbour concavity → smoothstep). In the
colorNode, `aOcclusion` multiplies the shadow-floor + SSS (valleys darken, crests untouched),
`aHeight` drives a `smoothstep(0.52,0.95)` crest mask mixed toward a warm-cream `uCrest`. The
sparkle is now a world-space half-vector `pow(dot(N,H),180)` gate × a `uTime`-panned noise seed
(`uTime` is exposed from the builder and driven in the effect update loop). Starting params:
`aoWin 22`, AO floor `0.55`, crest strength `0.4`, sparkle align pow `180` / threshold `0.9`.

## Avoid (with reasons)

- **Parallax-Occlusion Mapping** — r0.181 ships no `parallaxOcclusion` node (only single-step
  `parallaxUV`); a hand-rolled loop needs `.level(0)` taps (WGSL bans derivative sampling in
  loops → loses mips, aliases on the receding plane), 8–32 taps/fragment over half the screen
  on an 88 fps ground = the most likely fps-killer, for marginal payoff at a grazing angle.
- **Shell / slab texturing** (N layers) — multiplies fragment+overdraw cost by N on a
  full-screen ground.
- **Switching to MeshStandard now** — ~36 fps modelled; breaks the unlit grammar; fights the grade.
- **A 2nd `nor_gl` texture sample** for multi-scale normals — bandwidth on the hot ground;
  derive extra relief procedurally (ALU) if wanted.
- **Pushing the photoreal tooth harder** — Firewatch / Sea of Thieves get fluffy from the
  *absence* of texture noise. Dim it (#6), don't add more.
- **Real SSAO / shadow-map** — needs depth/MRT; `useMRT:false` rules it out. Use the baked
  vertex AO + slope-gated self-shadow.

## Open questions (resolve via screenshot)

- After wrap (#4) + lifted floor (#5), does it over-brighten and lose the cobalt-night mood
  in the **flat** playground? It must look slightly *too* bright/warm there to survive
  ACES+0.82+cold-tint in-game — and I can only capture the flat playground. Lean on **form**
  (#1/#2) for the fluffy read, since form survives the grade and over-brightening doesn't.
- Does the billow reshape (#1) + amp bump (#3) shift heights enough to break the **arctic-fox
  ground-follow raycast** (`drifts.mesh`, ~line 767) or push drifts through the **ice plane** at
  the basin? Re-verify fox feet + ice seam after.
- AO floor (~0.55?) and concavity window that read "deep powder shadow" vs "dirty/bruised snow"
  once the cold grade saturates the blue.
- Does dimming `nor_gl` (#6) read softer, or leave large dead untextured gradients? Fallback: a
  faint **procedural** large-scale value-noise tooth `[0.92,1.06]` instead of the photo grain.

## Recommended first step

Implement **Wave 1 (#1–#6) in one session**, screenshot in the playground, tune the
overshoot, then iterate. Wave 1 is the combination that changes silhouette + form + light
together — the honest test of "thick fluffy layer."
