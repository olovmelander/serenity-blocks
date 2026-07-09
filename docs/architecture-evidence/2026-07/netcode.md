# Netcode Evidence Report — Multiplayer networking, protocol, trust model (Plan Phases 1 & 6)

*Measured against the working tree on 2026-07-03 (branch `cleanup/repository-files`). Every number below was measured, not quoted. All test results were run today.*

---

## 1. Ground truth today (measurements)

| File | Lines (measured) |
|---|---|
| `src/core/multiplayer/ffa-p2p-game-state.js` | **5,116** |
| `src/core/game-modes/OnlineMultiplayerMode.js` | 3,285 (160 DOM-touching lines) |
| `src/core/steam/steam-networking.js` | 1,589 |
| `src/core/network/binary-encoding.js` | 1,341 (FORMAT_VERSION **7**, binary-encoding.js:16) |
| `ffa-attack-router.js` / `frag-tracker.js` / `unified-game-loop.js` | 513 / 431 / 250 |
| `input-jitter-buffer.js` / `snapshot-interpolation.js` / `network-impairment.js` / `host-migration.js` / `message-types.js` | 468 / 460 / 325 / 199 / 78 |

The plan's delta table figure of "5,116 lines" (ARCHITECTURAL_REMEDIATION_PLAN.md:39) is **still exact today** — the file has not grown since 2026-07-01. The scope-freeze boundary appears to be holding.

**Tests:** 23 MP-focused unit files / **161 tests, all passing** (run 2026-07-03, 2.06s): `ffa-*` (16 files), `binary-encoding-roundtrip`, `input-jitter-buffer`, `network-impairment`, `online-battle-log`, `opponent-watch-animation`, `snapshot-interpolation`, `steam-networking-binary-snapshot`. The plan's "22 files / 152 tests" (line 72) is slightly stale — coverage grew (commit 145a067 added impairment/battle-log/watch-animation/interpolation/theme tests).

**Feature-flag defaults (verified today, all defined in the constructor via `readNetFlag`, ffa-p2p-game-state.js:50-61):**

| Default ON | Line | Default OFF | Line |
|---|---|---|---|
| `localBoardHold` | 299 | `simTickNetcode` | 211 |
| `holdStats` | 320 | `adaptiveInputJitter` | 212 |
| `peerLocalSim` | 347 | `lockEvents` | 277 |
| `opponentClearEvents` | 354 | `authoritativeAttacks` | 278 |
| `garbageIdempotent` | 360 | `deterministicGarbage` | 279 |
| `garbageDrainAll` | 368 | `downloadJoin` | 371 |
| `netDiag` | 399 | `migrationEpoch` | 372 |
| `netEventLog` | 404 | `readyBarrier` | 392 |
| `useJitterBuffer` (constructor field) | 221 | | |
| `useBinaryEncoding` (steam-networking.js) | 60 | | |

This exactly matches the plan's 2026-06-30 "Launch defaults" row (line 73). **Accurate.** Precedence is URL `?flag=1/0` → localStorage `serenity.<flag>` → default; the installed Electron app has no query string, so localStorage is the live toggle — which matters for the impairment hazard below.

---

## 2. The god-class responsibility map (extraction seams, TODAY)

Measured cluster boundaries in `ffa-p2p-game-state.js`:

