# Winter — fox paw trails (RDR2-style dynamic snow)

_Grounded in a 6-agent investigation (RDR2/AAA deformation research, real-time trail
techniques, TSL/WebGPU feasibility, code audit) + an adversarial completeness check.
2026-06-21._

## Verdict — the right architecture for THIS scene

We already know the 3 fox foot positions in JS every frame, so we **skip the entire AAA
capture-camera/depth-compare rig**. The best fit is a **persistent CPU `DataTexture` "trail
map"**, stamped with paw marks at each fox footfall, decayed each frame, and **sampled once
in the snow ground's existing unlit `colorNode`** to darken/pack the trail. No extra render
pass, no compute, no ping-pong — just one small texture upload + one texture tap on the
ground shader.

The dominant read at this grazing camera distance is **"a fox trotted across here"** (a
darkened, rimmed lane of alternating marks); articulated toe-beans only survive in the near
foreground. That's RDR2's actual read at distance too — so we lean into the *trail*, and let
the paw shape reward close-up moments.

## Why not the alternatives

- **AAA tessellation + capture camera** — pointless; we have the positions directly.
- **Per-frame mesh re-displacement** — blows the ~140 fps budget; the 120×70 grid (~100 u/cell)
  is far too coarse to resolve a paw anyway.
- **Uniform footstep buffer + `Loop(32)` in the shader** — tempting as "simpler," but it runs
  O(32) per fragment over the *entire* 12000×7000 ground every frame for a trail that occupies
  <5% of it — a *perf regression* vs the 1-tap texture. Rejected.
- **Instanced flat decal quads** — z-fight / hover on the billowy `amp 205` domes unless each
  quad is raycast + tilted per stamp, and they only darken (no lighting response). More fiddly
  here, not less.

## The plan (corrected by the adversarial pass)

All hooks: new module `src/themes/winter/rendering/paw-trail.js`; edits to
[arctic-fox.js](../src/themes/winter/rendering/arctic-fox.js) (foot timing) and
[winter-wonderland.effect.js](../src/playground/effects/winter-wonderland.effect.js)
(`buildFacetedSnowDrifts` colorNode + the update loop).

### Minimum-viable (one capture) — fragment-only, paw-shaped

| # | Step | Notes |
|---|------|-------|
| 1 | **512² RGBA8 `DataTexture`** over a tight rect snug to the foxes' wander box: `origin=(-1200,-1880)`, `size=(2400,2320)` → **~4.7 u/texel**. (256² or the full ground is too coarse — a fox paw at `scale 80` is only ~12–30 u, so it must span ≥~4 texels.) `flipY=false`, Linear/ClampToEdge, no mipmaps. |
| 2 | **Pre-baked paw brush** — a small JS-drawn alpha kernel (oval pad + 4 toe dots) blitted with `Math.max` into channel **R** (depression); a bright **rim** (difference-of-Gaussians annulus) baked into **G**. This is load-bearing — round dots ≠ paws. |
| 3 | **Foot timing** in arctic-fox.js — accumulate distance from `prevX/prevZ`; every ~half-stance drop a print, **alternating an L/R perpendicular offset** along the heading. Only `trot`/`greet-circle` stamp; pounce/rest stamp a single landing print. **Suppress prints over the lake basin** (`lakeHalfX/Z`) — tracks read wrong on reflective ice. |
| 4 | **Decay** — multiply R by `exp(-dt/tau)`, `tau≈7s` (cozy slow refill); G lingers slightly longer. One typed-array pass; `needsUpdate` while non-empty. |
| 5 | **Sample in colorNode** — `pit = trail.r`: darken + cool toward periwinkle `mix(snowCol, snowCol*vec3(0.74,0.82,0.97), pit*uDarken)`; **kill the powder twinkle + crest dusting inside prints** via `*oneMinus(pit)`; add the **rim** from G, overshot warm/bright (grade-safe). |
| 6 | **Verify** — capture with a **stationary** fox first (force `rest`, count=1) to confirm the print sits *under* the paws (the classic flip/mapping bug), then capture the moving trail. |

### Stretch (only if the flat print doesn't read)

- **Shallow vertex dip** — `positionNode` samples the trail to sink the lane. ⚠️ must use
  `.level(0)` (no vertex derivatives), UV must use `positionLocal.z + 1400` (the mesh's posZ
  offset — *not* raw local z), and keep `uDip ≤ footSink (≤4)` or the feet hover over the dent.
- **Normal tilt from the trail gradient** — 4 fragment-stage taps → tilt `nLit` *before* the
  moon dot so `ndl`/SSS/sparkle all react (reuses the `snowPerturbNormal` pattern). If it costs
  too much, bake the gradient into the brush's spare B/A channels → back to 1 tap.
- **Storm-coupled refill** — shorten `tau` with `stormReact.intensity` (already read each frame)
  so a blizzard fills the tracks faster — matches the shipped Living Blizzard.

## Avoid

- 256² texture or spreading it over the full 12000×7000 ground — a paw becomes unrepresentable.
- The uniform-`Loop(32)` "MVP" — it's an O(N) full-screen perf regression vs the 1-tap texture.
- Grey prints — the WinterPipeline grade (exposure 0.82 + ACES + cold tint) blows them out;
  darken+cool toward periwinkle, overshoot only the thin rim warm.
- Making `groundY()`'s raycast sample the trail — keep it on the base mesh (the dip is GPU-visual
  only, so **no fox-sinks-into-its-own-dent feedback loop** — confirmed in the audit).
- Per-frame `computeVertexNormals()` — kills perf; the lighting normal is faked in-fragment.

## Open questions (resolve via capture / your call)

- `tau` (refill time) and rim intensity are art calls that only lock under the **in-game grade**
  (I can only capture the flat playground) — expect one tuning pass after you capture in-game.
- Should prints stamp on the **frozen lake** at all? Recommend killing them over the ice.
- Foot-timing home: an injected optional `stamp` callback into `createArcticFox` (cleanest
  access to heading/prev-pos) vs reading positions in the effect loop. Recommend the callback.
