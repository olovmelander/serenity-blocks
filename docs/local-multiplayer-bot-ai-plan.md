# Local Multiplayer Bot AI Plan

Status: planning deliverable, no game code changes yet.

This document covers the research, license audit, architecture, difficulty matrix, and implementation plan for local AI opponents in Serenity Blocks.

## Executive Decision

Serenity Blocks already has real Quadra-style cascade gravity. This is not just a visual effect or garbage naming. The live physics loop in `src/core/physics.js` detects full lines, removes them, splits the remaining stack into connected components, applies independent gravity, then repeats line detection until the board is stable. Bot evaluation must therefore simulate the full post-lock cascade, not just classic row collapse.

The first implementation should be a local-only bot framework that controls one or more player slots in `LocalMultiplayerMode`. It should use the same movement, rotation, soft-drop, hard-drop, lock-delay, and physics callbacks as human players. The bot should not become a separate game path.

## Research And Adaptation Report

### Quadra Mechanics To Match

External sources agree on the mechanics that matter for this feature:

- Roncli's Quadra overview describes the key rule: after a line clear, blocks fall as far as they can, enabling chain reactions larger than four-line clears. It also calls out fast multiplayer play and near-immediate next-piece flow: https://roncli.com/quadra
- TetrisWiki describes Quadra as using recursive gravity, three next pieces, no hold, hard drop, and fast multiplayer play: https://tetris.wiki/Quadra
- Hard Drop's Quadra page confirms recursive gravity, no hold, hard drop, three next pieces, and the same "higher line clears" scoring emphasis: https://harddrop.com/wiki/Quadra

Local code confirms this project implements the same gameplay family:

- `src/core/physics.js` runs a recursive cascade loop. It rebuilds the board, detects full rows, clears them, splits the post-clear stack with `findConnectedComponents`, applies gravity to those components, then checks again.
- `src/core/scoring.js` uses Quadra-style scoring: base line clear values, `200 * (complexity - 1)^2` cascade bonus, perfect-clear bonus, and additive level multiplier.
- `src/core/constants.js` sets `ROWS = 20`, `HIDDEN_ROWS = 4`, three visible next canvases in local multiplayer UI, no hold system, and Quadra-derived drop intervals.

### Gold Standard Bot Models

The practical gold standard for real-time one-piece stacker play is still the Dellacherie family of linear board heuristics plus a reachability/pathfinding layer.

Pierre Dellacherie's core feature set:

```js
const DELLACHERIE_WEIGHTS = {
  landingHeight: -1,
  erodedPieceCells: 1,
  rowTransitions: -1,
  columnTransitions: -1,
  holes: -4,
  wellSums: -1,
};
```

The equivalent formula is:

```text
score =
  - landingHeight
  + erodedPieceCells
  - rowTransitions
  - columnTransitions
  - 4 * holes
  - wellSums
```

Academic survey material summarizes this Dellacherie controller as a leading one-piece controller, and lists the same six-term formula: https://citeseerx.ist.psu.edu/document?doi=1d724d4f65598a33449b710f07393f5f10157173&repid=rep1&type=pdf

El-Tetris is a tuned derivative of the Dellacherie feature family. PyPI's `pytetris` page reproduces the six features, definitions, and common El-Tetris weights:

```js
const EL_TETRIS_WEIGHTS = {
  landingHeight: -4.500158825082766,
  erodedPieceCells: 3.4181268101392694,
  rowTransitions: -3.2178882868487753,
  columnTransitions: -3.2178882868487753,
  holes: -7.899265427351652,
  wellSums: -3.3855972247263626,
};
```

Source: https://pypi.org/project/pytetris/

Note: Some mirrored El-Tetris writeups use `-9.348695305445199` for column transitions. Because sources disagree and the original article is not currently a dependable commercial code source, Serenity should standardize on the Dellacherie integer profile first, then tune against our own cascade fixtures and replay data.

Colin Fahey's Tetris AI work is useful for two design principles:

