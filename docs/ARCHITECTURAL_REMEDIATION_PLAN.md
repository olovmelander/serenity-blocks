# Serenity Blocks — Architectural Remediation Plan

*A phase-by-phase architectural roadmap derived from [ARCHITECTURAL_REVIEW.md](ARCHITECTURAL_REVIEW.md), rebuilt 2026-07-04 against a full re-measurement of the working tree (branch `cleanup/repository-files`), a deep second pass over the Quadra reference codebase, and primary-source research on deterministic netcode, architecture governance, GPU CI, and Electron/Steam shipping. Every count in this document was re-measured on 2026-07-02/03/04 unless marked otherwise.*

---

## 0. How to read and maintain this plan

- **This is the umbrella roadmap.** `ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md` is the tactical MP stabilization pre-phase; all other MP/Odyssey/theme plan docs are references until harvested here or marked superseded (Phase 0.6 creates the index that makes this enforceable).
- **Phases are ordered by dependency, not severity.** Each phase either clears a blocker, builds the safety net the next phase needs, or is only safe once an earlier phase exists.
- **Every major work item states:** *What* changes, *why* it matters (traced to a player- or developer-visible outcome), *how* to implement it (file-level pointers, API sketches), *risks/tradeoffs* (including an abort criterion where the change can regress silently), and *validation* (how "done" is verified by a stranger).
- **Status ledger:** ✅ landed & verified · 🟡 partially landed · ⬜ open · ⚠ regressed/newly-found problem. Statuses are snapshots of the verification date next to them; re-verify before acting on one that is more than a few weeks old.
- **Effort tags:** **S** ≤ 1 day · **M** = days–2 weeks · **L** = weeks+ (solo, part-time).
- **The enforcement bar:** any architecture rule that matters twice must become a type, test, fitness check, budget, replay artifact, screenshot artifact, or release gate. Markdown alone is not the control. Each phase's exit criteria are written so a script or a stranger can check them.

---

## 1. Verdict and target architecture

### 1.1 Verdict on the current architecture (short)

The engine is far better built than its god-class line counts suggest — the theme registry, SRS/lock-delay core, per-surface pixel-ratio policy, Electron security trifecta, and the chunked-resync transport are above indie bar. The review's five release blockers have mostly been fixed **but two safety systems have silently regressed since** (§3), CI is red on the current branch, and the deep structural debts remain: a 62-field open `GameState`, five-plus concurrently live game loops, a 5,116-line networking god-class, a dual event bus that drops networked-opponent events, and a boot choreography whose serial waits have no aggregate bound. None of this requires re-platforming. It requires the staged program below: stabilize → harden the net → transform the simulation and netcode on top of it.

### 1.2 The target architecture (north star)

The end-state this plan builds toward, so every phase can be checked against a destination:

```
┌─────────────────────────────────────────────────────────────────────┐
│ PLATFORM (Electron main, Steam, IPC, packaging)                     │
│   strict CSP · named IPC wrappers · release gates · crash reports   │
├─────────────────────────────────────────────────────────────────────┤
│ ADAPTERS                                                            │
│  Input (kbd+pad → tick-stamped events)   Net (Steam P2P transport)  │
│  Render observers (Phaser board, themes, Odyssey — subscribe only)  │
│  Replay/Artifact I/O (record = the net stream; playback = a net    │
│  adapter that reads from disk)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ DETERMINISTIC CORE (headless, no DOM/Electron/window.* reads)       │
│  fixed 60 Hz tick · integer timers · seeded per-subsystem RNG       │
│  pure resolveCascade · GameState behind a mutation boundary         │
│  per-player sim = f(seed, own inputs, host-stamped external events) │
│  per-tick digest · sim-version gates                                │
└─────────────────────────────────────────────────────────────────────┘
```

