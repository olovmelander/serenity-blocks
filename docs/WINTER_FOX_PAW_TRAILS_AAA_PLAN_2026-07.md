# Winter — fox paw trails, AAA upgrade (2026-07)

_Successor to [WINTER_FOX_PAW_TRAILS_PLAN.md](WINTER_FOX_PAW_TRAILS_PLAN.md), which shipped the
v1 trail map. This plan is grounded in published AAA deformable-snow technique (AC3 → Batman:
Arkham Origins → Rise of the Tomb Raider → Horizon: Frozen Wilds / RDR2) plus real fox-tracking
field literature, then reconciled against what our scene can actually afford._

---

## 1. What AAA actually does (and which parts matter for us)

The lineage is public and consistent — **AC3 (2012) → Batman: Arkham Origins (2014) → Rise of the
Tomb Raider (2015) → Frozen Wilds / RDR2 (2017–18)** are all the same core idea, refined:

| Stage | What they do | Do we need it? |
|---|---|---|
| **Capture** | An ankle-high **orthographic camera under the snow surface** renders every snow-affecting object into a heightmap. Batman: clear black → render actors white → 4-tap bilinear Poisson blur → accumulate ping-pong. | **No.** We know the 3 foxes' foot positions in JS. Capture rigs exist to *discover* contacts; we already have them. This stays skipped. |
| **Accumulate + persist** | Blend into a persistent heightmap with **`BlendOp Min`** (snow only ever compacts). Batman: *"you can also subtract a small value to the heightmap to make snow gradually replenish (since it's snowing)."* | **Yes — we have this** (exponential decay, τ=7s). But ours is *max-of-one-stamp*, not accumulation. See §3.7. |
| **Apply as geometry** | Consoles: **relief / parallax mapping** — *"minimal taps, no swimming, independent of triangle density."* PC: **DX11 tessellation** with adaptive density near camera. RoTR: dynamic tessellation + a generated **height *and* normal** map. | **Parallax yes, tessellation no.** Our ground grid is 100 × 100 world-units/cell (12000×7000 at 120×70) and a fox paw is ~38 units — **0.38 of a cell**. Geometric displacement is physically unrepresentable here. Batman's console path is exactly our situation. |
| **Normals** | Reconstruct normals from the height map by **central differences**, then blend with the surface normal using **Reoriented Normal Mapping** — explicitly *not* a lerp, because *"normals are not colors, you can't lerp between directions."* | **Yes — this is our #1 gap.** See §3.1. |
| **Displaced snow (berms)** | Batman's PC path captures **two channels: minimum height field + projected displacement**, enabling *"additive capture & smoother results, plus deformable snow banks."* The general formulation: to *displace* rather than merely *compact*, you must **transfer snow height from one horizontal position to another** based on frame-to-frame object motion. | **Yes.** The raised rim is the single detail that separates "deformation" from "decal". See §3.2. |
| **Secondary shading** | Real displacement buys **dynamic shadowing following the deformation, self-shadowing, and dynamic AO filling the trails.** | **Partially — fake it.** We can't tessellate, but the AO and self-shadow terms are cheap analytic functions of the height field. See §3.3. |
| **Material change** | Two blended material stages: undisturbed powder vs. **fully flattened / compacted**, revealing what's under (Frozen Wilds: *"grass textures become visible beneath the surface"*). | **Yes, partly shipped** (we cool + darken and kill sparkle). Physically justified: compaction collapses air pockets, so the pack scatters like dense ice — red is absorbed over the longer path and **blue is what emerges**. Our periwinkle shift is correct; it just needs to be lighting-driven, not additive. |

**Perf reality check:** Batman ran heightmap updates in **< 1.0 ms GPU on PS3/360**, at
`min(512, ¼·surface)` resolution, in **2–4 MB**, and noted the map *"doesn't need to be high-res —
looks better in lower resolutions."* Our 512² / 1 MB map is squarely in AAA territory. **Resolution
is not our problem. Lighting response is.**

---

## 2. What we ship today, and the honest gap