- Evaluate hypothetical resulting game states rather than individual input moves in isolation.
- Use pathfinding to determine whether a desired final placement is actually reachable by legal rotations and shifts.

Source: https://www.colinfahey.com/tetris/

Modern research also shows that Dellacherie-Thiery feature variants and policy-search methods remain competitive. The NeurIPS CBMPI paper reports strong performance using Dellacherie-Thiery features and gives optimized weights for 10x10 and 10x20 boards: https://proceedings.neurips.cc/paper/5190-approximate-dynamic-programming-finally-performs-well-in-the-game-of-tetris.pdf

### Cascade Adaptation

Classic Dellacherie evaluation scores the board after placing a piece and applying ordinary row collapse. Serenity must score the board after a full Quadra cascade resolution:

```text
candidate -> lock piece -> detect full rows
          -> clear rows
          -> split remaining cells into connected components
          -> drop each component independently until stable
          -> repeat until no full rows remain
          -> evaluate final stable board
```

The adapted scoring model should be:

```text
score =
  dellacherie(finalStableBoard, placementStats)
  + cascadeLineReward * totalCleared
  + cascadeDepthReward * sum((waveIndex - 1)^2 * waveLines)
  + cleanCanvasReward * isPerfectClear
  + attackValueReward * outgoingGarbageEstimate
  - dangerPenalty * topOutRisk(finalStableBoard)
```

Recommended initial constants:

```js
const CASCADE_ADAPTATION_WEIGHTS = {
  cascadeLineReward: 1.25,
  cascadeDepthReward: 2.5,
  cleanCanvasReward: 12,
  attackValueReward: 0.75,
  dangerPenalty: 8,
};
```

The critical change is that holes, transitions, wells, and top-out risk are measured after all cascades settle. Eroded piece cells should become cascade-aware:

```text
erodedPieceCellsCascade =
  sum over waves k of
    (clearedLines_k * contributedCells_k * cascadeDiscount^(k - 1))
```

Recommended initial `cascadeDiscount` is `1.15`, not below `1.0`, because later Quadra cascades are strategically valuable and should not be treated as delayed ordinary clears.

For the first shippable version, `contributedCells_k` should mean:

- Wave 1: number of locked-piece cells removed by the clear.
- Wave 2+: number of cells that moved during the previous gravity phase and were removed by this clear, mirroring the live `movedArray` semantics in `physics.js`.

This aligns AI scoring with the live garbage hole-mask logic instead of rewarding visually impressive but competitively weak cascades.

### Pathfinding Requirements

The bot must not teleport pieces to `(rotation, x)`. It needs a shortest legal action sequence from the spawn state to a grounded/lockable state.

The pathfinder should run BFS or uniform-cost search over this state:

```ts
type BotPieceState = {
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
  shape: number[][];
};
```

Legal transitions:

- `moveLeft`: same as `move(gameState, -1)`.
- `moveRight`: same as `move(gameState, 1)`.
- `rotateRight`, `rotateLeft`, `rotateFlip`: same kick behavior as `rotate()`.
- `softDrop`: same as `softDrop()` without locking until the search state is grounded.
- `hardDrop`: terminal action after the target state is reached.

To avoid logic drift, Phase 1 should extract or export pure helpers from `src/core/game.js`:

- `rotateShapeMatrix`
- rotation kick tables or a pure `tryRotatePieceState`
- `canPlacePiece` already exists and can stay shared

The pathfinder should prefer the lowest-cost path among equal-scoring placements:

```text
pathCost =
  moveCount
  + 1.15 * rotationCount
  + 0.25 * softDropCount
  + tuckPenalty
```

Low difficulty tiers can intentionally restrict pathfinding to simple paths. High tiers should allow full SRS/legacy-kick reachability, tucks, delayed rotations, and low lock-delay slides.

### Lookahead

Quadra has next pieces but no hold. Serenity's current local UI exposes three next canvases and no hold path. The bot should therefore support:

