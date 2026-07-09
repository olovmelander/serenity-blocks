# Vesper Chrysalis — Visual & Compositional Upgrade Plan (V3)

*Closing the "elegant but empty" gap with hatom.com. Fan-out design study, adversarially verified.*

Status: **PLAN.** Method: live-inspected hatom.com phase-1 hero + captured our theme side-by-side, then a
9-area design workflow (18 agents, 33 designs, each verified for feasibility in our code + visual payoff +
perf + board-safety). Author: 2026-07-07. Builds on the M0–M3 + masterpiece-upgrade + features/perf work.

---

## 0. The verdict

Our theme is genuinely beautiful, but **the entire lower half is flat and sparse** — a clean mirror lake
with a few floating crystal cones and a symmetrical reflection. Hatom fills that same space with a
**detailed, layered, living alien landscape**. The gap is **compositional**, not just polish: Hatom builds a
depth stack (foreground rocks → glowing textured terrain → egg on the horizon → rim-lit mountains → sky
with planets), while ours jumps from flat water straight to flat-black mountains.

---

## 1. Direct answers to your questions

- **"What more assets should we add?"** → Mostly **none** — the biggest wins are **procedural** (terrain,
  crystals, boulders, riverbed, veils). The *one* asset genuinely worth authoring is a **bespoke twilight
  environment map** (fixes the reflections, see below). Water flowmap+caustics textures are a nice P2.
  **Skip authored GLBs** (rocks/embryo/crystal-clusters): our near-black value-contrast + the small on-screen
  sizes throw away the baked detail, and they add download weight + the Electron asset-path/git-untracked traps.
- **"How to get closer to hatom?"** → The ranked roadmap in §2. The keystones: a **detailed terrain ring**
  with a **magenta bioluminescent riverbed**, **crystal clusters growing from the ground**, a **foreground
  depth stack**, and **egg reposition**.
- **"Planets in the sky?"** → **Yes — and it's a zero-download win.** `public/textures/2k_jupiter/saturn/
  neptune` + `saturn_ring_alpha.png` already ship (stellar-drift already renders a saturn sphere). We add
  unlit textured spheres with a **dark-limb fresnel + warm rim** (so they read as *silhouetted twilight
  worlds*, not bright NASA globes), tinted down, small, in the upper sky — an anchor-moon always present,
  the full ensemble blooming in at the Cosmos beat. Mirrors in the lake for free.
- **"Crystal reflection feels low-resolution?"** → Correct, and it has **two root causes** we fix directly:
  (1) our `scene.environment` is a PMREM baked from a bare gradient dome — **almost no angular detail to
  reflect**, so glass/crystals mirror a flat blur; and (2) the reflector runs at `resolutionScale` 0.5 with a
  ~20px ripple smear. Plus the crystals are thin low-poly cones. Fix = a **detailed env map** + **higher
  reflector res on High+** + **rooted higher-detail clusters**.

---

## 2. Prioritized roadmap

### WAVE A — quick, high-impact wins (small effort, no big new systems)
These land fast and move the needle hard. Do these first.

1. **Planets & ringed worlds in the sky** *(P0 · zero downloads)* — group of 3–4 unlit textured spheres
   (jupiter/saturn/neptune already in `public/textures`) + a saturn ring, each tinted ~0.3 with a dark-limb
   fresnel + thin warm rim; `y` 220–380, small (~4–8% frame), out of the center wedge; anchor-moon always,
   ensemble fades in on the Cosmos crest (`uS`), mirrored in the lake. *Answers your planet ask.*
2. **Dedicated twilight environment map** *(P0 · the reflection fix)* — bake ONE bespoke equirect (indigo
   zenith → magenta horizon band + ember key + a few star dots) and swap `scene.environment` to it. This is
   the *direct* fix for "reflection feels low-res": the egg + crystals suddenly reflect real detail. Zero
   per-frame cost. (Ship a ~1K `.hdr` to reuse `loadLunaraHdriEnvironment` verbatim, or an LDR `.jpg` via
   `TextureLoader`+`EquirectangularReflectionMapping`. Keep the current procedural PMREM as the instant-boot
   placeholder, swap on load. This is the one asset worth authoring.)
3. **Sharper mirror** *(P0)* — per-tier `reflScale`: Minimal off / Low 0.34 / Medium 0.5 / **High 0.75 /
   Ultra–Extreme 0.9** + `bounces:false` + de-smear the ripple near the horizon band. A/B FPS at 0.5 vs 0.75
   vs 0.9 (protect High's ~175fps; gate MSAA to Ultra+ only).
4. **Float the egg higher & smaller** *(P0)* — reposition toward the horizon line + shrink a touch + slow
   idle bob. Vacates the center-mid for the playfield *and* is the single biggest move toward the hatom read.
   (Pull the god-ray back behind the new egg z; keep bob amp so it never re-enters the board zone.)
5. **Layered aerial-haze veils** *(P0)* — 3–4 additive gradient quads at z=-410/-600/-760 between the ridge
   ranges (successively warmer toward the band), lazy sin/fbm drift, alpha 0.06–0.12. The "receding ridges
   into haze" signature; mirrors free; tier-scale 4/2/0.
6. **Mountain rim-light + rock grain** *(P1)* — a horizon-catch warm rim on the ridge crests (via a baked
   `aCrest` attribute) + faint fbm grain near the crest (High+). Kills the "vinyl cutout" flatness while
   keeping the near-black silhouette. (Rim gain ~0.12–0.18 so it never crosses the bloom threshold.)
7. **Grade refit to hatom's palette** *(P0, optional-order)* — replace the split-tone/sat/contrast with a
   3-band ASC-CDL (lift→violet shadows, gamma→magenta mids, gain→amber highs) toward the measured palette
   (`#F76CFE` horizon, cyan crystals, `#ff8a3c` core, near-black shadows). Cheaper than today; ship behind
   `?gradeV2` and A/B vs a hatom frame.

