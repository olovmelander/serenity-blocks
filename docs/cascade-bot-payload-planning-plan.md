# Cascade Bot — I-Payload Tower Planning Plan

> **✅ IMPLEMENTED + VALIDATED (2026-06-09).** Added a second latent trigger probe —
> `probeRowCompletion` in [`latent-chain.js`](../src/core/ai/latent-chain.js) — alongside the existing
> well-drop probe: it completes the lowest **top-reachable** near-full row (gaps with a clear column
> above; sealed/capped gaps are excluded so we never re-validate an unfireable trap) via the new
> `simulateCellFill` in [`cascade-simulator.js`](../src/core/ai/cascade-simulator.js), and takes the max
> discharge over both probes. The controller ([`puzzle-bot-controller.js`](../src/core/ai/puzzle-bot-controller.js))
> now derives `machineLoaded` from a high latent discharge and extends "don't fire a loaded machine for
> a small clear" to it. Headroom is handled by the existing pressure-scaled setup reward + danger gate
> (no new knob; verified 0 top-outs).
>
> **Clean A/B (identical seeds, only the new probe toggled):** avg buried holes **7.04 → 5.15 (−27%)**,
> avg max height 10.58 → 9.82, attack sent (Σ3 seeds) 111 → 122 **(+10%)**, cascades 34 → 44 **(+29%)**,
> **survival singles 24 → 11 (−54%)**, max cascade depth 6 → 7, **top-outs 0 → 0**. Full suite
> **332/332 green** (+2 latent regression tests: row-completion fires; sealed/capped trigger stays 0),
> AI lint clean. Validated with `scripts/diagnose-cascade-bot.mjs` + `scripts/verify-cascade-live.mjs`.
> Net: cleaner board + far fewer desperation singles + more/deeper cascades = more cascade-style play.
>
> **Status:** plan → implemented + validated per the above.
>
> **Goal (your photo):** the bot should deliberately **build a tall vertical-I "payload" column**
> while filling the rest of the field nearly full, then **clear a low row** so the I-tower cascades
> down the opening into one big multi-line clear (place the orange piece → row clears → cascade).
> Today's bot fires cascades but does **not plan this specific "build-tall, fire-low" machine.**

---

## 1. Investigation — the precise gap

