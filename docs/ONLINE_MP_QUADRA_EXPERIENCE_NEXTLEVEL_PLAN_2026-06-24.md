# Online MP — The Quadra Experience, Compared & Leveled-Up (2026-06-24)

**Goal:** take Serenity Blocks' online multiplayer to a best-in-class UX with the
functionality Quadra is loved for — **start without waiting for everyone**, **drop-in
mid-game**, **a clean rematch/restart loop**, and **watch-only spectating** — plus the
performance foundation to make it all cheap.

**Method:** a 15-agent adversarially-verified workflow read the real Quadra C++ source
(`C:/Users/olovm/repositories/quadra/source`) and Serenity's `src/` line-by-line across
five axes, cross-checked by my own reading of `game.cc`, `game.h`, `canvas.h`,
`net_server.cc`. Every claim below cites code.

---

## TL;DR — the one insight that makes this cheap

**Serenity's host already serializes and broadcasts EVERY player's full board in every
30 Hz snapshot** (`buildStateSnapshot`, ffa-p2p-game-state.js:2115; binary codec v5).
Quadra had to invent a whole watcher-routing + state-download protocol to do what
Serenity gets for free. So:

- **A spectator is nearly free** — it's a client that consumes the snapshot stream and
  renders all boards, but is never added to the simulated roster. The data already flows.
