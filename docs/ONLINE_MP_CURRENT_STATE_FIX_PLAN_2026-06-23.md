# Serenity Blocks Online Multiplayer — Current-State Stabilization & Best-In-Class Action Plan

Status: authoritative action plan. Date: 2026-06-23.
Basis: 7-cluster adversarially-verified audit of the **uncommitted working tree** (~1,940 lines of WIP across the MP netcode) cross-checked against `git diff HEAD` and `git show HEAD`, plus on-disk re-verification of the load-bearing claims.
Scope: host-authoritative P2P FFA over Steam (steamworks.js 0.4.0, single physical channel). `src/core/multiplayer/`, `src/core/network/`, `src/core/steam/`, `src/core/game-modes/OnlineMultiplayerMode.js`, plus the perf/throttle surfaces (`src/main.js`, `electron/main.js`, `src/utils/performance-monitor.js`, `src/themes/base-theme.js`, `src/ui/lobby-waiting-room.js`).

This plan **supersedes** the prior two docs as the current-state remediation: `docs/MULTIPLAYER_BEST_IN_CLASS_PLAN.md` (Phases 0–2 claimed shipped) and `docs/ONLINE_MULTIPLAYER_NETCODE_RESEARCH_AUDIT_PLAN_2026-06-23.md` (7-phase research roadmap). It does not re-plan their long-horizon structural work; it adds the **stabilization layer that must land first** so MP works at all, then cross-references those docs for the competitive structure.

## Current validation update (2026-06-30)

This document is now partly historical. The current working tree has implemented and unit-tested much of Phase A and parts of Phase B/C:

- `lockEvents` is default-off, with comments pointing at the interpolator fight.
- Host heartbeat is re-armed with `startStateSyncLoop()` and during restart gaps.
- Restart clears the jitter buffer; the old dead online host loop was removed.
- Peer-owned local sim, local-board hold/stat hold, opponent clear events, idempotent garbage, drain-all garbage, persistent battle log, late join/awaiting-spawn, spectators, download-join fences, migration epochs, net event logging, network impairment, and binary delta baseline handling have unit coverage.
- Targeted validation passed locally: 22 MP-focused unit files / 152 tests.

Remaining before online FFA can be called release-candidate: run the two-machine Steam checklist; keep `lockEvents` off unless it is routed through the interpolator; decide/gate `serenity.netImpair` for release; validate whether `NET_HEARTBEAT` alone is enough host-liveness evidence; finish rotation/spawn-id wire semantics; graduate or keep default-off `downloadJoin`, `migrationEpoch`, `readyBarrier`, `authoritativeAttacks`, deterministic garbage, adaptive input jitter, and `simTickNetcode`.

---

## 1. Executive summary

**Headline:** The working tree holds a **half-finished best-in-class rebuild** (lock-events, v4 binary format, fixed-step sim scaffold, adaptive jitter buffer, snapshot-interpolation rework, network-impairment harness). Most of the *experimental* paths default OFF and are inert, so the WIP did **not** introduce the two dominant blockers — those are **pre-existing**. But the WIP **did** turn on one risky new feature by default (`lockEvents`), grew the binary buffer in a way that can overflow under mutual garbage pressure, and built-but-never-wired the deterministic-garbage fence that would have fixed a pre-existing garbage race.

**Recommendation: finish-forward, not revert** (see §3). A blanket revert would re-break nothing that is currently working *and* would discard the genuinely-correct WIP (delta-baseline-vs-keyframe, resync guards, attack-scaling). The two blockers that actually break round 2+ are pre-existing and a clean revert does not fix them. The fastest path to a working build is a small set of targeted fixes plus flipping two defaults.

### Top 5 blockers (in fix order)

