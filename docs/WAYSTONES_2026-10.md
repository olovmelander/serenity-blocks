# Waystones: the road (lite preview, October 2026)

**Status: preview.** The menu lists Waystones only with `?waystones=1` (or
`localStorage['serenity.waystones'] = '1'`), registered in `src/core/flags.js`. This is the
"lite" road from the game-mode study: five stops, the existing rule modifiers plus two
gentle ones, score-leaning charms, lantern lives. It is built to be played and tuned, not
to be finished; what it needs before it ships unflagged is at the end.

## What it is

A seeded road of five stops across the worlds the player has collected. Each stop is one
world under one **climate**: a speed, a few rule modifiers and one ask (lines, points, or
cascades two waves deep). The goal met, the piece in hand is not dealt again: the road
waits while the player **settles the stack** (bank it or release it), takes a **charm** or
not, and **chooses the next world** from two on offer. Then the world switches, the climate
takes hold, and play goes on with the board as they left it. A top-out costs a **lantern**
and clears the well; the last lantern ends the road. The fifth stop is the **Keeper's**:
the same climates, a bigger ask, and the road ends in the light.

The stack is the inventory. Banking it pays a toll now (60 points a row, 120 with Tide)
and raises the next ask (a line goal grows by a row per two carried, a score goal by 4% a
row, a cascade goal by one at eight rows or more). Releasing it is a clean well and the
base ask. The vetting asked for exactly this choice so that carrying a stack can neither
sandbag the next goal nor spiral a run to death.

## How it plays

- **Stop one is the world on screen.** The road begins where you stand; the first climate
  bends at most one rule.
- **Climates** (`src/core/waystones/climates.js`): Clear night, Still air (long breath),
  Rising wind (speed up), Mirror pool (mirror), Mist (hidden queue), Ember wind (combo
  multiplier), Slow dusk (slow start), Deep current (cascades under long breath),
  Crosswind (mirror and long breath), Squall (speed up and mist). Mirror, Speed Up, Slow
  Start and Combo Multiplier are Odyssey's own `ModifierStack` definitions, applied the
  same way; Mist and Long breath are this mode's.
- **Charms** (`charms.js`): Ember (a cascade two waves deep scores half again), Current
  (three or four lines at once score 40% more), Tide (banking pays double), Keel (every
  stop asks 15% less), Hearth (the first top-out at each stop costs no lantern), Lantern
  (one more lantern). Three are drafted after each stop; one may be taken.
- **The panel** beside the well (it replaces Single Player's ledger) shows the stop and its
  climate, the goal with its progress, the lanterns, the score, the charms held, and the
  road as five stones. Between stops it becomes the sheet of choices; at the end, the
  summary with **Set out again** (a fresh road from where you stand) and **Menu**.
- **Keys.** The sheet is reached with Tab and pressed with Enter; Enter alone sets out
  again once the road has ended. The piece keys stay the board's; Mirror pool reverses
  the moves in the mode, since Single Player's input path has no mirror of its own.

## Architecture

| Part | File | Layer |
|---|---|---|
| Climates, the two own modifiers, goal copy | `src/core/waystones/climates.js` | headless |
| Charms and their rates | `src/core/waystones/charms.js` | headless |
| Seeded road, goal scaling, drafts | `src/core/waystones/road.js` | headless |
| The run: phases, bank/release, charms, lanterns, summary | `src/core/waystones/run.js` | headless |
| The mode | `src/core/game-modes/WaystonesMode.js` | headless, extends `SinglePlayerMode` |
| Panel and the between-stops sheet | `src/ui/waystones/waystones-hud.js`, `public/styles/waystones.css` | UI |

- **One GameState for the whole road.** The report warned that piece ids are counted per
  state, so a board copied into a new state merges old pieces into new ones. The mode
  never copies: the session's GameState lasts five stops, banking keeps its pieces as they
  are, releasing restores an empty board through `restoreBoardState`. `disableLevelProgression`
  holds the climate's speed; each stop resets the baseline (drop interval, lock delay,
  mirror, combo multiplier) before applying its own modifiers, so no stop inherits the
  last one's weather.