- **A late joiner is "spectate, then spawn next round"** — it watches via the same stream,
  then the host seats it at the next round boundary. The `queueResync`/download-join
  machinery to hand it a baseline **already exists** (it's used for reconnect).

**Architectural verdict (unchanged from prior audits): KEEP host-authoritative + client
prediction. Do NOT migrate to Quadra-style lockstep.** Quadra's determinism is bought with
a fixed-point, single-seed, frame-stepped sim; Serenity's sim is float/RAF/async and shared
with single-player — a lockstep rewrite would be an XL change that silently desyncs and is
strictly worse for this feature set. Everything below is additive to the existing model.

---

## Architectural contrast (verified)

| | **Quadra** (C++) | **Serenity Blocks** |
|---|---|---|
| Topology | Dedicated/loopback **server**; a `Game` *is* the room and survives matches | **P2P, host-is-a-player**; separate lobby (`lobby-waiting-room.js`) and match (`ffa-p2p-game-state.js`) |
| Sim model | Deterministic **lockstep**: shared seed reconstructs every board; only **inputs** travel during play | Host-authoritative **full-board snapshots** @30 Hz + client prediction (`peerLocalSim`) |
| Lobby = game? | **Yes** — `paused=true, delay_start=500` IS the waiting state (game.cc:223-226); no "ready" flag exists | **No** — `gamePhase 'waiting'→'playing'`; per-player `isReady` |
| Start gate | Server starts on a **countdown** gated only by *optional* `server_min_players` (net_server.cc:498-526); host always allowed | **Hard all-ready barrier**: `readyCount === players.length` or `alert()` (lobby-waiting-room.js:644-647) |
| Join while playing | **Always allowed** unless `terminated` (net_server.cc:351-354); `Net_pendingjoin` uploads a full `P_DOWNLOAD` per canvas at the round boundary | `addPlayer` has **no gamePhase gate and no cap**, but **nothing wires a browser join into a live match**; `downloadJoin` path exists but is OFF (ffa-p2p-game-state.js:357) |
| Spectator | **First-class** `Canvas::watchers` (canvas.h:63); server routes a board's packets only to its watchers (net_server.cc:549-583) | **None** — only `OpponentWatchManager` (watch opponents *while you play*) |
| Rematch | `auto_restart` + `Game::restart()` (game.cc:267-332): reset in place, **new seed**, `delay_start` countdown, un-join→re-join, **room persists** | `restartMatch`/`restartFullGame` reset in place; results modal exists; but **two restart impls**, an orphaned vote path, and a heartbeat/restart race |
| Wire | Server relays selectively (per-watcher) | base64-in-JSON envelope (~33% inflation), same full snapshot fanned to every peer (steam-networking.js:478) |
| Replays | **Yes** — recordings are replayable input streams (recording.cc) | **None** |

---

## Axis-by-axis: verified gaps & the fix

### 1. Start without waiting for everyone
- **Quadra:** no ready flag; host triggers a server-side `delay_start` countdown, stragglers
  stream in. Optional `server_min_players` is the only gate.
- **Serenity:** `startMatch()` hard-rejects unless **every** joined player is ready
  (lobby-waiting-room.js:644-647), and each side runs an **independent local 5 s countdown**
  (no shared start-tick → drift risk).
- **Fixes:**
  - **A1 · Host "Start anyway" override** `[P1 · S · low]` — enable START at `players.length≥2`
    with a "Start anyway (N not ready)" label; remove the hard reject (keep the `<2` guard).
    Unready peers get `LOBBY_GAME_START` + seed and simply start. Pair with the per-round
    ready-barrier (`readyBarrier=1`) so the first round still syncs.
  - **A3 · Host-authoritative shared start-tick** `[P1 · M · med]` — host stamps
    `startAtEpoch = now + countdownMs` into `LOBBY_GAME_START`; both sides compute remaining
    from it (no fixed local 5 s). Optional `CANCEL_START` (mirrors Quadra `delay_start→0`).
  - **A2 · Enforce `maxPlayers`** `[P2 · S · low]` — `addPlayer` guard: reject non-local,
    non-reconnect joins past `matchConfig.maxPlayers||8` (spectators bypass). Today the cap is
    advisory and a 9th player wraps the 8-colour palette (ffa-p2p-game-state.js:500).

### 2. Join-in-progress (drop-in)
- **Quadra:** `Net_pendingjoin::step` (net_server.cc:654-764) **defers the join until a
  quiescent barrier** — `syncpoint == Canvas::LAST` (round boundary) AND every canvas idle —
  then uploads a `Packet_download` per player (full grid + **canvas RNG seed** + current/next
  pieces) and announces the slot. Cheap because the sim is deterministic thereafter.
- **Serenity:** unfinished & fragmented. `addPlayer` (471-540) doesn't call
  `initializePlayerForMatch`, so a mid-match joiner would get a fresh `GameState()` whose
  `randomGenerator` is never seeded (its piece stream won't match the host). The
  download-then-stream fence (`downloadJoinPeers`, `_sendResyncToPeer`, `_applyResyncState`,
  `skipPeers`) exists and is unit-tested but is **OFF by default** and wired for reconnect.
- **Fixes (do these in order):**
  - **C1a · Restore RNG state in the resync** `[P0 · M · med]` — make `createSeededRNG`
    (2002-2012) expose `getState()/setState()`; carry per-player `rngState` in
    `buildStateSnapshot` + the binary codec (bump version). Without this the joiner's pieces
    diverge from the host.
  - **C1b · Initialize the late joiner before loop registration** `[P0 · M · med]` — when
    `isHost && gamePhase==='playing'`, `addPlayer` calls a new `initializeLateJoiner()` that
    sets `matchConfig/sharedSeed/roundGeneration` and runs `initializePlayerForMatch` **before**
    `syncUnifiedLoopPlayers`, then `queueResync`. No more undefined-RNG tick.
  - **C2 · Gate the JOIN on the existing syncpoint barrier** `[P1 · M · low]` — Serenity already
    computes `syncpoint='busy'` when any board is mid-physics (`_computeSyncpoint` 2088-2092);
    queue the join in `pendingJoins` and admit it from the same drain point as
    `_processPendingResyncs`. This is Quadra's `Canvas::LAST` barrier.
  - **C3 · Policy: "watch, then spawn at next round"** `[P1 · L · low]` *(recommended drop-in
    UX)* — a mid-round arrival joins as a **spectator** (Axis 3), receives the live stream, and
    the host seats it as an active board on the next `GAME_ROUND_START`. Dramatically lower risk
    than spawning into a running round, and matches the casual feel.
  - **C4 · Finish + enable `downloadJoin`, validate on 2 machines** `[P2 · XL · high]` — close
    the live-vs-resync ordering race (reject live snapshots with `simTick < resyncSimTick` after
    `_applyResyncState`) and prove it over real Steam P2P loss/jitter. Only needed if we want
    *immediate mid-round* live entry beyond C3.

### 3. Spectator / watch-only — **the headline "free" win**
- **Quadra:** `P_CLIENTSTARTWATCH` attaches a `Watcher` to a Canvas; the server forwards only
  that board's packets to its watchers (net_server.cc:549-583). Zero input, no canvas owned;
  dead players keep watching.
- **Serenity:** no spectator role; but `buildStateSnapshot` already carries every board and
  `OpponentWatchManager` already renders up to 4 with interpolation, dirty-checking, dead-fill,
  and clear-flash overlays.
- **Fixes:**
  - **B1 · `MATCH_DESCRIPTOR` handshake** `[P2 · M · low]` *(prerequisite for B/C)* — one
    authoritative reply to a JOIN/HELLO bundling `gamePhase, roster (id/name/color/isReady/
    isSpectator/frags), sharedSeed, roundGeneration, matchConfig, startAtEpoch`. Replaces
    stitching `NET_WELCOME` + `LOBBY_GAME_START` + player-list; lets the browser show live status.
  - **B2 · First-class `isSpectator` role end-to-end** `[P1 · M · med]` — flag join→host
    (`handleJoinLobby({asSpectator})` → `announceJoin spectator:true` → host adds to a
    `spectators` Set instead of `players` + `queueResync`). Spectators are **excluded** from
    `readyCount`, win/elimination, attack routing, and the ready-barrier; they never run local
    prediction or send input (skip `_configureLocalInputHooks`). Reuse `queueResync` as the
    Quadra `P_DOWNLOAD`.
  - **B3 · Full-roster spectator layout** `[P1 · M · low]` — in `OpponentWatchManager`, a
    spectator mode that shows ALL players (don't filter `localPlayerId`), grid up to 8, reusing
    the existing interpolator/renderer/flash. Click-to-focus a board.
  - **B4 · Lobby "Watch" entry + eliminated→spectator** `[P1 · S · low]` — a Watch button beside
    Join (`lobby-browser.js`); eliminated players can convert to the spectator layout (data is
    already arriving). Show a spectator count.
  - **B5 · Spectate-after-death** `[P1 · L · med]` — on local death, instead of tearing down
    rendering, switch the board to the spectator layout fed by the same snapshots (gate `?ffaSpectate=1`).
  - **B6 · Bandwidth throttle + migration lifecycle** `[P2 · M · med→high]` — send spectators at
    ~15 Hz (interpolated anyway) via the `skipPeers` mechanism; on host migration, spectators
    re-handshake but are **never** migration candidates.

### 4. Game-over → restart / rematch (the user's "good restart process")
- **Quadra:** room persists; `check_end_game` → 15 s "famous last words" window → `auto_restart`
  → `Game::restart()` (reset in place, **new seed**, `delay_start` countdown, un-join→re-join).
- **Serenity:** richer results UX (`MatchResultsModal`: champion, stats, kill feed, chat) **but a
  fragmented restart layer**: two restart impls (`restartMatch`/`restartFullGame` vs
  `startNewMatch`/`performRoundRestart`), an **orphaned rematch-vote** path the modal doesn't
  wire, a heartbeat/restart false-migration window, and an RTT race where a same-generation host
  snapshot can clobber a peer's fresh reset.
- **Fixes:**
  - **A4a · Collapse to ONE canonical restart path** `[P0 · M · med]` — delete
    `performRoundRestart`/`startNewMatch`; route every trigger (auto round-over, host Play Again,
    rematch threshold) through `restartMatch`/`restartFullGame` (they already own the
    ready-barrier + `roundGeneration` fence). Add a test asserting a single emitter of
    `GAME_ROUND_RESTART`.
  - **A4b · Re-arm heartbeat at ready-barrier START** `[P0 · S · low]` — call
    `startHeartbeatLoop()` right after `stopStateSyncLoop()` in the restart paths (idempotent),
    not at finalize, closing the round-start false-migration window.
  - **A4c · Restart-race guard** `[P1 · M · med]` — on `GAME_ROUND_RESTART` a peer sets
    `_awaitingRoundStart=true` and `_applySnapshotState` drops/queues ALL snapshots (even
    `gen==current`) until `GAME_ROUND_START` (or the peer fallback timer) — the ready-barrier
    becomes the sole resume gate (Quadra `WAITFORRESTART`).
  - **A4d · Real "Play Again" + host-idle auto-advance** `[P0/P1 · M · med]` — wire the modal:
    host one-click **Play Again** → canonical restart; broadcast a `GAME_RESULTS_DEADLINE` so all
    clients show the same countdown; on host-idle timeout **return everyone to the lobby**
    (don't force unwilling players into a rematch). Either wire the vote subsystem to the modal
    (live tally) **or** relabel/remove it — see Decisions.

### 5. Netcode & performance foundation
- **Quadra:** inputs-only during play; server relays per-watcher (bandwidth scales with interest);
  recordings double as replays + spectate.
- **Serenity:** full snapshot already carries every board (→ spectator free); `peerLocalSim`
  gives Quadra-like local ownership; demo-replay-determinism test already proves the shared-seed
  LCG is bit-identical per spawn. Gaps: no replay, base64-in-JSON ~33% inflation, no admin
  controls, `simTickNetcode` (fixed-tick input replay) built but OFF.
- **Fixes (Phase D):**
  - **D1 · Native binary Steam P2P transport** `[perf · M · med]` — drop the base64 envelope for
    log/snapshot payloads if steamworks.js 0.4.0 exposes raw binary send (open question).
  - **D2 · Replay / demo recording** `[L]` — record the snapshot stream (simple, larger) now;
    input-stream recording (compact, needs the LCG) later. Doubles as spectate seed.
  - **D3 · Admin controls** `[M]` — host kick / pause / drop with polite messaging; spectator
    count + team-scoped chat.
  - **D4 · (optional) `simTickNetcode`** `[XL · high]` — fixed-tick input replay for
    bit-deterministic *opponent* boards (removes RTT staleness). Touches shared physics; gate hard.

---

## Staged roadmap (recommended order)

Ordered for **incremental, low-regression delivery** — each phase is independently shippable and
flag-guarded, consistent with the project's MP convention. ⚠️ = needs 2-machine Steam validation.

### Phase A — Lobby & restart polish (mostly host-only, low risk) — **do first**
| Item | P | Effort | Risk | Status |
|---|---|---|---|---|
| A1 Host "Start anyway" override | P1 | S | low | ✅ SHIPPED (inc 1) |
| A2 Enforce `maxPlayers` on join | P2 | S | low | ✅ SHIPPED (inc 1) |
| A3 Host-authoritative start-tick countdown (+cancel) | P1 | M | med | ⏸️ DEFERRED (see below) |
| A4a Collapse to one restart path | P0 | M | med | ✅ SHIPPED (inc 1) |
| A4b Re-arm heartbeat at barrier start | P0 | S | low | ✅ SHIPPED (inc 1) |
| A4c Restart-race snapshot guard | P1 | M | med | ✅ SHIPPED (inc 2) |
| A4d "Play Again" + results auto-advance | P0/P1 | M | med ⚠️ | ✅ SHIPPED (inc 2) |

**Phase A increment 1 — SHIPPED 2026-06-24** (working tree; suite 537/538, only the pre-existing Odyssey
terrain fail; 10 new unit tests; A1 verified live in the 2-window harness):
- **A1** — `lobby-waiting-room.js` `updateControls()`/`startMatch()`: removed the all-ready gate; host
  START is enabled at ≥2 players with a "🚀 Start anyway (N not ready)" label; unready peers still get
  `LOBBY_GAME_START` + seed. *Verified live: host started with an unready peer; both reached `playing`, no errors.*
- **A2** — `ffa-p2p-game-state.js` `addPlayer`: host rejects remote joins past `matchConfig.maxPlayers||8`
  (sends new `MessageTypes.JOIN_REJECTED`); local + reconnect always admitted; non-host never gates.
- **A4a** — deleted the inferior `startNewMatch()` (no barrier, no host-stamped generation); `checkRematchThreshold`
  now routes the rematch-vote to the canonical `restartFullGame()`. `performRoundRestart` (the peer-side
  `GAME_ROUND_RESTART` handler — the plan's "delete it" was wrong) is **kept**.
- **A4b** — `restartMatch`/`restartFullGame` now call `startHeartbeatLoop()` (idempotent) right after
  `stopStateSyncLoop()`, so the host keeps beating through the barrier/countdown wait (no false-migration).
- Tests: `ffa-phase-a-lobby.test.js` (7) + `ffa-round-restart-reset.test.js` A4b assertion.
**Phase A increment 2 — SHIPPED 2026-06-24** (working tree; suite 541/542 same pre-existing Odyssey fail;
A4c/A4d verified live in the 2-window harness, consoles clean):
- **A4c** — `_applySnapshotState` (ffa-p2p-game-state.js ~2708): a peer awaiting the host's authoritative
  `GAME_ROUND_START` (`!isHost && _pendingRoundStart && !forceLocal`) now DROPS every snapshot — even one
  stamped with the new generation — so an out-of-order host frame can't clobber the fresh reset. The
  ready-barrier is the sole resume gate; `GAME_ROUND_START`/the peer fallback timer clears it; `forceLocal`
  (digest resync) bypasses. 4 unit tests (sentinel-based: drop while pending / apply when not / forceLocal
  bypass / host-not-gated).
- **A4d** — results host-idle auto-advance + the host's Return-to-Lobby now brings peers. New
  `MessageTypes.RETURN_TO_LOBBY`; `_handleReturnToLobby` (host) broadcasts it then returns locally; a peer
  handler runs `_returnToLobbyLocal` (no re-broadcast). `_handleMatchResults` arms a 45 s host-idle timer →
  auto Return-to-Lobby (NOT auto-rematch — never forces unwilling players); cancelled on Play Again / Return
  / Exit. The modal shows a cosmetic "Returning to lobby in N s" countdown for all clients. **Verified live:
  host Return → peer followed to the lobby, both `waiting`.** Play Again was already wired to `restartFullGame`.
- **Regression fixed (caught by review of inc 1's flow exposure):** `networkStats` is nulled on
  `_cleanupGameRendering`; the now-reachable late snapshot/pong after return-to-lobby crashed on a null
  `rttMs` write. Added `_ensureNetworkStats()` (null-safe lazy create) in `snapshotHandler`/`pongHandler`.
  Re-verified: peer console clean after the flow.

- **A3 — DEFERRED (deliberate):** the only real divergence is an ~RTT start offset (durations already match);
  fixing it properly needs cross-machine clock sync or an explicit host "GO" restructuring the **initial-start
  path** (highest blast radius — every match flows through it) for a gain that `peerLocalSim`'s caught-up
  reconcile already absorbs. Not worth the risk in Phase A. Revisit only if start desync is observed on 2 machines.

This delivers the user's **"good restart process"** + start-without-everyone immediately, and
hardens the round-2+ stability the prior audits flagged.

### Phase B — Spectator mode (the marquee feature; the data is already there)
| Item | P | Effort | Risk | Status |
|---|---|---|---|---|
| B1 `MATCH_DESCRIPTOR` handshake (prereq) | P2 | M | low | ⏸️ deferred (reused LOBBY_GAME_START instead) |
| B2 `isSpectator` role end-to-end | P1 | M | med ⚠️ | ✅ SHIPPED (inc 1) |
| B3 Full-roster spectator layout | P1 | M | low | ✅ SHIPPED (inc 1) |
| B4 Lobby "Watch" + eliminated→spectator | P1 | S | low | ✅ SHIPPED (inc 2) — lobby Watch button + `?localMp=watch` (the eliminated→spectator role IS B5) |
| B5 Spectate-after-death | P1 | L | med | ✅ SHIPPED (inc 2) |
| B6 Bandwidth throttle + migration lifecycle | P2 | M | med→high ⚠️ | ⏸️ deferred (scale-only + needs 2-machine) |

**Phase B increment 1 — SHIPPED 2026-06-24** (working tree; suite 547/548 same pre-existing Odyssey fail;
6 new unit tests; verified LIVE in a 3-window harness — host + peer playing, a `?localMp=watch` window joined
mid-match and rendered both boards, consoles clean on all three).
- **The load-bearing design:** a spectator is a connected peer that is NEVER in `this.players`. Because every
  host-side system (ready-barrier, win/elimination, attack routing, `syncUnifiedLoopPlayers`, host-migration
  candidacy) iterates `this.players`, keeping spectators out of it **auto-excludes them everywhere** — no
  per-system branches needed. The host already streams every board, so the spectator just renders the stream.
- **B2 (`ffa-p2p-game-state.js`):** constructor `(net, id, {asSpectator})` → `isSpectator` + `spectators` Set,
  skips the local-player auto-add; `announceJoin` carries `asSpectator` in NET_HELLO + LOBBY_PLAYER_JOINED;
  both host handlers call `_registerSpectator` (adds to `spectators` not `players`; broadcasts roster +
  `queueResync` baseline; if already `playing`, sends the spectator `LOBBY_GAME_START` to set up mid-match;
  idempotent); `startMatch` skips `initializePlayerForMatch`/`startGameLoop`/countdown for a spectator
  (`beginPlaying()` goes straight to live); `sendInput` hard-returns for a spectator (authoritative gate).
- **B2 client (`OnlineMultiplayerMode.js`):** `handleJoinLobby(id, {asSpectator})` threads the flag + skips
  `_configureLocalInputHooks`; `_setupMatchUI` shows a "👁 SPECTATING" placeholder instead of `_createMainBoard`
  (`mainBoardScene=null`); `_activateMatch` skips `_hookInputs`. All existing local-board/`mainBoardScene`/
  `myState` derefs were already guarded, so the spectator's snapshot path is crash-free.
- **B3:** spectator sets `opponentWatchManager.maxVisible = 8` (its `localPlayerId` isn't in the roster, so the
  existing local-filter is a no-op → it shows the WHOLE roster, "WATCHING N/8").
- **B4 (partial):** `?localMp=watch` harness entry (+ `window.localMpWatch`); `isLocalMpTestMode` & skip-intro
  recognise `watch`. Lobby "Watch" button + eliminated→spectator deferred to inc 2.
- **Adversarial review:** CLEAN on all 9 items + the spectator runtime crash-path audit + host-migration/
  ready/rematch exclusion. Found one low-severity leak — `removePlayer` early-returned for a disconnecting
  spectator (not in `this.players`), leaving it in the `spectators` set forever — **now FIXED** (`removePlayer`
  deletes from `spectators` first; 2 added unit tests).
- **Deferred to inc 2:** B5 spectate-after-death, B6 bandwidth throttle + host-migration spectator re-handshake,
  lobby "Watch" button + eliminated→spectator UI, a proper `MATCH_DESCRIPTOR` (reused `LOBBY_GAME_START` instead).

**Phase B increment 2 — SHIPPED 2026-06-24** (working tree; harness-verified live, consoles clean on host/peer/
spectator; OnlineMultiplayerMode + lobby-browser node-parse-checked; ffa-spectator suite 8/8).
- **B5 spectate-after-death:** when the LOCAL player is eliminated, `_showDeathAnimation` (the local-death
  convergence point, `_deathShown`-guarded) calls `_enterDeadSpectate()` — saves the current `maxVisible`, bumps
  the watch grid to the full roster (`maxVisible=8` + `autoSelectOpponents`), adds a `dead-spectating` class — so
  the eliminated player watches everyone still alive instead of just the 4-up beside their dead board. `_clearDeathState`
  (the revive point) calls `_exitDeadSpectate()` which restores the saved `maxVisible`. Pure spectators skip it
  (already full-roster). VERIFIED LIVE: on the peer, the grid flipped 4→8 + class on, then reverted to 4 on exit.
- **B4 lobby "Watch" button:** `lobby-browser.js` renders a `👁 Watch` button per lobby (even non-joinable
  full/in-progress ones) → `joinLobby(id, {asSpectator:true})` → `onJoinLobby(id, {asSpectator})` → the mode's
  `handleJoinLobby(id, options)` (already spectator-aware from inc 1). Normal Join is unchanged (no options =
  `asSpectator:false`). Listeners read `e.currentTarget.dataset` (button carries `data-lobby-id`).
- **B6 deferred:** the spectator bandwidth throttle's value (host-upload relief) is scale-only (many spectators)
  and untestable on one machine; the host-migration spectator re-handshake is ⚠️ 2-machine. Revisit with real
  multi-machine spectator load.
- **Adversarial review:** B4 fully CLEAN; B5 logic CLEAN (idempotent, spectator-guard, revive flow). It caught a
  real **layout bug** — `maxVisible=8` but `.watch-grid` was a hardcoded 2×2 (4 cells), so the 5th–8th boards
  rendered clipped off-screen (also affected the **inc-1 pure spectator**; my 2-player test never exposed it).
  **FIXED:** new `.watch-grid.full-roster` CSS (2 cols × 4 rows = 8; + a 4×2 wide-screen variant) toggled via a
  new `OpponentWatchManager.setMaxVisible(n)` (sets maxVisible + the class + re-selects); all three call sites
  (spectator setup, dead-spectate enter/exit) route through it. Also initialised `isSpectator/_deathShown/
  _deadSpectating/_preDeathMaxVisible` in the constructor. **Verified live:** spectator grid computed style is now
  2 cols × 4 rows (8 cells), `full-roster` class present, console clean.

### Phase C — Drop-in mid-match join (depends on Phase B spectator + determinism P0s)
| Item | P | Effort | Risk | Status |
|---|---|---|---|---|
| C1a Restore RNG state in resync | P0 | M | med ⚠️ | ✅ SIDESTEPPED — round-boundary shared-seed reset re-inits aligned (no mid-round RNG surgery) |
| C1b Initialize late joiner before loop reg | P0 | M | med | ✅ N/A — joiner is `isAlive:false`; the loop skips dead/uninitialized boards (verified) |
| C2 Syncpoint-gated join admission | P1 | M | low | ✅ N/A — joiner never simulated until the next round restart, which is already syncpoint-clean |
| C3 "Watch then spawn next round" policy | P1 | L | low | ✅ SHIPPED (inc 1) |
| C4 Finish + enable `downloadJoin` (immediate live entry) | P2 | XL | high ⚠️ | ⏸️ deferred (not needed for C3; immediate mid-round live spawn only) |

**Phase C increment 1 — SHIPPED 2026-06-24** ("join-as-dead, revive at next round" — the recommended low-risk
drop-in policy). A 27-agent-verified terrain map confirmed the load-bearing facts: `restartMatch`/`restartFullGame`
re-init EVERY player with the shared seed (so a late joiner spawns aligned at the next round, **no mid-round RNG
surgery** — C1a/C1b/C2 fall away), and the unified loop **skips `isAlive===false` / `!currentPiece` boards**
(so a dead, uninitialized joiner is never simulated → no null-RNG crash).
- **Host (`addPlayer`):** `midMatchJoin = isHost && !isLocal && gamePhase==='playing'` → adds the joiner `isAlive:false`
  and sends it `LOBBY_GAME_START { inProgress:true }`. The A2 cap and the reconnection-revive both still run first.
- **Client (`startMatch(seed, config, {inProgress})`):** skips `initializePlayerForMatch` (no board spawn) + the
  countdown, marks the local player dead. The full player UI is still built (main board + input), so no
  spectator→player transition is needed — the board is just empty/dead until revive.
- **Watch view:** `_handleStateUpdate` enters the full-roster spectate view (B5 `_enterDeadSpectate`) when the
  local player is observed dead with no elimination animation (snapshot-driven — robust to the join-time race).
- **Revive:** the next `restartMatch` revives all + re-inits with the shared seed → the joiner spawns aligned;
  `ROUND_RESTART → _clearDeathState → _exitDeadSpectate` returns it to normal play.
- **Tests:** `ffa-spectator.test.js` drop-in cases (host adds dead + inProgress; lobby join stays alive; local
  never mid-match). Suite 552/553 (only the pre-existing Odyssey fail).
- **Verification status:** host-side live-verified (one clean 3-window run: late joiner connected mid-match →
  added `isAlive:false`, no board, roster of 3) + the watch-view flip confirmed live. The full single-shot auto
  end-to-end (join → watch → revive-spawn) could NOT be captured in one run due to **accumulated mock-transport
  flakiness** this session (intermittent late-join handshake — a documented mock limitation; the A2 cap also
  correctly rejected over-cap joins). Needs a **fresh-session or 2-machine** run to sign off the revive-spawn.
- **Adversarial review: CLEAN on all 6 seams** (addPlayer drop-in, startMatch inProgress, LOBBY_GAME_START
  handler, snapshot-driven dead-spectate, `_activateMatch` fast-path, and the host+peer+UI revive path) + win-
  condition safety. "Highest-risk element: none." The null-RNG/uninitialized-board revive path is blocked by
  TWO independent loop guards (`isAlive===false` / `!currentPiece`) + the synchronous round-boundary re-init
  barrier. Noted (not a bug): a joiner in a single *decisive* round (no restart) stays dead-watching until the
  match ends — acceptable by design (they joined too late for that round; they still watch + see results).

**Phase C discoverability fix — SHIPPED 2026-06-24.** The drop-in was implemented but only *reachable* via
"Join by ID" — the lobby list disabled the Join button for `status==='playing'`, so a player browsing the list
saw only "Watch" for an active match and never discovered they could drop in. Closed:
- **`lobby-browser.js` `renderLobbies`:** an in-progress lobby WITH a free slot (`status==='playing' && current
  < max`) now renders an enabled **"Join (next round)"** button (class `btn-join btn-dropin`) that reuses the
  existing `.btn-join` → `joinLobby(id)` → `handleJoinLobby(id, {asSpectator:false})` drop-in path. Full or
  finished in-progress lobbies stay disabled ("Full"/"Finished"); the 👁 Watch button is always present.
- **`OnlineMultiplayerMode.js`:** a drop-in joiner now sees a "⏳ Joined mid-match — you'll spawn next round"
  banner over its empty board (`_showDropInWaitingBanner` in `_enterDeadSpectate`, gated on *not* a spectator and
  *not* eliminated so it never collides with the ELIMINATED overlay; `_hideDropInWaitingBanner` on revive).
- **Verified live** (DOM logic, no transport): button states for open / playing-with-room / playing-full /
  finished all correct; "Join (next round)" click → `handleJoinLobby(id, {asSpectator:false})` (drop-in), Watch
  → `{asSpectator:true}`, exactly one call each (no double-fire from the dual class); banner shows/hides; console
  clean. `node --check` clean on both files; `ffa-spectator` suite 15/15.

**Phase C discoverability fix — DEEPER LAYER (2026-06-24, after the user reported seeing neither Join nor Watch
at `?localMp=join`).** A 5-agent diagnostic workflow (wowhiov67) + adversarial review (4 findings, all fixed)
exposed that the button work above was necessary but NOT sufficient — two layers were still broken:
- **The host never advertised match status.** The mock lobby was hardcoded `currentPlayers:1` with NO `status`
  field, never updated; the real-Steam `getLobbies` mapped a fixed field set with no status. So the browser's
  `getLobbyStatus()` only ever derived `'open'`/`'full'` from count — `status==='playing'` was DEAD everywhere,
  and a started host showed plain "Join", never "Join (next round)". **Fixed:** host-only
  `FFAGameStateP2P._advertiseLobbyState()` maps `gamePhase` → `'open'|'playing'|'finished'` and writes status +
  live player count, called from `broadcastPlayerList()` (every roster change — all 13 callers are event-driven,
  NOT in the game loop) + `startMatch`'s `beginPlaying()` (match-start) + `frag-tracker.endMatch()` (the host's
  authoritative match-end → `'finished'`, so a late arrival can't drop into an over match during the results
  window — it shows disabled "Finished" + Watch). Return-to-lobby (`_returnToLobbyLocal` → gamePhase `'waiting'`
  → `resetReadyStates` → `broadcastPlayerList`) flips it back to `'open'`. `steam-networking.js` gained
  `updateMockLobby` + `setLobbyStatus` (mock localStorage + real-Steam `setLobbyData('status',…)`) +
  `setLobbyPlayerCount` (mock-only; real Steam uses live `getMemberCount`); mock `getLobbies` + electron
  `steam:getLobbies` now surface `status` (electron change ⇒ needs a rebuild for real Steam).
- **The `?localMp=join` harness auto-joins, bypassing the browser** — it polls `getLobbies()` and calls
  `handleJoinLobby()` (which HIDES the browser) directly, so the new buttons (which only render in the browser)
  were never on screen in that path. **Fixed:** new **`?localMp=browse`** role + `window.localMpBrowse()` opens
  the lobby browser WITHOUT auto-joining; harness host `maxPlayers` bumped 2→8 (a 2-player game at the old cap
  was always *full*, so drop-in could never appear). Also fixed a pre-existing harness typo
  `fg.areAllPlayersReady?.()` → `allPlayersReady()` (the real method) that silently disabled `?localMp=host`
  auto-start, and a `LobbyBrowser.show()` interval leak on the double-show browse cold-start.
- **Verified live** (single window, full cycle): `open→Join`, `playing→Join (next round)` (dropin),
  `finished→Finished` (disabled), back to `open→Join` — all with 👁 Watch; status surfaced through `getLobbies()`;
  `show()` twice = one live interval (no leak); console clean; unit suites 36/36. **Test path:** window 1
  `?localMp=host`, window 2 `?localMp=join`, window 3 **`?localMp=browse`** → see "Join (next round)" + Watch.
  (Stale mock lobbies accumulate in `localStorage['serenity_mock_lobbies']` and show plain "Join" — clear the key
  for a clean list.)

### Phase D — Foundation & polish
| Item | P | Effort | Risk | Status |
|---|---|---|---|---|
| D1 Native binary transport (drop base64) | P2 | M | med ⚠️ | ⬜ (open Q: does steamworks.js 0.4.0 expose raw binary send, or is JSON a hard constraint?) |
| D2 Replay / demo recording | P2 | L | med | ⬜ |
| D3 Admin controls (kick) + spectator count | P2 | M | low | 🟡 kick + spectator-count SHIPPED (inc 1); pause/drop pending |
| D4 (optional) `simTickNetcode` bit-deterministic opponents | P3 | XL | high ⚠️ | ⬜ |

**Phase D increment 1 — SHIPPED 2026-06-24** (host KICK + spectator count; working tree; suite 556/557 same
pre-existing Odyssey fail; kick verified live in the 2-window harness; 4 new unit tests).
- **Kick (`ffa-p2p-game-state.js`):** new host-only `kickPlayer(steamId)` — sends the target `PLAYER_KICKED`,
  then removes it IMMEDIATELY (`_finalizeRemovePlayer`, bypassing the 10 s disconnect grace — a kick is
  deliberate) or drops it from `spectators` + re-broadcasts. A new `PLAYER_KICKED` receive handler (all clients,
  host-guarded) emits `MULTIPLAYER_EVENTS.KICKED`; `OnlineMultiplayerMode._handleKicked` tears down to the start
  menu via `_handleExitToMenu` + a **non-blocking** `serenity:toast` (a blocking `alert()` froze the page
  mid-teardown). Host-only kick button (`✕`) on every OTHER player's lobby card. **Verified live:** host kicked
  the peer → host roster 2→1, peer received `KICKED` → tore down to menu + notice, consoles clean.
- **Spectator count:** `getSpectatorCount()` (host = `spectators.size`; peers mirror a `spectatorCount` field
  carried in `broadcastPlayerList`); the lobby ready-progress label shows "· 👁 N watching". Unit-tested.
- **Adversarial review:** CLEAN on all 8 items + mid-match kicks + throw-safety. One low-risk note: the
  `PLAYER_KICKED` handler didn't verify the sender (a peer could spoof a kick — not exploitable for advantage,
  but confusing). **FIXED:** the handler now ignores `PLAYER_KICKED` unless `msg.from === hostSteamId` (only the
  host can kick). 15/15 spectator/kick tests still green.
- **Deferred:** host pause/drop, team-scoped chat, in-match HUD spectator badge.

---

## Decisions for you (recommended defaults baked in)

1. **Drop-in policy** — *Recommended: "watch, then spawn next round" (C3).* Far lower risk than
   live mid-round spawn (C4) and reads as a clean Quadra-like join. C4 only if you want instant
   live entry.
2. **Rematch UX** — *Recommended: host one-click "Play Again" + host-idle auto-return-to-lobby
   (A4d).* Don't force unwilling players into a rematch. The orphaned vote subsystem: **wire it as
   an optional "everyone living voted → auto-start"** or delete it — I lean delete-and-relabel for
   simplicity unless you want vote tallies.
3. **Spectator scope** — boards only first; add chat/KPI ladder to the spectator HUD later.
   Eliminated players auto-offered spectator view.
4. **Scale target** — what's the max realistic spectator count for a home-hosted P2P match? This
   decides whether B6 (15 Hz throttle) is P2 or must be promoted, and whether D1 binary transport
   is needed sooner.

## Verification strategy
- Each item lands flag-guarded with a unit test where logic-testable (roster/ready/restart/RNG-state
  round-trip), mirroring the existing `tests/unit/ffa-*` suite.
- The 2-window mock harness (`?localMp=host|join` + `fg.network.setNetworkImpairment`) covers
  game-logic flows (start-anyway, spectator render, rematch, late-join policy).
- ⚠️ items (download-join over real loss, heartbeat-vs-barrier timing, binary transport, spectator
  fan-out cost) **require a real 2-machine Steam run** before flipping their flags on by default —
  the mock is 0-latency, same-process and cannot surface these.

## Open technical questions (carried from the research)
- Is native binary Steam P2P send available in steamworks.js 0.4.0, or is the JSON envelope a hard
  constraint? (gates D1)
- `HostMigration.HEARTBEAT_TIMEOUT` vs `READY_BARRIER_TIMEOUT_MS + worst-case RTT` — measure on 2
  machines (gates the A4b false-migration fix's margin).
- Does the codec serialize enough per board (next/hold/incoming garbage) for a spectator view to look
  *complete*? (mostly yes — verify hold/incoming).
- Replay format: snapshot-stream (simple, large) vs input-stream (compact, needs the LCG) — or both.