| Lines | Cluster | Size |
|---|---|---|
| 1–126 | Module helpers: `readNetFlag` (50), CRC32 table (63–81), utf8/base64 (83–124) | ~126 |
| 127–427 | Constructor: flag wiring, resync/downloadJoin state, huge design-note comments | ~300 |
| 429–484 | Input hooks + `_runFixedStepHostSimulation` (451) | ~56 |
| 485–773 | **Roster/spectators**: `addPlayer` 485, `_registerSpectator` 605, `kickPlayer` 638, `removePlayer` 657, `announceJoin` 729 | ~289 |
| 774–1250 | **`setupNetworkHandlers` — 34 `network.on` registrations** (777…1240) | ~477 |
| 1252–1411 | Round restart + rematch voting | ~160 |
| 1412–1802 | **Input pipeline**: `_applyInputToPlayer` 1421, `_resolveBufferedInputTick` 1482, `processPlayerInput` 1554, `sendInput` 1683, `processInputBatch` 1741, `_applyLocalPrediction` 1782 | ~390 |
| 1803–2046 | Garbage insert/counter/top-out | ~244 |
| 2047–2192 | Match start + seeded RNG | ~146 |
| 2193–2290 | Sync/heartbeat loops + syncpoint (`_computeSyncpoint` 2264) | ~98 |
| 2291–2494 | **Snapshot build**: `buildStateSnapshot` 2291, DJB2 digest 2378, change detection 2402, `broadcastGameState` 2459 | ~204 |
| 2495–2641 | `syncFromHost` + desync backstop + piece reconciliation | ~147 |
| 2642–2882 | Net event log / netDiag / migration-epoch acceptance (`_acceptMigrationEpoch` 2762) | ~241 |
| 2883–3192 | **`_applySnapshotState` — one 310-line method** (round fence, epoch fence, peer-owns-board, hold heuristics, garbage adopt) | ~310 |
| 3193–3592 | **Download-join + chunked resync block**: blocked-peers 3193, `queueResync` 3240, `_sendResyncToPeer` 3278, window/chunk/retry 3352–3421, `_handleResyncAck` 3423, `_handleResyncChunk` 3457, `_applyResyncState` 3549 | ~400 |
| 3593–3746 | Lobby list/ready/standings/kill feed | ~154 |
| 3747–3825 | `handleHostDisconnect` 3747 + `_verifyHostReassignment` 3777 | ~79 |
| 3826–4292 | **Physics-callback factories**: `processBufferedInputs` 3869, `buildPhysicsCallbacks` 3930 (~157 lines), local-prediction 4087, remote 4124, garbage prediction 4160, spawn 4214 | ~467 |
| 4293–4382 | Authoritative lock/clear events | ~90 |
| 4383–4576 | Loop management + `promoteToHost` 4401, `renderAllPlayers` 4479 | ~194 |
| 4577–4940 | Restart + ready-barrier (`restartMatch` 4577, `_handleRoundReady` 4730, `restartFullGame` 4875) | ~364 |
| 4941–5087 | **DOM overlay**: `showCountdown` 4941 (inline `style.cssText` at 4960–4985), `hideCountdownOverlay` 5077 | ~147 |
| 5091–5116 | `cleanup` | ~26 |

**Plan staleness:** the review/plan say "28 handler registrations" (ARCHITECTURAL_REVIEW.md:108, plan line 242). It is **34 today** — six grew since the review (ready-barrier ×2, JOIN_REJECTED, PLAYER_KICKED, rematch ×2 among them). The `ResyncCoordinator` seam the review cites as "lines ~1916–2126" is badly stale; the block now lives at **3193–3592** plus the CRC32/base64 helpers at 63–124 and the queue-tick call in `maybeBroadcastPostPhysics` (2452) — ~460 lines total, still the cleanest first extraction (state already isolated in `resyncTransfers`/`resyncBuffers`/`pendingResyncs`/`downloadJoinPeers` Maps, constructor lines 253–259, 378–379).

---

## 3. Item-by-item verification of plan claims

### Phase 1 rows (mostly landed — verified)

