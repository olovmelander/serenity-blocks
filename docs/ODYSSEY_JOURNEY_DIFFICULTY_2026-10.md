# Odyssey journey difficulty review — 2026-10-07

The working target is an approachable main route that becomes more demanding through
learned skills, with difficult optional mastery stars and clear chapter peaks. This is
a working interpretation of the user's request for good, increasing challenge; a more
specific audience preference has not been supplied. It is not a claim that current
human difficulty has been calibrated.

This review continues the [balance handover](ODYSSEY_BALANCE_HANDOVER_2026-10.md) and
[automated benchmark record](ODYSSEY_PLAYTEST_BENCHMARK_2026-10.md). Historical inputs,
measurements and source are preserved in the [evidence archive](benchmarks/2026-10-07/README.md).
The new [journey evidence archive](benchmarks/2026-10-07-journey/README.md) preserves
this continuation's registration, raw results, configs, capabilities, reports,
reproducible analysis and source patch.
It adds an assessment and playtest protocol, not a new mode, progression system or
product feature.

## What should become harder

The authored rhythm alternates arrival, teaching, reinforcement, tests, recovery and
bosses. Challenge should rise across the journey without requiring every successive
orb to be harder. Recovery after a peak helps a player consolidate a skill; it should
not accidentally contain a sharper execution demand than the test before it.

Assess primary completion, active duration and optional mastery separately. A
successful level unlocks the next level in `OdysseyStateManager.completeLevel`;
two/three stars are not campaign admission requirements. Normal orbs finish after the
primary goal's cascade settles. Showcase orbs retain manually finishable play after
the goal. A quality target that requires construction is appropriate only when that
construction is achievable within the actual finish rules.

A useful challenge asks the player to apply a taught skill with less room for error,
combine familiar mechanics or choose a better strategy. A suspect spike is an
unexplained speed discontinuity, repeated input rejection that defeats an intended
move, an extended match with little meaningful progress, or a mastery condition whose
required setup cannot survive the completion rules. Longer duration alone is not
evidence of useful difficulty, and a single sampled loss is not evidence of a defect.

## Eight-chapter review

The initial campaign has three seeds per orb/policy at each policy's native cadence.
The observations below identify review priorities, not human success probabilities or
statistically established differences between chapters.

| Chapter and orbs | Intended role in the journey | Evidence and next concern |
| --- | --- | --- |
| 1 · Earth Core, 1–5 | Introduce control and cascades; first duel and boss. | All initial attempts complete. Orb 4 takes 10.3–13.2 active minutes for stacker versus 3.5–4.1 for specialist: inspect attack production and first-duel fatigue. Orb 1's no-singles mastery is demonstrated by the later Quad policy. |
| 2 · Deep Ocean, 6–11 | Teach digging and controlled cascades with recovery. | All initial attempts complete, which does not rule out an abrupt mechanic. Orb 6 on the reviewed main switches from 800 to 120 ms at 15 of its 20 required lines. The local branch replaces that transition with approximately 635.76 ms; the diagnostic cohort preserves all baseline wins. |
| 3 · Surface, 12–19 | Reinforce variety, test, then release before the boss. | All initial attempts complete. Validate teaching and mastery with players; bot completion alone cannot establish that the mechanics are understandable. |
| 4 · Mountains, 20–27 | Demand cleaner decisions while preserving recovery. | First initial solo losses: one stacker top-out each at 23 and 27. Specialist and cascade complete every sample. These are review cues, not sufficient retuning evidence. |
| 5 · Sky, 28–35 | Stronger tests and a closing boss pair. | Orb 33 stacker wins 1/3; a 6–7 loss lasts 23.7 minutes. Preserve the intentional peaks while testing duel duration and fatigue. |
| 6 · Space, 36–48 | Repeated tests and two boss/recovery sequences. | Initial failures cluster at 41/43/44/46; cascade also tops out once at release orb 45. The fresh cascade/steady diagnostic records 16/20, 17/20, 20/20 and 18/20 wins on 43/45/46/47. Recovery wins are shorter, but releases still incur top-outs. Orb 48 is intentionally a boss, despite its roughly 12.7-minute initial stacker median. |
| 7 · Transcendence, 49–55 | Late mastery tests, recovery at 54, true finale at 55. | Orb 51 exposes execution sensitivity; slower gravity fails its registered adoption gate. Orb 52's roughly ten-minute stacker median is a boss pacing concern. Orb 55 completes 20/20 for each steady policy; deep-star construction remains unqualified. |
| 8 · Urban encore, 56–59 | Optional coda after the main narrative finale. | Orb 58 defeats all initial stacker/cascade samples; specialist wins 3/3, under a restricted-opponent benchmark. The new production-opponent pilot also defeats cascade on all three fresh seeds. Orb 59's confirmed 210-second deadline is the current baseline; its higher stars remain unresolved. |

