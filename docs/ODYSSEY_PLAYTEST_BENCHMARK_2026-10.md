# Odyssey automated playtesting — 2026-10-07

Status: evidence for the user-requested difficulty audit. The architectural remediation
plan remains the umbrella roadmap. Fresh-seed confirmation supports one shipped change:
Orb 59's primary acquisition deadline increases from 180 to 210 seconds. Its score and
star requirements remain authored; the offline harness does not replace the live
simulation driver, renderer or campaign saves.

The later [journey-difficulty continuation](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md)
adds 344 separate diagnostic attempts, corrects orb 6's abrupt gravity handoff and
updates the benchmark to use the production opponent's full queued bag. The methods
and counts below describe the original frozen balance pass; its restricted-opponent
duel measurements must not be pooled with the newer production-opponent pilot.

Original balance pass: **965 completed attempts** (565 screening and 400 fresh-seed confirmation),
with no primary censors or runtime errors. Orb 59's 210-second deadline passes the
registered confirmation gates. Gravity and duel-speed variants fail screening and
are not adopted. Higher-star balance remains unqualified where the required chain
construction has not been demonstrated; two boss screening quality laps are capped.

## What the instrument measures

`npm run benchmark:odyssey` runs offline attempts through the shipped Odyssey gameplay
loop, `GameplayHybridEngine`, real game actions and legacy cascade physics. Bot orbs use
the actual `OdysseyBotMatch`, garbage rules, death barrier and round reset. Input reaction
and action intervals, gravity, normal-motion hit-stop, cascade presentation delays and
round breaks consume controlled virtual time at 60 Hz. Campaign attempts never enable
`isSeeking` or execute a whole plan instantly.

The wall clock is a compute budget, not gameplay time. Attempt budgets produce censored
observations; they cannot be counted as top-outs or deadline failures. Each child process
has its own virtual clock, restored after every attempt; drained game states release
their final pooled pieces before the next job. This is offline tooling, not
live simulation Worker offload (ADR-0006), and does not activate the experimental fixed
clock (ADR-0012).

All policies share the same session seed on a given orb and see exactly three previews.
Decision randomness is separate from piece generation. The actual bags remain intact.
Reachability search provides legal input paths; executing them at finite speed can still
be affected by gravity, as in the game. Planning cost does not consume virtual gameplay
time, so synthetic input speeds are not human difficulty ratings.

| Policy | Reaction | Action interval | Future-piece search | Purpose |
| --- | --- | --- | --- | --- |
| `stacker` | 180–300 ms | 150 ms | None | Low stack and immediate clears, with occasional imperfect choices. |
| `cascade` | 90–150 ms | 90 ms | One piece | Legal cascade outcomes and supported machine preparation. |
| `expert` | 35–65 ms | 65 ms | Two pieces | Primary objective and authored quality conditions. |
| `quad` | 120–180 ms | 100 ms | Two pieces | Open-well construction, Quads and no-singles conditions. |

These are the `native` timings. Input cadence can now be selected independently of
strategy: `steady` uses 120–180 ms reaction and 100 ms actions; `deliberate` uses
250–350 ms reaction and 180 ms actions. These are synthetic execution constraints,
not estimates of human ability.

Benchmark policies use canonical `resolveCascade` outcomes and connectivity-aware
search keys, avoiding arbitrary-cell latent triggers and the production heuristic's
aggregate level-one score estimate. Their forecast excludes the time-dependent lock
bonus; the actual attempt always receives the real score. The authored enemy retains
its shipped tier, planner and timing, but the frozen harness also caps its planning
view at three previews.

A follow-up code audit found that the shipped opponent's preparation heuristic can
read its longer queued bag even at tier 1 with lookahead disabled. The frozen duel
screen therefore measures a restricted-opponent condition rather than exact shipped
opponent behavior. Within-condition pairs remain useful; pacing adoption requires an
additional comparison with the production opponent's full bag and the test player
still limited to three previews. Solo orb measurements are unaffected by this limit.

The initial campaign used a static input path and did not expose incoming garbage to
the synthetic player. The follow-up player replans from the current piece pose after
a rejected movement and can read the visible pending-garbage count. A soft-drop stop
or lock is recorded separately from a failed movement. The actual enemy retains its
shipped planner and difficulty settings.

## Validation before calibration

