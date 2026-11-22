# 0025 — Versus attack styles: hidden cells, the hot potato's turns, the smallest attacking clear

- **Status:** accepted
- **Date:** 2026-11-22

## Context

The versus attack styles had drifted from how the owner wants them to play:

- **Blind** sent its garbage rows plus a timed dark veil over the garbage; **full blind** a longer
  veil over the whole stack. Both were render-only overlays on a per-board timer, so the board
  under them never changed, and a bot simply stopped while the veil was up.
- **Hot potato** was a timer bomb: hold it 12 s and six penalty rows went off; any clear passed
  it to the next seat.
- Every clear of two lines or more attacked; a match could not ask for bigger clears.

## Decision

All of it is versus rules, local and online alike (`src/core/garbage.js`, `src/core/blind.js`,
`src/core/multiplayer/hot-potato.js`):

- **Smallest attacking clear** (`matchConfig.minAttackLines`, 2–5, default 2): a move clearing
  fewer lines sends no normal rows; a cleared board's bonus is always sent.
- **An attack's rows** are its normal rows (lines − 1, after the crowd cut and the per-opponent
  handicap) plus the clean bonus when the move emptied the board. The **combo** is the clear's
  number of cascade waves. A **blind tick** is 160 ms of the target's game time.
- **Blind:** no rows. Each row hides one of the target's next placed pieces for 30 blind ticks
  from the moment it lands (one `blind` queue entry per piece, counted toward the 20-entry cap,
  taken by the next spawn; rows behind it still go in). The clean bonus is a full blind of
  cleanRows × combo × 12.
- **Full blind:** no rows. Every attack hides every cell on the target's board for
  rows × combo × 12 blind ticks, added onto blind time already there, at most 255; later pieces
  show.
- **Hidden cells are solid.** Blind time is per cell, kept on the locked piece that owns it and
  mirrored onto its grid cells, so line clears, splits, cascades and garbage lifts carry it and a
  cleared cell takes it away. Each board counts it down on its own blind clock, advanced with its
  simulation (fixed ticks and the variable-step loops alike). Only drawing skips a hidden cell;
  the falling piece and its landing shadow stay visible, and a cell that shows again fades in.
  Bots read the board they collide with, hidden cells included.
- **Online:** blind entries reach the target through the garbage queue the peer already adopts;
  host and peer take them at the same spawn with the same function (`takeSpawnBlinds`). A board
  adopted from the host brings its hidden cells (binary format v8 carries them per cell, the
  resync sidecar captures them with the board); a board the peer owns keeps its own.
- **Hot potato:** teams (without teams, every player) take it in a shuffled turn order that never
  repeats a team back to back, reshuffled when used up; a new holder is chosen 2 s after the last
  one got rid of it, or after the round starts. The holding team's attacks deal nothing and add up
  toward its target (2 to start, one more each time the team gets rid of it, 2 again when the team
  has nobody left alive); everyone else attacks only the holding team; with nobody holding it,
  attacks deal nothing. It passes on when the target is reached or the holding team has nobody
  alive; that team's waiting garbage is dropped and its hidden cells show. The online host owns
  it and tells peers the holder, target and rows sent (`GAME_POTATO_UPDATE`); locally it runs on
  game time, so the fixed-tick local clock now plays it too.

## Consequences

- The binary snapshot format moved to v8 and the resync sidecar's game state carries `blind`
  instead of `blindTimers`: builds before this one cannot play online with builds after it.
- The timer-bomb fields (`potatoDurationMs`, `potatoPenaltyLines`), the countdown chip and the
  `GAME_POTATO_DETONATE` message are gone; the end-of-match table counts passes and rows sent
  while holding.
- A blind attack no longer slows a bot down.

## Enforcement

- `tests/unit/versus-attack-modes.test.js` pins every rule above, locally, on the online host and
  host against peer through the binary wire.
- `src/core/__tests__/blind.test.js` and `tests/unit/blind-fixed-tick.test.js` pin the blind clock,
  its cap and its round trip through a checkpoint; `tests/unit/phaser-retained-presentation.test.js`
  pins that hidden cells are not drawn and fade in when they show.
