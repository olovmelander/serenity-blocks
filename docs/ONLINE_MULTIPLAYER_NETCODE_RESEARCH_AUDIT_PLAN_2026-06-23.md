# Serenity Blocks Online Multiplayer Netcode Research, Audit, and Plan

Status: planning document only. Date: 2026-06-23.

Scope: the Steam P2P online FFA mode in `src/core/multiplayer/`,
`src/core/network/`, `src/core/steam/`, and `src/core/game-modes/OnlineMultiplayerMode.js`.
This document intentionally does not re-plan the fixes already shipped in
`docs/MULTIPLAYER_ROOT_CAUSE_FIXES.md` and `docs/MULTIPLAYER_BEST_IN_CLASS_PLAN.md`.

## Target Netcode Decision

Keep the current macro model:

> Host-authoritative P2P. Predict the local board. Reconcile local prediction from host
> snapshots. Render opponents from host snapshots with interpolation and reliable lock
> events. Recover with reliable keyframes/resync. Make garbage a deterministic,
> frame-ordered, host-authored event stream.

Do not move this game to pure lockstep or full rollback as the default model.

Falling-block FFA is not a fighting game. The local board is mostly a private
single-player simulation; other players interact through delayed attacks, garbage
insertion, deaths, and round state. That means the important competitive contract is:

- Same seed/rules for comparable piece sequences.
- Authoritative input order per player.
- Authoritative lock/line-clear/attack events.
- Deterministic garbage hole masks and insertion timing.
- Replays/digests that prove the event stream.
- Smooth, honest opponent rendering that is allowed to be behind real time.

Rollback is strongest when remote frame-perfect decisions directly collide with your
current-frame decisions. Serenity's attacks can be resolved by host tick and applied on
defined insertion windows, so rollback would add state-save complexity and desync risk
without fixing the main visible problems. Delay-based lockstep would make local input
feel depend on the worst peer and would scale poorly toward 8-player FFA.

## Online Research

### Competitive stackers

Exact netcode for TETR.IO, Jstris, Tetris Effect Connected, and Puyo Puyo Tetris is
mostly closed-source. I am separating public facts from inference.

- TETR.IO publicly exposes network and performance-facing diagnostics in-client:
  FPS, total latency, spool latency, and backhaul latency appear in the UI source/data
  surfaced at `https://tetr.io/`. It also surfaces replay, ranked/rejoin/leave-penalty,
  suspicious replay, and modified-client warnings. Publicly visible lesson: competitive
  stackers treat observability, replays, reconnection, and client-integrity warnings as
  first-class product features. Exact server/netcode internals are not public.
- Jstris documents FFA/1v1/custom rooms, replays, speed limits, clear delay, garbage
  delay, garbage blocking, randomizer, messiness, and attack-table settings in its guide
  and public room settings pages. Public lesson: online stackers expose deterministic
  rule knobs and treat delayed/blockable garbage as part of competitive fairness rather
  than a rendering side effect.
- Tetris Effect Connected publicly documents/advertises online/local multiplayer modes
  such as Connected, Zone Battle, Score Attack, and Classic Score Attack. Exact netcode
  is not public. For Serenity, the useful comparison is mode design: competitive modes
  resolve attacks/score/zone state, not full rollback of every opponent visual.
- Puyo Puyo Tetris and Puyo Puyo Tetris 2 publicly document versus play where clears
  send garbage and players top out when their fields overflow. The exact online
  transport/model is not public. The transferable lesson is the same: garbage and
  attack timing are the cross-player contract.

Relevant links:

- TETR.IO: https://tetr.io/ and https://tetr.io/about/
- Jstris guide: https://jstris.jezevec10.com/guide
- Jstris room/settings surface: https://jstris.jezevec10.com/
- Tetris Effect Connected overview: https://en.wikipedia.org/wiki/Tetris_Effect
- Puyo Puyo Tetris: https://en.wikipedia.org/wiki/Puyo_Puyo_Tetris
- Puyo Puyo Tetris 2: https://en.wikipedia.org/wiki/Puyo_Puyo_Tetris_2

### Netcode models

Delay-based lockstep:

- Every client waits until all required inputs for a frame/tick are available.
- Excellent bandwidth and simple authority if deterministic, but responsiveness is
  bounded by the worst peer. For 8-player FFA it becomes fragile: one bad connection
  stalls everyone.
- Better fit: deterministic RTS, very old peer games, or small games where input delay
  is acceptable.

Deterministic rollback:

- Simulate immediately, predict missing remote inputs, rewind and replay if prediction
  was wrong. This is the GGPO/GGRS-style model.
- Requires very fast state snapshot/restore, strict determinism, and presentation code
  that tolerates corrections. YellowAfterlife's deterministic netcode guidance calls
  out the need for lockstep readiness and fast full-state save/load.