Six reachable fixtures compare canonical resolution with real legacy physics: Standard
and Infinity two-wave chains, combo-multiplier scoring, a playable Infinity roof clear,
and connected/separate payloads with equal occupancy but different outcomes. Campaign
execution requires these mechanics checks to pass.

Both cascade policies execute a direct trigger and an O-placement followed by an I
trigger in Standard and Infinity. The stacker executes the immediate trigger but does
not demonstrate preserving the setup. These fixtures establish prepared depth-two
strategy only.

The follow-up adds bounded legal construction from empty Standard and Infinity boards:
three seeds per mode, forty actual tetromino placements per demonstration, three
visible previews, no inserted cells or attacks. It records targets of three, five,
eight and ten stages separately, and replays any constructed deep trigger as prepared
evidence without counting that replay as another construction demonstration. The
specialist constructed three stages in all six checks; cascade did so in two of six.
The Quad policy constructed one to three Quads with zero singles in all six checks.
No policy validated construction at five, eight or ten stages. The report keeps these
limits separate from measured wins, observed maxima and prepared triggers. Construction
checks bypass competing gravity and presentation delays; timed attempts remain the
source of actual gameplay outcomes.

Runtime regressions cover deterministic commands, actual cascade/deadline boundaries,
piece-limit completion, optional victory laps, fenced physics drain, duel round breaks
and restoration after errors. Report regressions cover censoring, confidence intervals,
matched-seed comparisons and scoped capability failures. A real CLI smoke verifies that
resuming a completed checkpoint does not duplicate an attempt.

## Reporting and interpretation

Every attempt is appended to `raw.jsonl` as it finishes. `config.json` records budgets,
selected seeds/profiles/orbs/scenarios/cadences, effective experiment rules, the game
revision and a hash of the benchmark implementation.
Resume refuses different budgets, benchmark or application source, Node runtime or
effective rules. Outputs also include `capabilities.json`,
`summary.json`, `report.md` and a standalone interactive `report.html` with policy,
scenario, cadence, chapter and objective filters, campaign curves and per-orb measurements.

The terminal win rate is conditional on recorded wins/losses. Always read it alongside
completion coverage and the overall win bounds that include unfinished/error attempts.
Wilson 95% intervals describe these sampled synthetic policies. The initial few-seed
campaign is descriptive: automatic curve screening requires at least twenty terminal
samples in each comparable group, at least 80% completion coverage, matched seeds and
non-overlapping intervals. A screened candidate still requires review; no level is
automatically retuned.

Use intervals only for a single orb/policy/scenario/cadence group. The frozen initial report's JSON also
contains pooled aggregate intervals; those are not inferential estimates because orbs
differ and profiles reuse matched seeds. Do not interpret them as campaign confidence
or human success probabilities. The HTML presents pooled counts and coverage, and plots
only the per-orb/policy intervals. This limitation is recorded in the UI evidence too.
New reports return null for pooled confidence intervals. Matched scenario comparisons
hold the orb, strategy, cadence and seed fixed, and keep unfinished quality observations
outside complete star comparisons.

Normal orbs end on their settled primary goal. The benchmark continues showcase orbs
until three stars or the authored acquisition deadline; untimed showcases continue
within the recorded resource budgets. This is an explicit observation cutoff: live
showcases continue after primary completion until the player finishes or tops out.
Extending an acquisition deadline does not change that live post-win finish policy.
`--lap-seconds 60` explicitly restores the initial campaign's shorter lap.
Primary completion remains a win while a resource or explicit lap limit flags unfinished
quality evidence as `lapCensored`. Reported stars follow the engine's actual evaluation.

## Initial runs

The 24-attempt pilot uses orbs 1, 2, 4, 16, 52, 55, 58 and 59, three policies and seed
1001: 17 wins, four gameplay losses, three wall-budget censored attempts and no runtime
errors. Late duel/Infinity expert attempts hit the thirty-second compute budget. The
campaign run therefore uses a larger budget rather than treating those as difficulty
failures.

Pilot artifacts: `artifacts/odyssey-benchmark-pilot-2026-10-07/`.
CLI resume smoke: `artifacts/odyssey-benchmark-resume-check-2026-10-07/`.

The campaign completed all **531 unique attempts**: 59 orbs, three policies, and seeds
1001–1003. Results: **490 wins, 41 gameplay losses, zero censored attempts and zero
runtime errors**, with 100% terminal coverage. Losses comprise eighteen bot defeats,
twelve deadlines and eleven top-outs.