- **Host double-apply fix: LANDED.** `processPlayerInput` buffers-only when the jitter buffer is on, with the exact Phase-5 cross-link comment the plan's sequencing note demands (ffa-p2p-game-state.js:1582-1591: "NOTE: temporary correctness fix. The structural fix is tick-boundary input application… see docs/ARCHITECTURAL_REMEDIATION_PLAN.md Phase 5").
- **`handleHostDisconnect` fix: LANDED** (3747–3757, now calls `initiateElection()` with a comment explaining the old TypeError).
- **`_verifyHostReassignment` quick fix: LANDED** (3777–3796), gates both `game:host:migrated` (1117) and `GAME_HOST_MIGRATION_SYNC` (1031); its doc-comment explicitly names itself "the Phase 1 quick fix; Phase 6 replaces the allowlist model with a default-deny one."
- **Attack-scaling comment/test: LANDED** (ffa-attack-router.js:423–437 documents the live 10%-per-opponent/25%-floor behavior and names the pinning table test; code at 438–468).
- **`docs/TWO_MACHINE_STEAM_VALIDATION.md`: STILL DOES NOT EXIST.** `docs/` has 10 ONLINE_MP/MULTIPLAYER docs but no two-machine checklist. The plan's most-cited remaining blocker (line 114) remains undefined.

### Phase 6 rows — current-state accuracy

- **"network impairment is constructed from localStorage/URL in the live send path" — ACCURATE.** `steam-networking.js:86` constructs `new NetworkImpairmentHarness(readNetworkImpairmentConfig())` unconditionally; `readNetworkImpairmentConfig()` reads localStorage `serenity.netImpair` + 11 URL params (network-impairment.js:177–208); **every** outbound envelope passes `planDelivery()` (steam-networking.js:330–350). There is no dev/release gate. A stale localStorage entry from a test session silently drops/delays real Steam packets. (Mitigation is trivial: guard on `SteamConfig.mockMode || import.meta.env.DEV`, or require `?netImpair` explicitly.)
- **"sender validation is still allowlist-based, not schema/default-deny" — ACCURATE**, and see §5 for the concrete gaps.
- **"Host migration still refreshes from NET_HEARTBEAT only" — ACCURATE.** `hostMigration.onHeartbeat()` is invoked solely from the `NET_HEARTBEAT` handler (ffa:1020–1023). Authoritative host packets (snapshots, locks, round restarts) do **not** refresh liveness — a host that streams 30Hz snapshots but whose heartbeat timer is starved would be declared dead. Worse: **any sender** refreshes it (no `msg.from === hostSteamId` check), and `onHeartbeat` also cancels an in-progress election (host-migration.js:61–68) — a hostile peer can indefinitely suppress a legitimate election or keep a dead host "alive".
- **"InputValidator per-input interval check disabled" — ACCURATE.** The interval rejection is still commented out (input-validator.js:80–83); only the 140/s rolling window rejects (103–109); kick-after-N is still `// TODO` at the call site (ffa:1575); `validateMove/Rotate/Drop` remain enum-shape-only (input-validator.js:140–184).

### A plan-invisible regression: desync detection is dead **again**

The review's finding #4 was "the DJB2 digest is never serialized on the binary path." That transport half was fixed — the digest rides the JSON wrapper (`_digest`, steam-networking.js:492) and is re-attached on receive (687–689). **But the detection is still inert:** both comparison branches in `syncFromHost` are gated on `this._desyncCheckEnabled` (ffa:2499, 2550), which is **never initialized in the constructor and `setDesyncDetection()` (2637) has zero callers anywhere in the repo** (verified by repo-wide grep). So:

- the `peerLocalSim` score/lines divergence backstop (2510–2531) never runs, and
- the legacy digest path (2532–2560) never runs.

This matters because the constructor's own design note (ffa:340–343) declares the digest backstop the safety net that makes peer-owns-board safe ("the digest triggers ONE clean forceLocal resync"). Today the only resync triggers are transport-level (missing/ahead delta baseline, decode failure — steam-networking.js:650–684) and rejoin. A genuine sim divergence (host-dropped input, gravity-timing skew) produces a *permanently* drifted peer board. **The plan should add: "initialize `_desyncCheckEnabled = true` (or a `readNetFlag('desyncCheck', true)`) + a pinning test that a forced divergence fires exactly one forceLocal resync" — Phase 1-grade, not Phase 6.** The plan's Phase 1 row "manually verify the chunked CRC32 resync fires on forced divergence" (line 109) would fail today if anyone actually ran it via state divergence.

---

