# Fault Lines: cascade puzzles (preview, October 2026)

**Status: preview.** The menu lists Fault Lines only with `?faultLines=1` (or
`localStorage['serenity.faultLines'] = '1'`), registered in `src/core/flags.js`. Everything
below works and is tested; what it needs before it ships unflagged is listed at the end.

## What it is

A puzzle mode built on the rule that sets the game apart: after a clear, each body falls
as one rigid unit until something holds it, and two bodies never glue together. A puzzle
is an authored structure, a supply of one to three pieces shown in the queue, and one goal.
Gravity waits while you choose, every piece can be taken back, and nothing is scored.

Goals:

| Goal | Met when |
|---|---|
| `waves` | one lock sets off a cascade at least `atLeast` waves deep |
| `lines` | at least `atLeast` lines are cleared over the puzzle |
| `clear-all` | the well ends empty |
| `relic-floor` | some cell of the relic body rests on the floor |

A puzzle fails when the supply is spent short of the goal, when the relic body is cleared
away, or when a dealt piece has no room. The panel says which, in the goal's own terms
("The cascade reached 2 of 4 waves.", "3 blocks remain.", "The relic was cleared away.").

## How it plays

- The piece in hand waits on the first visible row. Move, rotate and soft drop as usual;
  only a hard drop places it. Its cascade then plays out with the theme's full reactions,
  and the board's cascade banner counts **waves** (not combos) in this mode.
