# Serenity Blocks — Repository Review Plan

**Date:** 2026-06-05
**Reviewer:** Senior engineering review (multi-agent, adversarially verified)
**Scope:** `src/core`, `src/utils`, `src/events`, `src/rendering`, `src/ui`, `electron/`, build scripts & config (the gameplay, networking, anti-cheat, Electron, and infrastructure surface). The 300+ visual theme files under `src/themes` were treated as lower-priority and only sampled.
**Method:** 16 subsystem reviewers read the source directly and reported evidence-backed findings; every finding was then independently re-verified against the code by a separate adversarial agent whose default was to *refute*. **104 findings were confirmed; 38 plausible-but-wrong claims were refuted and dropped.** A handful of the highest-risk files (binary network codec, Electron main/preload, physics, input validation) were additionally read end-to-end by the lead reviewer.

> No code was changed. This document is an investigation and a plan only.

---

## 1. Executive Summary

Serenity Blocks is a large, feature-rich Phaser 4 / Electron Tetris-style game with single-player, a campaign ("Odyssey"), local 1–4 player, and online P2P (Steam) multiplayer. The core game logic (board, physics, scoring, bag) is generally sound — several "obvious" bugs there were investigated and **refuted** (e.g. the Fisher–Yates shuffle in `game.js` is correct; the perfect-clear/cascade pipeline terminates). The real risk is concentrated in three areas:

1. **The P2P trust boundary is effectively absent.** The host is nominally authoritative, but peer-supplied identity, game-state, host-migration, and rematch messages are accepted with little or no origin/authorization checking. The binary snapshot decoder trusts attacker-controlled length/count fields. This enables match hijacking, roster spoofing, remote "kick", forged game state, and decode-cost amplification. Several of these are reachable by *any* lobby participant. (H6, H9, M23, M27, M28, M29)
2. **Two user-facing XSS sinks** render peer-supplied chat **color** strings into `innerHTML` without sanitization — a hostile peer can inject markup/script into another player's client. (H10, H11; related: M75 driver-string injection in the perf overlay)
3. **The "anti-cheat" is largely cosmetic.** `replay-proof.js` validates a score against self-declared metadata in the same blob rather than re-simulating the inputs; the input-rate "too fast" guard is fully commented out; and the main jitter-buffered input path skips validation entirely. (H1, L32, L33, plus the buffered-path note below)

Alongside these, there are genuine **gameplay-correctness** bugs that affect real play: a **second concurrent game loop spawns on every local-multiplayer round restart** (gravity runs at 2×, 3×, … each round — H3); **3–4 player matches can never end** on points/lines win conditions (H4); **score-gated Odyssey stars are unearnable** (H7); and **tall non-infinity Odyssey levels can't be lost** (H8). A network desync bug calls `decodeSnapshot` on the *encoder*, so binary resyncs silently never apply (H5).

The codebase also carries heavy **maintainability debt**: ~440 markdown status files at the repo root, multiple divergent implementations of the same function (`fillBag`, `findConnectedComponents`, `spawnPiece`), large amounts of dead/legacy code, ESLint that doesn't cover the Electron/build code, and npm scripts that don't run on the project's own primary (Windows) platform.

**Bottom line:** core single-player is shippable; **online multiplayer should be treated as untrusted-network software and is not currently safe** against a malicious peer, and several multiplayer/campaign modes have player-visible logic bugs.

### Severity counts (confirmed)

| Severity | Count | Theme |
|---|---|---|
| Critical | 0 | (no unconditional crash/data-loss survived verification) |
| High | 11 | P2P trust boundary, XSS, fake anti-cheat, mode-breaking logic bugs |
| Medium | 20 | Reachable security gaps, resource leaks, cross-platform breakage, fragile logic |
| Low | 73 | Dead code, duplicate implementations, minor leaks, style/cleanup |

