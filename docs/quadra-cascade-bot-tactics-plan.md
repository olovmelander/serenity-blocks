# Quadra Cascade Bot Tactics — Improved Plan

> **✅ IMPLEMENTED (2026-06-07).** All phases below shipped in `src/core/ai/`. Highlights:
> Phase 0 wired `side-cascade-analyzer.js` into the live evaluator and deleted the duplicate inline
> lane code; the simulator now emits `projectedAttack`. Phase 1 added the latent-chain
> (`latent-chain.js`, hypothetical-trigger) probe + a value/reward split driven by the real
> `garbage.js`/`scoring.js` formulas + protected-hole exemption + firing-move scoring, plus an
> **anti-trap gate** (`fireScale`) that discounts a machine that *looks* loaded but can't actually
> discharge — the fix that stops the bot building sealed wells. Phase 2 added the persistent
> `machinePlan` + a build-vs-fire **GO override** in `puzzle-bot-controller.js`. Phases 3-4 added
> S/Z staircase scoring, clean-route bias, and the danger gate. Difficulty knobs are derived per-tier
> in `bot-difficulty.js`. Tests: `cascade-tactics.test.js` (16) + `bot-ai.test.js` (15), full suite
> 321/321 green, lint clean. A tier-10 bot now caps/loads a lane, **fires** a ≥4-line / perfect-clear
> cascade when the trigger is in hand, and downstacks under the danger gate.
>
> **Scope/tuning notes from implementation:**
> - Lookahead depth was kept at the existing max of 2 (not bumped to 3): depth-3 pushed tier-10
>   `plan()` to ~79ms/spawn; the persistent plan + GO override deliver the multi-piece behavior at
>   depth 2 (~36ms). The latent probe is skipped inside lookahead plies (top-level only) for cost.
> - The `triggerDepthTarget` GO threshold is overridden by a "fire any Tetris-or-better / perfect
>   clear" rule, since those are always strong in a no-hold game; triples/doubles are held to build
>   bigger. Monte-Carlo queue sampling (§4.3, optional) was not implemented.
>
> **✅ CASCADE-QUALITY TUNING PASS (2026-06-07, deeper research + empirical).** A second research
> workflow (advanced cascade construction, cascade-bot eval features, common mistakes) + two diagnosis
> agents + adversarial verification, combined with a new real-engine harness, found the bot was
> *firing* cascades but stacking dirtily — **avg ~11 buried holes/board** (up to 27), riding to
> height ~12, grinding survival singles. Root cause (confirmed): the large setup/shape bonuses
> out-priced the single undifferentiated hole penalty ~10:1, and the convex height model made burying
> a hole cheaper than adding height. Guardrails from *refuted* claims: do **not** add a blanket
> flat/low reward or 4-wide residual-hole discipline — the cascade machine needs lumpy stepped/capped
> geometry. Fixes shipped (all in `board-evaluator.js`):
> 1. **Cavity/overhang hole split** — `measureBoard` now classifies covered cells as enclosed
>    *cavities* vs side-accessible *overhangs*; a strong base penalty on all non-protected holes
>    (`coveredHole -8.5`) plus a cavity surcharge (`cavityCells -7`); the protected cascade lane stays
>    exempt so the machine isn't punished. (First attempt — cheap overhangs à la Cold Clear — *backfired*
>    because our non-protected overhangs are damage, not combo fuel; corrected to penalize all damage.)
> 2. **Cut the oversized setup bonuses** that out-priced holes (`sideLaneIPlacementBonus 46→24`,
>    `Bridge 38→20`, `Platform 30→16`, `Stopper 26→14`; `setupGrowth 7.5→3` + clamp; `noClearSetupBonus
>    12→6`). Firing bonus kept (doesn't bury).
> 3. **Decoupled surface-cleanliness from `comboAggression`** (`surfaceScale = max(0.85, cleanupScale)`
>    on transitions + bumpiness) so a jagged surface — which manufactures overhangs→holes — isn't
>    discounted at high aggression.
>
> **Empirically validated across 12 seeds × 180 pieces, tier 10** (`scripts/diagnose-cascade-bot.mjs`
> + `scripts/verify-cascade-live.mjs`): avgHoles **11.3 → 6.0 (−47%)**, attack/game **32.4 → 39.8
> (+23%)**, Tetris+/game **5.3 → 7.9 (+49%)**, big-5 cascades **17 → 30 (+76%)**, singles/game
> **13.4 → 7.3 (−45%)**, avg cascade depth 3.18 → 3.49, **0 top-outs throughout**. Tests: full suite
> 324/324 green (added a cavity/overhang regression test). Note: the earlier "hold to build bigger
> when safe" idea was empirically *refuted* (it floods the board → more singles) and reverted; the
> cleanliness fix is what actually raised cascade output. Cleaner board → bot fires more/bigger
> cascades instead of grinding survival singles.
>
> **Scope.** This extends [`docs/local-multiplayer-bot-ai-plan.md`](local-multiplayer-bot-ai-plan.md)
> (the original local-bot framework, now implemented under `src/core/ai/`). That plan got the bot
> *building* on the edge. This plan teaches the bot to run the full **Quadra cascade machine**:
> reserve a lane → cap it → load payload → fire one piece → recursive gravity clears many lines.
> The headline change is architectural, not just "bigger weights": the bot must (1) score an
> *unfired, in‑progress* machine by **simulating its discharge** (latent‑chain evaluation), and
> (2) **commit to a multi‑piece plan** across spawns instead of re‑planning each piece greedily.
>
> **Status of prior work.** `side-cascade-analyzer.js` exists but is **orphaned dead code** — nothing
> imports it. The live path uses cruder inline logic in `board-evaluator.js`. Phase 0 fixes that.
>
> **Research basis.** All mechanics/strategy claims below were web‑researched and adversarially
> verified (Quadra FAQ/wikis, cascade‑gravity strategy, Puyo/Cold‑Clear/ama AI literature) and
> cross‑checked against the local Quadra C++ reference (`C:/Users/olovm/repositories/quadra`,
> LGPL‑2.1 — **behavior reference only, no code copied**). Sources are listed at the end.

---

## 1. Why the bot only builds an empty edge column today

The symptom — "the bot just builds the empty edge lane, never caps/loads/fires it" — traces to four
concrete causes in the current code:

1. **No persistent plan.** [`PuzzleBotController`](../src/core/ai/puzzle-bot-controller.js#L103-L158)
   re‑plans from scratch on every spawn (`update()` nulls `lastPlan` when the spawn token changes,
   `puzzle-bot-controller.js:142-148`). There is no `machinePlan`/`buildPhase`/`targetLane` state that
   survives a piece. Continuity is *emergent* — the heuristic happens to like the same lane shape
   again — so a half‑built machine is abandoned the instant any other placement scores marginally
   higher that frame. **This is the crux.**

2. **The plan it computes is thrown away.** `applyLookahead` already builds a multi‑piece line and
   stores it as `candidate.futurePlan` / `nextCandidate`
   ([puzzle-bot-controller.js:243-244](../src/core/ai/puzzle-bot-controller.js#L243-L244)), but
   `plan()` only queues `selected.actions` for the **current** piece and discards the rest
   ([puzzle-bot-controller.js:160-179](../src/core/ai/puzzle-bot-controller.js#L160-L179)).

3. **Lookahead is too shallow and prunes the machine's first step.** Depth is `0–2`
   ([bot-difficulty.js:13-140](../src/core/ai/bot-difficulty.js#L13-L140)); each ply expands only
   the 2–4 candidates already top‑ranked by the **single‑piece** heuristic
   ([puzzle-bot-controller.js:296-299](../src/core/ai/puzzle-bot-controller.js#L296-L299)). The
   correct first move of a 4–7‑piece machine scores low *now*, so it is pruned before its payoff is
   ever simulated. A side‑cascade machine is ~4–7 pieces deep; depth‑2 beam cannot see it.

4. **The evaluator scores only the *realized* board.** `evaluateCandidate`
   ([board-evaluator.js:689-840](../src/core/ai/board-evaluator.js#L689-L840)) rewards lane *shape*
   (`sideLanePotential/Stopper/Trigger/IPayload`) but never asks **"if I fired this machine right now,
   how many lines would cascade out?"** Two boards with identical surfaces can have wildly different
   *latent* chains. Without a discharge simulation, "an in‑progress machine" and "board damage" look
   the same to the score. This is the exact failure mode that separates weak greedy block‑game bots
   from Puyo chain‑search / Cold‑Clear (see §4).

Secondary gaps that make the lane heuristics misfire:

- **Dead richer analyzer.** [`side-cascade-analyzer.js`](../src/core/ai/side-cascade-analyzer.js) models
  a real lane FSM (`needsPlatform → platformReady → payloadLoaded → triggerReady`, plus `unsafe`),
  `capSupported` (a cap with *real* support under it), protected‑hole accounting, and a *firing‑move*
  score — and **none of it runs**. The live `measureSideCascadeLanes`
  ([board-evaluator.js:377-463](../src/core/ai/board-evaluator.js#L377-L463)) uses column‑height
  heuristics that can reward an *open well with no overhang* — the opposite of a real machine.
- **Intentional wells get punished.** The generic `measureBoard` penalizes the deep side well as
  holes/wells/transitions (`DELLACHERIE_WEIGHTS.holes=-7.9`, `wellSums`, `CASCADE_ADAPTATION.rowsWithHoles=-5.4`)
  with no offsetting credit, because the analyzer's `protectedLane*` exemptions are never wired in.
- **No outgoing‑attack estimate.** `simulatePlacement`
  ([cascade-simulator.js:269-300](../src/core/ai/cascade-simulator.js#L269-L300)) produces
  `totalLines`, `cascadeCount`, `perfectClear`, `waves[]` — but never the `depth−1 + cleanBonus`
  garbage the placement would *send* (the real competitive objective; see §6).
- **No trigger‑timing.** Nothing decides *when* to fire vs keep loading; `accidentalTriggerPenalty`
  only softly discourages early clears.

---

## 2. Verified mechanics (the behavior model the bot must match)

Each item was confirmed against primary sources unless flagged. These are *facts about the game we
ship*, cross‑checked against Quadra.

| # | Fact | Verdict | Why it matters to the bot |
|---|------|---------|---------------------------|
| M1 | **Recursive (cascade) gravity**: after a clear, loose blocks fall until stuck, which can complete new lines → clear → fall, recursively until stable. One well‑built piece can clear **15+ lines**; realistic targets are **9‑** and **13‑liners**. | confirmed | The whole point. Score the *full chain*, not the immediate clear. |
| M2 | **Piece‑ID cascade, NOT color‑sticky.** `physics.js findConnectedComponents` groups cells by `cellData.id` (the locked piece), not by color or adjacency. Each original tetromino falls as one rigid segment; two same‑color pieces do **not** merge. | confirmed (verified in code, [physics.js:71-146](../src/core/physics.js#L71-L146)) | Chains are driven by **whole‑piece geometry** (where a piece drops into a gap), never by color matching. Puyo *color* tactics don't transfer; Puyo *shape/sequencing* tactics do. |
| M3 | **Attack = total lines, not chain count.** Garbage sent `= max(0, depth−1)`; clean bonus `= floor((1+depth)/2)` and **bypasses handicap**. Score: `200·depth²` (>4 lines) + `200·(complexity−1)²` + clean bonus. | confirmed (verified in code: [garbage.js:441-487](../src/core/garbage.js#L441-L487), [scoring.js:11-50](../src/core/scoring.js#L11-L50)) | **Depth (total lines per trigger) is the dominant lever** for both attack and score. Complexity/clean are secondary multipliers. The bot must optimize *depth first*. (Note: our current evaluator over‑indexes on `cascadeCount` relative to `totalLines` — see §5.4.) |
| M4 | **Build the platform over the far edge column EARLY** (build the *second‑to‑last* column as support; base piece → I → cap), and **stack duplicate I‑pieces above the platform while stacking**, not after. | confirmed | The canonical Quadra opener. Bias the bot to commit a lane early and bank I‑pieces into the payload during construction. |
| M5 | **Cap intentional well depth at ~10 rows.** | partially confirmed (quote real; original *rationale* misattributed) | Keep enough room **above the platform to stack several I payload pieces**; a too‑deep naked well also risks top‑out and breaks per‑row chain timing. Treat `openDepth > 10` as `unsafe` (the analyzer already does). Frame it as *machine‑viability*, not "I‑drought survival". |
| M6 | **No hold; 3‑piece preview.** | confirmed | Plan = current piece + ≤3 lookahead, **no reordering/deferral**. Cap committed multi‑piece plans at the visible queue; everything beyond is a *prediction*, not a guarantee. |
| M7 | **Board is 10×20 visible.** Quadra is 10×32 internal (12 hidden rows); **ours is 10×24** (`ROWS=20`, `HIDDEN_ROWS=4`). | confirmed (ours verified in `constants.js`) | We have **less hidden headroom than Quadra** — the payload tower can't be built as tall. The depth cap (M5) and danger gate (§6) matter more here than in original Quadra. |
| M8 | Quadra rotation is wallkick‑less left‑handed NRS, fire‑on‑key‑up, no lock delay, ARE‑like line‑clear delay. | confirmed (for Quadra) | **Fidelity check, not a copy target:** the bot's reachability must match *Serenity's actual* rotation/kick rules ([reachability-pathfinder.js](../src/core/ai/reachability-pathfinder.js)), whatever they are — never plan a placement the live game can't reach. Verify our kick behavior vs the pathfinder's. |

> **Caveat carried from research:** `harddrop.com` / `tetris.wiki` block direct fetches (HTTP 403);
> wiki quotes were recovered via search snippets + the read proxy and cross‑checked, while
> `roncli.com` (the maintainer's official site) and the local C++ source were read directly. The M5
> rationale was the one claim downgraded to *uncertain* — keep the 10‑row cap, drop the
> "I‑drought death" reasoning.

---

## 3. The expanded tactic catalog

The original plan covered one tactic (the side‑lane machine) as scoring bonuses. This catalog adds
the staircase family, sequencing discipline, and the clean route — and, critically, frames each as
something the **planner commits to**, not just a per‑board bonus.

### T1 — Side‑well cascade machine (primary)
The canonical build. Anatomy, in the analyzer's own vocabulary:
- **Well**: one edge column (col `0` or `COLS-1`) kept empty, **exactly 1 wide**.
- **Cap / overhang** (`capY`): a filled cell bridging the top of the well, **supported by inner
  columns** in the same row (`capSupported` requires a same‑row inner cell *and* a cell beneath it).
- **Payload**: filled cells in the edge column **above** the cap — ideally vertical/stacked **I**.
- **Trigger rows**: rows **below** the cap that are full **except** the well column (missing 1–3
  cells, staggered — see T3).

Firing one piece into the well completes the bottom trigger row → it clears → the cap loses support →
the payload falls into the well → completes the next row → clears → recursion descends the stack.
Maps to `platformReady → payloadLoaded → triggerReady` in
[`side-cascade-analyzer.js`](../src/core/ai/side-cascade-analyzer.js#L235-L322).

### T2 — Homogeneous S (or Z) diagonal staircase
Stacking **only‑S or only‑Z** builds a continuous diagonal wall with single‑cell trigger holes; one
bottom clear drops the next offset piece to complete the row above, chaining diagonally (~9 stages in
Tetris Worlds). **Do not alternate S/Z** — each switch flips the offset, *merges* what would have
been separate cascade stages into one multi‑line wave, and **reduces chain count** (lines cleared
stay equal). Use when the queue feeds repeated S or repeated Z, or as a no‑I alternative to T1.
*New tactic — not modeled at all today.*

### T3 — Multi‑trigger staggering ("don't fire the machine in one flat wave")
For the chain to descend stage‑by‑stage, **exactly one trigger row may be one‑cell‑from‑full at a
time**. If two upper rows are simultaneously completable through the same well, they clear in **one
wave** → fewer cascade stages → less complexity bonus (and, under chain‑reward variants, far less).
Stagger trigger rows so each becomes completable only *after* the payload from the row below lands.

### T4 — Don't bury your trigger (Puyo 3‑1 rule)
Place the **trigger piece last**, at the **accessible end** of the machine, within ~3 rows of the
supported group. If the bottom trigger row gets filled early (no remaining gap) or the well column is
plugged, the machine can't start — it's just a permanent hole. The planner must *reserve* the trigger
gap until fire time.

### T5 — Well discipline (width / depth / cap)
Maintenance, not a one‑time move: keep the well **1‑wide** (a >1‑wide well lets the payload tilt and
only partially fill trigger rows → chain dies mid‑stack), **capped** (a naked uncapped well just
collects pieces without chaining), and **≤10 open rows** deep (M5). The analyzer already flags
`openDepth>10` `unsafe` and applies `overdeepPenalty` — wire it in.

### T6 — Clean / perfect‑clear route (highest‑value finish)
A cascade that empties the board adds `floor((1+depth)/2)` garbage **that bypasses handicap** and a
large score bonus. When a setup can finish clean — especially as the stronger/handicapped player or
in a 5+‑player crowd match where normal lines are taxed — **prefer the clean route** even at the cost
of a little raw depth. *New emphasis — clean is currently only a flat `perfectClear=+70`.*

### T7 — General stacking discipline (the substrate all machines sit on)
From competitive stacking theory ("parity management"): keep the non‑well field **flat, undivided,
low‑cavity**; push bumps to edges; spin L/J/S/Z into notches rather than laying them flat in the
middle; reserve the well at the **side** (or a single chosen column), never bisecting the field. This
is what the Dellacherie surface terms already approximate — the new work is to **exempt the
intentional well** from those penalties (§5.3) so discipline elsewhere isn't bought by punishing the
machine.

---

## 4. Architecture — what actually has to change

The tactics above are unreachable with greedy per‑piece search. Three architectural pieces, ordered
by leverage. **The first two are the difference between "builds a lane" and "runs the machine."**

### 4.1 Latent‑chain (hypothetical‑trigger) evaluation — *the headline feature*
**Score a partial machine by simulating its discharge, not by its static surface.** This single idea
is what makes Puyo chain‑search (Ikeda et al., avg chain 11) and ama's "chain detection/extension"
able to deliberately build machines, where surface‑only bots (meatfighter) cannot.

For a candidate board (current piece placed, *before* committing), the evaluator computes a
`latentChain` feature:

```
for each side lane that is platformReady or payloadLoaded:
    for each plausible trigger piece reachable in {current?, next-3 preview}:
        drop it into the well's trigger column   // reuse simulatePlacement
        record (depth, complexity, perfectClear)  // the discharge it WOULD produce
latentDepth     = max depth over all hypotheticals
latentComplexity= complexity of that best discharge
latentAttack    = max(0, latentDepth - 1) + (perfectClear ? floor((1+latentDepth)/2) : 0)
```

- Add `latentDepth/latentAttack` as a **value** feature (see 4.2) so an unfired machine that *could*
  discharge 9 lines outscores flat damage with identical surface metrics.
- **Decay by trigger availability:** if no suitable trigger piece is in the current piece + 3‑preview
  (M6), multiply the latent reward down — the machine is only "potential," and a no‑hold game can't
  guarantee the trigger arrives. This keeps the bot from building a machine it can't fire.
- Reuse the existing `simulatePlacement` ([cascade-simulator.js:269](../src/core/ai/cascade-simulator.js#L269))
  for the hypothetical drop — no new physics. Cache by board hash (the planner already hashes boards,
  `boardCacheKey`).

### 4.2 Value + Reward split evaluation (drive Reward from the *real* formulas)
Adopt the Cold‑Clear structure: score every node as **`V(board) + Σ R(events on the path)`**.

- **Value** `V` — transient quality of the *current* surface: Dellacherie terms + height/bumpiness +
  holes split into `cavity`/`overhang`/`covered` + **well_depth reward (capped)** + the **latent‑chain
  feature (4.1)** + protected‑hole exemption (§5.3). This is what lets a deep, clean, capped well +
  loaded payload score *high before any line clears*, so best‑first search keeps growing it.
- **Reward** `R` — realized events along the path, **computed from the shipped formulas** rather than
  guessed weights: `projectedScore = calculateQuadraLineScore(depth, level, complexity, perfectClear)`
  and `projectedAttack = max(0, depth-1) + cleanBonus`. **Penalize singles/doubles** (a positive
  small‑clear reward makes best‑first cash the machine prematurely — Cold Clear makes
  clear1/2/3 *negative* and only clear4+/clean positive). Reward big depth and clean disproportionately.

Why drive Reward from `garbage.js`/`scoring.js` instead of `CASCADE_ADAPTATION_WEIGHTS.cascadeDepth=24`
+ `COMBO_CASCADE_WEIGHTS.cascadeChainDepthMultiplier=38`? Because those hand weights currently make
the bot optimize **chain count**, while the game pays for **total lines** (M3). The simulator already
returns `totalLines`, `cascadeCount`, `perfectClear` — feed them through the real functions and the
bot optimizes the true objective.

### 4.3 Persistent machine plan + build‑vs‑fire controller
Decouple **construction** (the search) from the **discharge decision** (a small controller), and make
the plan survive across pieces.

- **`machinePlan` state on `PuzzleBotController`** (new fields in the constructor,
  `puzzle-bot-controller.js:104-114`; lifecycle in `reset()` and `update()`):
  ```
  machinePlan = { phase, targetLane, payloadGoal, triggerColumn, committedAt, pieceSequence }
  phase ∈ { none, buildSupport, capLane, loadPayload, holdForTrigger, fire, abort }
  ```
- **Commit, don't re‑derive.** When a candidate's `futurePlan`/`nextCandidate`
  (`puzzle-bot-controller.js:243-244`, currently discarded) describes a coherent machine line, store
  it. On the next spawn, **first check whether the committed plan still applies** to the new board; if
  so, advance its next step instead of full re‑planning. Add a **plan‑adherence bonus** in
  `evaluateCandidate` that rewards placements which advance the committed machine and penalizes
  abandoning a near‑complete one (prevents the "marginally‑better placement steals the frame" churn).
- **Build‑vs‑fire controller** drives the `phase` transitions and the actual trigger:
  - `holdForTrigger → fire` only when the **GO threshold** (§6) is met: `latentDepth ≥ targetDepth`
    (e.g. ≥6, or board goes clean), **and** safe spare rows exist, **and** a trigger piece is in hand
    or preview.
  - `→ abort` when `unsafe` (well too deep / cap near ceiling) or the danger gate trips (§6): tear
    down gracefully — clear into the machine to lower the stack rather than topping out.
- **Search depth to the queue limit.** Raise `lookaheadDepth` toward **3** at high tiers (current
  piece + 3 preview = the full no‑hold horizon, M6), and **carry the whole best line** out of
  `evaluateFuture` (it already returns `{candidate, child, depth, score}` — reconstruct the chain).
  Widen the beam enough that a low‑immediate‑score *first machine step* survives pruning: bias
  retention by `V` including the latent‑chain feature, not by immediate clears.
- **Transposition + Monte‑Carlo tail (high tiers, optional).** Dedupe boards reached by different
  piece orders (a transposition cache keyed on the board hash the planner already computes), and for
  the unknown queue tail sample plausible next pieces and average — robustness against the randomizer
  delivering something other than the assumed trigger. Use quiescence (extend search through an
  about‑to‑discharge position) to avoid the horizon effect of "build right up to the depth limit then
  look stuck."

---

## 5. Wiring & evaluator changes (concrete edits)

### 5.0 Phase 0 — kill the duplication (do this first)
Decide the canonical lane module and delete the loser. Recommended: **promote
`side-cascade-analyzer.js`** (it has `capSupported`, the FSM, protected holes, and a firing‑move
score) and **retire** the inline `measureSideCascadeLanes` / `measureCandidateSideLaneAction` in
`board-evaluator.js`.
- Import `analyzeSideCascade` + `classifySideCascadePlacement` into `board-evaluator.js`; map their
  fields onto `COMBO_CASCADE_WEIGHTS`; add missing weight entries for
  `sideLanePlatformScore`, `sideLanePlatformPlacementScore`, `sideLaneTriggerPlacementScore`,
  and the `protectedLane*` exemptions.
- Export both from [`index.js`](../src/core/ai/index.js).
- This removes the maintenance trap where editing the analyzer changes nothing at runtime.

### 5.1 Verify the cap is real
Replace height‑gap lane detection with the analyzer's `capSupported` geometry: an `edge` cell with
**empty space below** *and* an adjacent inner support cell holding it up. Stop rewarding open wells
with no overhang.

### 5.2 Add a firing‑move term
`classifySideCascadePlacement` already scores the trigger fire (gated on `totalLines>0` with
`openDepth` shrinking or `cascadeCount>1`). Wire `sideLaneTriggerPlacementScore` into
`evaluateCandidate` so the *detonating* placement is rewarded, not just the setup placements.

### 5.3 Protected‑hole exemption (stop punishing the intentional well)
Subtract the analyzer's `protectedLaneHoleCells / protectedLaneWellSums / protectedLaneRows` (cells in
a *capped, supported* lane) from the generic `holes` / `wellSums` / `rowsWithHoles` penalties in
`measureBoard`'s contribution to the score. The well is intentional damage; only *unprotected*
holes/wells should be penalized.

### 5.4 Rebalance toward depth (M3)
Replace the hand `cascadeDepth`/`cascadeChainDepthMultiplier` reward with `R` computed from
`scoring.js`/`garbage.js` (4.2). Keep a *small* complexity term (matches the real `200·(complexity−1)²`
score bonus) but make **total lines** the dominant reward.

### 5.5 Simulator: emit projected attack
In `simulatePlacement` ([cascade-simulator.js:287-299](../src/core/ai/cascade-simulator.js#L287-L299))
add `projectedAttack = max(0, totalLines-1) + (perfectClear ? floor((1+totalLines)/2) : 0)` and
optionally `projectedScore`. Tiny change; it's the competitive objective and feeds both `R` and the
GO threshold.

### 5.6 S/Z staircase recognition (T2)
Add a surface feature that scores a sustained homogeneous descending staircase across inner columns
(distinct from `verticalStepMatch`, which only matches the next 1–3 queued shapes). Reward keeping the
staircase **homogeneous**; penalize an S↔Z alternation that would merge stages (T3).

---

## 6. Multiplayer attack‑economy decision layer

Build/fire is not just a board‑quality question; it's an economic one. Add a thin policy on top of the
evaluator (most relevant at tiers ≥5, gated by `comboAggression`/`survivalInstinct`).

- **Survival‑first danger gate.** Spare rows `= visibleTop − highestOccupiedRow`, minus **pending
  incoming garbage** (each pending row = −1 headroom; garbage inserts from the *bottom* and shoves the
  stack up). Above a danger threshold (e.g. spare < 6): **abandon building**, downstack/counter.
  Multiply the machine's offensive value by a factor decaying to 0 as spare rows shrink. (Downstacking
  is ~10× cheaper per row than manufacturing offense, so defense wins the throughput race when buried.)
- **Cascade GO threshold.** Fire the big cascade only when `latentDepth ≥ ~6` *or* it goes clean;
  below that a triple/quad is more efficient (Single≈0, Double 0.2, Triple 0.27, Tetris 0.4
  garbage/piece; combos overtake a Tetris around chain 7). `Value(fire) = max(0, sent − opponentCanCancel)`.
- **Counter‑synchronization (defensive cascade).** Garbage travels with delay and sits in a pending
  queue; an outgoing clear subtracts from pending *before* net rows are added. Time a cascade to land
  just before insertion to **cancel** an incoming wave — often higher‑EV than pure offense under
  pressure. Keep one tucked completable line as a "counter trigger" while building.
- **Clean route under handicap (T6).** Clean attacks bypass the stamp handicap and crowd handicap, so
  when you out‑rank opponents or there are 5+ alive players, weight the board‑clear finish much higher.
- **FFA target focus.** Frag credit goes to the top attacker on a dying opponent, and attack points
  decay as the receiver places pieces. **Concentrate** a surge/big cascade on one already‑pressured
  target rather than spreading chip damage.
- **Blind/Full‑Blind are tempo, not rows.** They obscure vision, add no lines — near‑worthless on
  defense vs a perfect‑information bot; on offense, value only vs vision‑reliant (human) opponents.

These map onto existing knobs: `pressureRatio`, `survivalInstinct`, `comboAggression` in
`evaluateCandidate`, plus the new `machinePlan.phase` gate.

---

## 7. Difficulty integration

Keep difficulty **data‑only** ([bot-difficulty.js](../src/core/ai/bot-difficulty.js)). New per‑tier knobs:

| Knob | Low tiers (1–3) | Mid (4–6) | High (7–10) |
|------|-----------------|-----------|-------------|
| `cascadePlanning` (commit a `machinePlan`) | off | on | on |
| `latentChainEval` (4.1) | off | on (decayed) | on (full) |
| `lookaheadDepth` | 0–1 | 1–2 | **3** |
| `triggerDepthTarget` (GO threshold) | n/a | ~4–5 | ~6–9 |
| `planCommitment` (adherence bonus weight) | low | mid | high |
| `buildVsFire` controller | greedy clears | on | on + counter‑sync |
| `cleanRouteBias` (T6) | low | mid | high |

Low tiers stay believable by *not* running the machine (greedy survival, frequent small clears, higher
`mistakeChance`/`heuristicNoise`). Tier 10 commits, builds homogeneous staircases or side machines,
fires at the GO threshold, and counters incoming garbage.

---

## 8. Regression test matrix

Current tests ([bot-ai.test.js](../src/core/ai/bot-ai.test.js)) cover only the evaluator path with a
*left*‑lane‑only fixture set. The analyzer has **zero** tests. Add curated, screenshot‑like boards
(both edges) asserting *behavior*, not just scores:

**Machine lifecycle**
1. Naked empty edge under a tall support wall → bot **caps** it (placement plugs/bridges the lane).
2. Capped, supported platform → bot **loads** a vertical/horizontal **I payload** above the cap.
3. Payload loaded + staggered trigger rows → bot **does not** clear the trigger support early
   (preserves `holdForTrigger`).
4. Fully loaded machine + trigger piece in hand → bot **fires** (chosen placement produces
   `totalLines`≥target with `cascadeCount>1`).
5. **Plan persistence:** across a 5‑piece scripted queue the bot **stays on the same lane** and
   advances `phase`, rather than abandoning a half‑built machine for a marginal alternative.

**Tactics**
6. Repeated‑S queue → bot builds a **homogeneous** staircase; assert it does **not** alternate S/Z (T2/T3).
7. Board one piece from a **clean** cascade vs a non‑clean bigger‑depth option → bot prefers **clean** under handicap (T6).
8. Latent‑chain: two boards, identical surface metrics, different *latent* discharge → bot scores the
   higher‑latent board above (validates 4.1).

**Safety / recovery**
9. Well already **>10 deep** or cap near ceiling → bot **refuses** to deepen it / `abort`s (M5, `unsafe`).
10. **Danger gate:** stack near top‑out with incoming garbage → bot downstacks/clears instead of building (§6).
11. **Garbage in the well:** garbage row plugs the trigger column → bot **recovers** (re‑exposes the
    well or rebuilds the cap a row higher) instead of dead‑locking.

**Both edges & parity**
12. Right‑side lane fixture (all current fixtures are left‑only).
13. Both‑edges board → bot picks one lane and commits (doesn't split effort).

**Fidelity guards**
14. `simulatePlacement` projected `totalLines/cascadeCount/perfectClear/projectedAttack` matches live
    `processPhysics` on curated cascade fixtures (extend the existing simulator↔physics parity test).
15. Every committed machine placement is **reachable** by `findReachablePlacements` (no plan the live
    game can't execute, M8).

---

## 9. Tuning, telemetry, sequencing

**Telemetry to log per match** (for weight tuning): max cascade depth fired, lines sent, self‑top‑outs,
average stack height, machines built vs fired vs aborted, clean‑clear count, time‑in‑each‑phase. Tune
the `V`/`R` weights against these, not by eye.

**Sequencing**
- **Phase 0 — Consolidate.** Wire the analyzer, delete the inline duplicate, export from `index.js`,
  add `projectedAttack` to the simulator. *No behavior change beyond using the better lane model.*
- **Phase 1 — Latent‑chain + value/reward split (4.1, 4.2, 5.x).** Biggest single quality jump;
  testable purely at the evaluator level (tests 7, 8, 14).
- **Phase 2 — Persistent plan + build‑vs‑fire (4.3).** The fix for "builds but never fires." Tests
  1–5, 9.
- **Phase 3 — Tactics breadth (T2/T3/T6, 5.6).** Staircases, staggering, clean route. Tests 6, 7.
- **Phase 4 — Attack‑economy layer (§6).** Danger gate, GO threshold, counter‑sync, FFA targeting.
  Tests 10, 11.
- **Phase 5 — Depth/transposition/MC + per‑tier tuning (§7).** Widen search, dedupe, sample tail;
  soak‑test 4‑bot matches against the per‑frame budget.

**Acceptance:** a Level‑10 bot, shown a board with a naked edge lane and an I in preview, **caps the
lane, loads the I payload, holds the trigger, and fires a ≥6‑line cascade** — and, under incoming
garbage near top‑out, **abandons the build and downstacks instead of dying**.

---

## 10. Fidelity notes & open questions

- **Headroom (M7).** Our 24‑row board (4 hidden) gives less payload‑tower room than Quadra's 32. The
  ~10‑row depth cap and danger gate are therefore *more* binding here — verify `targetDepth` defaults
  against our actual board before tuning offense up.
- **Score vs attack objective (M3).** Single‑player Odyssey/Infinity care about `score`
  (`200·depth²` + complexity), multiplayer cares about `attack` (`depth−1` + clean). Both favor depth,
  but the bot's reward weighting should switch emphasis by mode (clean route matters far more in
  handicapped/crowd multiplayer).
- **Rotation reachability (M8).** Confirm `reachability-pathfinder.js` matches Serenity's live kick
  rules; a plan that assumes a kick the game won't perform will desync. (Quadra itself is wallkick‑less;
  Serenity may differ — match *Serenity*.)
- **Randomizer.** Quadra uses a plain LCG `%7` (no 7‑bag). If Serenity uses a bag randomizer, the
  Monte‑Carlo tail sampling (4.3) should model the *actual* randomizer, not assume Quadra's uniform draw.

---

## 11. Sources

**Quadra mechanics & strategy**
- https://roncli.com/quadra · https://roncli.com/quadra/faq/2/quadra-basics ·
  https://roncli.com/quadra/faq/9/playing-tips · https://roncli.com/quadra/faq/4/multiplayer ·
  https://roncli.com/quadra/faq/10/commands
- https://harddrop.com/wiki/Quadra · https://tetris.wiki/Quadra ·
  https://harddrop.com/wiki/Clearing_over_four_lines

**Cascade‑gravity strategy**
- https://tetris.wiki/Cascade_mode · https://harddrop.com/wiki/Line_clear ·
  https://harddrop.com/wiki/S_and_Z_cascade · https://harddrop.com/wiki/Tetris_Worlds ·
  https://tetrisconcept.net/threads/tetris-cascade-question.2410/ ·
  https://puyonexus.com/wiki/Patterns_1:_Stairs

**Combo setups & AI planning architecture**
- https://four.lol/stacking/4-wide/ · https://harddrop.com/wiki/4-Wide_Setups ·
  https://codemyroad.wordpress.com/2013/04/14/tetris-ai-the-near-perfect-player/ ·
  https://ar5iv.labs.arxiv.org/html/1905.01652 (Dellacherie/El‑Tetris feature set) ·
  Cold Clear evaluation: https://github.com/MinusKelvin/cold-clear ·
  https://github.com/MinusKelvin/cold-clear-2 ·
  Puyo chain‑search (Ikeda et al.): https://link.springer.com/referenceworkentry/10.1007/978-3-319-08234-9_23-1 ·
  ama (beam + MC + chain detection): https://github.com/citrus610/ama ·
  https://meatfighter.com/puyopuyoai/ (the surface‑only failure mode)

**Attack economy**
- https://tetris.wiki/Garbage · https://tetrio.wiki.gg/wiki/Mechanics ·
  https://winternebs.github.io/TETRIS-FAQ/versus/ ·
  https://www.tetrisconcept.com/2015/02/multiplayer-metrics.html

**Local reference (behavior only, LGPL‑2.1 — no code copied)**
- `C:/Users/olovm/repositories/quadra` — `source/player.cc` (cascade gravity / line detect),
  `source/canvas.cc` (`give_line` scoring + attack), `source/bloc.cc` (weld‑bit shapes),
  `source/net_list.cc` (garbage hole‑pattern mirroring + handicap).
