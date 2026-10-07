# Odyssey targeted mastery — 2026-10-07

## Scope and protocol status

This continuation starts from `d139369`, after the shared cascade correction in
`5078998`. It investigates exact three-star requirements on orbs 49, 55 and 59 with
targeted construction search and independent replay. Authored targets, scoring,
physics and finish rules remain unchanged. The previous
[mastery evidence archive](benchmarks/2026-10-07-mastery/README.md) stays immutable;
its 128-piece construction observations are not relabeled as this search.

The implementation is committed as
`0ecb8839c6542eae1cc1c6e5c7bba1af1c5749a3`. This is a development experiment on
previously explored seeds, not a fresh confirmation. Source and analyzer registration
froze at **2026-10-07 16:55:15.064 UTC**, before outcome inspection. The combined
source fingerprint is
`b76c97feb21a3fc04c55ce5fad7b1923e309824c374c523e6be3416d3c0d9c4a`, on Node
`v24.19.0`, Linux x64. Registration, source snapshot, manifest, runner and frozen
analyzer are preserved under `artifacts/odyssey-targeted-mastery-2026-10-07/`.
All thirty-six assigned development tasks are complete. No full three-star
witness was found. The [targeted evidence archive](benchmarks/2026-10-07-targeted/README.md)
is complete and independently verified.

## Exact stars and optional bonuses

The evaluator checks each star tier's declared conditions. It consults bonus count
only when that tier explicitly contains a `bonuses` condition; none of these three
orbs does. Requiring every optional bonus would silently strengthen the search
problem at orb 55.

| Orb | Exact three-star conditions | Additional requirement if every bonus is also requested |
| --- | --- | --- |
| 49 | Score at least 36,000; twelve Quads; one chain of at least eight waves. | None: both bonuses are implied by three stars. |
| 55 | Score at least 500,000; thirty-five cascade sequences; one chain of at least eighteen waves. | Twenty Quads. The thirty-cascade, depth-ten and combo-eighteen bonuses are already implied. |
| 59 | Score at least 260,000; twenty-five cascade sequences; one chain of at least twelve waves. | None: all bonuses are implied by three stars. |

The explicit depth-ten/depth-seven star fields at 55/59 remain in the evaluator.
Their combo-eighteen/combo-twelve fields are stronger because both metrics receive
the same cascade-wave ordinal. A cascade sequence counts one locked piece that
causes at least two clear waves; it is distinct from either total waves or the
consecutive-clear score multiplier. Satisfying bonuses without the required score
does not establish three stars.

The primary goals remain 36,000 points at 49, 250,000 points within 480 seconds at
55, and 160,000 points within 210 seconds at 59. Ordinary orb 49 finishes after its
goal-winning cascade fully resolves, including scoring and bonuses. The two
showcases may continue after acquiring the primary goal until manual finish or
top-out. Their acquisition deadlines do not become live post-win limits.
Primary victory is checked after physics settles; crossing the score during a
cascade does not permit a new primary win after the deadline. Qualification at the
exact deadline wins the tie. Final completion must drain pending physics before
reading the result. Replay should use the evaluator's tracked `maxCombo`, not the
completion payload's `combo` event-count field, for a chain-depth condition.

## Piece-budget constraints

For `K` cascade sequences including one of depth `D`, at least
`D + 2 × (K − 1)` clear waves are necessary. Each wave clears at least one ten-cell
line. With no inserted cells, the starting inventory plus four cells per placed
tetromino must cover those removals. Ignoring all cells still on the final board
makes the resulting bounds generous necessary conditions, not constructions.

| Search target | Minimum cleared lines | Starting cells | Necessary placed pieces |
| --- | --- | --- | --- |
| Orb 55 exact three stars: 35 sequences, depth 18 | 86 | 240 | At least 155 |
| Orb 59 exact three stars: 25 sequences, depth 12 | 60 | 41 | At least 140 |
| Orb 55 three stars plus every bonus, including twenty Quads | 146 | 240 | At least 305 |

