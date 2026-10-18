# Stillfall: cascade puzzles (October 2026)

**Named Fault Lines until 2026-10-18,** when the owner chose a name that suits Serenity Blocks:
still (gravity waits; nothing moves until you choose) and fall (one drop, and every body falls as
one). The mode id, files, events, styles and Steam token were renamed with it; solves saved
under `serenity.faultLines.solved`, a saved `gameMode: 'fault-lines'` and the menu's remembered
`fault-lines` all carry over.

**2026-10-18:** the bank grew from fifteen puzzles in three tiers to thirty-six in six. Two more
in Undertow and in Deep fault, then three new three-piece tiers (Rift, Bedrock, Epicentre), the
last two certified to have exactly one winning first landing. Landings now come from
`stillfall-reach.js`, the bot pathfinder's search without its allocations, which the
three-piece certifier needed to stay fast in CI. The Puzzles list shows a locked tier as one line.
The search that found the new structures is `scripts/stillfall-search.mjs`. The same day the
owner removed Waystones, the road preview built beside Stillfall (it is in git history before
this change); a saved `gameMode: 'waystones'` heals to Single Player when settings load.
Later that day the bank doubled to seventy-two: every tier twice its size (10, 14, 14, 12, 12,
10), the new puzzles from the same search (`--pieces=1` for First light) and the same
certifier, each lesson written after replaying its solution wave by wave.