Chapter 8 is authored as an encore, but it remains part of the existing sequential
59-orb route. This description does not introduce a new unlock rule.

## Supported changes and unresolved questions

The earlier confirmation supports the already adopted orb-59 deadline of 210 seconds.
On fresh seeds 5001–5100 at steady cadence, cascade improves from 9 to 59 wins per
100 and specialist from 27 to 88, with no lost baseline wins. All wins earn one star
under the benchmark observation cutoff. The primary contrast passes its registered
paired test and multiplicity correction. Do not pool the screen with this holdout,
rerun those seeds as an independent confirmation, or compare today's baseline with
the now-identical `orb59-deadline210` scenario.

The current orb-6 correction is a separate, mechanically identified issue. The
authored arrival starts at scoring level 4 with an 800 ms drop interval and progression
enabled. The first 15-line level transition replaces that interval with the global
level-5 value of 120 ms, an abrupt 6.67-fold speed increase just before its 20-line
goal. The proportional schedule implemented on the local branch retains scoring level
4, the initial 800 ms interval and level progression; its first transition becomes
approximately 635.76 ms. Thirty-nine focused tests cover the correction, including
both physics paths and campaign scope. The diagnostic cohort below preserves every
baseline win. This local change is not yet shipped on main and is not a claim of a
measured human win-rate improvement.

Other questions remain open:

- Orb 51 has six top-outs in twenty cascade/steady baseline attempts; specialist wins
  all twenty. The 75/100 ms candidates add only three/two net wins, below the registered
  four-win screen gate. Preserve the authored setting while tracing execution failures.
- The initial duel evidence caps the opponent's planning at three previews. The live
  opponent can use its longer queued bag. The local harness now preserves that full
  opponent knowledge while the player retains three previews; 84 focused harness
  tests pass. The new all-eight-tier pilot below completes without errors or censors.
  Earlier pairs cannot be relabeled as exact shipped-opponent evidence.
- Orb 4's tested gravity variants miss their registered median/p90 pacing gates.
  Preserve seven credited frags, tiers and attribution. A global duel decision needs
  all eight tiers under the shipped opponent, including garbage/attack measurements.
- Empty-board construction validates depth three for the specialist, and less
  consistently for cascade. Depth five/eight/ten is not validated. Prepared triggers,
  incidental observed maxima and construction from a legal starting board are
  different evidence. Orb 55 requires depth six for two stars, and depth ten plus
  combo 18 for three; orb 59 requires combo 10/12 as well as explicit depth seven.
  The current engine reports cascade-wave ordinal into `maxCombo`, so all these
  requirements belong in the capability assessment.
- Every initial policy earned one star on every sample of ordinary orbs
  10/14/18/30/36/40/49/52. This is a strategy-validation cue, not proof that targets
  are unfair. In particular, orb 49's 36k score goal and twelve-Quad three-star target
  require examination together: eleven standalone Quads already exceed 36k at its
  initial scoring level, so multiple Quads in the terminal resolution may be needed.
  No impossibility claim follows without examining that legal construction.

## Evidence limits

The initial 531 attempts contain 490 wins, 41 gameplay losses, no primary censors and
no runtime errors. Their three-seed groups are descriptive. Native timings differ by
policy, so differences between policies combine strategy and execution speed. Later
steady-cadence comparisons hold execution timing fixed. The specialist's initial
177/177 completions demonstrate examples, not universal fairness or player ability.

The later pass contains 965 attempts: 440 focused screen, 105 cadence checks, twenty
Quad checks and 400 fresh-seed confirmation. There are no primary censors or runtime
errors. Two specialist orb-55 screen laps hit the compute limit after winning; their
later quality is censored. Confirmation contains no capped observations. The initial
campaign's fifteen capped quality laps used its separate 60-second observation policy.
Neither quality censoring nor a compute-budget cutoff is a gameplay defeat.