1. **Host heartbeat loop is killed at round end and never re-armed for round 2+** → peer false-migrates ~5s into round 2 (pre-existing). `frag-tracker.js endMatch()` → `stopStateSyncLoop()` → `stopHeartbeatLoop()` (ffa-p2p-game-state.js:1938); the restart paths call `startStateSyncLoop()` (1078/1820/3788/4040) but **never** `startHeartbeatLoop()`. Verified on disk: `startStateSyncLoop()` body (1901–1926) does not start the heartbeat.
2. **Envelope `hostSteamId` mismatch silently drops 100% of cross-host traffic** after the false migration (pre-existing). steam-networking.js:1069 `if (envelope.hostSteamId !== this.hostSteamId) return false;` with no log. This is what produces "lose connection / dead garbage / empty logs" while the Steam session stays open.
3. **GPU contention from the heavy WebGPU theme (Winter) running behind MP** starves the RAF-coupled host sim + 30Hz broadcaster (pre-existing). `OnlineMultiplayerMode` never touches `themeManager`; the PerformanceMonitor 1.0→0.5 downscale is the smoking gun. This is the real cause of peer lag/unplayable — **not** the 10 FPS visibility throttle (refuted: nothing in the MP loop reads `window.isRenderingReduced`).
4. **`lockEvents` default-ON creates a render fight + reliable-channel load** (WIP regression). Lock-events snap the opponent grid via `renderAllPlayers()` while `OnlineMultiplayerMode` renders that opponent from the snapshot interpolator that lock-events never feed → disagreement for up to the 90ms interp delay → opponent glitch / can't-see-movement-before-drop.
5. **Opponent piece rotation is never rendered** (pre-existing): binary codec serializes only type+x+y+rotation byte; decoder rebuilds spawn-orientation `SHAPES[type]` and no consumer applies the rotation byte. The rotated silhouette only appears at lock (from the serialized grid).

---

## 2. Current broken-state root-cause table

Origin legend: **WIP** = introduced by the uncommitted diff; **PRE** = pre-existing (identical at HEAD); **MIX** = pre-existing bug the WIP touched/half-fixed.

