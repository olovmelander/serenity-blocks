# 0024 — Versus play has one rule set, local and online

- **Status:** accepted
- **Date:** 2026-11-22

## Context

Local and online versus had drifted into three different rule sets, and none matched the
reference game the owner wants versus to play like (Quadra's multiplayer).

**Where these rules came from (corrected 2026-11-24).** An earlier version said they were judged
by how that game plays. That was wrong. With the owner's permission the session that wrote them
read the reference game's published source on 2026-11-22. The code here was written for this
repo, but these numbers were taken from that reading: the frag credit weights and cap, the crowd
stamps, the 20-row limit, and in ADR-0025 the hidden-cell times and the hot potato's targets.
They are due to be replaced by values tuned in this project's own simulator.

What differed:

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
- **Feel** (`applyVersusFeel`; the standard well, local and online, not Last Standing): every
  piece is drawn on its own from the shared seed, not from a bag of seven, and a resting piece
  locks at the next gravity step it cannot take (a soft drop takes it at once) instead of after
  a lock delay that sliding and turning could reset.
- **Frag credit:** each attack adds two per row to its sender's credit with the victim; each
  piece the victim places takes one off every sender. The credit passes to an attacker when one
  of its attacks brings its total level with the holder's or above. In round play the last
  holder keeps it even when spent; a respawning game type forgets a spent holder.
- **Game types** (`readVersusGameType`): **free-for-all** is the default. A knock-out ends no
  round: the frag goes to the credit holder, the player's waiting garbage is dropped, and a key
  of their own pressed a second or more later puts them back on an empty well at the match's
  start level, keeping score, lines and frags (`respawnVersusBoard`); a local bot comes back on
  its own. The frag goal counts kills, a team's being its players' kills. The match runs until
  its goal (online, also until one player is left). **Survivor** keeps rounds: the last player
  or team standing takes the round, then everyone restarts. Infinity's Last Standing has no
  game type and keeps its elimination rules. Online, the host decides a respawn
  (`src/core/multiplayer/ffa/respawn.js`, ADR-0004): a peer asks for its own player only
  (`GAME_RESPAWN_REQUEST`), and the host's event (`GAME_PLAYER_RESPAWN`) is round-fenced,
  numbered per player, carries the board's piece stream, and fences off the snapshots sent
  before it, so a late frame cannot put the player back out.

## Consequences

- A tall side stack is no longer fatal; players dig out of situations that used to end a round.
- Bots were not updated with these rules (corrected 2026-11-24: an earlier version said they only
  play more cautiously). They model the old death rule: they send rows to finish an opponent
  whose tallest column reaches the top, which no longer ends anyone, and fire early at waiting
  rows that no longer kill. Their weights were fitted on bag-of-seven pieces with a lock delay.
  A bot re-fit is separate work.
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
- `tests/unit/local-ffa-respawn.test.js` pins the local free-for-all death, respawn and goal,
  and that survivor keeps its rounds.
- `tests/unit/ffa-respawn.test.js` pins the online free-for-all (no round end, the goal, the
  request's checks, the host's respawn and every client's, the snapshot fence, the piece stream
  in step, a drop-in joining at a key, a respawn after host migration) and that survivor keeps
  its rounds; `tests/unit/online-game-type.test.js` pins the create sheet, the waiting room and
  the knock-out screens.