- **A top-out is not a game over.** As in Fault Lines, `spawnPiece` marks the session over
  and the game loop would stop drawing; the mode clears the flag, returns the blocked piece
  to the pool, spends a lantern, plays the board's death beat and clears the well.
- **The world switches in play** through `themeManager.switchTheme`, the same call Single
  Player's "Level" background mode makes mid-run. The board waits (no piece in hand) until
  the switch resolves; a failed switch is logged and the stop goes on in the old world.
- **The road is seeded** from the session's seed (`options.roadSeed` overrides it), with
  its own mulberry32 streams for the road and each stop's draft, so a seed can be shared
  and replayed; the piece bag stays on the session RNG.
- **The mode stays headless**: it publishes `EVENTS.WAYSTONES_STATE` and takes
  `EVENTS.WAYSTONES_COMMAND`; the HUD draws one and sends the other. The only theme import
  is `theme-registry.js` (names), which the boundary rule already allows.
- **Nothing reaches Records, Steam stats or leaderboards.**

## Verified

- Unit (`tests/unit/waystones-*.test.js`): the climates name only rules that exist and
  cover every goal type; a seed draws the same road, offers never repeat within a stop, the
  Keeper asks more, banking raises the ask, Keel lowers it, the draft never offers a charm
  held; the run model's phases, tolls, charms, lanterns, Hearth and the Keeper; the mode on
  a real GameState (the road from the world on screen, a climate applied and reset, a stop
  completed by the game's own bot, bank and release on the board, the world switch, a
  top-out's lantern, Ember's pay, the Keeper, setting out again, commands out of turn).
- **The certifier** (`waystones-certifier.test.js`): every climate's ask, before and at the
  Keeper, is reached by the game's own bot (`findReachablePlacements` + `rankCandidates`)
  on a live GameState within a piece budget, so no road asks for what the rules cannot give.
- In the real game (Vite dev server, headless Chromium, the Forest theme on its WebGL2
  fallback): the menu card and stage behind the flag, a stop played to its goal by a bot
  through the mode's own input path (`_applyCommand`, so Mirror pool's reversal is
  exercised), the between-stops sheet with its three choices and both asks per offer,
  banking (11 rows, +660, the next ask 2,000 → 2,900), a charm, the next world with the
  stack carried in, Mist's fogged queue, a lantern lost and the well cleared, the road's end
  and setting out again, and the portrait strip, which grows for the sheet and the summary.
  That pass caught the card not being bound to the mode (`game-mode-ui.js` maps cards by
  id, with two more id lists in `main.js` and `focus-pause.js`), a stop's "LEVEL UP" board
  banner (dropped; the chime stays) and two clipped buttons.

## Before it ships unflagged

1. **Owner playtest and tuning.** The asks, the toll, the charm rates and the climate pairs
   are first guesses; the lite build is the instrument for tuning them. The kill criterion
   agreed beforehand: after five runs, wanting a sixth, and being able to name a
   Bank-or-Release decision got wrong.
2. **Name clearance.** "Waystones" is also a Path of Exile 2 term; it ships under a working
   name until checked. The vocabulary avoids Journey, Zone and Mystery.
3. **Menu art.** `public/assets/menu-art/waystones.webp` is a capture; replace it with
   curated art.
4. **Gamepad.** The sheet is keyboard and pointer; the pad should drive it as Fault Lines'
   does its panel.
5. **The full road** from the study, in order of value: charms that move objectives, omens,
   a shrine every third stop, the Keeper as a trial, a daily road, and the physics dialects
   (Frost, Lift, Vine) once the cascade cutover lands.
6. **Steam rich presence** has no token for it yet.
