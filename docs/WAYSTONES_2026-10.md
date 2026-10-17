# Waystones: the road (lite preview, October 2026)

**Status: preview.** The menu lists Waystones only with `?waystones=1` (or
`localStorage['serenity.waystones'] = '1'`), registered in `src/core/flags.js`. This is the
"lite" road from the game-mode study: five stops, the existing rule modifiers plus two
gentle ones, score-leaning charms, lantern lives. It is built to be played and tuned, not
to be finished; what it needs before it ships unflagged is at the end.

## What it is

A seeded road of five stops across the worlds the player has collected. Each stop is one
world under one **climate**: a speed, a few rule modifiers and one ask (lines, points, or
cascades two waves deep, the board's "×2" or deeper). The goal met, the piece in hand is
not dealt again: the road waits while the player **settles the stack** (bank it or release
it), takes a **charm** or not, may **relight a lantern** with points, and **chooses the
next world** from two on offer. Then the world switches, the climate takes hold, and play
goes on with the board as they left it. A top-out costs a **lantern** and clears the well;
the last lantern ends the road. The fifth stop is the **Keeper's**: the same climates, a
bigger ask, and the road ends in the light.

The stack is the inventory, and the economy has one sink so that the choice has teeth.
Banking the stack raises the next ask (a line goal grows by a row per two rows of blocks
carried, a score goal by 4% a row, a cascade goal by one at eight rows or more) and
**pays once that stop is cleared**: 60 points a row, 120 with Tide; a top-out there loses
the stack and the payout with it, and the ask falls back to the base. Releasing it is a
clean well and the base ask. Points buy a lantern back between stops (1,500, once a stop),
so the score charms and the bank are a currency for the one thing a run needs. A stack
that reaches the hidden rows cannot be banked (it would block the next deal), and "rows"
are rows of blocks (cells ÷ 10), so a spire is not a stack. The first stop is always
gentle: a lines ask with nothing bent but, at most, a long breath.

## How it plays

- **Stop one is the world on screen.** The road begins where you stand; the first climate
  bends at most one rule.
- **Climates** (`src/core/waystones/climates.js`), a ladder by how hard the weather is for
  a careful player: Still air (long breath, 12 lines), Clear night (10), Rising wind (fast
  fall, 9), Mist (hidden queue, 9), Crosswind (mirror and long breath, 8), Squall (fast
  fall and mist, 7), Mirror pool (7), Ember wind (chain bonus, 3,500 points), Slow dusk
  (slow fall, 3,000), Deep current (cascades under long breath, 2). Mirror, Fast fall, Slow
  fall and Chain bonus are Odyssey's `ModifierStack` definitions applied the same way, but
  named and described in the road's own words (Odyssey's tooltips speak of level
  progression the road holds still); Mist and Long breath are this mode's. The offer card
  gives each climate's pace in a word (slow, unhurried, steady, brisk) from the same
  arithmetic the mode applies, which a test pins to the GameState.
- **Charms** (`charms.js`), seven: Kindle (a cascade two waves deep scores half again),
  Swell (three or four lines at once score 40% more), Tide (banking pays double), Keel
  (every stop asks 15% less, a cascade stop one fewer), Ballast (a banked stack raises the
  next ask half as much), Hearth (the first top-out of the road costs no lantern), Wick
  (one more lantern). Three are drafted after each stop; one may be taken, and the world
  cannot be chosen until the draft is taken or passed, so a charm is never forfeited by
  accident. The names avoid the climates' words and the lanterns themselves.
