# Odyssey — the North Island comes alive (the lake behind the mountain) (2026-08)

**Status: PLANNED 2026-08-16, NOT STARTED.** Owner ask, with screenshot, after playing the
landed 1C flyby: *"since we see the back of the mountain now, i want to add a lake there
and work with the landscape, add hills, some trees, and other things that makes this part
of the island feel alive"* — red-marked region on the north plateau. Plus the question this
plan's Wave 0 answers in code: *"should this planet be seen so early?"*

Everything below is measured from the live modules or the owner's screenshot — the same
rule as the transition plan.

---

## 0. WHAT THE FLYBY EXPOSED (audit)

The 1C flyby made the island's **north interior primary real estate** for the first time:
the climb's bank (p ≈ 0.55–0.68) looks down-left across it, and the owner's screenshot
shows it filling the lower half of frame. Probed against the settled follow frame, the
plateau shelf sits at the lower-left frame edge through p 0.56–0.64 (the live camera lags
during the bank and shows more of it, which is what the screenshot shows).

**Terrain today** (probed via `odysseyWorldMacro + relief`, 2026-08-16): a broad bare
plateau at **377–393 u** spanning roughly x −900…−100, z −1450…−1900. The massif's north
skirts rise at z −1300 (466–594). The brown mottle inside the owner's red circle IS this
plateau — it is the world-height test's own "bare inland plateau" pin
(`odysseyWorldMacro(−220, −1500) = 386.16`).

**Forest today:** the NW/NE carve kill fractions (0.48 / 0.60) were tuned when *"26 % of
the forest sat in ground the rail never approaches."* The rail now approaches it — the
sparseness that was a perf gift is now the "dead" read the owner is reacting to.

**Water today:** the One World has exactly ONE water surface — the sea plane at
**287.31**. A lake at ~380 u cannot reuse it; it needs its own surface (§2).

---

## 1. WAVE 0 — THE PLANET RETIME (the owner's question, answered with a number)

Measured: the earth-ignite starts at **p 0.5881**, and the massif flyby's in-frame pass
runs **0.545–0.648** — so the gas giant (now D3-sized, 3.4×) fades up *in the middle of
the mountain beat* and competes with it. That is why it reads "so early."

**Fix: `SUMMIT_EARTH_REVEAL.startBeforeBoundary` 0.41 → 0.28**, which puts the ignite
start at **p 0.6408** — the crown exits frame at 0.648, so the beat order becomes:
mountain sweeps past → the world blooms into the emptied sky at the crest → first stars →
boundary. One constant; `endBeforeBoundary` stays 0.15 (window 0.6408 → 0.6935, still a
generous fade).