| Policy | Wins / 177 | One / two / three-star wins | Median successful solo primary time | Maximum observed chain |
| --- | --- | --- | --- | --- |
| Stacker | 152 | 59 / 41 / 52 | 96.9 s | 5 |
| Cascade | 161 | 37 / 42 / 82 | 57.3 s | 7 |
| Objective specialist | 177 | 42 / 38 / 97 | 35.0 s | 9 |

These are observed cohort counts, not human skill ratings or stable population rates.
The specialist demonstrated every primary goal on all three seeds. That establishes
reproducible completion examples without proving every seed is fair or measuring how
the journey feels.

### Concrete review priorities

1. **Duel pacing.** Orb 4's first-to-seven matches take 10.3–13.2 active minutes for the
   stacker and 3.5–4.1 minutes for the specialist. The longest match, orb 33, takes 23.7
   minutes and ends 6–7 after thirteen credited rounds. Weak attack production is a
   plausible contributor; individual attack throughput was not instrumented. Preserve
   the requested seven-frag target while investigating round pace with a larger batch.
2. **Late deadline gates.** Every deadline loss occurs on orbs 46, 55 or 59. The stacker
   reaches 84–93%, 81–93% and 41–46% of their respective score targets. Cascade misses
   orb 59 at 77–98%; the specialist completes it with 51.5–60.8 seconds remaining.
   These separate the policies but do not establish a tuning defect. Orb 51 instead
   produces three top-outs across the slower policies, which needs execution-path and
   gravity review rather than simply extending its timer.
3. **Quality strategy validation.** The specialist's eighty wins below three stars
   mostly miss Quads, deep chains, combos or bonus counts. Only two attempts observe a
   chain of seven or more, both in duels. Early orb 1's no-singles bonus is missed by
   every policy on every seed. Add deliberate Quad/no-singles and deep-chain construction
   demonstrations before using these star ceilings to retune quality goals.

The sampled opponent ladder separates the policies in the expected direction:

| Challenger tier | Stacker wins / 3 | Cascade wins / 3 | Specialist wins / 3 |
| --- | --- | --- | --- |
| 1–4, each tier | 3 | 3 | 3 |
| 5 | 1 | 3 | 3 |
| 6 | 0 | 2 | 3 |
| 7–8, each tier | 0 | 0 | 3 |

Six of the 72 duels include one extra round and one unaided player death with no awarded
bot frag. This agrees with the existing attribution rules; extra rounds alone are not
evidence of a bug. Fifteen optional showcase laps stop at the benchmark's lap limits.
Their primary wins remain valid and their observed quality is bounded by that finish
policy, distinct from the zero censored primary attempts.

No authored difficulty settings changed from this three-seed batch. Automatic statistical
curve screening appropriately returns no candidates because each orb/policy has only
three samples; the priorities above are descriptive review cues.

### Artifacts and verification

Main artifacts: `artifacts/odyssey-benchmark-campaign-2026-10-07/`:

- `report.html` / `report.md`: interactive measurements and full per-orb tables.
- `raw.jsonl`, `summary.json`, `config.json`, `capabilities.json`: inputs and observations.
- `environment.json`: Windows x64, Node 24.14.0, Ryzen 7 5800H, sixteen logical CPUs.
  Wall timings indicate compute consumption, not rendering performance.
- `pilot-reproduction.json`: all nineteen comparable, fully completed pilot outcomes
  reproduce exactly in time, score, pieces and metrics under the main batch. Censored
  attempts and truncated optional laps are excluded from this comparison.
- `report-ui-runtime.json` and desktop/phone PNGs: 531 attempts, 177 groups, 59 columns;
  working filters, sort, scrolling and JSON download, with no overflow or console errors.

The 48 focused tests and typecheck pass. CLI and runtime/profile modules pass their scoped
lint checks. A real full-campaign `--resume` runs zero additional attempts and leaves all
531 keys unique. Runtime cleanup regressions also preserve unrelated pooled pieces.

## Running another batch

### Follow-up comparison rules

The screen fixes twenty matched seeds (2001–2020), `cascade` and `expert` policies,
and the common `steady` cadence. The unchanged authored configuration is compared
with each supported variant on orbs 4, 46, 51, 55 and 59: 440 attempts. An additional
105 expert attempts use seeds 3001–3005 and all three cadences on orbs 1, 51 and 59;
twenty native Quad attempts use orb 1 and seeds 4001–4020. Conditions stay separate.

