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
  different evidence. The effective three-star chain requirements are eighteen
  waves at orb 55 and twelve at orb 59: the current engine reports the same
  cascade-wave ordinal into `maxCombo` and `maxCascadeDepth`. The new communication
  and capability work below makes these requirements explicit without lowering them.
- Every initial policy earned one star on every sample of ordinary orbs
  10/14/18/30/36/40/49/52. This is a strategy-validation cue, not proof that targets
  are unfair. In particular, orb 49's 36k score goal and twelve-Quad three-star target
  require examination together. The necessary bounds below show that at least three
  of those Quads must occur within its finishing chain of eight or more waves.
  No impossibility claim follows without examining legal construction.

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

## Mastery communication and capability follow-up

This follow-up is separate from the 344 completed diagnostic attempts above. The
communication change is committed as `99215f7`; capability tooling and experimental
policies are committed as `b89bbec`. The initial registered screen uses that source
and precedes the cell-loss correction described below. Its observations must not
be presented as measurements of the corrected game. Development observations and
fresh post-fix evidence remain separate.

### Requirements players actually face

Production physics sends the same cascade-wave ordinal to the combo and chain-depth
metrics. A chain includes the first clear and every subsequent clear wave caused by
that one locked piece. The score multiplier for clearing on consecutive pieces is
a separate mechanic. Thus the strongest of `combo` and `maxCascadeDepth` is the
effective chain requirement, not two independently achievable skills.

| Orb | Authored three-star chain fields | Effective requirement shown to players |
| --- | --- | --- |
| 49 | `combo: 8` | One chain of at least eight waves, alongside twelve Quads. |
| 55 | `maxCascadeDepth: 10`, `combo: 18` | One chain of at least eighteen waves. |
| 59 | `maxCascadeDepth: 7`, `combo: 12` | One chain of at least twelve waves. |

The HUD now shows one effective chain requirement per star tier and consistent
wave-based bonus labels. Its existing folded Level guide explains the separate
score multiplier, normal automatic completion after the full final cascade, and
showcase continuation until manual finish or top-out. Timed showcase wording makes
the deadline a requirement for acquiring the primary goal, not a post-win limit.
The map's primary chain formatter uses the same wording. Authored targets, evaluator
conditions, finish rules and saves are unchanged.

The communication change passes 55 focused tests, typecheck, scoped lint with zero
errors, import boundaries and architecture fitness. Chromium DOM-fixture captures
inspect the actual HUD for 49/55/59 at desktop and phone sizes, with no console errors
or horizontal overflow. Expanded guides scroll within the existing HUD. These are
component presentation checks, not timed gameplay or full-scene validation; the
captures and fixture are under `artifacts/odyssey-mastery-ui/`.

The score/occupancy audit establishes necessary constraints, not impossibility:

- Orb 49's eight-wave chain scores at least **51,000** even if every wave clears
  one line at starting score level seven, with no extra multiplier or bonus. It must
  therefore be the finishing cascade against the 36,000-point goal. Ten prior Quads
  already score at least 36,000 after normal level progression, so at most nine can
  precede that cascade. A chain with depth `D` and `q` Quad waves consumes at least
  `10 × (D + 3q)` cells. Even the generous 240-cell board cap allows at most five
  Quad waves when `D >= 8`. Three stars consequently require **7–9 earlier Quads
  and at least three Quads in the finishing chain**, which clears at least seventeen
  lines. An abstract score schedule of nine isolated Quads followed by waves
  `[4,4,4,1,1,1,1,1]` fits these bounds; no reachable board or legal bag sequence is
  established by that arithmetic.
- Orb 55's eighteen-wave chain alone scores at least **795,300** at fixed score
  level twelve, exceeding its three-star score target. Its explicit depth-ten
  condition is weaker than its combo-eighteen condition. Orb 59's twelve-wave chain
  scores at least **218,820** at starting score level eleven, and its explicit
  depth-seven condition is weaker. Their boards have enough cells to avoid a simple
  occupancy contradiction, and their showcase laps permit continued play. Legal
  construction under live timing remains the relevant unresolved question.