- One-piece evaluation at all tiers.
- One-ply next-piece lookahead at tiers 6-10.
- No hold-piece branch until the game actually has hold.

Lookahead formula:

```text
candidateScore =
  currentScore
  + lookaheadWeight * average(bestScoreForNextPieceOnResultBoard)
```

Recommended initial `lookaheadWeight`: `0.35`.

## Asset And Code License Registry

No external code, assets, sounds, images, or libraries should be imported for the first bot implementation.

| Source | Use | License status | Decision |
|---|---|---|---|
| `C:/Users/olovm/repositories/quadra` and https://github.com/quadra-game/quadra | Mechanics reference only | LGPL-2.1 according to local `LICENSE` and GitHub API | Do not copy or link code. Study behavior only. |
| Roncli Quadra page | Mechanics research | Website content copyright Ronald M. Clifford | Link/cite only. No content reuse in runtime. |
| Hard Drop Quadra page | Mechanics research | CC BY-SA 4.0 page license | Link/cite only. Do not copy text/assets into shipped game. |
| TetrisWiki Quadra page | Mechanics research | CC BY-NC-SA 4.0 page license | Link/cite only. Non-commercial share-alike content is not suitable for commercial runtime assets. |
| Colin Fahey Tetris page | AI/pathfinding research | No clear reusable code license for our purposes | Link/cite only. Reimplement concepts independently. |
| `pytetris` package | El-Tetris weight reference | PyPI metadata says MIT plus "Free for non-commercial use", which is ambiguous for commercial use | Do not import. Numeric weights can be treated as research reference only; prefer Dellacherie default and local tuning. |
| `YuhanXiaoJY/Implementation-of-El-Tetris` | Search result for El-Tetris implementation | GitHub API reports no license | Do not use. |
| NeurIPS CBMPI Tetris paper | Research reference | Research publication, not runtime code | Cite only. |

All new Serenity bot code should be written from scratch in this repo and distributed under the repo's existing MIT license.

## Architectural Class Design

Recommended file layout:

```text
src/core/ai/
  bot-difficulty.js
  local-bot-manager.js
  puzzle-bot-controller.js
  reachability-pathfinder.js
  cascade-simulator.js
  board-evaluator.js
  bot-input-scheduler.js
  bot-types.js

src/core/__tests__/
  bot-difficulty.test.js
  bot-pathfinder.test.js
  bot-cascade-simulator.test.js
  bot-evaluator.test.js

src/ui/
  local-match-config-modal.js
```

### Slot Configuration

`LocalMatchConfigModal` should move from player count only to slot occupants:

```ts
type LocalPlayerSlotConfig = {
  slot: 0 | 1 | 2 | 3;
  kind: 'human' | 'bot';
  name: string;
  difficulty?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  handicap: 0 | 1 | 2 | 3 | 4;
  team?: 0 | 1;
};
```

The UI should keep the existing `numPlayers` control, then render one row per active slot:

```text
Player 1: Human, Bot toggle disabled by default
Player 2: Human/Bot toggle, difficulty selector when Bot
Player 3: Human/Bot toggle, difficulty selector when Bot
Player 4: Human/Bot toggle, difficulty selector when Bot
```

Recommended default:

```js
playerSlots: [
  { slot: 0, kind: 'human', name: 'P1', handicap: 2 },
  { slot: 1, kind: 'bot', name: 'Bot 1', difficulty: 5, handicap: 2 },
]
```

### Bot Manager

```ts
class LocalBotManager {
  constructor({ multiplayerState, mode, rng });
  configure(playerSlots: LocalPlayerSlotConfig[]): void;
  resetForRound(): void;
  update(deltaMs: number, nowMs: number): void;
  destroy(): void;
}
```

Responsibilities:

- Own one `PuzzleBotController` per bot slot.
- Start a new think cycle when a bot's current piece changes.
- Tick input schedulers each frame.
- Skip dead, paused, hit-stopped, or physics-processing players.
- Keep all bot work local and deterministic when seeded.