- **The panel** beside the well (it replaces Single Player's ledger) shows the stop and its
  climate, the goal with its progress, the lanterns, the road score, the charms held, and
  the road as five stones. A stop cleared is also said on the board ("Stop 2 cleared / The
  road waits", the chain finale's banner). Between stops the panel becomes the sheet of
  four steps (the stack, a charm, a lantern, the world), each offer led by its climate,
  pace and ask with the world as the eyebrow; when both offers share a world the sheet
  says so once. At the end, the summary with **Set out again** (a fresh road), **Walk this
  road again** (the same seed) and **Menu**.
- **Keys.** The sheet is reached with Tab and pressed with Enter; after each choice the
  focus lands on the next step's heading, never on a button, so a held Enter cannot
  choose for you, and a click in the first quarter second after a re-render is ignored so
  a double-click cannot take a charm. Enter alone sets out again once the road has ended.
  The piece keys stay the board's; Mirror pool reverses the moves in the mode, since
  Single Player's input path has no mirror of its own.

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
- **The road holds its world.** Single Player's default background mode ("As you level
  up") asks the theme manager every stats tick to follow a level journey, and the Random
  mode re-themes on a timer; either would have pulled the road's world back the moment it
  changed. The mode holds each world with the scoped permission Odyssey's orbs use
  (`beginOdysseyThemeScope` / `switchTheme(id, false, token)`): while it stands, a switch
  without the token is refused, and `endOdysseyThemeScope` on deactivate gives the player
  their own theme back (their chosen world under "Specific", else the one that was on
  screen). The board waits (no piece in hand) until the switch resolves; the stop's world
  is whatever the switch arrived in, so the panel never names a world the screen lacks,
  and a switch is tied to its run, so a restart mid-switch is never stuck behind it.
- **The road is seeded** from the session's seed (`options.roadSeed` overrides it), with
  its own mulberry32 streams for the road and each stop's draft, so a seed can be shared
  and replayed; the piece bag stays on the session RNG.
- **The mode stays headless**: it publishes `EVENTS.WAYSTONES_STATE` and takes
  `EVENTS.WAYSTONES_COMMAND`; the HUD draws one and sends the other. The only theme import
  is `theme-registry.js` (names), which the boundary rule already allows.
- **Nothing reaches Records, Steam stats or leaderboards.**

## Verified

- Unit (`tests/unit/waystones-*.test.js`, 59 cases): the climates name only rules that
  exist, speak in the road's words, keep a gentle first stop and cover every goal type; a
  seed draws the same road, offers never repeat within a stop, the Keeper asks more,
  banking raises the ask (half as much under Ballast), Keel lowers it (one cascade fewer),
  the draft never offers a charm held; the run model's phases, the bank paid on arrival
  and lost to a top-out, the relight, Wick, Hearth once a road, the Keeper; the mode on a
  real GameState (the world held and given back, every climate's drop interval against
  its card, a stop completed by the game's own bot, bank and release on the board, a stack
  too tall to bank, an empty well settling itself, the world switch under the hold and the
  honest arrival, a switch tied to its run, a top-out's lantern and its fallen ask, a stop
  completing at once when the smaller ask is already met, Kindle's pay, the relight, the
  Keeper, the same road again, commands out of turn).
- **The certifier** (`waystones-certifier.test.js`): every climate's ask, before and at the
  Keeper, is reached by the game's own bot (`findReachablePlacements` + `rankCandidates`)
  on a live GameState within a piece budget, with the climate's scoring modifiers applied
  and the lock bonus zeroed (a seeking clock would otherwise pay the instant-lock maximum,
  50 a piece, and certify the clock rather than the clears).
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
- **The audit** (two independent reviews, code and design, after the first build) and the
  pass that followed. Fixed: the world switch undone by the level journey under the
  default background mode (the hold above; seen in the browser with every world unlocked:
  the road held Forest, switched to Cinder Drift and stayed); the road's world leaking out
  as the session's preferred theme; keyboard focus lost after every sheet step; the
  certifier measuring the lock bonus; banking a stack into the hidden rows (a spiral: a
  lantern on arrival with the raised ask standing); the first stop able to reverse the
  controls or ask for cascades; a charm forfeited by choosing a world; Hearth dominating
  Wick and making a top-out a free wipe; Keel doing nothing on cascade stops; the climate
  copy and Odyssey tooltips describing speed that never rises; the won line's dead branch;
  the last lantern without a death beat and a piece dealt under the veil; a switch not tied
  to its run; the economy with no sink. Left for the playtest, as both reviews advised: the
  line asks and the Keeper's ×1.5, the climate speeds, 60 a row, the charm rates, five
  stops, Mist and Mirror as handicaps, a top-out costing progress, a per-stop piece budget.

## Before it ships unflagged

1. **Owner playtest and tuning.** The asks, the bank's rate, the relight's price, the charm
   rates and the climate pairs are first guesses; the lite build is the instrument for
   tuning them. The kill criterion
   agreed beforehand: after five runs, wanting a sixth, and being able to name a
   Bank-or-Release decision got wrong.
2. **Name clearance.** "Waystones" is also a Path of Exile 2 term; it ships under a working
   name until checked. The vocabulary avoids Journey, Zone and Mystery.
3. **Menu art.** `public/assets/menu-art/waystones.webp` is a capture; replace it with
   curated art.
4. **Gamepad.** The sheet is keyboard and pointer; the pad should drive it as Fault Lines'
   does its panel.
5. **A word on the board when a stop is cleared** says the road waits; a new player may
   still ask "where is my piece?" once. Watch for it in the playtest.
6. **The full road** from the study, in order of value: more charms that move objectives
   (a Mist that shows one piece, carried rows counting half toward a lines ask), omens, a
   shrine every third stop, the Keeper as a trial, a daily road (`dailySeed` exists), and
   the physics dialects (Frost, Lift, Vine) once the cascade cutover lands.
7. **Steam rich presence** has no token for it yet.
