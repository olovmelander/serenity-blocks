# Deterministic Simulation + Netcode Best Practices — Research Report

**For:** Serenity Blocks architecture plan (Tetris-like, JavaScript/Electron, Steam P2P FFA multiplayer)
**Date:** 2026-07-03 (v2 — re-verified against primary sources; added GGPO Developer Guide, Factorio FFF-188/FFF-340, TETR.IO live wire-format docs, Riot implementation detail)
**Game context assumed throughout:** 10x20 board (plus a cascade-gravity mode with 1000-row "infinity" boards), host-authoritative today with 30 Hz state snapshots over Steam P2P (`src/core/steam/steam-networking.js`, `src/core/network/snapshot-interpolation.js` — 33 ms interval, ~50–60 ms interpolation delay), shared-seed integer LCG piece RNG (`src/core/multiplayer/ffa-p2p-game-state.js`), an existing accumulator-based `frame-rate-controller.js`, but gravity/physics still reading real time (`performance.now()` in `src/core/physics.js`). Ambitions: fixed tick, replays, desync detection, eventual rollback/reconciliation.

---

## 1. Fixed-timestep game loops (and the browser/rAF variant)

### The practice
Glenn Fiedler's canonical ["Fix Your Timestep!"](https://gafferongames.com/post/fix_your_timestep/) pattern: decouple simulation from rendering with an **accumulator**. Each render frame, add real elapsed time to `accumulator`; run the simulation in fixed `dt` steps `while (accumulator >= dt)`; leftover time carries to the next frame. Two safety valves: **clamp frame time** (`if (frameTime > 0.25) frameTime = 0.25`) to prevent the *spiral of death* (sim can't keep up with the steps it owes, falls further behind each frame), and **render interpolation** between `previousState` and `currentState` with `alpha = accumulator / dt` to hide the remainder without stutter. Fiedler explicitly frames this as the prerequisite for determinism: "exact reproducibility from one run to the next given the same inputs."

The JavaScript/rAF-specific treatment is Isaac Sukin's [A Detailed Explanation of JavaScript Game Loops and Timing](https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing):
- Use the `requestAnimationFrame` **timestamp parameter** (not `Date.now()`) as the clock.
- **Background tabs stop rAF entirely** — on return you have seconds/minutes of "owed" time. Clamp the delta and/or reset timing state on resume; never simulate the pause.
- **Panic valve**: cap the update loop (his example: 240 steps) and either discard leftover time (`delta = 0`) or, in a networked game, snap to authoritative server state — which maps exactly to a host snapshot re-adopt.
- Call `draw()` after all updates; pass `delta / timestep` as the interpolation ratio; reset time variables after pause; run a dummy first frame to establish a baseline.

### Why it matters
Variable-`dt` simulation is framerate-dependent: float rounding depends on operand values, so the same match produces different results at 60 Hz vs 144 Hz vs under load. That kills replays, desync detection, and any input-only networking. A fixed tick gives every peer (and every replay playback) an identical discrete timeline to agree on: "tick N" is a well-defined state everywhere.

### Concrete application to this game
- **Pick a canonical sim tick of 60 Hz** (16.667 ms), independent of the 30 Hz network snapshot rate and of render rate. Tetris guideline timing (DAS/ARR/lock delay/ARE) is natively specified in 60 Hz frames (see §4), so a 60 Hz tick makes every timing constant an integer. TETR.IO's engine is 60 fps with 10 subframes for input resolution (§3) — the same shape.
- `src/core/frame-rate-controller.js` already has an accumulator and a setTimeout-driven logic loop separate from the rAF render loop — that skeleton is right. The gap is that **the sim itself still consumes wall time**: `src/core/physics.js` uses `performance.now()`/rAF timing for gravity. Migration = every timer in the sim (gravity counter, DAS charge, lock delay, ARE, garbage-arrival delay, cascade step delay) becomes an **integer tick counter**, and the loop's only job is deciding how many ticks to run.
- **Electron nuance:** rAF throttles/stops in hidden or occluded windows. Since online matches must keep simulating when the window loses focus, drive the *sim* from the setTimeout/setInterval path (as `frame-rate-controller.js` already does) and treat rAF purely as the render trigger; still clamp deltas after OS sleep.
- **Cascade mode / 1000-row infinity boards:** resolve cascades as deterministic tick-quantized phases (clear → settle-step → re-scan), i.e., cascade timing itself is measured in ticks, not ms. This makes the most state-explosive mode replayable, and it bounds per-tick work: one settle iteration per tick (or per K ticks) rather than an unbounded while-loop inside one tick.
- **Render interpolation:** local player's active piece can render interpolated between previous/current tick states with `alpha`; this is the same math the codebase already applies to remote boards via `snapshot-interpolation.js`.

### Pitfalls
- **Spiral of death in cascade mode**: a giant cascade on a 1000-row board must not make one tick cost more than a tick's worth of real time. Amortize settle work across ticks; keep the 0.25 s frame-time clamp + a max-steps panic.
- **Leaking `dt` into the sim**: any `x += speed * dt` with float `dt` reintroduces nondeterminism even at "fixed" tick if the tick length is ever adjusted. Sim math should be per-tick integer/fixed increments.
- **Interpolation reading live state**: keep an immutable previous-state copy for rendering; don't let render-side code mutate sim objects (already a risk given themes reach into game state for effects).
- **Timer source mixing**: one clock for the sim (tick counter), full stop. Riot found **six different clock/timing APIs** in the LoL server when they retrofitted determinism (§8) — `performance.now()` in `physics.js` is exactly this class of leak.