- Better fit: fighting games/platform fighters where both players directly interact on
  the same frame.
- For Serenity: overkill for default online FFA. We should invest in deterministic
  replays and event logs first; those are prerequisites for any later rollback-like
  experiment.

Snapshot interpolation plus prediction/reconciliation:

- Server/host simulates authority. Client predicts its own input, later reconciles using
  `lastInputSeq`. Opponents are rendered from snapshots delayed enough to interpolate.
- Gaffer on Games describes sequence-numbered snapshots, dropping older packets, and
  buffering snapshots to smooth jitter. At 30 pps, protecting against loss generally
  implies a larger delay than one frame; under real loss, 100-150 ms opponent delay is
  often less visible than freeze-then-teleport.
- Gabriel Gambetta's client prediction/reconciliation pattern matches Serenity's local
  model: server replies include the last processed input sequence; the client drops
  acked inputs and reapplies the rest.
- Best fit for Serenity's current architecture.

State synchronization:

- Gaffer's state sync sends inputs and state together, uses sequence/frame ids,
  priority accumulators, jitter buffers, and smoothing offsets rather than hard
  teleporting render state. This is useful for Serenity's future if we move opponents
  from full board streaming toward deterministic local re-simulation plus correction.

Relevant links:

- Gaffer snapshot interpolation: https://gafferongames.com/post/snapshot_interpolation/
- Gaffer state synchronization: https://gafferongames.com/post/state_synchronization/
- Gambetta prediction/reconciliation: https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html
- YellowAfterlife deterministic netcode: https://yal.cc/preparing-your-game-for-deterministic-netcode/

### Real-time networking techniques to adopt

- Lag compensation: for this genre, compensate by defining host ticks for locks,
  attacks, garbage apply windows, and round starts. Do not let wall-clock arrival time
  decide competitive outcomes except as an input to the host jitter buffer.
- Interpolation/extrapolation: opponents should render in the past using host tick or
  receive-time buffers. Prefer bounded hold-last over aggressive extrapolation for board
  grids. Hard drops and locks should snap via reliable lock events; falling-piece motion
  can interpolate.
- Jitter buffering: buffer peer inputs by measured arrival jitter and host tick, not by
  a locally invented cursor alone. Host input should get equivalent authority delay for
  fairness, while host visuals still predict immediately.
- Adaptive send rate: keep deltas unreliable and droppable; adapt per peer from real
  queue/loss/backpressure metrics. Reliable traffic should be small, rare, and
  gameplay-critical.
- Packet loss recovery: use reliable keyframes as bounded recovery and decode deltas
  only against known baselines. The already-shipped delta-baseline overtake fix is the
  right direction.
- MTU/coalescing: Steam can fragment/reassemble, but unreliable fragmented messages are
  bad for realtime because losing any fragment loses the message. Keep ordinary
  snapshots comfortably below MTU, coalesce small inputs, and chunk large resyncs only
  on reliable paths.
- Clock/tick sync: separate simulation tick, snapshot sequence, input sequence, and
  wall-clock time. Do not use one counter for all four jobs.
- Anti-cheat: host-authoritative P2P can prevent non-host state spoofing and validate
  inputs, but it cannot make the host trustworthy for ranked play. Best-in-class P2P
  still needs replays, board digests, impossible-action checks, and clear UI/product
  boundaries for competitive trust.

### Steam transport specifics

Steam's native networking APIs support a model that maps well to this plan, but
steamworks.js 0.4.0 exposes only part of it to this app.

- `ISteamNetworkingMessages` is a high-level UDP-like API with implicit connections.
  Native `SendMessageToUser` accepts a remote channel. Reliable messages on the same
  host/channel are ordered and delivered exactly once; unreliable messages may be
  dropped, duplicated, or reordered.
- Steam Datagram Relay can route traffic through Valve relays, hide IP addresses, and
  sometimes improve quality.
- Steam's native send flags distinguish unreliable, unreliable-no-delay, reliable, and
  buffered modes. The docs warn that unreliable messages larger than MTU can be
  fragmented, and if any fragment is lost the whole message is lost.
- `ISteamNetworkingSockets` exposes lower-level connection state and lanes. Lanes can
  give different reliable streams different priorities/weights and avoid some
  head-of-line blocking. That is a future native-addon path, not something the current
  JS layer gives us for free.
- In Serenity today, `steam-networking.js` uses logical channels in the JSON envelope,
  but `startP2PPolling()` drains a single physical P2P queue. Logical channels help
  sequence validation, but they do not create true transport QoS if the JS binding is
  channel-less underneath.

Relevant links:

