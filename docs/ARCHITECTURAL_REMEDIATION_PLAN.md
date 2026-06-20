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

---

## MOVEMENT A — Stabilize

### Phase 0 — Safety Net & Tooling Unblock  *(S, ~2–3 days)*

**Goal:** make the repo's existing quality tools actually work and enforce them, so every later change is checked automatically.
**Depends on:** nothing. **Unblocks:** all CI-gated work (Phases 1, 3+).

| Task | Effort | Traces to |
|---|---|---|
| Add `.gitattributes` (`* text=auto eol=lf`, binary globs for `*.png/*.glb/*.mp3/*.wav/*.ogg`); run `git add --renormalize .` | S | §2.5 / Rec 4.1-6 |
| Add a CI `test`+`lint` job (`npm ci` → `npm run lint` → `npm test`) and make the Pages deploy `needs: test` | S | §2.5 / Rec 4.1-5 |
| Triage the ~5,500 *real* ESLint findings the CRLF noise was hiding; fix the `import/no-unresolved` resolver config (register `three/addons/*`) to delete ~148 blanket disables | S–M | §2.5, bundling-dx |
| Add `engines` Node pin; align CI Node version with local | S | bundling-dx |

**Exit criteria:** a red push fails CI; `npm run lint` reports only genuine issues; the 398-test suite runs on every PR.

---

### Phase 1 — Release Blockers: Correctness & Security  *(S–M, ~1 week)*

**Goal:** fix the bugs and trust holes that make a multiplayer/Steam release unsafe. These are independent, mostly small, and each ships with a regression test.
**Depends on:** Phase 0 (so the fixes are CI-protected). **Unblocks:** any real build.