Blast radius (all known, all cheap): the seam-56 schedule pins (summitStart 0.5881 →
0.6408, title string), the hero-framing summit samples re-derive to 0.6566–0.6935 —
**re-verify `planetSummit` frames at the new stations with the resolver probe before
landing** (they sit inside the span where the pose passed, but verify, don't assume),
stars-before-dark unchanged (it hangs off summitEnd), aurora gate derives.

Gate: capture p 0.60 (planet must NOT be visible), 0.648, 0.67 (blooming), 0.6935 (full).

---

## 2. WAVE 1 — THE LAKE

- **Site, first candidate:** centre ≈ **(−480, −1560)**, radius 150–190, water surface
  ≈ **380** (basin carved to ~371, rim at the plateau's own 384–388). Placement is
  screenshot-driven inside the wave: seat a probe marker, capture from p 0.56 / 0.60 /
  0.64, adjust against the owner's red circle before any real carving.
  ⚠️ Site it to AVOID the pinned probe point (−220, −1500), or re-pin that test as a
  deliberate act — do not let the pin drift by accident.
- **The basin** is a new closing-taper term in `odyssey-world-height.js` (smooth-min
  family). ⚠️ The north-coast lesson applies verbatim: the term must taper to zero in
  EVERY direction, and nothing may cross the ±4500 bake plate (the edge clamp extrudes
  21.7 km). Stay south of the coast taper's release (z ≥ −2400).
- **The surface — owner decision L1:**
  - **(a) PAINTED lake (recommended).** A flat unlit disc: one sky-family colour band,
    a drawn Witness-style shoreline, an analytic sun glint streak. ~1 draw, trivial ALU,
    matches the unlit world's language, and reads perfectly at 900–1000 u from the rail.
  - **(b) Ghibli-water patch.** The real water material on a local plane — true ripples,
    but its regimes/envelopes are authored against the SEA's camera distances, and it
    prices a real shader into every climb frame. Only if (a) reads flat in capture.
- **Shore:** a feathered wet-band + reed/grass ring (the autumn-terrace precedent), two
  or three framing trees (the framing-tree system exists). Any radial feather ends at
  r ≤ 1.0 — the mountain-solidity lesson.

---

## 3. WAVE 2 — HILLS AND GROUND

- Two or three soft relief swells (+30–60 u) NW and N of the lake to break the pancake
  horizon the screenshot shows. Verify: the rail-clearance suite (rail is at 850–1100 u
  here — huge margin, but the suite is the proof), and the coast-slope bar (< 4) with
  **stride == window** (the sampled-continuity law).
- The bare mottle gets intent: extend the flower drifts north into a lake meadow on the
  south shore; the far side reads as moor/heath (zone-field driven) — **owner decision
  L3**: full meadow, or keep some wild bare character.

---

## 4. WAVE 3 — TREES AND ALIVENESS

- **Lakeshore groves:** a birch/maple stand on the north shore, scattered pines west —
  via a carve exemption annulus around the lake (the cypress-disc precedent). Then the
  MANDATORY pair: re-emit thresholds via `scripts/act2-forest-arch-calibrate.mjs`
  (full-precision transcription) and re-bake `scripts/bake-forest-visibility.mjs` —
  any terrain change silently invalidates both.
- Forest ceilings: hero+mid is at 3,922 against 3,950 — the groves are FAR-tier at rail
  distance (> 520), so they land in the far budget, but the suite decides, not this
  sentence.
- **Aliveness levers — owner decision L2, pick up to two:**
  - dusk motes/fireflies over the shore (the mote system exists in-world) — cheap;
  - a lone hero tree on a small lake islet (lone-tree-hill precedent) — cheap;
  - drifting cloud shadows over the plateau — needs design (the deck casts none today);
  - a bird flock — NO existing system, genuinely new work, priced separately if wanted.

---

## 5. BUDGET AND GATES

- The seam cell is **7.01 ms p50** (Lane B Medium/iGPU, transition plan §5) and this
  region is in-frame during the climb — this plan must not regress it. New gpu-split
  pair at a climb station (`--seek 0.62 --chapters 4,5`) before/after, plus the seam
  cell re-run.
- Tests knowingly touched: world-height (basin term + maybe the plateau pin), forest
  scatter/visibility (re-bake), rail clearance, world seating. Everything else must stay
  green untouched.
- **The wave gate, every wave:** capture p 0.56 / 0.60 / 0.64 / 0.68 at t=9 through the
  grade, judged against the owner's screenshot — the lake must read from the rail
  without the camera being told where to look. Boundary for any seam scoring is
  **0.7543** (never the default).

---

## 6. OWNER DECISIONS

- **L1:** lake surface — painted disc (recommended) or Ghibli-water patch?
- **L2:** aliveness levers — which of: shore motes/fireflies, lone islet tree, cloud
  shadows, birds (new system)?
- **L3:** does the plateau keep wild bare/moor patches, or go full flower meadow?
- *(Wave 0 needs no decision — the retime answers the owner's own observation; it lands
  first and alone so it can be reverted alone if the taste call goes the other way.)*

---

## 7. TRAP REGISTER (paid elsewhere; this work must not re-buy them)

- Height terms taper in EVERY direction; ±4500 plate edge extrudes.
- Calibrate-then-transcribe at full precision; re-bake the visibility stamp; never
  hand-tune `FOREST_ARCH_T_BY_AREA`.
- The flyby pass is in frame p 0.545–0.648 — judge THIS plan's region from 0.56–0.68
  stations, not the seam window.
- `material.fog` first when something reads right in the rig and washed in-game.
- Never edit the tree while a capture or gpu-split runs; stage explicit paths only.
- p-fraction constants scaled at 1A/1C re-scale on ANY future re-map.