**The network model this converges on** (the genre-proven blueprint used by TETR.IO/Jstris, and structurally identical to Quadra's): every player's board is a **closed deterministic simulation of (seed + own input stream + host-stamped external events)**. Inputs and snapshots are *cosmetic* channels; **lock/clear/garbage events are truth**, validated by the host against its replica ("collides-or-floats" plausibility firewall). Snapshots are demoted to the join/recovery/spectator channel. The host stays authoritative for arbitration (garbage routing, kill attribution, round control) — this is a *hybrid*, not GGPO lockstep, and it keeps the already-shipped drop-in join and spectator features that pure rollback cannot support.

**Why this architecture is also the performance plan:**

| Boundary | Player-visible performance win |
|---|---|
| Pure synchronous `resolveCascade` | Input dead-time during cascades drops from **330–400 ms+ (measured)** to ≤1 tick (16.7 ms) |
| One loop runner, one clamp policy | Eliminates double-advance/duplicate-rAF bug class; MP boards stop re-implementing loop logic |
| Snapshots → input-stream remote boards | Opponent boards render smoothly at any latency; dominant packet shrinks ~8× (§ Phase 6A.4) |
| Render = observer of sim events | Themes stop reaching into live sim state; no VFX double-fire under re-simulation |
| One GPU host contract (renderer, device-loss, DRS, residency) | Silent frozen-canvas states become recoverable events; VRAM eviction prevents iGPU device loss |
| Boot state machine + watchdog | Menu interactive seconds earlier; no unbounded boot waits |

### 1.3 Best-in-class invariants (the review rubric)

A phase is not "architecturally done" unless it protects these invariants with tests, scripts, or a documented decision:

| Invariant | Best-in-class meaning | Plan hook |
|---|---|---|
| One active roadmap | This plan is the umbrella; the doc index marks everything else active/superseded/reference | Phase 0.6 |
| Boundaries are enforced, not hoped for | Core sim has no DOM/UI/Electron imports *or global reads*; rendering observes, never authors gameplay truth; network messages have declared roles and validation | Phase 3d |
| Every risky subsystem has an artifact | Frame-indexed match artifact for netcode, screenshots for WebGPU, perf traces for boot/rendering, support bundles for customer failures | Phases 3, 5, 7, 8 |
| Product trust is explicit | Casual host-authoritative P2P can ship; ranked requires replay verification at minimum | Phases 6, 8 |
| Performance has budgets | Cold boot, frame p95/p99, package size, snapshot bytes, reliable-message rate, GPU-loss behavior have thresholds a script checks | Phases 3c/3d, 6, 7, 8, §9 |
| Coverage ratchets only move one way | TS pragma count, lint errors, god-file line counts, ShaderMaterial count: committed baselines, CI fails on regression | Phases 0, 3 |

---

## 2. The sequencing logic (why this order)

Five hard dependencies drive everything:

1. **CI must be green and hard-gating before anything else** — a red suite (one chapter test fails today) makes every other gate theater.
2. **You cannot refactor safely without a test/type net** → Phase 3 precedes the Movement C transforms; characterization tests are written *before* each god-class cut, not after.
3. **Dead code and false signal must go before refactors touch them** → Phase 2 clears the deck (mostly done; the shadow test estate remains).
4. **Protocol/snapshot types must exist before the netcode decomposition** → the snapshot contract is duplicated across 5+ sites; decomposing without the type binding invites silent wire bugs (Phase 3a before Phase 6 extraction).
5. **The deterministic tick must exist before netcode sophistication** → reconciliation/rollback/authoritative-attack work built on the variable-delta base is rework waiting to happen (the scope-freeze boundary, §10).

| Movement | Phases | Outcome |
|---|---|---|
| **A — Stabilize** | 0, 1, 2 | CI green and gating; ship-blockers and silent regressions closed; deck cleared |
| **B — Harden** | 3, 4 | Real test/type/fitness/budget net; medium-cost coupling paid down |
| **C — Transform** | 5, 6, 7 | Determinism program, netcode decomposition, render-layer unification |
| **D — Launch** | 8 | Signing, packaging, observability, ship checklist |

**Minimum-viable ship path:** Movement A + Movement D (casual/friends multiplayer tier only). Movements B and C are the long-term health investment; the Phase 1 correctness items are non-negotiable for any multiplayer launch.

### Solo-dev operating rules (new — how this plan survives contact with one part-time developer)

- **Trunk + flags, not long branches.** Long-lived refactor branches die of rebase pain. Every Movement C transform ships dark on `main` behind a registry flag (Phase 0.6) using branch-by-abstraction: facade first (zero behavior change), migrate callers one commit at a time, rewrite behind the facade, delete legacy *with* the flag ([Fowler, Branch By Abstraction](https://martinfowler.com/bliki/BranchByAbstraction.html)).
- **Cap refactor flags with a *dated expiry* at 2.** Code paths double per flag. Every `refactor` flag declares purpose + **either** a dated `expiry` (short-lived migration/rollback levers) **or** a `graduationBar` naming the plan section whose gate retires it (Movement C ground rule (a) requires each transform to declare its flag *before* the phase starts, so long-lived graduation flags legitimately coexist). A 10-line Vitest "time bomb" fails when a dated-expiry flag outlives its expiry, and caps *dated* refactor flags at 2 — nobody else will nag you. (Implemented this way in `flag-registry.test.js`; the numeric cap intentionally bounds only the dated levers, not the graduation-tracked population.)
- **One theme/one session for GPU work** (TDR constraint, CLAUDE.md) — Phase 7 batching respects this.
- **Characterization tests are scaffolding.** Write golden-master pins before each cut, prune them after the refactor lands; never bulk-update snapshots without reading the diff.
- **Time-box spikes; record the abort.** Each phase's abort criterion is a decision you are allowed to take without guilt — write the ADR and move on.

---

## 3. Current-tree delta (2026-07-04, fully re-measured)

> **⚠ SUPERSEDED SNAPSHOT — banner added 2026-07-14.** The table below is a dated 2026-07-04
> re-measurement and is **no longer the live status**; the tree has moved ~10 days and ~80 commits
> since (Movement A is essentially complete and much of Movement C landed dark). The authoritative
> current status now lives in: (a) each phase's dated *Implementation / Groundwork / Completion
> notes* further down, (b) the committed fitness baselines (`architecture-fitness.json`,
> `lint-ratchet.json`, `ts-ratchet.json`, `perf-budgets.json`), and (c) CI itself
> (`.github/workflows/pages.yml`, green on `main`). **Corrections to the worst-drifted rows below
> (re-verified 2026-07-14):** CI is **green** (233 test files / 2,396 tests, up from 96/593); lint is
> a **hard** ratchet gate (`lint:ci`, 1,548 errors ≤ 1,605 ceiling), not `continue-on-error`;
> `@ts-check` covers **43** files (not 3); the release gate is wired into **CI + packaging**
> (`afterPack` hard-fails on AppID 480); desync detection (§1.2) and gamepad DAS (§1.5) are
> **re-armed**; the event bus is **unified** (`event-bus-files: 1`); `ffa-p2p-game-state.js` is
> **~4,727** lines (not 5,116). Re-measure before acting on any individual row here.

The dependency ordering above is stable; this table *was* the latest verified status snapshot **as of
2026-07-04**. Rows marked ⚠ were problems that re-measurement found at that time; several — desync
detection, gamepad DAS, and the red CI test — have since been **fixed** (see Phases 1.2, 1.5, 0.1).

| Area | Verified current state | Plan adjustment |
|---|---|---|
| CI baseline | ✅ **CI is green** (re-verified 2026-07-14): 233 test files / 2,396 tests pass; `main` CI green. `npm test`, typecheck, `lint:ci`, `check:boundaries`, `architecture-fitness-check`, `check:release-gates`, and prod `npm audit` are **all hard gates** in `pages.yml` (only the full-tree audit is a `continue-on-error` warning lane). *(Historical 2026-07-04 state: red — 96 files / 593 tests, 1 fail; the Chapter-4 apron-Z test is fixed order-independently per §0.1.)* | Phase 0.1 landed; the suite hard-gates. |
| Line endings | The git index is already 100 % LF (`git ls-files --eol`: 1510 i/lf, 0 i/crlf). What is dirty is the **local working tree** (1071 w/crlf, 58 w/mixed) — checked out before `.gitattributes` landed. `git add --renormalize` would be an empty commit; CI checkouts are already clean. | Phase 0.2 becomes a *local working-tree refresh*, not a renormalize commit. The old instruction was a misdiagnosis. |
| Lint | Local: 286k errors, of which **280k are local-only CRLF noise**; the CI-visible baseline is **≈5.9k errors + 1.1k warnings** (indent 1,749, max-len 1,093, no-unused-vars 347, no-bitwise 265, import/no-unresolved 154, import/no-extraneous-dependencies 149). The last two rule classes are *blocked on decisions*, not cleanup (§ Phase 0.3). | Burn down with one `--fix` commit + triage; flip `continue-on-error` off. |
| Release blocker | Root and `electron/steam_appid.txt` still `480`; the **built artifact demonstrably ships it** (`release/win-unpacked/steam_appid.txt` = 480; installer 625,923,068 B, built 07-01). `release-gate-check.mjs` works (dev warns / `SERENITY_RELEASE=1` fails) but is **wired to nothing** — not CI, not `build-win.mjs`; `afterPack.cjs` is an explicit no-op. | Phase 1.1 wires the gate into CI + packaging and strips the file in release afterPack. |
| Desync detection | ⚠ **Dead again.** The digest now rides the wire (`_digest`, `steam-networking.js:492`) — but both comparison branches in `syncFromHost` gate on `this._desyncCheckEnabled` (`ffa-p2p-game-state.js:2499,2550`), which is **never initialized and `setDesyncDetection()` (:2637) has zero callers**. The peer-local-sim divergence backstop the constructor's own design note calls the safety net never runs. A real divergence today produces a permanently drifted peer board. | New Phase 1.2 — one-line enable + pinning test. Phase-1-grade, not Phase 6. |
| Multiplayer correctness | Host double-apply fix ✅ (buffers-only, with the Phase 5 cross-link comment); `handleHostDisconnect` ✅; `_verifyHostReassignment` ✅ gates both migration paths; attack-scaling comment+test ✅. 23 MP test files / 161 tests green. But: **five unguarded sender-validation holes** measured (§ Phase 1.3), heartbeat/liveness spoofable, impairment harness live in release path. `ffa-p2p-game-state.js` = 5,116 lines — unchanged since 07-01: the scope freeze is holding. | Phase 1 items renumbered; structural fixes stay in Phases 5–6. |
| Input pipeline | ⚠ **Gamepad hold-repeat (DAS) is dead code in every live single-board path**: `game.js:1140` calls `window.gamepadController.advanceGameplayInput(...)` but `window.gamepadController` is never assigned anywhere in `src/`. Keyboard DAS now advances on the sim delta (`game.js:1133-1139`) — the clock is unified; the *state* is still un-snapshotted on the `InputController` singleton. A latent 2× DAS double-advance exists in the legacy fallback loop (`main.js:4804-4892`). | New Phase 1.5 (one-line fix + pad smoke test); Phase 5.3/5.4 rewritten to "quantize + snapshot," not "move onto sim clock" (done). |
| Event buses | Dual-bus split confirmed and worse than reviewed: 222 theme subscriptions in 64 files on the sync bus; the optimizer's entire feature set is load-bearing for **exactly one** subscription; `HOST_MIGRATED` is emitted with an **undefined event name** (key absent from `multiplayer-events.js`); 3 more orphan events; `once()` on the optimized bus is broken; `LINE_CLEAR` ships ≥6 payload shapes. A third channel (window CustomEvents ×5) exists. | Phase 4.1 now has a full API design + 5-step migration; event-contract tests added to Phase 3b. |
| Cold boot | The tree moved *away* from the old delta: `prepareFirstThemeBeforeIntro()` puts theme load+warm **on the critical path before the intro** (`main.js:5520`), the ident floor is now **4000 ms** (`main.js:5525`), and the boot-warp gauntlet is a stack of **long-but-individually-bounded serial waits** (theme-idle poll with a ~45 s ceiling, `boot-warp-startup.js:101-144`; up to 3 prewarm attempts of ≤20 s each, `main.js:5621-5700`; title-safety postponed 120 s at a time) with **no aggregate wall-clock bound**. `timeToInteractiveMenuMs` is recorded *after* `await introPromise` — it now **contains the intro by construction**. Uncommitted boot-reliability work (4 modified + 3 new files, incl. `startup-debug.js` trace ring buffer and 8 new tests) is the de-facto baseline. | Phase 4.7 rewritten: boot state machine + watchdog + KPI decomposition (`timeToMenuReadyMs` vs `introDurationMs`). Absorb the uncommitted boot work as the baseline. |
| Rendering | 62 registered themes; **19 dual-state themes measured by name** (WebGPURenderer + raw ShaderMaterial) — but the Phase 7 premise was wrong: all 19 are **deliberately backend-gated dual-path themes** (TSL is the live WebGPU path; the GLSL twins are explicit fallbacks, 17/19 even construct their own `WebGLRenderer`). 21 further themes are WebGL-only (~176 ShaderMaterials, no TSL twin). Device-loss camps shifted: Camp 1 grew to 7 (new WebGPU themes adopt the base API), Camp 2 still 6 (4 of them *shadow the base method by name*), Odyssey still zero, and **~38 themes have no handling at all** ("Camp 0"). `EVENTS.CONTEXT_LOST` has zero subscribers. | Phase 7 reframed as *dual-maintenance retirement*; Phase 4.2 redesigned around a shared registration point + a real WebGPU recovery path. |
| Audio / platform | `utils/audio-manager.js` deleted ✅; `SoundManager.cleanup()` closes the context ✅; music manifest fetch is relative ✅; `assets/audio/intro/{begin,warp}.ogg` git-tracked ✅. | Mark done. Phase 8 keeps the packaging item only. |
| Packaging | `dependencies` = only `ez-steam-api` + `steamworks.js`; music 257 MB (36 MP3s) rides **inside app.asar (646 MiB)** — no `asarUnpack`; `author` empty; electron-updater scaffolding (`app-update.yml`/`latest.yml`) present though Steam must own updates; no depot script; no crash reporting. `npm audit --omit=dev` = 0; full tree = 24 vulns (1 critical: vitest, fix available). | Phase 8 items concretized; supply-chain gate in Phase 0.5. |
| Tests estate | Suite grew to 96 files / 593 tests, **but** `vitest.config.js:5` never runs `tests/integration/` (3 files), `tests/performance/` (29 files), the two root-level `test-*.js` files, or the 74 glob-mismatched `tests/unit/test-*.js` files — ~108 dead files. SRS kick-table and Phaser-board smoke tests still missing; binary round-trip tests exist. | Phase 2.6 triages the shadow estate; Phase 3b fills the gaps. |
| TypeScript | `tsconfig` opt-in island over `src/core`+`src/events` (76 files in scope), **3 files carry `// @ts-check` (4 %)**; `types.d.ts` (128 lines) lacks the live MP fields (`awaitingSpawn`, `roundGeneration`, `migrationEpoch`, spectator/download-join metadata). `tornado/*.ts` is now 6 files, outside both tsconfig include and eslint. | Phase 3a adds the mechanical ratchet + contract-first ordering. |

## 4. Quadra reference takeaways (deepened, 2026-07-03 second pass)

Quadra (C++/SDL, 1998–2000, LGPL) is **not** lockstep-deterministic across the wire — each client simulates only its own player at a fixed 100 Hz tick; remote boards are reconstructed from an ordered relay of **authoritative events** plus a **cosmetic input stream**, with fairness from a shared piece-RNG seed. That is structurally the model Serenity has converged on, which is why its edge-case machinery maps so cleanly. Import patterns, not source (LGPL, different era).

| # | Pattern (mechanism, with Quadra refs) | Plan hook |
|---|---|---|
| 1 | **Fixed-tick accumulator with an explicit, logged catch-up policy** — 10 ms ticks; >300 ms owed → jump `framecount` forward (accept time-warp, no death spiral); >10 s → forfeit frames with a log (`quadra.cc:410-507`). Render decoupled; slow-mo/turbo/replay-scrub = scaling accumulator inflow. | 5.3, 5.5 |
| 2 | **Replay verification = the game with rendering amputated** — `-verify file.qrec` runs 500 ticks/loop headless and the *process exit code* is the verdict (`quadra.cc:417-420,674-682`; `verify_summary` → `Game::verifygameinfo`). Requires: headless core, artifact ends in a summary block, `npm run verify-replay` gates CI over a golden corpus. | 5.7, 5.9, 8 |
| 3 | **Late join = demo playback = reconnect: ONE code path** — the recording file *begins with the exact join packet* a late joiner receives (`game.cc:843-847`); playback constructs the game with the network-client constructor and feeds packets from disk (`recording.cc:360-372`). Collapses three test surfaces into one; every recorded match regression-tests the join path. | 5.7, 6A.6 |
| 4 | **The join-snapshot field checklist** — refuses to snapshot until packet stack empty + all boards idle; then sends grids, **the RNG cursor (not just the seed)**, piece pipeline, the full pending-garbage queue with hole bitmasks, the attack-credit table, and stats (`net_server.cc:654-764`, `packets.h:427-449`). Rule: anything the sim reads that is not in the snapshot is a future desync. | 6A.6 |
| 5 | **Cosmetic inputs vs validated authoritative stamps** — inputs animate remote pieces; `Packet_stampblock` teleports the piece to its final pose and every receiver validates it ("collides OR floats" → `DROP_INVALID_BLOCK` with an attributable, user-explained drop, `player.cc:1410-1421`). The strongest single import: **inputs are animation, placements are truth, truth is checked against the replica.** | 6A.3, 6B.1 |
| 6 | **Attack causality as a decaying credit ledger** — per-victim `attacks[]` gains 2×lines on garbage, decays 1 per lock; `last_attacker` earns the frag; ledger deliberately survives drop/rejoin and ships in the join snapshot (`canvas.cc:417-427`, `net_list.cc:1270-1301`). O(players), deterministic, replays cleanly. | 6B.2 |
| 7 | **Interest management** — high-rate move streams relay only to connections *watching that board* (per-canvas `watchers`, `net_server.cc:566-583`); low-rate authoritative events go to all; a `wants_moves` capability flag can disable streaming (playback sets it false). | 6B.4 |
| 8 | **Relay hygiene** — client→server and server→clients packet ids are *distinct types* (rename-on-relay), so peers cannot inject "the server said"; sender identity is bound to a player slot and enforced per message; un-joined connections may send only join/chat; **recording taps the relay point**, so the artifact is exactly what clients saw (`net_server.cc:244-343`). | 6A.3, 5.7 |
| 9 | **Typed structured log events inside the artifact** — `Packet_serverlog` events (join, attack, stampblock, personal-best board snapshot, pause, drop-with-reason, end-with-winner) interleave with gameplay packets; a 454-line decoder ring + offline parser reconstruct full matches. Telemetry, replay, and support artifacts are one file, one schema. | 5.7, 3b, 8 |
| 10 | **Protocol version = "minimum required by the configured rules," honored inside the sim** — hosting starts at v20 and escalates only if chosen rules need newer semantics; old-demo playback reports the old version and *sim behavior branches on it* — including a deliberately preserved bug: "it must remain as is for network compatibility" (`game.cc:171-181`, `canvas.cc:534-556`). | 5.8, 6A.5 |
| 11 | **Host-side operational guardrails** — lag limit, gone-slot reaping, **statistical outlier gate** (points-per-minute ceiling auto-drop) as a complement to per-event validation, send-queue cap with a disconnect policy (256 KiB), trusted-role powers (`net_list.cc:453-556`, `net.cc:589-595`). | 6A.7 |
| 12 | **Reseed only in the dead space between sync barriers** — round restarts walk an enumerated syncpoint ladder; the new shared seed is broadcast only when every peer is idle between barriers; the idle state doubles as the only join window (`net_list.cc:802-917`, `packets.h:601-603`). The formal skeleton for `readyBarrier`. | 6A.6 |
| 13 | **Local/remote sibling state machines on one tick** — remote players run a sibling module stack over the same `Canvas`, consuming network data instead of keys at identical tick granularity — network data is an *input to the machine*, never a direct write into board state. The structural cure for "snapshot stomps interpolated piece." | 5, 6B |

**Anti-patterns observed — do not copy:** client-computed score inside authoritative events (Quadra itself zeroed the field at v23); global mutable singletons (`game.cc:113-116` apologizes in a comment); head-of-line-blocking single packet queue; sentinel-value protocols (`255` = nobody); version branches sprinkled through the sim (centralize in a rules table instead); MD5/telnet-era security (Steam identity replaces it); fail-soft buffer reads returning 0 (prefer decoders that reject).

**Honest non-transfers:** Quadra has a real relay *server* (host migration is Serenity-specific); C++ integer determinism was free (JS needs the Phase 5 program first); 100 Hz per-tick input streaming fit LAN (keep 30 Hz interpolated snapshots as the cosmetic channel until Phase 6B.4); Quadra never actually verified multiplayer demos — don't over-claim what the reference proves.

## 5. Research foundations (what the practices below are based on)

Primary sources are cited inline throughout; the load-bearing ones:

| Practice | Source | Lands in |
|---|---|---|
| Fixed timestep, accumulator, spiral-of-death clamps | [Gaffer on Games — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/); [Isaac Sukin — JS game loops](https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing) | 5.3, 5.5 |
| Seed+inputs replays; 60 Hz sim with subframe input timestamps; per-player handling as sim input | TETR.IO [TTR format](https://docs.fileformat.com/game/ttr/), [60 fps × 10 subframes](https://github.com/tetrio/issues/issues/972); [Jstris replays](https://jstris.jezevec10.com/guide) | 5.4, 5.7 |
| Never couple the local piece loop to network acks | [Puyo Puyo Tetris netcode post-mortems](https://harddrop.com/wiki/Puyo_Puyo_Tetris_timings) | 6 (north star) |
| Tiered digest cadence, desync auto-recovery + reports, heavy mode | [Factorio FFF-47](https://www.factorio.com/blog/post/fff-47), [Desynchronization wiki](https://wiki.factorio.com/Desynchronization) | 5.11 |
| Retrofit doctrine: record real games → re-run → diff → fix; parallel legacy path; unify the clock first | [Riot — Determinism in LoL (4 parts)](https://technology.riotgames.com/news/determinism-league-legends-introduction) | 5.0, 5.10 |
| Rollback mechanics, confirmed-frame checksums, adaptive input delay | [INVERSUS](http://blog.hypersect.com/rollback-networking-in-inversus/), [GGRS SyncTest](https://docs.rs/ggrs/latest/ggrs/) | 5.9, 5.11, 6 |
| PRNG choice (sfc32/splitmix32 over mulberry32), xmur3 seeding, per-subsystem streams | [bryc — JS PRNGs](https://github.com/bryc/code/blob/master/jshash/PRNGs.md), [Vigna shootout](https://prng.di.unimi.it/) | 5.6 |
| Boundary rules with committed known-violations baselines; fitness functions as npm scripts | [dependency-cruiser rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md); [ThoughtWorks fitness functions](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development) | 3d |
| Branch-by-abstraction; characterization tests before refactor; snapshot golden masters | [Fowler](https://martinfowler.com/bliki/BranchByAbstraction.html); approval-testing practice | 2, 4, 5, 6 |
| Incremental TS via `@ts-check` + mechanical ratchet (not codemod migration) | TS handbook JSDoc path; Sentry/Stripe migration writeups | 3a |
| WebGPU CI on software rasterizers (SwiftShader/lavapipe/WARP), adapter assertions, xvfb fallback | [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md), [wgpu CTS-on-WARP](https://gfx-rs.github.io/2021/09/16/deno-webgpu.html) | 3c |
| Frame-time percentile budgets (ms not FPS), relative benchmarking, three test lanes | [CapFrameX metrics](https://www.capframex.com/blog/post/Explanation%20of%20different%20performance%20metrics), [github-action-benchmark](https://github.com/benchmark-action/github-action-benchmark), [Quansight CI-benchmark study](https://labs.quansight.org/blog/github-actions-benchmarks) | 3d, §9 |
| GPU timestamp queries in three.js (`trackTimestamp`, `resolveTimestampsAsync`) | [three.js WebGPU profiling](https://threejsroadmap.com/blog/profiling-webgpu) | 3d, §9 |
| asarUnpack for large media; Steam owns updates (no electron-updater); steamcmd depot scripting; Azure Trusted Signing | [electron-builder configuration](https://www.electron.build/configuration/configuration); [Steamworks SteamPipe/steamcmd upload docs](https://partner.steamgames.com/doc/sdk/uploading) | 8 |
| Sentry Electron with EU region + opt-in consent (GDPR; developer is in Sweden) | Sentry Electron SDK docs | 8.5 |
| Property-based testing (fast-check) for sim invariants + decoder fuzzing | fast-check docs; hypothesis-style game-rule testing practice | 3b, 6A.9 |

---

# MOVEMENT A — Stabilize

## Phase 0 — CI, gates & governance ratchet  *(S–M, ~3–4 days)*

**Goal:** the repo's quality tools actually work, actually gate, and can only ratchet forward.
**Depends on:** nothing. **Unblocks:** everything CI-gated (Phases 1, 3+).

### 0.1 Fix the red test *(S)* ⚠
- **What:** `tests/unit/chapter-environment-manager.test.js` "keeps Chapter 4 grounded" expects apron Z `[-600,-860,-710]`; `mountain-peaks.js:664,683,691` places `[-600,-710,-860]`. Decide which is right (the code order looks intentional; the test likely encodes a stale expectation), fix the loser.
- **Why:** `npm test` is a hard CI gate — every other gate in this phase is theater while the suite is red.
- **Validation:** `npm test` green locally and in CI on this branch.

### 0.2 Line-endings: local working-tree refresh, not a renormalize commit *(S)*
- **What:** the git *index* is already 100 % LF (measured: 1510 i/lf, 0 i/crlf); `git add --renormalize .` would produce an empty commit. The problem is the **local Windows working tree** (1071 w/crlf, 58 w/mixed files, checked out before `.gitattributes` landed). Refresh it: with zero open branches/stashes on the machine, `git stash && git rm -q --cached -r . && git reset --hard` (or `git checkout-index -f -a`).
- **Entry state (destructive-step guard):** commit the outstanding boot-reliability WIP first (~730 lines across 4 modified + 3 untracked files, see §3 "Cold boot") — the refresh above assumes a clean `git status` and will otherwise eat uncommitted work.
- **Why:** 280k of the 286k local lint errors are CRLF noise; CI checkouts are already clean, so this is purely a local-DX unblock for `npm run lint` to be usable.
- **Risks:** the 58 `w/mixed` files will show as fully rewritten in their next real diff — add the bulk-format commit hash to `.git-blame-ignore-revs` so blame survives.
- **Validation:** `git ls-files --eol | grep w/crlf` returns nothing; local `npm run lint` error count drops to ≈5.9k.

### 0.3 Lint burn-down and hard flip *(M)*
- **What:** the CI-visible baseline is ≈5,906 errors + 1,130 warnings. Burn down in three commits: (1) mechanical `eslint --fix` for the safe formatting classes (`indent` 1,749, `object-curly-newline` 450, `object-property-newline` 383, `no-tabs` 431, spacing ≈ 3,100 total); (2) manual triage of `no-unused-vars` (347) and decisions on `no-bitwise` (265 — legitimately used in CRC/binary encoding: per-file disable or rule off for `src/core/network/**`); (3) config fixes: register `three/addons/*` in `.eslintrc.json` `import/core-modules` (154 `import/no-unresolved`), and resolve the **dependency-placement decision that blocks 149 errors** (see 2.5 — `phaser`/`three` in devDeps violates `import/no-extraneous-dependencies`). Then flip `continue-on-error: false` in `pages.yml`.
- **Why:** a soft lint gate is a broken window; every new violation lands silently.
- **Risks:** bulk `--fix` can change behavior in rare autofixes (`prefer-destructuring` class) — run the full suite before/after; keep fix-only and manual commits separate; do it right after 0.2 at a quiet moment (it conflicts with every open branch).
- **Validation:** a PR introducing any lint error fails CI. Baseline count pinned in the fitness harness (3d) so it can only shrink.

### 0.4 Wire the release gates into CI and the packaging path *(S)*
- **What:** `release-gate-check.mjs` works but is invoked by nothing. Add `npm run check:release-gates` (dev mode) to the CI test job; add `node scripts/release-gate-check.mjs` at the top of `scripts/build-win.mjs` `build()`; require `SERENITY_RELEASE=1` for installer/depot targets (hard-fails on AppID 480 — verified).
- **Why:** the top release blocker (§ Phase 1.1) currently has a gate that cannot fire.
- **Risks:** keep `SERENITY_RELEASE=1` exclusively in the release path so PR jobs don't block on ship-only criteria.
- **Validation:** a packaging run with AppID 480 + `SERENITY_RELEASE=1` exits non-zero; CI runs the dev-mode gate on every PR.

### 0.5 Supply-chain gate *(S)*
- **What:** (1) `npm audit --omit=dev --audit-level=high` as a hard CI step (currently 0 vulns — cheap to keep green); (2) full-tree `npm audit` as warning (24 vulns today, **1 critical in vitest <3.2.6 with a fix available — upgrade now**); (3) `.github/dependabot.yml` for npm + github-actions ecosystems; (4) `npx @cyclonedx/cyclonedx-npm --output-file sbom.json` attached to release builds; (5) `ignore-scripts` in CI installs; pin `steamworks.js`/`koffi` exactly.
- **Why:** a paid Electron app ingesting untrusted P2P bytes must scan everything that can affect the shipped binary — devDependency-built artifacts (Electron, Vite, electron-builder, Phaser, Three) included.
- **Validation:** CI shows the audit steps; Dependabot PRs flow; SBOM artifact exists on the next release build.

### 0.6 Architecture governance: doc index, ADRs, flag registry *(S–M)*
- **What:**
  - `docs/ARCHITECTURE_INDEX.md` listing every plan doc as *active / superseded / reference* (this doc is the umbrella; `ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md` is the tactical MP pre-phase).
  - `docs/adr/` with MADR-lite records for the decisions that already constrain work but live in comments or memory: incremental-TS-via-`@ts-check` (currently a tsconfig comment), hybrid renderer split, host-authoritative P2P, **no-WASM physics** (decision + reasons from the review), **no worker offload for the sim for now** (revisit trigger: resync-burst hitches in the §9 budgets), WebGPU/TSL definition of done, theme code-gen pipeline removed—don't rebuild, permanent-WebGL holdouts. Cross-link each enforcement rule (3d) to its ADR id. Reference `docs/adr/` from CLAUDE.md so agent-assisted sessions load the constraints.
  - **Flag registry:** consolidate the `readNetFlag`/URL-param idiom into `src/core/flags.js` where every flag declares `{name, default, purpose, kind: 'permanent-ops' | 'refactor', expiry? | graduationBar?}`; a small Vitest fails when a dated-`expiry` `refactor` flag outlives its expiry. Permanent ops toggles (quality tiers, `forceWebGL`, a11y) are exempt. **Cap dated-expiry refactor flags at 2** (graduation-tracked flags are bounded by their plan-section gate, not the numeric cap — see the Movement C note in §2). *(Landed 2026-07: registry + `flag-registry.test.js` enforce kinds/readers, the dated-expiry time bomb, and the ≤2 dated-flag cap.)*
- **Why:** the MP doc sprawl has already produced conflicting instructions; flags without expiry become permanent forks (the current default-off pile is the evidence); ADRs are the highest-value documentation genre for agent-assisted development — an agent will happily re-add a forbidden pattern unless the constraint is loadable and enforced.
- **Validation:** index committed; ≥6 ADRs backfilled; flag registry exists with the expiry test green; every Movement C phase names its flag in this registry before starting.

**Exit criteria:** CI is green and a red typecheck/test/lint/release-gate push cannot merge; local lint is usable; Dependabot + audits live; the doc index, ADR seed set, and flag registry exist.

**Implementation note (2026-07-09):** Phase 0 is locally finalized on `cleanup/repository-files`:
`typecheck`, `lint:ci`, `test`, `check:release-gates`, prod `npm audit --omit=dev --audit-level=high`,
line-ending check, and `build` pass. Strict `SERENITY_RELEASE=1` release gates block AppID 480 as expected.
The full-tree audit remains the intended warning lane for Electron/esbuild breaking-upgrade advisories.

---

## Phase 1 — Release blockers: correctness & security  *(S–M, ~1 week)*

**Goal:** close the holes that make a multiplayer/Steam release unsafe — including two regressions this re-measurement found. Every fix ships with a regression test.
**Depends on:** Phase 0 (so fixes are CI-protected). **Unblocks:** any real build.

### 1.1 Steam AppID + stop shipping `steam_appid.txt` *(S)* ⬜
- **What:** replace `480` with the real AppID in root + `electron/` for dev runs. In `scripts/afterPack.cjs` (currently an explicit no-op): when `SERENITY_RELEASE === '1'`, `fs.rmSync(path.join(context.appOutDir, 'steam_appid.txt'), {force:true})` and **fail** if the packaged file read `480`. Keep the `extraFiles` copy for dev builds only. Per Steamworks docs, release builds must init with the explicit AppID + `restartAppIfNecessary`; the txt file is a dev-only convenience.
- **Why:** the current installer (built 07-01) demonstrably contains `steam_appid.txt` = 480 — Spacewar. Hard release blocker: wrong app for leaderboards, matchmaking, achievements, cloud.
- **Validation:** release-mode `win-unpacked` contains no `steam_appid.txt` (scripted assert in afterPack); `SERENITY_RELEASE=1` packaging with 480 anywhere exits non-zero.

### 1.2 Re-arm desync detection *(S)* ⚠ **new — regression**
- **What:** both divergence-comparison branches in `syncFromHost` gate on `this._desyncCheckEnabled` (`ffa-p2p-game-state.js:2499, 2550`), which is never initialized and whose setter (`setDesyncDetection`, :2637) has **zero callers**. Initialize it from a flag default-on (`readNetFlag('desyncCheck', true)`) and add a pinning test: force a score/board divergence on a peer-local-sim board → exactly one `forceLocal` resync fires.
- **Why:** the constructor's own design note (ffa:340-343) names this backstop as what makes peer-owns-board safe. Today the only resync triggers are transport-level; a genuine sim divergence (dropped input, gravity skew) produces a *permanently* drifted opponent board — the exact "garbage feels off" bug class already reported once.
- **Risks:** transient mismatches during snapshot adoption races — require 2–3 consecutive confirmed mismatches before triggering (the counter exists; verify its threshold), and count triggers in `netDiag`.
- **Validation:** the pinning test above; a two-machine drill (1.7) includes a forced-divergence scenario and observes exactly one clean resync.

### 1.3 Close the five unguarded sender-validation holes *(S–M)* ⚠ **new**
- **What:** measured today, any peer can: start a match on another peer (`LOBBY_GAME_START`, ffa:979-987), prematurely release a ready-barrier (`GAME_ROUND_START`, :1155-1169), evict anyone from every roster (`LOBBY_PLAYER_LEFT` → `removePlayer`, :975-977), rewrite a peer's roster (`LOBBY_PLAYER_JOINED` list adoption, :929-933), and refresh host liveness / cancel elections (`NET_HEARTBEAT` with no `msg.from === hostSteamId` check, :1020-1023 + `host-migration.js:61-68`). Quick fix now: add host-only sender checks at these five handlers (transport identity `msg.from` is Steam-authenticated). The systematic replacement is Phase 6A.3's role table.
- **Why:** these are lobby-griefing and election-suppression primitives in a paid product. The Phase-1-era allowlist only covers 11 `HOST_AUTHORITATIVE_MESSAGE_TYPES` on the *peer* side.
- **Validation:** spoof tests per hole using the mock/BroadcastChannel transport (self-reported `from` makes spoofing testable in-process); existing `ffa-host-authority.test.js` stays green.

### 1.4 Gate the network-impairment harness out of real sessions *(S)* ⚠ **new**
- **What:** `steam-networking.js:86` constructs `NetworkImpairmentHarness(readNetworkImpairmentConfig())` unconditionally, and `readNetworkImpairmentConfig()` reads localStorage `serenity.netImpair` + 11 URL params — **every outbound envelope passes `planDelivery()` in production**. A stale localStorage entry from a test session silently drops/delays real Steam packets. Guard construction on `SteamConfig.mockMode || import.meta.env.DEV` or an explicit `?netImpair` opt-in.
- **Validation:** unit test: with a poisoned localStorage and prod-mode flags, the harness is inert; `netDiag` shows no impairment plan.

### 1.5 Fix dead gamepad DAS wiring *(S)* ⚠ **new — regression**
- **What:** `game.js:1140-1141` advances gamepad DAS via `window.gamepadController`, which is **never assigned** (`main.js:2482` keeps it on `this`). Consequence: pad hold-to-repeat never ticks in SinglePlayer/Infinity/Odyssey/Local-MP (initial presses fire from the poll loop; `startDas` timers never advance). One-line fix (`window.gamepadController = this.gamepadController` at init) *or* pass the controller into `updateGame` explicitly (preferred — one less global). Do a 2-minute manual pad-hold smoke in each mode.
- **Why:** user-visible input defect on controllers; also a prerequisite for Phase 5.4's unified DAS to have a live call path to replace.
- **Validation:** manual pad smoke + a unit test that `advanceGameplayInput` is reachable from the live loop wiring.

### 1.6 Keep the landed Phase-1 fixes pinned *(S)* ✅
Host double-apply (buffers-only, ffa:1582-1591 with the Phase 5 cross-link comment) · `handleHostDisconnect` → `initiateElection()` (:3747-3757) · `_verifyHostReassignment` gating both migration paths (:3777-3796, self-documented as the Phase 1 quick fix that Phase 6 replaces) · attack-scaling comment/test (`ffa-attack-router.js:423-468`) · CSP module + test (`electron/content-security-policy.js`; note the `SERENITY_DISABLE_CSP=1` escape hatch at `electron/main.js:364` — the ship checklist must assert it is unset). Keep all green; they are deliberate band-aids whose structural fixes land in Phases 5–6.

### 1.7 Author `docs/TWO_MACHINE_STEAM_VALIDATION.md` *(S)* ⬜
- **What:** the plan's most-cited remaining blocker still has no definition. Write the checklist: identical build-hash parity precondition; scenarios — (a) 10-minute 2-peer match with DAS-held movement + cascade storms, assert zero desync-triggered resyncs and matching final `netDiag` digests; (b) forced divergence → exactly one clean `forceLocal` resync (pairs with 1.2); (c) host migration mid-match → epoch adoption, no duplicate garbage; (d) disconnect → rejoin inside the causal window → attribution preserved; (e) impairment matrix (loss 5 %/jitter 100 ms) via the *dev-gated* harness; (f) spectator + drop-in join during an active cascade. Each scenario states expected `netDiag` deltas and explicit pass/fail thresholds (e.g. `deltaDecodeFailures == 0`, `resyncRequestsSent ≤ 1`, snapshot-bytes p95 within budget).
- **Why:** "validated on real Steam" is subjective until this exists; three phases cite it.
- **Solo feasibility (so the bar doesn't multiply an unsecured resource):** define the method in the doc — laptop + desktop, or a scripted remote peer; pre-stage the mock/BroadcastChannel harness as the cheap first tier so two-machine time is spent *confirming*, not exploring; and one two-machine session validates a **flag matrix**, not one session per flag (see 6A.1).
- **Validation:** the doc exists; one full run is recorded (date, build hash, results) before any release-candidate claim.

**Exit criteria:** a 2-peer match survives DAS-held movement, cascades, forced divergence (one clean resync), and host migration; no peer can start/kick/evict/suppress-election; the impairment harness is inert in production; pad DAS repeats work; no placeholder AppID can reach a release artifact; the two-machine checklist exists and has been run once.

---

## Phase 2 — Dead code, drift & dependency hygiene  *(S, ~2–3 days remaining)*

**Goal:** delete everything that emits false signal so later refactors aren't misled. **Mostly landed** — verified statuses below; the remaining items are precise.
**Depends on:** Phase 0. **Unblocks:** clean ground for Phases 3–7.

| # | Item | Status / remaining work |
|---|---|---|
| 2.1 | Dead `scoring.js` exports removed; guard comment at `scoring.js:61-69` | ✅. **Decision resolved:** do *not* extract the live 15-line progression (`physics.js:794-804`) now — it folds into `resolveCascade`'s result in Phase 5.2 (it is inherently part of lock resolution). Extracting twice is churn. |
| 2.2 | Odyssey tree `ShaderMaterial`-free; orphaned `CHAPTER_ENVIRONMENTS` map deleted (do-not-re-add note at `chapter-environments/index.js:43-49`) | ✅ |
| 2.3 | `utils/audio-manager.js` deleted; `SoundManager.cleanup()` closes its `AudioContext` | ✅ |
| 2.4 | `_pieceIdCounter` an instance field; demo piece-id tests green | ✅ |
| 2.5 | **Dependency-placement decision (blocks 0.3):** `phaser`/`three` in devDeps triggers 149 hard `import/no-extraneous-dependencies` errors and under-reports the shipped surface in SBOM/audit. **Decide: move both to `dependencies`** (they ship compiled into `dist/`; honest for SBOM; fixes lint) unless `npm ci --omit=dev` packaging is ever adopted. Record as a one-paragraph ADR. | ⬜ S |
| 2.6 | **Shadow test estate triage** *(new)*: `vitest.config.js` never runs `tests/integration/` (3 files), `tests/performance/` (29 files), the two root `test-*.js` files, **or the 74 `tests/unit/test-*.js` files that miss the `*.test.js` glob** (36 of them contain real describe/it blocks) — ~108 dead files total, each false signal. Per-category default: `tests/performance/` → convert to `scripts/` harnesses or delete (benchmarks, not assertions); `tests/integration/` → migrate into the runner if green in one session, else delete; root `test-*.js` → delete (superseded by `tests/unit/binary-encoding-roundtrip.test.js`); `tests/unit/test-*.js` → rename assertion-style ones to `*.test.js` if green, delete the console-log-script ones. | ⬜ M |
| 2.7 | Theme-container generation: 62 registered themes vs 61 hand-written divs; `chiral-gold` still self-creates (`chiral-gold-theme.js:840-842`). Implement `ensureThemeContainer(themeId)` in the registry (~15 lines, idempotent `getElementById`-first), called from theme-manager activation — lazy-create on first activation (chiral-gold's proven pattern), *not* 62 divs at boot. Keep static divs initially; delete them in a separate verified commit (stacking order against `background-canvas` and `#<id>-theme` CSS is the risk). | ⬜ S |
| 2.8 | Phaser `^4.1.0` stable | ✅ — delete any remaining ESM shims only after all `Game` configs smoke-test. |
| 2.9 | Demo recorder settings-capture bug *(new)*: `_captureSettings` records `settings.das/arr` but the real keys are `dasDelay/dasInterval` (`DemoRecorder.js:205-211` vs `ui/settings.js:12`) — captured input-timing settings are always `undefined`. One-line fix now; the schema is redefined properly in 5.7. | ⬜ S |
| 2.10 | `tornado/*.ts` (now 6 files) outside tsconfig include *and* eslint | ⬜ — fold into the checked island after a `declare module 'three/webgpu'` augmentation, or rename to `.js`. Decide in Phase 3a. |

**Exit criteria:** level progression has exactly one definition (and a plan hook for its move); every test file in the repo either runs in CI or doesn't exist; container generation is registry-owned; the dependency decision is recorded and 0.3 unblocked.

---

# MOVEMENT B — Harden

## Phase 3 — Test & type harness  *(M, ~3–4 weeks part-time)*

**Goal:** the net that makes Movement C safe — types over the riskiest contracts, behavioral tests over the untested high-blast-radius surfaces, a GPU gate that runs off the dev machine, and fitness functions + budgets that make architecture rules and performance self-enforcing.
**Depends on:** Phases 0–2. **Unblocks:** Phases 4–7.

### Track 3a — Incremental TypeScript with a mechanical ratchet

- **What:** the strategy (opt-in `// @ts-check` island over `src/core` + `src/events`, no `.ts` rewrite) is already in place and is the research-endorsed path (Sentry-style slow-and-steady; Airbnb-style codemods spray suppressions one person then cleans up forever). What's missing is **enforcement and coverage**: 3 of 76 in-scope files carry the pragma (4 %), and nothing stops a pragma from being silently deleted.
- **How:**
  1. `scripts/ts-ratchet-check.mjs` in CI after typecheck: read committed `ts-ratchet.json` (`{"checkedFiles":[...]}`); fail if any listed file lost its pragma; warn to update the baseline when coverage grows. ~30 lines; hand-roll before adopting Betterer.
  2. **Type the contracts, not the file count**, in dependency order: `board.js` → `binary-encoding.js` → both event buses → snapshot build/apply. Extend `src/core/types.d.ts` with the live MP fields **before Phase 6 touches the snapshot sites**: `awaitingSpawn`, `roundGeneration`, `migrationEpoch`, garbage-entry metadata, spectator/download-join state. Bind `buildStateSnapshot`/`_applySnapshotState` (the 2 of 5+ drift sites) to `PlayerSnapshot`; make `EventBus.emit/on` generic over `EventPayloadMap` *after* Phase 4.1 unifies the bus (type one bus, not two).
  3. New strangler-extracted modules (Phases 4–6) are born with `@ts-check` (or as `.ts` where three.js types don't bite).
  4. Resolve 2.10: `tornado/*.ts` into the checked island or renamed.
- **Risks:** three.js node-material type-lag — keep themes/TSL out of scope permanently; screenshots are the safety net there.
- **Validation:** ratchet file committed and enforced; `tsc --noEmit` green in CI; a PR deleting a pragma fails.

**Implementation note (2026-07-11):** the live FFA snapshot contract is now bound end to end.
`types.d.ts` distinguishes the authoritative builder, packed binary-v7 body, hydrated/apply shape,
wrapper, resync state, and download progress; the FFA builder/consumer, binary codec, and Steam
wrapper all carry `@ts-check` and are locked into the 18-file pragma ratchet. Packed baselines and
hydrated/apply snapshots are structurally distinct; hydration deep-isolates every nested live-state
reference from the retained delta baseline. The JSON fallback now enforces the v7 player/queue/grid
bounds and validates nested cells, active pieces, board-sized locked components, garbage metadata,
and blind timers before apply. Download-join progress + the lobby spectator roster are typed,
full/delta decode share the canonical string next-piece shape, and nullable/invalid results are
rejected.
The binding also makes the remaining v7 transport omissions explicit rather than pretending they
are serialized: `hotPotatoState`, `lastAttackerId`, and `lockSeq` (plus five extended garbage fields),
and resync's missing input acknowledgements/digest remain protocol work for Phase 6A.

### Track 3b — Behavioral tests for the untested high-blast-radius surfaces

| Test | What it pins | Effort |
|---|---|---|
| SRS kick-table + T-spin table tests | Every JLSTZ/I kick against gameplay behavior; the strongest engineering in the core gets its pin (currently **zero** kick tests) | S |
| Event-contract tests *(new, prerequisite for 4.1)* | (a) every emitted event name exists in the frozen event map — would have caught the live `HOST_MIGRATED`-undefined bug; (b) per-event payload schema — `LINE_CLEAR` currently ships ≥6 shapes | S |
| Golden rule fixtures (Quadra #10) | Level progression (15 lines), scoring bonuses, clean/cascade attacks, attack scaling table, garbage hole masks — table-driven, keyed by future `simVersion` | M |
| Match-artifact decoder test | Parse one recorded demo, assert seed/params/inputs/checkpoint shape; fail on undocumented drift (extends to the 5.7 artifact) | S–M |
| Phaser-board smoke | Boot a board scene, drop a piece, clear a line, assert score — the only test that would catch a Phaser-integration break | M |
| Behavioral release gate | Replace the substring checks in `release-gate-check.mjs` with ≥1 behavioral assertion per gated subsystem (call `getReleaseGateSnapshot()` and assert shape/thresholds; activate 2 themes under jsdom and assert lifecycle events), wired as `release-gate.test.js` riding the normal hard gate | M |
| fast-check property tests *(new)* | One dependency, two properties to start: (a) metamorphic determinism — same seed+input stream twice → identical board digest; (b) adversarial decoder — arbitrary bytes into `decodeSnapshot`/`decodeDeltaSnapshot` → throws or returns well-formed, never hangs/allocates unbounded (this is the Phase 6A.9 fuzz target, started early) | M |

**Implementation note (2026-07-11):** the behavioral release gate is landed. The packaging-invoked
CLI now executes `tests/unit/release-gate.test.js`; the suite exercises the real AppID policy,
performance snapshot aggregation, preload-error recovery, runtime theme-soak/benchmark hooks, and
two complete `ThemeManager` lifecycle transitions. The former source-substring scans are deleted.

### Track 3c — GPU gate (TDR-safe, off the dev machine)

- **What:** wire `scripts/odyssey-webgpu-validation.mjs` (already CI-shaped: per-scene Electron boot, console shader-error regex, PNGs, non-zero exit) into a hosted-runner job, and land the theme tripwire test.
- **How — the specific gaps that would make a naive wiring green-light nothing:**
  1. **Fix the scene list first:** `SCENES` (`odyssey-webgpu-validation.mjs:29-32`) omits `surface-world` (chapter 3) — derive the list from the chapter registry (4.5) so it cannot drift.
  2. **Assert the backend actually initialized** — if WebGPU silently falls back to WebGL2 on the runner, the "WebGPU" leg compiles no WGSL. Log/assert `renderer.backend` type in-page, and `adapter.info.architecture === 'swiftshader'` so the suite fails loudly on adapter surprises.
  3. Linux runner recipe: `xvfb-run` + `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --headless=new --no-sandbox` (headless WebGPU on driverless Linux is flaky — if `requestAdapter()` returns null, switch to headed-under-xvfb before debugging anything else). Replace the fixed `await delay(2500)` with a readiness signal (the playground's `__PLAYGROUND_READY__` contract is the in-repo model) — software rasterization is 10–100× slower.
  4. Run both legs (WebGPU + `ODYSSEY_FORCE_WEBGL=1`), scene-by-scene, on `src/rendering/odyssey/**` path filters or nightly — not every PR.
  5. **Tripwire test (land before the first 7.2 conversion):** a ~30-line static test asserting the dual-state theme set equals the committed 19-name allowlist (§ Phase 7), so the set can only shrink deliberately.
- **Risks / abort:** SwiftShader-WebGPU support is Chromium-version-sensitive; pin versions. **Abort criterion:** time-box Dawn/SwiftShader-in-Electron to two sessions; if it won't initialize, ship the `ODYSSEY_FORCE_WEBGL=1` leg in CI (the WebGL2 backend still compiles the same TSL graphs and catches most graph errors) and keep the WebGPU leg as a documented local pre-release step.
- **Validation:** a WGSL/TSL graph error in any chapter fails CI without touching the dev iGPU; screenshots archived as artifacts; the tripwire fails if a theme enters the mixed set.

**Implementation note (2026-07-14):** the GPU gate is wired. `.github/workflows/gpu-validation.yml`
runs the harness on odyssey/pilot/script path-filtered PRs, on demand, and nightly — kept off `pages.yml`
so it can't block the deploy pipeline. Harness hardening landed against gaps 1–3: the scene list includes
`surface-world` and is pinned ⊇ the chapter registry (`tests/unit/odyssey-gpu-gate-coverage.test.js`);
the pilot exposes a `window.__ODYSSEY_PILOT_{READY,BACKEND,ERRORS}__` contract so the harness polls a real
readiness signal instead of `delay(2500)` and **asserts the backend actually initialized** (a silent
WebGL2 fallback fails loudly). The pilot contract was verified against real WebGL2 rendering via
Chromium/CDP (deep-ocean + surface-world clean, 0 shader errors).

The **CI reality is harder than the abort criterion anticipated, and the honest outcome is a separate
lane, not a per-PR gate.** Findings across four runs off the dev machine: (1) `xvfb-run` does **not**
propagate the wrapped exit code, and (2) Electron's own exit code is *also* unreliable when Chromium
crash-loops — together these produced **false greens** (a 0/N render reported as success). Fixed by
reading the verdict from `report.json`, not the process exit. (3) The deeper wall: **GitHub's hosted
runners cannot give Chromium/Electron working shared memory** — creation fails in `/dev/shm` *and* `/tmp`
(`No such process`), so Electron+SwiftShader renders flakily or not at all (observed 0/11 and 0/3) while
spewing 5–17 MB of errors. The harness *logic* is correct (verified locally via Chromium/CDP: scenes
render clean, 0 shader errors), but the hosted runner cannot execute it.

**Resolution (matches §9.3's lane split):** the render-validation is **not a per-PR gate**. The per-PR
guard is the fast unit tests (`odyssey-gpu-gate-coverage` + `dual-state-theme-tripwire`) in `pages.yml`,
which catch scene-list drift and the "chapter silently exempt" class that motivated §3c. The Electron
render harness runs as a **non-blocking nightly + on-demand lane** (`.github/workflows/gpu-validation.yml`,
`workflow_dispatch` + `schedule` only) with an **honest `report.json` verdict** — it can never false-green
or block a PR. `--in-process-gpu` is the render attempt (removes the crash-looping GPU process); if a
hosted runner still can't render, real render-validation waits for a **self-hosted GPU runner (§9.3
nightly RTX lane)** — the proper fix — while the lane reports red honestly in the meantime. The WebGPU leg
likewise stays out of CI (documented local step). Gap 5's tripwire already exists; still open:
`adapter.info.architecture` assertion and a GPU runner that can actually render.

### Track 3d — Architecture fitness functions & budgets

- **What:** `scripts/architecture-fitness-check.mjs` (does not exist yet) + committed baselines, run in CI; plus the machine-readable perf-budget file (§9 defines the schema and capture protocol).
- **How — two enforcement layers, because import rules alone don't make core headless:**
  1. **dependency-cruiser** (CI source of truth) with a **known-violations baseline** (`--ignore-known`) so day one isn't red — `src/core` already violates "no UI/theme imports" in 9+ files. Error-severity rules: `core-stays-headless` (src/core ↛ src/{ui,themes,rendering,playground,audio}), `themes-are-islands` (src/themes/<a> ↛ src/themes/<b> via `$1` group matching), `no-electron-in-renderer-src`; `no-circular` at warn with a count ratchet. Each rule's `comment:` cites its ADR.
  2. **ESLint overrides** for what imports can't see: `no-restricted-globals` (`window`, `document`, `navigator`) scoped to `src/core/**` — ~20 core files touch DOM globals today, including the sim-inside theme-color read (`game.js:24-46`) that Phase 5.11 must evict from digestable state. Mirror the top rules in eslint-plugin-boundaries for in-editor feedback. (Skip ts-arch — redundant third tool.)
  3. **Hand-rolled ratchets** in the fitness script, baseline-file pattern (same shape as `ts-ratchet.json`): no new raw `ShaderMaterial` (baseline 392 hits/54 files, count-per-file may only shrink); no new event bus; no non-dev `window.*` handles (delete `window.eventOptimizer` in 4.1); **god-file line counts frozen-then-shrinking** — `ffa-p2p-game-state.js` 5,116, `main.js` 6,358, `OdysseyMode.js` 5,834, `LocalMultiplayerMode.js` 4,262: fail if any exceeds baseline (this is the scope-freeze boundary made mechanical — it already failed once as a markdown rule, +560 lines); no `Math.random`/`Math.sin`-family/`Date.now`/`performance.now` under `src/core/**` sim paths (allowlist for the not-yet-migrated sites, shrink-only — Phase 5's determinism inventory made enforceable); exactly one `requestAnimationFrame` sim driver under `src/core/**` (post-5.5).
  4. **Budgets:** `perf-budgets.json` (schema in §9) with entries for `timeToMenuReadyMs`, frame p95/p99 per heavy theme + Odyssey, snapshot bytes p95, reliable-msg rate, installer/asar bytes, bus events/sec. Nulls mark "budget declared, baseline pending" — declared-but-unbaselined budgets are lint-visible instead of silently unfalsifiable.
- **Validation:** fitness script green in CI with committed baselines; a PR adding a core→UI import, a new ShaderMaterial, +1 line to a god file, or a `Math.random` in the sim fails; budgets file exists with ≥3 non-null baselines.

**Exit criteria:** contracts typed and drift-failing; the seven 3b test families exist and run in CI; the GPU gate fails on WGSL errors off the dev machine; fitness checks + ratchets + budget file live in CI.

---

## Phase 4 — Architectural debt reduction  *(M, ~2–3 weeks)*

**Goal:** pay down the medium-cost coupling that doesn't require the Phase 5/6 surgery — each item is now safe because Phase 3 can catch regressions, and each has a measured baseline from the 2026-07-03 re-measurement.
**Depends on:** Phase 3 (tests/types). **Unblocks:** cleaner substrate for Phases 5–6.

### 4.1 Unify the event buses *(M)*
- **Current state (measured):** sync bus `event-bus.js` (73 lines, **no per-listener error isolation** — one throwing theme handler aborts later handlers *and* propagates into gameplay code); optimized bus consumed only through the `multiplayer-events.js` facade; **the optimizer's entire feature set is load-bearing for exactly one subscription** (`multi-player-canvas-layout.js:454`, rafThrottle); 222 theme subscriptions in 64 files on the sync bus; live bugs: `HOST_MIGRATED` emitted with an undefined name (`host-migration.js:152-154` — key absent from the map), 3 orphan events (`JOIN_REJECTED`, `COUNTDOWN`, `ROUND_OVER`), broken `once()` (`event-optimizer.js:258-265` unsubscribes by the wrong identity), ≥6 `LINE_CLEAR` payload shapes, plus a third channel (5 window CustomEvents).
- **What:** one bus with an options superset, then delete the optimizer.
  ```js
  on(name, handler, { throttleMs?, debounceMs?, rafThrottle?, batch?: {delayMs}, signal? })
  once(name, handler)          // off by wrapper identity (fixes the optimizer bug class)
  off(name, handler)           // matches by ORIGINAL handler, wrapper-aware
  emit(name, payload)          // try/catch per listener → onListenerError(event, err, handler)
  listenerCount(name)          // tests + fitness checks
  setKnownEvents(names)        // DEV/TEST: unknown or undefined name throws
  ```
  Keep flat `ffa:`-prefixed names; register `ALL_EVENTS = {...EVENTS, ...MULTIPLAYER_EVENTS}` with `setKnownEvents` in dev/vitest (this alone would have caught the `HOST_MIGRATED` bug at emit time). **Ordering guarantee to preserve:** option-less listeners stay synchronous and in registration order — all 222 theme subscriptions rely on effects starting the same frame.
- **How (zero-regression migration, 5 steps):** (1) add options + isolation + `setKnownEvents` to `event-bus.js` with a pinning vitest (ordering, isolation, once-fires-once, rafThrottle coalescing, batch delivery, unknown-name throw); (2) re-point the facade — `multiplayer-events.js` swaps `optimizedEventBus` → `eventBus`; its exported signatures are unchanged, so all 9 consumer files are untouched (**a single-file cutover, not a 12-file migration**); (3) delete `OptimizedEventEmitter`, the singleton, and `window.eventOptimizer` (no importers of the helpers exist outside the facade — measured); (4) fix the orphans in the same PR: add `HOST_MIGRATED` to the map with a subscriber or delete the emit; `COUNTDOWN` stays (it becomes the 6A.2 countdown-extraction contract); (5) **separate commit, opt-in only:** emit opponent gameplay on the unified bus behind a per-theme opt-in — 64 theme files currently assume `LINE_CLEAR` == local player; **blind forwarding double-fires every theme effect in MP. This is the regression trap; do not execute the old plan wording literally.**
- **Back-pressure:** `RENDER_FRAME` is consumed un-throttled at `OnlineMultiplayerMode.js:1216-1218`; expose `batch`/`rafThrottle` as the sanctioned coalescing tools and add "bus events/sec" to the §9 budgets so MP storms are measurable.
- **Validation:** the 3b event-contract tests green; A/B a 2-peer session with `netEventLog` before/after asserting identical event sequences; fitness check "no new bus".
- **Perf impact:** neutral-to-positive (deletes a scheduling layer); the win is the deleted silent-miss class.

### 4.2 Unify device-loss resilience *(M)*
- **Current state (measured):** Camp 1 (routes through `gpu-context-resilience.js` via `BaseTheme.setupRendererResilience`) grew to 7 themes — the convention is winning in new code; Camp 2 (private handling, invisible to the bus) still 6, and **4 of the 6 shadow the base method by name** — the fix is largely *deleting the override*; Camp 3 (Odyssey): still zero handling (`OdysseyBoardController.initRenderer` registers nothing); **Camp 0 (never previously counted): ~38 themes with no handling at all**. `EVENTS.CONTEXT_LOST` has **zero subscribers** — the bus is write-only for losses — and WebGPU has no "restored" event, so the existing rebuild-on-restore path can never fire for WebGPU losses. The only working WebGPU recovery in the tree is void-ember's private teardown-to-2D (`void-ember-theme.js:1129-1165`) — the model to generalize.
- **What:** one registration point + one consumer.
  1. **Registration:** call `setupRendererResilience(renderer, {webgpuDevice})` from the one place `BaseTheme` learns about a renderer (covers Camp 0 wholesale instead of 51 call sites), and from the end of `OdysseyBoardController.initRenderer()` (after `await renderer.init()`, when `backend?.device` exists; plus `monitorWebGL` for the forceWebGL leg).
  2. **Consumer:** a `GpuLossCoordinator` subscribing `EVENTS.CONTEXT_LOST`: for `webgl`, rely on browser restore + the existing `CONTEXT_RESTORED` rebuild; for `webgpu` (terminal — no restore event), invoke a per-surface recovery callback: themes → dispose renderer + re-run `createScene()`; Odyssey → `pauseRendering()` → overlay → full `dispose()` + re-init (the warm-up path already replays the journey; re-init cost is a known ~seconds quantity) → `resumeRendering()`; **cap recovery attempts at 1, then route out to the menu** — on a genuinely TDR'd iGPU, a retry loop re-triggers the loss.
  3. Camp-2 conversion = delete the 4 method-shadows + 2 raw registrations, passing their existing local behavior as callbacks (stellar-drift's local WebGPU handling must not stay active in parallel — double-recovery storm risk).
- **Validation:** unit-testable without a GPU (fake `device.lost` promise); live drills via `WEBGL_lose_context.loseContext()` and `renderer.backend.device.destroy()`; success = every loss appears in `gpuResilience.stats` + one bus event + the surface recovers or routes out. Add "GPU losses observed / recovered / routed-out" to the support-bundle counters (8.7) — today a loss in Camp 0/3 is a silent frozen canvas, and project memory already documents GPU-degradation episodes being mis-attributed.
- **Perf impact:** zero steady-state; this is crash-rate/diagnosability work (a reliability budget line in §9).

### 4.3 Fix the local-MP context explosion *(M)*
- **Current state:** `_createSeparatePhaserGames()` (`LocalMultiplayerMode.js:2152`, loop at :2214-2217) boots one `Phaser.Game` **per player** (≈6 GL contexts in a 4-player match incl. main board + WebGL1 background), each with its own rAF, atlases, pipelines, and a 100 ms boot handshake. **The plan's proposed alternative already exists in the same file as a dormant legacy path:** `_ensureMultiplayerBoardScenes()` (:1992-2064) runs N `MultiplayerBoardScene` instances inside the single main `phaserGame` with per-player viewport rects (`board-panel.js:49`, extending the shared `BaseBoardScene`).
- **What:** resurrect and finish the viewport path for N ≤ 4 — one canvas spanning the board area, per-scene camera viewports, per-camera zoom replacing per-game `Scale.FIT`, an explicit decision for `BoardJuice` (per-viewport vs per-canvas shake). Investigate *why* the code moved away from it (evidence points to DOM-driven per-player layout) and either solve that in the viewport path or document the blocker.
- **Risks / abort:** if viewport cameras can't reproduce `Scale.FIT` sharpness on mixed-DPI within a time-box, ship the cheap interim instead: destroy the idle main-board game during local MP (contexts 6→5, bounded).
- **Validation:** context count assertion in a local-MP smoke test; resize-storm measurement (4.4) before/after.

### 4.4 One debounced viewport broadcaster *(S)*
- **Current state:** 61 `addEventListener('resize')` across 60 files (46 in themes) + 6 `visibilitychange`; `main.js:2937-2944` already debounces 150 ms but doesn't broadcast.
- **What:** `EVENTS.VIEWPORT_RESIZED {width, height, dpr}` emitted from the one debounced handler, plus a pull API (`getViewport()`) for activation-time reads. Migrate `BaseTheme` first (one base-class subscription + deleting per-theme listeners covers most of the 60 files incrementally — no big-bang). **Descope `visibilitychange`:** 5 of its 6 users gate audio/render loops and need raw event semantics.
- **Validation:** fitness check "no `addEventListener('resize')` outside the broadcaster + documented holdouts"; count `renderer.setSize` calls during a scripted 2-second window drag before/after (the F11 freeze documented in `main.js:2934-2936` is the player-visible symptom).

### 4.5 One chapter registry — with the core/rendering split *(M)*
- **Current state:** the five hand-synced chapter-keyed structures all still exist (`CHAPTER_CONFIGS`, `LEVEL_CONFIGS`, `CHAPTER_MODULE_LOADERS`, `CHAPTER_EXPORT_NAMES`, `ODYSSEY_CHAPTER_PROFILES`) **plus a sixth that has already drifted**: `SCENES` in `odyssey-webgpu-validation.mjs` omits chapter 3, silently exempting it from the GPU gate.
- **What:** a naive single `CHAPTER_REGISTRY` holding loaders would drag rendering imports into core and violate 3d's own boundary rule. **Design:** keep `CHAPTER_CONFIGS` (core) as the id/name/levelRange truth; collapse lists 3+4+5 into one rendering-side map keyed by chapter id (loader + export names derive from the id via the existing naming convention, e.g. `earth-core` → `createEarthCoreEnvironment`); derive the validation script's scene list from it; add a vitest asserting id-set equality between the core list and the rendering map (extend the existing pin in `OdysseyDirector.test.js:24-65`). While consolidating, do **not** faithfully copy the memory-documented dead difficulty fields in `chapters.js` (live difficulty derives from `levels.js` PHASE2_TAGS via `difficulty-model.js`) — re-laundering false signal defeats the point.
- **Validation:** adding a chapter touches one rendering map + one core entry; the id-set test and the GPU gate cover the rest.

### 4.6 Extract the shared mode lifecycle *(M)* — **rescoped to avoid double-refactoring with 5.5**
- **What:** `StandardGameLoopMode` between `BaseGameMode` and the single-board modes owning **pause/resume wiring and the repeated gameplay-event quartet emission** (`LINE_CLEAR`/`COMBO`/`PIECE_LOCK`/`PERFECT_CLEAR` copy-pasted across 4–6 modes with divergent payloads — the 6-shape problem). **Explicitly out of scope: loop scheduling/rAF ownership — that is Phase 5.5's surface.** Doing loop wiring here and again in 5.5 refactors the same code twice; this item makes the modes *thin* so 5.5's runner swap touches one class.
- **Validation:** one emit site per event; the 3b payload-schema test pins the unified shape; mode classes shrink measurably (ratchet).

### 4.7 Cold boot: state machine, watchdog, honest KPI *(M)* — **rewritten; the old item described a tree that no longer exists**
- **Current state (measured):** the branded boot is a serial choreography: ident → `prepareFirstThemeBeforeIntro()` (theme load ≤6.5 s + warm ≤15 s budgets, **on the critical path**, `main.js:5520`) → hard **4000 ms** ident floor (:5525) → intro + boot-warp gauntlet: a serial stack of individually-bounded waits (theme-idle poll ≤ ~45 s; up to 3 prewarm attempts ≤ 20 s each; title-reveal safety re-postponed 120 s at a time, `boot-warp-startup.js:101-144`, `main.js:5621-5700`) whose **worst-case sum has no aggregate bound anyone chose on purpose** → `await introPromise` → menu. `timeToInteractiveMenuMs` is recorded after the whole thing — **the KPI contains the intro by construction**, so any threshold on it is either meaningless or trips on an intentional intro tweak. ~730 lines of uncommitted boot-reliability work (incl. `startup-debug.js`, a 400-entry stage-trace ring buffer, and 8 new tests) are the de-facto baseline — **land them first**.
- **What:**
  1. **Boot state machine:** `BOOT_STARTED → APP_READY → MENU_READY` (modal DOM armed + input live, hidden behind the overlay — measured dependencies are only `appInitPromise` + modal DOM; *not* audio, *not* theme, *not* Steam) in parallel with `INTRO_RUNNING`; `MENU_READY + (INTRO_DONE | INTRO_SKIPPED | WATCHDOG)` → `MENU_VISIBLE`.
  2. **One boot watchdog** (~45 s wall-clock) that forces `INTRO_SKIPPED`, dismisses shell + warp, reveals the menu — imposing a single aggregate bound over the serial per-step timeouts and simplifying the choreography. User input during the intro is the skip affordance.
  3. **KPI decomposition:** `timeToMenuReadyMs` (the real regression KPI, ends at MENU_READY) + `introDurationMs` (a product choice, tracked separately). The `startup-debug.js` trace already captures every stage; what's missing is only aggregation + the budget assertion (§9).
  4. Make the 4 s ident floor a named policy constant with a rationale comment.
- **Risks:** menu flash under a translucent overlay — keep the overlay opaque until `MENU_VISIBLE`.
- **Validation:** extend `startup-animation-reliability.test.js` with watchdog + transition tests; `timeToMenuReadyMs` gets a budget with a measured baseline; a deliberately-hung theme prewarm in a test build reaches the menu via the watchdog.

**Exit criteria:** one bus (optimizer deleted, orphans resolved, contract tests green); every GPU surface reports losses through one path and Odyssey recovers or routes out; 4-player local MP ≤ 2–3 contexts (or the documented interim); resize storms collapsed; chapter truth = core list + one derived rendering map; modes share one lifecycle/emission contract; boot reaches an interactive menu in bounded time with an honest KPI.

---

# MOVEMENT C — Transform

> Three large tracks. Strictly serially: **Phase 5 first** (it produces the tick the netcode reconciles on), then 6B; Phase 6A and Phase 7 are parallelizable earlier (6A after Phase 3a's types; Phase 7 after Phase 3c's gate).
>
> **Movement C ground rules (from the risk review):** every phase here (a) ships dark on `main` behind a registry flag (0.6) via branch-by-abstraction — no long-lived branches; (b) captures its §9 baseline *before* starting so budgets are falsifiable; (c) has an abort criterion — a regression threshold that reverts the flag, not just an exit criterion; (d) leaves the legacy path in place until its differential gate has been clean for the stated soak, then deletes legacy *and* flag together.

## Phase 5 — The Determinism Program  *(L, ~4–6 weeks)*

**Goal:** a deterministic, fixed-tick simulation: `(seed, input stream, external events)` reproduces a bit-identical board. This is the central architectural prize — it converts replay to pure-input, gives netcode a frame number, removes cascade input-blocking (the single largest measured input-latency defect), and subsumes two Phase 1 band-aids.
**Depends on:** Phase 3 (types over the contracts; golden demos as the net). **Unblocks:** Phase 6B.

### 5.0 Doctrine (how a shipped game survives this migration)

The Riot/Factorio retrofit playbook, adapted:
1. **Unify the clock first** — every gameplay timer becomes an integer tick counter; the loop's only job is deciding how many ticks to run. (Riot found *six* coexisting clock APIs; Serenity's inventory is in 5.3.)
2. **Record before you migrate** — add tick-stamped input-event logging to the *current* build and start banking real session logs + final outcomes now. These logs are the migration test corpus; without them 5.10's differential gate has nothing to chew.
3. **Parallel paths, flag-switched, never big-bang** — `fixedTick` flag in the 0.6 registry; the variable-delta path stays intact until telemetry says desyncs/divergences ≈ 0 across a full cycle.
4. **Compare at semantic sync points** (piece-lock pose, line-clear counts, final board/score digests), not per-frame equality — ms→tick quantization legitimately shifts sub-frame timing; per-frame comparison wastes weeks.
5. **Cutover ladder (the named rollback lever the old plan lacked):** flag off-by-default → the 5.10 differential gate clean (50-session mix defined there) → flag default-on for **online MP first** (inputs already network-quantized; snapshot recovery already exists as the safety net) → solo modes → one full release with legacy-as-instant-rollback → delete legacy path + flag together.
6. **Feel is the real migration risk, not correctness:** gravity "1 cell per N ticks" vs "px per ms" and DAS quantization change feel measurably. Validate with banked human input logs at event granularity plus deliberate side-by-side hand testing; where constants change meaning, retune so event-level outcomes of typical logs match.

### 5.1 GameState mutation boundary *(M)*
- **What:** not getters/setters over 62 fields. The board is represented three coherent-by-hand ways (`lockedPieces`/`boardGrid`/`boardCache`, synced via `ensureBoardCache`/`markBoardDirty`/`rebuildBoardGridFromPieces` — rebuilt ≥2× per lock and 3–4× per cascade wave today). Make the derivation one-directional behind ~4 mutation methods — `lock()`, `clearLines()`, `applyGarbage()`, `restore()` — and route the 60 direct-write sites (22 of them in `ffa-p2p-game-state.js`) through them.
- **The trap the old plan missed:** `demo-state.js:restoreGameStateSnapshot` and FFA `_applySnapshotState` bulk-assign fields — the boundary must include a **sanctioned bulk-restore** (`restore()`) or those two become permanent bypasses.
- **Validation:** fitness rule: no direct writes to the core field set outside `game.js` (baseline-then-shrink); the per-lock rebuild count drops (free perf win — one grid, no rebuilds).

**Completion note (2026-07-13):** closed. External garbage and snapshot writes now pass through
`applyGarbage()` and `restoreBoardState()`; render synchronization is version-gated instead of
rebuilding the board every frame; and the shrink-only `board-write-sites` fitness ratchet holds at
17 sanctioned legacy sites. `markBoardDirty` is exported only by the canonical `board.js` module,
so `game.js` no longer provides a second mutation-surface alias.

### 5.2 Pure synchronous `resolveCascade` *(L)*
- **What:** extract `resolveCascade(boardGrid, lockContext) → {boardAfter, waves, holeMasks, scoreDelta, levelProgression, perfectClear}` from the 350-line async `processPhysics` while-loop; `physics.js` computes the full result first, then drives flash/gravity animation as a *replay of precomputed waves*. Adopt the stack-pop flood fill (the live `findConnectedComponents` uses `queue.shift()` — O(n²) confirmed at `physics.js:118`; matters on 1000-row Infinity boards) + scratch-buffer reuse.
- **What will fight back (measured, previously unstated):**
  - **`cascade-simulator.js` is a bot heuristic, not rules parity** — no level progression, no B2B/T-spin, no hole masks, heuristic scoring. "Model on it," never "reuse it." Budget explicitly for hole-mask parity (`movedArray` + `buildHoleMaskRows`, `physics.js:645-765`) — it is threaded through `applyGravity` and is the Quadra-critical garbage payload, competitive-visible.
  - **The animation-replay contract is a real deliverable, not an implementation detail:** `processPhysics` fires **18 distinct callbacks** (`triggerCombo`, `onLineClear`, `onScoreAdd`, `onLevelUp`, `onTSpin`/`onB2B`, flash stages, `onGravityStep`, `onCascadeComplete`, `onPerfectClear`, `onGarbageReady`, …). Write the schedule — which callback fires at which wave/sim-time with which payload — *before* extraction, and pin it with a characterization test; otherwise 60+ theme/juice consumers break unreviewably.
  - **Decision to make now, not defer:** score/level currently mutate *per wave inside the loop* and 30 Hz snapshots can capture mid-cascade values. Choose **commit-per-wave** (replaying waves mutates incrementally — recommended: preserves wire-visible timing) or commit-at-end (accept the snapshot-timing change and pin it with a test). Record as an ADR either way.
  - **The replay clock:** `waitForPhysicsDelay → advanceReplaySimulationClock` keeps `simTimeMs` honest across animation delays; the pure core must consume deterministic sim-time per wave or every existing demo's input timestamps misalign. Existing golden demos (`demo-replay-clock.test.js`, `ffa-demo-replay-determinism.test.js`) must stay green throughout — they are the abort tripwire.
- **Why (the player-facing KPI):** input primitives hard-return while `isProcessingPhysics`; a 4-wave cascade blocks input **330–400 ms** (70 ms × speed per wave + 16 ms per gravity step), >1 s on deep Infinity cascades; only 4 moves are buffered, drops are discarded. Pure resolution makes next-tick input possible, but the later replay/input-decoupling flip must stop async animation from holding `isProcessingPhysics` before it is achieved: **KPI = p95 input-to-sim-application during cascades, >300 ms → ≤ 16.7 ms.**
- **Validation:** golden-demo suite byte-identical before/after; hole-mask outputs equal the legacy path over the banked-log corpus; the 5.10 shadow diff clean over ≥50 sessions. **Abort:** if hole-mask parity can't be reproduced, stop and fix parity before any cutover — do not ship divergent garbage fairness.

**Groundwork note (2026-07-13):** `prepareResolvedPhysics(gameState)` now exposes the V2 resolver's
callback-free, non-mutating result synchronously, and `processPhysicsResolved` can replay that exact
prepared result without resolving twice. Process-local provenance rejects cloned, mutated, or stale
preparations before touching live state. The prepared/fused paths have equal full callback logs and
end state, while ADR-0011 per-wave commits and completion-before-spawn remain unchanged. This is the
branch point for later input/animation decoupling; it does not yet lower input-to-sim latency or
resolve the spawn-during-animation policy.

### 5.3 Fixed-tick simulation *(L)*
- **What:** a 60 Hz canonical tick (`simTickMs` = 16.667 — guideline DAS/ARR/lock-delay are natively 60 Hz-frame quantities; TETR.IO's engine is the same shape). `processAutoDrop` is already a real fixed-step accumulator; the un-quantized remainder is **five scattered accumulators**: DAS floats on the `InputController` singleton (`controls.js:123-155`, with live `window.settings` reads per call), lock-delay (`game.js:207-209`), hit-stop (decremented in *three* places), blind timers (two places), and `simFrame` itself (derived by rounding, not stepped). Convert all to integer tick counters in snapshotted state; ban float ms accumulators in sim state (fitness rule, 3d). Unify the delta-clamp policy (today: 100 ms in two places, unclamped in `updateGame`) into the runner. ADR-0012 applies the Quadra overload lesson without manufacturing un-simulated state: retain/catch up at most 300 ms, rebase and log excess wall-time debt, preserve contiguous tick IDs; sleep/background-tab resume clamps and never simulates the pause.
- **Subsumes:** the default-off `simTickNetcode` host accumulator (`ffa:374-377,455-476`) — fold it in rather than maintaining a parallel tick.
- **Electron nuance:** rAF throttles in occluded windows; online matches must keep simulating — drive the sim from the setTimeout path (`frame-rate-controller.js` already can), rAF is only the render trigger (this is also `UnifiedMultiplayerLoop.neverPause`'s job — see 5.5).
- **Validation:** the 5.9 multi-rate soak (same input stream at 30/60/144 fps + pause/resume → identical digests) becomes runnable and green.

**Groundwork note (2026-07-12):** `src/core/fixed-tick-clock.js` owns the pure canonical 60 Hz
scheduling math. It is time-conserving across floating-point boundary tolerance and proven at
30/60/144 Hz. `src/core/simulation-tick.js` owns the one-tick order: advance
`simFrame`/simulation time, decay blind timers, ingest input, reject commands during hit-stop,
consume exactly one hit-stop tick, then advance physics only when unfrozen. Structured
applied/deferred/rejected dispositions make the policy observable.

The first integer timer family is also dark and dual-clocked: lock delay owns `lockDelayTicks` /
`lockTimerTicks`, snapshots restore those fields with legacy-ms derivation, and the explicit
one-canonical-tick `processAutoDrop` path reaches the same tick-30 lock at 30/60/144 Hz. The legacy
millisecond path remains unchanged as rollback (including its characterized 30 Hz float-boundary
delay); the default-off FFA `fixedTick` adapter is now its first live consumer.

Hit-stop is now the second dark dual-clock family: `hitStopTicks` round-trips through demo
checkpoints with legacy-ms backfill, and `consumeFixedHitStopTick` quantizes direct 30/70/110 ms
producer writes to 2/5/7 complete frozen ticks. The shared tick pins FFA's policy: physical
hold/release state and DAS phase continue advancing, but gameplay commands are rejected through the
final frozen tick and accepted on the next tick. The live FFA authority boundary now enforces the
same rejection for delayed jitter-buffer packets and acknowledges deterministically consumed
sequences. The hit-stop preference is latched into `GameState` and replay headers so a local
reduced-motion setting cannot change replay or fixed online outcomes. Existing legacy loops still
consume `hitStopRemaining` until their flagged cutover.

Blind is the third dual-clock timer family: field and pending durations now retain their legacy-ms
wire fields while exact integer counters are snapshotted and restored. The fixed path reaches the
same expiry tick at 30/60/144 Hz, detects direct legacy writes before consuming a tick, and clears an
explicit `null` FFA blind snapshot instead of retaining stale state.

FFA is the first default-off consumer under the canonical `fixedTick` flag (with `simTickNetcode`
accepted only as a compatibility fallback). When enabled, `UnifiedMultiplayerLoop` gives host and
peers one recursive-timeout simulation owner; each callback passes monotonic elapsed time to
`runFfaFixedTicks`, the sole step/catch-up planner, while rAF performs render/stats only. Held input
advances once per canonical tick, and the host stamps `fixed60-v1`/`legacy-variable-v1` into match
configuration so peer-local flags cannot split the clock. Generation fences invalidate stale timer
and rAF callbacks across stop/restart, pause/resume, and live fixed/legacy ownership changes. The
same round/run ownership fence now applies within a catch-up callback and between boards, so a
synchronous top-out restart cannot carry an old-round tick, input finalization, accumulator debt,
peer flush, or host snapshot into the reset round. The cutover preserves the established online
lock-score rule. Host promotion deliberately rolls back to 30 Hz legacy timing and announces that
clock because migration snapshots do not yet contain complete continuation state. Match start,
migration, resync, and promotion all use one atomic clock transition that retargets live loop
ownership and clears accumulator/held-input timing.

Peer held-input actions generated on separate catch-up ticks now carry a canonical sim-tick/ordinal
stamp. The host maps the structurally validated stream onto a persistent per-peer host schedule, so
separate catch-up ticks and separate groups cannot collapse when several packets arrive in one host
turn. Old peers omit the fields and keep legacy scheduling.

One peer flush is now a bounded canonical group: the 264-command ceiling is derived from the
64-edge queue plus five catch-up ticks of worst-case left/right ARR and SDF. Wire packets remain at
the existing 20-command anti-spam cap, with stable group/chunk indices and a shared ordinal anchor;
the host exposes nothing to scheduling until every indexed chunk is present. Sequence continuity,
round generation, one sim tick per ordinal, the five-ordinal span, the shared 64-edge allowance,
and the 40-repeat-per-tick producer shape are validated atomically. The first observed sequence must
continue the host's last applied ACK; within a round, transport group IDs are strictly increasing (recovery
may skip retired IDs), command sequences remain contiguous, and sim-tick/ordinal gaps must agree. Each
accepted host-stamped round resets the input sequence, group
sequence, pending/history queues, ACK/progression maps, and jitter clock epoch as one round boundary
before new-round input ingress. Stale grouped traffic is rejected by generation before chunk
assembly, so a late partial cannot poison a reused group ID or dispatch legacy commands into the
fresh board.

Validated commands receive persistent host targets with a 32-tick future window. Complete groups
beyond that window stay in a FIFO (bounded at 256 groups and 4,096 commands) and drain on each host
fixed tick instead of being rejected and wedging exact continuity; bound overflow explicitly removes
the peer with `fixed_input_backpressure_overflow`. Incomplete, duplicated, oversized, or malformed
groups fail closed; exact replays are ignored, while a forward same-round sequence gap preserves the last
contiguous progress, clears queued later groups, and enters the exact input barrier for replay. Impossible
sim-tick/ordinal chronology and bounded-queue overflow still remove the peer. Phase 6A still owns direct
per-group delivery ACK/retry when a reliable group or restart control packet itself is lost. Only the
structural and progression brand bypasses the jitter-sensitive wall-arrival counter;
ungrouped/legacy traffic retains the 140-input limit. The
30/60/144 Hz instant-SDF harness and an exact five-tick/64-edge producer-maximum fixture pin the
packet and group bounds.

Host jitter-buffer frames are now taken once per canonical tick and their valid commands are
applied inside each board's input phase, after clock/blind advancement and before hit-stop/physics.
Every consumed disposition advances only the contiguous ACK prefix; malformed entries fail closed; and frame ownership
is finished exactly once even when a board tick throws. The cursor advances after local held ingress,
preserving the configured jitter depth and the legacy held-before-buffer order.

Fixed-tick zero-wave locks now finalize and spawn synchronously on the lock tick. The 30/60/144 Hz
harness proves identical lock/spawn ticks, board digest, piece queue/RNG cursor, drop phase, and
next-tick gravity. Variable-delta play remains on the Promise continuation, and any initial full row
still takes the certified async cascade replay, preserving ADR-0011's per-wave callback/commit order.
The spawning command is also an input-phase boundary: later same-tick commands reject before local
prediction or wire enqueue, so zero-interval soft-drop repeats cannot drive a newly spawned piece or
overflow the peer batch limit.

Composition tests run the real FFA planner and produce equal simulation-tick counts with 30/60/144 Hz
render callbacks. The overload policy now carries all debt through 300 ms across bounded callbacks;
only excess wall time emits `sim_clock_warp`, and tick IDs stay contiguous per ADR-0012. Packaged
Electron keeps timers active while occluded via
`backgroundThrottling: false`; ordinary browsers remain unproven.

A live peer that actually discards wall-time debt now requests exact host state after its retained ticks
finish, but only while the same round/run ownership remains current. The shared semantic request boundary
fails closed for spectators, dead/waiting/disconnected players, unresolved hosts, and every active
download/apply/input-barrier phase; transport and host cooldowns plus PREPARE reuse coalesce duplicates.
The authoritative host never imports peer truth or proactively emits an unpaced all-peer recovery burst
when its own wall clock rebases. Replicas that demonstrably diverge from a host rebase use the default-on
confirmed-digest path to request their own exact recovery.

Normal single-player is the second default-off `fixedTick` consumer. Its existing
`FrameRateController` is the only wall-clock owner; a mode-local helper plans canonical ticks and fences
the exact `GameState` plus session generation, while render remains decoupled. Player-0 keyboard and
gamepad use identity-guarded adapters over the shared GameState-owned input engine, with first-device
arbitration and pause/stop clearing. The flag-off standard and hybrid callback shapes remain pinned,
DemoPlayer never installs the adapter, and Local MP, `updateGame`, and the global legacy
loops are unchanged. Fixed recordings use rules version 2.1 and declare
`sim.simulationClock = fixed60-v1`; the current
legacy replay engine rejects them clearly rather than interpreting their tick-stamped commands under
variable-delta semantics. The local high-score table and Steam score/stat sinks are still unversioned,
so experimental fixed-clock sessions keep demo auto-save and an explicitly unranked session modal but
fail closed before writing or presenting those legacy result stores. Single-player stop/restart now owns
one immutable generation-stamped result bundle: replacement starts wait for physics/demo teardown, and
late score/proof/UI continuations cannot retarget a newer `GameState`. Legacy-clock sessions retain their
existing persistence and ranked-modal behavior; §5.8 must version the sinks before fixed results can
graduate into them.

Infinity is the third default-off `fixedTick` consumer. `FrameRateController` remains its sole wall-clock
owner, and the same generation-fenced single-board runner drains player-0 keyboard/gamepad input through
the GameState-owned engine. Fixed input calls the core movement functions directly; hard and soft drops
carry `{ fixedTick: true, inputPhase: true }`. The session latches deterministic board-anchor spawning,
per-player handling, reduced-motion hit-stop policy, and `fixed60-v1`; later settings, OS accessibility,
theme tier, flag teardown, or renderer interpolation cannot change those rules mid-session.

Fixed rendering is observer-only: it syncs the scene, presentation camera, minimap, and stats but never
computes top-row truth, expands the grid, or detects roof game-over. After each completed canonical tick,
`infinity-simulation-maintenance.js` performs those writes only when async physics is stable, then hands
`rowsAdded` to a presentation-only camera compensator before the one-shot roof transition. Stop retires
the timer/input owner synchronously before awaiting physics; restart/deactivation and every spawn,
game-over, exploration, delayed-camera, modal, and result continuation are fenced to the exact session.
The legacy BoardJuice `window.move`/`window.rotate` decoration now lives in an identity-owned UI adapter,
so restart cleanup cannot clobber a replacement owner and the core DOM-global ratchet shrinks.
The flag-off RAF/hybrid callbacks and ranked `legacy-variable-v1` behavior remain pinned. Fixed and unknown
clocks are explicitly unranked and fail closed before every local or Steam legacy sink until §5.8 versions
those stores. A real seeded zero-wave fixture composes board-anchor spawning, the runner, synchronous
fixed lock/spawn, and a 10-row maintenance expansion to the same canonical projection at 30/60/144 Hz.

Odyssey is the fourth default-off `fixedTick` consumer. The mode latches one simulation clock per
activation and copies it into every generation-fenced attempt, so retry cannot mix fixed and legacy rules.
Its existing `FrameRateController` is the sole fixed timer; player-0 keyboard/gamepad edges drain inside
`advanceTick`, fixed drops carry the canonical input-phase token, and fixed hit-stop no longer depends on
live settings or theme tiers. Render only synchronizes presentation. Canonical tick completion owns level
time, score/victory evaluation, and stable Infinity roof maintenance; attempt retirement synchronously
disposes the exact input/runtime owner before draining captured cascade physics.

Infinity/hybrid Odyssey levels use board-anchor spawning and reject Phaser-derived `cameraRow` writes.
Their deterministic virtual window includes authored starting garbage and bottom-anchors only its first
spawn; later spawns return to occupied-board derivation. This preserves the legacy first-spawn row for
0/6/16-row fixtures while removing renderer interpolation from simulation truth. Fixed and unknown
attempts show explicit experimental/unranked completion or failure messaging, but cannot write campaign
completion, unlocks, attempts, session playtime, local storage/cloud events, or Steam stats/leaderboards.
The flag-off HybridEngine call, RAF/hybrid callback shapes, campaign persistence, and Steam behavior remain
pinned. This adapter is infrastructure only: async cascade animation and victory-lap document input still
sit outside canonical tick ownership, so it is not Odyssey determinism certification or Phase 5.3 graduation.

Local Multiplayer is the fifth default-off consumer for the deliberately narrow standard, all-human
rules envelope. One shared match accumulator advances every eligible board in stable player-index order
under the existing `FrameRateController`; four independent catch-up planners are forbidden. Keyboard and
gamepad adapters claim exact per-player `GameState` identities, arbitrate the active device per player,
and drain the GameState-owned DAS/edge queues only inside that player's canonical tick. Fixed drops carry
the canonical input-phase token, hit-stop uses the match-latched policy, and render only synchronizes
boards and presentation stats. The match clock survives in-place round resets while each board clock and
the round-duration baseline restart. Fixed rate metrics use captured simulation time, excluding countdown,
pause, victory animation, and delayed teardown wall time.

Round replacement synchronously retires the exact timer/input owner, marks the captured boards stopped,
and drains their cascade promises before reset. Fixed top-outs queue until the full player barrier has
completed, then one stable batch applies deaths and evaluates the round/match outcome; simultaneous 2P
top-outs are a draw rather than an index-order victory. Occupied/refusing frame or input owners are never
stolen: startup atomically relatches every board to `legacy-variable-v1` and uses the extracted legacy RAF
loop. Bots, Hot Potato, time limits, and Infinity LMS likewise fall back as a whole because their current
truth still depends on unseeded randomness, wall time, or renderer-derived camera state. Flag-off DAS,
bot, blind, Infinity, Hot Potato, render, and callback behavior remains pinned.

This Local adapter is infrastructure, not determinism certification: seeds are not yet match artifacts,
animated cascade continuations are still asynchronous, unsupported rule variants remain on the legacy
loop, and §5.8 has not established a canonical Local result/artifact version.

This is not 5.3 graduation or the full input-unblock KPI. `fixedTick` remains default-off while
animated cascade completion and its deferred move/rotate replay run through animation promises and
timers outside the canonical tick. The FFA fixed clock fails closed to legacy when the jitter buffer is
disabled. Cascade animation/input decoupling, Local-MP variant migration, automatic
host-stall realignment under physical/browser background-resume behavior,
wall-time hot-potato/deadlines, complete migration continuation state, and legacy-loop collapse
remain open.

### 5.4 One DAS engine, per-player state *(M)*
- **What:** unify keyboard (`controls.js:111-173`) and gamepad (`gamepad-controller.js:1682-1755`) DAS into one `advanceDas(state, ticks, config)`. **Design constraints discovered:** DAS state must be **per-player, keyed into each `GameState`** (the singleton's `p2_*` slots belong to a different player's board in local MP); the singleton reduces to key→edge detection. Pick one config-propagation model (keyboard reads `window.settings` live; gamepad caches with explicit updates — cache + explicit update wins; live global reads violate the 3d boundary). Preserve the timer-clearing semantics on pause/resume/visibility — the four call sites: `pauseGame`/`resumeGame` clears (`game.js:1275-1277`, `game.js:1288-1291`), the `visibilitychange` clear (`controls.js:546-553`), and the resume clear at `main.js:4795-4796`. Per-player handling (DAS/ARR/SDF) becomes a **sim input** — into the match handshake and the replay header, TTRM-style.
- **Optional now, cheap forever:** capture input events with subframe timestamps (`{tick, subframe 0-9, key, down|up}`) — costs nothing, future-proofs handling feel and the artifact format.
- **Validation:** keyboard and pad produce identical repeat sequences for identical hold durations in a table test; local-MP mixed kbd/pad players advance on one clock.

**Groundwork note (2026-07-12):** `player-input-state.js` now owns handling config, branded
integer fixed-point DAS/SDF phase, and a bounded tick/subframe/sequence edge queue per `GameState`.
The 60 kHz integer phase clock preserves legacy 40 ms ARR's 2/2/3-tick cadence without float-ms
simulation accumulators. Overflow and malformed restore fail closed so a lost release cannot leave a
stuck hold; round reset preserves the GameState-owned object identity; demo checkpoints deep
capture/restore it while legacy checkpoints clear safely. Keyboard and gamepad implementations are
differentially pinned to the pure unit-generic engine, and the tick-native command/disposition log is
identical at 30/60/144 Hz render rates. `InputController` now exposes a fixed-tick keyboard edge
adapter with next-tick stamps, per-player routing, physical-key latching, overflow fail-closed
behavior, and cleanup/visibility/mode-swap clearing; it suppresses the singleton DAS whenever the
adapter claims a key. Online FFA now binds both P1 keyboard and gamepad edges while the host-stamped
fixed runner owns the match. The pad's render-rate poll only detects physical edges; held repeats
come from the same GameState-owned engine, while direct callbacks and the legacy pad DAS are
suppressed for the claimed slot. Edges drain in `advanceTick`, call `sendInput` exactly once,
preserve peer prediction and BoardJuice, and fail closed for spectators/dead/awaiting-spawn roster
entries. Releases retain their original owner across state/mode swaps; visibility, disconnect,
disable, teardown, and overflow clear without rearming a physically held control. Because the
canonical hold state is action-level rather than source-refcounted, the first keyboard/gamepad
action claims the match input device until a visibility/pause/lifecycle reset; the other device is
suppressed instead of being allowed to cancel the owner's hold. Handling config is match-latched
rather than reread from live UI settings. Demo v2 headers now declare accepted-command
input semantics and capture handling, while seek suppresses checkpoint DAS restoration to avoid
replaying repeats twice; unsupported rules/input/tick headers fail closed before mode startup. Still
Legacy keyboard and gamepad millisecond paths now also delegate to `core/das.js` without changing
their lifecycle or return contracts; a zero-baseline `das-algorithm-clones` fitness rule prevents
repeat arithmetic from returning to either UI controller. Local MP's default-off fixed path now
binds keyboard/gamepad adapters to each exact player state, arbitrates the active device per player,
and advances every player's repeats under one shared match clock. Still open: online
handshake/snapshot handling fields and physical keyboard/gamepad feel validation.

### 5.5 Collapse the loops *(M)*
- **What:** the real inventory is **five live sim-loop implementations plus two reachable legacy fallbacks** (recursive `gameLoop`; `FrameRateController` hybrid; `LocalMultiplayerMode`'s rAF **which bypasses `updateGame` and re-implements hit-stop/blind inline**; `UnifiedMultiplayerLoop`; `DemoPlayer`'s loop; plus `main.js:4804/4852` legacy loops — one of which double-advances DAS — reachable via the catch at `main.js:4329-4341`). Collapse onto one runner owning delta clamp, pause policy (carrying `neverPause` — the competitive-MP must-not-pause latch, `unified-game-loop.js:22-25`), hit-stop, blind timers, and catch-up. **Delete** the legacy `main.js` loops outright; retire `MAX_CONCURRENT_LOOPS`.
- **Exit criterion (sharper than "one runner"):** every mode advances through one `advanceTick` — the `updateGame`-bypass class (LMM :857, unified :206 call `processAutoDrop` directly, silently skipping anything added to `updateGame`, e.g. the DAS advance) is eliminated. Fitness rule: exactly one rAF sim driver under `src/core/**`.
- **Perf honesty:** negligible frame-time win — the payoff is the deleted bug classes (double-advance, divergent clamps, duplicate-rAF). Don't promise FPS here.

**Groundwork note (2026-07-13):** Local MP now cancels and generation-fences its rAF owner before
each start and on stop. The previously paused loop therefore cannot resume beside the new owner after
every round restart. Its asynchronous start sequence is separately generation-fenced across theme,
intro, loader, and countdown waits, so deactivation cannot later spawn pieces, reveal boards, play
countdown sounds, or start a stale loop. The extracted legacy loop remains the whole-match rollback
path, while the standard all-human rules envelope can run through one shared canonical accumulator
with exact timer/input ownership and stable same-tick top-out arbitration. The flag remains default-off;
unsupported Local variants, DemoPlayer, the mode-owned flag-off loops, and final one-runner deletion are
still open, so this is not §5.5 graduation.

The two reachable `main.js` error-fallback schedulers are now deleted rather than migrated. `startGame()`
activates and starts only through `GameModeManager`; a failed start never launches the old single-player
or two-player loop, and the manager best-effort stops the exact mode if it had already claimed running
ownership. The retired countdown, loop, and stats methods plus their imports removed 315 lines from
`main.js`; a source tripwire prevents that parallel family from returning. The shared core `gameLoop`,
DemoPlayer, Unified Multiplayer, and Local's extracted whole-match rollback remain live consumers and
must be converged separately.

### 5.6 PRNG + always-seeded starts *(M)*
- **What:** replace the 233,280-state LCG with **sfc32 (quality) or splitmix32 (simplicity)**, seeded via xmur3 from a ≥64-bit match seed, with **per-subsystem streams derived by label** (`xmur3(seed + ":pieces:" + playerId)`, `":garbage:" + playerId`, …) so one subsystem's draw count can never shift another's sequence — and a late joiner can reconstruct *their own* stream from (seed, playerId, drawCount) independent of everyone else.
- **Traps the old plan missed:** (a) **there are two LCG copies** — `seededRandom` (`utils/helpers.js:21-37`, has the `getState/setState` seam) and an inline clone in `ffa-p2p-game-state.js:2178-2185` *without* the seam; unify first or the swap misses the online path. (b) **Unseeded play exists**: `randomGenerator` defaults to `Math.random` (`game.js:379,498`) and seeds come from `Date.now()`/`Math.random()` in two modes — the 5.7 artifact is unverifiable for any unseeded match; make the constructor require a seed. (c) 7-bag draws must use high bits / rejection sampling, not modulo of low bits.
- **Checkpoints:** don't delete them — **demote to derived seek keyframes** (never authoritative). Pure-input replay makes "seek to minute 10" an O(full-resim) operation; checkpoints keep scrubbing O(300 frames) with the same trust win.
- **Validation:** bag-distribution χ² sanity; old v2 demos replay under a `rulesVersion` gate or are explicitly marked legacy (the RNG/bag algorithm is versioned separately — 5.8).

**Groundwork note (2026-07-13):** FFA seed ownership is now round-current and zero-safe. Explicit
host seeds (including `0`) survive start, peers reject missing seeds before adopting a generation,
and both host and peer publish the accepted restart seed before reset, ready-barrier deferral, or a
resync-visible download window. The reliable resync header therefore reports the accepted current
round seed rather than the stale prior-round seed; the sidecar remains the owner of the exact RNG
cursor. This intentionally leaves the LCG and all generated sequences unchanged; `rngV2`
cannot select a live algorithm until the choice is session-global and represented by the demo/sim-
version gates.

`session-rng.js` now owns strict uint32 seed normalization, crypto-first seed generation, the frozen
`{ algorithm: 'lcg-v1', seed, stream: 'pieces:shared-v1' }` session descriptor, and the one binder for
the existing LCG. Every new non-demo Single Player session binds before its first bag independently of
recording. Fixed-clock Infinity and Odyssey attempts do the same while their flag-off legacy paths stay
unchanged. Local Multiplayer's initial and round-reset paths now share one captured descriptor across
all player boards; reset clears both the descriptor and stale shared seed, and round ownership fences
descriptor replacement even though player objects are reused. Production-path 30/60/144 fixtures now
exercise this LCG seam rather than manually injecting the future sfc32 implementation. `rngV2` remains
dark: selecting sfc32 still waits for the §5.8 session-global algorithm/rules gate, and unseeded legacy
constructors/fallbacks are not yet §5.6 graduation.

### 5.7 Canonical match artifact *(M)*
- **What:** one frame-indexed artifact serving replay, netcode debugging, telemetry, and support (Quadra #2/#3/#9 as the model):
  - **Header = the join snapshot** (identical struct to Phase 6A.6's download-join payload — late join, demo playback, and reconnect become one code path): `simVersion` + rules-config hash, ≥64-bit seed, per-player handling settings, tick-0 state.
  - **Body:** per-player tick(+subframe)-stamped input events; host-stamped external events (garbage with hole masks + source, round transitions, joins/drops with reasons); **typed log events** (attacks, stamps, personal-best board snapshots, pauses) interleaved in the same schema — telemetry and replay are one file.
  - **Trailer:** periodic digests + a final summary digest that `npm run verify-replay <file>` re-simulates headless and checks, exit code = verdict, gated in CI over a golden corpus.
  - Record **at the host relay point** (the artifact is exactly what clients saw); fix the `das/arr` settings-capture bug (2.9) as part of the schema.
- **Validation:** the 3b decoder test; verify-replay green over the corpus; a support bundle (8.7) embeds the last artifact digest.

### 5.8 Sim-version gates *(M)*
- **What:** version rule-changing behavior separately from app version — attack scaling, garbage/crowding, level progression, scoring, RNG/bag algorithm — in a **central rules registry** (not `if (version>=23)` sprinkled through the sim, Quadra's admitted mistake). Old artifacts replay bit-exact forever; balance patches can't invalidate ranked evidence; "minimum version required by the configured rules" keeps mixed-version lobbies joinable when they don't use new semantics.
- **Validation:** golden rule fixtures (3b) keyed by simVersion; a v-old artifact verifies after a deliberate balance change on main.

**Groundwork note (2026-07-13):** demo v2 now carries a simulation-clock discriminator. New legacy
recordings stay on rules version 2.0 and stamp `legacy-variable-v1`; fixed single-player recordings use
rules version 2.1 and stamp `fixed60-v1`, and artifacts
without the additive field normalize to legacy for compatibility. DemoPlayer fails closed on fixed or
unknown clocks until the corresponding replay adapter exists. This prevents cross-clock misplay but is
only one header gate; the central rules registry and complete sim-version negotiation remain open.

### 5.9 Determinism test harness *(M)*
- **What:** (a) multi-rate soak — same input stream at 30/60/144 fps with pause/resume, cascade-heavy boards, assert identical (board digest, score, garbage sequence); (b) **save/restore identity** (the property rollback later depends on): `digest(restore(save(S))) === digest(S)` sampled across a fuzzed match — GGRS-synctest/Factorio-heavy-mode style; (c) the fast-check metamorphic property (3b) promoted to run against the fixed-tick sim; (d) `?heavyDeterminism=1` dev mode: per-tick full-state ring buffer, flushed on mismatch, plus a Node replay runner that re-simulates banked logs and binary-diffs the **first divergent tick** (Factorio's workflow).
- **New deliverable the 5→6 chain silently required:** a **compact binary savestate** usable at 60 Hz (the only serializer today is `structuredClone` of ~40 fields at 1/300 frames) — without it, Phase 6B's rollback/reconciliation claims are unfounded. Target: board rows packed uint16, piece/queue/RNG/garbage/score ints; measure ser/deser at ≤0.5 ms.
- **Validation:** all four harnesses green in CI; savestate benchmark recorded in §9.

### 5.10 Differential cutover gate *(M — runs during 5.2/5.6, not after)*
- **What:** drive legacy `processPhysics` and new `resolveCascade` — and old LCG vs new PRNG — from the same input stream in parallel; diff board digest, lines, wave count, hole masks on every lock. **Legacy-deletion gate (one definition, used by 5.0's ladder too):** ≥50 clean sessions total, of which ≥45 may be automated bot-soak matches (cascade-bot driving varied seeds/modes overnight) and **≥5 must be real human sessions** (they exercise input patterns bots don't) — solo-feasible in days, not weeks.
- **Concrete tap points:** pre-lock — clone `boardGrid` + `comboState` in `lockPiece` just before `processPhysics` (`game.js:1031-1035`); post — the completion `.then` (:1036-1049). **Constraints:** the legacy path is async — await `latestPhysicsPromise`, abort the sample if a restart/game-over interleaves; **garbage insertion mutates the board outside the lock path** (`insertPendingGarbage` ffa:1803-1869) — the shadow resolver must consume garbage as an input event or every MP diff false-positives; Infinity boards need incremental/extent-bounded digests.
- **Abort:** any unexplained diff class that survives triage reverts the flag; the legacy path is the rollback lever until deletion day.

### 5.11 Per-tick digest & desync telemetry *(M)*
- **What:** the production sibling of 5.9 (Factorio-tiered): (a) cheap digest computed locally **every tick** — board occupancy (rows packed uint16), piece {type,x,y,rot}, hold, bag cursor, **RNG state**, garbage queue, score/lines/level/combo/B2B, tick number; incremental fold for retired Infinity rows; (b) **4 bytes piggybacked on every 30 Hz snapshot** → detection latency ≤1 s, effectively free; (c) 4 component sub-digests (board / piece+RNG / garbage / score) sent only on mismatch so reports say *which subsystem* diverged; (d) ring buffer of the last ~64 ticks' digests — compare digest-at-tick-T against history, never "latest vs latest"; require 2–3 consecutive confirmed mismatches; pin theme-independence with a **two-theme digest-equality test** (same seed+inputs under two active themes → identical digests); (e) on confirmed divergence: log a desync report (both digests, recent input window, rules hash — the Factorio report shape), then **silently re-adopt the next host snapshot** (machinery exists); desyncs/match becomes the §9 KPI that gates each cutover-ladder stage.
- **Digest hygiene (decisions to make now):** explicit field-ordered binary writer (never `JSON.stringify`); no render/audio/interp state, no wall clock; **evict theme color from digestable state** — `resolveActiveTetrominoColor` reads `window.themeManager` *inside the sim* and bakes the color into locked pieces and garbage payloads (`game.js:24-46, 951-957`), so a color-inclusive digest desyncs across themed peers, and the import-based fitness check can't see it (it's a global read — the 3d `no-restricted-globals` rule can). Either exclude color from digests or (better) move color resolution out to the render observer.
- **Validation:** forced-divergence drill fires exactly one recovery; desync-report artifact captured; zero false positives over the two-machine soak.

**Exit criteria:** `(seed, inputs, external events)` → bit-identical board across rates and machines; replay is pure-input with derived seek keyframes; the artifact round-trips and verifies headless in CI; input is never blocked during cascades (KPI ≤ 1 tick); every mode advances through one `advanceTick`; the Phase 1 double-apply band-aid is subsumed; **no legacy sim/RNG path deleted until 5.10 is clean over the stated soak, and the flag + legacy path are deleted together.**

---

## Phase 6 — Networking: decomposition, trust, wire  *(L, ~4–6 weeks total, split)*

The god-class is 5,116 lines (unchanged since 07-01 — the freeze is holding; the 3d ratchet makes it mechanical). **Split into 6A (safe now) and 6B (requires Phase 5's tick)** — several old-plan rows violated the plan's own scope-freeze boundary by building reconciliation sophistication on the variable-delta base.

### Phase 6A — Decomposition & hardening *(can start after Phase 3a types; no dependency on Phase 5)*

#### 6A.1 Consolidate the MP roadmap + flag graduation bar *(S)*
Mark `ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md` as the tactical pre-phase in the 0.6 index; harvest or archive the other MP docs. Fix the graduation bar for every default-off flag (`simTickNetcode` — subsumed by 5.3, `adaptiveInputJitter`, `downloadJoin`, `migrationEpoch`, `readyBarrier`, `authoritativeAttacks` — moves to 6B, deterministic garbage): each graduates only when (a) the two-machine soak passes with it on, (b) snapshot-bytes p95 and reliable-message rate hold budget, (c) a pinning test covers it. Stating the bar per flag is what stops "decide later" becoming "default-off forever" — and to keep the bar solo-feasible, **one soak session validates a flag combination** (matrix), with the mock-transport harness as the exploratory tier beforehand (1.7).

> **Harvest note (2026-07-18):** executing `ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18.md` P0
> items 1–3 (host input bypass, synchronous RENDER_FRAME, wall-clock jitter cadence) on the
> live path; see `PLAN-mp-host-input-latency.md`.

#### 6A.2 Extraction, in dependency order *(L)*
- **Prerequisite:** characterization pins first — the 161-test MP suite constructs `FFAGameStateP2P` directly, so its public surface is preserved or tests are updated mechanically; snapshot the serialized event stream of a scripted 2-peer session as the golden master.
- **Target module layout** (measured cluster line ranges in the evidence report; every step is a pure move + constructor injection):

| Module | Pulls from (today's lines) | ~Size |
|---|---|---|
| `ui/multiplayer-countdown.js` — first UI extraction after its ownership contract is complete: `COUNTDOWN` reports numbers/GO only; remove or repair `main.js`'s dormant fallback writer, then inject one overlay lifecycle with prefix/open/fade/hide/completion semantics instead of importing UI from core | 4814–4955 | ~150 |
| `ffa/resync-coordinator.js` — chunked transfer, download-join fences, CRC32/base64 helpers | 63–124, 3193–3592 | ~500 |
| `ffa/network-handler-registry.js` — declarative `{type, role, handler}` table replacing `setupNetworkHandlers` (**31** supported registrations after dormant aliases and direct input IDs were removed) | 774–1250 | ~450 |
| `ffa/snapshot-codec.js` — build/apply/digest/change-detection (**only after 3a types cover the MP fields** — these are the drift sites) | 2291–2494, 2883–3192 | ~550 |
| `ffa/input-pipeline.js` — send/batch/jitter/apply/prediction | 1412–1802, 3869–3925 | ~450 |
| `ffa/garbage-system.js` — insert/counter/prediction/idempotent adopt | 1803–2046, 4140–4213 | ~350 |
| `ffa/round-lifecycle.js` — restart, ready-barrier, rematch, match start | 1252–1411, 2047–2192, 4577–4940 | ~650 |
| `ffa/roster.js` — players/spectators/kick/lobby | 485–773, 3593–3746 | ~440 |
| `ffa-p2p-game-state.js` (slim core) — flags, loops, host promotion, epochs, netDiag | remainder | ~700–800 |

- **House pattern to name:** *netcode emits facts on the bus; UI components own DOM; mode classes wire lifecycles* (the four `_registerEffectHandlers` bridges already follow it).
- **Validation:** MP suite + golden event stream green after every extraction commit; god-file ratchet strictly decreasing; exit = no networking file > ~800 lines.

**Groundwork note (2026-07-13):** the prerequisite golden now drives two real mock
`SteamNetworking` endpoints through a serialized FIFO wire and pins the 12-message, sole-HELLO,
WELCOME-first join → resync →
ready → start → input → binary-keyframe trace plus host net events. Countdown ownership is now
generation-fenced across superseding shows, hide, and cleanup, with exact timer/rAF timelines pinned;
the deferred-rAF off-by-one was fixed to emit `5,4,3,2,1,0,GO`. DOM extraction remains intentionally
open: the event lacks overlay lifecycle facts, `main.js` retains a dormant writer behind a nonexistent
mode constant, and the FFA animation names have no matching CSS keyframes. Treating this as a pure
move would freeze those contract gaps into the new component. Resync extraction has therefore advanced
independently: `ffa/resync-coordinator.js` now owns transfer defaults, byte/CRC/base64 framing, bounded
window fill, retry/final-ACK timeouts, ACK completion, receive assembly, and cleanup. Transport and
snapshot decode/hydration/application are injected; the old FFA methods remain thin compatibility
wrappers, while payload construction and live-state application stay in the class for the later snapshot
codec/lifecycle slices. Ten transfer characterizations pin retry counts, final-timeout timing, same-peer
coalescing, duplicate/out-of-order delivery, corruption rejection, peer binding, and the valid final-ACK
case where individual chunk ACKs were lost. The serialized golden remains exact, and the god class is
down to 4,728 physical lines after the adjacent request-authorization, download-fence, join-handshake,
and diagnostics slices. `ffa/net-diagnostics.js` now owns recursive event sanitization, occupied-cell
counting, stable rule hashing, and counter deltas behind the class's compatibility wrappers; the helper
is type-ratcheted and the god-file ceiling remains shrink-only. `ffa/join-handshake.js` now owns the
NET_HELLO/NET_WELCOME/JOIN_REJECTED handlers, with
protocol admission completed before any roster, spectator, or resync mutation.
`ffa/network-handler-registry.js` now owns the exact function identities of all 31 supported FFA wire
subscriptions; setup replacement and repeated cleanup are idempotent, two instances may safely share a
transport, and teardown returns the shared handler table to its prior baseline. The handler bodies still
live in the class, so the planned declarative move remains open even though its lifecycle seam is closed.

#### 6A.3 Default-deny protocol policy *(M)*
- **What:** replace the 11-type allowlist with a **complete protocol catalog in `message-types.js`** (already `@ts-check`ed): every wire value is supported with one or more exact `{sender, receiver}` routes or explicitly unsupported with a reason. Directional relay/request types enumerate tuples instead of using `any`, which would accidentally authorize peer→peer traffic. `_isSenderAllowedForMessage` drops undeclared, unsupported, and role-invalid messages against `hostSteamId`; keep `_verifyHostReassignment` as the stateful election exception for migration. Adopt Quadra #8's direction-typing (`c2h_*`/`h2p_*` naming) as types are touched. Count rejections per-type in `netDiag`. Note: envelope `matchId/matchNonce/hostSteamId` are **not** authentication (every lobby member learns them via NET_WELCOME); authenticity rests on the transport's Steam identity, and the mock transport's self-reported `from` is precisely what makes spoof *tests* possible.
- **Covers** the five 1.3 quick-fix holes structurally, plus host-side gaps (resync-request rate caps per peer).
- **Risks / validation:** over-tightening breaks migration/rejoin — land with the existing host-authority tests + per-hole spoof tests + a two-machine migration drill before default-on.

**Implementation note (2026-07-13):** all 48 measured wire values are now constants and catalog keys.
Thirty-seven are supported with exact route tuples; the three sequence-less direct input IDs, six
dormant declared IDs, and two legacy reassignment aliases are quarantined with reasons, and their unsafe
handlers were removed. `GAME_INPUT_BATCH` is the sole peer-command wire lane, so direct packets cannot
bypass its round, sequence, chronology, recovery-barrier, or bounded-group policy.
Inbound traffic, outbound sends/broadcasts, and handler registration all fail closed for unknown or
unsupported values; outbound sender roles are checked too. Directional relay tests pin peer→host and
host→peer while rejecting peer→peer/host→host. Host chat now derives Steam ID, name, and color from the
transport-bound roster entry before history/rebroadcast. Migration has the narrow peer CLAIM broadcast,
roster-seeded real-Steam fan-out, self-identifying successor SYNC envelope exception, election/epoch
verification, and old-authority resync retirement. Normal resync ACKs remain transfer/peer-bound, while
requests require a roster player or spectator and a per-peer cadence cap. Code implementation is closed;
the physical two-machine migration/rejoin drill remains the required release validation for this row.

#### 6A.4 Wire-envelope compaction *(M)* — **measured, and bigger than the old plan claimed**
- **Current cost:** the dominant 30 Hz delta packet is **44 B of binary payload riding 490 B on the wire — 11.1× overhead** (envelope 242 B of per-session constants + wrapper 188 B + base64 16 B); keyframes 2.4×. Plus a free CPU win: `_originalSize: JSON.stringify(data).length` (`steam-networking.js:494`) stringifies the **entire multi-player snapshot on every 30 Hz broadcast** for a debug stat — delete it.
- **What:** (1) move `matchId/matchNonce/hostSteamId/protocolVersion/envelopeVersion` to NET_HELLO/NET_WELCOME + re-announce on change (host migration already re-announces via `refreshMatchSession`); per-packet keeps `{t: typeId, c, s, ts}`; (2) fold `_gen/_migrationEpoch/_digest/_acks` into the binary format as a v8 header (versioned decode already exists); (3) send raw bytes — `steam:sendP2PPacket` already accepts a Buffer; only JSON forces base64. Result ≈ 60 B vs 490 B, **~8× reduction on the dominant packet**.
- **Sequencing constraint (from the risk review):** if any public build ships before this lands, compaction is a **breaking protocol change against live players** — 6A.5's version negotiation must land *first* in that world. Order inside 6A: 6A.5 → 6A.4.
- **Validation:** `getPacketStats()` snapshot-bytes p95 before/after against the §9 budget; **abort:** any increase in `deltaDecodeFailures` or `resyncRequestsSent` during a 2-peer soak.

**Groundwork note (2026-07-13):** the non-breaking observability/CPU cut is complete. The redundant
`_originalSize: JSON.stringify(data)` pass is gone. The Electron send boundary now serializes once and
returns the actual Buffer length; receive returns the physical packet length already known by Steam.
`getPacketStats()` therefore reports application-wire bytes rather than the inner binary body's size,
with separate delta, keyframe, and payload summaries so the 30 Hz delta KPI cannot be hidden by the
4 Hz reliable keyframes. The §9 budget is correspondingly named `snapshotDeltaWireBytesP95`. Protocol
1.0.0's JSON/base64 wire shape is unchanged.

The dark protocol-v2 frame codec is now implemented and recorded by ADR-0013. It wraps the exact
binary-v7 body with a bounded 28-byte header and one 4-byte acknowledgement per packed player; the
measured 44-byte/two-player delta is therefore exactly the 80-byte target. The codec rejects crossed
full/delta channels, non-v7 body magic/version, player/ACK disagreement, trailing bytes, and frames over
the Electron transport's 64 KiB cap.

**Dark cutover note (2026-07-13):** protocol 2.0.0 is now an advertised capability and an end-to-end
snapshot-only raw lane, selected once per lobby. Protocol 1.0.0 remains the byte-identical default and
rollback path; a host opts into v2 with `?wireV2=1` (or
`localStorage.setItem('serenity.wireV2', '1')`). JSON
snapshots in a v2 session and raw snapshots in a v1 session both fail closed. Electron and
BroadcastChannel preserve exact byte views; inbound frames rejoin the existing admission, nonce,
sender-role, replay, baseline, hydration, and dispatch pipeline. Focused real-style/mock parity tests
cover keyframe→delta, prior sessions, duplicates, malformed frames, wrong authority, migration, and the
≤80-byte two-player delta. Code implementation is complete behind the flag; the physical two-peer soak
and mixed-build migration/rejoin drill remain the graduation gate, with any increase in delta decode
failures or resync requests an abort.

#### 6A.5 Protocol version negotiation *(S–M)*
`protocolVersion` is a hard-equality string today — any change bricks cross-version lobbies with a bare `net:error`. NET_HELLO carries `[minVersion, maxVersion]`; host picks; `JOIN_REJECTED` gets a user-visible "update required" reason. The 6A.3 role table is keyed by protocol version.

**Implementation note (2026-07-13):** code implementation is closed. NET_HELLO carries a strict
numeric min/max offer while retaining the legacy exact field; the host selects the highest common
version allowed by its configured floor and pins that version for the whole lobby. The catalog is keyed
by selected protocol version, and both transport ingress and egress remain bootstrap-only until the peer
is admitted. This is deliberately one session codec and snapshot contract, not a per-peer hybrid, so host
migration preserves the selected version and seeds only the accepted roster. The gameplay envelope is
still exact version 1: min/max envelope fields declare compatibility but cross-envelope negotiation stays
closed until there is an explicit session-envelope codec switch.

WELCOME is sent reliably before roster/resync side effects and echoes a per-attempt nonce. Peers validate
the selection, envelope, host/session identity, and attempt nonce before adopting session state; malformed
offers, incompatible joins, and disconnected incompatible rejoins cannot mutate the roster or resync
queues. Terminal WELCOME/JOIN_REJECTED pairs deduplicate into one locally-authored, user-visible update
message. Focused range, replay, identity, ordering, rejoin, migration, and teardown tests pin the contract.
The physical mixed-build two-machine rejoin/migration drill remains the required release validation.

#### 6A.6 Join/resync lifecycle state machine *(M)*
- **What:** the peer join path is a tangle of implicit flags (`handshakeComplete`, `downloadJoinInProgress`, `_pendingRoundStart`, `awaitingSpawn`, host-side `downloadJoinPeers`/`pendingResyncs`). Replace with one explicit `joinState: hello → welcomed → downloading → applying → live` enum with per-transition net-events. Make the syncpoint real: today `_computeSyncpoint` returns only `'download'|'busy'|'idle'`; redefine as (simTick, roundGeneration, no-active-cascade, no-partially-applied packet stack) — Quadra #4/#12: snapshots are sent only from the idle window, reseeds only inside barriers, and the barrier's idle state is the only join window. Use Quadra's join-snapshot field checklist (grids, **RNG cursor**, piece pipeline, pending garbage with hole masks, attack-credit table, stats) as the schema audit.
- **Validation:** state-machine transition tests; a join during an active cascade is deferred to the next idle window (test with the impairment harness).

**Implementation note (2026-07-13):** the peer lifecycle and exact live-recovery slices are live.
`handshakeComplete` is now a
compatibility getter derived from the explicit lifecycle; WELCOME, download, apply, recovery, timeout,
migration, rejection, promotion, and cleanup advance one transition table and emit `join_state_transition`.
Join/resync capture now recomputes a structured `(status, simTick, roundGeneration, blockers)` marker at
send time, fences active physics and nested packet application, and drains a queued join immediately after
the packet stack reaches zero. The old string syncpoint remains on the wire for v1 peers while the tuple is
carried alongside it. Reliable resyncs now add a strictly validated `serenity.ffa-resync` v1 sidecar without
changing the 30 Hz binary-v7 body: it preserves exact clustered pieces, active-piece rotation, the full game
clock/lock/input state, RNG algorithm + cursor (including seed zero), garbage provenance, attack credit,
wrapper sequence fences, and attack/frag histories. Capture is double-fenced across `(simTick,
roundGeneration, snapshotSeq, hostTick, migrationEpoch)` and every capture advances `snapshotSeq`, so
same-tick captures remain uniquely ordered. An unknown or torn sidecar is rejected before the
incoming baseline or live state can mutate. Sidecar-free `binary-v1` remains an observable recovery-only
fallback for mixed old/new builds until the sim-version gate can require the schema.

Live-player recovery now runs a request-bound `PREPARE → READY → capture/apply` input barrier. The peer
freezes before restaging and flushing retained commands; the host waits for a **contiguous** authoritative
input ACK and an idle syncpoint; the payload echoes the fence/ACK tuple; and the peer preflights the exact
sidecar before pruning history and unfreezing. The host owns a request-fenced retry timer until READY,
retransmitting the identical PREPARE every 500 ms and retiring it exactly at the five-second deadline;
duplicate PREPARE/READY traffic is idempotent and a lost READY is retried without changing the fence.
Handshake and completion have separate 5 s/20 s deadlines, cleared timer callbacks cannot own a replacement,
and timeout/restart/disconnect/request replacement retire stale queues and transfers. Recovery replay safely
trims already-received prefixes in both legacy and fixed-tick paths, with fixed recovery history split into
canonical five-tick groups. Inbound assembly is bounded, exact apply waits for receiver idle, monotonic
capture fences reject duplicate/older state, and final ACK forces the next gameplay keyframe. Terminal
assembly/decode/sidecar/apply failures now return an idempotent closed-reason rejection rather than leaving
the peer frozen behind retransmitted bad bytes. The host accepts only an exclusive request/chunk/final/NACK
variant bound to the active transfer and sender, retires its exact timer/barrier, and permits at most two
fresh captures with new live-player tokens before failing the peer closed. Success, restart, and disconnect
reset the per-peer budget; stale callbacks and stale/ambiguous ACK variants cannot retire a newer transfer.
Forward canonical input gaps preserve the last contiguous host ACK and enter this same exact-replay barrier;
impossible clock/ordinal chronology remains fatal. Open in this item: host-side per-peer lifecycle ownership
and distributing a canonical idle sidecar so a newly elected host can serve exact resyncs.

#### 6A.7 Host liveness & operational guardrails *(M)*
Refresh host-liveness from **any authoritative host packet** (or prove heartbeat-only under two-machine loss); bind liveness/election-cancel to `msg.from === hostSteamId` (closes the 1.3 hole structurally); add gone-slot reaping, per-peer resync-request caps, a send-queue byte cap with a disconnect policy (Quadra's 256 KiB precedent), and — new — a **statistical outlier gate** (APM/PPM ceiling warning-then-flag) as a complement to per-event validation. Re-enable the InputValidator per-input interval check; implement kick-after-N-violations (TODO at ffa:1575).

#### 6A.8 Backpressure × resync arbitration *(M)*
Resync chunks (16 KB × window 4) go reliable-immediate, bypassing `_queueSnapshot`'s pacing entirely; nothing arbitrates the steamworks.js single physical queue between a 64 KB resync burst, 4/s keyframes, and control messages. Route resync sends through a paced sender with a bytes-per-tick budget; gauge reliable-bytes-in-flight; rule: control/lock/restart can never be starved by resync. (If resync bursts still hitch the main thread, that — not the sim — is the worker-offload revisit trigger recorded in the 0.6 ADR.)

#### 6A.9 Decoder fuzzing *(S)*
1,341 lines of hand-rolled binary decode parsing untrusted P2P input is the textbook fuzz target. The 3b fast-check adversarial property, extended: seeded byte-mutation corpus over `decodeSnapshot`/`decodeDeltaSnapshot`/`peekDeltaBaselineTick` — throws or returns well-formed, never hangs, never allocates unbounded. ~Half a day in Vitest.

### Phase 6B — Determinism-dependent netcode *(requires Phase 5 landed)*

| Item | What / why | Effort |
|---|---|---|
| 6B.1 Host-derived attack authority | `authoritativeAttacks` graduates: peer attack summaries become prediction hints; the host derives canonical attack/garbage events from its authoritative replica, with the artifact as evidence per clear/send/cancel/top-out. Adopt Quadra #5's plausibility firewall: validate every lock event against the replica ("collides-or-floats"), log `desync_or_cheat` with both digests, quarantine on repeat. | L |
| 6B.2 Attack-causality ledger | Quadra #6: per-victim decaying credit table for kill/assist attribution — deterministic, replays cleanly, survives drop/rejoin (do **not** flush on disconnect), ships in the join snapshot. Feeds battle log, badges, elimination modes. | M |
| 6B.3 Input-stream remote boards | Remote boards re-simulated from input streams (closed deterministic sims per player); snapshots demoted to join/recovery/spectator. Never couple the local piece loop to network acks (the Puyo-Puyo-Tetris trap). Late garbage handled by host-stamped activation ≥2 ticks ahead (AoE-style scheduling — likely sufficient) before considering any rollback window. **Entry deliverable:** this is an L-sized transform that needs its own design ADR when Phase 5 lands, covering: the remote-sim instance model (N sims × cascade cost, degrade-to-snapshot policy for off-screen boards), late-input buffering policy (~2-tick delay per §5 research), and the reconciliation rule when the input stream and a recovery snapshot disagree. | L |
| 6B.4 Interest management | Quadra #7: high-rate streams only to peers actually rendering that board (thumbnails don't need 30 Hz fidelity); capability flags in the handshake. Bandwidth budget win at 6–8 players. | M |
| 6B.5 Opponent piece wire semantics | Include rotation + spawn/lock identity in significant-change detection; decide binary-decode `shape` vs renderer-owned `rotation` as canonical — **lean: wire carries `{type, rotationIndex}` and the renderer derives the shape** (smaller wire, one rotation source of truth, matches the SRS tables already in core); pin with a binary/interpolator/watch-board test. | S–M |

**Exit criteria (6A):** no networking file > ~800 lines; every message type has a declared role and unlisted types are dropped; join/resync is an explicit state machine snapshotting only at idle syncpoints; delta overhead ≤ ~1.5× (measured 11.1× today); version negotiation exists; the MP suite + two-machine checklist stay green. **(6B):** attacks are host-derived with artifact evidence; remote boards are input-stream-driven; results carry an explicit trust label (§8.6).

---

## Phase 7 — Render-path unification: retire the dual-maintenance GLSL twins  *(L, ongoing)*

**Reframed 2026-07-02 — the old premise was wrong.** The 19 dual-state themes are not "surviving via silent WebGL2 fallback": all 19 are deliberately backend-gated dual-path themes whose **TSL versions already exist and are the live path on WebGPU hardware** (explicit `isWebGPU` ternaries; `*MaterialWebGL` factory names; 17/19 construct their own fallback `WebGLRenderer`). The debt is **dual maintenance** — every visual tweak must be made twice or the backends drift — not fragility. The work is *retiring the GLSL branch*, using the same TSL graph on `WebGPURenderer`'s WebGL2 backend (`forceWebGL`) as the fallback, exactly as Odyssey already does.
**Depends on:** Phase 3c (tripwire + GPU gate). **Parallelizable** with Phases 5–6. One theme per session (TDR constraint).

### 7.1 Scope and definition of done *(S)*
- Descope as permanent WebGL: `renderer.js` (WebGL1 background), `WarpTransitionRenderer.js`, **and the four UI-effect files the old plan never dispositioned** (`threejs-intro-renderer.js`, `CosmicExplorationEffect.js`, `CosmicParticleSystem.js`, `threejs-breathing-renderer.js`) — without this disposition, the "allowlist shrinks to the documented permanent set" exit criterion is unmeasurable. Record in the ADR + tripwire allowlist.
- **Done =** every theme that constructs a `WebGPURenderer` renders NodeMaterials only, on both backends, with the GLSL twins deleted.

### 7.2 Retire the 19 GLSL twins *(L)*
- **Recipe (worked example ice-temple, 4 GLSL materials):** (1) playground: verify each effect renders identically under `?forceWebGL=1` using the *TSL* builders; (2) delete the `isWebGL` branch selecting `create*MaterialWebGL` and the explicit fallback `WebGLRenderer` construction — always construct `WebGPURenderer` (honoring `forceWebGL`); (3) delete the local `setupRendererResilience` override so the 4.2 base-class path takes over (ships the device-loss fix in the same session); (4) delete the `*WebGL` factories; (5) validate: phase-locked screenshots both backends, live A/B at Extreme with `effectScale` forced to 1 (the MCP throttles below 0.64 — unforced A/Bs are invalid), console clean.
- **Batch order (by GLSL material count, smallest first; Camp-2 themes early so each session ships both fixes):** fluid-dreams 2 → ice-temple 4 → moonlit-forest 4 → stellar-velocity 4 → stellar-drift 5 → chiral-gold 5 → electric-dreams 6 → synthwave-sunset 6 → chromadelic-highway 7 → black-hole 8 → astral-weave 8 → cosmic-noir 9 → wolfhour 15 → neon-district 15 → lunara 16 → neon-dusk 16 → ocean 20 → winter 21 → swedish-forest 27.
- **Abort per theme:** if the TSL-on-WebGL2 render visibly diverges from the retired GLSL and can't be matched in one session, keep that theme on the tripwire allowlist as an explicit, reviewed state — never ship a visual regression to close a checklist.

### 7.3 The 21 WebGL-only themes: an explicit decision, not an implied port *(decision S; work opt-in)*
These (~176 ShaderMaterials: misty-lake 22, stillwater 17, pyrestorm 16, …) never construct a WebGPURenderer — they already satisfy the definition of done and are **not** blocking anything. Porting them is the single largest work item in the old plan with no stated outcome. **Default: leave them as documented WebGL islands** (they render correctly through three's WebGL path). Opt a theme in only with a stated per-theme justification (wants compute/TSL features, MRT bloom, or visual-parity work already planned). Record the default as an ADR.

### 7.4 The renderer/theme contract *(M)*
Make explicit in docs + fitness checks: device-loss registration via the base class (4.2); disposal ownership **including compute/storage pipelines** (the ice-temple/stellar-drift pattern allocates GPU buffers `disposeThreeJSGroup` can't see — LRU eviction leaks them unless `stop()` disposes; add "compute buffers disposed on stop" to the theme-lifecycle audit); pixel-ratio routed through `computeScenePixelRatio`; `shouldRenderFrame` background gate honored (conversions that reconstruct a renderer without it re-open the 2026-07 perf fixes); screenshot artifact convention `artifacts/themes/<id>/{webgpu,webgl2}.png`; reduced-motion behavior.

**Exit criteria:** tripwire allowlist shrinks monotonically to the documented permanent set; every converted theme has both-backend screenshot artifacts; `?forceWebGL=1` renders every converted theme correctly; zero dual-maintained GLSL/TSL twins remain.

---

# MOVEMENT D — Launch

## Phase 8 — Ship polish & launch checklist  *(M)*

**Goal:** everything between "the engine is healthy" and "a Steam customer has a good first run." Can start as soon as Movement A is complete.

**External inputs required from the owner (not derivable from the repo — gather early, some have lead time):** the real Steam AppID + a Steamworks builder account for depot upload (1.1, 8.8); the code-signing decision + purchase (legal-entity status determines Azure Trusted Signing eligibility; days–weeks lead, 8.1); a Sentry org/DSN in the EU region (8.5); the store-page privacy text sign-off (8.6).

### 8.1 Code signing *(S decision, days–weeks lead time)*
- **What:** wire signing into electron-builder (`win.signtoolOptions` scaffold exists; no cert). Options: **Azure Trusted Signing** (~$10/mo, `win.azureSignOptions`, requires an established legal entity — the cheap modern path if operating as an EU-registered org) or an OV cloud-signing cert. EV no longer buys instant SmartScreen bypass; reputation accrues per-cert, so **sign the first public build** — order the cert weeks before ship day. Populate the empty `author` field (`package.json:117`).
- **Validation:** signed installer passes SmartScreen check on a clean VM; ship checklist asserts signature.

### 8.2 Media packaging & installer diet *(M)*
- **What (measured: music = 257 MB of 36 MP3s inside a 646 MiB app.asar; installer 597 MiB):** (1) transcode masters → **Opus/Ogg 96–128 kbps VBR** (~257 → 60–80 MB; the intro `.ogg` files already prove Ogg playback works in-app); (2) `asarUnpack: ["dist/assets/music/**"]` (or `extraResources`) so updates stop rewriting a monolith and SteamPipe deltas work per-track; (3) keep native-module `extraResources` filters tight (verified tight today); (4) **decide the updater story: Steam owns updates** — strip `app-update.yml`/`latest.yml` from the depot content and do not initialize electron-updater in Steam builds; NSIS remains for a non-Steam channel only.
- **Risks:** the Electron absolute-path trap already bit once (music manifest) — success = packaged smoke test plays music from the new location; abort = any moved-asset fetch 404s in `win-unpacked`.
- **Validation:** §9 budgets: installer ≤ 450 MB, app.asar ≤ 250 MiB (baselines committed: 625,923,068 B / 677,591,834 B).

### 8.3 Boot KPI thresholds *(S)*
After 4.7's decomposition: set the §9 budget on `timeToMenuReadyMs` (real KPI) and track `introDurationMs` separately as a product choice. Include the intro-renderer import timing in the startup report. The `startup-debug.js` ring buffer is the capture instrument.

### 8.4 IPC hardening *(S–M)*
Replace the generic `electronAPI.invoke` pass-through (`preload.cjs:100`) with named wrappers; validate `steam:cloud*` filenames at the `ipcMain.handle` boundary (`^[A-Za-z0-9._-]{1,64}$`, reject path separators — `steam-integration.js:819-871` passes them unvalidated today); add Electron Fuses in afterPack (`runAsNode` off, `nodeCliInspect` off, asar integrity on); keep CSP tests green while tightening inline-style sinks (`nameColor`); **ship checklist asserts `SERENITY_DISABLE_CSP` is unset** (the escape hatch at `electron/main.js:364` the old plan never mentioned).

### 8.5 Crash reporting *(S–M)*
- **What:** nothing exists today. Recommended: **Sentry Electron SDK, EU data region, opt-in consent dialog on first run** (developer is in Sweden — GDPR posture: opt-in, `beforeSend` scrubbing, release = build id). Note the CSP interaction: Sentry needs a `connect-src` addition in `content-security-policy.js` — coordinate with the CSP test. The 8.7 support bundle is the fallback signal, not the primary one; a bad first run must be observed, not silently lost.
- **Validation:** a test crash in a packaged build arrives with build id + scrubbed payload; consent-off sends nothing.

### 8.6 Privacy & trust labels *(S)*
Publish a short privacy/networking note (Steam P2P identity exchange, match logs, crash reports, Steam Cloud, any update check — background checks never block first-run). Define release-channel trust labels in product + docs: **casual/private P2P ships after Movements A+D; ranked/verified requires the Phase 5 artifact + Phase 6B host-derived authority + replay verification.** Results carry the label explicitly (Quadra's honesty: replay verification proves self-consistency; only a trusted re-run proves it to others).

### 8.7 Support bundle *(M)*
One-click export: build id, settings, GPU/driver info, recent `netDiag`, **GPU-loss counters (4.2)**, last match-artifact digest (5.7), `startup-debug` trace, release-gate results, sanitized logs. The Quadra decoder-ring lesson: one documented schema shared by telemetry, replay, and support.

### 8.8 Steam depot pipeline + ship checklist *(S–M)*
- **What:** `scripts/` gets an `app_build.vdf`/`depot_build.vdf` pair pointing at `release/win-unpacked/`, driven by `steamcmd +login <builder> +run_app_build`, uploading to a **beta branch** first. The release workflow asserts: release gates passed (`SERENITY_RELEASE=1`), artifact contains **no `steam_appid.txt`**, no `latest.yml`/`app-update.yml`, signature valid, budgets green.
- **Ship checklist (documented, in order):** typecheck/test/lint green → `SERENITY_RELEASE=1 npm run check:release-gates` → build + sign → afterPack asserts (AppID stripped, fuses set) → depot upload to beta → **two-machine Steam validation run (1.7) on the beta build** → budgets check (§9) → promote to default branch → version bump + tag → post-release smoke on a clean machine.

**Exit criteria:** a signed installer with the real AppID, ≤ 450 MB, no updater conflict with Steam, a measured decomposed cold-boot KPI, crash reporting with EU-compliant consent, an explicit trust label, and a repeatable scripted release procedure.

---

## 9. Performance architecture (cross-cutting)

The user-facing goal of this plan is a *faster, smoother* game, not only a cleaner one. This section is the single source of truth the phases hang their numbers on.

### 9.1 Principles
- **Budget in milliseconds of frame time, not FPS** — percentiles over frames: gate on **p95**, dashboard p99 (p99 needs thousands of frames to be stable). Never mix "P99 FPS" and "p99 frame-time" domains.
- **Split CPU vs GPU:** CPU from rAF deltas; GPU from three's timestamp queries (`trackTimestamp: true` + `renderer.resolveTimestampsAsync(RENDER|COMPUTE)`).
- **Pin the adaptive systems while measuring** (already learned the hard way: DRS and `effectScale` throttling mask regressions — force tier + `effectScale=1` + fixed pixelRatio in every capture).
- **One budget table feeds both the CI gates and the runtime DRS** so the gate and the shock absorber can't disagree.
- **Relative benchmarking only on hosted runners** (variance swamps <50 % deltas); real thresholds live on the self-hosted RTX lane.

### 9.2 Budget file — `perf-budgets.json` (schema)
```json
{ "capturedAt": "2026-07-XX", "machine": "RTX5080-laptop | dev-iGPU (noted per row)",
  "budgets": {
    "timeToMenuReadyMs":        { "baseline": null, "max": 4000 },
    "introDurationMs":          { "baseline": null, "max": null, "note": "product choice, tracked not gated" },
    "cascadeInputLatencyP95Ms": { "baseline": 300,  "max": 17,   "note": "Phase 5.2 KPI" },
    "frameP95Ms": { "perSurface": { "odyssey": null, "heavy-theme-worst": null },
                    "maxPerTier": { "60hz": 16.6, "120hz": 8.3, "144hz": 6.9 },
                    "split": { "cpuMaxMs": 6, "gpuMaxMs": 9, "note": "60hz split; scale proportionally" } },
    "snapshotDeltaWireBytesP95": { "baseline": 490,  "max": 80 },
    "reliableMsgsPerSec":       { "baseline": null, "max": null },
    "busEventsPerSec":          { "baseline": null, "max": null },
    "desyncsPerMatch":          { "baseline": null, "max": 0 },
    "gpuLossRecoveredRatio":    { "baseline": null, "min": null },
    "savestateSerializeMs":     { "baseline": null, "max": 0.5 },
    "installerBytes":           { "baseline": 625923068, "max": 450000000 },
    "appAsarBytes":             { "baseline": 677591834, "max": 262144000 } } }
```
Nulls mean "budget declared, baseline pending" — visible and lintable, never silently unfalsifiable. Capture protocol per row: boot metrics from the `startup-debug` trace under `SERENITY_ENABLE_LOGGING=1`; wire metrics from `getPacketStats()`/`netDiag` in a scripted 2-peer soak; frame metrics from a `?perf=1` scripted 20-second loop (spawn pieces, combo storm, theme transition) emitting `{p50,p95,p99,gpuRender,gpuCompute,drawCalls}`; sizes from the release build.

### 9.3 Three test lanes
1. **PR lane (hosted CI, SwiftShader/lavapipe):** correctness only — WGSL compile, console errors, golden screenshots with tolerance, leak assertions. **No timing gates** (software-rasterizer timings are meaningless).
2. **Nightly lane (self-hosted RTX runner, real window, pinned tier/resolution/DRS-off):** perf harness across a rotating theme subset + Odyssey scroll; alert at p95 > budget × 1.25 for the calibration weeks, then gate.
3. **Release lane:** full theme sweep + Odyssey + the 2-peer wire soak + budget file check, ship-gate style. Manual TDR-sensitive desktop captures stay per-chapter/short-session (hardware constraint).

### 9.4 Phase → player-visible outcome traceability
| Phase | Outcome | Metric |
|---|---|---|
| 0–1 | No more silently-broken safety nets; releases can't ship Spacewar | CI green; gates fire |
| 4.1/4.4 | No F11/resize freezes; MP event storms bounded | resize `setSize` count; busEventsPerSec |
| 4.2 | Frozen-canvas states become recoveries | gpuLossRecoveredRatio |
| 4.3 | 4-player local MP stops context-thrashing | GL context count 6→≤3 |
| 4.7/8.3 | Menu interactive seconds earlier on the branded path | timeToMenuReadyMs |
| 5.2 | Input never dies during cascades | cascadeInputLatencyP95Ms >300→≤17 |
| 5.5/5.3 | One clamp/pause policy; background tabs stop burning CPU | soak digests identical across rates |
| 5.11/1.2 | "Garbage feels off" bugs become detected+auto-recovered events | desyncsPerMatch |
| 6A.4 | 8× less snapshot bandwidth; no per-broadcast JSON stringify of the world | snapshotDeltaWireBytesP95 490→≤80 |
| 6A.8 | Resyncs can't starve control messages | reliable-in-flight gauge |
| 6B.3/6B.4 | Smooth opponent boards at any latency; 6–8-player bandwidth bounded | interp error; bytes/peer |
| 7 | Single-codebase visuals; conversions can't re-open closed perf bugs | tripwire + per-theme p95 |
| 8.2 | Smaller download, delta-friendly updates | installerBytes/appAsarBytes |

### 9.5 Allocation & GC discipline *(new)*
The per-theme perf campaigns keep finding the same classes: per-frame `THREE.Color`/vector allocation, per-frame array churn, `queue.shift()` patterns. Codify: scratch-object reuse in per-frame paths; the 5.2 resolver allocates once per lock, not per wave; add a leak gate to the PR lane (jsdom heap snapshot across 60 theme activate/deactivate cycles — the theme-manager LRU already exposes the hook) and keep the "no per-frame allocations in hot loops" rule in review checklists + the `simplify` pass. GC pauses show up as p95/p99 tail — the nightly lane is the detector.

**VRAM residency is crash prevention, not just perf:** on iGPUs, VRAM exhaustion *is* device loss (the frozen-canvas class 4.2 recovers from). The theme-manager LRU already frees GPU memory on eviction — extend it to (a) count compute/storage buffers (7.4's disposal contract feeds this), (b) expose a VRAM-proxy gauge (`renderer.info` textures/geometries) in the perf harness, and (c) treat "evictions while a theme is active" as a §9 alert, since that is the pressure state that precedes a loss.

---

## 10. Sequencing notes & options

- **Fastest path to a first multiplayer release:** Phase 0 (green CI + gates) → Phase 1 (all seven items — note 1.2–1.5 are new blockers found by re-measurement, not optional) → the small remaining Phase 2 rows → the 1.7 two-machine run → Phase 8. Movements B/C remain the health investment.
- **If shipping before Phase 6A lands:** 6A.5 (version negotiation) becomes a pre-ship item — otherwise the first wire change after launch (6A.4 compaction) breaks every live player with a bare `net:error`.
- **If you can only do one large refactor, do Phase 5** — it subsumes a Phase 1 band-aid, unlocks 6B, fixes replay trust, and deletes the largest measured input-latency defect.
- **Phase 4.6 vs 5.5:** deliberately partitioned — 4.6 owns mode lifecycle + event emission, 5.5 owns loop scheduling. Don't let either creep into the other's surface; that's the double-refactor trap.
- **Scope-freeze boundary (now mechanical):** stabilization and casual-P2P features may proceed; reconciliation/rollback/authoritative-attack sophistication waits for Phase 5's tick (that work would be rebuilt). Enforced by the 3d god-file line ratchet — the markdown-only version of this rule already failed once (+560 lines while "frozen").
- **Band-aid → structural links (leave the code comments in place):** host double-apply → 5.3 tick-boundary input (comment exists, verified); `_verifyHostReassignment` allowlist → 6A.3 default-deny (comment exists); 1.3 sender checks → 6A.3 role table; 1.2 desync enable → 5.11 digest program.
- **Uncommitted work rule:** the ~730-line boot-reliability WIP (4 modified + 3 new files) is the de-facto Phase 4.7 baseline — land it with its tests before starting 4.7 proper. Never start a Movement C phase with uncommitted WIP in its blast radius.
- **Quadra's meta-lesson:** replay, stats, desync reports, late-join validation, and support artifacts should be one documented frame-indexed artifact (5.7), not five logging formats.
- **The bar stays:** any architecture rule that matters twice becomes a type, test, fitness check, budget, artifact, or release gate. This document is the map, not the control.

## 11. Verification & source appendix

**Working-tree measurements** in this document were taken 2026-07-02→04 on branch `cleanup/repository-files` by direct measurement (`git ls-files --eol`, full ESLint JSON run, full Vitest run, `npm audit`, `du`, envelope byte-measurement via the real `BinaryEncoder`, and file reads of every config cited). Line references will drift as the tree moves — re-verify before executing an item whose stamp is stale.

**Primary sources** are linked inline in §5 (research foundations) and in each phase. The evidence dossiers behind this revision are committed to **[docs/architecture-evidence/2026-07/](architecture-evidence/2026-07/)**: five subsystem analyses (`core-sim.md`, `netcode.md`, `rendering.md`, `platform.md`, `delivery.md`), the Quadra deep-dive (`quadra.md`), five research reports (`research-*.md`), and the envelope byte-measurement script (`measure-envelope.mjs`). When this plan cites "the evidence report" for an area, that directory is the reference; treat the dossiers as dated snapshots, this document as the roadmap.
