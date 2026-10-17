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

A puzzle fails when the supply is spent short of the goal, or a dealt piece has no room.

## How it plays

- The piece in hand waits on the first visible row. Move, rotate and soft drop as usual;
  only a hard drop places it. Its cascade then plays out with the theme's full reactions.
- The panel beside the well (it replaces Single Player's ledger) shows the lesson, the
  goal with its progress, the pieces left, and the outcome.
- **Backspace** takes back a piece, **R** restarts, **Enter** goes to the next puzzle after
  a solve. A key the player has bound to a move keeps that move. The Puzzles button lists
  the pyramid; a tier opens once two puzzles in the tier below are solved.
- The board draws a dark seam wherever two bodies touch, and a cream diamond on the
  relic. Bodies stay fused inside: seams are drawn per body, never per cell, so the
  fused, borderless look is kept.

## The puzzle bank

Twelve puzzles in three tiers (`src/core/fault-lines/puzzle-bank.js`):

- **First light** (one piece each): First fall, Second wave, Lanterns, Lantern rain,
  Staircase. Each teaches one idea: a clear drops what it held; a falling body can finish
  the row beneath it; lanterns (hanging bodies) fall once a row beneath them clears; one
  clear can let the next lantern down.
- **Two pieces**: The relic, Slip, What remains.
- **Deep fault**: Clean sweep, Ride the lantern, Keyhole, Lean-to. At most one opening in
  ten leads to a solution.

Tiers 2 and 3 came from an offline search over random structures (rows with gaps, hanging
bodies, a random two-piece supply), kept when few openings solve them, then named and
ordered by hand.

### Format

```js
{
    id: 'second-wave', tier: 1, title: 'Second wave',
    lesson: 'A falling body can finish the row beneath it.',
    rows: [                // bottom-aligned on the 10-wide board, '.' is empty
        '......l...',      // each letter is one body; lowercase marks a lantern
        '..........',      // (authoring convention only: all bodies follow one rule)
        '..........',
        'AAAAA.CCCC',
        'BBBBBB.DDD',
    ],
    supply: ['I'],          // dealt in order; nothing refills it
    goal: { type: 'waves', atLeast: 2 },
}
```

`validatePuzzleDefinition` names every problem: row width, a full starting row, a body
split in two, more than 14 rows, an unknown piece, a bad goal, a relic that starts on the
floor. Bodies get piece colours so that no two touching bodies match (the board draws
same-coloured neighbours as one shape).

### The certifier

`tests/unit/fault-lines-puzzles.test.js` runs on every CI run. For each puzzle it:

1. solves it exhaustively over every landing the real controls can reach from the deal
   row (`findReachablePlacements`), resolving each lock with `cascade-resolver.js`;
2. requires a solution, and requires that not every opening solves it;
3. replays the solution through a real `GameState`: real `move`/`rotate`/`softDrop`/
   `hardDrop` and the live async physics, comparing every cell (body and colour) and the
   wave count after each lock.

A rules change that breaks a shipped puzzle (kicks, spawn, cascade order) fails the build.
Moving the simulated deal row by one row fails three puzzles, so the check is not vacuous.

The cascade differential gate (`tests/unit/cascade-resolver-differential.test.js`) now also
holds 120 seeded boards of multi-cell bodies that clears split and that hang over holes,
plus a wide body held by one end. Before, it held only single cells and full rows.

### Adding a puzzle

1. Write the definition in `puzzle-bank.js`.
2. Run `npx vitest run tests/unit/fault-lines-puzzles.test.js`. An unsolvable or trivial
   puzzle fails with its id.
3. To see why, call `solvePuzzle(buildPuzzle(def))`: it returns the solution, how many
   lines of play exist and solve it, and how many openings win.

## Architecture

| Part | File | Layer |
|---|---|---|
| Definitions, validation, body colours | `src/core/fault-lines/fault-lines-puzzle.js` | headless |
| Deal, landings, lock + cascade, goal judge | `src/core/fault-lines/fault-lines-sim.js` | headless |
| Exhaustive solver | `src/core/fault-lines/fault-lines-solver.js` | headless |
| Bank and tier rule | `src/core/fault-lines/puzzle-bank.js` | headless |
| Solved set, chosen puzzle | `src/core/fault-lines/fault-lines-progress.js` | headless |
| The mode | `src/core/game-modes/FaultLinesMode.js` | headless, extends `SinglePlayerMode` |
| Panel, keys, saved solves | `src/ui/fault-lines/fault-lines-hud.js`, `public/styles/fault-lines.css` | UI |
| Seams and relic mark | `drawBodySeams` in `src/rendering/phaser/base-board-scene.js` | rendering |

- **Two GameState switches**, both default off (`tests/unit/puzzle-rule-gates.test.js`):
  `finiteSupply` (spawning never refills the bag) and `gravityWaits` (no fall and no
  auto-lock; soft drop never locks). Every other mode keeps its rules.
- **Single Player hooks.** `SinglePlayerMode` gained four overridable session hooks
  (`_createSessionGameState`, `_dealSessionPieces`, `_recordsDemos`, `_allowsFixedTick`);
  its own behaviour is unchanged. Fault Lines records no replay and stays on the legacy
  clock.
- **The mode stays headless.** It may not import UI (the `core-stays-headless` boundary
  has a closed carve-out list), so it publishes `EVENTS.FAULT_LINES_STATE` and takes
  `EVENTS.FAULT_LINES_COMMAND`. Board writes go through `restoreBoardState`.
- **Saved progress** is `localStorage['serenity.faultLines.solved']`, read and written only
  by the HUD.
- **Nothing reaches Records, Steam stats or leaderboards.**

## Verified

- Unit: certifier (29 cases), mode (solve, undo across turns, restart, fail, commands,
  pause), rule gates, the multi-cell differential corpus, menu art and flag registry.
- In the real game (Vite dev server, headless Chromium with the Forest theme on its WebGL2
  fallback): the menu entry with and without the flag, the stage, First fall solved by
  keyboard, Staircase's four-wave cascade, the puzzle list, Ride the lantern's seams and
  lanterns, the relic mark.

## Before it ships unflagged

1. **Owner playtest** of the twelve puzzles and the difficulty curve between tiers.
2. **Name clearance** for "Fault Lines" before it is player-facing outside the flag.
3. **Menu art.** `public/assets/menu-art/fault-lines.webp` is a capture of the mode in the
   Forest theme from a headless browser; replace it with curated art.
4. **Gamepad.** Undo, restart and next are keyboard and pointer only.
5. **Portrait.** The panel's portrait layout is untested.
6. **Steam rich presence** shows the menu while Fault Lines runs (`rich-presence-manager.js`
   has no token for it yet).
7. **Pause menu copy** is Single Player's.
8. Later, from the game-mode study: a daily set of five puzzles, more pyramids per world,
   a wave-by-wave replay of a miss, and an editor (the validator and solver are ready for
   one).