These lower bounds use the actual scoring function with one-line waves, no perfect
clear bonus, neutral consecutive-clear multiplier and the minimum score level.
Ordinary orbs 36 and 40 have the same finishing-chain interaction: their required
eight/ten-wave chains alone exceed their respective 28,000/70,000-point goals.
The correct response is to investigate construction and teach the real requirement,
not to infer unfairness from an unsuccessful benchmark policy.

### Pre-fix screen and shared cell-loss defect

The initial screen froze source `b89bbec18a7f73eacab83cd9f2f05d417e551c9a`
at **2026-10-07 15:59:13 UTC**, after 172 focused tests across nine files passed.
It registered eighty duel attempts: `cascade` versus `duelist` on orbs 4/9/53/58,
ten paired seeds per orb (10001–10010), steady cadence and the real production
opponent queue. A separate fifty-record untimed construction cohort uses `expert`
and `chain`, seeds 10001–10005 and 128 pieces: thirty exact authored starts on
49/55/59 plus twenty empty-board demonstrations across the two physics modes.
The registration, frozen source and original observations remain immutable under
`artifacts/odyssey-mastery-followup-2026-10-07/`.

All eighty pre-fix duels completed: **41 wins, 39 losses to the bot, no runtime
errors and no primary/quality censoring**. The paired early-orb comparison gives:

| Orb | `cascade` wins | `duelist` wins | Successful median seconds, `cascade` → `duelist` | Successful p90 seconds, `cascade` → `duelist` |
| --- | --- | --- | --- | --- |
| 4 | 10/10 | 10/10 | 348.51 → 357.14 | 387.02 → 406.37 |
| 9 | 10/10 | 10/10 | 336.73 → 370.18 | 403.58 → 417.58 |
| 53 | 1/10 | 0/10 | No both-win pairs | No both-win pairs |
| 58 | 0/10 | 0/10 | No both-win pairs | No both-win pairs |

For orbs 4 and 9, both policies win all ten paired seeds, but `duelist` is slower
on the registered median and nearest-rank p90 measures. Median paired attack rows
per player piece also decrease (−0.00568 and −0.01881 respectively). Neither orb
passes its registered confirmation-nomination gate. Orb 9 / seed 10010 additionally
drops from three stars to two; orb 53 loses the sole baseline win. The late-orb
rows are descriptive capability checks, not a pacing comparison among successes.
**Keep `duelist` experimental; do not adopt it as the default or retune production
opponents from this screen.** No tier, opponent or seven-frag rule changes follow.

All fifty pre-fix construction records are present. **Forty-six qualify under the
recorded trace validity checks: 26 authored starts and twenty empty-board attempts.**
Qualification here means valid untimed execution, not mastery-target attainment
or independent replay of every record. The four remaining authored traces expose
the defect below and remain in the registered denominator.

Four authored construction records fail cell conservation: orb 49 / expert / 10004,
orb 49 / expert / 10005, orb 49 / chain / 10003 and orb 55 / chain / 10002. Recorded
actions reproduce the failures in both legacy and resolved physics. The shared
`removeClearedLines` helper removes rows from each surviving piece shape without
preserving the remaining cells' row positions. A lower fragment therefore moves
upward before gravity, can overlap another fragment, and loses a cell when the
board rebuild overwrites that position. Both physics paths use this helper, so
agreement between the paths alone does not establish correctness.

For example, the orb-49 / expert / 10004 trace has 98 distinct cells before piece
82's first clear. Clearing row 15 leaves 88 piece cells but only 87 unique board
positions: fragments overlap at `(3, 16)`. This is a production physics defect,
not evidence that an authored mastery condition is impossible. Keep all four
invalid records in the registered accounting and exclude them from legal
construction evidence. Other pre-fix observations describe the old engine; they
cannot establish behavior or difficulty after a shared physics correction.

