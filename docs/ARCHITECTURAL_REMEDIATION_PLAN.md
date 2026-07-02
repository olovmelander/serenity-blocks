# Serenity Blocks — Architectural Remediation Plan

*A phase-by-phase implementation plan derived from [ARCHITECTURAL_REVIEW.md](ARCHITECTURAL_REVIEW.md). Phases are ordered by **dependency**, not just severity: each one either clears a blocker, builds the safety net the next phase needs, or can only be done safely once an earlier phase exists. Effort tags: **S** ≤ 1 day · **M** = days–2 weeks · **L** = weeks+ (solo, part-time).*

---

## The sequencing logic (why this order)

Four hard dependencies drive everything:

1. **Lint is meaningless until line endings are normalized** → the `.gitattributes` fix must precede any lint-gated CI (98% of ESLint's 329k problems are CRLF noise).
2. **You cannot refactor safely without a test/CI net** → CI enforcement and the type harness must precede the large refactors, or every change is a leap of faith.
3. **Dead code must be removed before refactors touch it** → the dead `scoring.js` progression, the orphaned chapter map, and the dead audio manager all emit *false signal* that would mislead the determinism and modularity work.
4. **The protocol/snapshot types must exist before the netcode decomposition** → the review names the 5-site snapshot drift as "the single strongest argument for typing"; decomposing the god-class without that binding invites silent wire bugs.

This produces four movements:

| Movement | Phases | Outcome |
|---|---|---|
| **A — Stabilize** | 0, 1, 2 | Ship-blockers cleared; build is safe to deploy; deck cleared of dead code |
| **B — Harden** | 3, 4 | A real test/type/CI net exists; cheap architectural debt paid down |
| **C — Transform** | 5, 6, 7 | The big refactors (determinism, netcode, theme migration) — only safe after B |
| **D — Launch** | 8 | Signing, installer slimming, cold-boot polish, ship checklist |

**Minimum-viable ship path** if you want to launch fast: **Movement A + Movement D**, plus the quick fixes already in Phase 1. Movements B and C are the long-term health investment and can run before *or* after a first release — but the netcode correctness items in Phase 1 are non-negotiable for any multiplayer launch.

## Current-tree delta (2026-07-01)

This document is still the right roadmap, but several early-phase items have already landed in the current working tree. Treat the old phase tables as dependency order; treat this delta as the latest status snapshot. *(Line counts and landed-status re-verified against the tree on 2026-07-01.)*

| Area | Current status | Plan adjustment |
|---|---|---|
| Safety net | `.gitattributes`, `tsconfig.json`, `npm run typecheck`, Node `engines`, and a CI `test` job exist. CI now hard-gates typecheck + Vitest and soft-runs lint with `continue-on-error`. | Phase 0 is now a ratchet: do the one-time LF renormalization, clean the remaining lint baseline, make lint hard-fail, and wire release gates into CI. |
| Release blocker | Root and Electron `steam_appid.txt` are still `480`. `release-gate-check.mjs` warns in dev and hard-fails only with `SERENITY_RELEASE=1`. `package.json` still copies root `steam_appid.txt` into packaged builds via `extraFiles`. | Keep the AppID replacement as the top launch blocker. Add `SERENITY_RELEASE=1 npm run check:release-gates` to the packaged release path, and split local-dev AppID hints from Steam depot/release packaging so release artifacts do not ship `steam_appid.txt`. |
| Multiplayer correctness | The host double-apply fix, host-reassignment guard, broken `handleHostDisconnect()` call, binary digest wrapper, attack-scaling comment/test, migration epoch tests, and several peer-local-sim/round-fence tests are present. The current MP docs also show a finish-forward stabilization layer for the active netcode WIP. | Phase 1 should now be verified with current online-MP tests, the current-state MP stabilization checklist, and manual 2-peer smoke, not reimplemented blindly. The remaining structural work moves to Phases 5-6. |
| Security | A main-process CSP module and CSP unit test exist. Google fonts are still remote-allowed, and dev mode still needs relaxed Vite allowances. | Phase 1 security is mostly landed; Phase 8 should self-host fonts and keep tightening IPC/cloud filename validation. |
| Dead-code cleanup | The dead scoring exports, dead Odyssey nebula/ambient helpers, orphaned `CHAPTER_ENVIRONMENTS` map, old audio-manager path, and process-global piece id counter have been cleaned up. | Phase 2 is mostly done, but level progression still lives in `physics.js`; decide whether to extract it now or leave the comment as the single-source warning. |
| Dependency/package hygiene | Phaser is upgraded to `^4.1.0`. `three` and the unused `jimp` tree are no longer runtime dependencies. Native-module `extraResources` filters are tighter. `phaser` remains in `devDependencies` because Vite bundles the browser runtime into `dist`. | Reframe the old "phaser belongs in dependencies" item as a packaging/SBOM decision, not an automatic blocker. If `npm ci --omit=dev && electron-builder` ever becomes a target, move bundled browser deps accordingly. |
| Architecture debt | Dual event buses, scattered device-loss handling, local-MP multi-Phaser contexts, multiple Odyssey registries, and the large FFA state file remain. `ffa-p2p-game-state.js` is now **5,116 lines** (up from ~4,558 on 06-30 — it grew ~560 lines *while* deferred for Phase 6). | Phases 4 and 6 are now more important, not less. The god-class is actively growing under the finish-forward MP work, so the deferral gets more expensive each week — see the **scope-freeze boundary** in *Sequencing notes*. Do not start the Phase 6 *extraction* until the current multiplayer branch settles and its tests are green — but do not keep piling reconciliation/authority sophistication onto the pre-determinism base either. |
| Cold boot / first-run | The branded intro is now a richer choreography (boot-warp prewarm + warp-SFX one-shot on the SFX bus + deferred title reveal held until the warp finishes), an initial-theme prewarm runs as a deferred startup task to kill the first-entry compile freeze, and `timeToInteractiveMenuMs` is recorded. | On-plan Phase 8 polish, with two consequences. (1) Phase 4's "race intro-complete vs menu-ready" decoupling is now **higher-value**: the more elaborate the intro, the more important that it plays *over* an already-interactive menu rather than gating TTI. (2) Fold boot-warp prewarm, theme prewarm, and warp-SFX decode into the Phase 8/3d `timeToInteractiveMenuMs` budget so none of them can silently regress cold boot. Ensure `assets/audio/intro/` is git-tracked + packaged. |

## Quadra reference takeaways (2026-06-30)

A read-only pass over `C:\Users\olovm\repositories\quadra` found several ideas worth importing as architecture, not source code. Quadra is an old C++/SDL codebase with LGPL-era licensing and a very different network stack; use the patterns below, not copy/paste.

| Quadra pattern | Why it matters here | Plan hook |
|---|---|---|
| Frame-indexed recording files store packets/events, seed/game params, and a final summary that playback verifies | Turns replay/desync debugging from guesswork into a reproducible artifact | Phase 5 match artifact + replay verifier |
| A decoder-ring/stats parser documents event names and can reconstruct match history from logs | Makes telemetry, leaderboards, support reports, and regression tests speak one language | Phase 3 golden parser tests; Phase 8 launch/privacy docs |
| Late joins wait for a safe sync point before sending board/player snapshots | Avoids snapshotting mid-cascade or half-applied network state | Phase 6 download-join/resync extraction |
| Packet reads validate ranges, sender identity, player ids, piece ids, attack types, and versioned fields | Makes protocol hardening systematic instead of scattered conditionals | Phase 6 protocol schema/range table |
| Rule and protocol version gates keep old recordings/playback compatible after balance changes | Prevents future balance patches from silently invalidating demos or ranked evidence | Phase 3/5 rule fixtures and sim-version gates |

## Best-in-class architecture bar

Use this section as the review rubric for the phases below. A phase is not "architecturally done" unless it protects these invariants with tests, scripts, or a documented decision.

| Invariant | Best-in-class meaning | Plan hook |
|---|---|---|
| One active roadmap | This plan is the umbrella. `ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md` is the tactical MP stabilization pre-phase; the other MP research docs are references until harvested or marked superseded | Phase 0 architecture index + ADRs |
| Boundaries are enforced, not hoped for | Core simulation has no DOM/UI/Electron imports; rendering can observe state but not author gameplay truth; network message schemas define roles and validation | Phase 3d architecture fitness checks |
| Every risky subsystem has an artifact | Replay/event log for matches, screenshots for WebGPU visuals, perf traces for boot/rendering, support bundles for customer failures | Phases 3, 5, 7, 8 |
| Product trust is explicit | Casual host-authoritative P2P can ship; ranked/competitive trust requires replay verification at minimum, and eventually dedicated authority or trusted server validation | Phases 6, 8 |
| Performance has budgets | Cold boot, frame p95/p99, package size, snapshot bytes, reliable-message volume, and GPU/device-loss behavior have thresholds that fail CI or release gates | Phases 3c/3d, 6, 7, 8 |

## Multiplayer validation refresh (2026-06-30)

Validated against the current working tree after the latest online-MP improvements. The tactical stabilization layer is no longer merely planned; much of it is implemented and covered by unit tests. The remaining blocker is real two-machine Steam validation and the deeper competitive-trust work.

| Area | Current state | Plan adjustment |
|---|---|---|
| Test baseline | Targeted multiplayer validation passed: 22 MP-focused unit files / 152 tests (`ffa-*`, Steam binary snapshots, impairment, interpolation, battle log, opponent animation). | Treat these as the current local safety net. Still require two-machine Steam validation before calling online FFA release-candidate. |
| Launch defaults | `lockEvents=false`; `peerLocalSim`, local-board hold, `holdStats`, opponent clear events, idempotent garbage, drain-all garbage, `netDiag`, and `netEventLog` are on by default. `simTickNetcode`, adaptive input jitter, `downloadJoin`, `migrationEpoch`, `readyBarrier`, `authoritativeAttacks`, and deterministic garbage remain default-off. | Phase 1 stabilization is mostly landed. Phase 6 should decide which default-off flags graduate, with tests and two-machine evidence. |
| Stabilization landed | Heartbeat is re-armed with state sync and across restart gaps; restart clears the jitter buffer; the dead online host loop is removed; raw 30 Hz opponent snapshots no longer stomp interpolated `currentPiece`; battle log is persistent; late join/spectator/awaiting-spawn paths have tests. | Replace old "implement Phase A" language with "keep Phase A green and validate on real Steam." |
| Still not launch-proof | Host migration still refreshes from `NET_HEARTBEAT` only; network impairment is constructed from localStorage/URL in the live send path; sender validation is still allowlist-based, not schema/default-deny; host-derived attacks are behind a default-off flag; opponent rotation/spawn-id semantics need a pinning test; `downloadJoin`/`migrationEpoch`/`readyBarrier` are implemented but default-off. | Keep these in Phase 6/8. Do not label ranked/verified competitive play as supported yet. |

---

## MOVEMENT A — Stabilize

### Phase 0 — Safety Net & Tooling Unblock  *(S, ~2–3 days)*

**Goal:** make the repo's existing quality tools actually work and enforce them, so every later change is checked automatically.
**Depends on:** nothing. **Unblocks:** all CI-gated work (Phases 1, 3+).

| Task | Effort | Traces to |
|---|---|---|
| `.gitattributes` is present; run the one-time `git add --renormalize .` as a dedicated commit once the working tree is calm | S | §2.5 / Rec 4.1-6 |
| CI already has `typecheck` + `test` before Pages deploy; make lint a hard gate after LF normalization and add `npm run check:release-gates` to the gate | S | §2.5 / Rec 4.1-5 |
| Triage the remaining *real* ESLint findings; fix the `import/no-unresolved` resolver config (register `three/addons/*`) to delete blanket disables | S–M | §2.5, bundling-dx |
| Node `engines` + CI Node 20 are present; keep local/dev scripts aligned with that version | S | bundling-dx |
| Create `docs/ARCHITECTURE_INDEX.md` listing active, superseded, and reference-only plans; add ADR stubs for the hybrid renderer, host-authoritative P2P, incremental TypeScript, no-WASM physics, and WebGPU/TSL definition of done | S | architecture governance |
| Add a supply-chain gate with two scopes: `npm audit --omit=dev --audit-level=high` for runtime native modules, and a full lockfile/SBOM scan for the shipped surface, including devDependency-built artifacts such as Electron, Phaser, Three, Vite, and electron-builder. Add a lockfile-integrity check in CI and enable Dependabot. A paid Electron app ingesting untrusted P2P data must scan everything that can affect the shipped binary, not just `dependencies` | S | security / supply-chain |

**Exit criteria:** a red typecheck/test/release-gate push fails CI; `npm run lint` reports only genuine issues and hard-fails; the current Vitest suite runs on every PR.

---

### Phase 1 — Release Blockers: Correctness & Security  *(S–M, ~1 week)*

**Goal:** fix the bugs and trust holes that make a multiplayer/Steam release unsafe. These are independent, mostly small, and each ships with a regression test.
**Depends on:** Phase 0 (so the fixes are CI-protected). **Unblocks:** any real build.

| Task | Effort | Traces to |
|---|---|---|
| **`steam_appid.txt` `480` → real AppID** for local/dev Steam runs, then run the release gate with `SERENITY_RELEASE=1` so placeholder AppIDs hard-fail release builds. Also change the packaged release path so `steam_appid.txt` is not copied into the Steam depot/release artifact; either remove the `extraFiles` entry for release builds or strip it in an `afterPack`/release-packaging step. Local ad-hoc builds may still use `STEAM_APP_ID` or a manually placed dev AppID file | S | §2.5 / Rec 4.1-1 |
| **Host double-apply fix is landed:** keep the regression tests green and manually smoke DAS/ARR held movement in a 2-peer match | S | §2.4 / Rec 4.1-2 |
| **Authority-takeover quick fix is partly landed:** `_verifyHostReassignment()` now gates migration/handoff locally; still make the transport-level host-authoritative allowlist/default-deny story explicit in Phase 6 | M | §2.4, §2.6 / Rec 4.1-3 |
| **Desync digest wrapper is landed:** keep binary/full/delta digest tests green and manually verify the chunked CRC32 resync fires on forced divergence | S | §2.4 / Rec 4.1-7 |
| **CSP is landed in the main process:** keep the CSP test, then self-host the webfonts so packaged CSP can drop Google origins | S | §2.6 / Rec 4.1-4 |
| **Broken `handleHostDisconnect` call is fixed:** keep host-election/migration epoch tests green | S | §2.4 |
| **`applyAttackScaling` comment/test is fixed:** keep the table test as the balance pin | S | §2.4 / Rec 4.1-9 |
| Tactical MP stabilization is mostly landed and unit-validated: heartbeat re-arm, `lockEvents=false`, envelope diagnostics, join-cap/restart guards, peer-owned local sim, idempotent/drain-all garbage, persistent battle log, and spectator/late-join paths. Before release-candidate, run the two-machine Steam validation (below), clear/stabilize net impairment flags, and keep `lockEvents` off unless it is routed through the interpolator path | M | MP current-state plan |
| **Author `docs/TWO_MACHINE_STEAM_VALIDATION.md`** — this plan cites a "two-machine Steam checklist" in Phases 1, 6, and the sequencing notes, but no such artifact exists, so the single most-cited remaining blocker has no concrete definition. Write it: identical build-hash parity, the exact desync→resync, host-migration, and disconnect→rejoin scenarios to run, expected `netDiag` deltas, and explicit pass/fail thresholds. "Validated on real Steam" is subjective until this exists | S | MP current-state hazards |

**Note:** the host double-apply and authority quick-fixes here are band-aids on the right behavior; the *structural* fixes land in Phase 5 (input quantization) and Phase 6 (default-deny authority model). They are deliberately done twice — once to stop the bleeding now, once to fix the root later.

**Exit criteria:** a 2-peer match stays in sync through DAS-held movement and cascades; a non-host peer cannot forge host messages; the desync/resync system demonstrably fires; no placeholder AppID can reach a build; no `steam_appid.txt` is present in a release/depot artifact.

---

### Phase 2 — Dead Code, Drift & Dependency Hygiene  *(S, ~3–4 days)*

**Goal:** delete everything that emits false signal, and make `package.json` honest — so later refactors aren't misled and the installer stops shipping junk.
**Depends on:** Phase 0. **Unblocks:** clean ground for Phases 4–7.

| Task | Effort | Traces to |
|---|---|---|
| Dead `scoring.js` exports are removed; either extract the live 15-line progression into one helper now or leave the existing warning comment until the deterministic sim refactor moves it | S | §2.2 |
| Dead Odyssey `createNebula()`/`createAmbientParticles()` are removed; keep `src/rendering/odyssey` free of live `new THREE.ShaderMaterial` calls | S | §2.1 |
| Orphaned `CHAPTER_ENVIRONMENTS` map is removed; the larger remaining task is Phase 4's one true `CHAPTER_REGISTRY` | S | §2.3 |
| Dead `utils/audio-manager.js` path is removed and `SoundManager.cleanup()` closes its `AudioContext`; keep audio ownership single-source | S | §2.7 |
| Generate or guarantee theme-container `<div>`s from the registry at boot; `chiral-gold` currently self-creates its missing container, but the registry should own this globally | S | §2.3 |
| `_pieceIdCounter` is now an instance field on `GameState`; keep demo/replay piece-id tests green | S | §2.2 |
| **Phaser is upgraded to stable `^4.1.0`**; remaining work is deleting any compatibility shims only after all `Game` configs smoke-test cleanly | S | §3.2 |
| `three` and unused `jimp` are out of runtime deps; decide whether `phaser` stays in `devDependencies` as a Vite-bundled browser dependency or moves to `dependencies` for SBOM/`npm ci --omit=dev` workflows | S | §3.2, bundling-dx |

**Exit criteria:** Odyssey tree is verifiably `ShaderMaterial`-free; level progression has exactly one definition; no orphaned registries/managers; `app.asar` no longer contains `jimp` or a duplicate `three`; Phaser runs on a stable release with no shims.

---

## MOVEMENT B — Harden

### Phase 3 — Test & Type Harness  *(M, ~3–4 weeks part-time)*

**Goal:** build the net that makes Movement C safe — types over the riskiest contracts, behavioral tests over the untested high-blast-radius surfaces, and a GPU gate that catches WGSL breakage off the dev machine.
**Depends on:** Phases 0–2 (clean code to type; CI to run the gates). **Unblocks:** Phases 5, 6, 7.

**Track 3a — Incremental TypeScript (Path A, not a rewrite):**
| Task | Effort | Traces to |
|---|---|---|
| `tsconfig.json`, `typescript`, and the hard CI `npm run typecheck` gate exist. Ratchet coverage by adding `// @ts-check` to one clean module at a time, starting with protocol/simulation/event code | M | §4.4, ts-adoption |
| `src/core/types.d.ts` exists with snapshot/event/window globals. Extend it for the live multiplayer additions (`awaitingSpawn`, `roundGeneration`, `migrationEpoch`, spectator/download-join metadata) before decomposing netcode | M | §4.4 |
| Bind `binary-encoding.js` encode/decode + `ffa-p2p-game-state.js` `buildStateSnapshot`/`_applySnapshotState` to `PlayerSnapshot`; make `EventBus.emit/on` generic over `EventPayloadMap` | M | §4.4 |
| Decide the `tornado/*.ts` disposition: rename to `.js` *or* fold into the checked island after a `declare module 'three/webgpu'` augmentation | S | ts-adoption |

**Track 3b — Behavioral tests for the untested surfaces:**
| Task | Effort | Traces to |
|---|---|---|
| Binary-protocol round-trip tests exist; expand them whenever a snapshot field is added and include the Steam JSON/base64 wrapper path | S | §2.5 |
| 7-bag/rotation primitive tests exist; still add SRS kick-table and T-spin table tests against gameplay behavior | S | §2.5 |
| Add Quadra-style golden rule fixtures for the current Serenity rules: level progression, scoring bonuses, clean/cascade attacks, attack scaling, and any "boring rules"/crowding equivalent you decide to expose | M | Quadra rules parity |
| Add a tiny match-artifact decoder test: parse one recorded match/event log, assert seed/game params/key events/final summary digest, and fail on undocumented event-shape drift | M | Quadra recording/stats pattern |
| Phaser-board smoke test (boot a board, drop a piece, clear a line, assert score) | M | §2.5 |
| Replace the substring `release-gate-check.mjs` with ≥1 behavioral assertion per gated subsystem | M | §2.5 |

**Track 3c — GPU gate (TDR-safe):**
| Task | Effort | Traces to |
|---|---|---|
| Wire `odyssey-webgpu-validation.mjs` into CI on a **hosted runner** with a software WebGPU backend (Dawn/SwiftShader), scene-by-scene, once with WebGPU and once with `ODYSSEY_FORCE_WEBGL=1` | M | §2.5 / Rec 4.2 |
| Add a tripwire test asserting the "mixed `WebGPURenderer` + raw `ShaderMaterial`" theme set matches a documented allowlist; fail when a new theme enters the mixed set by accident | S | §2.5, §3.3 |

**Track 3d — Architecture fitness functions:**
| Task | Effort | Traces to |
|---|---|---|
| Add `scripts/architecture-fitness-check.mjs` and run it in CI as warning-only first, then hard-gate it after the baseline is clean | M | architecture governance |
| Fitness checks to start with: no DOM/UI/Electron imports from `src/core/**`; no new event bus; no live raw `ShaderMaterial` under WebGPU/TSL paths except documented permanent WebGL holdouts; no non-dev `window.*` debug handles; no new Odyssey/chapter registry shadows; no direct `new Phaser.Game` loop in local-MP per player | M | §2.1, §2.3, §3.3 |
| Add a machine-readable budget file for `timeToInteractiveMenuMs`, Odyssey/theme frame p95/p99, snapshot byte p95, reliable-message rate, package size, and large-asset size; validation scripts report against it. **Capture the current tree's numbers as the committed baseline that populates it** (reuse the existing baseline-capture protocol) — a budget with no baseline is unfalsifiable | M | performance gates |

**Exit criteria:** `tsc --noEmit` is green and gated; the snapshot/event contracts fail to compile on drift; the three previously-untested surfaces have tests; architecture fitness checks run in CI; a WGSL compile error in Odyssey fails CI without touching the dev iGPU.

---

### Phase 4 — Architectural Debt Reduction  *(M, ~2–3 weeks)*

**Goal:** pay down the medium-cost coupling that the review flagged but that doesn't require the big determinism/netcode surgery. Each is now safe because Phase 3 can catch regressions.
**Depends on:** Phase 3 (tests/types). **Unblocks:** cleaner substrate for Phases 5–6.

| Task | Effort | Traces to |
|---|---|---|
| **Unify the two event buses:** fold per-listener throttle/batch + error-isolated fan-out into `event-bus.js`, re-point `multiplayer-events.js` at it (keep `ffa:` as a namespace), emit opponent gameplay on the unified bus, delete `optimizedEventBus` | M | §2.3 |
| **Unify device-loss resilience:** route the 6 "Camp 2" themes and Odyssey's `WebGPURenderer` through `gpu-context-resilience.js` + the EventBus; add a real Odyssey device-loss handler (stop `animate()`, show overlay, re-init/route-out) | M | §2.1 |
| **Fix the local-MP context explosion:** render N player boards as viewports within one `Phaser.Game`, or destroy the main board game before allocating per-player ones | M | §2.1 |
| **One debounced resize broadcaster** on the EventBus; subscribe the WebGL1 engine, Odyssey, and themes (replaces ~69 listeners) | S | §2.1 |
| **Consolidate the 5 Odyssey chapter lists** into one `CHAPTER_REGISTRY` (id, name, levelRange, loader, export names, profile) mirroring `theme-registry.js` | M | §2.3 |
| Extract `StandardGameLoopMode` between `BaseGameMode` and the single-board modes to own loop wiring, pause/resume, and the repeated gameplay event quartet; make concrete modes configure behavior instead of copy-pasting loop code | M | §2.2, §2.3 |
| Decouple cold-boot interactivity from the intro: race intro-complete vs menu-ready so the start modal is interactive without waiting on the WebGPU intro renderer; make the 2000 ms overlay floor policy-driven | M | §2.9 |

**Exit criteria:** one event bus; every GPU surface reports loss through one path with Odyssey recovering; 4-player local MP uses one Phaser context; single-board modes share one loop contract; adding a chapter touches one registry.

---

## MOVEMENT C — Transform

> These three phases are large and somewhat independent tracks. If working strictly serially, do **Phase 5 first** (it produces the deterministic frame number the netcode in Phase 6 wants to reconcile on). Phase 7 (theme migration) is independent and can run in parallel with either, *provided Phase 3c's WGSL gate exists* to verify conversions.
>
> **Before starting any Movement C phase,** capture a perf/behavior baseline (snapshot bytes, frame p95/p99, cold boot) with the Phase 3d protocol so the budgets are falsifiable, and give each phase an *abort* criterion — a regression threshold that reverts the change — not just an exit criterion. The transforms here are the ones most likely to regress silently.

### Phase 5 — The Determinism Program  *(L, ~4–6 weeks)*

**Goal:** the central architectural prize — a deterministic, fixed-tick simulation that makes replay pure-input and gives netcode a frame to reconcile on. Replaces the Phase 1 input band-aid with the real fix.
**Depends on:** Phase 3 (types over `GameState`; tests to prove behavior preserved). **Unblocks:** real rollback/lag-comp in Phase 6.

| Step | Task | Effort | Traces to |
|---|---|---|---|
| 5.1 | Add a read/write boundary to `GameState` so there's something to refactor behind (precondition for everything else) | M | §2.2 |
| 5.2 | Extract a pure synchronous `resolveCascade(boardGrid, lockContext) → { boardAfter, waves, holeMasks, scoreDelta, perfectClear }`, modeled on the existing headless `cascade-simulator.js`; have `physics.js` compute the full result first, then drive flash/gravity animation as a *replay of precomputed waves*. While extracting, replace the O(n) `queue.shift()` flood-fill dequeue with an index cursor (O(n²) → O(n); matters on 1000-row Infinity boards) | L | §2.2, §3.4, wasm |
| 5.3 | Make the sim fixed-tick: advance `processAutoDrop` **and** DAS/ARR in whole `simTickMs` quanta; move the DAS accumulator into snapshotted state; apply inputs on tick boundaries | L | §2.2, §2.8 |
| 5.4 | Unify the keyboard + gamepad DAS into one shared `advanceDas(state, ticks, config)`; wire gamepad advance into the local-MP loop on the same clock | M | §2.8 |
| 5.5 | Collapse the 3 game loops (+ hybrid path) onto one runner owning delta/pause/hit-stop/blind-timer; retire the `MAX_CONCURRENT_LOOPS` band-aid | M | §2.2 |
| 5.6 | Replace the 233,280-state LCG with mulberry32/xoshiro behind the existing `getState`/`setState` seam; convert replay to pure-input and delete the full-state checkpoint machinery | M | §2.2 |
| 5.7 | Define a canonical frame-indexed match artifact: `simVersion`, seed, game params, input-frame stream, authoritative gameplay events, periodic digests, and final summary digest. Replays consume this artifact and verify the summary, using Quadra's `.rec`/`verify_summary` shape as the model, not its binary format | M | Quadra recording pattern |
| 5.8 | Add sim-version gates around rule-changing behavior so old recordings remain replayable after balance patches; version attack scaling, garbage/crowding rules, level progression, scoring, and RNG separately from app version | M | Quadra protocol/rule versioning |
| 5.9 | Add deterministic soak tests that run the same input stream at 30/60/144 fps, with pause/resume and cascade-heavy boards, and assert identical board/score/garbage digests | M | determinism fitness |
| 5.10 | **Differential cutover gate (run *during* 5.2/5.6, not after):** drive the legacy `processPhysics` and the new pure `resolveCascade` — and the old LCG vs mulberry32 — from the same input stream in parallel, diff board/score/garbage digests on every lock, and delete a legacy path only after the diff stays clean over N real sessions. Shadow-mode equality, not a post-hoc soak, is what makes a bit-sensitive cutover safe | M | determinism fitness |

**Exit criteria:** `(seed, input-frame-stream)` reproduces a bit-identical board; replay needs no state checkpoints; the canonical match artifact decodes, replays, and verifies its final digest; input is no longer blocked during cascades; one loop runner drives every mode; the Phase 1 double-apply band-aid is subsumed by tick-boundary input application; **no legacy sim/RNG path is removed until the 5.10 differential gate is clean.**

---

### Phase 6 — Networking Decomposition & Wire Compaction  *(L, ~4–6 weeks)*

**Goal:** break up the now-roughly-5,116-line god-class, harden the trust model structurally, and shrink the wire envelope. The current multiplayer branch has already added peer-local simulation, migration epochs, download-join/resync state, spectators, round fences, and more tests; freeze that behavior before extracting modules.
**Depends on:** Phase 3 (protocol types) and ideally Phase 5 (a frame number to reconcile on). **Unblocks:** maintainable netcode, trustworthy results.

| Task | Effort | Traces to |
|---|---|---|
| Consolidate the MP roadmap before code extraction: mark `ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md` as the tactical pre-phase, harvest the still-valid parts of the best-in-class/research plans into this section, and archive or mark stale docs so future work does not follow conflicting instructions | S | architecture governance |
| First audit the current FFA defaults before extraction: keep `peerLocalSim`, idempotent garbage, drain-all garbage, `netDiag`, and `netEventLog` as the current baseline. Each default-off flag (`simTickNetcode`, adaptive jitter, `downloadJoin`, `migrationEpoch`, `readyBarrier`, `authoritativeAttacks`, deterministic garbage) graduates to default-on only when it clears a **fixed bar written into this table**: (a) two-machine Steam soak passes with it on, (b) snapshot-byte p95 and reliable-message rate do not regress against the Phase 3d budget, and (c) a pinning test covers its behavior. Stating the bar per flag is what stops "decide later" from becoming "default-off forever" | S | §2.4 |
| Extract `ResyncCoordinator(network, getSnapshot, applySnapshot)` from the current chunked-resync/download-join block; reuse existing CRC32/base64 instead of duplicating helpers | M | §2.4 |
| Make download-join/resync syncpoint-aware: defer snapshots until a settled sim tick with no active cascade, no partially-applied packet stack, and stable round generation; expose an explicit pending-join state instead of snapshotting "whenever" | M | Quadra pending-join pattern |
| Extract `NetworkHandlerRegistry` from `setupNetworkHandlers` (28 registrations) | M | §2.4 |
| Move `showCountdown`/overlay DOM code out to the UI layer | S | §2.4 |
| **Default-deny authority model:** make `_isSenderAllowedForMessage` reject all host-control/authoritative `game:*` messages from non-host peers unless explicitly allowlisted; migrate the local `_verifyHostReassignment()` checks into that transport-level policy where possible | M | §2.4, §2.6 |
| Build a protocol schema/range table for every network message: sender role, required fields, versioned optional fields, player-id bounds, piece ids, attack types, garbage masks, and drop/ignore behavior. Unknown optional fields can be ignored; invalid required fields are dropped and counted | M | Quadra packet validation pattern |
| Move toward host-derived attack authority: the `authoritativeAttacks` flag and callback switch exist, but default-off. Peer attack summaries become prediction hints; the host derives ranked/canonical attack events from its authoritative simulation, with replay evidence for every line clear, garbage send, cancel, and top-out | L | MP research plan |
| Finish opponent piece wire semantics: include rotation and spawn/lock identity in significant-change detection, decide whether binary decode must return rotated `shape` or renderer-owned `rotation` is canonical, and pin with a binary/interpolator/watch-board test | S-M | MP current-state Phase B |
| Preserve causality across disconnect/rejoin: keep stable participant ids and do not clear attack attribution, garbage history, or final-kill evidence until the causal window closes | S-M | Quadra rejoin/drop pattern |
| Harden host-liveness and dev impairment: either refresh host migration on any authoritative host packet or prove heartbeat alone under two-machine loss; gate `serenity.netImpair` to dev/test or add a release guard so stale localStorage cannot impair real Steam sessions | M | MP current-state hazards |
| Add transport budgets and pacing for the steamworks.js single physical queue: snapshot bytes p50/p95/max, reliable-message rate, resync chunk pacing, keyframe/delta counters, and a rule that control/lock/restart messages cannot be starved by resync | M | MP research plan |
| **Compact the wire envelope:** drop rarely-changing per-packet fields (matchId/nonce/host/protocol) to handshake-or-on-change; single-char/CBOR keys; consider sending the binary buffer as the packet body for snapshot channels | M | §2.4 |
| Re-enable the InputValidator per-input interval check; implement "kick after N violations"; mark FFA results non-ranked unless a server-side validation story exists | M | §2.4 |

**Exit criteria:** no single networking file > ~800 lines; download-join snapshots are syncpoint-safe; malformed/out-of-role messages are rejected by one protocol policy; the 30 Hz delta envelope overhead drops from ~6× to near-1×; authority can't be spoofed by any host-control `game:*` message; two-machine validation passes with identical build hashes; current online-MP tests stay green; results have an explicit trust label.

---

### Phase 7 — Theme TSL Migration Completion  *(L, ongoing)*

**Goal:** finish the migration so WebGL2 becomes a *true* fallback, not a load-bearing path.
**Depends on:** Phase 3c (the WGSL gate, to verify each conversion TDR-safely). **Parallelizable** with Phases 5–6.

| Step | Task | Effort | Traces to |
|---|---|---|---|
| 7.1 | **Descope** `renderer.js` (WebGL1 background) + `WarpTransitionRenderer.js` as permanent WebGL components; document the boundary; redefine "done" = *every theme/Odyssey path constructs NodeMaterials only; no theme feeds a `WebGPURenderer` a GLSL `ShaderMaterial`* | S | §3.3 |
| 7.2 | Convert the ~16–20 **dual-state themes** first (build a `WebGPURenderer` *and* raw `ShaderMaterial`s — survive only via silent WebGL2 fallback) to NodeMaterials; each conversion starts playground-first, uses `three/webgpu` + `three/tsl`, and ends with canvas screenshots plus console validation | L | §2.5, §3.3, WebGPU workflow |
| 7.3 | Convert the remaining WebGL2-only themes; the tripwire allowlist from Phase 3c trends to empty | L | §3.3 |
| 7.4 | Make the WebGPU theme/chapter contract explicit in docs and fitness checks: device-loss registration, disposal ownership, pixel-ratio policy, screenshot artifact path, reduced-motion behavior, and fallback expectations | M | WebGPU workflow |

**Exit criteria:** the mixed-set allowlist is empty (or explicitly, intentionally non-empty with documented rationale); every converted theme/chapter has a screenshot-backed validation artifact; forcing WebGPU-only no longer breaks any theme.

---

## MOVEMENT D — Launch

### Phase 8 — Ship Polish & Launch Checklist  *(M)*

**Goal:** everything between "the engine is healthy" and "a Steam customer has a good first run." Can be done as soon as Movement A is complete (does not require B/C).

| Task | Effort | Traces to |
|---|---|---|
| Wire `CSC_LINK`/`CSC_KEY_PASSWORD` code-signing so the NSIS installer isn't unsigned (avoids SmartScreen); populate the empty `author` field | S | bundling-dx |
| Opus/Ogg re-encode the large audio/music catalog; move large media out of `app.asar` via `asarUnpack`/`extraResources` so updates don't rewrite a monolith; keep the native-module `extraResources` filters tight. Ensure boot/intro SFX assets (`assets/audio/intro/`, e.g. `warp.ogg`) are git-tracked and packaged — best-effort one-shot playback silently no-ops if the file is missing from a clean build | M | bundling-dx |
| `timeToInteractiveMenuMs` is now recorded; add a regression threshold and include the intro WebGPU renderer import timing in the metric/report | S | §2.9 |
| Replace the bare `electronAPI.invoke` pass-through with named wrappers; add path/filename validation to `steam:cloud*` handlers; keep CSP tests green while tightening inline-style sinks such as `nameColor` | S–M | §2.6 |
| Publish a short privacy/networking note for any update check, matchmaking/server discovery, match logs, telemetry, stats uploads, Steam Cloud, and crash/support artifacts; background network checks must never block first-run interactivity | S | Quadra README pattern |
| Add a "support bundle" export for bug reports: build id, settings, GPU/driver info, recent `netDiag`, last match artifact digest, performance trace, release-gate results, and sanitized logs | M | observability |
| Decide the *automatic* crash/error-reporting story (Electron `crashReporter` and/or a Sentry-style sink) with an explicit privacy/consent posture, so a bad first run is observed rather than silently lost. The manual support bundle above is the fallback signal, not the primary one | S–M | observability |
| Define release-channel/trust labels in product and docs: private/casual P2P is allowed after Movement A+D; ranked/verified competitive play waits for replay verification and host-derived authority | S | product trust |
| Write a documented ship checklist (sign → `SERENITY_RELEASE=1 npm run check:release-gates` → assert unpacked artifact has no `steam_appid.txt` → depot upload → version bump → smoke-test unpacked build); add the missing Steam depot-upload script | S | bundling-dx |

**Exit criteria:** a signed installer with the real AppID, a lean download, a measured cold-boot, a supportable diagnostics story, clear network/privacy/trust disclosure, and a repeatable release procedure.

---

## Sequencing notes & options

- **Fastest path to a first multiplayer release from the current tree:** finish the remaining Phase 0 ratchet (LF renormalize, lint baseline, hard release gate), close the real AppID blocker in Phase 1, re-run/extend the current online-MP tests plus a 2-peer manual smoke, then do Phase 8. Much of the original Phase 1/2 implementation work is already landed; the remaining risk is verification and launch wiring.
- **If you can only do one large refactor:** do **Phase 5 (determinism)**. It subsumes a Phase 1 band-aid, unlocks the netcode reconciliation, fixes replay, and removes the cascade input-lag — the highest single architectural payoff.
- **Parallel tracks for a solo dev:** Phase 7 (theme migration) is mechanical and independent; it's a good "background task" to interleave between the heavier Phase 5/6 sessions, as long as the Phase 3c GPU gate is in place to verify conversions without risking the dev iGPU.
- **Two band-aids become real fixes later — keep them linked:** Phase 1's host-double-apply patch → Phase 5's tick-boundary input; Phase 1's authority allowlist patch → Phase 6's default-deny model. Leave a code comment on each Phase 1 patch pointing at its Phase 5/6 successor so the temporary fix isn't mistaken for the final design.
- **Scope-freeze boundary (finish-forward rework guard):** Phase 5 reshapes the substrate netcode sits on — fixed-tick input, snapshotted DAS, pure-input replay. Any netcode built on today's variable-delta base *above the casual tier* is rework waiting to happen. So: stabilization and casual-P2P features may proceed now, but do **not** build reconciliation, rollback, or host-derived authoritative-attack sophistication until Phase 5 lands — that specific work will be rebuilt on the deterministic frame. This is the boundary that keeps the god-class's ongoing growth (~560 lines while deferred) pointed at stabilization rather than at netcode depth Phase 5/6 will redo.
- **Where TypeScript pays off first:** the Phase 3a snapshot/event types have started; extend them to the current multiplayer fields *before* Phase 6, because the snapshot contract drift across 5+ sites is exactly the bug class the decomposition risks introducing.
- **Quadra's best lesson:** replay, stats, desync reports, late-join validation, and support artifacts should come from one documented frame-indexed match artifact, not five unrelated logging formats.
- **The new bar is automatic enforcement:** any architecture rule that matters twice should become a type, test, fitness check, budget, replay artifact, screenshot artifact, or release gate. Markdown alone is not the control.
