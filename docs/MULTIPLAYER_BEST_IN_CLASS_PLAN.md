# Serenity Blocks — Online Multiplayer: Best‑in‑Class Improvement Plan

**Status:** working draft · **Date:** 2026‑06‑22
**Basis:** 26‑agent code audit (each root cause adversarially re‑verified) + web research on competitive‑Tetris netcode (TETR.IO, Jstris) and real‑time rendering (Gaffer On Games, Valve/Gambetta).
**Scope:** the host‑authoritative P2P (Steam) FFA mode — `src/core/multiplayer/`, `src/core/network/`, `src/core/steam/`, `src/ui/` multiplayer surfaces, `OnlineMultiplayerMode.js`.

> ⚠️ Several first‑pass audit claims were **refuted on re‑verification**. This plan is built on the *verified* conclusions, noted inline as **[verified]** / **[corrected]** so we don't fix the wrong thing.

---

## ✅ Implementation status (2026‑06‑23)

**Phases 0, 1, 2 are implemented, adversarially reviewed, and shipped** (439/440 tests pass; the 1 failure is an unrelated Odyssey terrain test). An adversarial code‑review pass over the diff found and fixed **2 real netcode bugs** my Phase 1 introduced — keep these in mind, they're load‑bearing:

- **Delta baseline = last keyframe (not previous broadcast).** With reliable keyframes + unreliable deltas on steamworks.js's single physical channel, chaining each delta off the previous one meant a single reordered delta invalidated the whole interval → resync churn. Deltas now diff against `lastKeyframeSnapshot`; the receiver only advances its baseline on a *full* decode and never deletes it on a bad delta.
- **Resync in‑flight guard + request cooldown.** `_sendResyncToPeer` now refuses to start a second full‑state transfer to a peer that already has one in flight; the receiver rate‑limits resync requests to ≤1 per keyframe interval. Prevents a burst of bad deltas from fanning out into concurrent chunked transfers.

Other shipped: elimination overlay auto‑clears on revival (strict `isAlive === true`); KPI `nowrap`/ellipsis + score cell `flex‑grow` + `toLocaleString`; chat peer→host relay + sender‑exclusion; Battle‑Log host‑local garbage echo + 12s TTL; reliable keyframes @250ms + fixed backpressure (20Hz floor); opponent two‑writer‑fight removed + 90ms interp delay.

**Remaining: Phase 3 (structural — fixed‑rate sim tick, jitter‑buffer, deterministic garbage), Phase 4 (robustness + HUD/UX), and the deferred Phase 2.4 (discrete‑event mini‑board animation).** These are higher‑risk or cosmetic and are best validated with live two‑machine play / visual review rather than shipped blind.

---

## 1. Where we are

Online MP now **works end‑to‑end**: lobby join (ID + invite), 2/2 roster with names, chat reaching both sides, live match with scoreboard. The hardest part — **the local player already has true client‑side prediction**, so your own piece has zero input lag **[verified]** (`ffa-p2p-game-state.js` `_applyLocalPrediction` + `_reconcileLocalPlayer`). That is already above many naive host‑authoritative ports.

The gaps that separate "works" from "best‑in‑class" are, in priority order:

1. **Opponent boards aren't smooth** — only the falling piece is interpolated; the stack/locks/line‑clears/garbage snap at 30 Hz, and two writers fight over the piece field.
2. **Boards intermittently freeze then teleport** — state sync rides an *unreliable* channel; a single dropped delta freezes the opponent board for ~1 RTT (up to ~1 s) until a reliable resync/keyframe lands.
3. **Elimination overlay sticks** — the `ELIMINATED` skull is created on an orphaned timer and never cleared on the next round.
4. **Scoreboard/KPI misalignment** — the in‑game KPI strip overflows (`36960`+`25` → `3696025`) and uses raw, unformatted numbers from two different code paths.
5. **Battle Log empty + chat fragile** — the host never sees its own combat events; several feed methods are dead code; peer in‑game chat + host relay have gaps.
6. **Architectural ceiling** — opponents are *streamed*, not *simulated*; the jitter buffer is a dead‑clock delay line; garbage isn't deterministic; there's no fixed‑rate sim tick.

---

## 2. Guiding architecture decision

Keep the **host‑authoritative** model and the **local‑prediction** that already feels good. The pragmatic best‑in‑class target for a host‑authoritative FFA stacker (per research) is:

> **Predict your own board · Interpolate opponents (render "in the past") · Reliable keyframes + unreliable deltas · Deterministic, frame‑ordered garbage · Discrete events animated as cosmetic‑only tweens.**

