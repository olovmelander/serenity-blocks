# Online Multiplayer — Root‑Cause Fixes & Repro Guide (2026‑06‑23)

Deep investigation (4 parallel agents + Quadra architecture study) of three reported failures, fixed at the **root cause** with regression tests, logging, and repro steps. The agents **ruled out** my earlier Phase‑1 keyframe change as the cause — these are deeper, mostly pre‑existing bugs.

---

## Bug 1 — Local board glitches (pieces/ghosts everywhere)

**Symptom:** on a peer, your *own* board sprays tetrominoes, ghosts, and locked cells.

**Root cause:** the binary snapshot codec **never encodes `lastInputSeq`**, so on a peer it's pinned at `0`. `_reconcileLocalPlayer` prunes the input history with `seq > lastInputSeq` → prunes nothing → **replays the entire input history (up to 120 inputs, including hard‑drops) onto the authoritative board on every ~30 Hz snapshot** (`ffa-p2p-game-state.js` `_reconcileLocalPlayer`).

**Fix (root):** carry per‑player `lastInputSeq` in the snapshot **JSON wrapper** (like the existing `_digest`) and re‑attach it on decode — the codec drops it, the wrapper restores it. Now only genuinely unacked inputs replay. (`steam-networking.js` `broadcastSnapshot` `_acks` + `handleP2PPacket` re‑attach; `_applySnapshotState` now honors `lastInputSeq != null` so `0` isn't skipped.)

**Repro:** Host + 1 peer, peer plays and hard‑drops a few pieces → before fix the peer's board fills with stray cells/ghosts within seconds; after fix it's clean. Log to watch (peer): no more constant full‑history replay.

**Regression test:** `tests/unit/ffa-round-fence-and-reconcile.test.js` → "reconciliation pruning" (prunes acked, replays only unacked; pins the `lastInputSeq=0 ⇒ full replay` failure mode).

---

## Bug 2 — Round 2 unplayable (everyone frozen)

**Symptom:** round 1 fine; round 2 UI starts but no one can move.

**Root cause:** a **stale round‑1 snapshot** (unreliable, deferred, channel 1) arrives **after** the reliable `GAME_ROUND_RESTART` (channel 0) and clobbers the freshly‑revived state back to `isAlive=false` / `gamePhase='finished'`. The unified loop then skips the player (no gravity) and `sendInput` rejects (`gamePhase!=='playing'`). The per‑channel seq guard can't catch it (different logical channels). There was **no round/generation fence** on authoritative state.

**Fix (root):** a monotonic **`roundGeneration`**, stamped into every snapshot + the restart message + the resync header. `_applySnapshotState` **drops any snapshot whose generation is older than the peer's current round**. Host bumps it in `restartMatch`; peer adopts it in `performRoundRestart`. (Inspired by Quadra's `P_SERVERRANDOM`/syncpoint round boundary.)

**Repro:** Host + peer, finish a round (one tops out) → before fix round 2 is frozen for both; after fix round 2 plays normally. Log to watch (peer): `⏮️ [FFA] Dropped stale snapshot: gen N < current N+1` right after `🔄 [FFA] Peer round restart → generation N+1`.

**Regression test:** same file → "round‑generation fence" (drops stale gen, applies current/newer/back‑compat).

---

## Bug 3 — Battle Log not working

**Root causes (verified):**
- **(host)** natural top‑outs caught by `updateAllPlayers` called `recordDeath` but emitted **no `PLAYER_TOPPED_OUT`**, and the host never receives its own network broadcast → no row. **Fixed:** emit it there.
- **(both)** the feed was **never cleared on round restart**, so last round's rows bled in for ≤12 s. **Fixed:** `killFeed.clear()` on `ROUND_RESTART`.
- Added a **dedup guard** (`OnlineKillFeed._isDuplicate`, 3 s window) so the same death from a local event + a network broadcast collapses to one row.

**Deferred (enhancements, not bugs):** logging frags as kill rows, garbage‑cancel/combo/join‑leave rows (UI methods exist but are unwired).

**Repro:** play a round with kills + garbage on both machines → Battle Log shows kills *and* garbage on host and peer, and is empty at the start of each new round.

---

## Round 2 — deeper peer fix (the round still didn't restart on the peer)