**Status: in the main menu since 2026-10-18,** between Infinity and Local Versus, with no
URL parameter (the preview flag, `faultLines` from the mode's first name, is retired; an old
`?faultLines=1` is simply ignored). What it still needs from the owner is listed at the end.

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
  goal with its progress (pips for lines and waves, the blocks left for an empty well, a
  legend for the relic's mark), which piece this is ("Piece 1 of 2", "Last piece"), and the
  outcome. The first puzzle also says which key drops the piece.
- **Backspace** (or Ctrl+Z) takes back a piece, **R** restarts, **Enter** goes to the next
  puzzle after a solve. After a miss the panel says what was missing ("1 line short.", "The
  well is not empty.") rather than repeating the goal's count, and offers one primary button
  on **Enter**: *Try again* on a one-piece puzzle, *Take back* (the last piece returns to the
  hand) on a longer one. A miss sounds a soft falling third (`playPuzzleMiss`); a restart
  sounds like an undo. A key the player has bound to a move keeps that move; held keys
  do not repeat. A key bound to a move or a Serenity action (H opens the Hub) keeps it. On
  a gamepad: **LB** takes back, **RB** restarts, **LT** asks for a hint, **A** does what Enter does, and
  **Select** opens the Puzzles list, which then owns the pad: up and down walk it (holding
  repeats), **A** plays the marked puzzle, **B** or **Select** closes it. Presses the list takes
  are latched, so the A that chose a puzzle never rotates the new piece; Start still pauses
  (`src/ui/stillfall/stillfall-pad-list.js`, through `GamepadController.setPanelControls`).
- Steam rich presence shows "Stillfall" while a puzzle is on the board (`#Stillfall` in
  `steam/rich-presence/english.vdf`).
- **Hints.** After two failed attempts on a puzzle, a Hint button (**?**) lights the next
  landing of the puzzle's stored solution. If the pieces placed so far left that line but a
  straight line on still exists, the hint follows that instead; only when no line on
  exists does the puzzle start over, and the panel says so. A hint is for one piece: once
  that piece lands, the button returns for the next one, and it is gone after a solve.
- The Puzzles button lists the pyramid with each tier's progress and a countdown to the
  next ("0 of 14 solved · 3 more to open Deep fault"). A tier opens once three puzzles in the
  tier below are solved, so the lanterns are met before the deep fault assumes them. A tier
  not yet open is one line (its name, how many puzzles, locked). The list scrolls in its own
  box, so the puzzle's title, lesson and goal stay in view above it on a small screen.
- **Its look matches the other modes.** A wordmark in the game's own lettering (STILLFALL
  on one row in the spectrum, like Infinity and Odyssey; generated by
  `scripts/generate-mode-wordmarks.mjs`) on the menu stage and the loading cover. Its hue is
  coral, in the menu (the list item, the stage's aura and its note, `keystone-menu.css`) as in
  play (the well walls and the panel's edge). The stage's picture is a real-game capture like
  the others (`scripts/capture-menu-art.mjs --only=stillfall`: Floor last in Cinder Drift,
  the hint's outline on the first landing). The queue is the supply: it shows only what is
  still to come, and with the last piece in hand the row steps aside.
- The board draws a dark seam wherever two bodies touch, and a cream diamond on the
  relic. Bodies stay fused inside: seams are drawn per body, never per cell, so the
  fused, borderless look is kept. Two fragments of one body that touch again re-fuse
  (the cascade helper keys bodies by id); the sim and the live game agree on this.

## The puzzle bank

Seventy-two puzzles in six tiers (`src/core/stillfall/puzzle-bank.js`):

- **First light** (one piece each): First fall, Second wave, Lanterns, Clean break, Footstep,
  Lantern rain, Look below, Leftovers, Domino, Staircase. Each teaches one idea: a clear drops
  what it held; what falls can finish the row beneath it (a wave); lanterns (hanging bodies)
  fall at the first clear; one piece can empty the well, its leftover finishing the row below;
  each lantern falls straight down; a falling lantern finishes a row; a body resting on a
  lantern follows it down; one clear lets the next lantern down. Eight of the ten have
  lanterns, so any three solves meet one.
- **Undertow** (two pieces): The relic, Footing, Lantern home, Square peg, Slant, Long wait,
  Slip, Top down, Two by two, Lantern row, Clean sweep, Half a relic, Step by step, Undermine.
  Both pieces matter: park a piece over a gap (the square over a double gap, the Z over gaps
  that lean its way, the long piece over the deepest one), a lantern as the relic, a clear cuts
  a piece and the rest keeps falling, what is left of a cut piece finishes the rows below,
  lanterns count toward a row, a lone block drops when the row under it opens, a clear may cut
  the relic as long as some of it is left, a leftover opens the floor under the relic.
- **Deep fault** (two pieces): Stairwell, Lantern well, Ride the lantern, Trapdoor, Two
  columns, Last in line, Wide gap, Lean-to, Four gaps, Double drop, Foundation, Underpass,
  Above the floor, Landslide. A standing piece rides each clear down, with and without lanterns;
  a piece resting on a lantern falls with it; a lone block over a gap is a trapdoor; two columns
  of gaps, one piece each; four gaps from two pieces; one piece clears two rows at once; the
  relic's row must stand while the floor goes; a four-row cascade that leaves the floor; a
  lantern and its rider fill four rows. The new seven have one winning first landing each.
- **Rift** (three pieces): Double footing, Row of your own, Standing relic, On the ledge, Side
  by side, Roof, Lintel, Overhead, Twin rows, Wings, Clear path, Bookends. Two pieces are set and
  the third fires: a piece over each low gap, a row built from your own pieces, two pieces on one
  ledge, two laid flat and bridged, one on each side of the gap or at each end, lanterns counted
  as fillers, a lantern's path kept clear to the floor. Two or three first landings win.
- **Bedrock** (three pieces, one way in): Riders, Escort, Crown, Twice over, Keep the relic,
  Loose stone, Lantern fall, Pillars, Two and three, Nothing left, Clean slate, Third row. Each
  has exactly one winning first landing, a unique straight line,
  an opening that clears nothing, and a greedy opening (the biggest clear on offer) that loses.
- **Epicentre** (three pieces, one way in): Corners, Keystone, Standing stone, Long drops,
  Two hooks, Right hand, Avalanche, Fault line, Floor last, Plumb line. The deepest goals:
  five-wave cascades, six lines from six rows (in one column, in three waves, or five at once
  and then the floor), and Plumb line's six waves from one lock.

### The standard every puzzle meets

The certifier (`tests/unit/stillfall-puzzles.test.js`) proves, on every CI run:

1. **A straight-drop solution exists**: rotate and move at the top, then drop. A solution
   that needs a soft drop and a slide (a tuck) or a rotation at the bottom (a kick) is
   legal in the game but no puzzle depends on one. (The first bank had three such puzzles;
   nobody reasoning about the structure would have found them, and spin-kick puzzles are
   the worst possible IP posture for this mode.)
2. **The last piece is needed**: no line of play solves before it lands.
3. **Every piece matters**: the puzzle is unsolvable without its leading pieces (the first,
   and for three pieces also the first two).
4. **Few openings win**: at most a quarter of the first landings lead to a solution in
   tiers 1 and 2, at most a tenth in tiers 3 and 4, at most 6% in tiers 5 and 6, and from
   tier 5 on exactly one first landing wins.
5. **The stored solution is straight and solves**, so the hint is always right.
6. **Every solution replays through the real game**: real `move`/`rotate`/`hardDrop` from
   the real spawn row and the live async physics, comparing every cell (body and colour)
   and the wave count after each lock, for every solution the solver finds.

A rules change that breaks a shipped puzzle (kicks, spawn, cascade order) fails the build.

The cascade differential gate (`tests/unit/cascade-resolver-differential.test.js`) also
holds 120 seeded boards of multi-cell bodies that clears split and that hang over holes,
plus a wide body held by one end. Before Stillfall it held only single cells and full rows.

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

0. To find one, search and rank (worker threads, time-boxed; straight drops on the real
   resolver, every goal the structure allows judged on one tree):
   `node scripts/stillfall-search.mjs --out=c.jsonl --pieces=3 --minutes=20 --workers=4`
   (`--style=deep` for taller, nearly full strata and deep cascades), then
   `node scripts/stillfall-search.mjs --rank=c.jsonl --pieces=3 --top=20`. The rank rewards
   few winning openings and solutions, a set-up opening, a greedy opening that loses, traps
   and deeper goals. On a busy machine a two-piece search kept about two hundred candidates a
   minute per worker and a three-piece one about ten; most are not worth a name, so rank, then
   read the best few lock by lock before writing a lesson.
1. Write the definition in `puzzle-bank.js` without a `solution`.
2. Run `npx vitest run tests/unit/stillfall-puzzles.test.js`. It fails with the id if the
   puzzle is unsolvable, has no straight solution, solves early, wastes a piece, or lets
   too many openings win.
3. `solvePuzzle(buildPuzzle(def))` returns `straightSolutions`; copy the first as
   `solution` (`{ piece, rotation, x }` per placement) and run the test again.

Tiers 2 to 6 came from that offline search over random structures (rows with gaps, two-row
bodies, hanging bodies, a random supply) under the standard above, kept when few openings
win, then named, ordered and given their lessons by hand after reading each solution wave by
wave.

## Architecture

| Part | File | Layer |
|---|---|---|
| Definitions, validation, body colours | `src/core/stillfall/stillfall-puzzle.js` | headless |
| Deal (the real spawn row), landings, lock + cascade, goal judge, failure reasons | `src/core/stillfall/stillfall-sim.js` | headless |
| Every reachable landing: the bot pathfinder's search (same transitions, kicks, cap and path choice) without its allocations | `src/core/stillfall/stillfall-reach.js` | headless |
| Exhaustive solver, straightness, every-piece-matters, a line on from any position | `src/core/stillfall/stillfall-solver.js` | headless |
| Bank, tiers and the unlock rule | `src/core/stillfall/puzzle-bank.js` | headless |
| Puzzle search and rank (offline) | `scripts/stillfall-search.mjs` | tool |
| Solved set, chosen puzzle, what comes next | `src/core/stillfall/stillfall-progress.js` | headless |
| The mode | `src/core/game-modes/StillfallMode.js` | headless, extends `SinglePlayerMode` |
| Panel, keys, gamepad, saved solves | `src/ui/stillfall/stillfall-hud.js`, `public/styles/stillfall.css` | UI |
| The puzzle list on a gamepad | `src/ui/stillfall/stillfall-pad-list.js` (a panel owner in `gamepad-controller.js`) | UI |
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
  its own behaviour is unchanged. Stillfall records no replay and stays on the legacy
  clock.
- **A blocked deal is not a game over.** `spawnPiece` marks the session over when a piece
  has no room, and the game loop stops on that flag; the mode's own game-over handler
  clears it, returns the blocked piece to the pool, and fails the puzzle instead, so undo
  still works and the board keeps drawing.
- **The mode stays headless.** It may not import UI (the `core-stays-headless` boundary
  has a closed carve-out list), so it publishes `EVENTS.STILLFALL_STATE` and takes
  `EVENTS.STILLFALL_COMMAND`. Board writes go through `restoreBoardState`.
- **Saved progress** is `localStorage['serenity.stillfall.solved']` (moved from
  `serenity.faultLines.solved` on first read), read and written only
  by the HUD. Ids the bank no longer has are kept and written back, so a renamed puzzle
  never loses a player's solve.
- **Nothing reaches Records, Steam stats or leaderboards.**

## Verified

- Unit: the certifier (294 cases over seventy-two puzzles), the reachability differential
  (`tests/unit/stillfall-reach.test.js`: every bank puzzle's openings and the boards after
  each, plus 168 random boards with caves where tucks and spins matter, landing for landing and
  action for action against `findReachablePlacements`), the mode (deal, solve, undo across
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
- 2026-10-18, the new tiers in the real game (private Vite, headless Chromium on SwiftShader
  WebGL2, Forest): Plumb line, Keep the relic and Nothing left played from their stored lines by
  key presses and solved (six waves with the "Wave 6" banner, the relic on the floor, an empty
  well); the Puzzles list with a new player's locked tiers as one line each and a veteran's six
  tiers; no console errors. At about one frame per second the first key after each deal was
  refused: a hard drop sets Single Player's 30 ms hit-stop, which drains per frame, and commands
  are refused while it runs (two to four frames at a normal frame rate). A harness that drives
  this mode must confirm each key on the live piece.
- After the doubling, the same run on Clean break, Escort and Avalanche: all three solved from
  their stored lines (an empty well from one piece, the lantern on the floor between two pieces,
  six lines in exactly three waves), the panel's "First light · 4 of 10" and "Epicentre · 7 of
  10", the doubled tiers in the list, no console errors.

## Still open (owner)

The owner shipped it to the main menu on 2026-10-18. Gamepad list navigation and Steam rich
presence, which this list used to name, are done. What remains:

1. **Owner playtest** of the seventy-two puzzles and the difficulty curve between tiers.
2. **Name clearance** for "Stillfall", which is now player-facing. Names already in the
   mode's vocabulary if it fails: Seams, Fault.
3. **Steamworks upload** of `steam/rich-presence/english.vdf`: until the file with
   `#Stillfall` is uploaded, Steam shows no line for the mode (the game sends the token).
4. Later, from the game-mode study: a daily set of five puzzles, more pyramids per world,
   a wave-by-wave replay of a miss, and an editor (the validator and solver are ready for
   one).