| Task | Effort | Traces to |
|---|---|---|
| **`steam_appid.txt` `480` → real AppID** (root + `electron/`), plus a release-gate assertion that fails the build if it still reads `480` | S | §2.5 / Rec 4.1-1 |
| **Host double-apply fix:** when `useJitterBuffer` is on, buffer only — remove the eager `_applyInputToPlayer` in `processPlayerInput` (`ffa-p2p-game-state.js:980`); make `processBufferedInputs` the single apply site. Test: one "move left" = one cell | S | §2.4 / Rec 4.1-2 |
| **Authority-takeover quick fix:** gate `game:host:migrated`/`handoff` off the *current* `hostSteamId`; add them to the host-authoritative path; verify `msg.from` in the migration-sync handler | M | §2.4, §2.6 / Rec 4.1-3 |
| **Revive desync detection:** move the DJB2 digest into the message envelope so it survives base64/JSON and the comparison + chunked CRC32 resync actually fire on the binary path | S | §2.4 / Rec 4.1-7 |
| **Install a strict CSP** in the main process via `session.defaultSession.webRequest.onHeadersReceived` (covers `file://`); self-host the two webfonts | S | §2.6 / Rec 4.1-4 |
| **Fix the broken `handleHostDisconnect` → `hostMigration.handleHostDisconnect()`** call (method doesn't exist — guaranteed `TypeError`) | S | §2.4 |
| **Correct the `applyAttackScaling` comment** to match live 10%-per-opponent scaling + pinning test | S | §2.4 / Rec 4.1-9 |

**Note:** the host double-apply and authority quick-fixes here are band-aids on the right behavior; the *structural* fixes land in Phase 5 (input quantization) and Phase 6 (default-deny authority model). They are deliberately done twice — once to stop the bleeding now, once to fix the root later.

**Exit criteria:** a 2-peer match stays in sync through DAS-held movement and cascades; a non-host peer cannot forge host messages; the desync/resync system demonstrably fires; no placeholder AppID can reach a build.

---

### Phase 2 — Dead Code, Drift & Dependency Hygiene  *(S, ~3–4 days)*

**Goal:** delete everything that emits false signal, and make `package.json` honest — so later refactors aren't misled and the installer stops shipping junk.
**Depends on:** Phase 0. **Unblocks:** clean ground for Phases 4–7.

| Task | Effort | Traces to |
|---|---|---|
| Delete the 5 dead `scoring.js` exports; move the live 15-line progression out of `physics.js:794-804` into one `advanceLevelProgression()` helper so the rule has a single home | S | §2.2 |
| Delete the dead Odyssey `createNebula()`/`createAmbientParticles()` (the lone raw `ShaderMaterial`, never called) | S | §2.1 |
| Delete the orphaned `CHAPTER_ENVIRONMENTS` map (`chapter-environments/index.js`, 2 chapters behind, imported by nothing) | S | §2.3 |
| Delete `utils/audio-manager.js` + the dead `loadBuffer`/`playBuffer` branch in `neon-district` + the no-op `audioManager?.stopAll()` guard; add `audioContext.close()` to `SoundManager.cleanup()` | S | §2.7 |
| Generate theme-container `<div>`s from the registry at boot (fixes the missing `chiral-gold` container) | S | §2.3 |
| Make `_pieceIdCounter` an instance field on `GameState` (reset in constructor/`reset()`) instead of a process-global | S | §2.2 |
| **Phaser `4.0.0-rc.5` → stable `4.1.0`**; delete the `module.default || module` and `Scale?.X ?? 0` ESM shims; smoke-test all 5 `Game` configs | S | §3.2 |
| Move `phaser` to `dependencies`; move `three` + the unused `jimp` tree out of the runtime dep set so electron-builder stops packing them (`three` currently ships twice; `jimp` ~463 dead asar entries) | S | §3.2, bundling-dx |

**Exit criteria:** Odyssey tree is verifiably `ShaderMaterial`-free; level progression has exactly one definition; no orphaned registries/managers; `app.asar` no longer contains `jimp` or a duplicate `three`; Phaser runs on a stable release with no shims.

---

## MOVEMENT B — Harden

### Phase 3 — Test & Type Harness  *(M, ~3–4 weeks part-time)*

**Goal:** build the net that makes Movement C safe — types over the riskiest contracts, behavioral tests over the untested high-blast-radius surfaces, and a GPU gate that catches WGSL breakage off the dev machine.
**Depends on:** Phases 0–2 (clean code to type; CI to run the gates). **Unblocks:** Phases 5, 6, 7.

**Track 3a — Incremental TypeScript (Path A, not a rewrite):**
| Task | Effort | Traces to |
|---|---|---|
| Add `tsconfig.json` (`allowJs`/`checkJs`/`noEmit`, `strict:false`), `include`-scoped to `src/core` + `src/events` only (avoids three.js node-material type-lag); add `typescript` + `@types/three` to devDeps; wire `tsc --noEmit` as an `npm run typecheck` CI gate | M | §4.4, ts-adoption |
| Create `src/core/types.d.ts`: `PlayerSnapshot`, `StateSnapshot`, `GameState`, `EventMap`/`MultiplayerEventMap`; add a `declare global { interface Window {...} }` for `settings`/`settingsManager`/etc. | M | §4.4 |
| Bind `binary-encoding.js` encode/decode + `ffa-p2p-game-state.js` `buildStateSnapshot`/`_applySnapshotState` to `PlayerSnapshot`; make `EventBus.emit/on` generic over `EventMap` | M | §4.4 |
| Decide the `tornado/*.ts` disposition: rename to `.js` *or* fold into the checked island after a `declare module 'three/webgpu'` augmentation | S | ts-adoption |

**Track 3b — Behavioral tests for the untested surfaces:**
| Task | Effort | Traces to |
|---|---|---|
| Binary-protocol round-trip test (encode → base64 → decode equality on a randomized board) | S | §2.5 |
| SRS / T-spin / 7-bag kick-table table-test | S | §2.5 |
| Phaser-board smoke test (boot a board, drop a piece, clear a line, assert score) | M | §2.5 |
| Replace the substring `release-gate-check.mjs` with ≥1 behavioral assertion per gated subsystem | M | §2.5 |

**Track 3c — GPU gate (TDR-safe):**
| Task | Effort | Traces to |
|---|---|---|
| Wire `odyssey-webgpu-validation.mjs` into CI on a **hosted runner** with a software WebGPU backend (Dawn/SwiftShader), scene-by-scene, once with WebGPU and once with `ODYSSEY_FORCE_WEBGL=1` | M | §2.5 / Rec 4.2 |
| Add a tripwire test asserting the "mixed `WebGPURenderer` + raw `ShaderMaterial`" theme set matches a documented allowlist | S | §2.5, §3.3 |

**Exit criteria:** `tsc --noEmit` is green and gated; the snapshot/event contracts fail to compile on drift; the three previously-untested surfaces have tests; a WGSL compile error in Odyssey fails CI without touching the dev iGPU.

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
| Decouple cold-boot interactivity from the intro: race intro-complete vs menu-ready so the start modal is interactive without waiting on the WebGPU intro renderer; make the 2000 ms overlay floor policy-driven | M | §2.9 |

**Exit criteria:** one event bus; every GPU surface reports loss through one path with Odyssey recovering; 4-player local MP uses one Phaser context; adding a chapter touches one registry.

---

## MOVEMENT C — Transform

> These three phases are large and somewhat independent tracks. If working strictly serially, do **Phase 5 first** (it produces the deterministic frame number the netcode in Phase 6 wants to reconcile on). Phase 7 (theme migration) is independent and can run in parallel with either, *provided Phase 3c's WGSL gate exists* to verify conversions.

### Phase 5 — The Determinism Program  *(L, ~4–6 weeks)*

**Goal:** the central architectural prize — a deterministic, fixed-tick simulation that makes replay pure-input and gives netcode a frame to reconcile on. Replaces the Phase 1 input band-aid with the real fix.
**Depends on:** Phase 3 (types over `GameState`; tests to prove behavior preserved). **Unblocks:** real rollback/lag-comp in Phase 6.

| Step | Task | Effort | Traces to |
|---|---|---|---|
| 5.1 | Add a read/write boundary to `GameState` so there's something to refactor behind (precondition for everything else) | M | §2.2 |
| 5.2 | Extract a pure synchronous `resolveCascade(boardGrid, lockContext) → { boardAfter, waves, holeMasks, scoreDelta, perfectClear }`, modeled on the existing headless `cascade-simulator.js`; have `physics.js` compute the full result first, then drive flash/gravity animation as a *replay of precomputed waves* | L | §2.2, §3.4, wasm |
| 5.3 | Make the sim fixed-tick: advance `processAutoDrop` **and** DAS/ARR in whole `simTickMs` quanta; move the DAS accumulator into snapshotted state; apply inputs on tick boundaries | L | §2.2, §2.8 |
| 5.4 | Unify the keyboard + gamepad DAS into one shared `advanceDas(state, ticks, config)`; wire gamepad advance into the local-MP loop on the same clock | M | §2.8 |
| 5.5 | Collapse the 3 game loops (+ hybrid path) onto one runner owning delta/pause/hit-stop/blind-timer; retire the `MAX_CONCURRENT_LOOPS` band-aid | M | §2.2 |
| 5.6 | Replace the 233,280-state LCG with mulberry32/xoshiro behind the existing `getState`/`setState` seam; convert replay to pure-input and delete the full-state checkpoint machinery | M | §2.2 |

**Exit criteria:** `(seed, input-frame-stream)` reproduces a bit-identical board; replay needs no state checkpoints; input is no longer blocked during cascades; one loop runner drives every mode; the Phase 1 double-apply band-aid is subsumed by tick-boundary input application.

---

### Phase 6 — Networking Decomposition & Wire Compaction  *(L, ~3–4 weeks)*

**Goal:** break up the 3,116-line god-class, harden the trust model structurally, and shrink the wire envelope.
**Depends on:** Phase 3 (protocol types) and ideally Phase 5 (a frame number to reconcile on). **Unblocks:** maintainable netcode, trustworthy results.

| Task | Effort | Traces to |
|---|---|---|
| Extract `ResyncCoordinator(network, getSnapshot, applySnapshot)` (lines ~1916–2126 + helpers — already stateful-by-Maps, lowest-risk first cut); reuse existing CRC32/base64 instead of the duplicate copies | M | §2.4 |
| Extract `NetworkHandlerRegistry` from `setupNetworkHandlers` (28 registrations) | M | §2.4 |
| Move `showCountdown`/overlay DOM code out to the UI layer | S | §2.4 |
| **Default-deny authority model:** make `_isSenderAllowedForMessage` reject all `game:*` control messages from non-host peers (supersedes the Phase 1 allowlist patch); tighten the pre-session accept-all branch to handshake types only | M | §2.4, §2.6 |
| **Compact the wire envelope:** drop rarely-changing per-packet fields (matchId/nonce/host/protocol) to handshake-or-on-change; single-char/CBOR keys; consider sending the binary buffer as the packet body for snapshot channels | M | §2.4 |
| Re-enable the InputValidator per-input interval check; implement "kick after N violations"; mark FFA results non-ranked unless a server-side validation story exists | M | §2.4 |

**Exit criteria:** no single networking file > ~800 lines; the 30 Hz delta envelope overhead drops from ~6× to near-1×; authority can't be spoofed by any `game:*` message; results have an explicit trust label.

---

### Phase 7 — Theme TSL Migration Completion  *(L, ongoing)*

**Goal:** finish the migration so WebGL2 becomes a *true* fallback, not a load-bearing path.
**Depends on:** Phase 3c (the WGSL gate, to verify each conversion TDR-safely). **Parallelizable** with Phases 5–6.

| Step | Task | Effort | Traces to |
|---|---|---|---|
| 7.1 | **Descope** `renderer.js` (WebGL1 background) + `WarpTransitionRenderer.js` as permanent WebGL components; document the boundary; redefine "done" = *every theme/Odyssey path constructs NodeMaterials only; no theme feeds a `WebGPURenderer` a GLSL `ShaderMaterial`* | S | §3.3 |
| 7.2 | Convert the ~16–20 **dual-state themes** first (build a `WebGPURenderer` *and* raw `ShaderMaterial`s — survive only via silent WebGL2 fallback) to NodeMaterials; verify each with short per-theme captures | L | §2.5, §3.3 |
| 7.3 | Convert the remaining WebGL2-only themes; the tripwire allowlist from Phase 3c trends to empty | L | §3.3 |

**Exit criteria:** the mixed-set allowlist is empty (or explicitly, intentionally non-empty with documented rationale); forcing WebGPU-only no longer breaks any theme.

---

## MOVEMENT D — Launch

### Phase 8 — Ship Polish & Launch Checklist  *(M)*

**Goal:** everything between "the engine is healthy" and "a Steam customer has a good first run." Can be done as soon as Movement A is complete (does not require B/C).

| Task | Effort | Traces to |
|---|---|---|
| Wire `CSC_LINK`/`CSC_KEY_PASSWORD` code-signing so the NSIS installer isn't unsigned (avoids SmartScreen); populate the empty `author` field | S | bundling-dx |
| Opus/Ogg re-encode the 337 MB audio/music; move large media out of `app.asar` via `asarUnpack`/`extraResources` so updates don't rewrite a 619 MB monolith; prune koffi's 17 non-win32 platform dirs | M | bundling-dx |
| Add a derived cold-boot KPI (`timeToInteractiveMenuMs`) with a regression threshold; time the intro WebGPU renderer import | S | §2.9 |
| Replace the bare `electronAPI.invoke` pass-through with named wrappers; add path/filename validation to `steam:cloud*` handlers; quote the `nameColor` style sink in `online-chat.js` | S–M | §2.6 |
| Write a documented ship checklist (sign → depot upload → version bump → smoke-test unpacked build); add the missing Steam depot-upload script | S | bundling-dx |

**Exit criteria:** a signed installer with the real AppID, a lean download, a measured cold-boot, and a repeatable release procedure.

---

## Sequencing notes & options

- **Fastest path to a first multiplayer release:** Phase 0 → Phase 1 → Phase 8. That's the correctness/security/blocker set plus signing and the ship checklist — roughly 2–3 weeks. Phase 2 is cheap enough to fold in. Everything in B/C is health, not a gate, *except* that shipping competitive/ranked results requires Phase 6's trust work.
- **If you can only do one large refactor:** do **Phase 5 (determinism)**. It subsumes a Phase 1 band-aid, unlocks the netcode reconciliation, fixes replay, and removes the cascade input-lag — the highest single architectural payoff.
- **Parallel tracks for a solo dev:** Phase 7 (theme migration) is mechanical and independent; it's a good "background task" to interleave between the heavier Phase 5/6 sessions, as long as the Phase 3c GPU gate is in place to verify conversions without risking the dev iGPU.
- **Two band-aids become real fixes later — keep them linked:** Phase 1's host-double-apply patch → Phase 5's tick-boundary input; Phase 1's authority allowlist patch → Phase 6's default-deny model. Leave a code comment on each Phase 1 patch pointing at its Phase 5/6 successor so the temporary fix isn't mistaken for the final design.
- **Where TypeScript pays off first:** the Phase 3a `PlayerSnapshot`/`EventMap` types should land *before* you start Phase 6, because the snapshot contract drift across 5+ sites is exactly the bug class the decomposition risks introducing.