The generation fence stopped the *clobber*, but a second cause remained: the host **never forced a fresh keyframe on round restart**, so the peer's first round‑2 packet was a **delta encoded against the pre‑restart keyframe** — and because `hostTick` is monotonic across rounds the baseline‑tick guard didn't catch it, so the peer decoded round‑2 against round‑1 data → corrupted/frozen peer board. **Fix:** `SteamNetworking.resetSnapshotBaselines()` (clears `lastKeyframeSnapshot`/`lastFullSnapshotAt` + receive baselines), called on both sides of the restart, so the first post‑restart packet is a guaranteed full keyframe.

## Garbage — wrong/garbled on peer victims (host fine)

The binary codec **truncated the hole mask to 8 of 10 columns** (`& 0xFF`) and dropped `variant`/`isLastInBurst`. The host inserts garbage into its authoritative board *before* encoding, so the host victim was fine — but peer victims got wrong holes / mis‑typed garbage (the exact host‑vs‑peer asymmetry). **Fix:** pack the full 10‑bit mask + `variant` + `isLastInBurst` into the garbage entry's type‑byte spare bits (no size change), `FORMAT_VERSION 2→3`, and carry `isLastInBurst` through the snapshot reconstruction. (Outgoing peer attacks were already correct; note a *single‑line clear sends 0 garbage* by Quadra design — that's not a bug.)

**Regression test:** `tests/unit/binary-encoding-roundtrip.test.js` → garbage entries with hole columns 8/9 + variant + isLastInBurst survive encode→decode.

## Battle Log — different rows on host vs peer

Root cause: the host logs at **simulation time** (local echo) and the peer at **network‑arrival time**, and a victim‑name + 3 s dedup over two unsynchronized clocks guarantees divergence. **Fix:** dedup on a **stable `eventId` = `death:${victim}:${roundNumber}`** (roundNumber is in lock‑step on both nodes), so the host's local event and the peer's network message collapse to the *identical* single row regardless of timing.

## Logging added (search these tags in the console / `steam-init.log`)
- `⏮️ [FFA] Dropped stale snapshot: gen X < current Y` — the round fence firing.
- `🔄 [FFA] Round restart → generation N` (host) / `🔄 [FFA] Peer round restart → generation N` (peer).

## Quadra patterns adopted / queued (`C:\Users\olovm\repositories\quadra`)
- **Adopted:** round‑generation fence ≈ Quadra's reseed‑at‑round‑boundary.
- **Queued (high value, see plan Phase 3/4):** reliable discrete **lock events** to anchor opponent boards (kills "freeze‑then‑teleport"); **download‑snapshot‑then‑stream** for clean join/host‑migration; **all‑players‑ready syncpoint** for round transitions (vs host‑local timer); per‑line **hole‑bitmask garbage applied at next lock**; **demo‑replay determinism test** in CI.

## Quadra‑grade structural upgrades — SHIPPED (v9)

Three of the queued Quadra patterns are now implemented, unit‑tested, and **default ON** (each has a debug off‑switch URL flag). They harden the exact failure classes above instead of only patching symptoms.

### 1. Reliable LOCK‑EVENTS (anchors opponent boards) — `?lockEvents=0` to disable
On every piece settle the **host** broadcasts a reliable, self‑contained authoritative board for that player (`GAME_PLAYER_LOCK`: `playerSteamId`, monotonic `lockSeq`, `roundGeneration`, `hostTick`, `grid`, `currentPiece`, `topOut`). Peers **snap the opponent's board to truth** the instant it locks instead of waiting for the next lossy 30 Hz frame — kills the "freeze‑then‑teleport" between snapshots. The receiver (`_applyAuthoritativeLock`) is **idempotent** (drops replays/old `lockSeq`), **round‑fenced** (drops a lock from a superseded round), and **never snaps the local player** (prediction owns it). A companion guard in `_applySnapshotState` (`staleVsLock`: `state.tick <= player._lastLockHostTick`) stops an in‑flight 30 Hz snapshot from *un‑locking* a freshly snapped board. Emitted via `broadcastToAll` (reliable, channel 0). Purely additive — an old peer without the handler just ignores the message.
*Tests:* `ffa-round-fence-and-reconcile.test.js` → "Quadra lock-events" (snap, fence, idempotency, skip‑local, flag‑off).