The benchmark uses deterministic finite-speed commands and three player previews;
planning compute does not consume virtual gameplay time. It does not measure input
learning, fatigue, readability, enjoyment or human skill distributions. Its timed
showcase acquisition cutoff does not impose a live post-win deadline: live showcase
play continues until manual finish or top-out.

Orb 1's twenty later Quad attempts all complete; twelve earn no-singles/three-star
wins. Preserve that authored bonus. The five-seed cadence study instead shows that
execution matters at 51/59: specialist deliberate cadence wins neither orb under any
tested variant. These small cells do not define a target audience or justify making
the campaign easier until every synthetic cadence wins.

## Current-session measurements

Use fresh output directories and record source/application/runtime fingerprints.
Historical runs used Windows/Node 24.14.0; this environment uses Linux/Node 24.19.0.
Do not resume or silently combine them. Freeze each new cohort's orbs, policies,
cadences, seeds, budgets and interpretation before opening outcomes. A descriptive
cohort remains descriptive even if its direction looks favorable.

The current registration was frozen at 2026-10-07 15:25 UTC, before inspecting new
outcomes, in `artifacts/odyssey-journey-audit-2026-10-07/registration.json`, based on
main `ca3884e70a868f1ff346ec0ca851476fb53481ef`. All cohorts use 1,800 simulated seconds,
3,000 pieces and a 240,000 ms wall budget per attempt. These are diagnostic cohorts;
no statistical balance-adoption experiment is planned. Seeds 8001–8100 are reserved
for a separately registered fresh confirmation if one becomes appropriate.

All 344 registered attempts are now complete, with no primary/quality censors or
runtime errors. Independent review checked the completed cohorts, fingerprints and
reproducible analysis. The after-change measurements use unchanged local revision
`23a7abb`; this does not turn the descriptive chapter/duel cohorts into tuning trials.

| Cohort or check | Scope and status | Result |
| --- | --- | --- |
| Orb-6 transition regression | Actual 15-line transition, primary finish and unchanged neighboring configurations. | Local implementation verified; 39 focused tests pass. |
| Orb-6 paired measurement | 120 attempts per condition: stacker/cascade/quad × steady/deliberate × twenty matched seeds 7001–7020. Old main versus proportional progression. | Complete: 109→110 primary wins; no lost baseline wins, censors or runtime errors. |
| Chapter-6 rhythm | Eighty cascade/steady attempts: orbs 43/45/46/47 × seeds 7101–7120. Test/release/boss/release diagnosis, without tuning selection. | Complete: 71 wins, nine top-outs, no censors or runtime errors. No retuning selected. |
| Shipped-opponent fidelity | Twenty-four cascade/steady attempts: all eight duel orbs × seeds 7201–7203. Full opponent queue, three player previews, unchanged tiers and seven credited frags. | Complete: 19 wins and five bot defeats, no censors or runtime errors. No retuning selected. |
| Final validation | 39 correction tests and 84 harness tests pass; completed cohort analysis independently checked. | Full suite: 8,191 tests across 640 files pass with `--maxWorkers=4`; typecheck, scoped lint, lint/TypeScript ratchets, architecture fitness, theme lifecycle and import boundaries pass. No timeouts or budgets were relaxed. |

The registered orb-6 acceptance requires both physics paths to retain 800 ms through
fourteen lines and reach 635.761589 ms at line fifteen, scoring level five and the
unchanged twenty-line goal. The scope check must establish that only orb 6's actual
authored gravity changes across all 59 configurations. Require no lost baseline
primary wins in the matched diagnostic cohort; any censor/error prevents a clear
preservation assessment. Report stars, duration, rejected inputs and automatic locks
even when primary completion is preserved. There is no required win-rate gain and no
claim of population non-inferiority. Investigate any preservation failure before
retaining the correction.

### Orb-6 diagnostic result

The before cohort records main `ca3884e70a868f1ff346ec0ca851476fb53481ef`; the after
cohort records local revision `23a7abb3b7aa78b1995ec59686dadf4b3b2b8b49`. Their configs
also preserve separate application/benchmark hashes and the same Linux/Node 24.19.0
runtime. `artifacts/odyssey-journey-audit-2026-10-07/analyze.py` reproduces
`analysis.json` from the raw measurements. These are matched diagnostic observations,
not a statistically confirmed balance adjustment or human difficulty estimate.