- Steam networking overview: https://partner.steamgames.com/doc/features/multiplayer/networking
- ISteamNetworkingMessages: https://partner.steamgames.com/doc/api/ISteamNetworkingMessages
- Steam networking types/send flags: https://partner.steamgames.com/doc/api/steamnetworkingtypes
- ISteamNetworkingSockets lanes: https://partner.steamgames.com/doc/api/ISteamNetworkingSockets

## Quadra Extraction

Source root: `C:\Users\olovm\repositories\quadra\source`.

Quadra's useful patterns are not "copy the old protocol"; they are the invariants it
protected.

| Pattern | Quadra refs | What Serenity has | Gap / adoption idea |
| --- | --- | --- | --- |
| Packetized authoritative events | `packets.h:53-77` has `P_STAMPBLOCK`, `P_DOWNLOAD`, `P_LINES`, `P_MOVES`, `P_STATE`, `P_SERVERSTATE`, `P_SERVERRANDOM`. | Message types exist; lock events recently added. | Make lock/attack/garbage/round events first-class, sequenced, replayable records, not just state side effects. |
| Lock/stamp event | `packets.h:354-367` defines `Packet_stampblock`. | `GAME_PLAYER_LOCK` sends a reliable authoritative board snap in `ffa-p2p-game-state.js:3004-3016`. | Keep this; add attack ids / source lock seq so garbage attribution ties to the lock that produced it. |
| Download snapshot then stream | `net_server.cc:654-743` waits for no packet stack, syncpoint `Canvas::LAST`, idle canvases, then sends `Packet_gameserver` plus `Packet_download` per canvas. | Chunked resync exists; host migration sends one snapshot. | Make join/rejoin/migration explicitly two-phase: download snapshot, ack baseline, then live stream. Do not mix live deltas with an unacked download. |
| Snapshot contains RNG, pieces, pending garbage, attack attribution | `Packet_download` stores seed/current/next pieces, board occupancy, pending bonus lines, `attacks[]`, and `last_attacker` (`packets.h:427-448`, `packets.cc:628-740`). | Serenity snapshots include board/current/next/garbage queue, but not full RNG state, attack counters, or `lastAttackerId`. | Add download/resync fields for RNG/bag state, `lastAttackerId`, attack counters/history tail, and complete pending garbage metadata. |
| Per-line hole mask and final-in-burst bit | `Packet_lines` carries `hole_pos[36]` (`packets.h:451-466`, `packets.cc:742-774`); `Packet_download` packs `hole_pos` plus `final` (`packets.cc:689-692`, `734-738`); `Canvas::add_packet` sets `final` on the last queued line (`canvas.cc:442-452`). | Binary codec v3 supports `holeMask`, `variant`, and `isLastInBurst`. | `buildStateSnapshot()` currently serializes `type`, `attackerId`, `color`, `holeMask`, and `variant`, but not `isLastInBurst`. Preserve it through snapshot/resync/migration. |
| Authoritative survivor syncpoints | `Canvas::PLAYING/WAITFORWINNER/WAITFORRESTART/LAST` in `canvas.h:49-54`; `Net_list::check_first_frag()` calls `syncto()` across round states (`net_list.cc:802-916`); `syncto()` dispatches `Packet_serverstate` (`net_list.cc:1035-1045`). | `roundGeneration` and `readyBarrier` exist; barrier default off. | Promote round flow to an explicit host state machine and enable ready barrier after instrumentation/soak. |
| Deterministic input/demo stream | `Packet_moves` batches move bytes (`packets.h:551-570`, `packets.cc:851-876`); `Canvas::start_byte()` flushes at 50 bytes (`canvas.cc:1089-1127`). | Peer input batching exists; local prediction/reconcile exists. | Add tick-aligned input batches, duplicate/retry/ack policy, and replay logging from the host authority stream. |
| Replay verification | `Recording::write_packet()` records frame + packet bytes (`recording.cc:61-82`); playback stores `Demo_packet(frame,p)` (`recording.cc:301-340`); `quadra.cc` has headless verification returning nonzero on failure (`quadra.cc:674-681`, `791-796`). | Unit tests and demo replay tests exist, but not a canonical network event log. | Build a host event log that can replay a match headlessly in CI and compare board/score/garbage digests. |
| Lag/disconnect policy | `Net_list` periodically refreshes stats/test pings and drops laggy connections (`net_list.cc:453-493`). | Heartbeat and host migration exist. | Extend diagnostics to RTT/loss/gaps/resyncs and define reconnect/spectator policy. |

## Serenity Audit

### What is solid and should be preserved

- Host authority is established structurally: host processes inputs and broadcasts
  snapshots (`ffa-p2p-game-state.js:1145-1227`, `1897-1920`).
- Local prediction plus reconciliation exists and uses host-carried `lastInputSeq`
  (`ffa-p2p-game-state.js:1232-1262`, `1970-2008`; wrapper in
  `steam-networking.js:420-446`, `635-644`).
