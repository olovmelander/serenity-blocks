# Swedish Forest — Golden Koi-Grade Lake Water (2026-07)

## Goal

Bring the **Koi Pond v2 water look** (analytic wave-derived optical normal, Fresnel
transmission↔reflection, broad+sparkle specular glint track, live ripple reactivity)
into the **Swedish Forest** lake — but retuned **golden**, matching the theme's low
golden sun and warm amber environment.

## Why the current Swedish Forest water falls short of Koi

The active WebGPU lake material is `createWaterNodeMaterial()` in
`swedish-forest-materials.js`. It is a golden re-skin of the *old WebGL* `Water.js`
shader (`SwedishForestWater.js`), so it inherits that path's limits:

| Koi Pond v2 (the target) | Current Swedish Forest water |
| --- | --- |
| **Analytic layered-wave normal** (3 directional sines + tier-gated FBM) drives all optics | Flat `normalWorld` (geometry up); ripples are only a color mask, so the surface never *bends* light |
| Fresnel mixes **depth-aware transmission** ↔ reflection | UV-`y` gradient color; no view-bent transmission |
| **Broad (pow 34) + sparkle (pow 138) specular** on the wave normal → living glint lane | UV-column sun path (physically flat) |
| Optional true `reflector()` planar mirror | Reflection **disabled "for stability"** — flat `uSkyReflection` colour only |
| Gameplay **ripple injection** bends the mirrored highlight | none |

The wave-derived normal + real specular is the single biggest reason Koi reads as
*water* and Swedish Forest reads as a *painted gradient*. That is the core we port.

## Approach — share one implementation (playground-first)

Mirror the Koi arrangement where the playground effect and the production theme share
one factory. Concretely:

1. **New factory** `createGoldenLakeNodeMaterial(params)` in `swedish-forest-materials.js`
   — the golden Koi-optics surface. Returns `{ material, uniforms }` keeping the keys the
   theme already drives (`uTime`, `uSunDirection`) plus new golden tunables.
2. **New playground effect** `src/playground/effects/swedish-forest-water.effect.js`
   builds a minimal golden test scene (SF sky dome + sun disc + the lake plane using the
   new material + a couple of shore logs + warm fog) so the water is iterable and
   screenshot-verifiable in isolation.
3. After a clean screenshot + clean console, **swap** `createWebGPUWater()` in the theme
   from `createWaterNodeMaterial` → `createGoldenLakeNodeMaterial`. The mesh transform,
   `uTime`/`uSunDirection` wiring, and reflection-RT harness are unchanged.

The WebGL2 fallback (`SwedishForestWater.js`) is left as-is — the Koi optics are a
WebGPU/TSL feature; the fallback keeps today's look.

## Node graph (golden retune of Koi's surface block)

Coordinate note: the lake mesh is `rotation.x = -PI/2`, `scale (2.5, 0.45, 1.0)`, so
`positionWorld.xz` is the horizontal plane and `positionLocal.z` is world-up. Waves are
computed from `positionWorld.xz`; height is displaced on `positionLocal.z`.

1. **Wave field** — 3 directional sine layers (+ optional FBM detail slope) → world-space
   `opticalNormal = normalize(vec3(-slopeX·k, 1, -slopeZ·k))`. Frequencies retuned ~2× lower
   than Koi's pond for the ~±100-unit lake (tuned by screenshot).
2. **Fresnel** `0.04 + 0.96·pow(1−viewFacing, 5)` on the wave normal.
3. **Transmission (analytic depth, no framebuffer copy)** — golden gradient
   shallow amber → deep brown by radial/edge depth. *(No `viewportTexture` refraction: the
   SF lakebed isn't modelled, the lake is huge, and a full-screen copy inside the theme's
   post pipeline is the fragile/expensive path. Analytic tint gets the look safely.)*
4. **Reflection** — warm sky tint (ripple-broken by the optical normal), Fresnel-weighted.
   *(A real `reflector()` mirror is the documented upgrade if the screenshot wants literal
   treeline reflections; kept off initially to honour SF's stability posture.)*
5. **Golden specular sun track** — `half = normalize(viewDir + uSunDirection)`, broad+sparkle
   powers × `glintBreakup` × a sun-azimuth **lane** (sun is straight −Z, so lane centres on
   world X≈0), tinted warm gold `(1.0, 0.82, 0.42)`. This is the hero highlight.
6. **Soft golden sun-path column** toward the horizon (subtle, animated breakup).
7. **Keep** SF's shore darkening + shore foam + object-interaction foam (already tuned to
   this lake's logs/stones), retinted warm.
8. **Emissive** = (specular + sun path) × `uEmissiveStrength` → feeds the theme's bloom.
   The material does **not** touch renderer tone mapping (theme owns post).
9. **Optional (Wave 2):** ripple-injection pool (Koi's `uniformArray('vec4')` slots) so a
   lock/combo bends the golden glint outward. Material hook included; gameplay wiring is a
   follow-up.

## Verification (per CLAUDE.md — non-negotiable)

- Iterate in `?effect=swedish-forest-water`; screenshot via chrome-devtools MCP after
  `window.__PLAYGROUND_READY__`, phase-locked with `?t=`.
- Console clean: zero WebGPU validation / TSL compile errors.
- Adversarial TSL review (r181 pitfalls: reversed `smoothstep`, ×0-not-DCE'd,
  `MeshBasicNodeMaterial` ignores `normalNode`, in-place uniform uploads) before capture.
- Port to theme only after 1–2 clean isolated shots. ⚠️ One small effect per session
  (iGPU TDR hazard).

## Out of scope (this pass)

- WebGL2 fallback optics upgrade.
- Real `reflector()` mirror (offered as an upgrade after first screenshot).
- Full gameplay ripple wiring (material hook only).
