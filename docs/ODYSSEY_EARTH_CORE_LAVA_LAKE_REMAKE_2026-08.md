# Earth Core lava lake — final recommendation (2026-08-21)

Status: synthesis of Design A (minimal 3D bake of the calibrated primitive), Design B (look-first 2D texture stack) and their adversarial critiques. Numbers marked **measured** come from the instruments named in ADR-0016 or from the plan/findings docs; **twin** numbers come from the critics' CPU ports (analysis aids, not instruments); everything else is **est.**/**unmeasured**. Nothing in the repo was modified for this document.

---

## 1. Executive answer

1. **Yes — much faster, and modestly more beautiful; not both at the magnitude Design B promised.** The compile pole can be removed outright; the look improvements that survive review are small and screenshot-gated.
2. **Compile:** the lake pipeline is **1,927 ms** (Chrome, `docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md:127`) / **1,979–2,161 ms** under Electron cold fan-out (`:136`). The identical lake shader with the noise body swapped for a baked 3D lookup compiled in **139 ms** isolated (`:51-59`, measured). Target under fan-out: **≤ 400 ms** (derived; gate F1 below). Expected cold ch1 saving ≈ 1.5–1.8 s (derived).
3. **Per fragment:** 19 `od_simplex3` evaluations (≈ 3–8 k scalar ops, est.; the two estimates disagree by 2×) → **19 trilinear 3D fetches + ≈ 400 ALU** (est.). Per vertex: 2 analytic evals (≈ 850 ops, est.) → **2 fetches + ≈ 80 ops** (est.).
4. **GPU:** Lane A (RTX 3070) is CPU-bound at 10.9 ms/frame and the lake differential sits below the 65.5 µs timestamp tick — report "below resolution". Lane B (Vega 8) is **unmeasured** on both arms; class estimate 1.5–3 ms → 0.15–0.5 ms at the entry station (est., cache residency of a 4 MiB texture on a 1 MiB L2 is the unknown, critique A B-2). `odyssey-gpu-split.mjs --lane B --low-power --seek 0` is the claim's instrument.
5. **Risk, ranked:** (i) tail statistics — trilinear filtering of the baked primitive loses **42 % of P(v>0.6)** and **45 % of P(v>0.7)** at 128³ (twin) → hot-spot/basin energy down 13–40 % unless corrected; corrected by a post-interpolation quantile map (this document's design point). (ii) CPU bake **740 ms** at 128³ single-threaded (twin, unoptimised) vs a 100 ms `creates` budget → Worker is the primary path, not a contingency. (iii) tiling of the 100 u hot-spot pitch with an 86 s time loop → fixed by a per-axis slice shear inside the sampler. (iv) WebGL2 lane unknowns (vertex-stage `sampler3D` + R16F) → one `--force-webgl` console check.
6. **Design B as written is not shippable**: its field layer applies v1 thresholds to fields with different distributions (ridge vs raw fbm → ~99 % of fragments lit; Worley net on ~20 % of the surface; hot spots 100× rarer). Its sound parts — deterministic CPU generation, LUT ladder, flow-from-the-fall, tier-ID debug output, structural tiers — are folded into Stage 2 below or deferred.

---

## 2. Recommended design

Two stages behind one build-time flag. **Stage 1** ships the perf win with the v1 fields, thresholds, palette, basins, seam, rim, haze and cap untouched. **Stage 2** adds three small, doc-requested look deltas on top of the same field layer, each gated by its own playground session and screenshot.

### 2.1 The seam that already exists

`fbm(pInput, octaves, sn)` takes a noise source (`src/rendering/odyssey/chapter-environments/earth-core.tsl.js:94-112`); the rock already routes ~18 of its 21 evaluations through a `texture3D` closure (`:136-142`, `:189`). The lake never passes `sn` (`:325-334`) and calls `snoise3` directly at `:299-300` and `:386`. Stage 1 is that missing argument plus a better texture.

### 2.2 Texture T-LAKE (the only new GPU resource in Stage 1)

| property | value | why / evidence |
|---|---|---|
| class | `THREE.Data3DTexture` | same as the rock bake (`shared/odyssey-baked-noise.js:72`) |
| content | the **calibrated** `od_snoise3` — Ashima simplex, input ×0.664, quintic remap 0.7058 / −0.1769 / 0.4543 (`shared/odyssey-tsl-noise.js:258-288`) — made exactly periodic by the **lattice wrap** (§2.5), then passed through a **post-interpolation quantile map** (§2.5) | marginals identical to the shipped primitive by construction; critique A confirmed the wrap is exact (periodicity error ≤ 6e-14, single-tile marginals within 0.3 % of the ensemble) |
| resolution | **128³** (design point); 192³ is the fallback if the quantile map cannot restore the tail (twin: 192³ raw tail loss −18 % vs −42 % at 128³) | 17.3 texels per primitive wavelength (2.44 p-units from 0.819 crossings/unit, `odyssey-tsl-noise.js:261`) |
| period | `L_raw = 12` simplex units (k = 4) → **L_p = 18.07** p-units | smallest axis-aligned period keeping the finest field's repeat ≥ 36 u (§2.4 table); periodicity in skewed simplex space requires `L = 3k` (det(skew) = 2, confirmed by critique A) |
| format / type | `RedFormat` + `HalfFloatType`, signed values stored directly via `DataUtils.toHalfFloat` (`node_modules/three/src/extras/DataUtils.js:150`) | filterable without `float32-filterable`: the unfilterable check bites only `FloatType` (`node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js:805-810`); maps to `r16float` (`renderers/webgpu/utils/WebGPUTextureUtils.js:1653-1654`), `R16F` on WebGL2 (core-filterable in ES 3.0); no 8-bit contouring (the §6b lesson, `docs/ODYSSEY_AAA_PERF_FINDINGS_2026-07.md:177-190`) |
| filters | `LinearFilter` min + mag; `generateMipmaps = false` (the default, `node_modules/three/src/textures/Data3DTexture.js:85`) | no mips for 3D in r185; the analytic field is also unfiltered, so far-field sparkle is parity |
| wrap | `RepeatWrapping` on S, T **and R** (default `wrapR` is clamp, `Data3DTexture.js:75`) | the sampler honours `addressModeW`; no in-shader `fract` (the rock's `fract` at `earth-core.tsl.js:141` is redundant) |
| memory | 128³ × 2 B = **4.00 MiB** GPU + 4.00 MiB CPU (`image.data`); 192³ = 13.5 MiB | arithmetic |
| lifetime | module-level lazy singleton, like `_bakedNoiseTex` (`earth-core.tsl.js:136-141`); **never** in `group.userData.ownedTextures` | eviction disposes `ownedTextures` (`src/rendering/odyssey/ChapterEnvironmentManager.js:783-788`); a shared texture there would be disposed on chapter exit and re-baked on re-entry |
| bindings | one `Texture`, 21 `TextureNode`s → three dedupes **per stage**: 2 `texture_3d` + 2 samplers (vertex + fragment) | critique A: dedupe key is the texture uuid per `shaderStage`; limits ≥ 16, harmless |

### 2.3 The sampler

```
// shared/odyssey-lake-noise-bake.js
makeLakeNoiseSampler(tex, { invL = 1/18.07, epsX = 0.071, epsZ = 0.053 })
  => (p) => texture3D(tex, vec3(p.x, p.y + epsX*p.x + epsZ*p.z, p.z).mul(invL)).r
```

- Vertex stage: the WGSL builder emits `textureSampleLevel(…, 0)` automatically outside the fragment stage (`WGSLNodeBuilder.js:343-371`); GLSL lane emits `texture(sampler3D, vec3)` (legal, base level). No `.level()` call needed.
- The **slice shear** (`epsX`, `epsZ`) is critique A's D-1 fix: every field samples the y≈0 slice of the tile, so without it the field repeats exactly at `L_p/scale` along x and z and `hotSpot` (100 u pitch, 86 s loop) is the salient repeat. Tilting the slice by ~4° makes consecutive x-periods land on different y-slices; the repeat distance becomes `L_p/eps` in p-units (≈ 254 p → **509 u for crustMap, 1.4 km for hotSpot**). Two different, non-commensurate epsilons so the x/z combination that re-aligns lands beyond the plane. Marginal unchanged (isotropic field; in-plane metric stretch 0.25 %). Shear is linear, so it commutes with `fbm`'s octave scaling — one closure serves all 21 calls.
- `invL` is a JS constant folded at build.

### 2.4 Layer table — Stage 1 (every coordinate is today's)

Vertex (`earth-core.tsl.js:297-316`):

| term | coordinate (p-units) | now | Stage 1 |
|---|---|---|---|
| `bubble` `:299` | `(x·0.1, z·0.1, 0.3t)` | 1 `od_simplex3` | 1 fetch |
| `flow` `:300` | `(x·0.05 + 0.15t, z·0.05, 0.06t)` | 1 `od_simplex3` | 1 fetch |
| `basinMaskAt` `:285-292`, `rimFalloff` `:303`, displacement `:308-312`, varyings `:314-316` | — | unchanged | unchanged |

Fragment (`:321-334`, `:386`); world repeat period of the base octave = `L_p/scale`, before shear:

| # | field | coordinate | fetches | period (pre-shear) | drift loop |
|---|---|---|---|---|---|
| 1–2 | `warp.x/.z` `:324-328` | `vPos·0.035 + (0.06t,0,0)` / `+(0,0,0.06t)+9` | 3 + 3 | 516 u | 301 s |
| 3 | `flow1` `:330` | `wPos·0.06 + (0.15t, 0, 0.075t)` | 3 | 301 u | 120 / 241 s |
| 4 | `flow2` `:331` | `wPos·0.1 + (−0.045t, 0.03t, 0)` | 3 | 181 u | 402 / 602 s |
| 5 | `cracks` `:332` | `wPos·0.3 + (0.015t, 0, 0.0225t)` | 3 | 60 u | 1205 / 803 s |
| 6 | `crustMap` `:334` | `wPos·0.5 + (0.03t, 0, 0)` | 3 | 36 u | 602 s |
| 7 | `hotSpot` `:386` | `wPos·0.18 + 0.21t·(1,1,1)` | 1 | 100 u | 86 s |

Totals: **19 fragment fetches, 2 vertex fetches, 0 noise `fn`s**. Everything from `crustFactor` (`:339`) through the cap (`:441-442`) and material flags (`:444-454`) is untouched. Note critique A's correction to the lacunarity argument: octaves 2 and 3 slip only 0.01/0.06 of their own period per base period, so 2.01/2.02 does **not** decorrelate the repeat — the shear does.

### 2.5 Bake plan

**Where:** CPU, in a **Web Worker**, JS port of `od_simplex3` line-for-line (skew 1/3, unskew 1/6, `mod289`/`permute`/`taylorInvSqrt`, the 7×7 gradient table, ×42) + the calibration wrapper. IEEE add/mul/`floor` only, no `Math.sin/cos/exp/pow` (critique B A1: V8 transcendentals are not guaranteed identical between Node for vitest and Electron 38). Bit-identical on every machine, every launch, worker or main thread.

**Step 1 — lattice wrap (exact periodicity).** Between `i = floor(v + dot(v, C.yyy))` and `mod289(i)`, map each of the four corner lattice points to the fundamental box: `q = i − sum(i)/6` (unskewed), `q' = q mod L_raw`, `i' = round(q' + sum(q')/3)`, then the unchanged `mod289 → permute` hash. With `L_raw = 3k` the wrapped point is a lattice point, every gradient still comes from the same permutation, so the marginal is the ensemble's. 54k³ = 3,456 distinct lattice points at k = 4 — no internal repeat (a naive `i mod M` repeats every ~0.87·M along skewed diagonals; rejected).

**Step 2 — sample at texel centres:** texel `(x,y,z)` = `f(((x+0.5)/res)·L_p, …)` so `RepeatWrapping` + linear filtering reproduce stored values at centres with no half-texel phase error.

**Step 3 — post-interpolation quantile map (the design point, not a contingency).** Critique A's twin: at 128³ the *sampled* field has std 0.2570 (−3.2 %), P(v>0.6) 0.0043 (−42 %), P(v>0.7) 0.0006 (−45 %), hot-spot mean `pow4` −15 %; max pointwise error 0.34 — hot pools are ~2-texel features, so the `4.9·(h/λ)²` estimate was an order of magnitude optimistic, and a scalar gain cannot satisfy std and tail simultaneously. Fix: a 64-knot monotone map `M` applied to **stored texels**, fitted **iteratively against the CPU twin of the GPU sampler** (half-float quantise → trilinear at 10⁶ uniform random points): `M_{n+1} = M_n ∘ (F_target⁻¹ ∘ F_sampled,n)`, 3–5 iterations. Judged after interpolation, applied before. Bake once, store `M` alongside (it is a deterministic function of `(res, k)`).

**Step 4 — storage:** `Uint16Array(res³)` of half-floats, flags per §2.2, `needsUpdate = true`, `userData.periodP = L_p`, `userData.quantileMap = M`.

**Step 5 — scheduling (`creates` ≤ +100 ms):**
1. Worker started at module import (the menu precedes the Odyssey by seconds). Transferred `Uint16Array`.
2. At `createLavaFloor`, if the worker has not returned: allocate the final-size zero buffer, build the `Data3DTexture` on it, and `image.data.set(result); needsUpdate = true` when it arrives (a version bump re-uploads; size never changes, so no descriptor rebuild). Record `lakeBakeReadyBeforeBuild` in the perf manifest so a placeholder frame never passes silently as a capture.
3. Fallback lever: `public/assets/odyssey/earth-core/lake-noise-128.bin` (raw half-floats + JSON sidecar with CRC32, `res`, `k`, `M`) written by `scripts/bake-earth-core-lake-noise.mjs` from the **same** functions. Raw `.bin`, never PNG (critique B E2: image textures flip Y and go through colour management).
4. Synchronous main-thread bake only in vitest and only when a test asks for it; `typeof window === 'undefined'` → analytic (`_readEarthCoreBakeFlag`'s pattern, `earth-core.tsl.js:123`) so the env and drawable-budget tests do not bake by default.

**Unit test (`tests/unit/earth-core-lake-noise-bake.test.js`), the proof that "same statistics" is true:** analytic port reproduces the calibration table (std 0.2656, P(v>0.6) 0.0073, P(v>0.7) 0.0012, p99.99 ≈ 0.82 — `odyssey-tsl-noise.js:268-270`); periodicity `|f(p) − f(p + L_p·e_i)| < 1e-9` on all three axes; sampled-after-`M` distribution: std ±1.5 %, p50–p99.9 ±2 %, P(v>0.6) ±10 %, P(v>0.7) ±15 % (≈1,200 tail events at 10⁶ samples → ~3 % sampling error); 3-octave fbm twin std 0.152 ±3 %; CRC32 of the buffer pinned.

### 2.6 Uniforms, flags, debug

- Uniform set unchanged: `uTime`, `uPulseIntensity`, `uDescent`, `uSeam` (`earth-core.js:2067-2069`, `:2090-2095`, `:2098-2105`), the seven colour uniforms (`earth-core.tsl.js:266-277`), `cameraPosition`. `material.userData.uniforms` keeps `uSeam` (`:452-454`).
- `createLavaFloorTSL(uTime, uPulse, uDescent, options)` gains `options.noise: 'analytic' | 'baked'` (default analytic) and `options.debug: 0 | 1 | 2` (default 0). `material.name = 'earth-core-lake-analytic' | 'earth-core-lake-baked'` so the probe finds the pipeline by label (`renderPipeline_${material.name || material.type}_${material.id}`, `node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js:208`).
- Debug is a **build-time** option, not a uniform: with `debug = 0` the analytic arm's node graph is byte-identical to today (critique B E3 resolved); `debug = 2` emits the tier-ID colour (luma tier of `color` before the cap: crust / mid / hot / bloom) for mask statistics in captures only. Pipelines built with `debug ≠ 0` are excluded from compile gates.
- Flag read **inside `createLavaFloor`** at build time (`earth-core.js:1356-1370`): `?earthCoreLakeBake=1|0` over `localStorage['serenity.earthCoreLakeBake']`, `options.lakeNoise` for tests; `?earthCoreLakeDebug=0|1|2` URL-only. Default OFF until the gates pass, then ON with `=0` kept one release.
- The pilot (`earth-core.tsl.js:1633`) follows the same flag.

### 2.7 Tier gating

**None in Stage 1.** With zero noise bodies the whole fragment is 19 fetches + ~400 ALU; a tier would have to drop octaves, which changes the fbm statistics the thresholds were tuned on. Decide after G1 on Lane B: if the lake's measured differential at the entry station exceeds **0.6 ms** on the Vega 8, the one lever that does not move thresholds is sampling the two `warp` fbms at 2 octaves (amplitude loss 0.125 × 6 u = ±0.75 u of a ±3.7 u warp; est., unmeasured) on `effectQuality = low`, structural (separate pipeline, same compile class). Document that tier is read at build (`surface-world.js:893-895` pattern) and sticks until re-entry.

### 2.8 Stage 2 — look deltas that survived review (each its own session, each opt-in)

| # | delta | mechanism | doc ask | cost | what it does NOT do |
|---|---|---|---|---|---|
| S2-a | **Flow from the fall** | replace the three fixed drift vectors of `flow1/flow2/cracks` (`:330-332`) with `uFlowDir · ftime · speed_i`, `uFlowDir` = unit vector from the fall seat (`staging.lakeAt(0.72, {lateral: 8, forward: 10})`, `earth-core.js:1029-1031`, hoisted above the lake build at `:944`) toward the lake centre, projected to xz | "bias lake flow FROM the fall toward camera" (`docs/ODYSSEY_EARTH_CORE_AAA_PLAN.md:77`, `:281`) | 0 fetches, 1 vec3 uniform; a rigid translation of each field — marginals unchanged | no flow map, no two-phase blend (Valve mid-phase contrast loss would break the statistics promise; critique B D2) |
| S2-b | **Blackbody LUT ladder** | 256×2 `DataTexture`, `RGBAFormat`/`UnsignedByteType`, **`SRGBColorSpace`** (→ `rgba8unorm-srgb`, hardware decode, `WebGPUTextureUtils.js:1551`), Clamp, Linear, no mips; row 0 = non-basin stops, row 1 = basin stops, v = `(0.5 + vBasin)/2`; replaces `:355-361` and the crust mix `:364` with one fetch; rows **pre-clamped to the caps** in linear, and the `min(color, cap)` guard stays | "one blackbody ladder, no arbitrary lava colors" (`docs/ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md:122`) | 1 fetch, −~25 ALU | not a re-author of which `temp` values are crust/molten: the row-0 stops are placed so `u < 0.40` = today's `coolMix` band, `0.40–0.70` = `midMix`, `≥ 0.70` = `hotMix` with the cubic ramp baked into the stop spacing; LUT disposed via `group.userData.ownedTextures` (per build) |
| S2-c | **Crust rises toward the rim** | `crustMap.add(smoothstep(0.25, 0.5, radial).mul(uCrustRimBias))`, `uCrustRimBias` 0 → 0.12 | "push crust % up at the lake rim (cools at edges)" (`ODYSSEY_EARTH_CORE_AAA_PLAN.md:77`) | 2 ALU | nothing inside radial 0.25, where the basins and the entry station live |

Deferred to a separate wave with **re-authored thresholds** (not refuted in principle, refuted as specified): Worley crust plates, normal-map glints off a virtual key, subsurface glow through thin crust, uv-perturbation heat shimmer, Valve flow map. They need a field layer whose CDF is measured first and windows fitted to target coverages (0.5–2 % for veins, ~3 % for hot spots), with `debug = 2` masks as the gate.

---

## 3. What stays byte-identical, what deliberately changes

**Byte-identical in Stage 1 (node graph modulo the `sn` argument):** `basinMaskAt` and `options.basins` (`earth-core.tsl.js:285-292`, `earth-core.js:936-943`); displacement law `:308-312` and its ±0.38 / ±1.25 envelope (critique B B4: at pulse 1 the basin-in swell is 0.38·3.3·1.4 ≈ 1.76 today — a pre-existing fact, not a new one; do not claim "1.5 clearance"); `crustFactor` window 0.60–0.90 `:339`; `temp` composition `:344-351`; ladder `:355-361` and crust mix `:364`; glint `:368-369`; veins + seam mixes `:376-381`; hot spots + `heatAlive` + basin pulse `:386-394`; fresnel ×0.35 `:400-402`; rim band/pulse/`beyondRim` `:409-416`; shimmer `:420-422`; descent lift `:426-427`; haze `:432-435`; cap `:441-442`; material flags `:444-450`; 360×360×72×72 geometry and `LAVA_LAKE_Y` `:458-461` (so `horizonRimY` at `earth-core.js:993-996` still seats); corona sprites (`earth-core.js:1372-1401`); every uniform and its driver.

**Art-constraint consequences:** 70/30 crust law (`ODYSSEY_EARTH_CORE_AAA_PLAN.md:26,32`) — same `temp` distribution by construction after the quantile map; palette law and `#ffe6b0` reserve (`ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md:122`) — cap untouched, cap Y 0.514 basin-out unreachable; basins at ft 0.05/0.42/0.80 with `#ffffaa` veins and hot spots (`:132`, `:162`) — mask and colour untouched, **energy guarded by the quantile map and gate B-hot**; seam quench — code untouched; cold end is a surface (`earth-core.tsl.js:268-272`, user report 2026-08-12) — floor untouched.

**Deliberately changes, with justification:**

| change | why it is allowed |
|---|---|
| the primitive's *realization* (which point is hot) | the calibration itself only promised marginals (`odyssey-tsl-noise.js:270-273`: "differs by realization … not a bias"); captures compare mask statistics, never pixels (23.6 % ground-band churn between identical runs, `scripts/odyssey-chapter-capture.mjs:465-466`) |
| the field becomes periodic (≥ 36 u before shear, ≥ 509 u after) | constraint 15 ("frequency set by radius") is about scale, not aperiodicity; gate B-tile checks it |
| minification: baked field is band-limited at 17 texels/λ; far rows lose sub-texel speckle | parity-or-better with the analytic field's aliasing; no mips, so no mean-convergence "void" (critique B C7 applies to 2D-mip designs only) |
| hot pools become slightly broader/softer after the quantile map | open question Q1; fallback is an analytic `hotSpot` (one `od_simplex3` body; compile cost unmeasured, est. 60–150 ms) |
| Stage 2 a/b/c | each is a documented ask with its own screenshot gate |

**Retired gate:** B9 "R/B inversion at the seam boundary" on the lake body. Critique A C-2 (twin): `cracks` is a 3-octave fbm with std 0.152; `veinIntensity = smoothstep(0.5, 0.66, cracks)` fires on ~0.013 % of the surface and the glint window on ~0 %, so the vein quench has no vehicle today. What crosses the seam is `heatAlive` on the hot spots and the basin pulse term. Log as an art finding for the wave that owns the lake; measure the seam on the hot-spot term instead.

---

## 4. Implementation plan (sessions)

Each session: one playground effect, ADR-0007 loop (`npm run dev:playground`, wait `window.__PLAYGROUND_READY__`, `src/playground/README.md:86-91`; console clean; `?t=` frozen clock). Gates are defined here inline — the "measurement plan" both designs cite is not in the repo (critique B E4), so this section is normative until `scripts/earth-core-lake-metrics.mjs` lands.

**Session 0 — bake helper + tests (no GPU).** `src/rendering/odyssey/chapter-environments/shared/odyssey-lake-noise-bake.js`: `snoise3CalibratedPeriodic(x, y, z, k)`, `fitQuantileMap(res, k)`, `bakeLakeNoise({res: 128, k: 4})` → `Uint16Array`, `buildLakeNoise3D(buffer, res)` → `Data3DTexture`, `makeLakeNoiseSampler(tex, opts)`, `lake-noise.worker.js`. Unit test per §2.5. Also patch the emission-test stub: `backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }) }` (`tests/unit/odyssey-tsl-noise-emission.test.js:33`; `WGSLNodeBuilder.js:810` dereferences it). Gate: test green; bake time logged (twin says ~740 ms unoptimised at 128³ — record the real number).

**Session 1 — builder seam + playground effect, Stage 1.** `createLavaFloorTSL` gains `options.noise`/`options.debug`; `sn` threaded into `:299-300`, `:325-334`, `:386`. New `src/playground/effects/earth-core-lake.effect.js` (the existing harness A/Bs boulders, not the lake: `earth-core-lava-bake.effect.js:1-15`). Params: `variant=analytic|baked|split` (`split` = one material whose `sn` is `select(screenUV.x < uSplitX, snoise3(p), snLake(p))` — identical coordinate/camera/clock; compile ≈ 2 s, playground-only), `pose=entry|basin|top`, `descent`, `pulse`, `seam`, `basins=1`, `debug`, `t`, `res=128|192`, `hotspot=baked|analytic`. Static `camera()` hook as `earth-core-lava-bake.effect.js:255-262`. Shots at `t = 9, 40, 120` for all three variants; `?ref=` the analytic shot, `refMode=split` (`README.md:27-33`). **Gate:** console clean on WebGPU; crust/mid/hot tier shares from `debug=2` within ±6 / ±3 / ±1.5 pts of analytic over the lake mask; no visible repeat in `pose=top` (Q2).

**Session 2 — WebGL2 lane + tiling check.** Same effect under `--force-webgl` (B12); `pose=top` at three clocks, 1-D autocorrelation of the `debug=2` mask rows — no peak at the projected crustMap/hotSpot pitches. If a peak shows, adjust `epsX/epsZ` (never k = 6/160³: worse tail, critique A C-1).

**Session 3 — port + harness.** Flag in `createLavaFloor` (`earth-core.js:1356-1370`), pilot follows; `material.name` per arm. gpu-split `CONFIGURATIONS` (`scripts/odyssey-gpu-split.mjs:73`) gain `no-lake` (`earthCoreNoLake=1`, existing lever `earth-core.js:913-921`) and `lake-baked`; probe via `--url-flag earthCoreLakeBake=1` (`scripts/odyssey-pipeline-probe.mjs:15,40`); capture via `--url-flag … --locals 0,0.05,0.42,0.8,1.0 --times 9,40,120` (`scripts/odyssey-chapter-capture.mjs:57,151-153,708`); emission ratchet builds both arms (baked: 0 `od_simplex3(`, ≥ 21 `textureSample`, `uSeam` present); `earth-core-environment.test.js:186-191` and `tests/unit/earth-core-drawable-budget.test.js` under both flag values.

**Session 4 — measurement gates (ADR-0016), Lane A then Lane B, n = 3 interleaved, no other WebGPU surface open, `adapter` recorded:**

| gate | instrument | accept |
|---|---|---|
| F1 compile, lake pipeline, Electron cold, RTX | `odyssey-pipeline-probe.mjs` by label | **≤ 400 ms** (today 1,979–2,161) |
| F2 compile, `--low-power` (Vega 8) | same | ≤ 600 ms (target; today unmeasured) |
| F3 pipelines / draw `calls` | gpu-split report | identical between arms |
| F5 perf-driver cold ch1 compile cell | `odyssey-perf-baseline.mjs` | −1.2 s or better; `load/warm` within ±3 % |
| F6 `creates` | perf-driver | ≤ +100 ms with the worker (placeholder alloc + upload only); `lakeBakeReadyBeforeBuild = true` in ≥ 2 of 3 runs |
| G1 GPU Lane B, entry station | `odyssey-gpu-split.mjs --lane B --low-power --seek 0 --only baseline,no-lake,lake-baked,baseline-repeat` | `lakeBakedMs ≤ 0.5 × lakeMs`, differential ≥ 4 ticks, baseline drift ≤ 25 % of the saving |
| G2 GPU Lane A | `--lane A --seek 0.051` | report; "below resolution" acceptable |
| B-crust / B-mid / B-hot | `debug=2` masks, captures at locals 0, 0.05, 0.42, 0.8, three clocks | crust share ±6 pts, mid ±3 pts, hot ±1.5 pts vs analytic; in-basin hot/bloom-tier pixel count within −20 % / +10 % of analytic (the C-1 term) |
| B-bloom | same, pulse 0 and 1 | bloom-tier pixels **outside** basins = 0 in both arms |
| B-void | same | lake-mask pixels < 8-bit luma 6 ≤ 2 % |
| B-rest | captures at locals ≥ 0.0035 (lake out of frame) | mean luma within ±1.5 % of analytic |
| B-rim / B-basin | rim row-profile ratio ≥ 0.9× analytic; basin blob centroid vs corona sprite ≤ 3 % frame width | |
| B-tile | Session 2 autocorrelation | no peak |
| B12 | `--force-webgl` console | clean |

Flip the default when all pass; keep `=0` one release.

**Sessions 5–7 — Stage 2, one delta each (S2-a, S2-b, S2-c), same effect, own flag each (`earthCoreLakeFlowDir`, `earthCoreLakeLUT`, `earthCoreLakeRimCrust`), same gate table, plus the screenshot questions in §5.** S2-b additionally: emission ratchet asserts the LUT's rows ≤ caps (unit test on the bytes) and `textureSample` count 22.

---

## 5. Open questions only a screenshot can settle

1. **Q1 — hot-pool shape after the quantile map.** The map restores the marginal but the pools are band-limited (broader, softer). At the entry pose and the basin pose, `hotspot=baked` vs `hotspot=analytic` at `t = 9, 40, 120`: do the basin hot spots still read as "pulsing spots" rather than a warm wash? Decides whether one `od_simplex3` body stays in the shader.
2. **Q2 — is the 509 u shear repeat really invisible, and does the tilted slice introduce any directional grain** (a 4° tilt makes the field very slightly anisotropic in y; in principle imperceptible on a y≈0 plane)? `pose=top`, three clocks.
3. **Q3 — far-field character.** Baked is band-limited; analytic aliases. At the entry pose (eye ≈ 6 u above the plane, pitch ≈ +17.5°, fov 60), do the far rows read as the same dark crust with speckle, or smoother? Either is acceptable under the law; the question is whether the "far shore" still has texture.
4. **Q4 — 128³ vs 192³.** If Q1/Q3 are marginal at 128³, does 192³ (+9.5 MiB, ~2.4 s worker bake) visibly change anything? Only worth asking if Q1 fails.
5. **Q5 (Stage 2) — does constant-direction flow from the fall read as "flow from the fall"** at the stations that see both the fall and the lake, or does a rigid translation of a static-looking field just read as drift? If drift, S2-a is dropped (no flow map as the fallback — see §6).
6. **Q6 (Stage 2) — LUT stop placement.** With the `step()` splits gone, does the 0.40 and 0.70 boundary still produce the crisp river edge the v1 look depends on, or does the interpolated ramp soften the rivers into the amber gradient the comment at `:319-320` warns against? The stops may need to be piecewise-flat (duplicate texels) to keep the edges.
7. **Q7 — placeholder frame.** If the worker is late, the first frame renders a flat crust lake. Is that ever on screen during the cold start, or hidden behind the reveal barrier? `lakeBakeReadyBeforeBuild` tells you; the screenshot tells you whether it matters.

---

## 6. Do not do (from the critiques)

1. **Do not bake `fbm` as a whole, or any field with integer lacunarity 2.0** — different realization, 4.3 texels per finest wavelength at the same memory, the §6b shift (Design A rejected list; critique B C6).
2. **Do not bake a ridge (`1 − |fbm|`) and keep the raw-fbm windows** `smoothstep(0.5, 0.66)` / `(0.62, 0.70)` — twin: threads on 99.7 %, glints on 98 % of fragments → the amber soup at full strength (critique B C1).
3. **Do not add Worley "incandescent edges" ungated by temperature** — a hot net on ~20 % of the surface, the "tiled cracked-decal" read the rock was rebuilt to kill (`earth-core.tsl.js:154-156`; critique B C2).
4. **Do not derive hot spots from a multi-octave field** — `pow4 > 0.05` becomes 100× rarer and 10× fainter (critique B C3). Hot spots stay single-octave.
5. **Do not desaturate the lake body toward `uQuenchSilver` across the seam** — lifts 0.01-linear crust to 0.18–0.33 over the whole lake for the last ~30 % of the chapter; "never grey", "cool ≤ 10 %" (critique B C4). Veins-only, as today.
6. **Do not use 2D textures with GPU mips + threshold/LUT after the filter** — far rows converge to the mean (flat `#1a0b06` band = the void report returns) and GPU-generated mips are not deterministic across lanes (critique B C7, E1). If 2D mips are ever used, CPU mips via `texture.mipmaps` (`WebGPUTextureUtils.js:600-611`) with variance restoration.
7. **Do not use per-texel random phase jitter in a flow map** — 1 cycle per 2.8 u texel shears the detail >100 % inside single texels (critique B D2). Jitter must be ≥ 30 u wavelength, ≤ ±0.3 cycle.
8. **Do not pair the tiling fix with k = 6 / 160³** — worse tail (−64 % P(v>0.7)) than the design point; use the slice shear (critique A C-1, D-1).
9. **Do not use a scalar gain to "fix" the tail** — std and tail are mutually unsatisfiable with a gain (std +1.8 % at p99.9-matched gain 1.052; critique A C-1).
10. **Do not bake synchronously on the main thread at chapter build** — 740 ms measured on the twin vs a 100 ms budget; the §6c "74 ms" was 96³ Perlin on a desktop (critique A B-1, `docs/ODYSSEY_AAA_PERF_FINDINGS_2026-07.md:240-247`).
11. **Do not build the bake at module scope** — it runs on app start and in every vitest file importing earth-core; lazy singleton (`earth-core.tsl.js:136-142`; critique B B2).
12. **Do not put shared textures in `ownedTextures`, and do not put per-build textures on a plural `mesh.userData.ownedTextures`** — the sweep reads only the singular key (`earth-core.js:1300-1309`); eviction disposes only `group.userData.ownedTextures` (`ChapterEnvironmentManager.js:783-788`). Shared → singleton; per-build (the Stage 2 LUT) → push directly into `group.userData.ownedTextures` in `createLavaFloor` next to the glow texture (`earth-core.js:1419`) (critique B F1).
13. **Do not ship the asset fallback as PNG** — `flipY` and colour management alter bytes; raw `.bin` + sidecar (critique B E2).
14. **Do not use `Math.sin/cos/exp/pow` in the generator** — not guaranteed bit-identical across V8 versions (Node vs Electron 38) (critique B A1).
15. **Do not gate the seam on the lake's vein term (B9)** — the term is statistically dead today (critique A C-2).
16. **Do not claim "1.5 u decal clearance"** — v1 already reaches ≈ 1.76 u in-basin at pulse 1 (critique B B4); state the envelope, or cap it in a separate change.
17. **Do not compare arms by pixel diff** — 23.6 % ground-band churn between identical runs (`odyssey-chapter-capture.mjs:465-466`); statistics over the `debug=2` mask only.
18. **Do not run a second WebGPU surface during measurement, and do not run more than one effect per playground session** (TDR on the iGPU; adapter contamination — `CLAUDE.md`, gpu-split `laneAdapterMismatch` at `scripts/odyssey-gpu-split.mjs:668`).
19. **Do not pass the 'vertex textureLod' or '3D textures have no mips' claims on as capability facts** — the vertex stage emits `textureSampleLevel`/`texture()` automatically; no-mips is a default, not a limit (critiques A(a), B A2).

Out of scope, recorded: after the lake, the chapter's next compile pole is `createLavaFallTSL` (`earth-core.tsl.js:466+`, 0.34 s, `docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md:207`), which keeps its own `od_simplex3` body; and the rock's Perlin `_bakedNoiseTex` (`earth-core.tsl.js:136-141`) could later be replaced by T-LAKE (its analytic reference is the same `snoise3`, `:189`) to make one chapter texture.