- Reliable lock events are a strong Quadra-style addition
  (`ffa-p2p-game-state.js:3004-3046`).
- Snapshot codec v3 now has the right garbage primitives
  (`binary-encoding.js:16`, `_encodeGarbageEntry`, `_decodeGarbageEntry`).
- Delta baseline overtaking is handled by peeking the delta baseline tick and silently
  dropping superseded stragglers (`steam-networking.js:576-609`).
- Round restart now resets game state in place, bumps `roundGeneration`, flushes jitter
  buffer, and forces a new keyframe (`ffa-p2p-game-state.js:3219-3301`).

### Highest-impact gaps

1. Authority gap: peer attack summaries are trusted.

   Host simulation for remote players intentionally suppresses garbage routing
   (`buildRemotePlayerCallbacks()` at `ffa-p2p-game-state.js:2864-2874`), while peers
   send `game:attack:request` with `cascadeSummary`, and the host routes it
   (`ffa-p2p-game-state.js:719-729`, `2510-2522`). That is responsive, but not
   best-in-class competitive authority. A modified peer can overstate line clears or
   attack metadata unless the host derives attacks from its own authoritative board.

2. Timeline model is mixed.

   `hostTick` increments when `broadcastGameState()` runs (`ffa-p2p-game-state.js:1897-1900`),
   not when the simulation advances. The jitter buffer has its own `currentTick` and
   `processCursor` (`input-jitter-buffer.js:51-53`), and the unified game loop is RAF
   delta-driven (`unified-game-loop.js:114-149`). This makes input fairness, snapshot
   ordering, lock-event ordering, and interpolation timing harder than necessary.

3. Current jitter buffer is a correctness delay, not real de-jittering.

   `processPlayerInput()` explicitly labels every input with `inputJitterBuffer.currentTick`
   because peer/host ticks were stale (`ffa-p2p-game-state.js:1167-1197`). This avoids
   stale drops, but adaptive depth no longer measures network offset. It cannot yet
   fairly align high-jitter peers.

4. Opponent interpolation is under-buffered and wall-clock based.

   `SnapshotInterpolator` uses `fullState.timestamp || Date.now()` from the host snapshot
   (`snapshot-interpolation.js:42-70`) and defaults to 50 ms delay
   (`snapshot-interpolation.js:15-18`). Without clock sync, host wall-clock timestamps
   are not a stable render timeline. At 30 Hz over the internet, 50 ms leaves too little
   jitter/loss slack.

5. Significant-change detection misses competitive visuals.

   `hasSignificantStateChanges()` checks piece x/y and `dropCounter`, but not rotation,
   piece id/spawn id, board hash, or garbage metadata changes beyond total pending lines
   (`ffa-p2p-game-state.js:1840-1868`). Rotation-only or metadata-only changes can be
   delayed until another field changes.

6. Snapshot/resync metadata is incomplete.

   `buildStateSnapshot()` includes garbage entries but omits `isLastInBurst`, attacker
   name, created/apply tick, and player `lastAttackerId` (`ffa-p2p-game-state.js:1749-1809`).
   Quadra's download snapshot included pending lines and attack attribution because late
   join/rejoin needs those to continue correctly.

7. Host migration is an authority assertion, not a full handoff protocol.

   New host election is lowest-id and guarded against split brain (`host-migration.js:73-183`;
   `_verifyHostReassignment()` in `ffa-p2p-game-state.js`). But `becomeHost()` broadcasts
   a single snapshot then resumes (`host-migration.js:124-140`). There is no migration
   epoch, event-log tail, download ack, or "freeze live deltas until baseline ack" step.

8. Reliable transport can still be congested.

   Reliable keyframes are now bounded at about 4/s and are necessary, but steamworks.js
   0.4.0's effective single physical P2P queue means logical channel 0/1/2 does not
   guarantee independent transport lanes (`steam-networking.js:515-523`). Resync chunks,
   keyframes, lock events, round messages, and control messages need explicit pacing and
   metrics.

9. Mock mode lags behind real binary delta handling.

   Real `handleP2PPacket()` decodes full and delta snapshots with baseline classification
   (`steam-networking.js:536-648`). `handleMockP2PMessage()` decodes binary payloads as
   full snapshots only (`steam-networking.js:869-891`). This can hide or invent failures
   in local multi-window testing.

10. Observability is useful but not yet diagnostic enough.

    `netDiag` logs peer rx/s, boards applied, generation drops, lock skips, opponent
    cells, phase, generation, and local ack seq (`ffa-p2p-game-state.js:2037-2068`).
    It does not yet include RTT, packet loss/gaps, keyframes/deltas, stale deltas,
    decode failures, resync in-flight, snapshot bytes, send rate/backpressure, jitter
    depth, input drops/future inputs, or heartbeat age.