Each Quad adds three lines above the one-line-per-wave relaxation. Consequently
the earlier **128-piece budget cannot establish complete three-star conditions at
55 or 59**, regardless of search quality. It can still describe lower-depth
capability. The new **192-piece budget** removes that particular inventory
obstruction for exact three stars; it does not prove reachability or timely
execution. At 55 it remains insufficient for three stars plus all optional bonuses.
Direct engine initialization gives **41 opening cells at 59**, correcting the
earlier informal estimate of forty. The exact bound remains
`ceil((600 − 41) / 4) = 140`; this source-derived inventory replaces the estimate.

Orb 49 has a different restriction: an eight-wave chain alone exceeds its 36,000
primary goal, so the chain must be the finishing cascade. Its twelve Quads require
at least three Quad waves inside that final chain. Relaxed inventory routes are:

| Earlier Quads | Final-chain Quads | Minimum total lines | Necessary placed pieces | Minimum cells in the final chain |
| --- | --- | --- | --- | --- |
| 9 | 3 | 53 | 133 | 170 |
| 8 | 4 | 52 | 130 | 200 |
| 7 | 5 | 51 | 128 | 230 |

The last route fits the generous 240-cell board bound, so inventory alone does
not exclude orb 49 at 128 pieces. No row in this table establishes legal tetromino
geometry or a reachable bag sequence. In the untimed zero-held-time context, nine
earlier Quads require at least ninety locks: their minimum 32,200 line-clear score
plus 4,500 lock-bonus points already exceeds the goal. That route therefore ends
before the required final chain. Timed execution can award smaller lock bonuses;
failure under untimed scoring does not exclude a timed construction with more
score headroom.

The source-derived driver imports the actual level definitions, scoring function,
tetrominoes and `GameplayHybridEngine`, then initializes authored boards with
development seed 9101. It records occupancy and source hashes without playing
pieces or inspecting future queue contents. Its verified output is under
`artifacts/odyssey-targeted-mastery-2026-10-07/bounds/` and is reproduced with:

```sh
node artifacts/odyssey-targeted-mastery-2026-10-07/bounds/audit.mjs
```

These arithmetic bounds remain separate from empirical solver results and
human-difficulty claims. The larger budget does not remove the untimed nine-prior-
Quad scoring exclusion at 49.

## Targeted-search observation boundary

The `observation-beam-v2` planner receives an explicit allowlist: the actual board
and piece connectivity, current piece, exactly three previews, progress, metrics
and authored rules. It receives no seed, RNG state or hidden queued pieces. The
driver separately uses the seed to reproduce the real engine and bag. The beam
search can consider the current piece plus three known future pieces, then one
unknown-shape step. That tail averages the best responses for all seven shapes
under a uniform surrogate; it does not predict the actual hidden bag.

Search uses the current observation again after each real placement. Candidate
paths must preserve legal movement, rotation and drop commands, real score
progression, modifiers, the full cascade drain and the authored finish policy.
The search target is the exact three-star predicate. Optional bonuses are reported
separately; this campaign does not require all of them. A search budget is an observation
limit, not a live gameplay rule. Only the first placement is executed before the
planner receives a new observation.

Nine development searches cover 49/55/59 × seeds **9101–9103**, each with at most
192 pieces, beam width eight, 240,000 total search nodes and a 2,400-node per-plan
ceiling. The remaining node budget is distributed adaptively over remaining
pieces, so a plan may receive fewer nodes than that ceiling. The unknown tail is
one step and the per-search wall budget is 240 seconds. These previously explored
seeds remain development evidence; untouched confirmation seeds starting at
11001 are not used by this continuation.

Retain every explored development variant and seed. The policies, source, runtime,
seeds, piece/search budgets and reporting rules were frozen before this execution.
Keep top-outs, exhausted budgets, invalid traces and runtime failures distinct.
An unsuccessful bounded search is inconclusive; it is not a proof that a player
cannot meet the target. No default-profile change or authored retuning follows
from this protocol alone.

## Independent replay and timed qualification

Replay reconstructs the authored engine and seeded bag independently of planning.
It must not load a supplied prepared board or invoke the search policy. Check piece
identity, the recorded three previews, legal commands, per-lock geometry and
connectivity, fully drained physics, and cell conservation including legitimate
off-board cells. Prepared fixtures remain separate from constructed witnesses.