### 2. All‑players‑READY round syncpoint — `?readyBarrier=0` to disable
The old restart **instant‑started** the next round and resumed 30 Hz broadcasts before the peer had even processed the restart. Now the host‑driven barrier: the restart message carries `awaitReady`; each peer resets, sends `GAME_ROUND_READY{roundGeneration}`, and **waits**; once every expected player has acked (or a **2500 ms host timeout** fires) the host broadcasts `GAME_ROUND_START` and everyone starts **together**. Cannot hang: host timeout backstop **and** a peer‑side fallback (`timeout + 1500 ms`) that starts locally if the GO is ever lost. Host‑driven so only the host's flag matters; default OFF = the legacy instant path, unchanged.
*Tests:* same file → "Quadra ready-barrier" (expected‑set, solo‑immediate, block‑then‑ack, idempotent finalize, timeout fallback).

### 3. Demo‑replay DETERMINISM CI guard
`tests/unit/ffa-demo-replay-determinism.test.js` replays a fixed input demo on the **real** seeded RNG (`createSeededRNG`) + sim (`fillBag`/`spawnPiece`/`move`/`rotate`/`hardDrop`): same seed → byte‑identical board + piece sequence; different seed → different sequence. Pins the seed→pieces→board contract that host‑authoritative round restart depends on, so a future non‑determinism regression in the RNG/bag/lock path is caught in CI instead of as a live desync.

### Still queued (lower priority)
**Download‑snapshot‑then‑stream** for clean join/host‑migration; deterministic frame‑ordered garbage was assessed as **already deterministic** under host authority (host inserts before encoding) and deferred.

### New logging tags
`🚦 [FFA] …` — ready‑barrier (ready received / all‑ready start / peer waiting / peer start / fallbacks). `⏱️ [FFA] …timeout…` — barrier timeout fallbacks firing.

## v9.1 — diagnostic build (2026‑06‑23)