Explicitly **not** doing: pure delay‑based lockstep (couples everyone to the worst ping — the old Puyo Puyo Tetris "mud" feel) or full N‑way rollback (overkill; Tetris boards barely interact frame‑to‑frame — they interact only through *delayed* garbage, which we adjudicate on the host). The optional long‑horizon upgrade is TETR.IO‑style **input‑relay** (send keystrokes, re‑simulate opponents locally) — the ultimate smoothness, gated on full determinism.

---

## 3. Verified root causes (what to actually fix)

### A. Opponent‑board smoothness
- **[verified]** Only `currentPiece.x/y` is lerped; grid/locks/score/garbage are copied from the latest snapshot (`snapshot-interpolation.js` `_interpolate` lines ~185‑216). Grid is discrete — it can't be lerped; it needs **per‑event animation**, not interpolation.
- **[verified, corrected]** The opponent piece still snaps because **two writers fight**: `_processRenderFrame` writes the *interpolated* piece every RAF (~60 Hz), and `_handleStateUpdate` stomps the same field with the *raw* 30 Hz snapshot (`OnlineMultiplayerMode.js:1319‑1320`). ~Every 33 ms the smooth value is overwritten.
- **[verified]** Rotation is never interpolated (`piece.rotation = toPiece.rotation`); the "same piece" test bails on type change or ≥5‑cell jumps (so hard‑drops/spawns snap — mostly intended). Soft‑drop/DAS do **not** snap **[corrected]** (they move <5 cells/packet).
- **[verified]** `interpolationDelay = 50 ms` over a 33 ms interval leaves only ~17 ms jitter slack → fallback‑to‑latest under any jitter. No extrapolation/hold.
- **[verified]** Three unaligned loops drive draws (`renderAllPlayers` RENDER_FRAME, `_handleRenderFrame` RAF, `OpponentWatchManager._animate` RAF).

### B. Reliable sync ("stops syncing")
- **[corrected]** Boards do **not** silently, permanently diverge. Each binary delta carries the host `baselineTick`; the decoder **throws on mismatch** (`binary-encoding.js:653‑655`) and triggers a reliable, CRC‑verified chunked resync. So the real failure is **freeze‑then‑snap**: state sync is sent **unreliable** (`steam-networking.js` `_queueSnapshot`, `unreliable_no_delay`), a dropped delta drops the frame and waits up to ~1 s for the next keyframe/resync, then teleports. Repeats under sustained loss.
- **[verified]** Backpressure pins peers at **10 Hz** and (almost) never recovers: the restore needs 30 *consecutive* successes that reset on any drop and isn't incremented on the deferred‑send path; the `dropRate` expression is a no‑op that collapses to a constant 0.5 (fires the throttle on essentially any drop). **Asymmetric ratchet: fast down, near‑impossible up.**
- **[verified]** The inline comment "Since we use reliable delivery…" is false; the seq validator only rejects reorders/dups, it does **not** detect gaps. Auto‑resync via digest is effectively disabled (`_desyncCheckEnabled` has no caller) **and** the digest excludes the board grid.

### C. Elimination / round lifecycle
- **[verified]** `_showDeathAnimation` schedules the overlay on an **untracked** `setTimeout(…, 500)`; `_clearDeathState` only removes an overlay that already exists. On a round‑ending death the chain `recordDeath → checkMatchEnd → endMatch → restartMatch → emit ROUND_RESTART → _clearDeathState` runs **synchronously before** `PLAYER_TOPPED_OUT` even fires — so the clear runs first (clears nothing), then the overlay is born 500 ms later and **leaks into the next round**.
- **[verified]** No clear at *actual* round start (`restartMatch` `instantStart` calls `startRound()` without emitting `MATCH_STARTED`/any round‑start event).
- **[verified]** Local death animation is triggered **twice** (PLAYER_TOPPED_OUT handler *and* `_handlePlayerDeath`).

### D. Scoreboard / KPIs
- **[verified]** KPI overflow: `.player-stats-bar .stat-value` has no `white-space/overflow/text-overflow`; `min-width:0` forces narrow equal cells; a 20 px Orbitron 5‑digit score overflows and abuts the next centered value → `3696025`. Bar width is hard‑capped (`--board-width` ≤ 280 px) across 5 columns.
- **[verified]** Raw integers, no `toLocaleString` (unlike the dead legacy bar). `deaths` is hard‑coded `0` (never in the snapshot). Two feed paths use two object shapes (peer top‑level vs host nested).
- **[corrected]** Hidden labels are **not** why numbers merge (each stat is a separate icon card) — it's an affordance issue only.