## 4. Measured envelope cost (plan says "~6×" — it is 11× today)

Wire format: the renderer envelope object is serialized once — `Buffer.from(JSON.stringify(data))` in `electron/steam-integration.js:1039`. Measured with the real `BinaryEncoder` (2-player snapshot, one piece moved one cell — the dominant 30Hz frame) and the exact `_buildEnvelope` (steam-networking.js:1028–1047) + binary wrapper (479–496) shapes:

| | Binary payload | Wire bytes | Overhead |
|---|---|---|---|
| **Delta packet** | 44 B | **490 B** | **11.1×** |
| Keyframe (reliable, 4/s) | 407 B | 976 B | 2.4× |

Decomposition of the 446 wasted delta bytes:
- **Envelope: 242 B/packet** — `hostSteamId` 33, `matchNonce` 31, `matchId` 30, `msgType` 27 (`"game:state:full"`), `protocolVersion` 25, `sentAt` 22, `envelopeVersion` 19, `channel`/`seq`/`tick` 11 each (+ JSON braces). All but `seq`/`sentAt` are constant per session.
- **Wrapper: 188 B** beyond the base64 — `_binary/_delta/_gen/_migrationEpoch/_acks/_digest/_originalSize/_encodedSize` keys (steam-networking.js:479–496). The wrapper has *grown* since the review measured ~276 B total (adding `_gen`, `_migrationEpoch`, `_acks`), which is why the plan's "~6×" understates today's overhead.
- **Base64 inflation: 16 B** (44→60 chars).

**Hidden CPU cost:** `_originalSize: JSON.stringify(data).length` (steam-networking.js:494) runs a **full JSON stringify of the entire multi-player snapshot on every 30Hz broadcast** purely for a debug stat. At 8 players this is kilobytes of stringification per packet per peer tick. Deleting it is a free host-side win the plan doesn't mention.

**Concrete compaction design the plan lacks:** (1) move `matchId/matchNonce/hostSteamId/protocolVersion/envelopeVersion` to the NET_HELLO/NET_WELCOME handshake + re-send on change (host migration already re-announces via `refreshMatchSession`, steam-networking.js:1410); keep only `t` (type-id byte), `c`, `s`, `ts` per packet; (2) fold `_gen/_migrationEpoch/_digest/_acks` into the binary format as a v8 header (versioned decode already exists, binary-encoding.js:687,784); (3) send raw bytes — `steam:sendP2PPacket` already accepts a Buffer body; only JSON forces base64. Realistic result: 44 B payload + ~12 B header ≈ 60 B vs 490 B → **~8× reduction on the dominant packet**, meeting the Phase 6 "near-1×" exit criterion. Validation: assert `snapshotBytesSent.p95` (already sampled, steam-networking.js:1363–1372) via `getPacketStats()` before/after; abort criterion: any increase in `deltaDecodeFailures` or `resyncRequestsSent` during a 2-peer soak.

---

## 5. What default-deny concretely means against today's code

Today `_isSenderAllowedForMessage` (steam-networking.js:1088–1100) rejects only: *peer receiving* one of **11** `HOST_AUTHORITATIVE_MESSAGE_TYPES` (23–35) from a non-host. Everything else passes. Handler-level guards exist for `PLAYER_KICKED` (ffa:995), `game:host:handoff` (ffa:1129), and the two migration messages via `_verifyHostReassignment` (ffa:1031, 1117). **Unguarded holes measured today:**