Sources: [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) · [JS game loops & timing (Isaac Sukin)](https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing) · [Fixed timestep without interpolation (Jakub Tomšů)](https://jakubtomsu.github.io/posts/fixed_timestep_without_interpolation/)

---

## 2. Deterministic lockstep & rollback netcode

### The practice
**Deterministic lockstep** ([Gaffer on Games — Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/)): send only inputs; every peer simulates identically. Requirements and mechanics:
- Determinism must hold "exactly down to the bit-level. So exact, you could take a checksum of your entire physics state at the end of each frame and it would be identical."
- A **playout delay buffer** (~100 ms) de-jitters incoming inputs so the sim consumes them at even tick spacing.
- **Don't use TCP**; over UDP, redundantly resend all un-acked inputs every packet (inputs are tiny — his example maxes ~90 bytes/packet). Bandwidth is proportional to input size, not world size.
- Latency scales poorly with player count — best for 2–4 players (Serenity's FFA lobbies sit right at this boundary; host-relayed garbage arbitration relaxes it).

**Rollback** (GGPO, [Wikipedia/GGPO](https://en.wikipedia.org/wiki/GGPO), [SnapNet — Netcode Architectures Part 2: Rollback](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/)): advance the local sim immediately using *predicted* remote inputs; when real inputs arrive and differ, restore an earlier saved state and re-simulate. Tony Cannon (GGPO author, MIT-licensed since 2019 — [EventHubs](https://www.eventhubs.com/news/2019/oct/09/good-news-everyone-ggpo-rollback-netcode-now-free-use-game-developers-without-licensing-fees/)): "the biggest technical obstacle for existing engines is probably separating simulation from rendering and fast serialization of game state."

**INVERSUS** ([Ryan Juckett — Rollback Networking in INVERSUS](http://blog.hypersect.com/rollback-networking-in-inversus/)) is the best implementation write-up; concrete numbers:
- 60 Hz sim; rollback window **20 frames** → playable at 300+ ms one-way latency.
- All gamestate in one contiguous 1 MB buffer; save/restore = memcpy. Particles live *inside* gamestate to avoid divergence headaches; UI/menus live outside and may never hold gamestate pointers.
- Prediction = repeat last known remote input (fine for held-key games — and Tetris is a held-key game).
- Input packets are delta-compressed and **redundantly carry every un-acked frame's input**.
- **Frame advantage**: peers measure how many frames each is predicting; the one seeing "younger" data stalls occasionally (spread over ~10+ frames so it's imperceptible) to keep the playing field fair.
- **Adaptive input delay** 0–4 frames applied as connections degrade (thresholds at 2/3/6/8 frames of measured peer lag, evaluated every 100 frames) — trades input latency for fewer/shallower rollbacks.
- Desync backstop: peers exchange player positions every **500 frames**, compared only on frames no longer subject to predicted input ("confirmed frames").
- Documented hard limitation: **pure rollback cannot support mid-match join** (needs full input history).

**GGRS** (Rust GGPO reimplementation, [docs.rs/ggrs](https://docs.rs/ggrs/latest/ggrs/)) contributes two reusable ideas: `SyncTestSession` (simulate a rollback **every frame** and re-simulate `check_distance` frames, comparing checksums — a determinism fuzzer you run in CI) and built-in desync detection (peers exchange per-frame checksums — default fletcher16 — at a configured interval; a mismatch fires `DesyncDetected`).

**RTS lineage:** [1500 Archers on a 28.8](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond) (Bettner & Terrano; [mirror summary](https://samu.space/Age-of-Empires-and-networking/)) — 200 ms *communication turns*, commands scheduled 2 turns ahead, turn length adapted to latency and the slowest machine, seeded synchronized RNG ("programmers were not used to writing code that used the same number of calls to random within the simulation"), periodic checksums that abort on mismatch, and replays falling out for free. Forrest Smith's [Synchronous RTS Engines and a Tale of Desyncs](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/) (Supreme Commander): sim fixed at 10 Hz with a 60 Hz variable-rate render layer on top; **full game-state hash compared once per second**; on mismatch the game aborts — there is no reconciliation ([part 2](https://www.forrestthewoods.com/blog/synchronous_rts_engines_2_sync_harder/): "for a two-user game it's impossible to know which user has the correct state" — but Serenity *does* have a host, so it can recover where SupCom couldn't).

### Why it matters
Input-only sync is the cheapest possible bandwidth model and the only model that gives perfect-fidelity opponent boards, replays, and spectating from the same mechanism. Rollback removes lockstep's input latency. But every one of these gains rents the same house: bit-exact determinism.

### Concrete application to this game
- **Key structural insight: Tetris boards don't physically interact.** Unlike fighting games, the only cross-player coupling is garbage attacks and win/lose events. So Serenity does **not** need full GGPO-style predict-and-rollback of a shared world. The right target architecture (and what TETR.IO-class stackers do, §3) is: each player's board is a **closed deterministic sim of (seed + own input stream + timestamped external events)**, where external events (incoming garbage, round start/stop) are stamped onto a tick by the host. Remote boards are then *re-simulated from input streams* instead of adopted from 30 Hz snapshots — perfectly smooth at any latency, with zero prediction error for the local player (your own board never waits on the network).
- **Rollback scope shrinks to garbage timing**: the only thing the local sim ever learns late is "garbage lands on your tick T." Options in increasing complexity: (a) host stamps garbage ≥2 comm-turns ahead (AoE-style scheduling — garbage is already queued/telegraphed in modern stackers, so a 100–250 ms activation delay is *invisible*); (b) small rollback window (~8–20 ticks, INVERSUS-style memcpy of the compact board state) only for late garbage-arrival reconciliation. Start with (a); it may be all you ever need.
- **Keep the host authoritative** for arbitration (garbage routing/cancellation, kill attribution, round control — all already in `ffa-p2p-game-state.js`) and as the desync tiebreaker. This is a hybrid: deterministic per-board sims + host-arbitrated event ordering + snapshots retained as the *recovery and late-join* channel, not the steady-state channel. The comment block in `ffa-p2p-game-state.js` already sketches exactly this ("the local player supplies ONLY: incoming garbage, frags/isAlive/win… score/lines/garbage DESYNC DIGEST as the backstop").
- **Drop-in spectating/mid-match join is already a shipped feature** — pure lockstep/rollback can't do it (INVERSUS), but the hybrid can: join = adopt one snapshot (existing machinery), then consume input streams from that tick on.
- **Playout delay buffer**: reuse the existing snapshot-interpolation delay logic (~50–60 ms) as the input-stream de-jitter buffer for remote boards; remote board visualization tolerates 1–3 ticks of buffer invisibly.
- **Input redundancy over Steam P2P**: send each player's input events on the unreliable channel with the last ~250 ms of un-acked events repeated in every packet (INVERSUS/Gaffer pattern); Steam Networking Messages supports per-message reliable/unreliable send flags ([Steamworks networking docs](https://partner.steamgames.com/doc/features/multiplayer/networking)), so use reliable only for control events (join/kick/round transitions), never for the input stream.
- **JavaScript float determinism is *better* than C++'s cross-machine story** — ECMAScript mandates IEEE-754 binary64 for `+ - * /` and bit ops, so identical code gives identical results across V8 instances; the holes are transcendental functions (`Math.sin/cos/pow/exp/log` are implementation-approximated and can differ across engines/platforms — see [Rapier's determinism notes](https://rapier.rs/docs/user_guides/javascript/determinism/)) and `Math.random()`. Since all Serenity peers run the same Electron/V8 build, risk is low; still, ban `Math.sin`-family and `Math.random()` from sim code (integer math covers all of Tetris), enforced by lint rule on `src/core/`.

### Pitfalls
- Simulating remote boards means **N boards × cascade mode** CPU; the infinity-board cascade sim must be cheap enough to run 4–8× (or degrade: simulate visible opponents only, snapshot-adopt the rest).
- Prediction of remote inputs is unnecessary here — **don't** predict remote boards, just buffer-delay them ~2 ticks; nobody notices remote-board latency in a stacker (TETR.IO delays opponent boards; Puyo Puyo Tetris's mistake was coupling *your own* piece dealing to the opponent's acks, §3).
- Separating sim from render (Cannon's warning) is the real cost in this codebase: themes/effects currently observe game objects directly; they must become consumers of an event/state stream so re-simulation and rollback don't fire duplicate VFX/SFX. INVERSUS's fix for effects: keep them in gamestate or dedupe via a recent-event history buffer (128 events).

Sources: [Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/) · [Rollback Networking in INVERSUS](http://blog.hypersect.com/rollback-networking-in-inversus/) · [GGRS docs](https://docs.rs/ggrs/latest/ggrs/) · [SnapNet rollback architecture](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/) · [1500 Archers](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond) · [Synchronous RTS Engines and a Tale of Desyncs](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/) · [GGPO free/MIT](https://www.eventhubs.com/news/2019/oct/09/good-news-everyone-ggpo-rollback-netcode-now-free-use-game-developers-without-licensing-fees/) · [netplayjs](https://github.com/rameshvarun/netplayjs) (JS precedent: rollback + WebRTC; if the game is *not* marked deterministic it falls back to host-authoritative state broadcast — literally Serenity's current architecture, confirming the migration axis)

---

## 3. How modern competitive stackers do netcode

### What's public
- **TETR.IO** (browser JS, 5M+ players): the replay formats are the architecture documentation. [TTR/TTRM files](https://docs.fileformat.com/game/ttr/) are **JSON containing the players, the game seed, the game settings (including per-player handling), and the raw keydown/keyup input events**; multiplayer TTRM contains *both* players' event streams. The engine is 60 fps with **10 subframes per frame** — i.e., input timestamps at 1/600 s resolution feeding a 60 Hz sim ([tetr.io github issue #972](https://github.com/tetrio/issues/issues/972)). That a full game reconstructs from (seed + settings + key events) proves the sim is deterministic; multiplayer opponent boards are driven by relayed input streams through a server, and third-party clients like [Triangle.js](https://github.com/Genius6942/triangle) speak this event protocol. Known operational wart, straight from the wiki: "game rules patches often cause existing replays to not play properly" ([TETR.IO — TetrisWiki](https://tetris.wiki/TETR.IO)) — replay compatibility must be versioned deliberately.
- **Jstris** (browser JS): a **replay is generated for every game in every mode** ([Jstris guide](https://jstris.jezevec10.com/guide), [TetrisWiki](https://tetris.wiki/Jstris)) — same seed+inputs model; replays double as the anti-cheat and self-improvement surface.
- **Puyo Puyo Tetris** (the cautionary tale): delay-based netcode where piece dealing waits on opponent packet confirmation — "when a tetromino is placed, you may not receive a new one until your opponent drops their next piece"; in replays this shows up as pieces mysteriously hovering ([Steam community thread](https://steamcommunity.com/app/546050/discussions/0/1733210552678528952/), [Puyo Puyo Tetris timings — Hard Drop wiki](https://harddrop.com/wiki/Puyo_Puyo_Tetris_timings)). Lesson: **never couple the local piece loop to network acknowledgment.**

### Why it matters
The genre-proven blueprint is exactly the hybrid from §2: deterministic local sim at 60 Hz + subframe-stamped input events + a relay/arbiter (server for TETR.IO, host for Serenity) + event-stream-driven opponent views + seed-plus-inputs replays. No stacker uses GGPO-style full rollback; none needs it.

### Concrete application to this game
- Serenity's target state ≈ "TETR.IO with the host as the server": host relays input streams and arbitrates garbage; peers re-simulate opponent boards; snapshots demoted to join/recovery.
- The local sim must **never block on the network** for piece dealing, hold, or lock (anti-Puyo-Puyo-Tetris rule). The shared-seed piece RNG already guarantees each board can deal pieces autonomously.
- Adopt subframe-style input timestamps (§4) now, even before the netcode moves — they cost nothing and future-proof both replays and high-level handling feel.

### Pitfalls
- TETR.IO's replay-breakage-on-patch problem: embed a **ruleset/engine version + rules-config hash** in every replay header and every match handshake; refuse mixed-version matches (Factorio does exactly this).
- Anti-cheat: seed+input replays make score verification possible (re-simulate and compare — the `src/core/anti-cheat/replay-proof.js` direction), but only after determinism holds; until then a replay "proof" can false-positive honest clients.

Sources: [TTR file format](https://docs.fileformat.com/game/ttr/) · [TETR.IO — TetrisWiki](https://tetris.wiki/TETR.IO) · [TETR.IO FAQ](https://tetrio.github.io/faq/) · [tetrio/issues #972 (60fps × 10 subframes)](https://github.com/tetrio/issues/issues/972) · [Jstris guide](https://jstris.jezevec10.com/guide) · [PPT netcode complaints](https://steamcommunity.com/app/546050/discussions/0/1733210552678528952/)

---

## 4. Input quantization & DAS/ARR handling on ticks

### The practice (guideline semantics)
From the [Hard Drop wiki DAS page](https://harddrop.com/wiki/DAS) and [TetrisWiki DAS](https://tetris.wiki/DAS): **DAS** (Delayed Auto Shift) is the charge time a held left/right key needs before auto-repeat engages; **ARR** (Auto Repeat Rate) is the per-step interval once engaged. Both are canonically **counted in 60 Hz frames**: the [Tetris Guideline](https://tetris.wiki/Tetris_Guideline) specifies ARR = 2 frames (~33 ms) and entry delay (ARE) ~6 frames; typical guideline DAS ≈ 10–16 frames. Modern stackers expose these as player settings ([TETR.IO FAQ mechanics](https://tetrio.github.io/faq/mechanics.html)):
- **ARR 0** = piece **teleports to the wall** on the tick DAS fires (instant repeat) — the dominant competitive setting.
- **SDF** (Soft Drop Factor) = gravity *multiplier* while soft-drop is held (∞ = instant drop to stack); works even at zero gravity.
- **DCD** (DAS Cut Delay) = pause active DAS for N frames on **piece rotation or spawn** (common: 1–2 frames), enabling finesse at 0 ARR without dropping charge.
- **DAS charge persists across piece spawns** ("charged DAS") — the charge counter belongs to the *input system*, not the piece.
- Cross-game conversion quirk: TETR.IO DAS ≈ Jstris DAS + ARR — evidence that where in the tick pipeline you count the first repeat is a real semantic choice you must pin down.
- TETR.IO resolves all of this at **subframe (1/600 s) resolution** on a 60 Hz sim (§3), so a key pressed 3 ms before the tick boundary and one pressed 14 ms before it produce different DAS completion ticks — handling precision beyond tick rate without raising the tick rate.

### Why it matters
DAS/ARR is where "input" meets "tick" — it's the highest-frequency, most skill-sensitive timing system in a stacker, and the first place players *feel* a quantization change. It's also where determinism most often breaks: if DAS is an ms-float timer sampled in the render loop, two runs of the same key events give different piece placements.

### Concrete application to this game
- Represent every input as an **event** `{tick, subframe, key, down|up}` quantized at capture time (`(t_event − t_tick0) / tickMs` → tick + 0..9 subframe). The sim consumes ordered event lists per tick; DAS/ARR/SDF/DCD become integer counters in tick/subframe units inside the sim. This single change makes local play, replays, and netplay all consume the *same* input representation (INVERSUS: "input is quantized identically for local and networked use, ensuring online matches feel identical to local ones").
- Per-player handling settings (DAS/ARR/SDF/DCD) are **sim inputs**, so they go in the match handshake and replay header (TTRM does this). A remote board can only be re-simulated with the owner's handling values.
- 0-ARR semantics on ticks: on the tick DAS completes, apply "move until collision" as one atomic sim op — do not iterate one-cell-per-tick, which would misbehave visibly on wide (and infinity-cascade) boards.
- Cascade mode: soft-drop as SDF-multiplied gravity ticks interacts with cascade settle steps; define priority explicitly (e.g., input phase → gravity phase → cascade/settle phase → lock phase, fixed order every tick).
- **Deterministic within-tick ordering:** sort each tick's events by (subframe, deviceId, keycode) so simultaneous presses resolve identically everywhere — the "same number of calls in the same order" discipline from AoE applied to input.

### Pitfalls
- Quantizing input to the **30 Hz network rate** instead of the 60 Hz sim (or subframes) would be immediately felt by 0-ARR/low-DAS players — input events must be captured at event time, not sampled at snapshot time.
- Floating-point ms accumulators for DAS drift across machines; integers only.
- Key events during rollback re-simulation must come from the recorded event log, never from live keyboard state.
- Don't forget IRS/IHS-like edge rules (rotation/hold buffered during entry delay) — whatever the current variable-delta code does implicitly must be given explicit tick semantics, or the fixed-tick build will "feel different" and A/B testing (§8) will flag it.

Sources: [Hard Drop wiki — DAS](https://harddrop.com/wiki/DAS) · [TetrisWiki — DAS](https://tetris.wiki/DAS) · [Tetris Guideline](https://tetris.wiki/Tetris_Guideline) · [TETR.IO FAQ — mechanics/handling](https://tetrio.github.io/faq/mechanics.html) · [TTR subframes](https://github.com/tetrio/issues/issues/972)

---

## 5. Replay formats & desync detection

### The practice
- **Factorio** (gold standard for lockstep ops): replays are input logs replayed through the deterministic sim. In normal play a **heuristic CRC** runs every tick — a fast, partial hash covering "state of all the players, number of active entities, a snapshot of production statistics" ([FFF-47](https://www.factorio.com/blog/post/fff-47), [FFF-55](https://factorio.com/blog/post/fff-55)). In debug ("heavy mode") they CRC **the whole map every tick** and even save the map every tick with human-readable tags, then replay and binary-diff the **first divergent tick** — "the difference is usually very small, typically just a value of one variable." In production, a detected desync **auto-recovers**: the desynced client pauses, re-downloads the map from the server, rejoins, and a **desync report** is generated (log + reference save + desynced save + replay) ([Desynchronization — Factorio wiki](https://wiki.factorio.com/Desynchronization)). Networking/latency can never cause a desync — only nondeterminism can.
- **Supreme Commander**: full state hash every second; mismatch = abort, no recovery possible without an authority ([Forrest Smith](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/)).
- **AoE**: periodic checksums, abort on mismatch; replays and savegame-restart fell out of the command-log architecture for free ([1500 Archers](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)).
- **INVERSUS/GGRS**: compare **only confirmed frames** (frames no longer subject to input prediction); INVERSUS exchanges player positions every 500 frames; GGRS exchanges per-frame checksums (fletcher16 by default) at a configurable interval and fires `DesyncDetected` ([Johan Helsing — Extreme Bevy: Detecting Desyncs](https://johanhelsing.studio/posts/extreme-bevy-desync-detection/)): hash floats via `to_bits()`, use a version-stable hasher, and register *every* sim-relevant component — an unregistered marker component = silent desync.
- **Replay format shape** (TTRM, §3): header {format version, engine/ruleset version, seed, per-player settings} + per-player timestamped input event streams + external event stream (garbage, joins) + optional periodic digests for integrity/seek.

### Why it matters
Desync detection is how you *earn trust* in determinism: without it, divergence manifests as unexplainable "garbage feels off" bug reports (which this project has literally already had). Replays are the same artifact as netcode input streams, and they become the regression-test corpus for §8.

### Concrete application to this game
- **Digest content** (order-stable, explicitly serialized): board occupancy (pack each 10-cell row into a uint16; hash the row array), active piece {type, x, y, rotation}, hold piece + hold-used flag, bag index/queue position, **RNG state**, garbage queue entries {amount, sourceId, armTick}, score/lines/level/combo/B2B, tick number. For 1000-row infinity boards keep a **running digest**: retired/settled rows fold into an accumulated hash once (they're immutable afterward), so per-tick hashing only touches the active window.
- **Cadence (tiered, following Factorio/SupCom/GGRS):**
  1. compute the cheap digest locally **every tick** (it's ~a few hundred bytes of integer hashing; fletcher/FNV-1a/xxhash32 class),
  2. **piggyback digest (4 bytes) + tick on every 30 Hz snapshot** — desync detected within ≤1 s, effectively free bandwidth,
  3. dev/QA "heavy mode" flag: full-state JSON dump per tick to disk, plus replay-and-compare (Factorio's first-divergent-tick diff workflow).
- **Recovery — Serenity's structural advantage:** unlike SupCom's "impossible to know who's right," the host is authoritative. On digest mismatch: client logs a desync report (last-good tick, both digests, recent input window, ruleset hash — the Factorio report shape), then silently re-adopts the next host snapshot (machinery that already exists). Players experience nothing; telemetry counts desyncs/match as the KPI that gates each migration stage (§8).
- Keep a **ring buffer of the last ~64 ticks' digests** per player so comparisons work despite snapshot latency (compare digest-at-tick-T against local history, not against "now") — this is the confirmed-frame discipline from GGRS/INVERSUS applied to a host-relay topology.

### Pitfalls
- Hashing unconfirmed/predicted state → false positives; only compare ticks both sides have fully consumed inputs for.
- `JSON.stringify` of objects is **not** a serializer for hashing (key order/locale hazards); write an explicit field-ordered binary writer.
- Never include render/audio/interpolation state, wall-clock times, or per-client settings in the digest; normalize any float you must hash via `Float64Array`→`BigUint64Array` bit patterns (JS analogue of `to_bits()`), and assert no NaN.
- Mid-cascade transients: define the digest point as end-of-tick after the settle phase, and include the cascade-phase counter so identical-looking boards in different phases don't collide.
- Desync reports without inputs attached are useless — always bundle the input log window (Factorio bundles the entire replay).

Sources: [FFF-47 — CRC fun](https://www.factorio.com/blog/post/fff-47) · [FFF-55 — MP preview](https://factorio.com/blog/post/fff-55) · [Factorio wiki — Desynchronization](https://wiki.factorio.com/Desynchronization) · [Extreme Bevy: Detecting Desyncs](https://johanhelsing.studio/posts/extreme-bevy-desync-detection/) · [GGRS SessionBuilder](https://docs.rs/ggrs/latest/ggrs/struct.SessionBuilder.html) · [Rollback in INVERSUS](http://blog.hypersect.com/rollback-networking-in-inversus/)

---

## 6. PRNG choice for game determinism

### The practice
Best current survey for JS: [bryc's PRNGs.md](https://github.com/bryc/code/blob/master/jshash/PRNGs.md) (source of the mulberry32 everyone copies) and [Vigna's PRNG shootout](https://prng.di.unimi.it/):
- **mulberry32**: 32-bit state, ~10.4 M ops/s, one-liner — but the author's own caveat: it **cannot produce ~⅓ of all uint32 values** (not equidistributed); he now points serious users to **splitmix32** (~10.5 M ops/s, from MurmurHash3's fmix32 finalizer).
- **sfc32**: 128-bit state, ~7.5 M ops/s, **passes PractRand and Crush/BigCrush**; needs ~12 warm-up calls after seeding. The strongest cheap default in JS.
- **xoshiro128\*\***: fine speed, but weak low bits / fails linear-complexity tests; if used, take high bits.
- **PCG32**: well-studied, and its explicit **multiple independent streams** feature (same seed, different stream constant) is the textbook mechanism for per-subsystem streams.
- **Seeding**: never seed related generators with adjacent integers ("similar seeds cause correlations in weaker PRNGs"); run seeds through a hash first — `xmur3("match-42-player-7")` → 4 words → `sfc32(a,b,c,d)`, or chain splitmix32 to expand one 32-bit seed into wider state (the standard xoshiro seeding procedure).
- **Discipline from the lockstep classics**: AoE synchronized the *seed* and required the same *number and order* of RNG calls in the sim; INVERSUS derives all sim random seeds "from initialization parameters or state," never from wall clock.

### Why it matters
The piece sequence is the competitive core of a stacker: every player in a match draws the same bags from the shared seed. One stray sim-side `Math.random()` (unseedable, unserializable) or one cosmetic effect borrowing the gameplay RNG stream desynchronizes everything downstream.

### Concrete application to this game
- `ffa-p2p-game-state.js` uses a shared-seed **integer LCG** for pieces. For 7-bag shuffling it's adequate *if* the Fisher-Yates draw uses **high bits / rejection sampling** (LCG low bits alternate parity — a modulo-7 draw off low bits biases bags). Recommended upgrade when touching this code: **sfc32 (quality) or splitmix32 (speed/simplicity)**, seeded via xmur3 from a 64-bit match seed; both are drop-in ~5-line functions.
- **Stream splitting per subsystem** (the important structural change): from one match seed, derive independent streams by hashing labels — `pieceRng[playerId] = sfc32(...xmur3(seed + ":pieces:" + playerId))`, likewise `":garbage-column:" + playerId` for garbage hole placement, `":misc:"` for any other sim randomness. Result: adding/removing a random call in one subsystem can never shift another subsystem's sequence — the AoE call-count trap engineered away structurally. It also fixes the documented mid-round-join limitation ("their shared-seed RNG stream wouldn't align") because a late joiner can reconstruct *their own* stream from (seed, playerId) plus a draw-count, independent of everyone else's consumption.
- **RNG state must be serializable** (it's part of the digest §5 and of snapshots/rollback saves): sfc32/splitmix32/LCG state is 1–4 uint32s — trivial. This is a hard requirement `Math.random()` can never meet.
- `Math.random()` stays legal in themes/VFX/UI (it's used ~everywhere there, and that's fine) — enforce the boundary with a lint rule scoped to sim directories.

### Pitfalls
- Mapping to floats: `(x >>> 0) / 4294967296` gives [0,1); be consistent — and for integer ranges prefer pure-integer rejection sampling over float multiply, eliminating float behavior from piece dealing entirely.
- 32-bit match seeds collide across millions of matches; carry 64+ bits (two uint32s) per match.
- Warm-up: discard the first ~12 outputs of sfc32 after raw seeding (or seed via xmur3/splitmix32 expansion, which handles it).
- Never reseed from time mid-match; reseed only at round boundaries from the host's announced seed (the code already re-inits every player with the same seed each round — keep that invariant).

Sources: [bryc — PRNGs in JavaScript](https://github.com/bryc/code/blob/master/jshash/PRNGs.md) · [PRNG shootout (Vigna)](https://prng.di.unimi.it/) · [Mulberry32: a tiny, fast, deterministic RNG](https://www.4rknova.com/blog/2026/03/01/mulberry32-rng) · [Upgrading my PRNG (Red Blob / simblob)](https://simblob.blogspot.com/2022/05/upgrading-prng.html) · [1500 Archers](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)

---

## 7. State-hash / digest cadence strategies

### The practice — the cadence spectrum across shipped games
| System | What is hashed | Cadence | On mismatch |
|---|---|---|---|
| Factorio (release) | heuristic CRC: player states, entity counts, production stats | **every tick** | auto-rejoin + report |
| Factorio (heavy mode) | full map CRC + per-tick saves | every tick (dev only, "crawls to units of FPS") | first-tick binary diff |
| Supreme Commander | full game-state hash | 1/second | abort match |
| INVERSUS | player positions (float exchange) | every 500 frames, confirmed frames only | investigate (backstop) |
| GGRS | user checksum or fletcher16 | configurable, down to every frame; confirmed frames only | `DesyncDetected` event |
| League/Chronobreak | hierarchical key-value trace, **logged on change only**, two detail levels | continuous (offline analysis) | pinpoint variable + code path |

The composite lesson: **cheap-partial-often + full-rare + exhaustive-in-dev**, always at a defined post-simulation tick boundary, always tagged with the tick number, always compared only on frames both sides consider final. Riot's on-change KV trace adds the third axis: a *diagnostic* format that tells you **which variable** diverged, not just *that* something did — checksums detect, traces localize.

### Concrete application to this game
- **Release cadence**: per-tick local digest (§5) + digest-on-every-snapshot (30 Hz) between each client and host. Cost: 4 bytes per snapshot + microseconds of integer hashing. Detection latency ≤ 1 s (better than SupCom, matching Factorio's spirit).
- **Sub-digests for localization** (Riot-lite): alongside the combined digest, keep 4 component digests — board, piece+queue+RNG, garbage, score/stats. Send combined every snapshot; on mismatch the client sends its component digests for the disputed tick so the report says *which subsystem* diverged. (The existing "score/lines/garbage desync digest" idea in `ffa-p2p-game-state.js` is component-digest thinking already.)
- **Dev cadence**: `?heavyDeterminism=1` flag → per-tick full-state structured dump (ring buffer in memory, flushed on mismatch) + a Node-side replay runner that re-simulates recorded input logs and diffs the first divergent tick, Factorio-style. Wire it into vitest as a `SyncTestSession`-style suite: simulate a match, save state at tick T−k, restore, re-simulate to T, assert digest equality — this catches "state not covered by save/restore," the exact bug class GGRS's synctest and Factorio's heavy mode exist for.
- **Infinity-board cost control**: incremental digest — update row hashes on write (piece lock, line clear, garbage insert, cascade settle), fold immutable retired rows into an accumulator once; per-tick combine is then O(active window), not O(1000 rows).

### Pitfalls
- Hashing every tick over the wire (Factorio does it LAN-tuned) is unnecessary; snapshot piggybacking is the right amortization here.
- A digest that changes with serialization-library or field-order changes breaks cross-version comparisons — freeze the digest layout and version it (GGRS switched off Rust's `DefaultHasher` for exactly this reason).
- Comparing "latest digest" instead of "digest at tick T" produces phantom desyncs under latency; the ring-buffer-by-tick discipline is mandatory.
- Alerting the player on first mismatch is wrong (transient adoption races exist in a host-authoritative hybrid); require 2–3 consecutive confirmed-tick mismatches before triggering recovery.

Sources: [FFF-47](https://www.factorio.com/blog/post/fff-47) · [Forrest Smith — Tale of Desyncs](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/) · [INVERSUS](http://blog.hypersect.com/rollback-networking-in-inversus/) · [GGRS docs](https://docs.rs/ggrs/latest/ggrs/) · [Riot — Fixing Divergences](https://technology.riotgames.com/news/determinism-league-legends-fixing-divergences)

---

## 8. Migrating a shipped game from variable-delta to fixed-tick (safely)

### The precedents
- **Riot, Project Chronobreak** ([Introduction](https://technology.riotgames.com/news/determinism-league-legends-introduction), [Implementation](https://www.riotgames.com/en/news/determinism-league-legends-implementation), [Unified Clock](https://technology.riotgames.com/news/determinism-league-legends-unified-clock), [Fixing Divergences](https://technology.riotgames.com/news/determinism-league-legends-fixing-divergences)) — the definitive retrofit story. Method: **record real match inputs → re-run on separate hardware → compare state traces → fix → repeat**, automated to **2–3 thousand real-world games per day** on a replay farm. Divergence classes found: uninitialized memory (a spellcast target vector's y-coordinate), *six* coexisting clock/timing APIs (unifying the clock was "the single largest area of effort"), and nondeterministic system state leaking into the sim. Rollout doctrine, verbatim: **"You can make bold changes to a game in large-scale release, but you need to be able to roll out systemic replacements in parallel with the legacy tech"** — deterministic systems shipped *alongside* legacy paths, switchable, never big-bang.
- **Factorio heavy mode**: save→load→compare every tick — differential testing that catches state the serializer misses (i.e., verifies the *save/restore identity*, which rollback later depends on).
- **GGRS SyncTestSession**: rollback-every-frame + re-simulate + checksum-compare as a permanent CI harness — determinism treated as a regression class, not a one-time achievement.
- **INVERSUS' render trick** for decoupling without feel-change: keep the sim at 60 Hz fixed and, for arbitrary-refresh rendering, extrapolate a *throwaway copy* forward to the render timestamp, then restore — sim stays pure, visuals stay smooth.

### Concrete application to this game — staged plan
1. **Unify the clock first** (Riot's lesson): introduce `sim.tick` and route every gameplay timer through it; kill `performance.now()`/rAF-time reads in `src/core/physics.js` and friends. Ship behind a flag (`?fixedTick=1`) with the variable-delta path intact — the codebase's established `readNetFlag` toggle pattern (`garbageIdempotent`, `garbageDrainAll`, `deterministicGarbage`) is exactly the right delivery vehicle.
2. **Record before you migrate**: add input-event logging (tick+subframe-stamped, §4) to the *current* build and start banking real session logs + final outcomes (board, score, lines, piece count). These logs are the migration test corpus.
3. **Differential/shadow testing**: a Node/vitest replay runner re-simulates banked logs under fixed-tick and compares at **event granularity** (piece-lock positions, line-clear counts, final board/score) — not per-frame equality, since exact gravity/DAS ms→tick quantization legitimately shifts sub-frame timing. Where feel-critical constants change meaning (ms-based DAS → tick-based DAS), tune constants so the event-level outcomes of typical human logs match, and A/B by hand for feel.
4. **Shadow-run online** (cheap because host-authoritative already tolerates divergence): run the fixed-tick sim as a passive shadow of live matches — feed it the same quantized inputs, compare its per-tick digests against adopted host state, count mismatches in telemetry, affect gameplay not at all. This is Riot's replay farm compressed into the live game, gated to internal builds first.
5. **Flip by mode**: online multiplayer first (inputs already quantized by the network, snapshot recovery already exists as the safety net), then solo modes; keep the legacy loop one release as instant rollback (flag flip, no redeploy).
6. **Then** build on top, in order of dependency: seed+input replays (§3/§5) → digest exchange + desync telemetry (§5/§7) → input-stream-driven remote boards → (only if wanted) small rollback window for garbage reconciliation (§2). Each layer's correctness is testable with the previous layer's artifacts.

### Pitfalls
- **Feel regressions are the migration's real risk**, not correctness: gravity at "1 cell per N ticks" vs "px per ms" and DAS quantization change game feel measurably; validate with recorded human input logs and side-by-side capture, not just digests.
- Comparing per-frame states across the two loop styles wastes weeks — compare at semantic sync points (spawn/lock/clear events).
- Shadow-sim divergence will initially be *mostly noise from unmigrated subsystems* (e.g., garbage timing still wall-clock-based); migrate timers in dependency order (input → gravity/DAS → lock/ARE → garbage → cascade) and gate telemetry per subsystem via component digests (§7) so each stage has a clean signal.
- Don't delete the legacy path until desyncs/match in telemetry is ~0 across a full release cycle; Riot kept parallel tech precisely to avoid "deployment rollback risks."
- Save/restore identity (needed later for rollback and heavy mode) must be tested as its own property (Factorio heavy-mode lesson): `digest(load(save(S))) === digest(S)` for states sampled every tick of a fuzzed match.

Sources: [Riot — Introduction](https://technology.riotgames.com/news/determinism-league-legends-introduction) · [Riot — Fixing Divergences](https://technology.riotgames.com/news/determinism-league-legends-fixing-divergences) / [mirror](https://www.riotgames.com/en/news/determinism-league-legends-fixing-divergences) · [Factorio wiki — Desynchronization (heavy mode)](https://wiki.factorio.com/Desynchronization) · [GGRS docs — SyncTestSession](https://docs.rs/ggrs/latest/ggrs/) · [INVERSUS](http://blog.hypersect.com/rollback-networking-in-inversus/)

---

## Cross-cutting: the 30 Hz snapshot channel during and after migration

Gaffer's [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/) validates the current design and its evolution: buffer snapshots (his guidance ≈ 3× the packet interval + jitter margin; at 30 pps that's ~100–150 ms; Serenity's ~50–60 ms at 30 Hz is aggressive-but-reasonable for Steam relay jitter), interpolate rather than extrapolate (extrapolation mispredicts anything nonlinear — and a Tetris board is maximally nonlinear), and treat added interpolation delay as the price of smoothness. Post-migration, snapshots don't disappear — they become the **join/recovery/spectator** channel (full-state resync source, exactly Factorio's map-redownload role), while steady-state remote boards ride the input stream. Steam-side: keep input streams + digests on unreliable sends and control/round events on reliable sends via [Steam Networking Messages/Sockets](https://partner.steamgames.com/doc/features/multiplayer/networking).

## Recommended sequencing (summary)

1. Unify sim clock → integer tick counters behind `?fixedTick=1` (§1, §8).
2. Tick/subframe-stamped input events + handling-as-sim-input (§4); start banking logs (§8).
3. PRNG upgrade: sfc32/splitmix32 + xmur3 label-derived per-player/per-subsystem streams; serializable state (§6).
4. Replay format v1: versioned header {ruleset hash, seed, settings} + event streams (§3, §5).
5. Per-tick digest + snapshot piggyback + desync telemetry + silent host-snapshot recovery (§5, §7).
6. Replay/differential CI (synctest-style save/restore checks + banked-log re-simulation) (§7, §8).
7. Input-stream-driven remote boards; snapshots demoted to join/recovery (§2, §3).
8. Optional: 8–20-tick rollback window for late garbage reconciliation; or scheduled garbage activation (AoE 2-turn pattern) which likely makes rollback unnecessary (§2).

---

## Full source list

**Fixed timestep / loops**
- https://gafferongames.com/post/fix_your_timestep/ — Gaffer on Games, Fix Your Timestep!
- https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing — JS/rAF game loops and timing
- https://jakubtomsu.github.io/posts/fixed_timestep_without_interpolation/ — fixed timestep render strategies

**Lockstep & rollback**
- https://gafferongames.com/post/deterministic_lockstep/ — Gaffer on Games, Deterministic Lockstep
- http://blog.hypersect.com/rollback-networking-in-inversus/ — Ryan Juckett, Rollback Networking in INVERSUS
- https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/ — SnapNet, Netcode Architectures: Rollback
- https://en.wikipedia.org/wiki/GGPO — GGPO history/design
- https://www.eventhubs.com/news/2019/oct/09/good-news-everyone-ggpo-rollback-netcode-now-free-use-game-developers-without-licensing-fees/ — GGPO MIT release, Cannon quote
- https://docs.rs/ggrs/latest/ggrs/ — GGRS (P2PSession, SyncTestSession, desync detection)
- https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond — Bettner & Terrano, 1500 Archers (also https://samu.space/Age-of-Empires-and-networking/)
- https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/ — Forrest Smith, SupCom lockstep (part 2: https://www.forrestthewoods.com/blog/synchronous_rts_engines_2_sync_harder/)
- https://github.com/rameshvarun/netplayjs — JS rollback+WebRTC precedent

**Stackers**
- https://docs.fileformat.com/game/ttr/ — TTR replay format (JSON: users, seed, settings, inputs)
- https://github.com/tetrio/issues/issues/972 — TETR.IO 60 fps × 10 subframes
- https://tetris.wiki/TETR.IO — replay/patch-compatibility caveat
- https://tetrio.github.io/faq/mechanics.html — TETR.IO handling (DAS/ARR/SDF/DCD)
- https://jstris.jezevec10.com/guide — Jstris replays
- https://steamcommunity.com/app/546050/discussions/0/1733210552678528952/ — Puyo Puyo Tetris delay-based netcode symptoms
- https://harddrop.com/wiki/Puyo_Puyo_Tetris_timings — PPT frame timings

**DAS/ARR**
- https://harddrop.com/wiki/DAS — Hard Drop wiki, DAS
- https://tetris.wiki/DAS — TetrisWiki, DAS
- https://tetris.wiki/Tetris_Guideline — guideline frame values

**Replays & desync detection**
- https://www.factorio.com/blog/post/fff-47 — Factorio, CRC fun
- https://factorio.com/blog/post/fff-55 — Factorio, MP preview (heuristic CRC contents)
- https://wiki.factorio.com/Desynchronization — detection, recovery, desync reports, heavy mode
- https://johanhelsing.studio/posts/extreme-bevy-desync-detection/ — GGRS/bevy desync detection walkthrough

**PRNG**
- https://github.com/bryc/code/blob/master/jshash/PRNGs.md — JS PRNGs (mulberry32, sfc32, splitmix32, xmur3)
- https://prng.di.unimi.it/ — Vigna's PRNG shootout (xoshiro properties)
- https://www.4rknova.com/blog/2026/03/01/mulberry32-rng — mulberry32 properties
- https://simblob.blogspot.com/2022/05/upgrading-prng.html — choosing/upgrading a PRNG for determinism

**Migration / determinism retrofit**
- https://technology.riotgames.com/news/determinism-league-legends-introduction — Riot, Determinism Pt I
- https://www.riotgames.com/en/news/determinism-league-legends-implementation — Pt II Implementation
- https://technology.riotgames.com/news/determinism-league-legends-unified-clock — Pt III Unified Clock
- https://technology.riotgames.com/news/determinism-league-legends-fixing-divergences — Pt IV Fixing Divergences (mirror: https://www.riotgames.com/en/news/determinism-league-legends-fixing-divergences)

**Snapshots / transport**
- https://gafferongames.com/post/snapshot_interpolation/ — Gaffer on Games, Snapshot Interpolation
- https://partner.steamgames.com/doc/features/multiplayer/networking — Steam networking APIs (Sockets vs Messages, relay)
- https://rapier.rs/docs/user_guides/javascript/determinism/ — JS float determinism caveats (transcendental functions)