| Policy | Cadence | Before wins / 20 | After wins / 20 | Lost baseline wins |
| --- | --- | --- | --- | --- |
| Stacker | Steady | 20 | 20 | 0 |
| Stacker | Deliberate | 20 | 20 | 0 |
| Cascade | Steady | 20 | 20 | 0 |
| Cascade | Deliberate | 20 | 20 | 0 |
| Quad | Steady | 15 | 16 | 0 |
| Quad | Deliberate | 14 | 14 | 0 |

Both cohorts complete all 120 planned attempts with no primary/quality censors or
runtime errors. The sole gained win is Quad/steady seed 7005. All 109 matched pairs
that win in both conditions retain the same star rating; neither upward nor downward
star changes occur among those pairs. Remaining losses are top-outs: eleven before
and ten after. The correction therefore passes the registered observed preservation
check without claiming that the remaining Quad failures have been solved.

Across each 120-attempt cohort, failed inputs decline from 24 to seven, all rejected
inputs from 56 to eighteen, and automatic locks from seven to zero. These are raw
descriptive counts, not exposure-adjusted error rates: the paths and durations can
change. The median matched-win duration difference is zero in each of the six strata;
individual attempts can still become faster or slower. The mechanical transition and
preserved primary outcomes support this narrow correction; no required win-rate gain,
population non-inferiority or broad journey calibration is inferred.

### Chapter-6 rhythm diagnostic result

All eighty registered cascade/steady attempts complete on local revision `23a7abb`,
with no primary/quality censors or runtime errors. The same `analyze.py` reproduces
these results. Stars and completion times below are conditional on winning; failures
remain visible in their own column. This analysis uses **nearest-rank p90**: sort the
`n` observations and select the value at one-based index `ceil(0.9 × n)`. The standard
benchmark report uses interpolated quantiles; the two p90 values need not coincide.

| Orb and role | Wins / 20 | Top-outs | Successful duration median / p90 | One / two / three-star wins |
| --- | --- | --- | --- | --- |
| 43 · Test | 16 | 4 | 92.50 / 103.22 s | 0 / 0 / 16 |
| 45 · Release | 17 | 3 | 81.37 / 106.20 s | 0 / 0 / 17 |
| 46 · Boss | 20 | 0 | 108.38 / 125.58 s | 6 / 10 / 4 |
| 47 · Release | 18 | 2 | 68.81 / 77.48 s | 0 / 18 / 0 |

Successful recovery attempts have shorter medians than the sampled test/boss beats,
especially at orb 47. They are not universally easier for this policy: release orbs
45 and 47 still produce three and two top-outs, respectively. Nor does the boss's
20/20 completion establish that it is easier than either release. Objectives, board
rules and how well the policy handles them differ between orbs; these are descriptive
samples, not a common difficulty scale or a test of a balance intervention.

The data keeps recovery quality on the playtest agenda, particularly why some players
or strategies top out during an intended breather. It supports neither lowering the
boss nor retuning the releases from these eighty attempts. Examine failure paths and
observe the surrounding sequence with players before selecting a change.

### Production-opponent duel pilot

All twenty-four registered cascade/steady attempts complete on local revision
`23a7abb`, with the opponent's full production queue and exactly three previews for
the player. There are nineteen wins, five bot defeats and no primary/quality censors
or runtime errors. Each tier has only three seeds; the table gives examples of the
authored opponent progression, not a calibrated difficulty curve.

| Tier · opponent | Orb | Wins / 3 | Median successful match duration | One / two / three-star wins |
| --- | --- | --- | --- | --- |
| 1 · Cinder | 4 | 3 | 327.22 s | 0 / 0 / 3 |
| 2 · Coral | 9 | 3 | 304.50 s | 0 / 0 / 3 |
| 3 · Willow | 17 | 3 | 334.47 s | 0 / 0 / 3 |
| 4 · Frost | 26 | 3 | 395.98 s | 0 / 1 / 2 |
| 5 · Zephyr | 33 | 3 | 387.97 s | 0 / 0 / 3 |
| 6 · Nova | 44 | 3 | 510.25 s | 2 / 1 / 0 |
| 7 · Prism | 53 | 1 | 547.47 s (one win) | 1 / 0 / 0 |
| 8 · Neon | 58 | 0 | No wins observed | — |