1. **`LOBBY_GAME_START` (ffa:979–987):** any peer can send it to another peer → victim calls `startMatch(attackerSeed, attackerConfig)` mid-lobby. Not allowlisted, no sender check.
2. **`GAME_ROUND_START` (ffa:1155–1169):** generation check only; any peer can prematurely release another peer's ready-barrier.
3. **`LOBBY_PLAYER_LEFT` (ffa:975–977):** `removePlayer(msg.data.steamId)` for any sender — a peer can evict anyone from everyone's roster.
4. **`LOBBY_PLAYER_JOINED` list adoption (ffa:929–933):** a peer accepts a full roster rewrite from any sender.
5. **`NET_HEARTBEAT` (ffa:1020–1023):** any sender refreshes host liveness and cancels elections (§3).
6. **Host-side inputs:** the allowlist only runs on peers (`!this.isHost`, steam-networking.js:1090); the host accepts every message type from anyone (inputs are keyed by transport `msg.from`, which is Steam-authenticated, so impersonation is blocked — but resync-request spam per peer is only cooldown-limited, 1181–1191).

**Concrete policy design:** replace the Set with a role table in `message-types.js` (it is already `@ts-check`ed): `{ [msgType]: { sender: 'host'|'peer'|'any', receiver: 'host'|'peer'|'any', inMatch?: boolean } }`, enumerate **all** message types (34 registered + net:ping/pong/error), and make `_isSenderAllowedForMessage` **drop any unlisted type** and any type whose sender-role check fails against `hostSteamId`. Keep `_verifyHostReassignment` as the *stateful* exception path for the two migration messages (an election legitimately changes who "host" is). Count rejections into `packetStats.validationFailures` and surface per-type counters in `netDiag`. Note the envelope's `matchId/matchNonce/hostSteamId` **cannot** serve as authentication — every lobby member learns all three via NET_WELCOME (ffa:816–824); sender authenticity rests entirely on steamworks' transport `packet.steamId`. In mock/BroadcastChannel mode `message.from` is self-reported (steam-networking.js:361), so the mock harness can and should be used to *test* spoofing.

Risk/abort: over-tightening breaks host migration and rejoin — the table must be landed with the existing `ffa-host-authority.test.js` + new spoof tests per hole above, and a two-machine migration drill before default-on. Perf impact: negligible (one Map lookup per packet).

---

## 6. Realistic post-decomposition module layout

The plan's "no single networking file > ~800 lines" exit criterion is achievable with this cut (sizes from the measured cluster map):