## Phased Improvement Plan

### Phase 0 - Observability and reproducibility first

Impact: high. Risk: low. Rollout: default-on diagnostics, no gameplay behavior changes.

Root cause:
We cannot run a two-machine Steam session here, and current logs cannot separate
transport loss, decode loss, jitter-buffer delay, snapshot application, rendering, and
host migration.

Fix:

- Extend `netDiag` into one compact 1 Hz line with:
  `role`, `peer`, `phase`, `gen`, `simTick`, `snapshotSeq`, `rx/s`, `kf/s`, `delta/s`,
  `staleDelta/s`, `decodeErr/s`, `resyncReq/s`, `resyncInFlight`, `bytes p50/p95`,
  `sendRate`, `queueDrop/s`, `rtt`, `heartbeatAge`, `jitterDepth`, `inputDrop/s`,
  `inputFuture/s`, `lastAckSeq`, `lastAppliedLockSeq`.
- Add a per-match host event log in memory: input batches accepted, locks, line clears,
  attack events, garbage insertion, deaths, round transitions, resyncs, and migration.
- Add a mock/network impairment harness for unit tests and local multi-window runs:
  loss, reorder, duplication, delay, burst loss, and reliable-channel delay.
- Fix mock binary delta decoding to follow the same full/delta/baseline path as real
  `handleP2PPacket()`.

Borrowed from:
TETR.IO's visible latency/diagnostic posture, Gaffer's sequence/loss metrics, Quadra's
recorded packet stream.

Affected files:

- `src/core/multiplayer/ffa-p2p-game-state.js`
- `src/core/steam/steam-networking.js`
- `src/core/network/input-jitter-buffer.js`
- `tests/unit/*network*`, `tests/unit/*ffa*`

Tests/repro:

- Unit: mock transport with 5% loss and 10% reorder produces no resync storm.
- Unit: mock binary delta path decodes full + delta exactly like real path.
- Manual: two machines capture `netDiag=1` logs for baseline, loss, restart, and
  migration scenarios.

Flags:

- Keep `netDiag` default on.
- Add `netEventLog=1` default on in dev/builds, low overhead in release.
- Add `netImpair=...` mock/dev only, default off.

### Phase 1 - Separate simulation tick, snapshot sequence, input sequence, and clocks

Impact: very high. Risk: medium-high. Rollout: default off until soak.

Root cause:
`hostTick` is a broadcast counter, the jitter buffer has a private tick, and the loop is
RAF delta-driven. This prevents reliable fairness tuning.

Fix:

- Introduce host `simTick` advanced by a fixed-step accumulator. Keep visual rendering
  RAF-based, but apply authoritative gameplay on fixed ticks.
- Keep `snapshotSeq` separate from `simTick`. Every snapshot carries both.
- Keep `inputSeq` per client. Peer batches carry `inputSeq`, `clientFrame`, monotonic
  send time, and the peer's current host tick estimate. Host does not trust the client
  tick for authority; it uses arrival time plus measured offset/jitter to schedule input.
- Jitter buffer schedules by `applySimTick`. Adaptive depth is based on arrival jitter,
  not the temporary `currentTick - currentTick` offset.
- Host local input also goes through the authoritative delay for fairness, but the host
  sees local prediction immediately just like a peer.
- Snapshots include `lastProcessedInputSeqByPlayer` and `hostInputBufferDepthByPlayer`.

Borrowed from:
Gaffer state sync sequence/frame ids and jitter buffer, Gambetta reconciliation, Quadra
frame-stamped recording.

Affected files:

- `src/core/multiplayer/unified-game-loop.js`
- `src/core/multiplayer/ffa-p2p-game-state.js`
- `src/core/network/input-jitter-buffer.js`
- `src/core/steam/steam-networking.js`
- `src/core/network/binary-encoding.js`

Tests/repro:

- Unit: at 30/60/144 FPS render loops, identical input streams produce identical
  authoritative board digests.
- Unit: 0/50/150 ms latency peers are scheduled by host apply tick without host input
  advantage.
- Unit: burst-delayed inputs are held/dropped according to buffer policy with visible
  stats.

Flags:

- `simTickNetcode=0` default off.
- `adaptiveInputJitter=0` default off until Phase 0 diagnostics show stable behavior.

### Phase 2 - Opponent board smoothness and event polish

Impact: high. Risk: medium.

Root cause:
Opponent interpolation uses host wall-clock timestamps and a 50 ms buffer; discrete board
events arrive as state copies; rotation/piece identity are weak.

Fix:

- Drive interpolation from `simTick`/`snapshotSeq` plus local receive time, not host
  `Date.now()`.