The successful examples retain long matches: early-tier medians exceed five active
minutes, tier six exceeds eight, and the sole tier-seven win exceeds nine. Fewer
stars at tiers six/seven and losses at tiers seven/eight show challenge for this
policy on these seeds; three samples per tier cannot establish a stable success rate,
human readiness threshold or fairness of the final opponents.

Orb 58's median terminal duration is 282 seconds, entirely from defeats. It is not
evidence of better pacing. Keep completed-match duration separate from defeat duration
when designing the next attack/garbage-aware measurement. The pilot provides shipped
opponent examples but selects no retuning; retain all eight tiers, seven credited
frags and existing attribution. Do not pool these measurements with the historical
restricted-opponent cohorts.

## Player playtest protocol

No human sessions have been run for this review. The following is a proposed formative
protocol, not a population estimate or a validated completion-rate target.

1. Recruit a small first round across three self-reported experience groups: new or
   occasional falling-block players, regular players, and experienced cascade/versus
   players. Aim for three or four people per group and report the actual cohort.
   Record control device, relevant game experience and a short common practice task;
   do not label a person with a benchmark policy name.
2. Start natural progression at orb 1 using a separate playtest save. Split play into
   sessions of about 30–45 minutes, with breaks whenever requested. Resume the same
   route in later sessions through chapter 7, then invite the encore and star replays.
   Record unfinished journeys and reasons for stopping; do not replace them with
   checkpoint successes. A whole-journey claim requires whole-journey observation.
3. Let players attempt the primary goal with existing instructions. Before an unfamiliar
   mechanic, ask them to explain the goal and likely strategy in their own words.
   After an attempt, ask what caused success/failure, what they would change, whether
   the pressure felt fair, and whether they want another try. Record hints and their
   timing so assisted attempts remain distinguishable.
4. Record attempts to first completion, active play time, retry/abandonment reasons,
   goal progress at failure, death cause, input/control trouble, and whether the next
   recovery orb feels like relief. For duels, also record rounds, credited/uncredited
   deaths, visible attack progress and perceived match length. Breaks and session
   endings are unfinished observations, not losses.
5. After natural exposure, use separate checkpoint sessions for the priority sequences:
   5→6→7, 43→44→45→46→47, and 50→51→52→53→54→55. Include both the preceding teaching
   context and a recovery beat. Checkpoints diagnose a mechanic; they do not establish
   the unaided route's accessibility. Keep these results separate from natural play.
6. Ask interested players to replay for stars only after primary completion. Check
   whether they understand the requirements, can plan the required construction, and
   perceive the result as earned. Observe 55/59 beyond the acquisition deadline when
   they continue a live showcase; do not force the benchmark's finish cutoff.
7. If comparing the orb-6 correction with the prior build, identify builds only as A/B,
   counterbalance order and seed assignment, and record prior exposure. Use comparable
   practice and controls. Report observed within-player changes and order effects;
   do not treat repeated attempts as independent players or promise significance from
   this small formative round.

Review results by experience group, orb role and first versus repeat attempt. Report
counts and individual failure explanations alongside timings; a pooled success number
can hide a beginner wall, an expert ceiling or fatigue in a long duel. Retain players'
own explanations when distinguishing difficult-but-motivating attempts from confusing
or tedious ones.

## Decision rules for the next change

A mechanically demonstrated discontinuity can justify a narrow correction with direct
runtime regressions and scope checks. A balance hypothesis needs a registered matched
screen, relevant policy capability and a separate fresh-seed confirmation before
adoption. Choose its outcome, smallest candidate, preservation checks, sample sizes,
censoring handling and multiplicity rules before inspecting candidate results. The
earlier 20-seed/100-seed design is a precedent, not automatically the correct powered
design for every new question.

For primary difficulty, require a credible failure mechanism and inspect neighboring
teach/recovery/boss roles. For pacing, compare completed matches and attacks rather
than counting faster defeats as improvement. For mastery, demonstrate the required
construction under the applicable board, gravity and finish policy before interpreting
star ceilings. Preserve an intentional peak when evidence only shows that weaker
strategies lose there.

Human findings should establish whether a player understood the challenge, had a
learnable response and wanted to continue. Agree on audience-specific acceptance
criteria after the formative round and before a later confirmatory playtest. No human
win-rate threshold is asserted as validated by the current synthetic evidence.