| # | User symptom | Verified root cause(s) | file:line | Origin | Fix |
|---|---|---|---|---|---|
| 1 | Peer/opponent LAGS | (a) RAF-coupled host sim + jitter `advanceTick` + 33ms-gated broadcast all ride one RAF; (b) heavy Winter WebGPU theme contends for the same main thread/GPU behind MP, RAF callbacks slow under sustained drops, netcode degrades with them. **Refuted:** the 10 FPS visibility throttle does NOT gate the loop (no reader of `window.isRenderingReduced` in `src/core/multiplayer`; `unified-game-loop.js:115-155` is pure RAF). | ffa-p2p-game-state.js:3316-3326 (onUpdate), :3387 (advanceTick), :2139-2145 (broadcast gate); OnlineMultiplayerMode.js has zero `themeManager` refs; performance-monitor.js:420-423 downscale latch | PRE | Move host sim + `processBufferedInputs`/`advanceTick` + `maybeBroadcastPostPhysics` onto a fixed-rate `setInterval`/accumulator independent of RAF (finish the dormant `_runFixedStepHostSimulation`). Clamp delta in unified-game-loop.js:124 (`Math.min(delta, ~50ms)`). Switch to a lightweight background (or pause the active theme RAF) while `gamePhase==='playing'`. Suppress the global resolution downscale during a match (`performanceMonitor.setAdaptiveDownscaleSuppressed(true)` exists at performance-monitor.js:947-950). |
| 2 | Doesn't work after round 1 | **Heartbeat never re-armed.** `endMatch→stopStateSyncLoop→stopHeartbeatLoop` (1938) kills the heartbeat at first round end; restart paths start state-sync but not heartbeat. Peer's `HostMigration` only refreshes `lastHeartbeatTime` while `gamePhase!=='playing'` (host-migration.js:39-42); once round 2 enters playing, the 5000ms timeout (host-migration.js:19) fires `initiateElection()`. Only `NET_HEARTBEAT` refreshes `onHeartbeat` (ffa-p2p-game-state.js:724-727); snapshots do not. | ffa-p2p-game-state.js:1931-1938, 1901-1926 (no heartbeat start), 1078/4040 restart thunks; host-migration.js:19,32-48 | PRE | **One-line structural fix:** add `this.startHeartbeatLoop();` inside `startStateSyncLoop()` (after the `if (!this.isHost) return` guard at :1902). `startHeartbeatLoop()` already calls `stopHeartbeatLoop()` first (idempotent, :1947), and `stopStateSyncLoop()` already stops both — so the two keepalive loops can never desync, and all 4 host restart call sites are covered. |
| 3 | Lose connection mid-match | **Split-brain after the false migration (#2).** `promoteToHost()` sets the peer's own `hostSteamId=localPlayerId` (ffa-p2p-game-state.js:3758) and restarts its heartbeat; the original host never demotes. The envelope gate then silently drops ALL host↔peer traffic both directions. No recovery path (original host rejects peer's MIGRATION_SYNC; peer rejects original host's packets). | steam-networking.js:1069 (silent drop); ffa-p2p-game-state.js:3758 | PRE | Primary fix is #2 (eliminate the false migration). Defense in depth: (a) refresh `HostMigration.lastHeartbeatTime` on ANY authoritative inbound host packet (route `GAME_STATE_FULL/DELTA/ROUND_*` through `hostMigration.onHeartbeat`); (b) add a throttled `console.warn` at steam-networking.js:1069 (and the matchId/nonce/seq drops at 1062-1070) so split-brain is diagnosable; (c) gate `initiateElection()` on "no authoritative packet from current host within timeout", not just "no heartbeat"; (d) two-host tie-break (lowest steamId wins) as a last-resort reconciliation. |
| 4 | Garbage not working | (a) **Predicted-then-replaced double-insert race**: peer self-predicts garbage via blind `dequeueLineBurst()` (3571), then the next host snapshot **wholesale-replaces** the local player's `garbageQueue` with NO `isLocalPlayer` guard (2637) — the same lines re-predict → double insert / shifting holes. (b) **Cancellation truncation drops holes**: `lineLimit` filter keeps the FIRST N expanded entries, which are clean-bonus rows (garbage.js:234-235 pushes cleanMasks before holeMasks), discarding the hole rows; `lineLimit=effectiveLines=totalLines−cancelledLines`, so it bites in 2-player whenever cancellation occurs. (c) Multi-player binary buffer overflow → silent JSON fallback (rarer; needs both players ~254+ entries). Also #1/#3 starve delivery. | ffa-p2p-game-state.js:2637 (no local guard), :3571 (blind dequeue); ffa-attack-router.js:369-374 (lineLimit head-truncation); binary-encoding.js:80,135 (buffer size) | MIX (race PRE; truncation+overflow WIP) | **Smallest real fix:** add an `isLocalPlayer` guard at :2637 mirroring `shouldApplyBoardState` (:2609-2610) so the peer stops clobbering its own predicted queue (opponents' queues are still authoritatively replaced for meter display). For truncation: build the `GarbageAttack` with the reduced row count up front, or truncate from the CLEAN head not the HOLE tail, then re-derive connect/isLastInBurst over the survivors. For overflow: size the buffer from actual serialized length and cap serialized queue length; drop the redundant per-entry attackId string (`attackSeq` reconstructs it on decode, binary-encoding.js:272). **Note:** `applyAfterLockSeq` is set to the victim's lock seq at *send* time (ffa-attack-router.js:390), so it is useless as an apply-fence even if wired — fix the field semantics before finishing deterministic garbage. |
| 5 | Peer unplayable | Aggregate of #1 (lag) + #3 (mid-match drop) + #4 (garbage) + #6/#7 (visual glitch). No single new cause. | — | PRE/MIX | Stabilization phase A resolves the dominant drivers (#1, #2, #3); B resolves the visual ones. |
| 6 | Opponent tetrominoes GLITCH | (a) **Lock-event render fight**: `_applyAuthoritativeLock` mutates `player.gameState.currentPiece` + grid and calls `renderAllPlayers()` (3723-3731), but opponents render from the interpolator (OnlineMultiplayerMode.js:1528-1533) that lock-events never feed → disagreement for up to 90ms. (b) **Unclamped x/y Uint8 encode**: `_encodePiece` writes `x+128`/`y+128` with no clamp (binary-encoding.js:435-436); hidden spawn rows (negative y) / tall stacks wrap mod 256 → piece teleports to a wrong cell. | ffa-p2p-game-state.js:3723-3731; OnlineMultiplayerMode.js:1528-1533; binary-encoding.js:435-436 | MIX (lock-fight WIP; encode-clamp PRE) | Default `lockEvents` OFF (see #7). Clamp x/y on encode (or widen the field). |
| 7 | Can't SEE opponent rotate/move before hard-drop | (a) **Rotation never rendered**: `_encodePiece` writes a rotation byte but `_decodePiece` rebuilds `SHAPES[type]` (rotation-state-0) and no consumer rotates it (binary-encoding.js:1026; interpolator copies `piece.shape` verbatim, snapshot-interpolation.js:313-316; OWM `_drawCurrentPiece` applies no rotation, opponent-watch-manager.js:1401,1452). (b) **Broadcast trigger omits rotation**: `hasSignificantStateChanges()` checks x/y/dropCounter but not `currentPiece.rotation`/spawn id (ffa-p2p-game-state.js:2115-2126). (c) Lock-event fight (#6a). **Refuted:** "opponents are streamed not rendered" — x/y movement IS interpolated/lerped (snapshot-interpolation.js:314-315; OnlineMultiplayerMode.js:1528-1533). | binary-encoding.js:1026,434-438; ffa-p2p-game-state.js:2115-2126 | MIX | **Dominant fix:** in `_decodePiece`, compute shape via a shared `getRotatedShape(type, rotation)` using the same rotation table the host uses (game.js:116/746) instead of `SHAPES[type]`. Add `rotation` + a `pieceSpawnId`/`lockSeq` to `hasSignificantStateChanges()` and carry them in `lastBroadcastState`. Resolve the lock-event fight (default OFF). Relieve #1 so snapshots flow at full 30Hz for the interpolator to lerp. Add a binary round-trip unit test asserting a rotated piece decodes to the rotated matrix. |
| 8 | Activity log + battle log empty / don't sync | (a) **Logs are downstream victims of #2/#3**: when round 2+ events stop (false migration + envelope drop), no deaths/garbage flow; `OnlineKillFeed.itemTTL=12000` (online-kill-feed.js:11) auto-expires rows so the battle log visibly empties within ~12s and never refills. (b) **Dead methods**: `addCombo`/`addGarbageCancelled`/`addSystemEvent` have zero callers (online-kill-feed.js:114,137,149); COMBO/GARBAGE_COUNTERED are emitted local-only and never networked. (c) **Activity log is waiting-room-only** — `#activity-log-list` lives only in LobbyWaitingRoom, fed only by `_logRosterChanges()` on PLAYER_LIST_CHANGED; `hide()` clears its interval at match start, so it is structurally incapable of in-match events. (d) Field-name mismatch `linesCanceled` (emit, ffa-p2p-game-state.js:1762) vs `linesCancelled` (render, online-kill-feed.js:118). | online-kill-feed.js:11,114,118,137,149; lobby-waiting-room.js:132-134,734-761,343-353; ffa-p2p-game-state.js:1762 | PRE | Primary fix is upstream (#2/#3 restore event flow). Then: wire the dead methods AND host-broadcast combo/cancel events (reliable `game:combo`/`game:garbage:cancelled` with steamId+name+count) so opponent rows appear; dedupe every `add*` via `_isDuplicate` (only `addKill` has it today); fix the `linesCanceled`/`linesCancelled` spelling; either relabel the lobby widget "Lobby Activity" or relocate/merge it into the match layout fed by the same MULTIPLAYER_EVENTS as the battle log. |
| — | Host console: lobby player-list re-renders "hundreds of times" | `WaitingRoom.updateUI()` on a blind 1000ms `setInterval` (lobby-waiting-room.js:321) + every PLAYER_LIST_CHANGED; `updatePlayerList()` unconditionally `console.log`s count + per-player (463-464), rebuilds `innerHTML` and re-batches avatars with no dirty-check. The 1s interval is the dominant driver (NET_HEARTBEAT does not emit PLAYER_LIST_CHANGED). | lobby-waiting-room.js:321,463-464,471,476 | PRE | Cache a roster signature (sorted steamId:name:ready:color:host); early-return + skip the log + skip `getAvatarsBatch` when unchanged; gate per-player log behind a debug flag; prefer event-driven over the 1s interval; replace `innerHTML=''` with reconciliation. |
| — | Host console: 10 FPS visibility throttle + 1.0→0.5 downscale fired mid-match | Blur handler emits `focused:false` with no `isMinimized()` guard (electron/main.js:486-488); a saved `backgroundTabBehavior='reduce'` (settings.js:65 default) defeats the packaged `'continue'` default (main.js:1309-1310) → `reduceRenderingFrameRate()` pauses the **theme** RAF (main.js:1415, base-theme.js:757). The downscale is genuine Winter overload, latched one-way (performance-monitor.js:420-423; base-theme.js:51-59), not restored on focus regain (main.js:1433-1459). **Refuted:** neither degrades the netcode loop (decoupled RAF). | electron/main.js:486-488; main.js:1309-1310,1415,1433-1459; performance-monitor.js:420-423; base-theme.js:51-59 | PRE | Guard the blur handler with `isMinimized()` (or skip while a match is active); force `'continue'` for the MP session; exempt active MP from `reduceRenderingFrameRate`. Make the downscale recoverable (add an upscale path / reset `_hasEmittedDownscale` on match end). Fix the two-writer `globalRenderScale` conflict (base-theme.js:51-59 vs desktop-performance-policy.js via main.js:1184) by routing the watchdog through the single bidirectional controller. **Note:** these are cosmetic/contention fixes, not the netcode cause — but the contention (#1) and console spam are real and in scope for stabilization. |

### Additional verified hazards (fix opportunistically, not blockers)

- **Dead second host loop**: `OnlineMultiplayerMode._startOnlineGameLoop()` (OnlineMultiplayerMode.js:2506-2569) calls `this.ffaGameState.update(delta)` — a method that does **not exist** on FFAGameStateP2P (:2535). Never called (grep: definition only). **Delete it** so no one "fixes" the loop by wiring it up (it would throw or double-broadcast). Mirrors the dead `LevelResultsModal` trap noted in project memory.
- **simTick aliasing**: on the default path `simTick` increments once per RAF frame (ffa-p2p-game-state.js:3320) and is fed into the v4 snapshot field / interpolator timeline — a frame-counter masquerading as a sim clock. Either finish the fixed-step timer or alias `simTick` to `hostTick` so no consumer mistakes it for a stable clock.
- **NetworkImpairmentHarness in the production send path**: constructed unconditionally (steam-networking.js:86), reads `localStorage['serenity.netImpair']`/URL on init (network-impairment.js:177-208). No-op when disabled, but a stale localStorage preset would silently drop/delay/dup REAL traffic. Gate construction behind `import.meta.env.DEV`.
- **v4 format has no peer-version negotiation**: same-installer is safe (decoder branches on the buffer's version byte), but a partial rollout silently warns-and-continues (binary-encoding.js:612-614) instead of reject-with-resync. Add an explicit envelope protocol-version + reject-with-resync.
- **Lock/tick bookkeeping not reset on round restart** (currently SAFE because `hostTick`/`_lockSeq` are monotonic): `performRoundRestart` (1042-1061) does not clear `_lockSeq`/`_lastAppliedLockSeq`/`_lastLockHostTick`. Add explicit resets to make the invariant intentional — otherwise a future "reset hostTick on restart" fix would silently drop all round-2 opponent board updates via the `staleVsLock` guard (2604-2608), reproducing symptom 2.
- **Jitter-buffer not re-seeded in `performRoundRestart`** (host rematch path) unlike `restartMatch`/`restartFullGame`: leftover round-1 inputs can apply to the round-2 board. Minor (adaptiveInputJitter is OFF so no stale-rejection). Extract one shared reset helper and call it from all three paths.

---

## 3. Stabilization decision — finish-forward vs revert

**Decision: finish-forward with two default flips + targeted fixes. Do NOT blanket-revert.**

Reasoning grounded in the WIP-diff findings:

1. **A revert does not fix the two blockers.** Symptoms 2 and 3 (round-2 break + connection loss) are **pre-existing** (`git show HEAD` confirms the heartbeat kill, the restart thunks, and the envelope gate are byte-identical at HEAD). Reverting the working tree restores those exact bugs. The fix is forward regardless.
2. **The riskiest WIP is already inert.** `simTickNetcode`, `adaptiveInputJitter`, `readyBarrier`, `migrationEpoch`, `deterministicGarbage`, `netImpair` all default OFF and are dead code in the packaged no-flag build. They cannot be the live break, so there is nothing to revert there for stabilization.
3. **Only one WIP feature is live and harmful: `lockEvents` (default ON).** Flipping it OFF (`readNetFlag('lockEvents', false)`, ffa-p2p-game-state.js:258) neutralizes the render fight (#6a) and the extra reliable load with a one-character change — far cheaper and lower-risk than reverting +1199 lines.
4. **The WIP contains correct, wanted work** the prior plan's Phase 1 shipped: delta-baseline-vs-keyframe, resync in-flight guard + cooldown, attack-scaling cap, v4 codec. A blanket revert throws these away and re-opens resync churn.

### Exact first steps (stabilization order)

1. `git stash` is **not** used — keep the WIP. Create a branch off the current `cleanup/repository-files` working tree state (or commit the WIP to a `wip/netcode-rebuild` branch first as a safety snapshot) so the stabilization commits are isolated and revertible.
2. Land the **Phase A** fixes below (heartbeat one-liner, lockEvents OFF, envelope-drop logging, lightweight-background-during-MP, downscale suppression, lobby spam guard). These are small, surgical, and make MP work again.
3. **Validate two-machine** (§5 Phase A checklist) before touching smoothness.
4. Only then proceed to Phase B (smoothness) and Phase C (structure), which build on the existing phase docs.

If two-machine validation after Phase A still shows a hard break that bisects to the WIP, the fallback is a **surgical revert of `lockEvents` + the v4 garbage-entry size change only** (not the whole diff) — but the audit predicts Phase A alone restores a working build.

---

## 4. Sequenced fix plan

Cross-references: "BIC" = `docs/MULTIPLAYER_BEST_IN_CLASS_PLAN.md`; "RAP" = `docs/ONLINE_MULTIPLAYER_NETCODE_RESEARCH_AUDIT_PLAN_2026-06-23.md`. This plan does **not** duplicate their phases; it inserts a stabilization layer (Phase A) ahead of them and remaps the rest.

### Phase A — STABILIZE: make MP work at all again (S, blocker, do first)

Goal: round 2+ works, peer doesn't false-migrate, garbage delivers, no GPU-contention lag, console is readable.

| Task | Files | Detail |
|---|---|---|
| A1. Re-arm heartbeat on every round | ffa-p2p-game-state.js:1901 | Add `this.startHeartbeatLoop();` inside `startStateSyncLoop()` after the host guard. Covers all 4 host restart call sites; idempotent. **(fixes #2)** |
| A2. Default `lockEvents` OFF | ffa-p2p-game-state.js:258 | `readNetFlag('lockEvents', false)`. Removes the render fight + extra reliable load. **(fixes #6a, relieves #7c)** |
| A3. Diagnose split-brain | steam-networking.js:1062-1070 | Throttled `console.warn` per drop reason (hostSteamId/matchId/nonce/seq). Route inbound authoritative host packets through `hostMigration.onHeartbeat`; gate `initiateElection()` on no-authoritative-packet. **(hardens #3)** |
| A4. Local-player garbage-queue guard | ffa-p2p-game-state.js:2637 | Add `isLocalPlayer` guard so the peer stops clobbering its own predicted queue. **(fixes #4a)** |
| A5. Lightweight background + suppress downscale during match | OnlineMultiplayerMode.js (match start/cleanup), performance-monitor.js:947-950 | Switch to a cheap 2D/static background or pause the active theme RAF while `gamePhase==='playing'`; call `setAdaptiveDownscaleSuppressed(true)` for the match, restore on cleanup. **(fixes #1 GPU contention)** |
| A6. Force `continue` + guard blur for MP | main.js:1309-1310,1335; electron/main.js:486-488 | Force `backgroundTabBehavior='continue'` while in a match; guard the blur handler with `isMinimized()`. **(removes the cosmetic 10 FPS throttle mid-match)** |
| A7. Lobby spam/thrash guard | lobby-waiting-room.js:321,463-476 | Roster-signature dirty-check; gate per-player log behind debug; skip avatar re-batch when unchanged. **(fixes console spam)** |
| A8. Delete dead host loop | OnlineMultiplayerMode.js:2506-2569 | Remove `_startOnlineGameLoop` (calls non-existent `ffaGameState.update`). **(removes a latent trap)** |

Acceptance: a single 2-machine session plays ≥10 rounds with no false migration (no `initiateElection` during `playing`), garbage delivers each round, opponent boards keep moving (no >250ms freeze), `netDiag` `rx/s` stays nonzero across round boundaries, and the host console is not flooded.

### Phase B — SMOOTHNESS: honest, glide-rate opponents (M)

Builds on **BIC Phase 2** and **RAP Phase 2** (do not duplicate their interpolation-clock work).

- B1. **Rotation on the wire** — `_decodePiece` applies `getRotatedShape(type, rotation)` (binary-encoding.js:1026); add `rotation`+`pieceSpawnId`/`lockSeq` to `hasSignificantStateChanges()` (ffa-p2p-game-state.js:2115-2126) and `lastBroadcastState`. **(fixes #7a/#7b)** Cross-ref RAP Phase 2 "significant-change".
- B2. **Clamp piece x/y on encode** (binary-encoding.js:435-436). **(fixes #6b)**
- B3. **Single opponent render writer** — drop the 30Hz grid write in `_handleStateUpdate` (OnlineMultiplayerMode.js:1373-1376); let `_processRenderFrame` own grid+piece. Cross-ref BIC Phase 2.1.
- B4. **Decide lock-events** — either keep OFF, or finish it by routing the lock through the SAME interpolator path opponents render from (so snap and interp can't fight) and cap emit rate; skip emitting the host's own lock. Cross-ref RAP Phase 2 "GAME_PLAYER_LOCK as visual anchor".
- B5. **Cancellation truncation** — build the GarbageAttack with reduced row count up front, or truncate from the clean head not the hole tail, re-deriving connect bits over survivors (ffa-attack-router.js:369-397). **(fixes #4b)**
- B6. **Battle/activity log wiring** — wire dead methods + host-broadcast combo/cancel + dedupe all `add*` + fix `linesCanceled` spelling + relabel/relocate the lobby activity widget (online-kill-feed.js, lobby-waiting-room.js, ffa-p2p-game-state.js:1762). **(fixes #8b/#8c/#8d)** Cross-ref BIC Phase 0.4.

Acceptance: opponent piece glides at display rate; rotations are visible before lock; no teleport/glitch under 2–5% simulated loss; battle log shows KOs + garbage on both host and peer and refills after a round.

### Phase C — STRUCTURE: competitive-grade (L, higher risk, behind flags)

This is exactly **RAP Phases 1, 3, 4** and **BIC Phase 3** — do not re-plan; execute them with the corrections this audit found:

- C1. **Fixed-step sim** (RAP Phase 1 / BIC Phase 3.1) — finish `_runFixedStepHostSimulation` driven by a real timer, not RAF; then flip `simTickNetcode` after soak. Until then, alias `simTick`→`hostTick` (do not leave a frame-counter feeding the snapshot). **(completes #1 decouple)**
- C2. **Deterministic garbage** (RAP Phase 3 / BIC Phase 3.3) — **first fix the fence semantics**: `applyAfterLockSeq` is set to the victim's lock seq at SEND time (ffa-attack-router.js:390), useless for fencing. Use a target apply tick/seq evaluated at apply time. Dedupe by attackId/attackSeq. Branch on the (currently dead) `_deterministicGarbageEnabled`. Call `registerAttackerIds()` on roster change (binary-encoding.js:581) so attacker attribution stops resolving to `unknown_<hash>`.
- C3. **Buffer sizing + drop redundant attackId string** (binary-encoding.js) — size from actual length, cap serialized queue, carry only `attackSeq`. **(closes #4c)**
- C4. **Round/migration epoch + download-then-stream** (RAP Phase 4) — explicit resets of `_lockSeq`/`_lastLockHostTick` on restart; finish `migrationEpoch`; tie-break for two-host reconciliation.
- C5. **v4 protocol negotiation** — explicit envelope version + reject-with-resync (binary-encoding.js:612-614).

Acceptance: per RAP Phases 1/3/4 acceptance + deterministic-replay digest match.

---

## 5. Two-machine validation checklist (per phase)

Invariant (all phases): identical installer SHA256 on both machines; `localStorage` `serenity.netDiag='1'`, capture both consoles lobby→match→restart. Clear `serenity.netImpair` before each run.

**Phase A:**
- [ ] Set `serenity.lockEvents` confirmed absent/`'0'` on both; no `GAME_PLAYER_LOCK` traffic.
- [ ] Play ≥10 rounds: NO `initiateElection`/`promoteToHost` during `playing`; NO "two machines logging host authority".
- [ ] `netDiag rx/s` stays nonzero across every round boundary; `boardsApplied` keeps incrementing in round 2+.
- [ ] Garbage delivers each round (no double-insert/shifting holes; victim shape matches attacker).
- [ ] Enter a match on Winter theme: NO `[Visibility] Reducing rendering to 10 FPS` during the match; NO 1.0→0.5 downscale; peer not laggy.
- [ ] Host console is not flooded with `📊 [LOBBY] Updating player list`.
- [ ] If split-brain is provoked, the new warn at steam-networking.js:1069 fires (diagnosable).

**Phase B:**
- [ ] Opponent piece visibly rotates and slides before hard-drop (not just final locked state).
- [ ] No piece teleport on hidden spawn rows / tall stacks (x/y clamp).
- [ ] Under 2–5% loss + 50–150ms jitter: opponent renders behind but no freeze >keyframe window, no teleport.
- [ ] Battle log shows KOs + garbage on BOTH machines; refills after a round restart (not stuck empty past 12s).
- [ ] Combo/cancel rows appear for the opponent (after host-broadcast wiring).

**Phase C:** as RAP Phase 1/3/4 Tests/repro + Two-Machine Validation Guide (scenarios 2–7). Critically: garbage shape identical on attacker/host/victim (`attackId`/`sourceSimTick`/apply tick match); `simTickNetcode=1` soak shows identical board digests at 30/60/144 FPS; host migration produces exactly one accepted new host with no split brain.

---

## 6. Risk / guardrails

- **One change at a time, two-machine-gated.** The agent cannot run Steam P2P here; every behavior change ships behind a default-safe flag and waits for the user's two-machine validation (per RAP Execution Notes). The exception is Phase A, which restores known-broken pre-existing behavior and is low-risk.
- **Snapshot the WIP first** (`wip/netcode-rebuild` branch) so any stabilization commit is cleanly revertible without losing the +1,940-line rebuild.
- **Do not wire the netcode loop to `window.isRenderingReduced`/`shouldRenderFrame`.** The MP loop's decoupling from the theme throttle (unified-game-loop.js:115-155) is load-bearing — the "exempt MP from throttle" fix must not accidentally couple them.
- **Keep host authority intact.** Opponent interpolation/lock-events are render-only and must never change outcomes.
- **Keep ticks monotonic.** Do NOT reset `hostTick`/`simTick`/`snapshotSeq`/`_lockSeq` on round restart — the gen/tick fences and the `staleVsLock` guard depend on monotonicity; add explicit bookkeeping resets only with matching guard updates (C4).
- **`lockEvents`/experimental flags must match across machines** (non-negotiated default-on protocol change) — a flag-mismatch leaves one peer expecting anchors that never arrive. Validate with both machines on the same flag set.
- **Respect reduced-motion / `backgroundComboEffects`** for any new mini-board animation (BIC guardrails).
- **steamworks.js 0.4.0 is single-channel.** "Reliable vs unreliable" is the SendType arg, not separate transport lanes; the JS `channel` arg is dropped at the IPC layer (electron/steam-integration.js:1032). Do not design fixes around channel QoS — pace reliable traffic explicitly (RAP Phase 5).

Relevant files (absolute): `C:\Users\olovm\serenity-blocks\src\core\multiplayer\ffa-p2p-game-state.js`, `C:\Users\olovm\serenity-blocks\src\core\steam\steam-networking.js`, `C:\Users\olovm\serenity-blocks\src\core\network\binary-encoding.js`, `C:\Users\olovm\serenity-blocks\src\core\network\snapshot-interpolation.js`, `C:\Users\olovm\serenity-blocks\src\core\network\host-migration.js`, `C:\Users\olovm\serenity-blocks\src\core\network\input-jitter-buffer.js`, `C:\Users\olovm\serenity-blocks\src\core\multiplayer\ffa-attack-router.js`, `C:\Users\olovm\serenity-blocks\src\core\multiplayer\unified-game-loop.js`, `C:\Users\olovm\serenity-blocks\src\core\game-modes\OnlineMultiplayerMode.js`, `C:\Users\olovm\serenity-blocks\src\ui\online-kill-feed.js`, `C:\Users\olovm\serenity-blocks\src\ui\lobby-waiting-room.js`, `C:\Users\olovm\serenity-blocks\src\main.js`, `C:\Users\olovm\serenity-blocks\electron\main.js`, `C:\Users\olovm\serenity-blocks\src\utils\performance-monitor.js`, `C:\Users\olovm\serenity-blocks\src\themes\base-theme.js`.