There are **no Critical findings**: the most dangerous defects are either guarded by a `try/catch` (so they degrade rather than crash) or require a malicious peer (so they're High, not Critical). Treat the High security cluster as effectively release-blocking for online play.

---

## 2. Findings — High

Each item: what's wrong → why it matters → how to fix → test.

### H1 — Replay "proof" verifies score against self-declared metadata, not the inputs
**`src/core/anti-cheat/replay-proof.js:37-87`** · logic · add test
`buildReplayProof` compares `expectedScore/Lines/Level` against `demo.metadata.finalScore` etc., but that metadata is copied straight from the submitter's own blob (`DemoRecorder.stopRecording`), and the SHA-256 hash is computed *over the same blob*. It never re-simulates `demo.inputs`. A cheater can submit `metadata.finalScore = 9_999_999` with empty inputs and `verified` is `true`.
**Why:** Under `anti-cheat/`, this is meant to prove a leaderboard score is achievable; it provides zero integrity.
**Fix:** Re-execute `demo.inputs` through the deterministic engine (`DemoPlayer`/headless sim) using `initialState.seed` on the verifying side, then compare the *simulated* result to the claim. Bind the hash to `seed + inputs`.
**Test:** craft a demo whose metadata disagrees with its inputs → expect `verified: false`.

### H2 — Electron: no window-open / navigation guard
**`electron/main.js:286-347`** · security
`createWindow()` never registers `webContents.setWindowOpenHandler(...)` nor a `will-navigate`/`will-redirect` handler (repo-wide grep: present only in the archived `main-original.js`). Any script that runs in the renderer can `window.open()` a fresh `BrowserWindow` at any URL or set `window.location` to a remote origin — and the child inherits the privileged preload.
**Why:** This is the single most important Electron hardening control; combined with the two XSS sinks (H10/H11) and `sandbox:false` (M15), a renderer-script bug becomes navigation to attacker content with IPC access.
**Fix:** `setWindowOpenHandler(() => ({ action: 'deny' }))` (route vetted links via `shell.openExternal`) and a `will-navigate` listener that `preventDefault()`s any URL outside `http://localhost:5173` (dev) / the packaged `file://` index.

### H3 — Local-multiplayer round restart spawns a *second* concurrent game loop
**`src/core/game-modes/LocalMultiplayerMode.js:718-824, 2862-2917`** · bug · add test
`_startGameLoop()` never cancels the existing RAF before scheduling a new one. Round end only *pauses* (the paused branch keeps re-scheduling itself, lines 727-730); `_startNewRound()` sets `isPaused=false` and calls `_startGameLoop()` again (line 2917), creating a second independent RAF recursion. From round 2 on, `processAutoDrop` runs twice per frame (2×), round 3 → 3×, etc.
**Why:** Gravity/DAS accelerate every round; CPU compounds; leaked RAF closures. Correctness **and** leak.
**Fix:** Cancel first: `if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);` at the top of `_startGameLoop()`. Better: keep one loop across rounds and just toggle `isPaused`.
**Test:** restart a round, assert exactly one active loop / that per-frame drop count doesn't scale with round number.

### H4 — 3–4 player "points"/"lines" win check ignores players 3 and 4
**`src/core/game-modes/LocalMultiplayerMode.js:2717-2730`** · logic · add test
`_checkMatchWinCondition` hardcodes `player1`/`player2` for the `points` and `lines` conditions (reads `matchStats.player1/2` and `players[0]/[1]`), while the `frags` branch correctly loops `config.numPlayers`. P3/P4 hitting the target never ends the match.
**Why:** 3–4 player points/lines matches can become unwinnable / never-ending for the affected players.
**Fix:** Loop over `numPlayers` like the `frags` branch.
**Test:** 4-player points match where P3 reaches target → match ends.

### H5 — Binary resync calls `decodeSnapshot` on the *encoder* (guaranteed TypeError, swallowed)
**`src/core/network/binary-encoding.js:932-944` consumed at `src/core/multiplayer/ffa-p2p-game-state.js:2031`** · bug · add test
`decodeSnapshot`/`decodeDeltaSnapshot` exist only on `BinaryDecoder`. The resync-completion path calls `getBinaryEncoder().decodeSnapshot(...)` on the encoder singleton → `…decodeSnapshot is not a function`. It's inside a `try/catch` (line 2044), so the resync payload is **silently discarded**: a peer that requested a full resync (after a delta-baseline miss or host migration) **never applies authoritative state and stays permanently desynced**.
**Why:** Resync is the recovery mechanism; it's dead for binary snapshots. (Independently confirmed by the lead reviewer.)
**Fix:** `getBinaryDecoder().decodeSnapshot(snapshotBuffer)`.
**Test:** round-trip a snapshot through the resync path; assert state is applied.

### H6 — Host-migration CLAIM accepted from any peer, unvalidated
**`src/core/network/host-migration.js:138-152`** · security · add test
`handleClaim` unconditionally sets `this.network.hostSteamId = newHostId` from `msg.data`, resets the heartbeat timer (suppressing the legitimate timeout), and demotes to peer — with no check that `newHostId` is the deterministic election winner (lowest Steam ID), that an election is in progress, or that the sender equals `newHostId`.
**Why:** Any peer can broadcast `GAME_HOST_MIGRATION_CLAIM{newHostId: self}` at any time, even while the host is alive, and everyone accepts it — trivial match hijack / host-pointer thrash. (Independently confirmed.)
**Fix:** Recompute the expected winner locally and only accept a match; require `msg.from === newHostId`; ignore unless `isElectionInProgress`; don't reset the heartbeat on a claim alone.

### H7 — Score-based Odyssey star tiers are mathematically unearnable
**`src/core/odyssey/VictoryConditionEvaluator.js:277-289`** · bug · add test
`_meetsCondition` reads `trackedMetrics[key]` first and only falls back to `gameState[key]` when it's strictly `undefined`. `trackedMetrics.score` is initialized to `0` and **never updated** during play (no `updateScore()` call in `OdysseyMode.js`), so `score` conditions always compare `0 >= N` and fail. ~10+ levels use score-gated stars (`levels.js` 678, 1037, 1251, 1468, 2047, 2552, …).
**Why:** Players can never earn those stars regardless of skill — broken progression/reward across much of the campaign.
**Fix:** Either call `hybridEngine.updateScore(this.gameState.score)` per frame, or resolve score-like keys as `(trackedMetrics[key] || gameState?.[key]) ?? 0`.
**Test:** play a score-objective level above threshold → stars awarded.

### H8 — Tall non-infinity Odyssey levels never check board-full game over
**`src/core/game-modes/OdysseyMode.js:2469-2475`** · bug · add test
The per-frame failure check guards on `… || this.isTallBoard`, but `this.isTallBoard` is **never assigned** (everywhere else uses a local `const isTallBoard = boardRows >= MINIMAP_ROW_THRESHOLD`). So it's perpetually `undefined`, and `checkInfinityGameOver()` only runs for `baseMode==='infinity'`.
**Why:** A tall (30+ row) `standard`/`hybrid` level relies on this branch for top-out detection; with the flag undefined, the player can stack to the top without failing — the level is effectively unloseable / softlocks its fail condition.
**Fix:** Set `this.isTallBoard = boardRows >= this.MINIMAP_ROW_THRESHOLD` in `prepareLevelStart`, or recompute a local here.

### H9 — Client accepts host-authoritative game state from any sender
**`src/core/steam/steam-networking.js:486-535`** · security · add test
`handleP2PPacket` auto-registers any sender as a peer and applies their `game:state:full`/`delta` payload to per-peer baselines + dispatches to handlers. For a non-host client there is **no check that snapshots come from `this.hostSteamId`**. The only gate is `matchId`/`matchNonce` equality — but both travel in cleartext in every envelope (lines 829-830), so any participant already knows them.
**Why:** A malicious peer injects arbitrary authoritative state (scores, grids, fake `finished` phase) into other clients.
**Fix:** Reject `game:state:*` unless `fromSteamId === this.hostSteamId` before touching baselines/handlers; treat `matchNonce` as liveness only, not authorization.

### H10 — XSS: peer chat **color** injected into `innerHTML` (match canvas)
**`src/ui/multi-player-canvas-layout.js:286-291`** · security · add test
`addChatMessage` escapes name and message but interpolates the color into `style="background:${nameColor};"` / `style="color:${nameColor}"`. The handler (190-219) takes `detail.color` from peer data and only overrides it with a trusted roster color when the sender is found; an unrostered/spoofed sender's raw `detail.color` flows straight through.
**Why:** A color like `#000;"></span><img src=x onerror=...>` breaks out of the attribute and injects HTML/script into the host DOM.
**Fix:** Validate against `/^#[0-9a-fA-F]{3,8}$/` (or `rgba()`), default on miss; or assign via `element.style.color` (CSSOM rejects invalid values, can't inject markup).

### H11 — XSS: peer chat **color** injected into `innerHTML` (lobby chat)
**`src/ui/lobby-waiting-room.js:703-709`** · security · add test
Same class as H10: `playerColor = message.color || getPlayerColor(...) || '#a78bfa'`, where `message.color` is pass-through peer data, interpolated unsanitized into style attributes.
**Fix:** Same as H10 (strict pattern + safe default, or CSSOM assignment). Factor a shared `sanitizeCssColor()` and use it in both chat sinks (and consider M75).

---

## 3. Findings — Medium

### M12 — npm scripts use Unix-only shell syntax; break on Windows (the documented primary platform)
**`package.json:12-23`** · bug · `dev:electron` uses inline `NODE_ENV=development electron …`; the four `validate:*` scripts use `env -u ELECTRON_RUN_AS_NODE …`. No `cross-env`. On Windows cmd/PowerShell these fail. `build-win.mjs` declares native Windows the supported path, yet these dev/validation entry points don't run there.
**Fix:** add `cross-env`; replace `env -u VAR` with a portable unset (cross-env or a wrapper `.mjs`).

### M13 — `applyGravity` sorts `lockedPieces` in place every gravity step
**`src/core/physics.js:214`** · performance · `visiblePieces` aliases `lockedPieces` (line 169); the `sort()` runs inside the `while` loop → `O(steps · n log n)` on big cascades (post-clear each disconnected cell is its own "piece"), and mutates canonical order as a side effect.
**Fix:** sort once before the loop into a copy; don't reorder `lockedPieces`.

### M14 — Line detection clears fully-filled *hidden* rows above the playfield
**`src/core/physics.js:301-314`** (and `board.js findCompleteLines`) · logic · add test · `detectFullLines` scans to `y=0` with no `HIDDEN_ROWS` lower bound, so hidden spawn rows get cleared and scored. Garbage insertion deliberately filters `y >= HIDDEN_ROWS` (`garbage.js:676`), showing the intended invariant.
**Why:** a topped-out/garbage-filled hidden row scores as a real line and can mask a top-out that should end the game.
**Fix:** bound the scan to `y >= HIDDEN_ROWS` in both functions.

### M15 — Renderer sandbox disabled app-wide (`sandbox: false`)
**`electron/main.js:295-301`** · security · disabled "for ES module preload (.mjs)". `main-minimal.js` keeps `sandbox:true` with a `.cjs` preload, proving the `.mjs` is the only reason it's off.
**Fix:** ship a CommonJS `preload.cjs` (the exposed API only uses `contextBridge`+`ipcRenderer`, both sandbox-safe) and set `sandbox:true`.

### M16 — Main-process P2P handlers `JSON.parse` hostile peer bytes with no size/type guard
**`electron/steam-integration.js:970-987`** · security · `steam:readP2PPacket` does `JSON.parse(packet.data.toString())` on raw remote bytes (polled at 60Hz) with no length cap or shape check; the try/catch prevents a crash but not the allocation/CPU cost. The main process is the most privileged context.
**Fix:** reject buffers over a sane cap (e.g. 64KB) before parse; ideally parse/validate in the renderer and pass the raw buffer through the bridge.

### M17 — `gameLoop` can permanently leak a loop slot, wedging the game
**`src/core/game.js:1157-1175`** · bug · add test · `activeLoopCount` is incremented (line 1142) before `updateGame`; there's no `try/finally`, so any throw inside `updateGame`/draw callbacks leaks a slot. After `MAX_CONCURRENT_LOOPS` (2) such leaks, `gameLoop` early-returns forever (silent dead game). The counter is module-global and never reset on `startGame`.
**Fix:** wrap the body in `try/finally` to always decrement; reset `activeLoopCount=0` in `startGame()`/`_startGameLoop()`.

### M18 — Serenity gamepad poll `setInterval` outlives the mode and leaks on re-start
**`src/core/game-modes/SerenityMode.js:805-813`** · performance · created in `onStart`, cleared only in `onDeactivate`; `onStop` doesn't stop it, and a re-`onStart` without `onDeactivate` overwrites the id, leaking the prior interval.
**Fix:** clear/null the interval in `onStop` (and at the top of setup); don't re-push cleanup closures.

### M19 — Infinity spawn bypasses `canPlacePiece`, so blocked spawns overwrite blocks instead of ending the game
**`src/core/game.js:595-609`** · logic · add test · spawn skips the collision check in infinity mode; `checkInfinityGameOver` only inspects *placed* blocks (`topRow <= 0`), not the freshly-spawned piece, so a piece can spawn overlapping the tower and `lockPiece` writes over existing cells.
**Fix:** still call `canPlacePiece` at spawn in infinity mode; on failure, trigger the normal game-over path.

### M20 — `onGarbageSend` signature mismatch kills attack SFX/log in 3–4 player mode
**`src/core/multi-player-state.js:346-348`** · bug · add test · new state calls `onGarbageSend(playerIndex, targets[], totalLines)`, but the `main.js` consumer is `(player, garbageAmount) => …`, so `garbageAmount` receives the `targets` array; `[1,2,3] > 0` → `NaN` → false, so the sound/log never fire. The legacy 2-player class calls `(player, totalLines)`, so the shared callback behaves differently per active state object.
**Fix:** unify the callback contract across both state classes and the consumer.

### M21 — `MultiPlayerState.checkWinCondition` can freeze the loop with no match-end UI
**`src/core/multi-player-state.js:402-428, 473-482, 548-557`** *(orig High)* · logic · add test · death handling calls `checkWinCondition`, whose `frags` branch calls `endMatch()` and sets `isGameOver=true` the instant a player's *current-round* frags hit the target; the loop then silently stops. But the mode only shows the match-end screen when `alivePlayers <= 1`. The two layers use different metrics (live per-round frags vs cumulative `matchStats`), so a mid-round frag-target hit while >1 alive soft-locks with no results overlay.
**Fix:** single source of truth — either `checkWinCondition` stops being authoritative, or the mode reacts to `MultiPlayerState.isGameOver/winner` by showing the end screen.

### M22 — Per-frame full-board scan for infinity camera follow (4 players × tall boards)
**`src/core/game-modes/LocalMultiplayerMode.js:1261-1291, 1329, 1344-1353`** · performance · `_syncBoardScenes` (every loop) → `_findHighestBlockRow` does a full nested cell scan; `infinityMaxRows` up to 1000 × COLS × 4 players → tens of thousands of reads/frame on the main thread.
**Fix:** cache highest occupied row on player state, update incrementally on lock/clear/garbage.

### M23 — Snapshot decoder trusts peer `playerCount` and length prefixes with no bounds check
**`src/core/network/binary-encoding.js:565-586, 892-897`** *(orig High)* · security · add test · `playerCount` (0–255) is read from the buffer and loops `_decodePlayer` that many times; `_readString` reads attacker `len` then `new Uint8Array(buffer, offset, len)`; no read is validated against `buffer.byteLength` or the lobby roster. The call sites wrap in `try/catch`, so a malformed packet throws-and-drops rather than corrupting — but a peer can still amplify decode cost on the hot 30Hz path and inject arbitrary decoded identities. (Independently confirmed.)
**Fix:** cap `playerCount` at max lobby size; bounds-check every read (`offset+len <= byteLength`) and abort; cross-check decoded steamIds against the known peer set.

### M24 — Host election latches `isElectionInProgress=true` and can deadlock with no host
**`src/core/network/host-migration.js:63-88`** · logic · add test · the no-peers early return (and the non-candidate path) leave `isElectionInProgress=true`; since `initiateElection` guards on that flag, the node can never start another election. If the elected candidate also dies before sending CLAIM, the session deadlocks with no host.
**Fix:** reset the flag on the no-peers return; add an election timeout that re-arms if no CLAIM arrives.

### M25 — Star tiers requiring `bonuses` ignore the bonus requirement
**`src/core/odyssey/VictoryConditionEvaluator.js:270-274`** · logic · add test · `_meetsCondition` `continue`s on `bonuses` ("checked separately"), but `calculateStars()` never checks them separately. A tier like `three: { lines: 20, time: 90, bonuses: 1 }` is awarded without completing any bonus.
**Fix:** pass evaluated bonus results into `calculateStars` and enforce `completedBonuses >= condition.bonuses`.

### M26 — `combo-multiplier` modifier drops extra `onLineClear` args (cleared rows lost)
**`src/core/odyssey/ModifierStack.js:53-64`** · bug · add test · it forwards only the first arg, but `physics.js` calls `onLineClear(count, holeColumns, waveHoleMasks, fullLines)`. When active, `clearedRows` and hole data never reach downstream callbacks / `EVENTS.LINE_CLEAR` (payload `clearedRows` always `[]`).
**Fix:** `(lineCount, ...rest) => originalOnLineClear?.(lineCount, ...rest)`.

### M27 — `rematch:status` handler trusts peer vote list and overwrites authoritative votes
**`src/core/multiplayer/ffa-p2p-game-state.js:709-718`** · security · runs `this.rematchVotes = new Set(msg.data.votes)` for any receiver including the host, with no `msg.from === hostSteamId` check. A forged `game:rematch:status` on the host can fabricate enough votes to trigger `startNewMatch`.
**Fix:** accept `rematch:status` only from the host; derive votes solely from validated `rematch:vote` messages.

### M28 — Lobby join/leave/chat trust peer-claimed `steamId` (roster spoof, remote kick, chat impersonation)
**`src/core/multiplayer/ffa-p2p-game-state.js:479-526, 641-692`** · security · the host adds players from `msg.data.steamId` rather than the authenticated `msg.from` (phantom players); `LOBBY_PLAYER_LEFT` calls `removePlayer(msg.data.steamId)` with no origin check (any peer can kick anyone); chat rebroadcast trusts `msg.data.steamId/playerName` (impersonation).
**Fix:** derive identity from `msg.from`; reject `LEFT` for `steamId !== msg.from`; force `chat.steamId = msg.from` and look up name/color from the roster.

### M29 — Replay/sequence protection bypassed during the join handshake window
**`src/core/steam/steam-networking.js:884-902`** · security · add test · `_validateEnvelope` returns `true` whenever `matchId/matchNonce/hostSteamId` is falsy — *before* the seq replay check — so a joining client accepts every packet and never seeds `recvSeq`; even after the session is set the first replayed/out-of-order packets (seq still `-1`) are accepted.
**Fix:** bypass match-binding only for explicit handshake messages (`net:hello`/`net:welcome`); always run the seq check otherwise.

### M30 — P2P polling interval never stopped on `leaveLobby` (IPC storm; doubles if re-init)
**`src/core/steam/steam-networking.js:447-465`** · performance · the 60Hz `setInterval` is cleared only in `shutdown()`. After leaving a lobby the renderer keeps polling 3 channels every 16ms; a second `init()` orphans the prior interval and doubles processing.
**Fix:** guard `startP2PPolling` against an existing interval; stop polling on `leaveLobby`; bound packets/tick.

### M31 — `OptimizedEventEmitter.once()` never removes its listener (fires forever)
**`src/utils/event-optimizer.js:258-265`** *(orig High)* · bug · add test · `once()` stores the wrapper as `original`, but its internal `off(event, callback)` matches on the *user's* original — which is never stored — so removal fails and the handler fires on every subsequent emit. `onceMultiplayerEvent` delegates here (used in multiplayer flow): duplicated side effects + listener leak.
**Fix:** `const wrapped = (d) => { this.off(event, wrapped); callback(d); }; this.on(event, wrapped);` and make `off()` also match `l.callback`.

---

## 4. Findings — Low (73)

Grouped by subsystem. These are dead code, duplicate implementations, minor leaks, and cleanup. Full per-item detail is in the verification transcript; the most decision-relevant are annotated.

### Anti-cheat / validation / demo
| ID | Location | Issue |
|---|---|---|
| L32 | `validation/input-validator.js:71-80` | **Rate-limit "too fast" interval check is fully commented out** — only the 140/s window protects (independently confirmed). |
| L33 | `validation/input-validator.js:136-180` | `validateMove/Rotate/Drop` deref peer-controlled `data.*` with no null/type guard — host throws on `data:null`. |
| L34 | `validation/input-validator.js:214` | `getPlayerStats` reads `lastInputTime` with a non-composite key → always `undefined`. |
| L35 | `validation/input-validator.js:13-15` | `reset()`/`resetPlayer` clear maps inconsistently (`inputRates` vs composite keys). |
| L36 | `demo/DemoPlayer.js:72` | `this.lastSimulatedTime` never declared in constructor (implicit field). |
| L37 | `demo/DemoManager.js:177` | `exportToURL` spreads a large `Uint8Array` into `String.fromCharCode` → RangeError on big demos. |
| L38 | `demo/DemoRecorder.js:68-74` | caller-supplied `finalStats` can overwrite computed metadata via spread order. |

### Build / scripts / config
| ID | Location | Issue |
|---|---|---|
| L39 | `package.json:7-28` | **No `test` script** — `vitest` isn't runnable via the standard entry point. |
| L40 | `package.json:14-15` | ESLint scope excludes Electron main, preload, and all build scripts. |
| L41 | `vite.config.js:122-126` | Production build does **not** strip `console.log` despite the comment claiming it does. |
| L42 | `scripts/build-win.mjs:69-88` | ICO writes 512px source dimensions as 256 (truncated width/height field). |

### Core gameplay
| ID | Location | Issue |
|---|---|---|
| L43 | `core/pieces.js:34-39` | Biased `Array.sort(() => Math.random()-0.5)` 7-bag shuffle — but this module is **legacy/dead**; live bag is `game.js shuffleBag` (correct Fisher–Yates). Cleanup, no gameplay impact. |
| L44 | `core/garbage.js:298-382` | handicap functions read `senderState.handicaps` without guarding undefined. |
| L45 | `core/board.js:254-301` | Second, divergent `findConnectedComponents` export (dead/incompatible with the `physics.js` one). |
| L46 | `core/garbage.js:126-145` | `determineAttackType` ignores its args and always returns `LINES`. |
| L47 | `core/board.js:63-162` | Incremental grid helpers use non-floored `piece.y` while the collision path floors it. |

### Electron / main / preload
| ID | Location | Issue |
|---|---|---|
| L48 | `electron/preload.mjs:117-133` | Generic `electronAPI.invoke` pass-through lets the renderer reach every whitelisted channel with unvalidated args. |
| L49 | `electron/main.js:94-102` | `set-borderless` derefs width/height from an unvalidated renderer object. |
| L50 | `electron/steam-integration.js:80-93` | `resolveSteamAppId` reads `steam_appid.txt` from `process.cwd()` (working-dir influenceable). |
| L51 | `electron/devtools-shortcuts.js` | Dead DevTools/GPU helper modules no longer wired into the production main process. |

### Game orchestration
| ID | Location | Issue |
|---|---|---|
| L52 | `game-modes/SinglePlayerMode.js:272-273` | Auto-record force-enabled, ignoring the `autoRecordDemos` setting. |
| L53 | `game-mode-lifecycle.js:261-265` | `destroy()` calls async `stopCurrentMode` without `await`. |
| L54 | `core/game.js:561-609` | `spawnPiece` increments `piecesPlaced`/`pieceCounts` before validating the spawn. |

### Infinity mode
| ID | Location | Issue |
|---|---|---|
| L55 | `game-modes/InfinityMode.js:1356-1371` | `_findHighestBlockRow` full-board column scan every frame. |

### Local multiplayer
| ID | Location | Issue |
|---|---|---|
| L56 | `LocalMultiplayerMode.js:2745-2792` | Dead `_showRoundEnd` with corrupted CSS/HTML that would throw if called. |
| L57 | `LocalMultiplayerMode.js:2991-3001…` | Winner highlight never renders (`p.isWinner` never set). |
| L58 | `multi-player-state.js:8-12` | Unused imports. |

### Network protocol
| ID | Location | Issue |
|---|---|---|
| L59 | `network/binary-encoding.js:554-578` | Dead `DELTA_MAGIC` guard in `decodeSnapshot` is unreachable. |
| L60 | `network/snapshot-interpolation.js:87-138` | Result cache keys on `renderTime` and skips edge paths → little real caching. |
| L61 | `network/binary-encoding.js:195-204` | Delta garbage-change detection uses per-frame `JSON.stringify`. |
| L62 | `network/binary-encoding.js:795-799` | Decoder advances `offset += lockedPieceCount*10` without reading those bytes → parse desync on crafted packets. |

### Odyssey
| ID | Location | Issue |
|---|---|---|
| L63 | `odyssey/OdysseyStateManager.js:65-67` | `load()` runs twice and emits a save during construction/activation. |
| L64 | `odyssey/OdysseyStateManager.js:281-283` | `bestTime` never improves after a first completion recorded with time 0. |
| L65 | `odyssey/OdysseyStateManager.js:471-475` | `getOverallProgress` divides by `getTotalLevels()` with no zero guard. |

### P2P game state
| ID | Location | Issue |
|---|---|---|
| L66 | `ffa-p2p-game-state.js:1763-1771…` | `_requestResync` sends on the ACK channel; host may interpret as a chunk-ACK. |
| L67 | `ffa-p2p-game-state.js:854-865` | Rematch threshold counts disconnected players; computes an unused `required`. |
| L68 | `multiplayer/frag-tracker.js:165-174` | Frag-tie winner is order-dependent on a mutated array. |
| L69 | `ffa-p2p-game-state.js:327-330…` | Disconnect grace `setTimeout` leaks if the player object is replaced or `cleanup()` runs first. |
| L70 | `multiplayer/ffa-attack-router.js:153-191` | `applyAttackScaling` reintroduces player-count scaling the doc says was removed. |

### Perf / assets
| ID | Location | Issue |
|---|---|---|
| L71 | `utils/audio-manager.js:245-249` | Looping `<audio>` elements never removed from `activeElements` (leak). |
| L72 | `utils/audio-manager.js:266-277` | `stopSource()` and `onended` both decrement `activePlaying` (double-decrement drift). |
| L73 | `utils/texture-manager.js:49-92` | No in-flight dedup; concurrent loads of the same URL leak GPU textures. |
| L74 | `utils/texture-manager.js:156-178` | Canvas textures keyed by `Date.now()+Math.random()` → never looked up, only LRU-evict. |
| L75 | `utils/performance-monitor.js:1279-1290` | Overlay interpolates GPU adapter/driver strings into `innerHTML` unescaped (injection from IPC/driver strings). |
| L76 | `utils/performance-monitor.js:402-410` | Adaptive-downscale watchdog fires once and never re-arms. |
| L77 | `utils/performance-utils.js:369-384` | `memoize` keys on `JSON.stringify(args)` with **unbounded** cache growth. |
| L78 | `utils/performance-utils.js:169-181` | `DOMBatcher.flush` loses write ordering / a throwing read aborts writes. |
| L79 | `utils/performance-utils.js:22-44` | `throttle` leaks the trailing `setTimeout` id; never resets `inThrottle`. |

### Rendering core
| ID | Location | Issue |
|---|---|---|
| L80 | `rendering/draw.js:204-227…` | Canvas-2D fallback subtracts `HIDDEN_ROWS` twice → clips the top rows. |
| L81 | `rendering/renderer.js:1222-1258…` | Duplicate unreachable `lunara` theme branch. |
| L82 | `rendering/draw.js:744-747…` | `showScorePopup`/`showLevelUpNotification` crash if the container is missing. |
| L83 | `phaser/base-board-scene.js:784-843` | Per-block `beginPath/strokePath/closePath` board outline → `O(rows·cols·4)` draw ops. |
| L84 | `phaser/base-board-scene.js:1088-1100` | Particle cleanup checks `emitter.on === false` (unreliable in Phaser 4). |
| L85 | `phaser/multiplayer-effects-manager.js:107-119…` | Fallback calls non-existent `recreateGraphicsLayers()`. |
| L86 | `rendering/canvas-utils.js:226-227` | Unused `endX/endY` locals (incomplete refactor). |

### Steam integration
| ID | Location | Issue |
|---|---|---|
| L87 | `steam/steam-networking.js:304-305` | Dead/unused `Buffer` allocation on every real-mode send. |
| L88 | `steam/steam-networking.js:1023` | Backpressure drop-rate computation is a no-op (misformed denominator). |
| L89 | `steam/steam-cloud-sync.js:270-281` | Cloud sync trusts cloud-supplied filename + arbitrary JSON → written straight to `localStorage`/settings. |
| L90 | `steam/rich-presence-manager.js:299-303` | `destroy()` doesn't await `clear()` (async race). |
| L91 | `steam/steam-invite-manager.js:66-91` | `_handleInvite` captures `isBusy` at toast-creation time (stale on click). |
| L92 | `steam/steam-service.js:1278-1304` | `getAvatarsBatch` re-parses the whole localStorage avatar cache per id (`O(n)` `JSON.parse`). |
| L93 | `steam/steam-config.js:9` | **`STEAM_APP_ID` hardcoded to Valve test app 480 (Spacewar)** in production config. |

### UI
| ID | Location | Issue |
|---|---|---|
| L94 | `ui/multi-player-canvas-layout.js:720` | `PLAYER_TOPPED_OUT` calls `addChatMessage` with the wrong argument shape. |
| L95 | `ui/gamepad-controller.js:102-105` | Gamepad DAS state initialized with property names never read. |
| L96 | `ui/settings.js:318-356` | Settings persistence doesn't sanitize numeric/enum values from `localStorage`. |
| L97 | `ui/opponent-watch-manager.js:1380-1389` | Stray developer scratch comments inside `_drawCurrentPiece`. |
| L98 | `ui/multi-player-canvas-layout.js:219` | FFA chat input has no inbound length/type validation from peers. |

### Utils runtime
| ID | Location | Issue |
|---|---|---|
| L99 | `utils/event-optimizer.js:163-224` | `off()` can't remove throttled/debounced listeners' pending timers (leak). |
| L100 | `utils/event-optimizer.js:38-56` | `throttle()` drops the trailing call and returns a stale cached result. |
| L101 | `utils/wheel-routing.js:154-186` | `resolveTopmostWheelTarget` caches `elementFromPoint` by millisecond only, ignoring cursor coords. |
| L102 | `utils/animation-frame-registry.js:316-343` | `GlobalAnimationFrameMonitor.disable()` never restores the monkey-patched `requestAnimationFrame`. |
| L103 | `events/event-bus.js:32-37` | `emit` iterates a live `Set` — handlers added/removed during emit aren't isolated. |
| L104 | `utils/event-optimizer.js:305-331` | `memoize()` default key uses `JSON.stringify(args)` — wrong/dangerous for objects/functions/cyclic data. |

---

## 5. Cross-cutting themes

1. **No P2P trust boundary.** The recurring root cause across H6, H9, M23, M27, M28, M29 (and L62, L89) is that "host is authoritative" is asserted but not enforced: handlers key off `msg.data.*` identity instead of the authenticated `msg.from`, and host-only message types aren't restricted to the host. A single shared helper — *"is this message type allowed from this sender?"* — plus using `msg.from` as the identity everywhere would close most of them.
2. **Unsanitized strings into `innerHTML`.** H10, H11, L75 (and the input-validation gap behind them) are the same bug in three places. A shared `sanitizeCssColor()` / `escapeHtml()` and a lint rule against `innerHTML +=` would prevent recurrence.
3. **Anti-cheat is decorative.** H1 + L32 + L33 + the buffered-input note (below) mean the validation layer mostly logs rather than enforces. Decide whether anti-cheat is in scope; if not, stop shipping a module named `replay-proof` that implies a guarantee it doesn't provide.
4. **Duplicate/divergent implementations.** `fillBag` (pieces.js vs game.js), `findConnectedComponents` (board.js vs physics.js), `spawnPiece` (pieces.js vs game.js), two preload files (`preload.js` is a stale CommonJS duplicate of the live `preload.mjs`). These are correctness traps — a future caller can import the wrong one.
5. **Lifecycle leaks.** RAF loops (H3, M17), intervals (M18, M30), timers (L69, L79, L99), audio elements (L71) — the project lacks a consistent "every `setInterval`/`requestAnimationFrame`/`setTimeout` has exactly one owner that cancels it" discipline. `utils/timer-manager.js` and `animation-frame-registry.js` exist for this but aren't used by the modes that leak.
6. **Tooling doesn't cover the risky code.** ESLint skips Electron + scripts (L40), there's no `test` script (L39), `console.log` isn't stripped (L41), and dev/validate scripts don't run on Windows (M12). The safety net has holes exactly where the high-severity bugs live.

### Lead-reviewer additions (independently confirmed, fold into the above)
- **Buffered-input path skips validation entirely.** `processPlayerInput` validates (`ffa-p2p-game-state.js:952`), but the jitter-buffered batch path (`:2295-2309`) calls `_applyInputToPlayer` with `input.data` and only `trackInput`s — no `validateInput`. Since the buffered path is the main gameplay path, the anti-cheat in L32/L33 is mostly bypassed in practice. Treat as part of the H1 anti-cheat decision.
- **`preload.js` is dead.** `main.js` loads `preload.mjs`; `main-minimal.js` loads `preload-minimal.cjs`. `preload.js` (CommonJS, divergent channel list) is unreferenced — delete to avoid confusion (relevant to M15's CJS-preload fix).
- **Open: level-up threshold inconsistency.** `scoring.js:98-108` (`calculateLevel`/`getLinesUntilNextLevel`) uses **10** lines/level; the live `physics.js:767` path uses **15**. Confirm whether `calculateLevel` is reachable; if it is, the two disagree (see Open Questions).

---

## 6. Recommended fix plan

Grouped into workstreams so related fixes land together and share tests.

**WS-A — Online-multiplayer trust boundary (security; gate online release):** H6, H9, M23, M27, M28, M29, L62, L89. Introduce a single `assertSenderAllowed(msgType, from)` gate, switch all identity reads to `msg.from`, restrict `game:state:*`/host-migration/rematch to the host, bounds-check the binary decoder, and run seq-replay for all non-handshake messages.

**WS-B — XSS / output sanitization (security):** H10, H11, L75. Add `sanitizeCssColor()` + use CSSOM assignment; audit all `innerHTML` sinks for peer/IPC data.

**WS-C — Electron hardening (security):** H2 (nav/window-open guard), M15 (re-enable sandbox via `.cjs` preload + delete `preload.js`), M16 (size-cap P2P JSON), L48, L49, L50.

**WS-D — Mode-breaking gameplay bugs (correctness):** H3 (double loop), H4 (3–4p win check), H5 (resync decoder), H7 (score stars), H8 (tall-board game over), M19 (infinity spawn), M20/M21 (garbage SFX + win-condition ownership), M24 (election deadlock), M26 (modifier args), M14 (hidden-row clears).

**WS-E — Anti-cheat decision (policy + code):** H1, L32, L33, plus the buffered-path note. Decide enforce vs. remove; if enforcing, re-simulate replays and run validation on the buffered path with null-safe validators.

**WS-F — Leaks & perf hygiene:** M17, M18, M22, M30, M13, L69–L79, L83, L99–L102. Adopt one owner per RAF/interval/timer; use the existing registries.

**WS-G — Tooling & maintainability:** M12, L39, L40, L41; remove dead/duplicate code (L43, L45, L51, L56, L58, L59, L81, L86, L87, `preload.js`); root-folder cleanup of the ~440 status markdown files.

---

## 7. Suggested implementation order

1. **Sprint 1 — Security gate for online (WS-A, WS-B, WS-C).** These are the only items that make online play *unsafe* rather than *buggy*. Do them first and behind tests; treat WS-A/WS-B as blocking any public online build. (H2/M15/M16 also benefit single-player by hardening the shell.)
2. **Sprint 2 — Player-visible correctness (WS-D).** H3, H4, H7, H8 are the bugs players will actually hit; H5/M24 restore multiplayer recovery. Land with regression tests.
3. **Sprint 3 — Anti-cheat decision (WS-E).** Needs a product call (is competitive integrity in scope?) before coding. Cheap interim: null-guard the validators (L33) and re-enable/replace the rate check (L32) regardless of the larger decision.
4. **Sprint 4 — Leaks/perf (WS-F)** and **tooling/cleanup (WS-G).** Lower risk; do once a test harness (Sprint 1–2) exists so refactors are safe. Start WS-G's tooling items (test script, ESLint scope, cross-env) early-ish since they unblock everyone else.

Rationale: fix what's *exploitable* before what's *wrong*, and what's *wrong* before what's *messy*; but pull the cheap, broad tooling wins (test script, lint scope) forward because every other workstream needs them.

---

## 8. Test plan

The project uses **Vitest** (`vitest.config.js` includes `tests/unit/*.js` and `src/**/*.test.js`) but ships **no `test` npm script** (L39) — **first action: add `"test": "vitest run"`** so the suite is runnable in CI.

**New unit tests (pure logic, no Electron/Phaser):**
- `replay-proof`: metadata-vs-inputs mismatch → `verified:false` (H1).
- `binary-encoding`: encode→decode round-trip via the **resync** path applies state (H5); malformed buffer with `playerCount=255`/oversized `len` → bounded failure, no overrun (M23); `lockedPieceCount` offset desync (L62).
- `host-migration`: CLAIM from a non-elected/forged sender is rejected (H6); no-peers / dead-candidate election re-arms (M24).
- `LocalMultiplayerMode`: round restart → single active loop / per-frame drop count constant across rounds (H3); 4-player points/lines win ends the match (H4); garbage-send callback shape fires SFX in N-player (M20); win-condition ownership doesn't soft-lock (M21).
- `VictoryConditionEvaluator`: score-objective tier earnable (H7); `bonuses` enforced (M25).
- `OdysseyMode`: tall standard/hybrid level tops out (H8).
- `physics`: hidden rows not cleared/scored (M14).
- `game.js`: `gameLoop` slot not leaked when a callback throws (M17); infinity blocked spawn → game over, not overwrite (M19).
- `input-validator`: `data:null` rejected, not thrown (L33); `getPlayerStats` returns real values (L34).
- `event-optimizer`: `once()` fires exactly once (M31); `off()` clears pending throttle timers (L99).
- `steam-networking`: handshake-window packets still seq-checked (M29).

**Security regression tests (string-level):**
- chat color `#000;"></span><img src=x onerror=…>` is neutralized before DOM insertion (H10/H11/L75) — assert on the produced node/string, not a live DOM.

**Integration / manual (need Electron or Phaser):**
- Electron nav guard: `window.open`/`location` to an external origin is denied (H2) — extend `tests/unit/devtools-*`-style harness or a Playwright-Electron smoke.
- A scripted "malicious peer" harness that sends forged `LOBBY_PLAYER_LEFT`, `game:state:full`, `host:claim`, `rematch:status` and asserts the host rejects them (WS-A) — highest-value integration test; there is currently **no multiplayer adversarial test**.

**Coverage gaps today:** the existing 41 test files concentrate on Odyssey rendering/layout, settings, and boot. There are **near-zero tests around the networking trust boundary, anti-cheat, and the local-multiplayer mode lifecycle** — exactly where the High/Medium findings cluster.

---

## 9. Risks & open questions

- **Trust model / threat scope.** Is online play friends-only (Steam invite) or open lobbies? Much of WS-A's severity depends on whether an attacker can join arbitrary matches. Even friends-only, a single malicious/compromised peer can hijack a match (H6) — so these are real, but the *priority* depends on the answer.
- **Is anti-cheat in scope at all?** If leaderboards are casual, H1/L32/L33 can be deprioritized to "remove the misleading module + null-guard validators." If competitive, WS-E is a significant build-out (deterministic headless re-simulation).
- **Steam App ID 480 (L93).** `steam-config.js` hardcodes Valve's Spacewar test app. Confirm this is dev-only and a real app id is injected for release — otherwise stats/cloud/leaderboards write to the shared test app.
- **Level-up threshold (10 vs 15).** `scoring.js calculateLevel` (10 lines) vs `physics.js` (15). I did **not** find a live caller of `calculateLevel` during gameplay, so it may be dead — **needs confirmation**. If reachable (e.g. via a HUD or single-player path), levels/speed disagree by code path.
- **Refuted findings — do not re-investigate.** Adversarial verification dropped 38 plausible claims. Notably **confirmed-correct**: `game.js shuffleBag` is a correct Fisher–Yates (the `Math.max(0,Math.min(i,j))` clamp is a harmless `rng()===1` guard); the `processPhysics` cascade loop terminates; `ObjectPool`/`AnimationFrameRegistry`/`AudioManager` singletons flagged for "leaks" are largely **dead code** (unused), so their defects don't execute; `steam-service` reconnect double-emit is prevented by synchronous flag updates; the delta-baseline desync is *detected* (baseline-tick mismatch throws → resync). Several "performance" pool/registry findings are moot because the pools are never exercised.
- **Decoder robustness vs. crash.** M23/L62 are bounded by the `try/catch` at the call sites today, so they're amplification/robustness issues, not crashes — but the bounds checks should still be added (defense in depth, and the decoded identities are trusted downstream).
- **Large-file refactors.** `OdysseyMode.js` (5,159 lines), `ffa-p2p-game-state.js` (3,026), `LocalMultiplayerMode.js` (3,618) carry several findings each; fixes there risk regressions without tests. Build the Sprint-1/2 harness before touching them.

---

## 10. Areas that deserve deeper review

1. **`ffa-p2p-game-state.js` (3,026 lines) — full message-handler audit.** This review covered the obvious trust-boundary handlers; a line-by-line pass of *every* `registerHandler` for "does this trust `msg.data` identity / accept host-only types from peers?" is warranted. It's the security heart of the app.
2. **`OdysseyMode.js` (5,159 lines) + `levels.js` (4,844 lines).** H7/H8/M25/M26 suggest the victory/modifier/level-config plumbing has more latent mismatches between what `levels.js` declares and what the evaluator actually checks. Audit every star/bonus/fail condition against a real level config.
3. **Garbage system end-to-end** (`garbage.js`, `ffa-attack-router.js`, `multi-player-state.js`). L44/L46/L70/M20 are scattered symptoms; the attack-type/scaling/handicap logic deserves a focused correctness + fairness pass (especially seeded determinism across peers).
4. **Binary codec fuzzing.** Beyond the unit tests, fuzz `decodeSnapshot`/`decodeDeltaSnapshot` with random/truncated buffers to find any path that produces a *plausible-but-wrong* snapshot (semantic corruption) rather than a thrown error.
5. **Themes (`src/themes`, 308 files) — not reviewed.** Sampled only. Given they're WebGL/Three.js heavy and several carry their own RNG/seed and resource-allocation code, a separate performance + GPU-resource-leak pass is advisable (the perf-monitor/texture/audio leaks found in `utils` likely have analogues there).
6. **Resync/host-migration interaction.** H5 (resync broken) + H6/M24 (migration) together mean post-migration recovery is doubly fragile. Trace the full "host dies → elect → new host → peers resync" flow as one scenario.

---

*Generated from a 16-subsystem, adversarially-verified multi-agent review (169 agents) plus direct lead-reviewer reading of the highest-risk files. Finding IDs H/M/L map to the verified finding set; the full per-finding verifier reasoning is preserved in the run transcript.*
