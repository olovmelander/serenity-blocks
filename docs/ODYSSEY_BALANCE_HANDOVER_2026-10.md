# Odyssey balance handover — 2026-10-07

## Current handover: learning from a failed attempt

Odyssey's failure sheet now shows the attempt's main objective, final progress,
shortfall and a relevant next-attempt cue. All 51 solo orbs are covered; the eight
duels retain their match score and fresh-round explanation. The change makes the
retry loop more informative without changing authored difficulty or rewards.

The debrief distinguishes separate cascade sequences from the longest chain
produced by one piece. Score advice mentions the consecutive-clear multiplier
only where that modifier is active. Top-out advice prioritizes room at the top;
deadline advice prioritizes the main objective and leaves optional stars for a
replay. These are rule-based practice cues, not diagnoses of the player's board
or claims that a particular strategy has been proved to work.

An over-target final score is still presented as a failed attempt. The sheet
states that the final total met the target but the level was not completed, then
explains the relevant survival or deadline requirement. Exact-deadline ties still
win: the copy says **within** the time limit. No completion or stars are inferred
from the progress bar.

The mode reads the retired attempt's metrics after in-flight physics settles,
including its authoritative final game-state score. Legacy elapsed time freezes
at failure, excluding pause time and time spent waiting for the sheet. Fixed-clock
attempts retain their simulation time and unranked status. Retry, Back to Map,
keyboard focus, single-fire selection and disposal keep their existing behavior.

Validation: **123 focused tests across eight files** pass. New tests cover every
authored solo objective, invalid-data fallback, primary/mastery separation,
chain/sequence counting, final-lock failure, original-session ownership and clock
freezing. Seven Chromium UI fixtures use the production modal, authored level
data and application styles: desktop timeout, terminal-score top-out, mobile
cascade, compact unranked, landscape, duel and 200% text. They pass layout,
keyboard and console checks; the tall compact/text variants scroll within the
sheet. These are isolated UI captures, not full-game or human playtest evidence.
Local captures and logs are under `artifacts/odyssey-retry-debrief-2026-10-07/`.

The full suite passes **8,432 tests across 651 files** (123.64 seconds).
Typecheck, the TypeScript and lint ratchets, import boundaries, architecture
fitness, release gates and `git diff --check` pass. Scoped lint is clean for the
new helper/view/test work; OdysseyMode retains its ten existing long-line
warnings. Architecture baselines were not raised.

Reproduce the new debrief and live wiring regressions with:

```sh
npx vitest run tests/unit/odyssey-retry-debrief.test.js tests/unit/odyssey-failure-modal-result-compatibility.test.js tests/unit/odyssey-gameplay-objectives.test.js --maxWorkers=3
```

The next balance checkpoint remains the existing
[player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol):
observe whether players understand the failure and choose a useful next action,
then adjust concrete pacing/fairness problems. No new bot campaign is needed to
evaluate this UI change. Human calibration and the optional mastery questions at
49/55/59 remain open.

An incidental, pre-existing issue was identified during compatibility testing:
opt-in fixed-clock standard boards read `gameState.board.length` during initial
camera synchronization even though standard mode keeps `board` null. The default
legacy path is unaffected. This separate experimental-clock startup issue was
not changed here; the fixed-clock debrief regression uses infinity orb 2.

## Previous handover: progress persistence and result accounting

The next focused test pass found and corrected three live progression-statistics
defects. Successful completions now count toward `totalAttempts`, alongside
failures. Saved cascade records now consume the mode's `maxCascadeDepth` result,
with the older `cascadeDepth` input retained as a fallback. Completion results now
report `maxCombo` as the best chain through their existing `combo` field, rather
than reporting the number of combo events.

Six new regression cases reproduced the failures before the fixes. The state
tests exercise a loss and a completion at every one of the 59 orbs, reloading
actual serialized saves between outcomes. They verify all eight chapter
boundaries, no unlock from a loss, no orb 60, and retained stars/bonuses after
weaker retries. Separate live-mode cases pass prepared callback sequences through
real result handling and the real state manager: three two-wave chains must save
a peak of two, while one five-wave chain must save five. These are result and
persistence fixtures, not gameplay feasibility demonstrations.