### Bot Controller

```ts
class PuzzleBotController {
  constructor({ playerIndex, difficulty, planner, scheduler, actions });
  onPieceSpawn(gameState, nextPieces): void;
  update(deltaMs, nowMs, gameState): void;
  cancelPlan(): void;
}
```

Responsibilities:

- Apply reaction delay.
- Ask `BotPlanner` for a target.
- Add difficulty noise/blunders.
- Queue the resulting action sequence through `BotInputScheduler`.

### Planner

```ts
class BotPlanner {
  constructor({ pathfinder, simulator, evaluator, difficulty });
  plan(gameState): BotPlan;
}
```

Responsibilities:

- Enumerate every legal reachable terminal state for the current piece.
- Simulate the full cascade for each candidate.
- Optionally evaluate the first next piece on the resulting stable board.
- Return the best target plus shortest legal action path.

### Cascade Simulator

```ts
class CascadeSimulator {
  simulateLock({ boardGrid, lockedPieces, piece, lockFootprint }): CascadeResult;
}
```

The simulator should be pure and synchronous. It should not call `processPhysics`, because live physics is async and includes animation waits. It must mirror the logical phases:

1. Clone board.
2. Add candidate piece with unique id.
3. Detect full lines.
4. Remove lines.
5. Split remaining cells into components.
6. Drop components one row at a time until stable.
7. Repeat.
8. Return final board, total lines, wave details, perfect-clear flag, and movement/contribution stats.

The first milestone must test this simulator against curated `processPhysics` fixtures to prevent quiet AI/live divergence.

### Board Evaluator

```ts
class BoardEvaluator {
  constructor({ weights, cascadeWeights });
  evaluate(candidate: CascadeResult, context: EvaluationContext): number;
  measureBoard(boardGrid): BoardFeatures;
}
```

Features:

- `landingHeight`
- `erodedPieceCells`
- `rowTransitions`
- `columnTransitions`
- `holes`
- `wellSums`
- `aggregateHeight`
- `maxHeight`
- `bumpiness`
- `topOutRisk`
- `cascadeDepth`
- `totalCleared`
- `perfectClear`
- `garbageAttackEstimate`

Keep Dellacherie as the base profile. Add non-base features as small cascade/local-multiplayer modifiers.

### Input Scheduler

```ts
class BotInputScheduler {
  constructor({ maxApm, jitterMs, actions });
  queue(actions: BotAction[]): void;
  update(deltaMs): void;
  clear(): void;
}
```

Responsibilities:

- Convert action paths to real gameplay commands.
- Enforce APM with `minActionIntervalMs = 60000 / maxApm`.
- Add small per-action jitter on lower tiers.
- Stop if the piece changes or physics begins.

Use injected actions, not direct DOM events:

```js
const actions = {
  moveLeft: () => move(playerState, -1, playMove, addTrail),
  moveRight: () => move(playerState, 1, playMove, addTrail),
  rotateLeft: () => rotate(playerState, 'left', playRotate, addTrail),
  rotateRight: () => rotate(playerState, 'right', playRotate, addTrail),
  rotateFlip: () => rotate(playerState, 'flip', playRotate, addTrail),
  softDrop: () => softDrop(playerState, playDrop, callbacks),
  hardDrop: () => hardDrop(playerState, playDrop, callbacks),
};
```

## Difficulty Parameter Matrix

Difficulty should be data-only so design can tune without rewriting behavior.