One independently replayed pre-fix example, orb 59 / chain / seed 10005, reaches
**eleven waves at piece 80** in both physics paths from the authored start. Its
full 128-piece, 544-action replay has no overlaps or cell loss. It is a valid untimed
construction example, not another independent sample or a timed star result.
Its six cascades do not meet even the two-star twenty-cascade target; it also
misses the three-star twelve-wave target. No full higher-star qualification follows
from the eleven-wave chain. This eleven-wave result belongs to the pre-fix engine
only and must not be carried forward as a corrected-engine capability claim.

Correction regressions demonstrate changed cascade behavior. In the orb-49 /
expert / 10004 failing state, the pre-fix helper produces five lines in five waves;
the corrected helper produces three lines in two waves and preserves all 68
remaining cells. An empty-board chain development case on seed 9101 changes from
six waves to four. Its regression expectation must explicitly retain that historical
six/current four distinction; no policy weight or authored target was tuned to
recover the old result.

Commit `50789988ae038f5f32214869d5d4941f06235686` corrects the shared helper by
preserving each surviving cell's row position until normal gravity moves the
fragment. The four recorded failure fixtures and direct conservation regressions
cover both physics paths. Preserve the complete pre-fix screen as diagnostic
evidence; do not resume its outputs against changed source or pool it with the fresh
cohort. There is currently no simulation-version gate for older affected demos or
checkpoints: they may load but replay differently after the correction. Patched and
unpatched network peers are not guaranteed to remain simulation-compatible. This
focused correction does not include a demo-format or network-protocol version bump.

The original source-freeze script sorted Python path components, whereas the CLI
sorts complete relative-path strings. This caused an aggregate application-hash
mismatch despite unchanged source bytes. The discrepancy was identified before
outcome analysis; independent verification reproduced both hashes from the same
pre-execution source ZIP. The archived registration and analyzer remain unchanged;
`provenance-correction.json` and `analyze-verified.py` record the correction and
apply only the verified hash in memory. This clerical correction changes no code,
policy, metric, seed or observation. The CLI-compatible pre-fix fingerprints are:

- Application: `d7b17304ea8fc3d395b1a0d47b5dc3d7846ace6f8c1087196b8b1b8f41cc8cb8`.
- Benchmark: `c344f45980a57811339d9f3f370a5505385143fa185745a9130f9968607783f5`.
- Runtime: Node `v24.19.0`, Linux x64.

### Corrected-engine validation and fresh cohort

At fix commit `5078998`, **8,288 tests across 644 files pass** with
`npm test -- --maxWorkers=4` (105.63 seconds). The corrected-physics subset passes
57 tests across seven files, including the four recorded failures. Typecheck,
TypeScript ratchet, scoped correction lint, architecture fitness and import
boundaries pass. The repository lint ratchet passes with 813 existing errors at
its 813 baseline, 1,057 warnings and zero fatal errors; this is not a claim of a
repository-wide warning-free lint run.

A separate post-fix registration froze at **2026-10-07 16:18:06 UTC**, before
corrected-engine outcomes were inspected. It uses commit `5078998`, application
fingerprint `3d1e7e953bb3a42a8bf20418780d7099e5dd849982282fb9270141038273373f`,
the unchanged benchmark fingerprint `c344f45980a57811339d9f3f370a5505385143fa185745a9130f9968607783f5`
and Node `v24.19.0` on Linux x64. Source hashes were independently cross-checked
using the CLI's full-string ordering before execution. Registration, source overlay,
commands and the frozen analyzer are under the follow-up artifact directory's
`postfix/` subdirectory.

| Fresh post-fix cohort | Registered coverage | Interpretation |
| --- | --- | --- |
| Untimed construction | Fifty attempts: 49/55/59 plus standard/infinity empty boards; `expert`/`chain`, seeds 10101–10105, 128 pieces. | Check trace validity and actual authored requirements; preserve all invalid or unfinished attempts. |
| Timed duels | Forty attempts: 4/9/53/58, `cascade`/`duelist`, five matched seeds 10101–10105 per orb, steady cadence, production opponent queue. | Descriptive paired coverage only; the earlier ten-pair nomination gates do not carry forward. |
| Timed solo | Eighteen attempts: 49/55/59, `cascade`/`expert`, three seeds 10101–10103 per orb/profile, steady cadence. | Primary-goal sanity under real gravity and finite-speed commands; post-goal quality is observed for at most thirty seconds. |

