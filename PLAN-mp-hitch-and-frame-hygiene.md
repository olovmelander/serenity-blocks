# PLAN-mp-hitch-and-frame-hygiene — remove MP-only hitch classes and per-frame waste

**Rank: 2 of 5. Do after PLAN-mp-host-input-latency (they touch the same files; that plan's
line-ceiling guardrail applies here too).**
Source of truth: `docs/ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18.md` §2.4–2.9 and P0 items
4–8. Read those sections in full first.

## Goal

Five independent, verified defects produce MP-only hitches and frame-time jitter:

1. **(P0-4)** During a cascade (`isProcessingPhysics`, real wall-clock 100–300 ms per
   clear), the host silently discards peer hard-drops while still ACKing their sequence
   numbers. With `peerLocalSim` on (default), the peer applied the drop locally → silent
   divergence → the desync backstop later fires a full-board resync with a beat of frozen
   input. Fix: queue drops instead of discarding them.
2. **(P0-5)** `hasSignificantStateChanges()` goes false for the whole cascade (all its
   fields are static mid-cascade) → snapshots pause → opponents freeze then teleport on
   every multi-line clear. Fix: treat an in-progress cascade as "changed".
3. **(P0-6)** Receive path polls one packet per `ipcRenderer.invoke` round-trip inside a
   16 ms `setInterval`; send path does one invoke per peer; base64 encode builds the string
   one char per byte. Fix: batch reads into one invoke, chunk the base64 conversion, batch
   the per-peer send.
4. **(P0-7)** `opponent-watch-manager` runs its own always-on rAF, forces layout via
   `getBoundingClientRect()` per repaint, and writes DOM unconditionally every frame. Fix:
   cache the rect, change-guard writes, drive from the mode's render frame.
5. **(P0-8)** `hydrateBinarySnapshot` `structuredClone`s the entire reconstructed world on
   every receive (~1 MB/s allocation churn on peers → GC pauses). Fix: clone only the
   retained delta baseline.

## Files to touch

| File | What changes |
|---|---|
| `src/core/multiplayer/ffa-p2p-game-state.js` | Drop-queueing in the `isProcessingPhysics` branch (~line 1437); cascade signal in `hasSignificantStateChanges` (~line 2282). **Line ceiling 4690 — file is at 4689; extract to helpers, never grow it** |
| `src/core/multiplayer/ffa/board-helpers.js` or a new `src/core/multiplayer/ffa/input-queue.js` | Home for queue logic if it exceeds a few lines |
| `src/core/steam/steam-networking.js` | Chunked `_arrayBufferToBase64` (~line 794); batched send fan-out (~lines 477–522, 764–788); batched receive poll (~lines 832–842) |
| `electron/` (find with `grep -rn "readP2PPacket" electron/`) | New `steam:readP2PPackets` (plural) IPC handler returning an array; keep the singular handler for compatibility |
| `src/ui/opponent-watch-manager.js` | Rect cache, change-guarded DOM writes, external-drive mode (own rAF ~116–117, rect ~1877) |
| `src/core/game-modes/OnlineMultiplayerMode.js` | Call OWM's update from `_processRenderFrame` |
| `src/core/network/snapshot-contract.js` | Remove the full-world clone (line 20), clone only the retained baseline |
| `tests/unit/` | One pinning test per fix (see per-step notes) |
| `docs/ARCHITECTURAL_REMEDIATION_PLAN.md` | Extend the same harvest note from plan 1 with "P0 items 4–8" |

## Guardrails

- Same gate set as plan 1: `npm test`, `npm run typecheck`, `npm run lint:ci`,
  `npm run check:boundaries`, `node scripts/architecture-fitness-check.mjs` after every
  commit.
- Land as **five separate commits** in the order below (ascending risk).
- Mock/BroadcastChannel transport (`SteamConfig.mockMode`) must keep working — it is the
  test substrate. Feature-detect the new plural IPC channel and fall back to the singular
  one.
- Don't touch the dark `wireV2` / `fixedTick` / `adaptiveInterp` paths; no flag graduations
  here.

## Steps