- The panel beside the well (it replaces Single Player's ledger) shows the lesson, the
  goal with its progress, which piece this is ("Piece 1 of 2", "Last piece"), and the
  outcome. The first puzzle also says which key drops the piece.
- **Backspace** (or Ctrl+Z) takes back a piece, **R** restarts, **Enter** goes to the next
  puzzle after a solve. A key the player has bound to a move keeps that move; held keys
  do not repeat. A key bound to a move or a Serenity action (H opens the Hub) keeps it. On
  a gamepad: **LB** takes back, **RB** restarts, **LT** asks for a hint, **A** goes on.
- **Hints.** After two failed attempts on a puzzle, a Hint button (**?**) lights the next
  landing of the puzzle's stored solution. If the pieces placed so far left that line but a
  straight line on still exists, the hint follows that instead; only when no line on
  exists does the puzzle start over, and the panel says so.
- The Puzzles button lists the pyramid with each tier's progress. A tier opens once three
  puzzles in the tier below are solved, so the lanterns are met before the deep fault
  assumes them.
- The board draws a dark seam wherever two bodies touch, and a cream diamond on the
  relic. Bodies stay fused inside: seams are drawn per body, never per cell, so the
  fused, borderless look is kept. Two fragments of one body that touch again re-fuse
  (the cascade helper keys bodies by id); the sim and the live game agree on this.

## The puzzle bank

Fifteen puzzles in three tiers of five (`src/core/fault-lines/puzzle-bank.js`):

- **First light** (one piece each): First fall, Second wave, Lanterns, Lantern rain,
  Staircase. Each teaches one idea: a clear drops what it held; what falls can finish the
  row beneath it (a wave); lanterns (hanging bodies) fall at the first clear; each falls
  straight down; one clear lets the next lantern down.
- **Undertow** (two pieces): The relic, Footing, Slip, Clean sweep, Undermine. Both pieces
  matter: park a piece over a gap, a clear cuts a piece and the rest keeps falling, a lone
  block drops when the row under it opens, a leftover opens the floor under the relic.
- **Deep fault** (two pieces): Stairwell, Lantern well, Ride the lantern, Lean-to, Four
  gaps. A standing piece rides each clear down, with and without lanterns; a piece resting
  on a lantern falls with it; four gaps from two pieces.

### The standard every puzzle meets

The certifier (`tests/unit/fault-lines-puzzles.test.js`) proves, on every CI run:

1. **A straight-drop solution exists**: rotate and move at the top, then drop. A solution
   that needs a soft drop and a slide (a tuck) or a rotation at the bottom (a kick) is
   legal in the game but no puzzle depends on one. (The first bank had three such puzzles;
   nobody reasoning about the structure would have found them, and spin-kick puzzles are
   the worst possible IP posture for this mode.)
2. **The last piece is needed**: no line of play solves before it lands.
3. **Every piece matters**: the puzzle is unsolvable without its first piece.
4. **Few openings win**: at most a quarter of the first landings lead to a solution in
   tiers 1 and 2, at most a tenth in tier 3.
5. **The stored solution is straight and solves**, so the hint is always right.
6. **Every solution replays through the real game**: real `move`/`rotate`/`hardDrop` from
   the real spawn row and the live async physics, comparing every cell (body and colour)
   and the wave count after each lock, for every solution the solver finds.

A rules change that breaks a shipped puzzle (kicks, spawn, cascade order) fails the build.

The cascade differential gate (`tests/unit/cascade-resolver-differential.test.js`) also
holds 120 seeded boards of multi-cell bodies that clears split and that hang over holes,
plus a wide body held by one end. Before Fault Lines it held only single cells and full rows.

### Format

```js
{
    id: 'second-wave', tier: 1, title: 'Second wave',
    lesson: 'What falls can finish the row beneath it. Every clear after the first is another wave.',
    rows: [                // bottom-aligned on the 10-wide board, '.' is empty
        '......E...',      // each letter is one body; lowercase marks a lantern
        'AAAAA.CCCC',      // (authoring convention only: all bodies follow one rule)
        'BBBBBB.DDD',
    ],
    supply: ['I'],          // dealt in order; nothing refills it
    goal: { type: 'waves', atLeast: 2 },
    solution: [{ piece: 'I', rotation: 1, x: 3 }],   // right rotations, then the column
}
```

`validatePuzzleDefinition` names every problem: row width, a full starting row, a body
split in two, more than 14 rows, an unknown piece, a bad goal, a relic that starts on the
floor, a solution that does not match the supply. Bodies get piece colours so that no two
touching bodies match (the board draws same-coloured neighbours as one shape).

### Adding a puzzle

1. Write the definition in `puzzle-bank.js` without a `solution`.
2. Run `npx vitest run tests/unit/fault-lines-puzzles.test.js`. It fails with the id if the
   puzzle is unsolvable, has no straight solution, solves early, wastes a piece, or lets
   too many openings win.
3. `solvePuzzle(buildPuzzle(def))` returns `straightSolutions`; copy the first as
   `solution` (`{ piece, rotation, x }` per placement) and run the test again.

Tiers 2 and 3 came from an offline search over random structures (rows with gaps,
hanging bodies, a random two-piece supply) under the standard above, kept when few
openings win, then named and ordered by hand.

## Architecture

| Part | File | Layer |
|---|---|---|
| Definitions, validation, body colours | `src/core/fault-lines/fault-lines-puzzle.js` | headless |
| Deal (the real spawn row), landings, lock + cascade, goal judge, failure reasons | `src/core/fault-lines/fault-lines-sim.js` | headless |
| Exhaustive solver, straightness, every-piece-matters, a line on from any position | `src/core/fault-lines/fault-lines-solver.js` | headless |
| Bank, tiers and the unlock rule | `src/core/fault-lines/puzzle-bank.js` | headless |
| Solved set, chosen puzzle, what comes next | `src/core/fault-lines/fault-lines-progress.js` | headless |
| The mode | `src/core/game-modes/FaultLinesMode.js` | headless, extends `SinglePlayerMode` |
| Panel, keys, gamepad, saved solves | `src/ui/fault-lines/fault-lines-hud.js`, `public/styles/fault-lines.css` | UI |
| Seams, relic mark, hint outline | `drawBodySeams`, `drawHintCells` in `src/rendering/phaser/base-board-scene.js` | rendering |
| "Wave n" banner | `GameState.moveSummaryVocabulary`, read by `src/rendering/phaser/shared-effects.js` (finale kicker and the depth popup) | rendering |

- **Two GameState switches**, both default off (`tests/unit/puzzle-rule-gates.test.js`):
  `finiteSupply` (spawning never refills the bag) and `gravityWaits` (no fall and no
  auto-lock; soft drop never locks). Every other mode keeps its rules. The puzzle state
  also sets `disableLevelProgression`, so a long session never fires a level-up, and
  `moveSummaryVocabulary = 'wave'`, which the board effects read from whichever GameState
  the scene draws (a scene rebuilt by a theme change keeps the word; the mode never
  reaches into the scene).
- **Single Player hooks.** `SinglePlayerMode` gained four overridable session hooks
  (`_createSessionGameState`, `_dealSessionPieces`, `_recordsDemos`, `_allowsFixedTick`);
  its own behaviour is unchanged. Fault Lines records no replay and stays on the legacy
  clock.
- **A blocked deal is not a game over.** `spawnPiece` marks the session over when a piece
  has no room, and the game loop stops on that flag; the mode's own game-over handler
  clears it, returns the blocked piece to the pool, and fails the puzzle instead, so undo
  still works and the board keeps drawing.
- **The mode stays headless.** It may not import UI (the `core-stays-headless` boundary
  has a closed carve-out list), so it publishes `EVENTS.FAULT_LINES_STATE` and takes
  `EVENTS.FAULT_LINES_COMMAND`. Board writes go through `restoreBoardState`.
- **Saved progress** is `localStorage['serenity.faultLines.solved']`, read and written only
  by the HUD. Ids the bank no longer has are kept and written back, so a renamed puzzle
  never loses a player's solve.
- **Nothing reaches Records, Steam stats or leaderboards.**

## Verified

- Unit: the certifier (66 cases over fifteen puzzles), the mode (deal, solve, undo across
  turns, restart, failure reasons, a blocked deal, hints on and off the stored line, first
  solve, commands, progress), rule gates, the multi-cell differential corpus, menu art and
  the flag registry.
- Two independent reviews (code and design) after the first build; their findings are
  folded in: the straight-drop standard, every-piece-matters, the blocked-deal loop death,
  level progression, held-key repeat, focus after a panel action, failure copy per goal,
  the lantern lessons, the unlock rule, the wave banner, the portrait breakpoint.
- In the real game (Vite dev server, headless Chromium with the Forest theme on its WebGL2
  fallback): the menu entry with and without the flag, the stage, First fall solved by
  keyboard, Staircase's four-wave cascade with its "Wave 4" banner, the puzzle list, seams
  and lanterns, the relic mark, undo, a failed attempt's copy, the hint after two misses
  (the outline on the board, the restart note, the solve from it, Enter to the next
  puzzle), and the portrait strip at 900×1400. That pass caught two things the unit tests
  could not: the hint key was H, which opens the Serenity Hub (now ?, and the panel defers
  to every move and Serenity binding), and the banner still said "Combo" because the word
  was set on a scene the theme later rebuilt (now carried by the GameState).

## Before it ships unflagged

1. **Owner playtest** of the fifteen puzzles and the difficulty curve between tiers.
2. **Name clearance** for "Fault Lines" before it is player-facing outside the flag.
   Names already in the mode's vocabulary if it fails: Seams, Fault.
3. **Menu art.** `public/assets/menu-art/fault-lines.webp` is a capture of the mode in the
   Forest theme from a headless browser; replace it with curated art.
4. **Gamepad list navigation.** Undo, restart, hint and next work on a pad; the Puzzles
   list is keyboard and pointer only.
5. **Steam rich presence** shows the menu while Fault Lines runs (`rich-presence-manager.js`
   has no token for it yet).
6. Later, from the game-mode study: a daily set of five puzzles, more pyramids per world,
   a wave-by-wave replay of a miss, and an editor (the validator and solver are ready for
   one).
