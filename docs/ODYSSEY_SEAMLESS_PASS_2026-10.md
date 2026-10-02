# Odyssey — Seamless Pass (2026-10)

**Status: LANDED on `feature/odyssey-seamless`** (integration branch; lane branches
`feature/odyssey-sl-{seams,space,world,ribbon}` merged into it). Follows the
[masterpiece pass](ODYSSEY_MASTERPIECE_PASS_2026-10.md) (main `4f7922e5`). Three.js `0.186.1`.

The owner's brief: improve all the chapters, make the journey **seamless** — every transition
between chapters — improve the **level node** and **spline (ribbon)** design, and keep
**performance** good.

Run as four parallel lanes with file-disjoint ownership and one shared GPU lock (protocol:
`repos/odyssey-gpu/PROTOCOL-SEAMLESS.md`), integrated and verified on one branch. Every change
was screenshot-verified (ADR-0007); perf claims are Lane A GPU-split measurements (ADR-0016).

---

## 0. The definition of seamless used here

A seam passes when, on an 18-station seam capture (`odyssey-chapter-capture.mjs --seam=N-M
--settle=6000`), `scripts/odyssey-seam-luma.mjs --seam=N-M` reports a worst luma step
**≤ 45 per 0.01 p** (5→6 additionally: no rises after the boundary, end luma ≤ 60), AND the
contact sheet shows no pop, no wrong-colour flash, nothing at the lens, no chapter seen
through another. The luma script now reads the boundary from the capture sidecar.

| Seam | Before (audit, main) | After (integrated) |
|---|---|---|
| 1→2 Earth Core → ocean | **119.7** (white flash, luma 225) | 42.6 PASS |
| 2→3 breach | 30.2 | 29.7 PASS |
| 3→4 | 6.5 | −4.1 PASS |
| 4→5 | **56.3** (swoop + lavender veil flash) | −8.3 PASS |
| 5→6 sky → space | FAIL (2 rises after the boundary) | −35.7, 0 rises, end 29.0 PASS |
| 6→7 omen → black hole | −14.3 (stars through the hole) | −10.3 PASS |
| 7→8 black hole → city | **158.7** (ribbon slab at the lens, rolled city) | −19.8 PASS |

## 1. What made seams non-seamless (systemic causes, all fixed)

1. **Non-diegetic overlays at every seam** — the threshold director drew an additive veil, a
   torus ring and 180 rail particles the eye flew through (the 4→5 lavender flash). All seven
   profiles now author none of them; unused components are not built (−3 draws/seam).
2. **Wall-clock camera beats stacked on each seam** — a +7–8° FOV pulse, a look-ahead jump, a
   1.45 s vista beat, and a framing target that switched at the boundary then eased by time.
   Framing now blends source→target across the seam window by progress; look-ahead is
   `1 + 0.4·seamWeight`; the vista beat follows the seam envelope; the 6→7 hairpin is damped by
   a rail chord; the city's stage basis starts at the 7→8 window start (`resolveJourneyFraming`,
   `transitions/odyssey-seam-schedule.js`).
3. **Opaque content crossfaded by forcing it transparent** — coverage 1−(1−a)(1−b) = 0.75 at the
   midpoint, so backgrounds showed through (stars inside the black hole). The environment
   manager now staggers opaque fades (incoming full by t = 0.5, outgoing starts at 0.5);
   `userData.odysseyFadeExempt` objects are never forced transparent; `userData.chapterCoverage`
   is published for chapters that fade their own opaque content.
4. **p-windows that drifted when the layout grew** — corridor field, cloud bank, breach constant
   (`ODYSSEY_BREACH_P` 0.20023 → 0.13727, now recomputed from the live spline by a test), the
   luma script's default boundary. Re-anchored with `arcToP()` on the live seams.
5. **Boosts with hard releases and post terms keyed on the active-chapter flip** — the 5→6 earth
   hold (all of ch6 dipped 1 → 0.54 in one frame), the ch8 max() boost, the ch7 lens/black-crush
   steps. All now follow crossfade weights (`resolveCh7LensDrive`).
6. **The ribbon at the lens** — 0.2–0.8 u from the eye at 4→5 and 7→8. The ribbon fades near the
   camera (1.5–6 u) and nodes/padlocks fade near the lens.

## 2. Each seam now carries something across

- **1→2:** the First Heart — now seated on the rail, dead centre at the top of the climb — is the
  vent that boils the sea. Its fire glows through the steam's aperture and cools into the
  ocean's light from above; the steam darkens, dissolves the rock (scene fog driven by density)
  and brightens into the water with no white-out; embers become rising bubbles
  (`world.setQuenchCarry(t)`), fish fade in by the quench density.
- **2→3:** bubbles become spray at the real breach; the breach floods with light.
- **3→4 / 4→5:** the world is continuous; framing glides; no veil.
- **5→6:** the aurora grows out of the world's airglow before the boundary and fades after it;
  the void sky is fully revealed (0.7730) before the world switches off (0.7765).
- **6→7:** one black hole throughout — the omen→Gargantua glide runs on progress and completes at
  0.8487; exactly one opaque shadow at any progress.