The bot's "value an in-progress machine" signal is `estimateLatentDischarge`
([latent-chain.js:80-103](../src/core/ai/latent-chain.js#L80-L103)). It models **exactly one trigger
shape**: *drop a vertical I straight down an edge **well** column* (`verticalLandingTop` →
`simulatePlacement`). That captures the **empty-well** machine (col is empty, you drop one I to fill
it + complete rows).

The photo is the **opposite shape**: the edge/payload column is **full** (a tall stack of vertical
I-pieces), and the trigger is **completing a low near-full row** so the whole tower drops into the
opening. The latent probe drops an I onto the *top* of the already-full column → it lands high →
clears nothing → reports **0**.

**Empirical confirmation** (photo-style board: 12-high I-tower in col 0, field built 6 rows, bottom
row missing one cell):
- **`estimateLatentDischarge` → latentDepth 0, attack 0** (the bot sees *no value* in having built
  the tower).
- **Actual trigger** (fill the missing cell → real cascade sim) → **6 lines, attack 5.**

So the bot has **no signal to build the photo's machine** — it only "sees" empty-well machines.
That's why it doesn't stack I-payload towers and hold for a big low-row trigger. Everything
downstream (it fires Tetris+ via the GO override, garbage already carries the right color, cleanliness
is good after the last pass) is fine — the missing piece is the **planning signal for the build-tall,
fire-low machine.**

> Note the prior, hard-won guardrails still apply: **don't** add blunt hand bonuses for "tall" or
> "stack I's" — that re-introduces holes/mess (we proved this). Drive the behavior from the
> **simulated discharge** (latent), which only rewards a tall structure when it actually yields a big
> clear. Keep the cavity penalty + setup-bonus balance from the last pass intact.

---

## 2. The fix — teach the latent model the "fire-low" trigger

### 2a. Add a row-completion trigger probe to `estimateLatentDischarge` (core change)
Alongside the existing "drop-I-into-well" probe, add a **"complete the lowest near-full row" probe**:
- Find the **lowest 1-3 rows** that are *almost full* (missing 1-3 cells).
- For each, hypothetically **fill the missing cells** (a synthetic locked segment at those exact
  empty cells) and run `simulatePlacement`/the cascade resolver.
- Take the **max discharge** over both probe types (well-drop *and* row-completion).

This makes the photo's machine light up: a tall I-payload over near-full rows now reports a large
`latentDepth`/`latentAttack`, so the evaluator rewards *building toward it* — stacking the I-tower and
filling the field — because the simulation shows the payoff. It generalizes beyond I-towers: any
"build-tall + clear-low → cascade" structure is now valued.
- **Bounded cost:** cap at the lowest ~3 near-full rows; reuse `simulatePlacement` on a clone (same as
  today). Gate as now (only run when there's a near-full row / ready lane).
- **`hasTrigger`:** a near-full row is completable by almost any piece, so confidence is high when a
  reachable piece can fill the gap (current piece or the 3-preview); decay otherwise (as today).

### 2b. Hold-and-fire the big machine (don't waste it)
With a high `latentDepth` visible, the bot should keep building rather than cash a small clear, then
fire the **big low-row trigger**:
- Extend the existing "don't detonate a loaded machine for a small partial clear" rule
  (`PuzzleBotController.chooseSelection` / `applyTacticalBias`) so it triggers on **high latentDepth**,
  not only on a capped side-lane being `triggerReady`. I.e. when `latentDepth >= triggerDepthTarget`,
  treat the machine as "loaded": prefer the placement that fires the full cascade, and penalize a
  placement that clears only 1-2 lines and **destroys the near-full structure**.
- The GO override already fires Tetris-or-better / perfect-clear; ensure the **row-completing fire**
  is recognized as the discharge (it is — it produces the big `totalLines`).

### 2c. Safety — build tall without topping out
A tall I-payload + near-full field is high, so the **danger gate** must still bound it
(`dangerSpareRows`). Add a guard so the latent reward is **discounted when there isn't headroom to
hold the payload until a trigger is reachable** (don't build a 12-high tower on our short 24-row board
if it risks topping out before an I/trigger arrives). This is the same build-vs-survive balance we
tuned; the new payload machines lean taller, so re-verify the danger gate holds.

### 2d. (Optional, only if 2a is insufficient) nudge payload construction
If empirically the bot still won't *start* the tower, add a **small** latent-scaled reward for a
vertical-I placement that **extends a payload column when near-full rows exist beneath it** — gated on
the latent discharge being positive, so it never rewards aimless I-stacking. Prefer to rely on 2a
first (latent-driven), per the "no blunt bonuses" lesson.

### 2e. Difficulty gating
Higher tiers build deeper payload machines: `triggerDepthTarget` already scales (mid→6, lower→4), and
`latentChainEval` is on for tiers ≥4. Top tiers should hold for the biggest cascades; low tiers fire
sooner (believable). No new knobs needed — reuse the per-tier ones.

---

## 3. Validation (use the existing harnesses)
- **`scripts/verify-cascade-live.mjs`** (real-engine): expect **higher max cascade depth + more
  big-5/big-6 cascades + more attack/game**, with **0 top-outs** maintained. This is the headline
  metric — bigger single-piece clears like the photo.
- **`scripts/diagnose-cascade-bot.mjs`** (board quality): **avg buried holes must not regress** (stay
  ~6, not climb back toward 11) and **avg max height** must stay survivable (the danger gate working).
- **Targeted unit probe:** the photo-style board's `estimateLatentDischarge` should now report a large
  `latentDepth` (≈ the actual 6-line discharge), where it reports 0 today. Add as a regression test.
- **Guard:** if the change raises holes or top-outs (over-building tall), tighten the headroom guard
  (2c) / latent weight — iterate on the harness numbers, keep only net wins (same method as last pass).

## 4. Risks
- **Top-out from over-building** — the main risk; the headroom-gated latent + danger gate must
  contain it. Re-run the 12-seed sweep.
- **Cost** — the extra probe is bounded (≤3 rows, cloned sim); negligible vs the depth-2 lookahead.
- **Don't regress cleanliness** — keep the cavity penalty + setup-bonus balance from the last pass;
  the new reward is discharge-driven (only pays off for structures that actually fire big).
- **Single source of truth** — the new probe lives in `latent-chain.js` (used by the evaluator
  everywhere), so it benefits both the open-well and payload-tower machines uniformly.

## 5. Implementation phases
1. **Latent probe (2a):** add the row-completion trigger to `estimateLatentDischarge`; add the unit
   regression (photo board → large latentDepth).
2. **Hold/fire (2b):** extend the "loaded machine" recognition + don't-fire-small to high latentDepth.
3. **Safety (2c):** headroom-gate the latent reward; re-run the 12-seed sweep (depth↑, holes flat,
   top-outs 0).
4. **Iterate (2d if needed):** light payload-extension nudge only if the bot won't start the tower.
5. **Tune + lock:** keep only harness-validated net improvements; update the plan doc + memory.