The rules are recorded before these runs in
`artifacts/odyssey-benchmark-nextpass-preregistration-2026-10-07/`:

- Nominate a primary-gate variant only with at least four net additional wins out of
  twenty in `cascade/steady`, qualified relevant capability, no runtime errors and
  at least 95% terminal paired coverage. Confirm the smallest qualifying candidate
  against baseline on 100 fresh paired seeds (5001–5100), with at least ten percentage
  points improvement and an exact paired test. Correct across the three decisions.
- Orb 59 tests 210 then 240 seconds; retain the 160k goal and all star thresholds.
  Completion must improve through recovered deadline misses, not only longer laps.
- Orb 51 tests 75 then 100 ms initial fall, scaling its entire acceleration schedule
  while preserving scoring level 13, 66 lines, 150 seconds and the existing stars.
  Require fewer top-outs and a corresponding failed-input/automatic-lock mechanism.
- Orb 4 tests 850 then 700 ms gravity for both wells. Preserve seven credited frags,
  opponent tiers and death-based stars. Require at least 15% shorter matched-win
  median and 10% shorter p90, without material loss in success, stars or attribution.
  Faster defeats or extra uncredited self-destructions do not establish better pacing.
- Orbs 46 and 55 remain unchanged boss controls. Quality above validated construction
  depth remains strategy-inconclusive; no deep-chain star targets are lowered.

The diagnostic 33-attempt pilot used a frozen implementation and found 23 wins,
ten losses, no censored primary attempts and no errors. One expert orb 55 quality lap
hit the 120-second compute budget at 448.7 of 480 gameplay seconds, so follow-up
compute budgets are 240 seconds. The pilot also exposed an orb 59 policy stall:
repeated rotation kicks and rejected moves left its score unchanged after 144.8
seconds. The follow-up player bounds per-piece retries and schedules a real hard drop
from the current pose on a later input slot. This repairs the measurement instrument
before evaluating deadline variants.

Pilot artifacts: `artifacts/odyssey-benchmark-nextpass-pilot-frozen-2026-10-07/`.
The interrupted first pilot directory is excluded from evidence.

### Completed matched-seed screen

The focused screen completes **440 unique attempts** across twenty matched seeds,
two strategies and the common steady cadence: **380 wins, 60 gameplay losses,
zero primary censors and zero runtime errors**. Every expected condition has twenty
terminal observations; a real resume schedules zero additional attempts. Source,
application and runtime fingerprints match the registered revision.

| Decision | Cascade baseline wins / 20 | Candidate result | Registered screen decision |
| --- | --- | --- | --- |
| Orb 59 deadline | 1 | 210 s: 8; 240 s: 19 | Nominate 210 s, the smallest qualifying extension. |
| Orb 51 initial fall | 14 | 75 ms: 17; 100 ms: 16 | Neither reaches four net additional wins. |
| Orb 4 duel gravity | 20 | 850 and 700 ms: 20 each | Neither reaches the required pacing improvement. |

Orb 59's 210-second variant recovers seven baseline deadline losses with no lost wins;
the specialist improves from nine to eighteen wins with no harm. The 240-second
variant is excluded from confirmation because 210 seconds already passes the
registered nomination rule. Its stronger screening result does not justify replacing
that rule after seeing the data. The 160k score goal and all star thresholds stay fixed.
The live change, if confirmed, would extend only the primary acquisition window;
quality measurements use the benchmark cutoff described above. Authored two-star
combo 10 and three-star combo 12 are separate fields from explicit depth 7. The
current engine reports cascade-wave ordinal into `maxCombo`, so these combo criteria
also require deeper chains than the policies have validated constructing.

Orb 51's 75 ms variant improves five seeds and harms two; the 100 ms variant improves
four and harms two. Reduced execution burden alone cannot override the failed outcome
gate. The specialist wins all twenty seeds under each condition. Keep the authored
gravity schedule pending stronger evidence.

Orb 4's 850 ms variant shortens matched-win median/p90 by 0.47%/1.96%; 700 ms gives
1.34%/6.91%. Both miss the required 15%/10%. All twenty wins retain three stars in
each strategy and condition. Preserve seven frags and the authored gravity; these
restricted-opponent results do not support adoption or a global duel retune.

