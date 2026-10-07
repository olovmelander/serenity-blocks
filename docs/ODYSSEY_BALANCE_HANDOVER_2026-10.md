# Odyssey balance handover — 2026-10-07

## Completed state

The automated difficulty audit and its first supported adjustment are complete. No
benchmark run is active. The only shipped gameplay change is Electric Apex (orb 59):
its primary score-acquisition deadline is **210 seconds instead of 180**. All 59
composed level configurations were compared; every other setting is identical.
The 160k score goal, all stars, opponent tiers, seven-frag matches, neighbors, physics,
progression, saves and live manually finished showcase behavior retain their rules.

The offline CLI is `npm run benchmark:odyssey`. It provides four strategies, three
independent input cadences, isolated rule variants, deterministic finite-speed input,
real gameplay/cascade/duel execution, bounded retry fallback, garbage/attack/death
telemetry, full recorded quality windows, checkpoint resume and interactive reports.
It preserves exactly three previews for its player policies. Mechanics, prepared
triggers and legal construction demonstrations are reported separately.

## Evidence and decisions

This pass completes **965 attempts**: 440 focused screen, 105 cadence checks, twenty
Quad checks and 400 fresh-seed confirmation. There are no primary censors or runtime
errors. Two specialist orb-55 screening quality laps reach the compute limit after
winning; their later quality is censored. Confirmation has no capped observations.

| Decision | Result | Action |
| --- | --- | --- |
| Orb 59, 210 s | Fresh cascade wins 9→59/100; specialist 27→88/100; zero lost baseline wins | Adopt deadline only. |
| Orb 59, 240 s | Stronger screen result, but 210 already qualifies | Excluded by the preregistered smallest-qualifying priority. |
| Orb 51, 75/100 ms fall | Screen nets +3/+2 wins, below required +4 | Keep authored gravity. |
| Orb 4, 850/700 ms fall | Median/p90 pacing improvements below 15%/10% | Keep authored gravity and seven frags. |
| Orb 1, Quad/no-singles | Twenty wins, twelve no-singles/three-star wins | Keep authored bonus. |
| Boss controls 46/55 | Primary goals remain demonstrated | Preserve peaks and mastery targets. |

The confirmation uses only fresh seeds 5001–5100, cascade/expert strategies, steady
cadence and baseline/210-second conditions. All fifty primary gains recover goals
after 180 seconds and by 210 seconds. The one-sided exact paired test gives
`p = 2^-50`; Holm adjustment across the fixed three-decision family gives approximately
`2.66e-15`. Unselected decisions retain p=1. Specialist preservation is separate;
four specialist gains include changed pre-deadline planning because the policy's
hurry penalty depends on the configured time remaining. No screen/holdout pooling.

Ten production-baseline attempts reproduce the frozen candidate exactly except
condition/attempt labels and wall compute time. This verifies the shipped override,
not another independent confirmation cohort. A real resume schedules zero attempts.
The new live-mode regression verifies a stable goal at 200 seconds, continued
showcase play at 211 seconds, and exactly one saved manual completion.

Focused validation: **123 tests across eleven files**, passing typecheck and zero
scoped lint errors. Length warnings remain warnings under ADR-0002. The full suite
passes **8,167 tests across 639 files** using `npm test -- --maxWorkers=4`, with no
relaxed timeouts or budgets. The first default-parallel run, alongside lint, hit eight
timeouts/timing thresholds in unchanged visual tests; the controlled run passes all
of them. Lint/TypeScript ratchets, architecture fitness and import boundaries pass.
Consult the PR checks for the final hosted-run status.

## Durable evidence and reproduction

Read [the benchmark record](ODYSSEY_PLAYTEST_BENCHMARK_2026-10.md) for methods, counts,
qualification limits and exact commands. [The evidence archive](benchmarks/2026-10-07/README.md)
preserves inputs, raw measurements, independent registration/analysis and the frozen
source snapshot. Large diagnostic traces and redundant generated outputs are omitted.
Ignored local `artifacts/` directories remain available on this machine but are not
required to retrieve the archived decision evidence after cloning.

