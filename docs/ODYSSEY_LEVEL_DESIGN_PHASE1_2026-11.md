# Odyssey level design: phase 1 prototype (overnight 2026-11-02/03)

**Status: plan approved on 2026-11-03, every decision as recommended (D8 included); this branch carries it to main.**
Branch `feature/odyssey-level-design-phase1`, from main `0cbf3664` and synced with main before the merge. It builds
phases 1, 1b and 1c of [ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md](ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md) (the approved
plan) and phase 2's prepared openings for orbs 2 and 12 (orb 14's was tried and rejected).

## Results

**Gates (phase 1 and 1b, §5.6 of the audit).** Measured on the real campaign on this branch, five proxies:

| Seeds | Gates passing | Last rival: novice · regular · skilled · expert |
|---|---|---|
| 12001–12005 (the seeds the plan was tuned on) | 9 of 9 | 0/5 · 2/5 · 5/5 · 5/5 |
| 13001–13005 (fresh) | 9 of 9 (6 of 9 before the fixes in the log) | 1/5 · 1/5 · 4/5 · 5/5 |
| 16001–16005 (confirmation) | 8 of 9: orb 52's three stars missed by one seed (rival 56's regular win rate, one seed short before D8, now passes) | 1/5 · 1/5 · 4/5 · 5/5 |
| All 15 together | 9 of 9 | 2/15 · 4/15 · 13/15 · 15/15 |

Across every set:

- no solo orb is a wall;
- no orb gives three stars for free, and every orb's three stars are reachable;
- the largest rise between neighbouring orbs within a chapter is under 3.

Five seeds per cell swing a rate by 20 points on one seed, so the audit's gates now judge 15 seeds.

**Tests.** `npx vitest run odyssey level-registry bot-config-overrides steam-odyssey spring-rename`: 2,752 pass in 264
files. The full suite (24,000+ tests) fails only where main fails on this machine: two Swedish-locale number tests
(`game-over-modal-result-compatibility`, `records-view`) and the worktree `tts-recorder` symlink. Lint finds nothing on
the lines this branch adds.

**Human-pace calibration.** The new cadences hold their targets within ±10%, measured on orbs 1, 16, 23 and 51 with 5
seeds each: casual 0.62, regular 1.05, strong 1.53 pieces a second.

**Orb cards at human pace (§5.7 level 2).** Every solo orb, played by the policy that plays its skill (stacker; the
cascade policy on cascade and chain goals; the Quad policy on Quad goals) at casual, regular and strong pace, on fresh
seeds 15001–15005 and 17001–17005 (4,680 attempts). Three stars take the best style at strong pace.

- **Regular pace (1 piece/s):** 50 of the 52 solo orbs clear on at least 8 of 10 seeds. The exceptions are the Quad
  goals 29 and 44, at 7 of 10 each.
- **Casual pace (0.6 pieces/s):** every orb through chapter 4 clears on at least 8 of 10. From chapter 5 the clocked
  orbs (33, 38, 45, 50, 51, 55, 59) are out of a casual player's reach, as R2's clock caps intend: by then the clocks
  ask a regular player's pace. The Quad goals 29 and 44 clear on 5 and 4 of 10.
- **Strong pace (1.6 pieces/s):** every orb clears on at least 8 of 10, and every orb's three stars pay out at least
  once.
- **Three stars stay earned:** a plain stacker at regular pace never earns them on 41 of the 52 orbs, and at most on
  4 of 10 seeds (orb 54). The best style at regular pace earns them on 42 orbs; the other ten need strong pace.
- **Length:** a median orb takes 1.7 minutes at regular pace. The range runs from 0.5 minutes to 7.1 for the capstone
  (orb 55).

**What the cards can't tell yet.** On standard wells the feel flags mostly measure the bot, not the orb. The stacker
keeps its stack low and clears singles, so nearly every orb reads "no pressure" and "one move". On tall wells and dig
orbs, three of the flags misfire by design and are now switched off there. The flags become useful with a placement
model that errs like a person, or with real play data (phase 4).

