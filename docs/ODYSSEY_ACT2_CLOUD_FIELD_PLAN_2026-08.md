# Act II Cloud Field — the sculpted sky (2026-08)

**Goal.** Replace the Act II cloud SHEET with a field of sculpted, opaque, Witness-grade
cumulus — puffy 3-D masses in ONE idiom for the whole sky — at a NET NEGATIVE GPU cost on
Lane B, with the ch5 fly-through becoming an authored beat instead of a mist corridor.

**Provenance.** 2026-08-14: 9-agent cited online research sweep (8 angles + completeness
critic, ~100 findings, every claim URL-cited and tagged primary/secondary/inferred), then 3
adversarial designs (look-first / budget-first / integration-first) judged by a verifier with
the r181 sources open. The judge verified every load-bearing construct against
`three@0.181.2` and this tree; its synthesis is §5. Full transcripts:
`~/.claude/.../subagents/workflows/wf_15657da0-705` (research) and `wf_819585a2-94a`
(designs + judge). This plan supersedes the SHEET-evolution track of
[ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md](ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md) §4 while
inheriting its measured laws and §3 look rules; that plan's Wave 3 (the bank) becomes this
plan's Wave 5.

---

## 1. What the research established (cited; the design rests on these)

1. **The Witness does NOT raymarch.** Primary source — the artist's own breakdown with the
   engine programmer's notes (artofluis.com/3d-work/the-art-of-the-witness/clouds/):
   foreground clouds are editor-assembled mesh clusters; volumetric shading was considered
   and rejected ("a lot of work for a small feature"). Background clouds are PAINTED CUTOUT
   QUADS near the horizon over a procedural-gradient dome.
2. **The puffiness is a SHADING trick, not geometry:** vertex normals blended toward
   `normalize(pos − cloudCentroid)` (artist-tweakable), so a clump of separate puffs shades
   as ONE soft mass; wrap-shading (their vegetation scatter trick, GPU Gems ch.16); plus a
   fake forward-Mie term — `pow(saturate(-10*(0.9+dot(V,L))),4)` attenuated by
   `saturate(1.25-abs(dot(N,L)))` — for the sun-side silver lining. All pure ALU. Sorting
   sloppiness is hidden by LOW ALBEDO CONTRAST — a license this palette already exercises.
3. **Every shipped stylized sky agrees.** Sea of Thieves: opaque geometry, per-vertex
   lighting (quarter-res blur composite for softness). Sky CotL (mobile-class GPUs): mesh
   clouds. BotW/Genshin: layered 2-D dome materials. NOBODY raymarches their signature
   stylized clouds.
4. **Fullscreen volumetrics are dead on this lane, with numbers:** the official
   `webgpu_volume_cloud` example costs ~300 3-D-texture taps per covered fragment (measured
   from its source: ~100 guaranteed steps × 3 trilinear taps); the practitioner cheap-end
   floor triangulates to ~2-3 ms at 320×180-class res on a 610M — before this machine's
   documented WebGPU TDR history. Bounded-mesh interior marching dies on the camera flying
   THROUGH the ch5 sky. A2C soft edges need real 4×MSAA under WebGPU (multisample state) —
   an owner-priced upgrade at best, never a default on a 4-ROP part.
5. **Our own measured laws point the same way** (perf-budgets.json): the sheet costs
   1.180 ms (ch4) / 1.835 ms (ch5) COVERAGE-INDEPENDENT — every rasterised fragment pays the
   tap stack; opaque merged-icosphere clouds measured 0.066/0.131 ms for six masses (~9k
   tris), zero fetches, zero blend state. The 610M is fill/blend-limited: opaque geometry
   runs with its grain, transparent sheets against it.
6. **Build-time tools are proven in JS:** smooth-min SDF sphere fields (iq), marching cubes
   (the three.js addon's polygoniser is reusable one-shot — verified; needs an isolation
   sign flip), simplex noise ~48M ops/s, analytic sphere AO — a ≤250 ms bake budget is
   realistic.
7. **The open LOOK-RISK (the one thing no precedent proves):** a fully hard opaque
   silhouette reading "puffy". The Witness spends a blended edge pass on it; SoT a blur
   composite. Our first line is the quantised fresnel edge the retired heroes already
   shipped + a dithered near-dissolve; the rim SHELL and MSAA are parked, priced fallbacks.
   Wave 0b exists to falsify this for two sessions' cost, against a Ghibli/Dedene ramp bar
   (2-3 value bands, warm-lit/blue-shadow, flat bases).

## 2. Why the sheet cannot be "improved into" this look

The sheet is a horizontal clipmap: its silhouette is a PLAN-VIEW contour (popcorn from
above/below), it has no vertical faces to turn light, its sun terminator is regime-gated off
below y≈484 (most of the act), and at eye height it presents paper-thin billow seen edge-on
— the "flat and sometimes weird" the owner named. Its price is also the wrong SHAPE of cost:
1.8 ms at ch5 whether the sky is full or empty. Geometry with real height inverts both.

## 3. The verdict (three designs, adversarially judged — kept results only)