Historical screen/confirmation fingerprints:

- HEAD: `d14b1c2364fdc0916e65ab930b164ab4213f0767`.
- Benchmark: `4950a5b552e84c8a0778e589d6d3c80ecb3de4ce5c214b65e3370a8fa7d57631`.
- Application before adoption: `259ef02511db27892ca3812be676b45518b261d5cbc910b8daad4369b930f407`.
- Application after adoption: `c71cd90b4900de20d5dd52b906f06c68c39e28ba13cdf3fb1417c8825d0512ed`.
- Runtime: Node 24.14.0, Windows x64; controlled legacy 60 Hz simulation.

Analyze archived measurements without rerunning gameplay using the archived
`analyze.mjs` and its recorded nomination. To reproduce gameplay, use a separate
checkout of the recorded HEAD, apply the archived application patch first, then
overlay the snapshot's listed files. Use the recorded Node/runtime and original
budgets. Keep the active main checkout intact. Resume deliberately refuses changed
HEAD/source/runtime/rules/budgets; a new campaign or committed revision needs a new
output directory unless the original snapshot is restored.

The old `orb59-deadline210` scenario now equals the live baseline. Do not compare
those as distinct conditions on current main. Historical 180-vs-210 comparisons
require the archived source; new experiments need explicitly different rules.

## What remains uncertain

These are synthetic strategy/execution measurements, not human success probabilities
or enjoyment ratings. No player calibration has been performed.

Empty-board legal construction validates three-stage chains for the specialist, and
less consistently for cascade. Five/eight/ten-stage construction is not validated.
Orb 59's authored combo 10/12 fields are separate from explicit depth 7, but the
current physics reports cascade-wave ordinal into `maxCombo`, making those deeper
quality conditions too. All confirmation wins are one star. Preserve these targets
until relevant strategy capability is demonstrated; zero observed star degradation
does not establish higher-star fairness or statistical non-inferiority.

Live showcase play continues after primary completion until manual finish or top-out.
The benchmark's acquisition-deadline cutoff is an observation policy. Its quality
measurements cannot be described as a live post-win time limit.

The frozen duel screen caps the opponent's planning knowledge at three previews.
The shipped opponent can read its longer queued bag through preparation heuristics,
even with tier-1 lookahead disabled. Solo evidence is unaffected. Any future duel
adoption needs exact shipped-opponent knowledge, and a global change needs all eight
tiers checked. The archived fidelity driver is prepared tooling; only its short
instrumentation smoke was run, not a completed pacing comparison.

## Recommended next session

1. Improve legal deep-chain construction policies and demonstrations, including
   authored starting-board contexts for 55/59. Separate prepared setups from actual
   construction, and include the combo 10/12 requirements when judging star capability.
2. Revisit duel pacing through attack production and garbage-aware strategy. Preserve
   seven credited frags, round attribution and bot names/tiers. Run the production
   opponent with its full queue before adopting any duel change.
3. Inspect orb 51's rejected-input/automatic-lock/top-out traces before proposing a
   different gravity intervention. The rejected screen does not support lowering its
   score level, deadline or quality targets.
4. Register a new focused experiment before opening its results: matched twenty-seed
   screen, smallest qualifying variant, then a fresh hundred-seed confirmation with
   fixed primary strata, censoring rules, preservation checks and multiplicity correction.
5. Check neighboring entry/release/challenge/boss orbs if the next adopted change has
   wider scope. Preserve the authored chapter rhythm and update this handover with
   each confirmed adjustment.

Start current-main tooling with a new output directory:

```powershell
npm ci
npm run benchmark:odyssey -- --profiles cascade,expert,quad --capabilities-only --output artifacts/odyssey-next-capabilities
npm run benchmark:odyssey -- --levels 55,59 --profiles cascade,expert --cadences steady --samples 20 --seed-start 6001 --workers 6 --wall-ms 240000 --output artifacts/odyssey-next-current-baseline
```

The latter is a new descriptive baseline, not a preselected tuning experiment. Plan
the next variant and reserve untouched confirmation seeds before making a decision.