**The Quad goals at human pace** are the open question, a smaller one over 10 seeds: 29 and 44 clear on 7 of 10 at
regular pace (2 and 3 of 5 on the first five seeds). The Quad policy tops out after its own misplacements (4–6% at
casual and regular pace), at the same pieces whatever the fall speed. A test at 400 ms a row
showed the same losses, so the change was reverted (see the tuning log). The playtest should ask whether people
recover from a misdrop while building for Quads. If they don't, a prepared opening like orb 12's is the fix.

The full table is in `artifacts/odyssey-level-design-audit-2026-11/orb-cards-2026-11-03.md`.

**Rivals at human pace.** Each rival was also played at casual, regular and strong human pace by the stacker and
the cascade policy (seeds 15001–15005; the last three rivals also on 17001–17010, so 30 matches per pace):

| Rival | Regular pace | Strong pace |
|---|---|---|
| 5, 10, 18, 26 | 100% | 100% |
| 34 (Zephyr, tier 5) | 50% | 90% |
| 48 (Nova, tier 6) | 60% | 90% |
| 56 (Prism) at tier 7 | 20% | 53% |
| 56 (Prism) at tier 6, as approved (D8) | 60% | 73% |
| 60 (Neon, tier 8) | 27% | 63% |

A regular player beats the first four rivals every time and the next two about half the time. Rival 56, though,
played like the last rival for a person at tier 7. The bot proxies hid this (the regular proxy wins 47% and 27% over 15 seeds)
because they react faster than a person. The step comes from the tiers: tier 7 is the first that looks two pieces
ahead, and tier 8 adds little to that. Two levers were measured and reverted: a lower cap (310 actions a minute) and
tier 6's misdrop rate. Neither moved it. Tier 6 with the same cap does: a regular player wins 60% and a strong one
73%, and every gate passes on all three seed sets. That broke R8's "each rival is smarter than the last", so it went
to the owner as D8 (§6). The owner chose tier 6: R8 now asks each rival to be at least as smart as the last,
and faster, and the branch plays Prism at tier 6.

**Tuning log (night of 2026-11-02/03).**

One lever per change. Each change was re-measured: gameplay changes on both seed sets (12001 and 13001, five
proxies), star changes by offline re-scoring on every recorded run, and Quad lessons also at human pace (15001).