- **Winner: integration-first (C), 32.5/40** — one opaque idiom; probe-first pricing;
  clearance CLASSES validated against the live rail via a CPU SDF; the whiteout crossing
  beat; palette extraction so field and sheet share tones during migration; owner-gated
  ATOMIC swap so the shipped sky is never worse mid-migration. Every construct verified.
- **Grafted from A (29.5):** the Wave-0b paint probe (cheapest falsifier of the whole
  family); ordered reserve levers; parked-but-priced rim shell + dome-bake options.
  A itself died on a false ch4 net-negative claim, a centre-distance clearance metric that
  cannot keep the camera out of wide masses, and a horizon ring OUTSIDE the r=3600 dome
  that renders only via an undocumented depthWrite coupling.
- **Grafted from B (30.5):** the zero-new-shader pricing probe (retired hero builder scaled
  up, hero material untouched); the discipline of never touching the sealed deck gate before
  the swap. B itself shipped the two-model sky permanently, its Mie formula was
  sign-INVERTED (fires away from the sun — caught by the judge against `uSunDir`
  at renderer :1040), and it imported a non-exported `makeRng`.

## 4. Target look (inherits the old plan §3; these OVERRIDE where they differ)

- Whole-sky coverage from the spline camera: **25-35 % cloud; blue carries the frame.**
- Silhouette: 2-4 primaries / 5-9 secondaries / tertiary crown scallops, FLAT BASES (smax
  fillet at the condensation line — real geometry, never clamped verts: the FrontSide hole
  trap).
- Shading: centroid-bent baked normals; wrap diffuse quantised to 2-3 bands (8 % terminator,
  edges never equal); shadow band = HUE SHIFT toward sky, never darkening; baked vertex AO
  shifts the BAND THRESHOLD, not the colour; quantised Mie ≤0.10 toward `uSunColour`;
  quantised fresnel drawn edge (0.55/0.88 — the shipped hero numbers); hero aerial (0.82 cap
  × 0.42); everything through `toOutput`, authored OVERSHOT for the grade.
- Motion: rigid bounded Lissajous drift (90-240 s periods, per-mass phase). **Silhouettes
  never boil** — §3's rule stands as written; no breathing term (A proposed one; rejected as
  a rule exception the owner never granted).
- Interiors stay flat; ALL high-frequency detail lives in the silhouette.

## 5. Waves (every gate MEASURED on Lane B via `--low-power`, counters-verified quiet)

### Wave 0 — price the mechanism and the paint (2 sessions, nothing ships)
- **0a:** `cloud-field` opt-in CONFIGURATION in gpu-split (`fieldMs = field − baseline`;
  argument order carries the sign — NEVER also negate: the heroes cell's double-flip
  lesson). Cell `odysseyAct2CloudFieldMsLaneB` (tracked, baseline null). Probe = retired
  hero builder scaled to ~26-30 masses / ~30k tris, hero material UNCHANGED (zero new shader
  code). Pairs at ch4 p=0.42 + ch5 p=0.569. **Gate F1: fieldMs ≤ 0.50 ch5 / ≤ 0.35 ch4.**
- **0b:** `?field=1` on the existing rig; probe geometry re-shaded with the full paint stack
  (correct-sign Mie), sheet off, graded, judged against a Ghibli/Dedene reference at 2-3
  spline stations. **Owner decision D0: does quantised paint on lobed geometry clear the
  coherence bar AT ALL?** No → pivot back to evolve-the-deck; sunk cost two sessions.
- Export `makeRng` from `odyssey-hero-clouds.js` (one line; module stays retired).

### Wave 1 — the sculptor
`odyssey-cloud-field.js` + `odyssey-cloud-field-specs.js` (frozen, import-free): roles
(framing / overhead / gate / strata) + rank; framing seeded from the six H-specs (that
composition was owner-approved — only the MODEL failed). Smin k≈0.16w union + smax flat
base; simplex domain warp; marching cubes (addon polygoniser, isolation sign flip; ~150-line
local-MC fallback named); baked GUARDED bent normals, AO→color.r, seed→color.g,
height-in-mass→color.b. Three merged world-space ring meshes, `frustumCulled=false`,
≤65k tris, bake ≤250 ms (test-asserted; F6 = idle-slice the march). **Clearance =
SDF-at-rail ≥ per-class margin at max drift excursion** (`evalCloudFieldSDF`, also the
validator's instrument — fixes A's centre-distance defect). Gates: fieldMs ≤ 0.50 ch5;
silhouette bar (flat bases, 3-scale lobes, no soap bubbles). **F2:** blobby →
icosphere-merge + bent normals + AO, same idiom.

### Wave 2 — the paint + palette extraction
Extract `makeActCloudPalette` from the deck's tone block (renderer :1611-1656); the deck
consumes it — PURE refactor, source-import + no-reinlined-literals test (the refactor law);
the sealed deck gate is NOT re-opened. Field material: MeshBasicNodeMaterial, opaque,
FrontSide, zero textures, `fog=false`, NO `If` anywhere. Palette invariant unit test (cloud
lighter than adjacent sky THROUGH the grade at p=0.55/0.60/0.63). Graded captures ×4 + one
low-tier sanity. Gate: ΔfieldMs vs Wave 1 ≤ 2 ticks (0.131 ms). **Owner D1 primed:**
field-only vs field+sheet, one graded frame each, judged against the exact sentence that
retired the heroes.