- Raise baseline opponent render delay to 100-150 ms and adapt within a bounded range
  from measured snapshot jitter/loss. Prefer hold-last over extrapolating board grids.
- Add `pieceSpawnId` / `pieceLockSeq` to snapshots. Interpolate x/y/rotation only when
  the piece identity is stable. Snap hard drops and new spawns.
- Include rotation, piece id, board hash, and garbage metadata in significant-change
  detection.
- Keep reliable `GAME_PLAYER_LOCK` as the visual anchor. Add optional cosmetic-only
  mini-board animations for lock, line clear, garbage rise, and top-out, keyed by
  authoritative events.

Borrowed from:
Gaffer snapshot interpolation and Quadra `P_STAMPBLOCK`.

Affected files:

- `src/core/network/snapshot-interpolation.js`
- `src/core/multiplayer/ffa-p2p-game-state.js`
- `src/core/game-modes/OnlineMultiplayerMode.js`
- `src/core/network/binary-encoding.js`

Tests/repro:

- Unit: rotation-only changes cause a snapshot.
- Unit: interpolation chooses hold-last under missing snapshot and resumes without
  backward movement.
- Visual/manual: remote hard drop snaps once; soft movement does not freeze then
  teleport under 2-5% loss.

Flags:

- `adaptiveInterp=0` default off, then default on after two-machine validation.
- `opponentEventAnim=0` default off until visual review.

### Phase 3 - Host-authored deterministic garbage and attack authority

Impact: very high. Risk: high. This is the competitive-core phase.

Root cause:
The host simulates remote boards, but remote attack summaries are still peer-authored.
Garbage queue snapshots also lose metadata needed for deterministic continuation.

Fix:

- In authoritative mode, host remote-player callbacks route `onGarbageReady` from the
  host's own simulation. Peer `game:attack:request` becomes a prediction hint or is
  ignored for authority.
- Define an `AttackEvent`:
  `attackId`, `attackerId`, `sourceLockSeq`, `sourceSimTick`, `clearSummary`,
  `rulesHash`, `targetIds`, `scaledLines`, `cancelledLines`, `garbageLines[]`.
- Define each garbage line as:
  `attackId`, `lineIndex`, `targetId`, `holeMask`, `variant`, `isLastInBurst`,
  `attackerId`, `createdSimTick`, `applyAfterLockSeq` or `applySimTick`.
- Preserve `isLastInBurst`, `created/apply tick`, `attackId`, `attackerName`, and
  `lastAttackerId` through snapshots, binary codec, resync, host migration, and event
  logs.
- Make cancellation deterministic and evented: outgoing clears cancel queued incoming
  garbage in host order before sending remainder.
- Add a board/garbage digest that includes grid hash, current piece identity, RNG/bag
  state, garbage queue metadata, alive state, and last attacker.

Borrowed from:
Jstris-style garbage delay/blocking settings, Quadra per-line hole masks/final bits and
attack attribution, Gambetta/Gaffer authority model.

Affected files:

- `src/core/multiplayer/ffa-p2p-game-state.js`
- `src/core/multiplayer/ffa-attack-router.js`
- `src/core/garbage.js`
- `src/core/network/binary-encoding.js`
- `src/core/network/message-types.js`

Tests/repro:

- Unit: a modified peer attack summary cannot create garbage when host sim did not
  produce a clear.
- Unit: simultaneous clears at the same sim tick resolve in deterministic player order.
- Unit: garbage queue round-trip preserves `isLastInBurst`, `holeMask`, variant, and
  last attacker through binary snapshot/resync.
- Unit: replayed event log yields identical board/garbage/death digest.

Flags:

- `authoritativeAttacks=0` default off initially.
- `deterministicGarbage=0` default off until codec and replay tests are green.

### Phase 4 - Round flow, ready barrier, join/rejoin, and host migration

Impact: high. Risk: medium-high.

Root cause:
Round restart has generation fences now, but ready barrier is off and join/migration do
not yet follow Quadra's "download snapshot then stream" invariant.

Fix:

- Promote round flow to explicit host states:
  `waiting`, `countdown`, `playing`, `roundOver`, `restartDownload`, `readyBarrier`,
  `starting`.
- Enable `readyBarrier` by default only after Phase 0 diagnostics confirm no hangs.
  Keep timeout/backstop and log exact ready sets.
- Implement late join/rejoin/migration as:
  1. Assign `joinEpoch` / `migrationEpoch`.
  2. Pause live deltas for that peer.
  3. Send full download snapshot: match config, rules hash, seed/RNG/bag state, players,
     boards, current/next pieces, garbage queues, attack attribution, event-log tail,
     current `simTick`, `roundGeneration`, and snapshot baseline id.
  4. Peer applies and acks.
  5. Host starts live stream from a fresh keyframe after ack.
