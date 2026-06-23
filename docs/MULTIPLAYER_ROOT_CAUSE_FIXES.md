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

## Run the tests
```
npx vitest run tests/unit/ffa-round-fence-and-reconcile.test.js
npx vitest run tests/unit/ffa-host-authority.test.js tests/unit/ffa-p2p-game-state-input-hooks.test.js
```