Report replay validity and trace completion separately from primary completion,
exact star conditions and optional bonuses. An untimed replay can establish legal
construction under its scoring context; its elapsed time and timed stars remain
unvalidated. Its zero held time awards the maximum fifty-point lock bonus.

Timed replay uses production gravity, motion timers and finite command cadence,
without the untimed seeking shortcut. Every nonempty recorded partial trace is
assigned an untimed replay and two timed replays, even when search did not find a
mastery candidate. The fixed reaction/action intervals are **150/100 ms** and
**300/180 ms**. Each replay has a 1,800-second simulation budget and a 120-second
wall budget; execution uses three workers. No cadence is selected after observing
outcomes. Ordinary auto-finish remains
authoritative. Showcase replay continues after the primary deadline when the goal
was already acquired; reaching the trace end requests manual finish, while top-out
ends the live showcase. Harness interruptions must not turn partial quality into
complete mastery or erase an already acquired primary win.

A fixed recorded path can demonstrate execution feasibility at its tested cadence.
It does not by itself prove an online strategy avoided future knowledge: that
claim belongs to the solver's observation boundary and tests. Neither a solved
trace nor fast scripted replay establishes human learning, enjoyment or fairness.
The [formative player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
remains the relevant next step for those questions.

## Reproduction and validation

The committed CLI creates a new output directory with source/runtime provenance
and preserves its input candidate for replay. These commands reproduce one
development case; they are not a fresh-seed confirmation or a request to replace
the archived records:

```sh
node scripts/odyssey-mastery.mjs search --level 49 --seed 9101 --max-pieces 192 --beam-width 8 --max-nodes 240000 --nodes-per-plan 2400 --unknown-tail-depth 1 --wall-ms 240000 --output artifacts/odyssey-targeted-reproduction/search-49-9101
node scripts/odyssey-mastery.mjs replay --candidate artifacts/odyssey-targeted-reproduction/search-49-9101/candidate.json --mode untimed --max-seconds 1800 --wall-ms 120000 --output artifacts/odyssey-targeted-reproduction/replay-49-9101-untimed
node scripts/odyssey-mastery.mjs replay --candidate artifacts/odyssey-targeted-reproduction/search-49-9101/candidate.json --mode timed --reaction-ms 150 --action-ms 100 --max-seconds 1800 --wall-ms 120000 --output artifacts/odyssey-targeted-reproduction/replay-49-9101-150-100
node scripts/odyssey-mastery.mjs replay --candidate artifacts/odyssey-targeted-reproduction/search-49-9101/candidate.json --mode timed --reaction-ms 300 --action-ms 180 --max-seconds 1800 --wall-ms 120000 --output artifacts/odyssey-targeted-reproduction/replay-49-9101-300-180
```

At `0ecb883`, **8,335 tests across 647 files pass** in 106.11 seconds, including
47 new solver/replay/CLI tests. Scoped lint has zero findings. Typecheck,
TypeScript ratchet, import boundaries, architecture and release checks pass.
The repository lint ratchet remains at its baseline of 813 existing errors,
1,057 warnings and zero fatal errors.

A blank [player playtest template](benchmarks/2026-10-07-targeted/player-playtest-template.csv)
is prepared for the formative protocol. It contains headers only: no participant
session has been run and no human response is represented as measured data.

The [targeted archive](benchmarks/2026-10-07-targeted/README.md) preserves 297 members
in a 10,712,772-byte evidence ZIP with SHA-256
`1a3397e635879e5d1ffd75068047b32c368adef7d3e5bae40abf7f82bfb79691`.
Independent fresh extraction verifies every member hash and regenerates both the
frozen `analysis.json` and `independent-result-audit.json` byte for byte using only
archived inputs. The external manifest records this verification.

## Development results

All **36 assigned CLI invocations returned exit code zero**, and their source,
runtime, commands and input provenance verify against the frozen registration.
This is task accounting, not a claim that every replay completed successfully.
The analyzer independently verifies the 1,186-file source snapshot, recorded
trace arithmetic, continuity and exact star predicates. Production command legality
is exercised by the Node replay; matching records alone do not prove the planner's
information boundary or human execution capability.
An additional independent raw audit verifies every configuration/result hash and
the source ZIP, and passes all **4,254 completed-lock conservation checks** without
altering the frozen analyzer.

All nine searches produce valid recorded traces with zero prediction mismatches,
but **none satisfies the exact three-star conjunction**:

| Orb | Pieces placed on seeds 9101 / 9102 / 9103 | Primary reached | Maximum depth across the three searches | Termination |
| --- | --- | --- | --- | --- |
| 49 | 100 / 112 / 95 | 3/3, untimed | 5 | All reach the primary goal before mastery and automatically finish. |
| 55 | 192 / 192 / 192 | 0/3 | 6 | All exhaust the piece budget. |
| 59 | 192 / 192 / 192 | 0/3 | 7 | All exhaust the piece budget. |

Orb 49's searches finish with zero, two and three Quads respectively, short of
twelve. The deeper orb-59 example reaches seven waves, 24 cascade sequences and
151,538 points: it still misses the 160,000-point primary as well as its stronger
three-star conjunction. A depth-only improvement is not a mastery witness.
The 192-piece searches at 55/59 remain bounded unfinished attempts, not observed
gameplay defeats or proofs of impossibility.

All **nine independent untimed replays are valid and trace-complete**. They
reproduce the three ordinary primary wins at 49. The six showcase traces exhaust
their recorded candidates without acquiring the primary goal; their replay outcomes
are censored rather than losses. No untimed replay establishes full mastery.

Of **eighteen timed replays**, five are valid and trace-complete: all three orb-55
traces at 150/100 ms and two orb-55 traces at 300/180 ms. They exhaust their 192-piece
candidates without a primary win. The other thirteen replays stop when the fixed
command path cannot continue under timed physics. No timed replay acquires the
primary or qualifies as a full witness. All eighteen are therefore unresolved
primary observations, even though five complete the entire assigned trace.

The thirteen interrupted timed traces comprise **seven automatic locks and six
rejected timed commands**, independently confirmed from the raw replay files.
They invalidate those replay witnesses and remain separate from normal top-outs,
runtime errors and search budgets. All eighteen timed records have
`qualityCensored: false`, but none acquired the primary; that flag cannot establish
a complete-quality or mastery result. The fixed-path replay is useful evidence
about those paths at the declared cadences; it does not measure an online player
that can choose a new move after gravity changes the board.

## Interpretation and next work

The source-derived bounds explain why a larger piece allowance was necessary for
testing the full 55/59 conjunction, while the completed searches show that adequate
cell supply alone does not produce the required geometry. The independent replays
separate untimed legality from execution under gravity. These nine development
cases select no difficulty change, profile adoption or fresh-seed efficacy claim.

Next, integrate elapsed command time and gravity into online replanning, preserving
the current-piece/three-preview boundary. In parallel, target the terminal Quad
and cascade geometry explicitly: at 49, plan the required final Quad-bearing chain
while preserving primary-score headroom; at 55/59, plan both the deep chain and the
required number of separate cascade sequences. Verify any resulting witness through
the independent replay before claiming timed feasibility. Declare changed search
policy, budgets and cadence before examining a new run; confirmation seeds 11001
and above remain untouched.

Use the blank player template with the formative protocol to investigate learning,
recovery beats, retry motivation and duel length. No human sessions were run in
this continuation, and the synthetic searches cannot establish enjoyable difficulty
or a human completion probability.

## Execution and evidence status

| Record | Status |
| --- | --- |
| Source-derived bounds | Executable audit verifies actual opening occupancy and necessary budgets. |
| Solver/replay implementation | Committed as `0ecb883`; 47 new tests and the full 8,335-test suite pass. |
| Registered targeted search and replay | Frozen at 16:55:15.064 UTC; all thirty-six invocations finished, including thirteen interrupted timed traces. |
| Outcomes | No full mastery candidate; all nine untimed replays valid and complete; five of eighteen timed replays complete, none with a primary win. |
| Durable archive | [Complete and independently verified](benchmarks/2026-10-07-targeted/README.md): all 297 member hashes match; both analysis files reproduce byte for byte from archived inputs. |