### Step 1 — Keep snapshots flowing mid-cascade (P0-5, smallest)
In `hasSignificantStateChanges()` (~2282), the compared fields are all static during a
cascade. Add a signal that is truthy while any player's cascade is progressing: the
simplest correct one is "any alive player's `gameState.isProcessingPhysics === true`", OR a
monotonically increasing cascade-progress counter if one exists (search for a wave counter
in `physics.js` first; if none, `isProcessingPhysics` is acceptable — it makes the 30 Hz
accumulator broadcast for the cascade's duration, which is exactly the point).

**Edge cases:** (a) must not force broadcasts when the game is idle — gate the new signal on
`isProcessingPhysics` actually true, never on its mere presence; (b) the 30 Hz accumulator
(`maybeBroadcastPostPhysics`, ~2316–2333) still rate-limits — do not bypass it.
**Test:** state where the only "change" is a player mid-cascade →
`hasSignificantStateChanges()` returns true; fully idle state → false.

### Step 2 — Defer, don't discard, drops during physics (P0-4)
1. Find the `isProcessingPhysics || !currentPiece` branch (~1437). Today only
   `move`/`rotate` are queued (cap 4); `drop`/`hardDrop` inputs fall through to
   `return false` — while the caller at ~1610/3495 ACKs the sequence anyway.
2. Extend the queue to accept hard drops: queue `{ type: 'hardDrop' }` (match the exact
   `inputType` string used in the switch below the branch — read it, don't guess). At
   spawn, the queue is consumed (`spawnPiece` consumes `inputQueue` — verify by grepping
   `inputQueue` consumers) so a queued drop applies to the newly spawned piece — which is
   the semantics a fast player expects.
3. **Dedupe:** at most ONE queued hard drop; a second hard-drop input arriving while one is
   queued is dropped (two hard drops on one future piece is never intended).
4. Raise the queue cap from 4 to 8 **for remote players only** (peer input bursts arrive
   time-compressed after transport jitter; local players physically can't exceed 4 in
   300 ms). The branch knows `steamId` — use it.
5. Do NOT queue soft-drop state toggles — continuous soft-drop during a cascade is
   meaningless and replaying it at spawn causes an unexpected fast piece.

**Edge cases:** the dark fixed-tick path models this properly as
`INPUT_DISPOSITIONS.DEFERRED_PHYSICS` (`ffa-fixed-input-adapter.js:153-199`) — mirror its
*semantics*, do not import or call it from the legacy path. Keep ACK behavior unchanged
(the peer must not retry; the input is now genuinely consumed-later, so the ACK becomes
honest).
**Test:** host processing a remote `hardDrop` while `isProcessingPhysics` → not applied
immediately, applied exactly once after the physics window ends and a piece spawns; score
digest matches a control run where the drop arrived after the cascade. Existing
`ffa-host-authority` and resync tests stay green.

### Step 3 — Stop cloning the world per snapshot (P0-8)
In `snapshot-contract.js:20`, `hydrateBinarySnapshot` clones the entire reconstructed
snapshot. The clone exists to protect the retained delta baseline from consumer mutation.
Invert it: keep/`structuredClone` ONLY the part stored as the delta baseline (find where
the baseline is retained — grep for who stores the hydrated result for later delta
application) and return the reconstructed object directly to consumers.

**Edge cases a weaker model would miss:**
- The reconstructed object and the retained baseline must NOT alias: if the baseline stores
  the same object graph you hand to consumers, a consumer mutation corrupts the next delta
  apply — this is the entire reason the clone exists. Clone at the *retention* site, not
  the hydration site.
- The second `structuredClone` at line ~35 (`hotPotatoState`) is small — leave it.
- Consumers may currently rely on receiving a mutable copy. Grep every caller of
  `hydrateBinarySnapshot` and check none of them write into the returned object (the review
  notes each snapshot is consumed twice: FFA apply + OnlineMultiplayerMode
  normalize/interpolate/HUD). If one mutates, fix that caller to copy the field it mutates,
  not the world.
**Test:** apply delta A then delta B over a baseline; mutate the object returned for A
between the applies; B's result must be unaffected (baseline isolation). Round-trip suite
(`binary-encoding-roundtrip.test.js` and friends) stays green.

### Step 4 — IPC batching + chunked base64 (P0-6)
1. **Chunked base64** (`_arrayBufferToBase64`, ~794): replace the per-byte
   string-concatenation loop with chunked conversion:
   `String.fromCharCode.apply(null, chunk)` over `Uint8Array` chunks of ≤ 0x8000, then one
   `btoa` at the end. Behavior-identical output; add a unit test comparing old vs new output
   for a few sizes (0, 1, 0x8000-1, 0x8000, 100k bytes).
2. **Batched receive:** in `electron/` (find the file registering `steam:readP2PPacket`),
   add `steam:readP2PPackets` that drains up to N (e.g. 32) packets in one call and returns
   an array (empty array when none). In `steam-networking.js`'s poll loop (~832–842),
   feature-detect: try the plural channel once at startup; if it throws/undefined, keep the
   legacy serial loop. Order must be preserved (drain loop in main process, single array
   back).
3. **Batched send:** where snapshots fan out one `invoke('steam:sendP2PPacket')` per peer
   (~764–788 and the callers at ~477–522), add a `steam:sendP2PPackets` handler taking
   `[{steamId, data}, …]` and use it for the fan-out path. Keep the singular path for
   one-off sends.

**Edge cases:** (a) mock/BroadcastChannel mode doesn't go through IPC — make sure the mock
transport branch is untouched; (b) the impairment harness (`planDelivery`) wraps sends —
batch AFTER impairment planning so per-peer delay/drop plans still apply per packet;
(c) main-process handler must cap the drain (a flood must not starve the event loop);
(d) `ipcRenderer.invoke` result for the plural channel on an OLD main process is
`undefined` — the feature-detect must handle that, not just exceptions.
**Test:** unit-test the base64 equivalence; for the IPC shape, a thin test asserting the
renderer falls back cleanly when the plural channel is absent (mock `ipcRenderer`).

### Step 5 — Opponent-watch-manager frame hygiene (P0-7, largest)
Work in `src/ui/opponent-watch-manager.js`:
1. **Rect cache:** replace per-repaint `getBoundingClientRect()` (~1877) with a cached rect,
   recomputed on (a) the existing resize/viewport event the app already broadcasts (grep
   `resize` listeners in the file — it likely has one) and (b) whenever the watched-set
   changes. The comments at ~902/936 record that rect feedback caused blowups before —
   read them first.
2. **Change-guarded DOM writes:** every per-frame `textContent`/inline-style/`innerHTML`
   write gets a last-written-value guard (write only when the value actually changed).
   The garbage-meter `innerHTML` is the worst offender — guard it on its composed string.
3. **External drive:** add a public `renderTick(nowMs)` method containing the body of the
   current rAF callback. `OnlineMultiplayerMode._processRenderFrame` calls it once per
   processed frame. The internal rAF loop (~116–117, 680–687) stays as a fallback but is
   **suspended while externally driven**: add `setExternalDriver(true/false)`; the mode
   calls it on activate/deactivate.
4. **Fractional-piece dirty signature:** the interpolated opponent piece changes sub-cell
   position every frame, defeating the dirty check and forcing full-board connected-
   component repaints. Quantize the signature for the *grid* layer (piece cell-position,
   rotation, board version) and repaint the smooth fractional position only on a
   lightweight piece overlay. If the overlay split proves too invasive, quantizing the
   signature alone (grid repaints only on cell change) is an acceptable first landing —
   note it in the commit message.

**Edge cases:** (a) OWM is also alive in spectator flows and when the mode isn't rendering
(menus) — that's why the fallback rAF must remain; (b) peers ALSO update OWM DOM from the
30 Hz snapshot handler — after this change the render tick must be the only DOM writer,
with the snapshot handler only updating data (grep for the second write path the review
mentions); (c) `deactivate`/`destroy` must clear the external-driver flag and re-arm or
stop the internal loop consistently (no leaked rAF after mode exit).
**Test:** with a stubbed DOM, two consecutive `renderTick` calls with identical
interpolated state perform zero DOM writes on the second call; rect is read once until the
resize event fires.

## Acceptance criteria

1. All gates green after each of the five commits (`npm test`, `typecheck`, `lint:ci`,
   `check:boundaries`, `architecture-fitness-check`); `lines:ffa-p2p-game-state` ceiling
   not raised.
2. New pinning tests exist and pass for: cascade-snapshot signal, deferred drop, baseline
   isolation without world clone, base64 equivalence, OWM idle-frame zero-writes.
3. Behavior proof points (cite tests or greps in the PR/commit messages):
   - A remote hard-drop during `isProcessingPhysics` is applied after spawn, never
     silently discarded while ACKed.
   - `hydrateBinarySnapshot` no longer clones the full world per receive.
   - The receive poll performs one IPC invoke per interval when the plural channel exists.
4. Mock-mode (BroadcastChannel) 2-player session still connects, plays, and resyncs
   (existing integration-ish tests stay green).
5. Manual smoke if available (state skipped if not): 2-player mock match with multi-line
   cascades — opponent board no longer freezes-then-teleports on clears; no board-snap +
   input-freeze after hard-dropping through a clear.