The focused group passes **105 tests across nine files**. The full suite passes
**8,396 tests across 650 files** in 123.82 seconds. Typecheck, TypeScript and lint
ratchets, import boundaries, architecture fitness, release gates and
`git diff --check` pass. Direct scoped lint retains one existing unused-argument
error and ten existing long-line warnings; comparison against `7d35804` confirms
no added diagnostics. Before/after regression logs and checks are retained locally
under `artifacts/odyssey-progress-persistence-2026-10-07/`; the committed tests are
the reproducible regression evidence. The application-source changes are limited
to `OdysseyMode.completeLevel` and `OdysseyStateManager`;
authored difficulty, scoring, physics, stars and unlock rules are unchanged.

Existing saves retain their rewards and aggregate values. This fix records new
outcomes correctly; it does not reconstruct historical missing attempt counts
or incorrect chain maxima. No save-version migration or cloud-merge change is
introduced. New player studies should continue to use the separate playtest saves
specified by the existing protocol.

Reproduce the focused persistence cases with:

```sh
npx vitest run tests/unit/odyssey-state-manager.test.js tests/unit/odyssey-gameplay-objectives.test.js --maxWorkers=3
```

The bounded close-out still applies: use the
[player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
to identify concrete fairness, pacing and learning problems, then verify the
resulting focused adjustments. New automated work should target a specific
failure or proposed change. There is no new bot campaign or mastery claim here;
the 49/55/59 construction questions and human calibration remain open.

## Previous handover: finish-boundary regressions and balance close-out

This bounded follow-up closes a concrete live-game coverage gap
identified by the longer study: a score-crossing lock can fail its next spawn
before goal acquisition. The regression pass exercises production locking,
physics, spawn callbacks and Odyssey result handling in three situations:

- Crossing the ordinary score target with a blocked next spawn records one failed
  attempt and no completion.
- Crossing the same target with a successful next spawn completes exactly once.
- An already acquired showcase primary remains a completion after a later spawn
  top-out, with results evaluated from the final metrics.

Four new cases cover these scenarios, including both showcase orbs 55/59. They
pass within **165 tests across twelve related files** covering live objectives,
deadline/bonus rules, authored gravity, campaign configuration, HUD requirements,
progression/save handling, session retirement, online mastery and timestamp replay.
The gameplay-objectives file now contains eighteen passing tests. Scoped ESLint
and `git diff --check` pass. The full suite was not rerun for this test/documentation
change; application and benchmark source remain unchanged.

Reproduce the new boundary cases with:

```sh
npx vitest run tests/unit/odyssey-gameplay-objectives.test.js --maxWorkers=3
```

These are prepared boundary fixtures, not authored-start mastery constructions or
human difficulty observations. No new gameplay defect was found by this pass.
This pass changes no authored goals, finish rules, production physics or policy
defaults and launches no additional benchmark campaign.

Player-facing improvements already implemented include the proportional orb-6
gravity transition (about 636 ms instead of 120 ms after its 800 ms opening),
orb 59's confirmed 210-second acquisition deadline, the cascade cell-conservation
correction and clearer chain-wave objective wording. Their earlier evidence
remains below. The recent solver studies do not represent additional balance
retunes.

The next balance decision should come from the existing
[formative player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol):
one round across experience groups, one focused adjustment pass, then targeted
verification of changed levels and their neighbors. No human sessions have run.
Primary progression should have no unresolved blockers or unexplained spikes;
goals should be understood and offer learnable responses. Optional mastery at
49/55/59 remains unresolved until credible playable routes or evidence-backed
goal revisions establish the intended challenge.

Further automated work needs a specific correctness failure, proposed balance
change or uncovered behavioral risk. General solver expansion and repeated
unchanged baseline campaigns are not prerequisites for closing primary journey
improvements. The construction recommendations in the previous study remain
available if a defined mastery question requires them; they are not the automatic
next task.

## Previous handover: longer charged mastery study

The [192-piece mastery study](ODYSSEY_LONG_MASTERY_2026-10.md) completes all
**24 assigned invocations with observed exit code zero**: twelve serial
measured-wall parents and twelve independent timestamp replays. All replays pass;
no full three-star witness qualifies. The parents produce **one primary win,
four top-outs, four missed acquisition deadlines and three budget censors**
(two piece limits, one wall limit). The only win is orb 49 / seed 9102 / repair,
with one star. No showcase primary is acquired, so none provides post-primary
showcase quality evidence. All six repair/control pairs remain visible.

The 192-piece ceiling exceeds the known necessary 130 / 155 / 140 piece minima
for orbs 49 / 55 / 59, but this is not a legal construction proof. Orb 55's repair
runs reach 192 pieces with 23/17 sequences and maximum depths 4/5, short of
35 sequences and depth 18. Orb 59's highest observed depth is nine in the
9101 no-repair control; it still misses its primary deadline, score, sequence
count and effective depth-twelve requirement. The complete per-condition
residuals are retained in the study and frozen analysis.

Final score must not replace the recorded terminal history. Orb 49 / 9101 /
repair ends in top-out with `primaryReached: false`, although its final score
is 36,033 and the raw star field is one. The terminal lock adds 44 fast-lock points
to the prior 35,989 at the top-out timestamp; no earlier lock qualifies. It remains
a loss. A zero score shortfall does not imply primary acquisition or full mastery.

Repair uses fewer full plans and less actual simulated compute occupancy in all
six descriptive pairs; **888 completed repaired locks** reach their retained
exact targets. Outcomes remain mixed: orb 59 / 9101 repair tops out earlier with
depth three, while its control reaches depth nine before the acquisition deadline.
Changed trajectories, exposure and stop reasons prevent a general speedup or
gameplay-quality claim. These host-specific schedules do not qualify live browser
performance. Re-measured wall durations also mean the longer runs need not extend
the prior 64-piece trajectories; previous outcomes remain context, not pooled data.

The protocol checkpoint is committed as `509f1e7`; source/analysis registration
froze at **2026-10-07 19:23:33.640 UTC**. Source is unchanged from implementation
`a5068da`: no new solver, authored retune, production-rule or default-policy change.
All **98 focused tests pass again**. The earlier **8,386-test full-suite pass** is
inherited evidence on the same source, not a newly rerun full suite. Frozen goal
analysis reports zero errors. Independent raw audit passes 3,460 lock conservation/
scoring checks, 17,736 command checks, 18,266 compute-window checks and 1,776
repaired-target checks, counting parents and replays rather than separate gameplay
observations. Fresh [archive verification](benchmarks/2026-10-07-long/README.md)
checks all 243 members of the 15,074,281-byte ZIP. Extracted analysis and the
separate construction diagnostic reproduce byte for byte; the raw audit matches
every field and input hash except its new `auditedAt` timestamp.

The next construction work is more specific than another budget increase. Add
sound feasibility bounds after every settled candidate: remaining sequence-trigger
slots, required cells, missing depth, primary/deadline state and orb-49 preterminal
score headroom. A separate portable review of prior structural traces proves
the old orb-49 / 9103 untimed path exhausted score headroom at lock 121, before
top-out at 126; timed bonuses require a separately justified bound. All three old
orb-55 traces run out of remaining distinct trigger slots at lock 159. These are
conditional diagnostics of retained prior traces, not new mastery attempts.

Then build and independently replay legal release structures with explicit
component dependencies, wave order and reachable triggers. Join orb 49's terminal
chain to a surviving Quad prefix; at 55/59 reserve distinct sequence opportunities
while constructing depth. A prepared board fixture is not an authored-start
witness. Keep repair experimental and freeze any changed search before new
outcomes. Development seeds 9101/9102 were reused; 11001+ remain reserved.
The existing [human protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
and blank template remain ready; no human sessions were run. Goal comprehension,
learnable construction, retry motivation and possible waiting pressure at orb 49
still need player evidence before claiming satisfying difficulty or retuning.
Also ask whether reaching the score on a lock whose next spawn tops out matches
players' expectations. This separates the verified terminal rule from its clarity
and perceived fairness; no bug or finish-rule change is asserted.

## Previous handover: planning latency and path repair

The [planning-latency study](ODYSSEY_PLANNING_LATENCY_2026-10.md) completes all
**60 assigned invocations with observed exit code zero**: 30 online parents and
30 exact independent timestamp replays. All replays pass. Opt-in `reachable-v1`
repair and explicit uncharged/fixed/measured-wall computation windows are now
available; defaults remain repair `none` and latency `uncharged`. Authored goals,
scoring, gravity and finish rules are unchanged. No default adoption or retune
is selected.

This is a **64-piece early execution screen**, below the known three-star supply
minima of 130 / 155 / 140 pieces for orbs 49 / 55 / 59. None acquires primary;
24 parents reach the piece budget, five reach the node budget and one tops out.
No mastery is observed, as expected from the deliberately insufficient supply.
These mastery-seeking policy observations are not ordinary-player success rates,
human calibration or evidence that the authored targets are impossible.

Repair uses fewer full-plan calls in all fifteen descriptive pairs, and **802
completed repaired paths lock at their retained exact targets**. Accepted repair
results are not synonymous with completed paths. Changed trajectories, durations
and stopping points prevent a general speedup or gameplay-quality claim. The
fixed-delay orb-49 / seed-9101 control reaches its node cap after 34 pieces;
repair instead tops out after 46. Full plans fall from 301 to 48, but another
324 repair calls raise actual simulated compute occupancy from **65.22 to
80.60 seconds**. Charging each inexpensive repair the same artificial 200 ms
as a full plan demonstrates timing sensitivity, not the repair's real CPU cost.

The three serial measured-wall pairs remain separate and host-specific. Orb 49
reaches 32 pieces at the control's node cap and 64 with repair; both policies
reach 64 at 55 and 59. Actual compute occupancy is lower in these three repair
observations, but their trajectories and exposure differ. Simulator schedule
validity still does not establish live browser or main-thread performance.
`planningChargedMs` is nominal requested delay; `planningElapsedMs` is actual
occupied simulation time, including frame quantization and interruptions.

Implementation `a5068da` is committed and pushed. All 98 focused tests and clean
scoped lint pass; the full suite passes **8,386 tests across 650 files** in
107.45 seconds, and all non-test gates pass. The registration froze at
**2026-10-07 18:49:45.523 UTC**. Independent raw audit passes with zero errors:
3,564 lock conservation/scoring checks, 17,388 command checks, 16,196 compute
windows and 1,604 exact-target checks, counting both parents and replays. Unique
parents contain 1,782 locks, 8,098 windows and 802 repaired target locks.
No interruption or recovery was needed. The
[archive](benchmarks/2026-10-07-latency/README.md) retains all 472 members in four
ordered binary parts; reassembly produces a 133,744,966-byte ZIP. Final independent
verification checks every part, assembled archive and member hash, reproduces the
frozen analysis byte for byte, and reproduces the passing raw audit identically
except its new top-level `auditedAt` value.

Next, run a controlled joint-mastery study with at least 192 pieces, exact
three-star goals, charged timing and repair retained as an experimental condition
alongside its no-repair control. Preserve all censors; adequate cell supply is
not a construction proof. Terminal-Quad and deep-chain geometry still need a
legal complete witness. Use matched-state timing probes if changing repair
readiness logic, and measure browser scheduling separately. The existing human
protocol and blank template are ready; no human sessions have been run.
For orb 49, test whether prefix-plus-finishing-chain planning is understandable
and satisfying, and whether its fast-lock bonus makes players feel pushed to
wait before automatic finish. This is a design question, not measured unfairness.
Development seeds 9101/9102 were reused; confirmation seeds 11001+ remain reserved.

## Previous handover: online mastery development

The [online mastery continuation](ODYSSEY_ONLINE_MASTERY_2026-10.md) adds gravity-aware
replanning, independent timestamp replay and opt-in structural setup search. **No
full three-star witness qualifies.** All 27 covered parent/replay pairs pass their
relevant replay checks: 24 original pairs and three separately registered recovery
pairs. Reproducible execution is distinct from mastery or human feasibility.

The original 54 assignments finish with **48 completed, three interrupted parents
and three skipped dependent replays**. A separate six-task recovery completes all
six. The runner interruption's cause and the three interrupted exit codes remain
unknown; the preserved outer log confirms exit code zero for the 23 earlier
completed outputs, correcting the initial missing-exit-observation assessment.
All fifteen partial files are unchanged. The three retries match every recorded
simulation/metric prefix (130/130, 76/76 and 28/28 records), excluding wall/CPU time.
Recovery is coverage accounting, not a replacement or fresh confirmation cohort.

Among fifteen completed original online runs, there are three primary wins, two
real top-outs and ten budget censors. The three recovery runs add three budget
censors. The eighteen covered assignments therefore have **three primary wins,
two top-outs and thirteen censors** (six node limits, seven piece limits); no mastery.
All wins are one-star orb-49 completions. This experimental policy seeks mastery
setups and differs from earlier primary-goal profiles. Its primary count is not an
ordinary-player win rate or an overall difficulty calibration.

The structural runs reach six/seven/eight Quads at orb 49, then all top out.
**Eight Quads before top-out** does not establish a surviving terminal setup or
reachable finishing chain. Orb 55 reaches depths six/five/five but only one cascade
sequence in each run, then exhausts 192 pieces. Orb 59 reaches depths five/zero/zero
and tops out. None reaches primary or full mastery; keep structural-v1 experimental.

Planning CPU/wall time remains uncharged to the virtual clock. Per-run median
planning wall costs range from 159.92 to 441.85 ms, with 78–460 gravity-triggered
replans per run. Real-time computational feasibility remains unverified. Next,
experiment with repairing a reachable path toward the chosen placement before a
full replan, then measure planning latency charged to gravity and the game clock.
The old target may no longer be reachable; this proposal is not an adopted change.
Structural mastery still needs a legal joint witness and player playtests.

For orb 49, test whether preparing the earlier Quads and finishing chain is clear
and satisfying, and whether players feel pushed to wait: faster locks add more
bonus score before automatic finish, while waiting can lower that bonus. This
rules-based question is not a finding of dissatisfaction or unfairness. No human
sessions or fresh-seed confirmation were run; seeds 11001 and above remain reserved.

Commit `96b2364` passes 74 focused tests, clean scoped lint and all non-test project
gates; the full suite passes **8,362 tests across 649 files** in 107.44 seconds.
The original source/analysis registration froze at **17:26:32.105 UTC**; unchanged-
source recovery froze at **18:15:38.964069 UTC**. Source and the frozen main analyzer
remain unchanged. Independent raw audit and [archive verification](benchmarks/2026-10-07-online/README.md)
remain separate: raw audit passes with zero errors, 7,928 completed-lock
conservation/scoring checks and 34,514 command checks. Fresh extraction verifies
all 488 archive members, reproduces both frozen analyses and coverage byte for byte,
and reproduces the passing raw audit identically except its new `auditedAt` timestamp.
All nine untimed and eighteen timestamp replay projections match exactly.
No authored retune or default-policy adoption is selected.

Review found that the old v2 driver passed a seed field through its planner options,
although the planner did not read it and no hidden-bag use was observed. The v3
revision replaces that spread with budget-only allowlists and getter-trap tests.
The historical strict claim that the planner never received a seed exceeded the
old API's enforced contract; the immutable archive retains that history.

The independently reviewed orb-49 bound is tighter: a fully drained standard board
plus its triggering tetromino has at most 224 usable cells, below the 230 needed
for five Quads in an eight-wave chain. The old seven-prior/five-final relaxation is
excluded. Three stars require at least 130 pieces; the eight-prior/four-final
allocation remains arithmetic, not a legal witness. Historical archives retain
their original loose bounds and measurements.

## Previous handover: targeted mastery development

The targeted continuation ran **nine development searches and twenty-seven
independent replay tasks**. No exact three-star witness was found. All nine search
traces are valid with zero prediction mismatches, and all nine untimed replays
are valid and complete. Only five of eighteen fixed-path timed replays complete
their traces; none acquires a primary goal. These results support further
construction and timed-planning work, not lowering the authored targets.

Commit `0ecb883` adds the observation-limited targeted solver and independent
untimed/timed replay described in the [targeted mastery record](ODYSSEY_TARGETED_MASTERY_2026-10.md).
The source-derived budget audit proves that the previous 128-piece cap cannot
supply all three-star requirements at 55 or 59: necessary minima are **155 and
140 pieces**, respectively. Orb 59 initializes with 41 cells, correcting the
earlier informal forty-cell estimate without changing its rounded bound. That
pass's loose orb-49 bound admitted a seven-prior/five-final-Quad relaxation; the
current 224-cell bound above supersedes that allowance without changing the archive.

The development protocol searches 49/55/59 on seeds 9101–9103 with a 192-piece
cap and explicit three-preview observations, then independently replays every
nonempty partial trace untimed and at two fixed input cadences. Its default target
is exact three stars; orb 55's optional twenty-Quad bonus is a stronger request
whose combined cell budget requires at least 305 pieces. No authored target or
production rule changes. These seeds are development data; 11001 and above remain
reserved for later confirmation.

All **8,335 tests across 647 files pass**, including 47 new tests; scoped lint has
zero findings and the repository's type, lint-ratchet, boundary, architecture and
release checks pass. Registration/source froze at **16:55:15.064 UTC**, covering
nine searches and twenty-seven assigned replays. All thirty-six CLI invocations
return exit code zero, including the retained timed replay interruptions. A blank
[player template](benchmarks/2026-10-07-targeted/player-playtest-template.csv) is
prepared, but no human sessions have been run. The completed evidence below keeps
its original meaning and is not pooled with this development continuation.

Orb 49 reaches its primary before mastery at 100/112/95 pieces, with a maximum
five-wave chain. The 55/59 searches use all 192 pieces without acquiring the primary
and reach at most six/seven waves respectively. Their untimed replays preserve
those outcomes. The five complete timed traces are all orb 55 (three at 150/100 ms,
two at 300/180 ms), and still end without primary completion. The thirteen timed
interruptions are seven automatic locks and six rejected commands: censored,
invalid replay paths, not ordinary gameplay defeats. Independent raw verification
passes all 4,254 completed-lock conservation checks. The timed records' false
quality-censor flags do not imply complete quality when no primary was acquired.

Next, develop online replanning that accounts for elapsed inputs and gravity, and
explicitly solve terminal Quad/cascade geometry under the exact joint conditions.
Use independent replay to validate resulting witnesses, and the formative player
protocol to investigate enjoyment and learning. No human calibration or fresh
confirmation has been performed; seeds 11001 and above remain untouched.
The [targeted evidence archive](benchmarks/2026-10-07-targeted/README.md) is complete
and independently verified: all 297 member hashes match, and a fresh extraction
reproduces both the frozen analysis and independent raw-audit JSON files byte for
byte using only archived inputs.

## Previous handover: corrected physics and mastery evidence

Commit `5078998` fixes a shared cascade defect: clearing a row previously moved
surviving fragments upward before gravity, allowing overlaps and lost cells. The
helper now preserves each surviving cell's row position until gravity moves it.
The four recorded failure fixtures pass in both legacy and resolved physics.
Authored goals, mastery targets, opponent tiers and seven-frag matches are unchanged.

The separately registered post-fix campaign completed **108 fresh observations**:

| Cohort | Result | What it establishes |
| --- | --- | --- |
| Untimed construction | 50/50 traces pass recorded validity checks: thirty authored starts and twenty empty boards. No conservation failures, injected cells, invalid paths or runtime errors; thirteen real `chain` top-outs remain valid attempts. | Legal bounded construction on corrected physics, not live timing or full mastery. |
| Timed duels | Forty attempts: twenty wins and twenty bot losses; no errors or censors. Both profiles win 5/5 at 4/9, all three stars; both lose 5/5 at 53/58. | Descriptive policy coverage, not human difficulty calibration. |
| Timed solo | Eighteen attempts: seventeen primary wins and one real top-out; no errors or primary censors. All observed wins have one star. | Primary goals remain demonstrated for these policies and seeds; showcase quality observation is bounded. |

Authored construction reaches maximum expert/chain depths **4/6 at orb 49, 5/7 at
55 and 4/5 at 59**. None meets the effective three-star chain targets of eight,
eighteen and twelve waves, or full mastery requirements. These bounded search
failures do not prove impossibility or justify lowering targets. Untimed attempts
omit competing gravity and elapsed time and receive the maximum lock bonus.

`duelist` remains experimental: its successful median duration is longer than
`cascade` at both early orbs (314.45 → 344.82 seconds at 4; 314.98 → 354.32 at 9),
with negative median paired attack-yield differences. Do not adopt it as the
default or retune production opponents from this evidence.

Solo 49/55 finish 3/3 under each profile; orb 59 finishes 2/3 under `cascade` and
3/3 under `expert`. The sole loss is `cascade` / 59 / seed 10103, a top-out at
169.85 seconds. All six orb-55 wins stop quality observation at the thirty-second
cap and remain primary wins. The five orb-59 wins stop at the benchmark's acquisition-
deadline cutoff. Their raw `qualityCensored` flag is false, but this still does
**not** observe complete live showcase quality: live play can continue until
manual finish or top-out. Neither set validates full higher-star fairness.

Next, use a targeted construction solver to seek legal witnesses for the exact
49/55/59 requirements, replay witnesses through production physics, then evaluate
finite-speed execution. Follow the [formative player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
for learning, motivation, recovery beats and duel length. No human calibration has
been performed. A later policy nomination or balance intervention needs a new
registration and untouched confirmation seeds starting at 11001.

Commit `99215f7` makes the mastery instructions truthful without changing targets
or evaluation: `combo` and `maxCascadeDepth` receive the same cascade-wave ordinal,
so the HUD shows one effective chain requirement. The guide distinguishes that
single-piece chain from the consecutive-clear score multiplier and explains normal
automatic finish versus showcase continuation. The [whole-journey review](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#mastery-communication-and-capability-follow-up)
records the score/occupancy bounds, including orb 49's requirement for at least
three Quads within its finishing chain of eight or more waves. Arithmetic feasibility
is not a demonstrated legal construction.

Commit `b89bbec` adds opt-in `chain`/`duelist` benchmark profiles and authored-start
construction flags. Defaults retain the four established profiles. All explored
chain variants on development seeds **9101–9103** are preserved separately. The
post-fix registration froze `5078998` at **16:18:06 UTC** on Node `v24.19.0`, Linux
x64: construction/duels use fresh seeds 10101–10105 and solo uses 10101–10103.
The review records fingerprints, exact coverage and reproduction commands. These
fresh seeds are unpaired with the pre-fix screen; no before/after efficacy estimate
or policy-nomination gate applies.

The complete **pre-fix** screen remains separate: eighty duels (41 wins / 39 bot
losses, no errors/censors) and fifty construction records, four invalid from cell
loss. Those four remain in the accounting and are excluded from legal capability
evidence. Both early duel nomination gates failed. The old orb-59 / chain / 10005
trace first reaches eleven waves at piece 80; its full 128-piece, 544-action replay
passes conservation in both old physics paths. It misses full higher-star conditions
and applies only to the old engine. The correction changes actual cascades: the
failing orb-49 state changes from five lines/five waves to three lines/two waves
with 68 remaining cells conserved; development seed 9101 changes from six waves to
four, without policy tuning to restore the old result.

The pre-fix freeze script sorted source paths differently from the CLI, yielding
an aggregate-hash mismatch from identical archived bytes. This was discovered
before outcome analysis and independently verified from the pre-execution ZIP.
Original registration/analyzer files remain immutable; a disclosed correction and
wrapper use the CLI-compatible hash without changing metrics or observations.

Older affected demos/checkpoints have no simulation-version gate and may load but
diverge. Patched and unpatched network peers are not guaranteed compatible; the
focused correction includes no unrelated format or protocol version bump.

At `5078998`, **8,288 tests across 644 files pass** with four workers (105.63 seconds).
The 57-test corrected-physics subset covers all four recorded failure fixtures.
Typecheck, TypeScript/lint ratchets, scoped correction lint, architecture fitness
and import boundaries pass; repository lint findings remain at baseline with no
fatal errors. Desktop/phone mastery-HUD captures and all three post-fix report
browser checks pass without console errors. These are presentation checks, not
human playtests or full-scene gameplay validation.

The [mastery evidence archive](benchmarks/2026-10-07-mastery/README.md) is complete
and independently verified: all 128 members match their recorded SHA-256 values,
and a fresh extraction reproduces the original pre-fix, corrected-provenance
pre-fix and post-fix analysis JSON files byte for byte using only archived inputs.
The prior 344 diagnostic records below retain their historical meaning and are
not pooled with either follow-up cohort. No authored mastery target was changed.

## Journey-difficulty continuation

The continuation based on main `ca3884e` is recorded in the
[whole-journey review](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md). Its implementation is
commit `23a7abb`: orb 6 retains its 800 ms opening gravity and scoring-level
progression, but its first 15-line transition now follows the proportional authored
speed curve (approximately 635.76 ms) instead of abruptly switching to 120 ms.
The primary goal, stars, opening rows and other 58 orbs retain their authored rules.

The matched diagnostic check completed 120 attempts per version: 109 baseline wins
and 110 corrected wins, no lost baseline wins, and no star decreases among the 109
pairs that won in both versions. Failed inputs were 24 versus 7 and automatic locks
7 versus 0. These are descriptive preservation checks for a mechanical correction,
not confirmation of a human difficulty improvement or statistical non-inferiority.

The benchmark now leaves the production opponent's real queue intact while keeping
the synthetic player at three previews. New config and attempt metadata record
planning knowledge separately from the visible queue. Resume rejects incompatible
metadata; reports prevent pooling known restricted and production opponents in the
same group. Historical duel data must keep its original restricted-opponent meaning.

The latest review records the chapter-6 recovery measurements, the eight-tier
production-opponent pilot, validation and a formative player playtest protocol.
The working audience is an approachable main route with demanding optional mastery;
no human calibration has yet been performed. Continue deep-chain construction and
duel pacing work from the latest review, using new output directories and untouched
confirmation seeds rather than treating the diagnostic cohorts as a tuning holdout.

All **344 new diagnostic attempts** completed without runtime errors or primary/quality
censoring. The full suite passes **8,191 tests across 640 files** with four workers;
typecheck, lint and architecture/import gates pass. The
[continuation evidence archive](benchmarks/2026-10-07-journey/README.md) preserves the
registration, raw data, analysis, reports, source patch and validation. No benchmark
run remained active at the end of those cohorts. This is a local implementation and
evidence record; it does not claim publication or human playtest completion.

## Previous confirmed tuning pass

The automated difficulty audit and its first supported adjustment are complete. No
benchmark run was active at that handover. The only gameplay change in that pass was Electric Apex (orb 59):
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

## Historical uncertainty at the previous tuning handover

The following limitations describe that earlier pass's frozen source and cohorts.
The current handover above records the subsequent construction capabilities and
production-opponent comparisons; it does not relabel these historical results.

These are synthetic strategy/execution measurements, not human success probabilities
or enjoyment ratings. No player calibration has been performed.

Empty-board legal construction validates three-stage chains for the specialist, and
less consistently for cascade. Five/eight/ten-stage construction is not validated.
Orb 59's authored combo 10/12 fields are separate from explicit depth 7, but the
current physics reports cascade-wave ordinal into `maxCombo`, making its effective
chain targets ten/twelve waves. Orb 55's three-star combo 18 likewise requires an
eighteen-wave chain despite its explicit depth-ten field. All confirmation wins are
one star. Preserve these targets
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

## Historical next-session recommendations — superseded

The recommendations below were recorded before the online and planning-latency
continuations. Follow the [current handover](#current-handover-progress-persistence-and-result-accounting)
for the next study; online replanning and the independent execution tooling below
are now implemented and validated.

1. Extend the targeted solver with online replanning under elapsed input time and
   gravity, and explicit terminal Quad/cascade geometry for the joint 49/55/59 targets.
   Preserve authored starts, real bags, score progression, automatic finish and
   showcase continuation. Orb 49 needs twelve Quads with at least three in the
   finishing chain of at least eight waves; 55/59 require eighteen/twelve waves plus
   the remaining conditions. Retain unsuccessful searches; a bounded miss is not impossibility.
2. Replay any candidate witness through corrected production physics with cell
   conservation and board-continuity checks, then test finite-speed execution and
   real gravity. Keep untimed construction, timed capability and complete live
   showcase quality separate.
3. Run the [formative player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
   to assess learning, recovery beats, retry motivation and duel length. Include
   natural progression and optional star replays; these synthetic cohorts do not
   establish enjoyment or human success probabilities.
4. Keep `duelist` experimental. Any new attack-policy hypothesis or balance change
   needs a new registration before results, relevant capability, untouched
   confirmation seeds starting at 11001 and declared preservation checks. Retain
   seven credited frags, attribution and the production opponents' full queues.
5. Check neighboring entry/release/challenge/boss orbs if a later change affects
   wider gameplay. Preserve the chapter rhythm and distinguish source revisions in
   every evidence record.

Use the review's [tooling and reproduction instructions](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#experimental-capability-tooling-and-reproduction)
and the archived registration commands for exact methods. New source, runtime,
rules or budgets require a new output directory; do not resume the pre-fix screen
against corrected physics. No further benchmark run is scheduled by this handover.