| Module | Pulls from (today's lines) | Est. size |
|---|---|---|
| `ffa/resync-coordinator.js` — chunked transfer, download-join fences, CRC32/base64 | 63–124, 253–259, 378–379, 2282–2289, 3193–3592 | ~500 |
| `ffa/network-handler-registry.js` — declarative `{type, role, handler}` table replacing `setupNetworkHandlers` | 774–1250 | ~450 |
| `ffa/snapshot-codec.js` — build/apply/digest/change-detection (bind to `PlayerSnapshot` type first, per plan 3a) | 2291–2494, 2883–3192 | ~550 |
| `ffa/input-pipeline.js` — send/batch/jitter-schedule/apply/prediction | 1412–1802, 3869–3925 | ~450 |
| `ffa/garbage-system.js` — queue insert/counter/prediction/drain-all/idempotent adopt | 1803–2046, 4140–4213 | ~350 |
| `ffa/round-lifecycle.js` — restart, ready-barrier, rematch, match start | 1252–1411, 2047–2192, 4577–4940 | ~650 |
| `ffa/roster.js` — players/spectators/kick/join/announce/lobby list | 485–773, 3593–3746 | ~440 |
| `ui/multiplayer-countdown.js` — DOM overlay out of core (plan row, trivially separable: only touches `#multiplayer-countdown` + `emitMultiplayerEvent`) | 4941–5087 | ~150 |
| `ffa-p2p-game-state.js` (slim core) — flags, loops, host promotion, migration epoch, netDiag/event log | remainder | ~700–800 |

Order: overlay (zero risk) → ResyncCoordinator → HandlerRegistry → snapshot-codec (**only after** Phase 3a types cover `awaitingSpawn`/`roundGeneration`/`migrationEpoch`/garbage-entry metadata — `buildStateSnapshot` at 2291 and `_applySnapshotState` at 2883 are exactly the 2-of-5 drift sites the plan warns about). Each step is a pure move + constructor injection (`new ResyncCoordinator({ network, getSnapshot: () => this.buildStateSnapshot(), applySnapshot, recordNetEvent })`); the 161-test suite is the regression net, and every one of the 16 `ffa-*` test files constructs `FFAGameStateP2P` directly, so its public surface must be preserved or tests updated mechanically.

---

## 7. What Phase 6 is missing (gaps with no plan line at all)

1. **Join/resync lifecycle state machine.** The peer join path is a tangle of implicit states: `handshakeComplete` (260), `_announceTimer` resend (261), `downloadJoinInProgress` (379), `_pendingRoundStart` (411), `awaitingSpawn`, plus the host-side `downloadJoinPeers` and `pendingResyncs`. There is no single `joinState: hello → welcomed → downloading → applying → live` enum; the fences are scattered guards (2896, 2904, 3215). Phase 6 should mandate an explicit state machine with per-transition net-events — this is the Quadra "pending-join waits for a safe sync point" pattern the plan cites (line 50) but never turns into a design.
2. **Backpressure × resync interaction.** Resync chunks (16 KB × window 4, retry every 300 ms — ffa:35–38) are sent via reliable channel 0 `sendP2PMessage` (3361), completely bypassing `_queueSnapshot`'s per-peer pacing (steam-networking.js:1252–1343), which only governs unreliable snapshots on channel 1. Keyframes are also reliable-immediate (522–527). Nothing arbitrates the steamworks.js **single physical queue** between a 64 KB resync burst, 4/s keyframes, and control messages. The plan's "transport budgets and pacing" row (line 250) exists but gives no mechanism; concretely: route resync sends through a paced sender with a bytes-per-tick budget, and add a `pendingOutgoingSnapshots`-style gauge for reliable bytes in flight.
3. **Protocol versioning/migration story.** `protocolVersion` is a hard-equality string `'1.0.0'` (steam-networking.js:49, 1112) — any change bricks cross-version lobbies with only a `net:error`. Binary format has real versioning (v4–v7 decode paths, binary-encoding.js:687–708) but the envelope/handshake has no min-supported/negotiation. Phase 6 needs: NET_HELLO carries `[minVersion, maxVersion]`, host picks, JOIN_REJECTED with a user-visible "update required" reason; and the schema/range table (plan line 245) should be keyed by protocol version.
4. **Fuzz testing the decoder.** The decoder is defensively bounds-checked (`_assertAvailable` throws RangeError, binary-encoding.js:643–645; `MAX_NEXT_PIECES` 32 caps at 901/983; magic-word checks 682/778), and the main process caps packets at 64 KB — but nothing fuzzes it. Untrusted P2P input parsed by 1,341 lines of hand-rolled binary decode is the textbook fuzz target: a seeded byte-mutation corpus over `decodeSnapshot`/`decodeDeltaSnapshot`/`peekDeltaBaselineTick` asserting "throws or returns well-formed, never hangs/allocates unbounded" is a ~half-day Vitest addition.
5. **Re-enable the divergence backstop** (§3 — `_desyncCheckEnabled` dead). This should be lifted *into* the plan text; it currently contradicts the plan's "desync digest wrapper is landed" framing.
6. **`syncpoint` is heartbeat-shaped but unauthenticated and low-resolution** — `_computeSyncpoint` (2264–2268) is only `'download' | 'busy' | 'idle'` and gates resync sends (2284); the syncpoint-aware download-join row (plan line 241) should define it as (simTick, roundGeneration, no-active-cascade, no-pending-restart) rather than the boolean it is now.
7. **`game:state:resync:ack` spoofing/DoS:** any peer can request unlimited resyncs for itself; per-peer cooldown exists only on the *requester* side (steam-networking.js:1181–1191); host-side `queueResync` has coalescing (3286–3288) but no per-peer rate cap. Cheap fix, unlisted.

---

## 8. Two-machine validation scenarios that matter most

For `docs/TWO_MACHINE_STEAM_VALIDATION.md` (the still-missing Phase 1 artifact), the highest-value scenarios given