### Wave 3 — motion + corridor
Rigid drift (verified via two captures t=9 / t=9.5 — `?t=` freezes dt). Dithered OPAQUE
near-dissolve 40-140 u (`opacityNode` + `alphaTest`, `transparent:false` —
NodeMaterial.js:879-890 verified: discard without blend state), doubling as the breach fade.
Gate-cloud intersection authored at p 0.563-0.566 (CLEAR of station 0.569; draws min==max
asserted). Whiteout beat: CPU SDF eval → `uWhiteout` → camera-attached BackSide shell,
`.visible`-gated, ~0.3 s. Gate: fieldMs unchanged ≤ 2 ticks. **F4:** stipple reads bad
through ACES at 720p → widen clearance to under-pass + whiteout-only; MSAA/A2C stays parked
as owner-priced D4.

### Wave 4 — the atomic swap (executes D1; NOTHING ships before the owner signs)
One commit: field default ON, sheet default OFF — RETAINED behind
`?odysseyWorldCloudSheet=1` (ADR-0015 pattern); NEW bisect flag `odysseyWorldNoCloudField`;
`odysseyWorldNoClouds` keeps meaning the SHEET so every historical report stays readable.
Ledger: close the deck cell with a retirement note PRESERVING the coverage-independence law;
re-baseline the ch5 station cell at 53-draw content on a quiet machine (two 08-14 attempts
were co-tenant-voided; verify counters, not drift); first field baseline + ~10 % ratchet.
Acceptance: captures p=0.225/0.42/0.44/0.56/0.569/0.63 (0.44/0.56 are captures-NOT-pairs —
the ch4 env draws at opacity 0.0197 there); underwater `.visible` test; dispose audit (the
SB-15 class); cold-boot ×4 (old plan §1.8). Gate: ch5 station ≤ 9.3716 (stale-conservative)
AND net ≈ −1.4 ms. **F5 (shore overhead read) judged on the p=0.225 capture BEFORE the swap
commit** — rejection leaves the sheet shipping untouched.

### Wave 5 — the bank speaks the field's language (old plan's Wave 3)
Restyle `odyssey-cloud-bank.js` onto `makeActCloudPalette`; interior tones aligned with the
whiteout shell so ch5's beat foreshadows the 5→6 envelopment; `SEAM_56_AURORA_BRIDGE`
midpoint untouched. Captures p=0.600/0.630/0.648. No perf cell (windowed, small).

### Wave 6 — optional, priced, owner-gated
D3 water coupling (`uCloudOverhead` spec-dim free; projected cloud shadow +0.2-0.4 ms EST,
high tier only, own pair). Parked with revival conditions: A's rim shell (ONLY if the
fresnel edge fails the owner's eye; ≤0.35 ms gate or dropped); A's dome strata bake (ONLY if
the in-dome strata ring fails the shoreline capture).

## 6. Budget position (ch5 station; Lane B)

| Item | ms | Class |
|---|---|---|
| Sheet retired at swap | −1.835 ch5 / −1.180 ch4 | MEASURED |
| Field ~60-65k tris, 3 draws | +0.3..0.5 | ESTIMATE (floor MEASURED: 9k tris = 0.066-0.131) |
| Whiteout shell (transient) | +0.1 while active | ESTIMATE |
| **Net at end state** | **≈ −1.4 ch5 / ≈ −0.8 ch4** | vs ≤2.5 envelope — REFUNDS §7.2 |

Ordered reserve levers: drop the shell option → far-ring grid 16³→12³ → strata count →
corridor mass count. The dead lever (coverage) stays dead — this cost is triangles, not
fill.

## 7. Owner decisions
- **D0** (Wave 0b): does the paint clear the coherence bar at all? — gates everything.
- **D1** (primed Wave 2, executed Wave 4): the sheet's fate. Retiring it re-opens the
  Wave-2-gate sign-off from 2026-08-13; the swap commit is yours to call.
- **D2**: does ch4 get a corridor tease, or does the fly-through stay ch5-only?
- **D3**: water coupling (Wave 6). **D4**: MSAA/A2C measurement, only if F4 fires.
- **D5**: low-tier mass count.
- Please drop the two Witness screenshots + 1-2 Ghibli/Dedene cloud refs into
  `public/playground-refs/` — Wave 0b's bar is judged against them in split mode.

## 8. Files
`odyssey-cloud-field.js` + `-specs.js` + tests (new) · `odyssey-world-renderer.js` (mount,
palette extraction, swap) · `odyssey-hero-clouds.js` (makeRng export only) ·
`act2-cloud-deck.effect.js` (`?field=1`) · `scripts/odyssey-gpu-split.mjs` (configs) ·
`perf-budgets.json` (cells) · `odyssey-cloud-bank.js` (Wave 5) ·
[ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md](ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md) (superseded §4
track — annotate at the claim when the swap LANDS, not before).