- **7→8:** the accretion light becomes the city's sun — Gargantua glides onto the Retrosun's
  direction, the shadow closes, a copy of the Retrosun fills the hole while the photon ring
  swells into its limb, and the city's own sun takes over on the frame the copy hides.

## 3. Level nodes and the ribbon (spline)

From the code audit: the ribbon's patterns were scaled to the whole 2533-u path (a "crack" was
40–290 u long — every chapter read as a flat neon strip), 256 segments kinked, the lit frontier
missed the real node by up to ~380 u, an invisible core tube cost a draw, eight lit torus
markers cost 8 draws and the only lit pipeline; node per-chapter styles were dead code, every
orb wore the same orange sparkle ring and pink padlock.

- **Ribbon:** arc-length pattern scale, hidden core tube removed, ~1536 segments, near-camera fade
  and a minimum distant width, the frontier lit at the furthest node's real path position; one
  diegetic recipe per world (basalt crust with molten cracks, plankton/caustics, sunlit golden
  thread, frosted stone, white contrail, stardust, amber plasma matching the disk, true neon only
  in the city) crossfading smoothly across each seam; the eight lit rings are now cuffs on the
  rail.
- **Nodes:** state told by light and shape, not hue (locked dim/frosted with a small tinted glyph,
  current breathing, completed warm fill, selected ringed); each orb takes its world's light.
- Not landed: the "world beacons" rewrite (one opaque gem body + one billboard, 6 → 2 draws) was
  in progress when its lane was stopped; it is parked uncommitted in `serenity-blocks-sl-ribbon`.

## 4. Chapters

- **Earth Core:** the First Heart (above); the framing pillars are Fingal's Cave basalt bundles
  (faceted prisms with stepped tops, per-face normals) instead of smooth 18-sided cones; the
  vault's ember veins gather into fissure fields between quiet charred plates.
- **One World (ch2–5):** cumulus undersides with slate cores and bright linings; snow runs down
  the couloirs over stone ribs; alpine meadows instead of khaki slopes; perf (§5).
- **Space / black hole / city:** baked lattice noise, the nebula as one draw, a softer comet, the
  ch8 gate bridge lowered into the boulevard (it read as a black bar across the frame).

## 5. Performance (Lane A, RTX 3070, High 1080p, GPU p50 ms)

Integrated branch vs main `4f7922e5`, alternating per station on one quiet machine (timer tick
≈ 0.066 ms; `baseline/baseline-repeat` shown as one value when equal):

| Station (seek) | Main | Integrated | Draws | Pre-masterpiece (14b576a1) |
|---|---|---|---|---|
| ch1 (0.051) | 1.18–1.25 | 1.11–1.18 | 76 → 70 | 1.31 |
| ch2 (0.115) | 0.72 | 0.66 | 38 → 30 | 0.52 |
| ch3 (0.225) | 1.05 | 0.92 | 57 → 52 | 0.98–1.05 |
| ch4 (0.28) | 0.92–0.98 | 0.85 | 53 → 52 | 0.92 |
| ch5 (0.42) | 0.72 | 0.66–0.72 | 56 → 54 | 0.66 |
| 5→6 (0.7401) | 0.59 | 0.66 | 50 → 45 | 0.52–0.59 |
| ch6 (0.84) | 0.98 | 0.59 | 48 → 40 | 0.39 |
| ch7 (0.91) | 0.66 | 0.39 | 36 → 30 | 0.85–0.92 |
| ch8 (0.98) | 0.79 | 0.46 | 102 → 80 | 0.46 |

The masterpiece pass had made ch2 (+0.20), ch4 (+0.13), ch6 (+0.62) and ch8 (+0.33) more expensive;
this pass takes every station back to or below main, ch6–8 by 0.27–0.39 ms (baked lattice noise,
the nebula as one draw with per-vertex warp, towers drawn first so the city occludes, tiered
sprites), the world's ocean column and massif by 0.06–0.13 ms, and draws 1–22 fewer per station across the
journey (threshold director, corridor layers, markers, core tube). 5→6 is one tick up (the aurora
curtain band) with five fewer draws. ch2 remains 0.14 ms above the pre-masterpiece figure.
JSONs: `repos/odyssey-gpu/perf-baseline/` (`integ-1/`, `sl-space-1/`, root = the morning matrix).

Quality tier now reaches every chapter (`qualityTier` in the chapter create() options, mapping in
`shared/odyssey-quality-tier.js`): Medium/Low trim nebula octaves, ch7 sprites, ch8 rain, tower
banks and signs.

## 6. Instruments and process notes

- `scripts/odyssey-seam-luma.mjs` — `--seam=N-M`, boundary from the capture sidecar; 5→6-only
  gates apply only to 5→6.
- Parallel lanes need disk headroom: the C: drive hit 0.66 GB free mid-pass (each worktree
  ~1 GB). Check free space before creating worktrees; measure from a re-pointed clean worktree.
- Measure lane commits from a detached checkout, never from a live lane worktree (its dev
  server serves uncommitted edits).

## 7. Open items

- Node world-beacons rewrite (parked, unverified) — see §3.
- ch6: a soft grey galactic-band smudge at the right edge; the comet tail could be brighter.
- ch5: the white contrail ribbon is broad where the rail runs beside the eye.
- The world lane's last uncommitted polish (12 lines in `odyssey-world-renderer.js`) is parked.