### WAVE B — the landscape (the real gap-closer; medium effort)
This is what actually makes it read as Hatom's world. Procedural-first.

8. **Bioluminescent terrain ring** *(P0 keystone, rescoped procedural)* — a LOW, near-black displaced
   heightfield skirt cradling a *smaller* central lake, using `himalayan-noise` `fbm2`/`ridged2` with a
   **dark rewritten** `colorNode` (not himalayan's snow shading) + a **center channel-mask** that keeps the
   vertical board strip flat dark water. Tallest terrain pushed to `|x|>40`, far/fogged behind the relic.
   *Budget for the reflector double-draw — A/B FPS.*
9. **Winding magenta riverbed + veins + moss-motes** *(P1)* — reuse the egg-crack isoline moved into world
   XZ as an emissive magenta vein network + a dim winding glow-path (kept **below the bloom threshold** so it
   never backlights the board) + a shoreline band of drifting motes (clone the points systems, wire to the
   existing `spawnRing`/combo plumbing). The signature "living" element.
10. **Terrain-rooted crystal clusters** *(P0)* — port Lunara's crystal system (`buildCrystalGeometry` +
    `placeCrystalInstance` + `makeSeededRandom`) into the effect, replacing the 22 floating cones with **3
    InstancedMeshes** of varied rooted clumps. Use the **non-`fast` Lunara material** (gives the voronoi-
    fracture "resolved interior" that reads high-res) **with transmission OFF** except one hero cluster on
    Extreme. **Set `vertexColors=false`** (else instances render black). Re-author cluster centers for our
    camera (drop Lunara's foreground clusters; flank `|x|>18`, protected center wedge); sink bases ~1.5u so
    they're rooted, not floating. *Net-cheaper than today (3 draws vs 22).*
11. **Frame-edge foreground boulders** *(P0)* — InstancedMesh of CPU-jittered icosahedra (port `valueNoise2`
    to JS), near-black + a grazing magenta rim, scattered `|x|` 40–105 at the lower edges, bases below y=0.
    Completes the depth stack; near-black silhouettes reflect fine even at low reflScale; ~1 draw.

### WAVE C — refinement (P1–P2, after A+B land and are value-checked)
- **Fractured-earth lit core** — swap the core to `MeshStandardNodeMaterial` (env pickup) + AO-driven crevice
  depth + amber-in-valleys; **fix the crack math to F2−F1 edge distance** (Lunara's `voronoi3` returns
  cell-center distance, which lights blobs not seams). Trim — the shrunken egg limits fine detail.
- **Cosmos monolith** — a rising near-black slab from the mirror lake at the Cosmos beat, **staggered onto a
  separate S band from the aurora wing** (don't bloom everything at once); drop the light-pillars (redundant
  with the wing). Mirrors free.
- **Crystal transmission** on Ultra/Extreme; **water flowmap + caustics** (reuse existing `water-normal.jpg`,
  author flowmap+caustics); **per-phase `.cube` LUT** — only if the Wave-A grade refit visibly misses.

### DROPPED (verified not worth it)
Authored planet textures (too small to benefit — use repo textures) · authored rock/lakebed GLB kit
(value-contrast discards the detail) · authored embryo GLB (sub-visible) · full `ridge-terrain.js` port
(grey snow-shaded, heavy, board-lift risk) · aurora slab-march raymarch (TDR risk, occluded) ·
reference-driven LUT bake (color-space trap, high uncertainty).

---

## 3. Asset strategy (the "what to add" answer, crisp)
- **Author exactly one asset now:** the **bespoke twilight env map** (~1K `.hdr` or `.jpg`, bundled via
  `?url`/`BASE_URL` — never absolute paths). Highest payoff of any asset; it's the reflection fix.
- **Use existing repo assets:** planet textures + saturn ring (already in `public/textures`).
- **Everything else procedural:** terrain, riverbed/veins, crystal clusters, boulders, haze veils, monolith,
  motes. Zero downloads, full tier-scaling, no Electron/git-untracked traps.
- **Optional later (P2):** water flowmap + caustics textures; a cracked-rock normal/AO map tiled on the
  existing egg-core geometry (JPG maps to dodge the KTX2 `detectSupport` requirement).

---

## 4. Sequencing & verification
1. **Wave A** (planets → env map → reflScale → egg reposition → haze veils → rim → grade) — each is a small,
   isolated change; playground screenshot-verify per CLAUDE.md (one effect/session, watch for TDR — open a
   **fresh tab** if FPS collapses, that's session degradation not code). These alone close a lot of the gap.
2. **Wave B** (terrain keystone → riverbed → crystal clusters → boulders) — the structural landscape.
   A/B FPS after the terrain (it renders twice via the reflector). Keep the **center board wedge** clear at
   every step.
3. **Wave C** — polish, only after A+B are value-checked in-game.
Throughout: preserve the value-contrast art direction (near-black silhouettes, light on the hero), keep the
center-mid readable for the Tetris board, and hold ≥120fps on High/RTX with a working WebGL fallback.

---

## 5. Recommended first batch
On GO, I'd ship **Wave A's four zero/low-risk wins together** — **planets + the twilight env map + reflScale
tiering + egg reposition** — then screenshot-verify. That single batch directly answers all four of your
questions (planets ✓, closer-to-hatom ✓, reflection fidelity ✓, better composition ✓) with almost no perf
cost, before committing to the larger Wave-B landscape.