Both timed cohorts retain the registered 1,800-second, 3,000-piece and 240,000 ms
wall budgets with three workers. Solo execution follows duel completion to avoid
overlapping timed worker groups. A showcase's acquisition-deadline observation
cutoff or resource budget can shorten its thirty-second quality window. Report
that partial quality separately; it does not censor a primary win already acquired
and does not impose a new live showcase limit.

The **108 fresh observations** exclude the eight regression fixture/path replays
and separate instrumentation preflights. Their seeds differ from the pre-fix screen,
so the two campaigns are unpaired and cannot estimate a before/after improvement.
No production retuning, statistical efficacy or human-fairness claim is registered.
Seeds starting at 11001 remain reserved for a later independently registered
confirmation. All registered post-fix observations are complete. The
[mastery evidence archive](benchmarks/2026-10-07-mastery/README.md) is independently
verified: all 128 members match their recorded SHA-256 values, and a fresh
extraction reproduces the original pre-fix, corrected-provenance pre-fix and
post-fix analysis JSON files byte for byte using only archived inputs. The evidence
ZIP is 13,603,965 bytes with SHA-256
`d8127c21581c94478db4e643ad430daca1e19b7a53ba0f4980afb9cf7bea34d3`.

### Corrected-engine results

All **50/50 construction traces** pass the recorded validity checks: thirty exact
authored starts and twenty empty-board attempts, with no conservation failures,
injected cells, invalid command paths or runtime errors. Thirteen `chain` attempts
end in real top-outs; these are valid failed constructions, not invalid traces.
The maximum depth within each five-seed group is:

| Start | `expert` maximum | `chain` maximum | Effective authored three-star chain target |
| --- | --- | --- | --- |
| Orb 49 | 4 | 6 | 8 |
| Orb 55 | 5 | 7 | 18 |
| Orb 59 | 4 | 5 | 12 |
| Empty standard board | 4 | 6 | No authored star tier |
| Empty infinity board | 5 | 6 | No authored star tier |

No authored attempt reaches its effective chain target or all mastery conditions.
The valid depths are bounded capability observations. They do not prove an
unreached target impossible, and they do not transfer the old eleven-wave result
to corrected physics. A targeted solver for the exact joint requirements is the
next useful construction experiment; any candidate witness needs production-physics
replay and subsequent finite-speed validation.

All **forty timed duels** resolve: twenty wins, twenty losses to the bot, no runtime
errors and no primary/quality censors. Both profiles win all five seeds at orbs 4
and 9, all with three stars, and lose all five at orbs 53 and 58. Successful paired
timing uses the same five seeds for both profiles:

| Orb | Median seconds, `cascade` → `duelist` | Nearest-rank p90 seconds, `cascade` → `duelist` | Median paired attack rows/piece difference |
| --- | --- | --- | --- |
| 4 | 314.45 → 344.82 | 333.87 → 459.73 | −0.01371 |
| 9 | 314.98 → 354.32 | 399.32 → 384.67 | −0.01271 |

`duelist` has worse median pacing and attack yield in both early orbs. The p90
improves at orb 9, but this descriptive five-pair cohort has no nomination gate
and selects no adoption. Keep the profile experimental. The losses at 53/58
provide no successful-match pacing estimate and no human-difficulty calibration.

All **eighteen timed solo attempts** resolve: seventeen primary wins and one real
top-out, with no runtime errors or primary censors. Both profiles win 3/3 on 49
and 55; on 59, `cascade` wins 2/3 and `expert` wins 3/3. The loss is orb 59 /
`cascade` / seed 10103, a top-out at 169.85 seconds. Every observed win has one star.