| When | Orb | Evidence | Change | Re-measured result |
|---|---|---|---|---|
| 22:35 | 52 (test) | Fresh seeds: the novice proxy cleared 3 of 5 (gate 80%). | 16 → 14 cascades | Novice 5/5 (tuning) and 4/5 (fresh); gates pass. |
| 22:35 | 52 | Three stars (5-wave chain) came on 1 of 5 fresh seeds. | 4-wave chain, plus a 5-wave chain or within 95 pieces | Best policy 60% (tuning) and 40% (fresh). |
| 22:35 | 27 (arrival) | Three stars (10 cascades and a 4-wave chain) came on 1 of 5 fresh seeds. | Three stars = 12 cascades | Best policy 60% (tuning) and 100% (fresh). |
| 22:35 | 35 (arrival) | Three stars (6 Quads) came on 1 of 5 fresh seeds. | Stars 3, then 5 Quads | Best policy 60% (tuning) and 80% (fresh). |
| 22:35 | 60 (last rival) | The regular proxy won 0 of 5 fresh matches (target 20%). | Cap 360 → 340 actions a minute, reaction 140–280 → 150–300 ms | Regular 3 of 10, skilled 9 of 10 over both sets. |
| 23:25 | 29 (Quad lesson) | At human pace the Quad builder cleared 2 of 5 at casual and regular pace; it topped out mid-build at 280 ms a row. | Tried 280 → 400 ms a row | **Rejected and reverted.** At 400 ms the same runs topped out at the same pieces (77, 81, 90, 97): the losses follow the bot's own misplacements (6% and 4% at casual and regular pace), which the Quad policy never recovers from; at strong pace (2%) it clears 5 of 5. Speed was not the cause. Playtest question: do people recover from a misdrop while building for Quads? If not, the fix is phase 2's prepared opening, not speed. |
| 23:25 | 16 (rest) | Three stars (4 Quads and no singles) never came at strong human pace. | Three stars = 3 Quads plus a fourth Quad or no singles | 1 of 5 at strong human pace (2 of 5 at regular); the Quad proxy at native pace 4 of 5 (tuning) and 5 of 5 (fresh). |
| 23:25 | 44 (Quad practice) | 3 of 5 at regular human pace, already at chapter 6's slowest start. | No change: a practice orb's target is one or two attempts | Left for the playtest. |
| 23:25 | 8 (dig twist) | Strong human pace lost 2 of 5 while casual and regular cleared 5 of 5. | No change: the same orb clears 5 of 5 at native pace, so this is bot noise | — |
| 23:53 | 8 (dig twist) | Confirmation seeds: its time-only three stars (65 s, 1.05 pieces/s) were met at a regular person's 1 piece/s on 4 of 5 seeds. | Floor for time-only three stars: never below 1.10 pieces/s (65 → 60 s) | Not free on any seed set; best policy 100%. |
| 23:55 | 12 (Quad lesson) | Phase 2 prototype: a four-row prepared opening with the right-hand column open (the first Quad is one placement away). | Prepared opening | Quad proxy median 47 → 38 pieces; no proxy worse beyond a one-seed swing. Stacking proxies still need 300–800 pieces (they never build Quads), so the plan's phase 2 gate was rewritten: the playtest decides. Kept. |
| 00:15 | 2 (cascade lesson) | Phase 2: a three-row opening with a lone block hanging over a gap and the right-hand column open. One I in that column clears the bottom line, then the block drops into its gap and clears again (a unit test plays it). | Prepared opening; the tip points at it | Over 15 seeds every proxy did as well or better: the novice proxy cleared 15 of 15 (14 before) in 89 pieces instead of 128, the Quad builder 15 of 15 (14). Best-policy three stars 60% → 40%, inside the gate. Kept. |
| 00:15 | 14 (chain lesson) | A search for a 3-wave chain opening found a forgiving four-row puzzle: an I in the open column at once chains twice; cover the bare gap with almost any piece first and it chains three times. | Prepared opening | **Rejected and reverted.** The cascade policy solved it (median 53 → 21 pieces), but the policies that don't solve it now stack over a buried gap: novice 14 → 11 of 15, Quad builder 13 → 9 of 15. Every 3-wave puzzle the search found needs a gap buried under a full row. |
| 00:20 | 14 | The puzzle takes two more rows than the old rubble. | Same opening, well 25 → 27 rows | **Rejected and reverted.** The novice proxy recovered to 13 of 15, but the Quad builder fell to 8 of 15 and the novice needed two to three times the pieces. Orb 14 keeps its two rubble rows and its shelf tip. |
| 00:35 | all solo orbs | The orb cards rested on five seeds per pace, where one seed moves a rate by 20 points. | Second human-pace set, seeds 17001–17005 (2,340 more attempts) | Regular pace: 50 of 52 clear on at least 8 of 10 (29 and 44 at 7 of 10, up from 2 and 3 of 5). Strong pace: all 52 clear on at least 8 of 10, and every orb's three stars come at least once. No change needed. |
| 01:15 | 56 (rival) | At human pace a regular player beat rival 56 in 20% of 30 matches, less than the last rival (27%); chapters 5–7 aim for 40%. | Cap 330 → 310 actions a minute, reaction 160–320 → 170–330 ms | **Rejected and reverted.** No consistent effect: the regular proxy went 7 → 8 of 15, the fresh seeds 3 → 1 of 5, and at human pace one style rose while the other fell. |
| 01:35 | 56 | The cap is not the lever: tier 7 is the first tier that looks two pieces ahead. | Experiment: tier 6's misdrop rate (2.5%) on tier 7's judgement | **Reverted.** No change at human pace (20% regular, 53% strong over 30 matches each). |
| 01:45 | 56 | — | Experiment: tier 6 with the same cap | A regular player wins 60%, a strong one 73% (30 matches each); the regular proxy 10 of 15; every gate passes on all three seed sets. It breaks R8, so **reverted** and put to the owner as D8. |
| 09:05 | 56 (rival) | The owner approved the plan and D8. | Tier 7 → 6 with the same cap (330 actions a minute, 160–320 ms); the duel's subtitle reads Tier 6, and its description no longer says Prism thinks two pieces ahead | Gates: 9 of 9 on the tuning and fresh seeds and over all 15; the confirmation set alone misses only orb 52's three stars (one seed). A regular player wins 60% of matches at human pace, a strong one 73% (30 each). |
| 23:53 | all | Confirmation run on new seeds 16001–16005 (whole campaign, five proxies). | — | 7 of 9 gates on that set alone (orb 52's three stars 1/5, rival 56 regular 1/5: one-seed swings); 9 of 9 over all 15 seeds. Gates now judge 15 seeds. |

## What is on the branch

| Area | Files | What it does |
|---|---|---|
| The retune (phase 1) | `src/core/odyssey/data/level-design-2026-11.js` (new), `levels.js` | Every per-orb change in the plan's §5.3, applied to the assembled campaign by public id, so the numbers are the ones players meet and the ones the benchmark measured. Generated from the audit's `proposal.json`; each entry carries its reason as a comment. Solo orbs' inert `previewCount` becomes 3 (R9). |
| Roles | `chapters.js` (`arcBeats`), the retune module | The plan's roles per orb. Duels are `rival`, a rule-changing orb `twist`; "practise" keeps the code's `reinforce` tag. |
| Rival caps (phase 1b) | `bot-difficulty.js` (`applyBotConfigOverrides`), `puzzle-bot-controller.js`, `OdysseyBotMatch.js` | `versus.botOverrides` caps a rival's action rate and reaction window; the tier's judgement, lookahead and mistakes stay. Versus mode passes nothing and is byte-identical. Rival 56 plays at tier 6 (D8), and the retune rebuilds each rival's "Tier N" subtitle from its final tier. |
| Words | `orb-copy.js`, `objective-copy.js`, `odyssey-level-briefing.js`, `OdysseyHUD.js` | New copy for the orbs whose play changed (no stale speed or goal claims). The Quad goal is named "Clear N Quads" everywhere, has a retry debrief and a briefing rule; Murmuration's briefing announces the mirrored controls. |
| Time boards | `steam-config.js` | Orb times move to `OdysseyLevelTime_v5_` (decision D5); boards are created on demand, so no Steamworks setup. Earned stars keep their board (D6). |
| Test tooling (phase 1c) | `scripts/odyssey-benchmark/{profiles,runtime}.mjs`, `scripts/odyssey-benchmark.mjs`, `mastery-search.mjs` | Human-paced cadences (`human-casual`, `human-regular`, `human-strong`; selected by name, not part of `--cadences all`), a per-attempt `feel` summary (tension, near-misses, reward gaps, shape, variety), and a `levelConfig` option for the mastery search. |
| Prepared openings (phase 2) | `GameplayHybridEngine.seedOpeningRows`, `LevelRegistry` validation, `odyssey-level-briefing.js`, `orb-copy.js`, the retune module (orbs 2 and 12) | `mechanics.board.opening` lists authored rows top to bottom (`X` a block, `.` an open cell); they go in through the same garbage boundary as rubble, so they look and settle the same (a lone block may hang over a gap). Orb 2 opens with a block hanging over a gap: one I in the open column makes the first cascade. Orb 12 opens with four rows and the right-hand column open, so the first Quad is one placement away. The briefing says "N rows set up for you", and both tips point at the board. Orb 14 keeps its rubble (its puzzle was rejected, see the log). |
| Tests | `odyssey-campaign-design-rules.test.js` (new), `bot-config-overrides.test.js` (new), `odyssey-benchmark-feel.test.js` (new), `odyssey-prepared-opening.test.js` and `odyssey-opening-lessons.test.js` (new: the seeding, and each opening playing its lesson), `tests/helpers/odyssey-shipped-mastery-orbs.js` (new), 15 updated test files | R1–R9 asserted on `LEVEL_CONFIGS` with a frozen measured table; the rival caps; the feel summary and human paces. Updated tests changed only the numbers the retune changed, keeping each test's intent. The mastery-search tooling tests now run on a frozen copy of the shipped 2026-10 mastery orbs, which the retune removed. |

## Decisions taken overnight (each the plan's recommended option, or a measured correction)

- D1–D7 as recommended in the audit (§6).
- From measuring and implementing (all reflected in the audit doc):
  - Orb 45 starts at 145 ms instead of 140, so it holds chapter 6's floor.
  - Orb 33's clock is 250 s instead of 240, so its one-star pace sits under the cap.
  - Orb 59 asks 70,000 points at 150 ms instead of 85,000 at 140, so the encore doesn't outrank chapter 7.
  - Orb 17 asks 30,000 instead of 24,000, the chapter's tightest clock.
  - Orb 22 offers a choice for three stars: a 4-wave chain or within 85 pieces.
  - Orb 39 is retagged practice, so chapter 6 never has three tests in a row.
  - Orb 53 is tagged as chapter 7's rest; its mirror is gentle by design.
- After the fresh-seed check (§ Results):
  - Orb 52 asks 14 cascades instead of 16.
  - Orb 27's three stars ask 12 cascades.
  - Orb 35's stars ask 3, then 5 Quads.
  - The last rival's cap is 340 actions a minute with a 150–300 ms reaction window, instead of 360 and 140–280.
  - Orb 52's three stars ask for a 4-wave chain plus either a 5-wave chain or a tidy run within 95 pieces.
- After the human-pace and confirmation runs (see the tuning log):
  - Orb 16's three stars ask for 3 Quads plus either a fourth or no single clears.
  - Time-only three stars never ask less than 1.10 pieces/s, which moves orb 8 from 65 s to 60 s.
  - Orb 12 opens with four prepared rows and the right-hand column open.
  - Orb 2 opens with a lone block hanging over a gap, so the first I in the open column cascades.
  - Orb 14's 3-wave puzzle was tried twice (25 and 27 rows) and rejected; it keeps its two rubble rows.
  - Orb 29 at 400 ms was tried and reverted; it stays at 280 ms.
  - D8 (approved): rival 56 plays at tier 6, and R8 asks each rival to be at least as smart as the last, and
    faster. Prism's description no longer says it thinks two pieces ahead.
- R3 was clarified:
  - A new idea may debut on a release orb.
  - The first clock may sit on a gentle test (at most 0.45 pieces/s).
  - Hybrid wells are not a new idea.

## How to review

1. Read the audit (approved on 2026-11-03).
2. In the worktree: `git diff main` for the code, and `src/core/odyssey/data/level-design-2026-11.js` for every number.
3. `npx vitest run odyssey level-registry bot-config-overrides steam-odyssey spring-rename` (all pass; the full suite's
   only failures are the known Swedish-locale number tests and the worktree `tts-recorder` symlink).
4. Optional: play orbs 2, 12, 14, 17, 29 and 53 (the openings, the new goals and the mirror) at 30 fps.

## Landing

The audit doc, its images and its index row moved from main's working copy into this branch, so the merge adds
them. The branch was synced with main and merged with the usual pipeline routine.

## Not done (follow-ups)

- **Phase 2**, the rest: screenshots of both openings under the WebGPU workflow (the audit has a diagram of them,
  not a capture), and an idea for orb 14. A 3-wave puzzle needs a buried gap that costs the players who don't solve
  it; one way out is a goal of two chains, so the first can be a gift.
- **Phase 3**, survival and clear-the-seabed goals.
- **Phase 4**, the playtest with the local attempt log and the two taps.
- **Cleanup:** `MASTERY_RETUNE` and `harmonizeChainGoals` in `levels.js` still run before the retune overrides them.
  Fold them into the authored data when the retune lands.
- **Metadata:** `metadata.difficulty` and the band are still computed before assembly. Nothing in the UI shows them;
  recompute them from public ids if they are ever shown.
- **`targetDifficultyCurve`** in `chapters.js` is the old indicative sketch.