```js
export const BOT_DIFFICULTY_TIERS = {
  1: {
    label: 'Beginner',
    reactionMs: [900, 1400],
    maxApm: 45,
    heuristicNoise: 0.42,
    blunderChance: 0.28,
    candidatePool: 6,
    lookaheadPieces: 0,
    searchBudgetMs: 1.5,
    allowTucks: false,
    allowCascadePlanning: false,
    hardDropChance: 0.15,
  },
  2: {
    label: 'Casual',
    reactionMs: [760, 1150],
    maxApm: 60,
    heuristicNoise: 0.34,
    blunderChance: 0.22,
    candidatePool: 5,
    lookaheadPieces: 0,
    searchBudgetMs: 2,
    allowTucks: false,
    allowCascadePlanning: false,
    hardDropChance: 0.25,
  },
  3: {
    label: 'Learner',
    reactionMs: [620, 950],
    maxApm: 80,
    heuristicNoise: 0.26,
    blunderChance: 0.16,
    candidatePool: 4,
    lookaheadPieces: 0,
    searchBudgetMs: 2.5,
    allowTucks: false,
    allowCascadePlanning: true,
    hardDropChance: 0.38,
  },
  4: {
    label: 'Steady',
    reactionMs: [500, 780],
    maxApm: 105,
    heuristicNoise: 0.19,
    blunderChance: 0.1,
    candidatePool: 3,
    lookaheadPieces: 0,
    searchBudgetMs: 3,
    allowTucks: false,
    allowCascadePlanning: true,
    hardDropChance: 0.5,
  },
  5: {
    label: 'Challenger',
    reactionMs: [380, 620],
    maxApm: 135,
    heuristicNoise: 0.13,
    blunderChance: 0.065,
    candidatePool: 3,
    lookaheadPieces: 0,
    searchBudgetMs: 4,
    allowTucks: true,
    allowCascadePlanning: true,
    hardDropChance: 0.65,
  },
  6: {
    label: 'Expert',
    reactionMs: [280, 470],
    maxApm: 170,
    heuristicNoise: 0.085,
    blunderChance: 0.035,
    candidatePool: 2,
    lookaheadPieces: 1,
    lookaheadWeight: 0.25,
    searchBudgetMs: 5,
    allowTucks: true,
    allowCascadePlanning: true,
    hardDropChance: 0.76,
  },
  7: {
    label: 'Master',
    reactionMs: [200, 350],
    maxApm: 210,
    heuristicNoise: 0.052,
    blunderChance: 0.018,
    candidatePool: 2,
    lookaheadPieces: 1,
    lookaheadWeight: 0.3,
    searchBudgetMs: 6,
    allowTucks: true,
    allowCascadePlanning: true,
    hardDropChance: 0.84,
  },
  8: {
    label: 'Grandmaster',
    reactionMs: [130, 240],
    maxApm: 260,
    heuristicNoise: 0.028,
    blunderChance: 0.008,
    candidatePool: 1,
    lookaheadPieces: 1,
    lookaheadWeight: 0.35,
    searchBudgetMs: 7,
    allowTucks: true,
    allowCascadePlanning: true,
    hardDropChance: 0.91,
  },
  9: {
    label: 'Quadra Ace',
    reactionMs: [80, 160],
    maxApm: 315,
    heuristicNoise: 0.012,
    blunderChance: 0.002,
    candidatePool: 1,
    lookaheadPieces: 1,
    lookaheadWeight: 0.38,
    searchBudgetMs: 8,
    allowTucks: true,
    allowCascadePlanning: true,
    hardDropChance: 0.96,
  },
  10: {
    label: 'Machine',
    reactionMs: [35, 85],
    maxApm: 380,
    heuristicNoise: 0,
    blunderChance: 0,
    candidatePool: 1,
    lookaheadPieces: 1,
    lookaheadWeight: 0.42,
    searchBudgetMs: 10,
    allowTucks: true,
    allowCascadePlanning: true,
    hardDropChance: 1,
  },
};
```

Interpretation:

- `heuristicNoise` is a fraction of the observed score spread among candidates.
- `blunderChance` picks from the top `candidatePool` instead of the best candidate.
- `maxApm` controls actual input cadence, not planning speed.
- `hardDropChance` lets lower tiers sometimes ride gravity or soft-drop inefficiently.

## Implementation Plan

### Phase 1 - Pure AI Core