Reported "still not working good" on the PEER across **all four** axes at once (opponent board wrong, round won't restart, garbage wrong, own board glitches), host fine. A 3‑agent pipeline audit's top theories were **verified false**: mock‑mode handler bugs don't apply (real Steam P2P uses `handleP2PPacket`, not `handleMockP2PMessage`); the `staleVsLock` lock‑event guard is benign (`hostTick` is monotonic and never resets between rounds, so at most one redundant snapshot is skipped right after a lock); the opponent‑render "two‑writer fight" is harmless for the grid (both writers source the same applied `gameState.boardGrid`). The true systemic cause is **not yet identified** — so this build instruments rather than patches.

- **Console noise silenced** so netcode logs are readable: `[ParticleCompat]` (per‑emit), `[SharedEffects] playHardDropEffect`, `[Winter] Frost Snap` are now gated (`?debugParticles=1` / `?debugEffects=1`). These were flooding hundreds of lines and truncating the real logs.
- **`📡 [NET]` 1 Hz peer health line** (`_maybeFlushNetDiag` in ffa‑p2p‑game‑state.js): `role rx/s boardsApplied genDrops lockSkips oppCells(Np) phase gen myLastSeq`. One line/sec — discriminates connectivity (rx/s≈0) vs decode vs apply (oppCells stays 0 / boardsApplied 0) vs render (counts healthy but screen wrong) vs round‑fence (genDrops high) in a single capture. ON by default; `?netDiag=0` to silence.
- **Runtime flag toggles via localStorage** (`readNetFlag`): the installed app loads file:// with no query string, so URL flags are unreachable there. Now `localStorage.setItem('serenity.lockEvents','0')` / `'serenity.readyBarrier','0'` / `'serenity.netDiag','0'` + reload toggles them in the DevTools console (URL still wins for dev). Lets the user A/B test whether the v9 lock‑events/ready‑barrier help or hurt without a rebuild.

**Next:** capture `📡 [NET]` + `🚦`/`⏮️`/`🔄`/`💀` from BOTH machines through a round‑restart; the NET line localizes the break, then fix the real cause.

## v9.2 — THE confirmed systemic root cause: delta‑baseline overtaking (2026‑06‑23)

The diagnostic build surfaced the real bug immediately. The host console flooded with:
```
Binary decoding failed: Error: Delta baseline mismatch: expected 28, have 36
Error: Delta baseline mismatch: expected 36, have 44   ← always "+8" (≈ keyframe interval in ticks)
… on essentially every packet
```

**Mechanism (verified in code):**
1. Deltas are encoded relative to `lastKeyframeSnapshot` and stamp its tick as `baselineTick` (`binary-encoding.js` delta header byte 12).
2. Keyframes are sent **reliable + immediate, BYPASSING the snapshot queue** (`steam-networking.js broadcastSnapshot`, `isKeyframe` branch on channel 0); deltas go through the **delayed/backpressured unreliable** queue (`_queueSnapshot`, channel 1).
3. Steam does not order across the reliable/unreliable channels, and the delta queue drains at ~30Hz so 7 deltas barely fit a 250ms keyframe interval — so the **next keyframe routinely overtakes the still‑queued deltas of the previous interval**.
4. The receiver adopts the new keyframe as its baseline, then the stragglers (older `baselineTick`) arrive → `decodeDeltaSnapshot` **threw** "baseline mismatch" → dropped + `_requestResync`. Systematically, every interval.

**Why it broke everything (peer‑worse):** almost no deltas decoded → opponent boards updated only at the 4Hz keyframe rate (looks frozen/glitched); garbage/stats lagged; and the constant decode‑fail path kept calling `_requestResync` on the **reliable channel 0 — the SAME channel `GAME_ROUND_RESTART/READY/START` and lock‑events use** — so round‑restart "did not work at all."

**Fix (root, `steam-networking.js handleP2PPacket` + `binary-encoding.js`):** added `BinaryDecoder.peekDeltaBaselineTick(buffer)` (reads header byte 12 without a full decode). The receiver now classifies each delta against its current baseline BEFORE decoding:
- `baselineTick === baseline.tick` → decode + apply (normal).
- `baselineTick < baseline.tick` → **superseded straggler** (a newer keyframe overtook it): drop **silently** — no error, no resync. We already hold newer state.
- `baselineTick > baseline.tick` → we genuinely missed its keyframe → resync once (rate‑limited).

This kills the flood + the resync storm + the corruption; in‑time deltas decode normally again (≈30Hz) and the reliable channel is freed for round‑restart/lock traffic. `packetStats.staleDeltasDropped` counts the silent drops.
*Test:* `binary-encoding-roundtrip.test.js` → "peekDeltaBaselineTick reports the baseline a delta was diffed against (and null for a full)".

**Also in v9.2:** ready‑barrier **default OFF** (`readNetFlag('readyBarrier', false)`) — it's new, sits on the failing round‑restart path, and can't be two‑machine tested here; the simpler instant‑restart path (+ gen‑fence + keyframe reset + this delta fix) is the safer baseline. Lock‑events stay ON. Re‑enable the barrier with `localStorage.setItem('serenity.readyBarrier','1')` once base gameplay is confirmed.

## v9.3 — round‑restart "topped out on spawn" (gameState object swap) (2026‑06‑23)

With the delta flood gone (v9.2), the next bug was visible: after a round restart the **host's own player tops out on spawn every round after the first** (`💀 olovjohnmelander topped out on spawn!` immediately after `🎮 Round started!`), and the peer's gameplay glitches. Evidence: round‑2 standings showed **+~600 score but 0 lines cleared** across ~15 pieces — the local pieces fell and stacked with **no input reaching them**, then topped out.

**Root cause:** `restartMatch` / `performRoundRestart` / `restartFullGame` **replaced** each player's gameState (`player.gameState = new GameState()`). That orphaned every reference still holding the OLD object: the unified‑loop player registration (`registerPlayer(steamId, player.gameState, …)`), the input **jitter buffer**, the BoardScene binding, and the render slots. On round 2+ the LOCAL player's input/gravity drove a **detached** board → 0 lines, topout. The proven INITIAL path (`initializePlayerForMatch`) never had this because it resets the board **in place** (`player.gameState.reset()`), preserving the reference.

**Fix:** all three restart paths now call `player.gameState.reset()` **in place** (then re‑apply preserved score/lines/level), and `restartMatch`/`restartFullGame` also **clear the input jitter buffer** (`clear()` + re‑`addPlayer`) — which was otherwise only reset at match start, so stale round‑1 ticks/inputs could drop or misorder round‑2 host input.
*Test:* `ffa-round-restart-reset.test.js` — pins that a restart keeps the SAME gameState object, clears the board, preserves stats, revives, bumps generation, and flushes the jitter buffer.

## Run the tests
```
npx vitest run tests/unit/ffa-round-fence-and-reconcile.test.js
npx vitest run tests/unit/ffa-demo-replay-determinism.test.js
npx vitest run tests/unit/ffa-host-authority.test.js tests/unit/ffa-p2p-game-state-input-hooks.test.js
```