The seventeen primary wins include all six orb-55 wins whose quality windows end
at the explicit thirty-second cap. The five orb-59 wins end at the benchmark's
acquisition-deadline observation cutoff. Their raw `qualityCensored` flag is false,
but this means completion under that observation policy, **not complete live
showcase quality**. Live play can continue until manual finish or top-out. Neither
the capped orb-55 quality nor the deadline-ended orb-59 quality validates full
higher-star fairness. Orb 49's six ordinary wins include their complete final
cascade and then automatically finish.

All three generated post-fix reports pass browser checks with no console errors.
These and the mastery-HUD captures verify presentation only. The completed campaign
supports the conservation correction and describes current policy capability;
enjoyable difficulty, learning and full optional mastery still need the targeted
construction work and formative player protocol below.

### Experimental capability tooling and reproduction

The follow-up adds explicit experimental profiles alongside the four established
policies. `chain` prioritizes increasing cascade depth with three previews; `duelist`
uses the cascade policy's search and timing while rewarding outgoing attacks in
duels. These change benchmark players, not production opponents, authored tiers or
gameplay rules. Experimental profiles require explicit selection; omitting
`--profiles` retains the four established policies, while `--profiles all` opts in
to the experimental profiles too.

`--construction-levels`, `--construction-seeds` and `--construction-pieces` select
construction attempts from exact authored solo starts. They preserve
the opening board, piece bag, score rules and ordinary/showcase finish policy;
recorded commands, connectivity hashes and cell conservation distinguish valid
construction from an injected prepared trigger. Only traces passing those validity
checks can serve as legal construction witnesses. A normal orb stops after its
primary goal and the entire final cascade. A showcase can continue to investigate
its mastery setup.

These demonstrations are **untimed**: automatic gravity and the gameplay clock do
not advance, presentation waits are skipped, and zero held time awards the maximum
50-point lock bonus. Consequently they cannot validate timed stars, deadline
fairness, execution speed or enjoyment. Time-only bonuses do not qualify an untimed
bonus total. Missing a target is reported as inconclusive, not impossible; a legal
trace meeting untimed conditions still requires a timed follow-up.

All explored chain-policy variants used development seeds **9101–9103**. Preserve
the inspected variants and their observations as development evidence, including
unsuccessful alternatives; those seeds cannot become a fresh confirmation. The
commands below replay development context after the new tooling is available. They
are not a fresh campaign registration and select no tuning change.
Use a new output directory whenever revision, fingerprints or runtime change.

```sh
npm run benchmark:odyssey -- --capabilities-only --profiles expert,chain --construction-levels 49,55,59 --construction-seeds 9101,9102,9103 --construction-pieces 128 --output artifacts/odyssey-mastery-development-replay
npm run benchmark:odyssey -- --levels 4,58 --profiles cascade,duelist --cadences steady --samples 3 --seed-start 9101 --workers 4 --max-seconds 1800 --max-pieces 3000 --wall-ms 240000 --output artifacts/odyssey-duelist-development-replay
```

| Follow-up record | Completed result |
| --- | --- |
| Pre-fix source and registration | Frozen at `b89bbec`; source-order hash correction verified and disclosed above. |
| Pre-fix construction screen | Complete: 46/50 traces pass recorded validity checks; four invalid authored traces retained and excluded. Eleven-wave orb-59 replay applies only to pre-fix physics. |
| Pre-fix attack-policy duel comparison | Complete: 41 wins / 39 losses, no runtime errors or censors. Neither early orb nominates `duelist`; keep it experimental. |
| Shared cell-loss correction | Commit `5078998`; four failure fixtures and full 8,288-test suite pass. |
| Post-fix source, registration and cohorts | Frozen at 16:18:06 UTC; all 108 observations complete: 50 valid constructions, 20/40 duel wins and 17/18 primary solo wins. Keep bounded quality separate and do not pool with pre-fix source. |
| Final archive | [Complete and independently verified](benchmarks/2026-10-07-mastery/README.md): 128 member hashes match; all three analyses reproduce byte for byte from archived inputs. |

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