Unchanged boss controls remain distinct: orb 46 completes 19/20 cascade and 20/20
specialist attempts; orb 55 completes 20/20 for each. Two specialist orb 55 attempts
reach the 240-second compute limit after primary completion, so their later quality
observations are censored. Their primary wins remain valid. No three-star conclusion
follows from the missing deep-construction capability or capped quality evidence.

Artifacts: `artifacts/odyssey-benchmark-focused-screen-2026-10-07/` and the independent
screen analysis in the registration directory. Only orb 59 at 210 seconds advances
to confirmation: baseline and candidate, cascade and specialist, steady cadence,
100 fresh matched seeds 5001–5100, 400 planned attempts. Freeze that nomination before
opening confirmation results; retain the registered gain, preservation and corrected
paired-test gates. Unselected decisions count as p=1 in the three-decision family.

The report passes desktop and 390×844 phone review, including scenario filters,
paired comparisons, actual attack/input telemetry and the two quality-cap warnings,
with no overflow or console errors. The improved instrument has 79 passing focused
tests and a passing typecheck; scoped lint has zero errors (max-length
warnings remain warnings under ADR-0002).

`artifacts/odyssey-benchmark-frozen-source-2026-10-07/` preserves the seven benchmark
modules, package files, original level data, application patch and a checked manifest.
Recover the recorded HEAD in a separate checkout, apply the application patch first,
then overlay the listed snapshot files to reproduce historical conditions. Source
fingerprints prevent a later changed campaign from silently resuming an older run.

### Fresh-seed confirmation and production adjustment

The frozen nomination is confirmed on seeds 5001–5100: **400 unique terminal attempts,
183 wins, 217 gameplay losses, no errors, no primary censors and no capped quality
observations**. Each strategy/condition has one hundred samples. A real resume adds
zero attempts and verifies the original source fingerprints before adoption.

| Strategy, steady cadence | Baseline wins / 100 | 210-second wins / 100 | Recovered deadline failures | Lost baseline wins |
| --- | --- | --- | --- | --- |
| Cascade | 9 | 59 | 50 | 0 |
| Specialist | 27 | 88 | 61 | 0 |

The registered primary contrast gains fifty percentage points, above the ten-point
minimum. Its fifty favorable and zero adverse discordant pairs give an exact one-sided
p-value of `2^-50` (approximately `8.88e-16`), passing the fixed three-decision Holm
threshold of `0.05/3`. Unselected gravity and duel decisions retain p=1; screening and
confirmation observations are not pooled. Separate specialist preservation also
passes the observed guard. All wins remain one star under the benchmark cutoff,
so zero observed star degradation does not establish higher-star fairness.
Every primary conversion acquires 160k after 180 seconds and by 210 seconds
(183.58–209.22 s). Four specialist conversions acquire the goal earlier: the same
policy changes its hurry penalty within fifteen seconds of its configured deadline,
so paired conditions can produce different input choices before 180 seconds.

Only `LEVEL_PHASE2_OVERRIDES[59].victory.failure.value` changes to 210. A deep comparison
of all 59 composed configurations confirms that every other property is identical,
including neighbors, 160k primary score, quality targets, hybrid board, speed schedule,
modifiers, opponent ladder and lap policies. The existing HUD reads this deadline
directly. The live post-win showcase remains manually finishable and can continue
beyond 210 seconds. Historical campaign saves keep their existing level IDs/results.

Confirmation artifacts: `artifacts/odyssey-benchmark-orb59-holdout-2026-10-07/`, including
`primary-runtime-fidelity.md`, `authored-levels-before.json`,
`production-scope-verification.json`, desktop/phone report screenshots and UI evidence.
Independent decision evidence is in `independent-holdout-analysis.json` and its review
under the registration directory. Historical measurements retain their original
application fingerprint; the subsequent production edit has a new fingerprint.
Reproducing or resuming those historical conditions requires the recorded source
snapshot, rather than the now-adjusted live baseline.