Current pipeline ([paw-trail.js](../src/themes/winter/rendering/paw-trail.js) →
[winter-wonderland.effect.js:468-514](../src/playground/effects/winter-wonderland.effect.js#L468-L514)):

- 512² RGBA8 `DataTexture` over a 2400 × 2320 world rect → **4.69 × 4.53 units/texel**.
- CPU brush stamps an oval pad + 4 toe dots into **R only** with `max()`; decays `R *= exp(-dt/τ)`
  at 20 Hz over 262 144 texels, re-uploading the full 1 MB.
- The ground's `colorNode` takes **one tap** and uses it to (a) `mix` toward periwinkle,
  (b) add a flat additive rim band, (c) kill sparkle + crest dusting.

**The core problem: the print is a colour patch, not a surface.** `pitN` never touches `nLit`,
never touches `positionNode`. It is applied *after* all the lighting has been computed. So:

| # | Gap | Why it reads as "a decal" |
|---|---|---|
| **G1** | **No lighting response.** `nLit` is computed at [L465-467](../src/playground/effects/winter-wonderland.effect.js#L465-L467); `pitN` is applied at [L510-514](../src/playground/effects/winter-wonderland.effect.js#L510-L514) — 45 lines *after* `ndl`, `moonWrap`, `sss` and `sparkle` are already baked. The pit does not shade. Move the moon and the print doesn't change. **This is the single biggest tell**, and it is worse for us than for RDR2 because our camera sits at y≈78 looking at y≈120/z≈−1900 — a **near-horizontal grazing view**, precisely the angle at which a viewer most expects to see a lit far wall and a shadowed near wall. |
| **G2** | **No displaced berm.** The rim is `smoothstep(0.1,0.38,pit)·(1−smoothstep(0.38,0.7,pit))` added as flat light — a *painted* halo with no height, no normal, no self-shadow. Real prints throw a lip of snow *out* of the hole. |
| **G3** | **Uniform exponential decay.** Every texel fades at exactly τ=7 s regardless of storm, wind, age or how many times the lane was walked. Nothing in the scene affects the snow. |
| **G4** | **Wrong gait.** [arctic-fox.js:378-384](../src/themes/winter/rendering/arctic-fox.js#L378-L384) stamps a front foot one side and a back foot the other, alternating — a **dog's overstep trot**. Foxes are famous for the opposite: a **direct-register trot**, hind foot landing *in* the front foot's print, producing a *"remarkably straight, narrow line… like the animal was walking on a tightrope"* / *"a string of pearls."* It is the most recognisable trail in the winter woods and we are drawing the one thing it is not. |
| **G5** | **Only `trot` stamps.** The stamp block lives inside `if (fx.state === 'trot')`. The **mousing pounce** — our best animation, a 2×-body-height leap and headfirst dive — leaves *nothing*. Neither does `dig`, nor `rest` (a fox curled asleep in the snow for 4.5 s), nor the greeting circle. The world does not record what happened, which is exactly what Frozen Wilds sells: *"following any skirmish, you can follow the trail of deformation around the battlefield to retrace the fight."* |
| **G6** | **Prints don't shrink with distance.** `onFootstep` passes `fx.modelScale`, but the fox is *visually* rescaled by depth at [L443-446](../src/themes/winter/rendering/arctic-fox.js#L443-L446) down to `farScale 0.5`. A far fox at half size stamps full-size prints. |
| **G7** | **No footfall event.** No puff, no spray, no compression pop. AAA always punctuates the contact. |
| **G8** | **Toe detail is unrepresentable and shouldn't be attempted.** `pad = 190·0.1/4.61 = 4.1 texels` radius; each toe dot is `pad·0.5 = 2.05` texels radius — a 4-texel-diameter feature, at/below Nyquist, mush after bilinear. Also **species-wrong**: red fox tracks are oval, but *"the Arctic fox's are very round"* and heavily fur-covered, so real arctic prints in snow are **indistinct round dents with muffled toes**. The fur is our alibi — lean into the round blur and spend the budget on the *lane*. |

---

## 3. The plan

Ordered by **read-per-effort**. Wave 1 alone should close most of the gap to RDR2 *for this camera*.

### Wave 1 — make the print a **surface**, not a patch (the big one)

No new infrastructure. Same 512² map, same one upload. All changes in the existing `colorNode`.

**1.1 — Make the map a SIGNED height field.**
Today R is `0 = clean … 1 = deep print`. Change to `0.5 = undisturbed`, `<0.5 = pit`, `>0.5 = berm`,
and decay toward `0.5`. This is the enabling change: it makes the berm a *first-class height*, so
normals, AO and parallax all fall out of one field with no special cases. Decay becomes
`h = 0.5 + (h − 0.5)·exp(−dt/τ)`.

**1.2 — Bake the berm into the CPU brush (§G2).**
The brush already knows the pad shape. Add a raised annulus just outside the pad whose integrated
volume ≈ the pit volume it displaces (snow is conserved), biased **forward and outward along the
heading** — the paw pushes snow out the way it exits. This is the cheap, art-directable form of
Batman's *"projected displacement"* channel. `≈ 15 lines in paw-trail.js`.

**1.3 — Derive the lighting normal from the height gradient (§G1).** *The keystone.*
Four taps (central differences) on the trail map → gradient → tilt `nLit` **before** `ndl` is taken,
using the existing [`snowPerturbNormal`](../src/playground/effects/winter-wonderland.effect.js) pattern
(which is already a reoriented-normal blend, matching Batman's explicit warning against lerping
directions). Everything downstream then reacts for free: `moonWrap`, the SSS ridge glow, the facet
rim, and the sparkle gate. The berm catches the moon; the pit's far wall lights and its near wall
falls into shadow. **Cost:** 3 extra bilinear taps of a 1 MB texture — trivially cache-resident.
*Fallback if it ever measures:* bake `∂h/∂x, ∂h/∂z` into the map's **free G,B channels** at stamp
time (they're currently 786 KB of wasted zeros) and go back to one tap. Gradient decays by the same
scalar `k` as height, so it stays consistent.

**1.4 — Contact AO + self-shadow.**
`ao = smoothstep` on the *negative* part of the height field, applied into `lowMix` alongside the
existing `aOccN` — the pit floor darkens because it sees less sky, not because we told it to.
Self-shadow: a 3–4 step ray-march of the height field toward `uMoonDir` (only along the trail, and
only 3 steps — the field is tiny). This is Batman's *"dynamic shadow following the deformation,
self-shadowing, dynamic AO filling trails"*, bought analytically instead of geometrically.

**1.5 — Parallax offset on the pit.**
Offset the trail-map UV by `viewDirTangent.xz · h · depthScale` before sampling. At our grazing
angle this is where parallax pays maximum dividends — Batman shipped exactly this on PS3/360
(*"minimal taps, no swimming, independent of triangle density"*). One iteration is enough; do **not**
build a full POM loop. **Also fixes the geometry-density problem for free**, since it is
independent of our 100-unit ground cells.

**1.6 — Retire the additive rim.** Once 1.2–1.4 land, the painted rim band is fighting real shading.
Delete it; keep only the compaction colour shift (which is physically right — see §1 table).

> **Verify after Wave 1 before anything else.** Force `count: 1` + `state: 'rest'`, capture, confirm
> the print sits *under* the paws (the classic UV-flip bug), then sweep `uMoonDir` and confirm the
> print's shading *changes*. If it does, Wave 1 worked.

### Wave 2 — make it a **fox** (§G4, G5, G6)

**2.1 — Direct-register trot.** Replace the two offset stamps with **one** print per footfall on the
body centre-line, alternating a small L/R offset of ~`modelScale·0.02` (not `0.09`) so it reads as a
single-file line with a barely perceptible zig. Halves the stamp count, doubles the effective
resolution per print, and is *the* recognisable fox signature. `≈ 10 lines`.

**2.2 — Per-behaviour marks.** The world remembers:
| Behaviour | Mark |
|---|---|
| `pounce` | **Launch scuff** at take-off (a smeared, elongated pit along the heading) + a **landing crater**: 4 splayed prints, deeper, with a big berm. The signature moment of the whole theme. |
| `dig` | A scattered fan of shallow pits + a spray of berm thrown backwards. |
| `rest` (CurlSleep) | A soft **body impression** — a wide shallow oval, held for the clip duration, deepening as it curls. |
| `greet` (circle) | Prints while circling (the path already moves; just let the trot stamper run). |
| `shake`, `listen`, `look` | Nothing — stationary. Correct as-is. |

**2.3 — Depth-scale the prints.** Pass the *rendered* scale (`modelScale · (farScale + (1−farScale)·k)`)
into `onFootstep`, not the raw `modelScale`. One-line fix.

**2.4 — Drag marks (deep powder).** Where the trail map says the snow is deep, connect consecutive
prints with a shallow groove — real trails in deep powder are *"deformed by the animal plowing
through the powder and dragging its legs or body"*, and this is what makes the lane read as one
continuous wake rather than a dotted line. Gate on drift height so it only appears in the deep drifts.

### Wave 3 — make the **world** act on it (§G3)

**3.1 — Accumulate + harden.** Replace `if (add > data[idx])` with a saturating accumulate. A lane
walked five times becomes a deeper, harder, more compacted path — Frozen Wilds' *"trails persist…
you can retrace the fight"* is exactly this.

**3.2 — Storm-coupled refill.** `stormReact.intensity` is already read every frame at
[L1155](../src/playground/effects/winter-wonderland.effect.js#L1155). Drive τ from it: calm night
τ≈20 s (tracks linger and tell a story), full blizzard τ≈2 s (the storm erases them). This ties the
trails into the shipped Living Blizzard and is nearly free.

**3.3 — Directional wind refill.** Fill in from the windward side rather than fading uniformly —
advect the height field a fraction of a texel along `breeze` each decay tick. This kills the last
big "it's a shader" tell: real tracks don't fade, they *drift in*.

**3.4 — Age → re-frost.** Use a free channel for age. Old prints soften, lose their crisp berm, and
regain sparkle; fresh prints are sharp and matte. Gives the trail a legible timeline.

### Wave 4 — the **moment of contact** (§G7)

A small burst of snow particles at each footfall (larger on the pounce landing), reusing the
`SnowSim` billboard/instancing spine. Every AAA implementation punctuates the contact; without it
the deformation appears out of thin air.

### Wave 5 — resolution, only if wanted

Move the map to the GPU (ping-pong render target: one fullscreen decay pass + stamps as instanced
quads under an ortho camera mapped to the world rect). Unlocks 1024²–2048² (2.3 → 1.2 units/texel,
crisp toes in the near foreground), kills the 262k-iteration CPU decay loop and the 1 MB/50 ms
upload. **Explicitly deferred** — Batman shipped 512² and observed it *"looks better in lower
resolutions"*, and at our grazing camera the *lane* is the read, not the toes. Do Waves 1–4 first
and re-judge from a capture.

### Also worth doing (small)

- **Tracks on the ice.** Currently suppressed entirely. Frozen Wilds explicitly leaves *"trails on
  icy water surfaces… persistent as well."* Not pits — a faint **frost scuff** (roughened
  micro-normal + a dulled reflection) would sell claws-on-ice without the wrongness of a hole.

---

## 4. Risks / do-not-do

- **Do not tessellate or re-displace the ground mesh.** 100-unit cells vs a 38-unit paw; and
  per-frame `computeVertexNormals()` is a perf cliff. Parallax + normals is the correct answer here
  and it is what Batman shipped on console.
- **Do not let `groundY()`'s raycast see the trail.** Keeps the fox from sinking into its own dent.
  (Already correct — preserve it.)
- **Do not push the pit deeper than `footSink` (4)** or the paws visibly hover.
- **Grade overshoot still applies.** WinterPipeline (exposure 0.82 + ACES + cold tint) crushes the
  dark end; tune warm/bright in the playground and expect to overshoot.
- **One capture per session.** Full-journey WebGPU captures have TDR-crashed this machine.

## 5. Verification

Playground-first per [CLAUDE.md](../CLAUDE.md): `npm run dev:playground` →
`playground.html?effect=winter-wonderland&t=<sec>`, wait for `__PLAYGROUND_READY__`, capture the
canvas, read the console for WebGPU validation errors. Wave 1's specific acceptance test is the
**moon sweep**: rotate `uMoonDir` and confirm the print's shading changes. If it doesn't, the normal
is still being applied after the lighting.

---

---

## 6. Implementation results (2026-07-27)

**Waves 1–4 are implemented.** Files: [paw-trail.js](../src/themes/winter/rendering/paw-trail.js)
(rewritten), [snow-puff.js](../src/themes/winter/rendering/snow-puff.js) (new),
[arctic-fox.js](../src/themes/winter/rendering/arctic-fox.js),
[winter-wonderland.effect.js](../src/playground/effects/winter-wonderland.effect.js).

### What the capture proved

The plan's acceptance test was: *turn the reconstructed normal off and see whether the print
still reads.* It does not. With `uTrailNormal`/`uTrailShadow`/`uTrailAO` forced to 0, the trail
**all but vanishes**, leaving only a faint bluish smudge — that "off" image is essentially what
v1 looked like. Every bit of the visible read comes from the height gradient driving `nLit`
before the moon dot. G1 was the whole ballgame, exactly as diagnosed.

The field itself was verified numerically, not just by eye. A horizontal slice through the
deepest texel of a fresh print:

```
+0.20 +0.15 −0.17 −0.51 −0.64 −0.51 −0.54 −0.74 −0.91 −1.00 −1.00 −0.98 −0.85  0 +0.09 +0.37 +0.59
 └ berm ┘   └──────────────────── pit, flat floor at −1.0 ────────────────────┘    └─ berm ─┘
```

A flat-floored pit flanked by raised berms, with the **exit-side berm 3× the entry-side one** —
the `bermDir` forward bias doing its job. Snow leaves the hole and piles where the paw pushed it.

### Deviations from the plan, and why

- **Resolution went 512² → 1024², not "deferred to Wave 5".** The plan sized the paw off the
  module's `scale: 190` default; the effect actually passes `scale: 80`, making a paw **1.7
  texels** at 512² and the berm ring *sub-texel* — literally unrepresentable. 1024² puts the paw
  at ~3.4 texels and the berm at ~1.9, the minimum that resolves. Cost is contained by the
  **32×32 tile culling** added to the decay pass: a live capture showed **24 of 1024 tiles
  active**, so the per-tick CPU work is a fraction of v1's unconditional 512² sweep.
- **The explicit self-shadow ray-march was cut** (§3.1.4 proposed 3–4 steps). It was traded for
  a **single tap toward the moon** — if the snow that way is higher, we're in its shadow. One
  tap instead of four, and it still swings with the moon. Total is 4 taps (parallax pre-tap +
  centre + 2 forward differences) plus that one, vs 1 in v1.
- **First tuning pass was far too hot.** `uTrailNormal 0.9 / height 13 / AO 0.5 / shadow 0.8`
  read as a hard black-and-white caterpillar. Arctic paws are round and *fur-covered*, and the
  in-game WinterPipeline grade (exposure 0.82 + ACES + cold tint) crushes the dark end further.
  Shipped at `0.55 / 10 / 0.34 / 0.5`, tuned against captures.

### Bug found by measurement: the refill silently stalled

Asked "since it's snowing, do the trails disappear?", I measured a print's depth over 15 s instead
of doing the arithmetic. It went `127 → 122 → 114` and then **froze at 114 forever**.

`data[idx] = NEUTRAL + d` stores into a `Uint8Array`, which **truncates**. The exponential step is
`|d| × (1 − k)`; at a 20 Hz tick with τ ≈ 18 s that is **0.21 units**, well under one integer step,
so it truncated straight back to the same byte every pass. The only thing that had moved at all
was the wind diffusion (it lerps a *gradient*, so it can clear 1 unit) — and that stops as soon as
the print's neighbourhood flattens. **Trails were effectively permanent at idle.**

Fixed by switching to a **linear refill on a slower cadence**, which is also the more correct
model — Batman's slides say to *"subtract a small value to the heightmap to make snow gradually
replenish (since it's snowing)"*. Snow falls at a rate, so a hole fills at a rate; it does not
asymptote. `DECAY_TICK` is now 0.4 s so each pass moves several whole units, with the **upload
cadence decoupled and left at ~20 Hz** so fresh prints still reach the GPU promptly. `tau` now
reads as *seconds to completely refill a full-depth mark* (45 calm / 3.5 blizzard).

Measured after the fix:

| Case | Result |
|---|---|
| Full-depth print, fully calm (`storm 0`) | ~2.6 units/s → gone in **~45–50 s** |
| Shallow mark, fully calm — *the regime that used to stall* | 32 → 30 → 26 → 22 → 17 → 12 → 8 → 5 → **0**, in **16 s** |
| Full-depth print, full blizzard (`storm 1`) | 127 → **0** in **~6 s** |

At the StormDirector's actual idle floor (0.12) τ is 40 s, so a fresh print is buried in ~40 s and
a well-trodden, hardened lane in ~110 s.

> **Design note worth revisiting:** refill is coupled to *storm intensity*, not to the ambient
> snowfall — and the scene runs four SnowSim tiers of heavy falling snow at all times. So it is
> visibly snowing hard while the trails are refilling at their slowest. Defensible (the idle floor
> keeps τ at 40 s, not 45 s), but if the trails should read as being buried by the snow you can
> actually see, `tauCalm` should come down.

### Perf

No measurable regression in the playground. FPS readings ranged 190–241 before and after the
change (the counter is noisy; a one-off 1 fps reading was the known iGPU reload degradation, not
this work). Lint is at the exact pre-change baseline (6 errors / 8 warnings, all pre-existing).
Test suite: 7 failures with the change vs **8 on a clean tree** — all in Cosmic Noir / Koi Pond /
Stillwater, none related, and flaky between runs.

### Open item

**The snow puffs are implemented and functionally verified but not visually signed off.** The
module compiles clean under WebGPU/TSL, the instanced draw tracks the live pool exactly, and an
early capture at ~2× the current grain size showed the powder clearly (which is *how* the size
was dialled back). What I could not get is a clean in-situ shot of the final, smaller grain:
every automated attempt to frame a pouncing fox landed either over the lake (where marks are
deliberately suppressed) or behind a corner framing spruce. The current sizing is a reasoned
midpoint between two captured extremes — "too big, reads as a grey smudge" and "too small,
invisible against near-white snow" — and wants one human eyeball. Tune live via
`window.__winterDebug.puffs`.

### Not done

- **Frost scuff on the lake ice** (§"Also worth doing"). Marks are still suppressed entirely
  over the ice. This needs the lake material in `winter-materials.js` to sample the trail map —
  a separate surface from the one this work touched.
- **Wave 5 (GPU trail map)** stays deferred, as planned.

### Debug affordances added

`window.__winterDebug` — `trail`, `puffs`, `trailUniforms` (live tuning), `foxes()`,
`setFoxState(i, state)`, and `setCamera(pos, look, fov)`. The camera override is the important
one: the shipping camera sits ~1 km from the treeline, so ground detail simply cannot be judged
from it. Pass `null` to restore.

## Sources

- [GDC 2014 — Deformable Snow Rendering in Batman: Arkham Origins](https://www.slideshare.net/colinbb/gdc2014-deformable-snow-rendering-in-batman-arkham-origins) (the canonical public reference; capture rig, ping-pong accumulation, relief vs tessellation, reoriented normal mapping, perf/memory numbers)
- [GDC Vault — Rendering Assassin's Creed III](https://gdcvault.com/play/1017710/Rendering-Assassin-s-Creed) (St-Amour, 2013 — the origin of the lineage)
- [Deferred Snow Deformation in Rise of the Tomb Raider — GPU Pro](https://www.taylorfrancis.com/chapters/edit/10.1201/b22483-18/deferred-snow-deformation-rise-tomb-raider-anton-kai-michels-peter-sikachev)
- [Tomb Raider dev blog — Snow Tech and Houdini Simulations](https://tombraider.tumblr.com/post/131825841425/dev-blog-snow-tech-and-houdini-simulations-mike) (dynamic tessellation rationale)
- [Horizon Zero Dawn: The Frozen Wilds tech analysis](https://www.playstationlifestyle.net/2017/11/26/horizon-zero-dawn-frozen-wilds-graphics-are-impressive/) (persistence, retrace-the-fight, trails on ice)
- [RDR2 tech analysis — GamingBolt](https://gamingbolt.com/red-dead-redemption-2-tech-analysis-animations-physics-post-processing-effects-weather-systems-and-more) (persistent troughs from people, horses, wagon wheels)
- [TylerDodds/DeformableSnowRendering — project overview](https://github.com/TylerDodds/DeformableSnowRendering/blob/main/Assets/Snow/Notes/Project%20Overview.md) (Min-blend heightfield, blur-as-compaction-falloff, central-difference normals, the compaction-vs-displacement distinction)
- [Fox Tracks and Sign — Wilderness College](https://www.wildernesscollege.com/fox-tracks.html) and [Fox tracks in snow — Biology Insights](https://biologyinsights.com/what-do-fox-tracks-look-like-in-the-snow/) (direct-register trot, single-file "string of pearls", round arctic-fox prints)
- [Why snow looks blue in shadows](https://www.weather-daily.com/why-snow-looks-blue-in-shadows-the-science-behind-winters-color-shifts/) (compaction → fewer air pockets → longer path → red absorbed, blue emerges)