- Host migration:
  new host claims only if expected by election; increments migration epoch; sends
  download snapshot and recent event log; peers reject stale host messages by epoch.
- Reconnection:
  within a grace window, reclaim player slot and download snapshot; after grace, mark
  spectator or disconnected according to match config.

Borrowed from:
Quadra `Net_pendingjoin::step()` and `Packet_download`, Quadra syncpoint state machine.

Affected files:

- `src/core/network/host-migration.js`
- `src/core/multiplayer/ffa-p2p-game-state.js`
- `src/core/steam/steam-networking.js`
- `src/core/network/message-types.js`

Tests/repro:

- Unit: live deltas arriving before download ack are dropped by epoch/baseline.
- Unit: host migration cannot split brain under reordered claim/sync.
- Unit: stale old-host snapshots after migration are rejected.
- Manual: host quits mid-round; peer becomes host once, keeps boards and frags coherent.

Flags:

- `readyBarrier=0` today; target default on after Phase 4 validation.
- `downloadJoin=0` default off until proven.
- `migrationEpoch=0` default off until proven.

### Phase 5 - Transport resilience, MTU budget, and scaling toward 8 FFA

Impact: medium-high. Risk: medium.

Root cause:
Current binary snapshots are efficient, but reliable keyframes/resync/control still share
the effective JS transport. Scaling to 8 players increases snapshot size and reliable
contention.

Fix:

- Track encoded snapshot byte p50/p95/max by peer and player count.
- Keep ordinary unreliable deltas below a conservative MTU budget where possible.
- Coalesce input batches per simulation tick; include redundant last N input headers if
  moving any input path to unreliable later. For now, peer inputs can remain reliable
  unless telemetry proves HoL cost.
- Pace resync chunks so they do not starve lock/restart/keyframe traffic.
- Adapt snapshot rate by peer health:
  30 Hz good, 20 Hz mild loss/backpressure, 10-15 Hz degraded with larger interpolation
  delay. Never let the state queue grow unbounded; keep latest.
- For 8-player FFA, evaluate per-peer payload choices:
  local player gets full reconcile state; opponents may get lock events plus compact
  piece/board deltas; spectators can receive lower-rate state.
- Optional native-addon research:
  expose SteamNetworkingSockets connection info, real channels/lanes, and network
  quality metrics. This is the path to true reliable-lane priority; logical channels in
  the current JS envelope are not enough.

Borrowed from:
Steam send flags/MTU guidance, SteamNetworkingSockets lanes, Gaffer priority accumulators.

Affected files:

- `src/core/steam/steam-networking.js`
- `src/core/network/binary-encoding.js`
- `src/core/multiplayer/ffa-p2p-game-state.js`

Tests/repro:

- Unit: 8-player snapshot stays under target byte budget for common states.
- Unit: resync pacing still allows lock/restart control messages through.
- Manual: 2-player internet session with 5-10 restarts shows no decode/resync storm.

Flags:

- `adaptiveSendRate=1` keep safe once metrics exist.
- `nativeSteamSockets=0` not a runtime flag; separate spike/native addon decision.

### Phase 6 - Determinism, replay CI, and competitive integrity

Impact: high for trust. Risk: medium.

Root cause:
The app has unit tests and replay tests, but not yet a canonical host-authored event
stream that can adjudicate a real online match after the fact.

Fix:

- Make the host event log serializable and replayable headlessly.
- CI suites:
  seeded 2/4/8-player simulations; packet loss/reorder harness; round restart; host
  migration; resync chunk loss; codec fuzz; deterministic garbage; malicious peer
  attack summary rejection.
- Add a "suspicious match" marker:
  impossible input cadence, impossible attack output, digest mismatch, repeated resync,
  or host migration inconsistency.
- Make product boundaries explicit:
  host-authoritative P2P is good for private/casual competitive play. True ranked trust
  requires dedicated authority or a trusted relay/server model, not a player host.

Borrowed from:
Quadra replay verification, TETR.IO replay/integrity posture.

Affected files:

- New `src/core/network/replay-event-log.js` or similar.
- `tests/unit/*determinism*`, `tests/unit/*network*`.
- Existing multiplayer/game-state files only where events are emitted.

Tests/repro:

- CI must replay a saved host event log and match final digest.
- CI must fail if a remote peer can create garbage without host-derived line clears.

Flags:

- `recordNetReplay=1` in dev/test; release can keep ring-buffer only unless user opts in.

## Issue Ranking