Ten shipped-baseline attempts on seeds 5001–5005 reproduce the corresponding frozen
210-second candidate exactly in every recorded field except condition/attempt labels
and wall compute time. This includes primary timing, final metrics, actions, telemetry,
stars and effective rules. Resume schedules zero additional attempts. The focused
post-adoption checks pass **123 tests across eleven files**, typecheck and scoped lint
(zero errors; 167 length warnings across the checked existing/new files). The new
live-mode regression accepts the goal at 200 seconds, keeps the showcase active past
210 seconds, and persists manual completion once. Reproduction evidence is in
`artifacts/odyssey-benchmark-orb59-production-reproduction-2026-10-07/`.
The full repository suite also passes 8,167 tests in 639 files with four workers;
lint/TypeScript ratchets, architecture fitness and dependency boundaries pass.
An initial default-parallel run alongside lint hit timing/timeout checks in unchanged
visual tests; bounded parallelism resolves those without changing their thresholds.

For continuation from Git, use [the handover](ODYSSEY_BALANCE_HANDOVER_2026-10.md)
and [the archived evidence](benchmarks/2026-10-07/README.md). The archive preserves
the historical measurements and source snapshot independently of ignored local
`artifacts/` directories.

### Completed strategy and cadence checks

The Quad screen completes all twenty unique seeds 4001–4020: twenty primary wins,
twelve three-star/no-singles wins, eight two-star wins, no errors or censored outcomes.
Completion takes 27.05–41.05 seconds (median 30.03); no failed inputs, replans or
fallbacks occur. Every lower rating misses no-singles rather than time. One three-star
run uses no Quads at all, confirming that doubles/triples also satisfy the bonus.
Clean forty-piece construction prefixes did not imply full-level reliability: these
timed attempts use 52–80 pieces and a different goal. Preserve the authored bonus.

Quad artifacts: `artifacts/odyssey-benchmark-quad-screen-2026-10-07/`, including
`quad-policy-analysis.json`. A real resume schedules zero additional attempts and
preserves twenty unique records.

The cadence screen completes 105 unique attempts on seeds 3001–3005: 72 wins,
33 gameplay losses, no errors, no primary censors and no capped quality laps.
The specialist strategy is unchanged while execution speed varies:

| Orb | Native baseline wins / 5 | Steady baseline wins / 5 | Deliberate baseline wins / 5 |
| --- | --- | --- | --- |
| 1 | 5 | 5 | 5 |
| 51 | 5 | 5 | 0 |
| 59 | 5 | 2 | 0 |

Orb 51 native wins earn three stars; steady wins earn two. Slower gravity substantially
reduces rejected inputs but produces no additional primary wins in this five-seed
specialist cohort. All deliberate-cadence variants remain at zero wins; changing
gravity alone does not solve the time/throughput constraint. Orb 59 steady improves
from two wins at 180 seconds to five at 210 and 240; deliberate remains zero and
native remains five under every deadline. These are separate descriptive cells,
not human skill ratings or sufficient evidence to select a content change.

Cadence artifacts: `artifacts/odyssey-benchmark-cadence-screen-2026-10-07/`.
A real resume schedules zero new attempts and preserves all 105 unique records.

```powershell
# New coverage with the improved instrument. Preserve the frozen initial campaign.
npm run benchmark:odyssey -- --profiles stacker,cascade,expert,quad --samples 3 --workers 6 --output artifacts/odyssey-benchmark-followup-campaign

# Continue the same recorded run without repeating completed attempts.
npm run benchmark:odyssey -- --profiles stacker,cascade,expert,quad --samples 3 --workers 6 --output artifacts/odyssey-benchmark-followup-campaign --resume

# Historical screen: restore the archived source first to reproduce its 180 s baseline.
npm run benchmark:odyssey -- --levels 4,46,51,55,59 --profiles cascade,expert --scenarios all --cadences steady --samples 20 --seed-start 2001 --workers 6 --wall-ms 240000 --output artifacts/odyssey-benchmark-focused-screen-2026-10-07

# Historical confirmation: restore the archived source first.
npm run benchmark:odyssey -- --levels 59 --profiles cascade,expert --scenarios baseline,orb59-deadline210 --cadences steady --samples 100 --seed-start 5001 --workers 6 --wall-ms 240000 --output artifacts/odyssey-benchmark-orb59-holdout-2026-10-07

# Keep strategy fixed while changing only input execution speed.
npm run benchmark:odyssey -- --levels 1,51,59 --profiles expert --cadences all --samples 3 --output artifacts/odyssey-benchmark-cadence-check
```

Use a new directory for changed code, budgets or sample selection. Start with the
capability report and coverage; use failed objectives, deadline margins, star quality,
chain performance and duel duration/frag distributions to choose the next focused batch.
Human enjoyment and challenge perception remain unmeasured by these synthetic runs.
