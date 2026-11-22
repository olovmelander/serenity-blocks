# 0024 — Versus play has one rule set, local and online

- **Status:** accepted
- **Date:** 2026-11-22

## Context

Local and online versus had drifted into three different rule sets, and none matched the
reference game the owner wants versus to play like (Quadra's multiplayer, judged by how it plays):

- Incoming garbage killed a player on arrival when it lifted any cell, in any column, above the
  visible rows. Online, the host also killed a player whose piece's bounding box touched the top
  visible row after garbage, a stricter rule than local, so one board could live locally and die
  online. The reference game kills only when the next piece cannot appear; a stack may stand
  above the top at the sides.
- Online defaulted to outgoing lines cancelling incoming garbage. The reference game has no
  cancelling.
- Attacks shrank with player count: locally to 75 % with three players and 50 % with four,
  online by 10 % per extra opponent. The reference game keeps attacks whole until more than four
  players are alive.
- Waiting garbage had no limit, and the frag went to whoever attacked last (local) or to the
  sender of the last rows inserted (online).
- Rows that closed when the stack settled into fresh garbage holes were cleared with no credit
  (owner decision 2026-11-18). The reference game counts them as the player's own clear.

## Decision

**Every versus board plays by `src/core/multiplayer/versus-rules.js`** (owner, 2026-11-22):

- **Death:** garbage never kills on arrival (`applyGarbage` with `overflowPolicy: 'spill'`).
  The stack lifts; cells lifted past the board's top row are lost; only a blocked spawn ends a
  player. Infinity keeps its own roof rule, and Odyssey keeps the refusing rule its rising tide
  relies on.
- **Settle clears:** rows a garbage settle completes count as the player's own clear (lines,
  score, level, an attack; `creditSettleClears`). This replaces the 2026-11-18 no-credit
  decision for versus; Odyssey still awards nothing.
- **Waiting garbage:** at most 20 rows (`VERSUS_MAX_PENDING_LINES`); rows past that are dropped.
  Odyssey's bot duels keep their uncapped queue.
- **Cancelling:** off by default online (`garbageCancellation: 'disabled'`); a host may still
  turn it on.
- **Attack size:** each opponent receives the whole attack. With more than four players alive,
  each placed piece earns a crowd stamp (up to three per extra living player) and every three
  stamps take one row off a normal attack. A move that empties the board is never cut; boring
  rules turn the cut off.
- **Frag credit:** each attack adds two per row to its sender's credit with the victim; each
  piece the victim places takes one off every sender. The credit passes to an attacker when one
  of its attacks brings its total level with the holder's or above. In round play the last
  holder keeps it even when spent; a respawning game type forgets a spent holder.

## Consequences

- A tall side stack is no longer fatal; players dig out of situations that used to end a round.
- Bots still weigh pending rows and stack height as before, so they play more cautiously than
  the rule needs. A bot re-fit is separate work.
- The local "No attack scaling" switch was removed: a local match has at most four players, so
  attacks never shrink there.
- The hidden buffer stays at four rows, so cells lifted more than four rows above the top are
  lost sooner than a taller buffer would allow.

## Enforcement

- `tests/unit/versus-rules.test.js` pins the death rule, the overflow, the settle credit, the
  cap, the crowd stamps and the frag credit, locally and on the online host.
- `tests/unit/local-attack-scaling.test.js` and `tests/unit/ffa-attack-scaling.test.js` pin the
  attack size rule.
- `tests/unit/garbage-settle-clears.test.js` keeps the no-credit behaviour for callers that do
  not opt in.