| Rank | Player-visible impact | Risk | Primary fix |
| --- | --- | --- | --- |
| P0 | Hard-to-debug live failures | Low | Phase 0 diagnostics/event log/impairment tests |
| P0 | Competitive unfairness/cheat surface from peer attack summaries | High | Phase 3 authoritative attacks |
| P0 | Input fairness and host advantage ambiguity | High | Phase 1 fixed sim tick + real jitter scheduling |
| P1 | Opponent freezes/snaps under real internet jitter | Medium | Phase 2 adaptive interpolation + event polish |
| P1 | Round restart/migration state races | Medium-high | Phase 4 ready barrier + download-then-stream |
| P1 | Resync/keyframe/control HoL congestion | Medium | Phase 5 pacing, byte budgets, native spike |
| P2 | 8-player bandwidth/scaling ceiling | Medium | Phase 5 payload strategy |
| P2 | Ranked trust / disputes | Medium | Phase 6 replay and integrity markers |

## Two-Machine Validation Guide

The agent cannot run this. The user validates in Steam on two different machines and
accounts. Both machines must run the identical build.

### Build/install invariant

1. Build once: `npm run build:win`.
2. Record the SHA256 of the installer: `Get-FileHash <installer>.exe`.
3. Install the exact same installer on both machines with `/S`.
4. Confirm both consoles show the same app version/build id if available.

### Baseline flags

In DevTools console on both machines:

```js
localStorage.setItem('serenity.netDiag', '1');
localStorage.setItem('serenity.lockEvents', '1');
localStorage.setItem('serenity.readyBarrier', '0');
```

Reload both clients after changing flags. For ready-barrier validation later:

```js
localStorage.setItem('serenity.readyBarrier', '1');
```

### Console signals to capture

Capture both host and peer logs from lobby creation through match end/restart.

Required healthy signals:

- `📡 [NET] role=host|peer ... phase=playing gen=N myLastSeq=...`
- Peer `rx/s` remains nonzero while the opponent is active.
- `boardsApplied` increments on peers.
- `myLastSeq` advances after local inputs.
- Round restart logs show the new `roundGeneration`.
- With `readyBarrier=1`, host logs all expected ready players and then
  `All players ready -> starting round`.
- Host migration logs exactly one accepted new host.

Red flags to save with timestamps:

- `Binary decoding failed`
- repeated `missing_delta_baseline`, `delta_ahead_of_baseline`, or resync requests
- repeated `Dropped stale snapshot` during active play, not just around restarts
- `ready-barrier timeout` when both machines are responsive
- `lockSkips` rising continuously
- `boardsApplied=0` while `rx/s>0`
- `rx/s=0` while Steam lobby/heartbeat claims connected
- two machines both logging host authority after migration

### Scenarios

1. Lobby join by ID.
   Host creates lobby, peer joins by lobby ID. Start a match. Verify both rosters and
   names. Capture first 15 seconds of `netDiag`.

2. Basic 1v1 responsiveness.
   Both players move/rotate/hard-drop quickly for 2 minutes. Expected: local input feels
   immediate on both machines; opponent boards move continuously; no resync storm.

3. Garbage fairness.
   Both players perform near-simultaneous multi-line clears. Expected today: one battle-log
   event per actual clear, no duplicate deaths, no missing garbage after next spawn.
   After Phase 3: logs should include matching `attackId`, `sourceSimTick`, and
   `targetApplyTick` on both machines.

4. Round restart soak.
   Play and restart at least 10 rounds. Expected: no stale snapshot re-kill, no detached
   board, no stuck eliminated overlay, no generation mismatch. Repeat with
   `readyBarrier=1` once Phase 4 is ready.

5. Packet-loss/jitter soak.
   Use natural internet conditions first. If a dev impairment flag is implemented, run
   2-5% loss, 50-150 ms jitter, and one burst-loss case. Expected: opponent may render
   slightly further behind, but should not freeze for more than the keyframe window and
   should not trigger repeated resync.

6. Host migration.
   During active play, close/kill the host app. Expected current baseline: peer elects
   the lowest-id successor and receives one migration sync. Target after Phase 4: peer
   applies a migration-epoch download snapshot, rejects old-host traffic, and resumes
   with no split brain.

7. Reconnect / late join.
   After Phase 4 only: disconnect a peer briefly and rejoin. Expected: download snapshot
   then stream; no live delta applied before baseline ack; same round/garbage/frags.

## Execution Notes

- Do Phase 0 before any risky behavior change. The first real win is knowing why a
  two-machine failure happened.
- Do not enable `readyBarrier` by default until its ready-set logs and timeout behavior
  have been observed on real Steam.
- Do not enable `authoritativeAttacks` until tests prove the host simulation can derive
  remote line clears correctly and peers still get pleasant local prediction.
- Do not rely on logical channels as true Steam transport lanes. They are sequencing
  metadata until a native addon exposes lower-level SteamNetworkingSockets features.
- Keep each rollout behind a default-safe flag until the user validates it on two
  machines with the exact same installer.