### E. Battle Log / chat
- **[verified, corrected]** Battle Log misses **all garbage‑sent events on the host**: garbage is authored host‑side via `broadcastToAll`, which never loops back to the host's own `.on()` handlers, and there's **no local echo** (chat has one — that's why chat "works"). **Death/frag entries do show** on the host via the local `PLAYER_TOPPED_OUT` event, so "most topouts missing" was **refuted** — only the `updateAllPlayers`/`recordPlayerDeath` paths (no `PLAYER_TOPPED_OUT`) are host‑invisible.
- **[verified]** `addCombo` / `addSystemEvent` / `addGarbageCancelled` are **dead code** (no callers).
- **[verified]** Chat: host rebroadcast doesn't exclude the original sender (dup risk); peer in‑game chat uses `broadcastToAll`, which hard‑guards non‑hosts ("Only host can broadcast") — so peer→all only works in mock, not real Steam. No message‑id dedup.

### F. Netcode architecture
- **[verified]** Opponents are **fully replicated** (streamed full grids), not simulated.
- **[verified]** The input **jitter buffer is a dead‑clock delay line**: a peer's `hostTick` never advances, so inputs are re‑stamped with the buffer's own tick — adds a fixed delay **without** de‑jittering, and the adaptive depth is inert.
- **[verified]** Garbage is **non‑deterministic** (host‑computed; the receiver only *predicts* with an approximate `holeMask` before the authoritative grid overwrites). No seed/frame‑keyed garbage RNG. Desync digest ignores the board.
- **[verified]** No fixed‑rate sim tick — physics runs on variable RAF delta while the jitter buffer assumes a fixed 30 Hz.

---

## 4. Phased roadmap

Ordered **quick wins → smoothness → structural**, so the visible bugs die fast and risk rises only as reward does. Effort: **S** ≈ hours, **M** ≈ 1–2 days, **L** ≈ multi‑day refactor.

### Phase 0 — Visible‑bug quick wins (S, high impact)
Ship these first; they're the things you see in the screenshot.

0.1 **Elimination overlay reset** — store the 500 ms handle (`this._deathOverlayTimer`) and `clearTimeout` it in `_clearDeathState`; emit a dedicated `ROUND_STARTED` from `restartMatch.startRound()` and clear there too; drive the overlay from authoritative `isAlive` in the snapshot; remove the duplicate `_showDeathAnimation` call. *(Files: `OnlineMultiplayerMode.js` 1687/1785/1223‑1233, `ffa-p2p-game-state.js` restart path.)*
0.2 **KPI strip formatting** — add `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` + a real `min-width` to `.player-stats-bar .stat-value/.stat-item`; shrink font or go 4‑column. *(`public/styles/main.css` ~19730/19758.)*
0.3 **One shared number formatter** — `formatStat(kind, n)` (`toLocaleString` for score, raw for frags/lines) used by the KPI strip, `online-scoreboard.js`, and the overlay; feed both surfaces from **one** normalized player object; make `deaths` real (add to snapshot) or drop the column.
0.4 **Battle Log wiring** — emit a **local in‑process event** for every combat action on the authoring node (mirror chat's echo): `recordDeath` and `routeAttack` emit `KILL` / `GARBAGE_SENT`; subscribe `killFeed.addKill/addGarbageSent` to those; emit `PLAYER_TOPPED_OUT` on **all** death paths; wire the dead `addCombo`/`addSystemEvent`/`addGarbageCancelled`; add a dedupe key so the local event + network message don't double‑render.
0.5 **Chat hardening** — peer→host→all relay (peer `sendP2PMessage(hostSteamId,'game:chat')`), exclude the original sender on host rebroadcast, add per‑message ids + dedupe.

**Acceptance:** ELIMINATED clears within one round; KPI numbers never touch and read `36,960`; Battle Log shows KOs *and* garbage on host and peer; chat is single‑copy both ways in real Steam.

### Phase 1 — Sync that never freezes (M, high impact)
1.1 **Reliable keyframes, unreliable deltas** — route full/keyframe + discrete‑event snapshots over the **reliable** channel; keep intermediate deltas unreliable. Delete the false "reliable delivery" comment.
1.2 **Tighter, event‑driven keyframes** — drop `fullSnapshotIntervalMs` 1000 → ~250 ms; force a keyframe immediately after line‑clear / garbage‑insert / top‑out.
1.3 **Baseline‑id correctness** — encode deltas against the peer's **last‑acked** baseline (or carry a baseline id and have the peer request a keyframe the instant it mismatches, instead of dropping the frame and waiting).
1.4 **Fix backpressure** — replace the no‑op `dropRate`, make restore time‑based, floor active opponents at ~20 Hz, count the deferred‑send path.
1.5 **Always‑on, rate‑limited resync** — enable desync detection by default; include a cheap board hash (per‑column heights) in the digest; cap resync to ≤1/s/peer.

**Acceptance:** with 5–10 % simulated packet loss, opponent boards keep moving (no >250 ms freeze, no teleport); peers never pin at 10 Hz.

### Phase 2 — Buttery opponent boards (M–L, high impact)
2.1 **One render clock, one buffer** — `OpponentWatchManager._animate` becomes the sole opponent render tick reading the `SnapshotInterpolator`; the network path only `addSnapshot` (+ metadata: alive/dead/garbage/next). Remove the raw visual `updateFromState` write at 1319‑1320. Delete the dead legacy render paths.
2.2 **Interpolate rotation + exact piece identity** — add a per‑piece **spawn id** to the snapshot; lerp rotation shortest‑arc; only snap on confirmed spawn/hard‑drop.
2.3 **Wider, adaptive render delay** — raise `interpolationDelay` to ~80–100 ms, driven by the jitter stats the input buffer already computes; bounded hold/extrapolate (≤1 packet), prefer **hold‑last** over overshoot for a grid.
2.4 **Animate discrete transitions** — diff successive snapshots (or host event flags) and play **cosmetic‑only** tweens: garbage‑row rise, line‑clear flash+collapse, lock settle (`board-juice.js` / `multiplayer-effects-manager.js`), gated by the existing reduced‑motion / `backgroundComboEffects` accessibility setting.

**Acceptance:** opponent piece glides at display rate; rotations ease; garbage/line‑clears flash‑and‑collapse instead of popping; no piece "snap every 33 ms."

### Phase 3 — Competitive‑grade structure (L, high impact, higher risk)
Do these behind the playground/test harness with deterministic replay tests.
3.1 **Fixed‑rate authoritative sim tick** (60 Hz accumulator) decoupled from RAF — unblocks correct latency math, fair input scheduling, and future rollback.
3.2 **Fix or remove the jitter buffer** — stamp inputs with a real shared clock (`hostTick = lastSnapshotTick + ⌈Δt/tickInterval⌉`) so it de‑jitters; if out of scope, **remove it** (today it only adds latency).
3.3 **Deterministic, frame‑ordered garbage** — derive hole columns from `(sharedSeed, attackerFrame, seq)`; order/cancel attacks by **sender frame** (lag‑comp‑style), not arrival; add a garbage **queue + windup** window (also hides latency and makes FFA cancels fair).
3.4 **Input ack/retry window** — keep unacked inputs until the host acks their seq; resend on next flush (closes the "clear queue (assuming reliability)" TODO).

**Acceptance:** identical garbage shape on attacker/host/victim; no rubber‑band under loss; deterministic replay test passes.

### Phase 4 — Robustness & UX polish
4.1 **Ordered message ids + short resume cache** (Ribbon‑style): incrementing ids, process in order, treat large gaps as desync→keyframe; cache ~20–30 s of gameplay events so a blip resumes instead of dropping.
4.2 **Reconnect / host‑migration mid‑match** polish (snapshot on promote already exists).
4.3 **HUD/UX:** per‑board **incoming‑garbage threat meter**, FFA sort/highlight leader + nearest rival, kill‑feed motion budget (~200‑300 ms in, ~3‑4 s hold, coalesce bursts), all reduced‑motion aware.

---

## 5. Effort / impact summary

| Phase | Theme | Effort | Impact | Risk |
|---|---|---|---|---|
| 0 | Visible‑bug quick wins (overlay, KPI, battle log, chat) | S | High | Low |
| 1 | Sync that never freezes (reliable keyframes, backpressure) | M | High | Med (hot path) |
| 2 | Buttery opponent boards (one clock, rotation, discrete‑event tweens) | M–L | High | Low–Med |
| 3 | Competitive structure (fixed tick, jitter buffer, deterministic garbage) | L | High | High |
| 4 | Robustness & UX polish | M | Med | Low |

**Recommended order:** 0 → 1 → 2, then evaluate appetite for 3. Phases 0–2 alone get you a smooth, reliable, correct‑feeling FFA; Phase 3 is what makes it *tournament‑grade*.

---

## 6. Guardrails
- Every phase ships behind the **playground/loss‑injection harness** + the existing snapshot/binary‑encoding unit tests; add a packet‑loss test for Phase 1 and a deterministic‑replay test for Phase 3.
- Keep **host authority** intact; opponent interpolation is render‑only and can never change outcomes.
- Respect the project's **reduced‑motion / `backgroundComboEffects`** accessibility gating for all new juice.
- This is the **steamworks.js 0.4.0** transport (single P2P channel, channel‑less API) — "reliable vs unreliable" is the SendType arg (`Reliable=2` vs `UnreliableNoDelay=1`), not separate channels.

## 7. Sources (research)
TETR.IO Ribbon/observing docs; Gaffer On Games (snapshot interpolation, fix‑your‑timestep, state sync, delta compression); Valve Source multiplayer networking / interpolation / prediction / lag compensation; Gambetta client‑server architecture series; GGPO/rollback explainers; tetris.wiki garbage/lock‑delay; geckos.io snapshot‑interpolation. (Full URL list in the audit transcript.)