1. Add `src/core/ai/bot-difficulty.js` with the matrix above and validation helpers.
2. Add `board-evaluator.js` with Dellacherie feature extraction.
3. Add `cascade-simulator.js` that mirrors `physics.js` without animation or callbacks.
4. Add unit tests for:
   - row/column transition counts
   - holes and wells
   - eroded piece cells
   - one-line, multi-line, and perfect-clear scoring
   - simple cascade chains
5. Compare `CascadeSimulator` against live `processPhysics` fixtures by running both on cloned states and asserting equal final occupancy, lines, cascade count, and perfect-clear flag.

### Phase 2 - Reachability And Planning

1. Extract pure rotation helpers from `src/core/game.js` or create a shared movement rules module used by both game and AI.
2. Add `reachability-pathfinder.js`.
3. Add tests for:
   - horizontal movement
   - left/right rotation kicks
   - I-piece kicks
   - 180 flip legacy kicks
   - unreachable blocked pockets
   - reachable tuck/slide pockets
4. Add `BotPlanner` to combine pathfinder, simulator, evaluator, and difficulty noise.

### Phase 3 - Runtime Bot Controllers

1. Add `bot-input-scheduler.js`.
2. Add `puzzle-bot-controller.js`.
3. Add `local-bot-manager.js`.
4. Wire `LocalMultiplayerMode`:
   - create manager after `this.multiplayerState` is configured
   - call `botManager.update(delta, currentTime)` once per local game-loop frame before `processAutoDrop`
   - destroy manager during mode cleanup and round transitions
5. Ensure bot actions are injected core function calls, not fake DOM key events.

### Phase 4 - Local Match UI

1. Extend `LocalMatchConfigModal` with per-player slot rows.
2. Preserve existing `numPlayers`, team, handicap, match mode, and attack-style behavior.
3. Emit `config.playerSlots`.
4. Keep `config.playerHandicaps` for compatibility, deriving it from the slot rows.
5. Add a small "Bot L5" label to bot board headers and standings HUD.

### Phase 5 - Integration And Balancing

1. Add bot fixtures for tiers 1, 5, and 10.
2. Run local 1 human + 1 bot, 1 human + 3 bots, and 4 bots soak tests.
3. Measure planner time per spawn and enforce a per-frame budget.
4. Tune cascade modifiers against actual match telemetry:
   - survival time
   - lines sent
   - self-top-outs
   - max cascade depth
   - average stack height
5. Keep all tuning in data objects.

### Phase 6 - Performance Guardrails

The core planner can start synchronously because a 10x24 board has a modest candidate count, but it needs guardrails:

- Never plan while `gameState.isProcessingPhysics`.
- Cancel stale plans when `currentPiece` changes.
- Limit one-ply lookahead to tiers 6-10.
- Use a hard `searchBudgetMs`.
- If planning exceeds budget, return the best evaluated candidate so far.
- Add an optional Web Worker only if profiling shows local 4-bot matches stutter.

## Acceptance Criteria

- Local match config can fill any open P2-P4 slot with a bot.
- A match can run with 1 human + 1-3 bots or 2-4 bots.
- Bot actions use the same core movement/rotation/drop functions as humans.
- Bot placements are always reachable by legal input sequence.
- The AI simulator predicts the same stable board as live physics for test fixtures.
- Difficulty tiers visibly differ in reaction time, input speed, and mistake rate.
- Tier 10 has no random heuristic noise and can plan cascade setups.
- No external code or assets are copied into the repo.
- No online/Steam multiplayer behavior changes in the first local-only release.

## Open Implementation Notes

- The current game has no hold mechanic. Do not build hold-specific planning until hold exists in gameplay.
- `LocalMatchConfigModal` currently contains mojibake in labels. Bot UI changes should avoid spreading that encoding damage, but a separate UI text cleanup should be its own patch.
- Existing global `window.moveP2` style controls can be used as a temporary integration shortcut, but the durable bot architecture should use injected core actions for testability.
- The planner should treat top-out risk aggressively because local multiplayer garbage can arrive immediately before the next spawn.
