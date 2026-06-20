# Architectural Review & Recommendations: Serenity Blocks

*A candid Principal-Architect review of the working tree as it actually exists on disk (including the uncommitted WebGPU/TSL migration), not as the planning docs describe it. Every count and line reference below was measured against the code and then independently fact-checked by a second pass; where the brief's own figures were off, the corrected numbers are used and flagged.*

---

## 1. Executive Summary

Serenity Blocks is a genuinely ambitious solo project that is **much better engineered than its file count and god-classes suggest**, but it is **not yet ship-ready**, and the gap between "looks done" and "is safe to sell" is concentrated in a small number of high-blast-radius places.

**What is genuinely strong.** The cold-boot path, the Vite build configuration, the theme registry, the per-surface pixel-ratio performance policy, the Electron main-process security trifecta, the Steam P2P envelope/resync transport, and the SRS/lock-delay simulation core are all above the bar for an indie title — several are above the bar for a funded studio. The Odyssey WebGPU/TSL migration is effectively complete and clean: the live render path is NodeMaterial-native, the one remaining raw `ShaderMaterial` in the Odyssey tree is dead code, and the live `<chapter>.js` files import their validated `.tsl.js` builders directly (one source of truth, not a drifting pilot copy).

**What is actually wrong — and load-bearing.** Five issues stand out as correctness or release blockers rather than cleanup:

1. **`steam_appid.txt` is still `480` (Valve's Spacewar placeholder).** This is the single hard release blocker — a real build would initialize Steamworks against the wrong app, breaking leaderboards, matchmaking, achievements, and cloud saves.
2. **The host applies every input twice in the default multiplayer config.** With `useJitterBuffer` on (the default), `processPlayerInput` applies the input immediately *and then* re-applies the buffered copy a tick later, so one "move left" moves the host's piece two cells. This guarantees desync against client prediction.
3. **A non-host peer can seize host authority.** `game:host:migrated` is not in the host-authoritative message allowlist, and its handler unconditionally rewrites `hostSteamId` for any sender — after which every host-only message from the attacker is trusted. Full authority takeover in a host-authoritative model.
4. **The advertised desync-detection system is dead in production.** The DJB2 digest is computed but never serialized by the binary codec (the default path), so the comparison branch never runs and the chunked CRC32 resync it guards never fires unless JSON debug mode is on.
5. **Nothing automated tests or lints before deploy.** The only CI builds the web bundle and ships it to GitHub Pages without running the 398-test Vitest suite or ESLint — and ESLint is itself non-functional (98% of its 329,650 reported problems are CRLF noise from `core.autocrlf=true` with no `.gitattributes`).

**The strategic picture.** The "should we upgrade Phaser?" question is a category error: Phaser is a confined, well-isolated 2D-board renderer (~5,171 lines, no input handling, tiny API surface), not the project's strategic engine — Three.js is. The only Phaser action worth taking is leaving the **`4.0.0-rc.5` pre-release** for stable **4.1.0**, which also lets the defensive ESM shims in `main.js` be deleted. The real migration work is finishing the theme-layer TSL port so that WebGL2 becomes a *true* fallback instead of a load-bearing path that silently masks ~16–20 half-migrated themes. TypeScript (incremental `checkJs`, not a hard `.ts` rewrite) is high-leverage for the network protocol and dual-bus contracts; **WASM for the physics core is the wrong tool** and should be explicitly declined.

**Bottom line:** this is a shippable-quality engine with a handful of sharp, fixable defects and a missing automated safety net. Close the five blockers above, stand up a real CI gate, and finish the theme migration's "definition of done," and it is ready. The architecture does not need re-platforming before launch.

**Odyssey visual follow-up:** the engine review above remains the release-safety view. The chapter-by-chapter visual, layout, spline, level-orb, completion-star, and asset roadmap now lives in `docs/ODYSSEY_AAA_VISUAL_EXPERIENCE_REVIEW.md`; its recommended next order is 5-6 continuity polish, global path/orb/star hierarchy, Ch6 entry staging, Ch8 Retrosun/Gate Bridge, Ch2 manta/darkness, Ch3 CC0 asset pass, Ch7 disk-plane crossing, then Ch1/Ch4 hero polish.

---

## 2. Component Analysis & Honest Assessment

### 2.1 Rendering Pipeline & the 3-Tier Hybrid

**Verdict:** The 3-tier hybrid (Phaser WebGL board + custom WebGL1 background engine + Three.js WebGPU/TSL themes/Odyssey) is real but far better integrated than its description implies, and consolidating it is *not* the right pre-ship investment.

**What's good:**

- **The two WebGL stacks share one rAF.** The custom `WebGLRenderer` runs in "external render loop" mode and is pumped by Phaser's own `BackgroundScene.update()` (`background-scene.js:94,129-138`). So in single-player a single Phaser rAF advances both the board *and* the particle background; the only independent loop is the active Three.js theme. This is genuinely good engineering that de-risks the whole hybrid.
- **The per-surface pixel-ratio policy is mature and monotonic.** `desktop-performance-policy.js` defines a 6-tier × 7-surface pixelRatio cap matrix (Odyssey deliberately the lowest, as it is fill-rate-bound), funnels everything through `computeScenePixelRatio`, and adds a hysteresis-gated adaptive-resolution controller keyed off p95/p99 frame time. It is test-backed and well-designed.

**Liabilities:**

- **[HIGH] Device-loss handling is split across three incompatible conventions, and Odyssey has none.** There is a clean centralized module (`gpu-context-resilience.js`) that wraps both `webglcontextlost` and the WebGPU `device.lost` promise and re-broadcasts on the EventBus. **Camp 1** themes use it correctly (cosmic-noir, ocean, void-ember). **Camp 2** themes (moonlit-forest, ice-temple, stellar-velocity, stellar-drift, astral-weave, wolfhour) *shadow* the base helper with their own raw `addEventListener('webglcontextlost')` and never touch the bus — so a loss they observe is invisible to everything else. **Camp 3 is Odyssey, which has zero device-loss handling anywhere** (`OdysseyBoardController.initRenderer` never registers its WebGPU device). Odyssey is the most fill-rate-bound surface and the one that has historically TDR-bluescreened the dev iGPU; a lost device there currently leaves a frozen black canvas with no recovery.
- **[HIGH] Local multiplayer allocates one full Phaser WebGL context per player in a loop** (`LocalMultiplayerMode.js:2214-2217`). Four-player local play spins up four Phaser contexts on top of the background WebGL1 engine, approaching the browser/Electron ~16-context ceiling. The standard Phaser idiom (one `Phaser.Game`, N camera viewports) would collapse this to one context.
- **[MEDIUM] No central resize coordinator:** ~69 `resize`/`visibilitychange` listeners across 66 files, each querying `window.innerWidth/Height` independently. A single debounced EventBus broadcaster would remove the duplication and divergent throttling.
- **[INFO] Odyssey's lone raw `ShaderMaterial`** (the nebula plane, `OdysseyBoardController.js:1057`) is **dead code** — `createNebula()` has no live call site. It should be deleted so the Odyssey tree is verifiably `ShaderMaterial`-free.

**Strategic call:** keep the 2D-board / 3D-theme split. Phaser's batched primitives are a better fit for a tile grid than per-cell Three.js meshes, the migration is already done where it matters, and the real pain points (scattered device-loss, the local-MP context explosion) are fixable in days without touching the board engine.

### 2.2 State Management, Tick Model & Physics

**Verdict:** A competently built variable-delta game with a genuinely good fixed-step gravity accumulator and a thoughtful frame-indexed replay system — but **not** a deterministic fixed-timestep simulation, and several layers are quietly fighting that fact.

**What's good:**

- **Lock delay (500 ms) and the 15-reset limit are correct and clean** (`constants.js:166-167`, state machine in `game.js:188-237`), and the SRS kick tables (full JLSTZ + I, O short-circuit, 180-flip path, legacy fallback) are high-quality. This is the strongest engineering in the core; leave it alone.
- **`processAutoDrop` is a real fixed-step accumulator** (`game.js:827-871`): it drains `dropCounter` in fixed `dropInterval` steps, carries the remainder, caps catch-up at 32 steps, and clamps runaway backlog — so gravity is correctly frame-rate independent. The simulation already has `simTickMs`/`simTimeMs`/`simFrame`. The determinism win is ~70–80% already built.

**Liabilities:**

- **[HIGH] `GameState` is an open mutable god-object** (`game.js:363-553`): ~60 public fields, exactly one method (`reset`), mutated by free functions, physics, the demo restore path, and the network stack alike, with the board represented three redundant ways (`lockedPieces` / `boardGrid` / `boardCache`) kept coherent by hand. There is no boundary to refactor *behind* — which is the real cost driver for any future determinism or netcode work.
- **[HIGH] Three divergent game-loop implementations** drive the same `processAutoDrop` core: the recursive `gameLoop` (single-player/Serenity/Infinity/Odyssey), `LocalMultiplayerMode`'s hand-rolled rAF, and the `UnifiedMultiplayerLoop` singleton (plus a fourth hybrid `setTimeout` path in `frame-rate-controller.js`). The only guard against duplicate-loop runaway is a module-global `activeLoopCount` with `MAX_CONCURRENT_LOOPS = 2` — and the `// CRITICAL FIX: Schedule next frame ONCE` comment proves duplicate-rAF bugs have already shipped. A timing fix made in one loop silently misses the others.
- **[HIGH] Confirmed scoring drift.** The live level progression (15 lines/level) is hardcoded inside `physics.js:794-804`. Meanwhile `scoring.js` still exports `calculateLevel`/`getLinesUntilNextLevel` encoding a **10-line** progression that directly contradicts it — plus three other dead exports (`calculateLineScore`, `calculateSoftDropScore`, `calculateHardDropScore`). All five have **zero call sites** across `src/` and `tests/`. Two of them encode a wrong game rule; a future contributor reading `scoring.js` would reasonably conclude the game levels every 10 lines.
- **[MEDIUM] `isProcessingPhysics` blocks all input for the full async cascade duration.** `processPhysics` is a `while(true)` cascade that `await`s real animation delays (~70 ms of fades at cascade-1 plus 16 ms per gravity step), and input primitives early-return the entire time. Buffered move/rotate inputs are capped at 4; hard/soft drops during physics are dropped entirely. This couples *input latency* to *animation duration* at exactly the high-action moments.
- **[MEDIUM] `processPhysics` is a 350-line async `while(true)` that mutates the board it iterates** — correct under the single-owner assumption but re-entrancy-fragile (guarded only by the external flag), and its flood-fill uses `queue.shift()` (O(n) dequeue → O(n²)), which matters on Infinity-mode grids up to 1000 rows.
- **[LOW] `_pieceIdCounter` is a process-global** shared across every `GameState`, so piece IDs interleave non-deterministically across multiplayer boards and never reset — a latent determinism/isolation bug feeding the physics connectivity key.
- **[MEDIUM] Replay determinism rides on a weak 233,280-state LCG and wall-clock-derived timestamps**, and only works because the demo system records full-state **checkpoints every 300 frames** rather than pure-input replay. The need for checkpoints at all is the tell: a truly deterministic input-only replay wouldn't require them.

A deterministic fixed-timestep accumulator *would* be a net win for replay and netcode, but the refactor is gated by `GameState`'s lack of encapsulation, not by the loop. (See §4 for the staged plan; WASM is not the answer — §3.)

### 2.3 Modularity & Extensibility

**Verdict:** The plug-in architecture is genuinely good at its two oldest seams and progressively messier moving outward.

**What's good:**

- **The theme registry is the standout.** `theme-registry.js` declares 61 themes as plain data, derives policy from a `HEAVY_GPU_THEME_IDS` set, resolves modules via a single `import.meta.glob` (true lazy code-splitting), retries on chunk failure, and enforces a 10 s lifecycle timeout. The canonical theme list is *derived* (`THEMES = getThemeIds()`), not a second hand-maintained array. Disposal is thorough: `disposeThreeJSGroup` traverses and disposes geometries, materials, textures, and even uniform textures, and LRU eviction actually frees GPU memory while protecting the active theme. This is the model the other registries should follow.
- **`BaseGameMode` + `GameModeManager`** is a clean lazy `import()` factory with dependency injection that, to its credit, avoids `window` globals.

**Liabilities:**

- **[HIGH] Concrete modes reach around the contract** into DOM, network internals, and a duplicated loop. `OnlineMultiplayerMode` contains 118 direct `getElementById`/`querySelector`/`.style`/`classList` calls and statically instantiates the 3,116-line `FFAGameStateP2P` plus 14+ concrete UI widgets. `InfinityMode` doesn't extend `SinglePlayerMode` — it re-imports the core loop and re-emits the identical `LINE_CLEAR`/`COMBO`/`PIECE_LOCK`/`PERFECT_CLEAR` quartet, so that emit code is copy-pasted across 4–6 modes. `OdysseyMode` leaks debug handles onto `window`.
- **[HIGH] The dual event-bus split silently drops networked-opponent events.** `FFAGameStateP2P` emits opponent gameplay only on the *optimized* bus (`emitMultiplayerEvent`), while **55 theme files** subscribe only on the *synchronous* bus (`eventBus.on(EVENTS.LINE_CLEAR)`) and **zero** subscribe to the optimized one. The single bridge (`OnlineMultiplayerMode._registerEffectHandlers`) deliberately re-emits only the *local* player's clears, so theme visuals never react to a networked opponent. `MATCH_STARTED`/`GAME_OVER`/`PLAYER_TOPPED_OUT` exist only on the optimized bus with no `eventBus` equivalent. The "optimizer" adds real but narrow value (per-listener throttle/batch + error-isolated fan-out); folding those ~40 lines into the single bus and re-pointing the multiplayer events at it removes the entire silent-miss class.
- **[MEDIUM] Odyssey chapter truth is spread across five hand-synced lists** keyed by chapter id (`CHAPTER_CONFIGS`, `LEVEL_CONFIGS`, `CHAPTER_MODULE_LOADERS`, `CHAPTER_EXPORT_NAMES`, `ODYSSEY_CHAPTER_PROFILES`), plus an **orphaned `CHAPTER_ENVIRONMENTS` map** in `chapter-environments/index.js` that is imported by nothing and **already 2 chapters behind** (6 vs 8). Adding a chapter means touching all of them; a developer editing the visible-but-orphaned map would wire up nothing.
- **[MEDIUM] Adding a theme is nearly single-source but the `index.html` container div is a hand-synced shadow that has already drifted** — `chiral-gold` is registered but has no `<div>`, so its DOM activation silently no-ops. Generate the containers from the registry at boot.

**Extensibility today:** a new *theme* is the smoothest (registry entry + class + a div that should be generated). A new *mode* is contract-clean but copies ~1,000–2,000 lines of loop wiring. A new *Odyssey chapter* is the worst — five lists to keep in sync with no enforcing registry.

### 2.4 Multiplayer Networking

**Verdict:** More thoughtfully engineered than a solo-project god-class usually implies, but undermined by a cluster of correctness and trust bugs. **Shippable for friends/community FFA; not for competitive ranked play.**

**What's good (genuinely above the bar):**

- **The message envelope is real protocol hygiene:** `envelopeVersion`/`protocolVersion`/`matchId`/`matchNonce`/`hostSteamId` + per-channel monotonic `seq`, with `_validateEnvelope` rejecting version mismatches, enforcing match identity, and dropping replayed/out-of-order packets. `HOST_AUTHORITATIVE_MESSAGE_TYPES` + `_isSenderAllowedForMessage` prevents peers from forging authoritative state.
- **The chunked CRC32 resync is a proper reliable-transfer-over-messages implementation:** 16 KB chunks each CRC-checked, a sliding send window of 4, per-chunk retry (5 max, 300 ms timeout), ACK-driven window advancement, and receiver-side CRC verification before assembly.
- **Adaptive backpressure** caps per-peer pending to the latest snapshot and steps the send rate 30→20→10 Hz under drop pressure with hysteresis recovery. The decoder is defensively bounds-checked throughout (magic word, player/next-piece ceilings, `_assertAvailable` RangeErrors), and the main process caps inbound packets at 64 KB.

**Liabilities:**

- **[CRITICAL] Host applies every input twice (default config).** `useJitterBuffer` defaults on; `processPlayerInput` calls `_applyInputToPlayer` immediately *and then* buffers the same input, which `processBufferedInputs` re-applies a tick later. Since `move` is additive, one "move left" becomes two cells, a rotate becomes a double-rotate. This corrupts host-authoritative gameplay and guarantees desync against client prediction. **Fix: in the buffered branch, buffer only — don't apply eagerly.**
- **[HIGH] Authority-takeover hole:** `game:host:migrated` is not in the authoritative allowlist, and its handler unconditionally sets `this.network.hostSteamId = msg.data.newHost` for any sender. A malicious peer broadcasts it naming itself, then sends fully-trusted state. (Detailed in §2.6.)
- **[HIGH] DJB2 desync detection is dead on the default path.** `buildStateSnapshot` attaches `snapshot.digest`, but `BinaryEncoder` never serializes it and `decodeSnapshot` returns no `digest` field. With binary encoding on by default, `state.digest` is always `undefined`, so the 5-mismatch desync trigger — and the entire chunked-resync safety system it guards — never fires in production.
- **[HIGH] Host migration is partially wired and partly broken.** `FFAGameStateP2P.handleHostDisconnect` calls `this.hostMigration.handleHostDisconnect()` — **a method that does not exist** (guaranteed `TypeError`). The `GAME_HOST_MIGRATION_SYNC` handler feeds a raw, un-encoded snapshot into `syncFromHost` with no sender verification, and migration during an in-flight cascade/resync abandons transfer state.
- **[MEDIUM] The "~90% bandwidth reduction" is honest for full snapshots (~87% net at the wire after base64+JSON) but collapses for the dominant 30 Hz delta case**, where a ~45-byte binary delta rides inside a ~276-byte JSON envelope (≈6× overhead). The binary layer's cleverness is being dwarfed by an un-compacted, repeated-every-packet header. A CBOR/short-key envelope, or omitting rarely-changing fields, recovers most of it.
- **[MEDIUM] Anti-cheat is host-trusted-by-design (acceptable for P2P) but the peer-side validation is mostly disabled.** The per-input interval check is commented out (only a 140/s rolling window is active), `validateMove`/`Rotate`/`Drop` check enum shape only (no board-geometry/physics legality), and the "kick after N violations" TODO is unimplemented. For a Steam release, FFA results cannot be trusted for leaderboards.
- **[MEDIUM] `applyAttackScaling` comment lies about its behavior.** The doc-comment says scaling was *removed* and lines are returned unmodified; the code does the opposite (10%-per-extra-opponent reduction, floored at 0.25) and is live on the attack path. A balance bug waiting to be "fixed" in the wrong place.

**The god-class:** `ffa-p2p-game-state.js` is **3,116 lines** (the brief's "~3,084" is low) fusing seven responsibility clusters — roster lifecycle, transport wiring (28 handler registrations), input/anti-cheat, snapshot/sync, a full chunked-resync subsystem with its own CRC32/base64 helpers, prediction/reconciliation, and **raw DOM/CSS overlay rendering** (`showCountdown` builds a full-screen overlay with inline `style.cssText`). Lowest-risk first cut: extract a `ResyncCoordinator(network, getSnapshot, applySnapshot)` (lines ~1916–2126 + helpers, already stateful-by-Maps), then a `NetworkHandlerRegistry`, then move the overlay code to the UI layer. Leave the core sync loop last.

### 2.5 WebGPU/TSL Migration State & Quality Gates

**Verdict:** For the surfaces that ship, the migration is in good shape; the **quality-gate posture is the real risk**.

**Migration reality (measured; counts are grep-sensitive, so treat as ±a few percent):**

| Metric | Value |
|---|---|
| Raw `new THREE.ShaderMaterial` under `src/` | ~390 (in ~53 files) |
| `NodeMaterial` instantiations | ~440–460 (in ~76–80 files) |
| Files importing `three/webgpu` / `three/tsl` | ~170 / ~155 (of ~231 referencing `three`) |
| Theme files still building raw GLSL `ShaderMaterial` | ~47–50 |
| Theme files constructing a `WebGPURenderer` | ~12 (literal `new`) / ~25 (incl. aliased imports) |
| Themes doing **both** (WebGL2-fallback-dependent) | ~16–20 |
| Raw `ShaderMaterial` in the Odyssey tree | 1, and it is dead code |

- **[POSITIVE] The live Odyssey path is cleanly migrated and uses one source of truth.** The 8 live `<chapter>.js` files import their `.tsl.js` sibling's validated NodeMaterial builders directly (e.g. `surface-world.js` imports `createSkyBackgroundTSL` etc.), so there is **no live-vs-pilot divergence risk** — a concern an early reviewer raised was checked and refuted against the imports. `OdysseyBoardController` renders through a real `WebGPURenderer` with `forceWebGL` honored and backend detection.
- **[MEDIUM] The theme layer is the genuine GLSL holdout and silently leans on the WebGL2 fallback.** ~16–20 themes construct a `WebGPURenderer` *and* feed it raw GLSL `ShaderMaterial`s, which only work because three's WebGPU renderer transparently falls back to WebGL2. That makes WebGL2 a **load-bearing path**, not a fallback. If a future three release tightens fallback behavior, those themes break — and nothing would flag it. This is a fine *deliberate* split ("themes stay WebGL2, Odyssey goes WebGPU") but it is currently emergent and undocumented.
- **[CRITICAL] The only CI builds and deploys without running tests, lint, or any gate.** `.github/workflows/pages.yml` runs `npm ci` + `npm run build`, uploads `dist`, deploys to Pages. No `npm test`, no lint, no validation. No husky hooks exist. The only thing between a broken commit and a live deploy is whether `vite build` happens to succeed — which it will even if every shader is black, every test fails, and ESLint is red.
- **[HIGH] The one always-on shader guard asserts node-graph *construction* only.** `webgpu-tsl-build.test.js` calls every `*TSL` builder with `uniform(0)` and asserts it doesn't throw — its own docstring honestly notes it "does NOT exercise WGSL compilation (needs a GPU)." So WGSL compile errors, uniform-type mismatches, backend-specific divergence, device loss, and any visual regression all pass green.
- **[HIGH] All real GPU/visual/parity validation lives in manual scripts and HTML pages that nothing runs.** 25 node scripts + 30 HTML benchmark pages, none in CI. The "release gate" (`release-gate-check.mjs`) is **file-existence + substring-presence** checks — it greps for strings like `getReleaseGateSnapshot` in source, i.e. it verifies code wasn't *deleted*, not that anything *works*.
- **[POSITIVE] The Vitest suite is real and broad on logic** (67 files, 398 tests, ~3 s): scoring formulas, rotation edge cases, garbage, blind/handicap rules, the GPU-health classifier, and deep Odyssey state/layout tests that construct real TSL NodeMaterials under jsdom. The gaps map exactly onto the riskiest surfaces, though: **no Phaser-board test, no `renderer.js`/`WarpTransitionRenderer` test, no SRS/T-spin/7-bag kick-table test, and the 3,116-line netcode god-class is barely touched.**
- **[POSITIVE] The headless validation harness is well-built and TDR-aware.** `odyssey-webgpu-validation.mjs` boots each scene on a real `WebGPURenderer`, hooks `console-message` against a tuned shader-error regex, supports `ODYSSEY_FORCE_WEBGL=1` for backend-parity checks, captures one PNG per scene, and processes serially with short per-scene delays — exactly the TDR-safe pattern the hardware constraint demands. **Turning these into a gate is a wiring problem, not a build-from-scratch one.**

### 2.6 Electron & Web Security Posture *(cross-cutting; no single dimension owned it)*

**Verdict:** Main-process chrome is genuinely good; two real holes remain for a paid app ingesting untrusted P2P data.

- **[POSITIVE] Credit where due:** the single `BrowserWindow` runs `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`; navigation is locked with `will-navigate`/`will-redirect` guards and a `resolve()+startsWith` path allowlist (no `dist-evil/` bypass); `setWindowOpenHandler` denies all popups; and the preload exposes IPC only through allowlist `Set`s that throw on unknown channels. This is a materially correct Electron security checklist.
- **[HIGH] No Content-Security-Policy exists anywhere** — no meta tag, no `onHeadersReceived` header (repo-wide grep returns nothing; `index.html` has only charset+viewport). Any markup-injection bug runs unconstrained, and the renderer pulls Google Fonts with no constraint. Fix: install a strict CSP in the main process via `session.defaultSession.webRequest.onHeadersReceived` (covers `file://` too) and self-host the two webfonts. ~half a day, highest-ROI hardening.
- **[HIGH] Authority-takeover via `game:host:migrated`** (also flagged in §2.4): not in the authoritative set, mutates `hostSteamId` for any sender → full host-authority takeover. Fix: gate host-control messages off the *current* `hostSteamId` and make `_isSenderAllowedForMessage` default-deny all `game:*` control messages from non-host peers.
- **[MEDIUM] `electronAPI.invoke` is a generic pass-through** gated only by the channel allowlist. Acceptable today (every handler is defensive) but a latent footgun: combined with the missing CSP, one renderer injection reaches the full allowlisted IPC surface. Prefer named wrappers + per-argument validation on the `steam:cloud*` filename handlers.
- **[INFO/POSITIVE] The obvious XSS pivots are already closed:** both chat renderers HTML-escape peer text, and the binary decoder cannot be coerced into arbitrary object shapes. The application layer did the escaping the missing CSP would otherwise backstop — but that safety is one careless `innerHTML` from regressing, which is exactly why the CSP should ship as the structural guarantee.

### 2.7 Audio Subsystem *(cross-cutting)*

**Verdict:** The opposite of a leak/coupling liability — the hypothesized "two competing AudioContexts" does not exist in the live runtime.

- **[MEDIUM] There is exactly one live `AudioContext` owner** (`SoundManager`). The "second" manager (`utils/audio-manager.js`) is **dead code** — imported nowhere, never creates a context. It should be **deleted**, along with the permanently-false `loadBuffer`/`playBuffer` branch in `neon-district` that depends on its API and the no-op `audioManager?.stopAll()` cleanup guard.
- **[POSITIVE] Music is correctly streamed, not decoded at startup.** Only the 4.4 KB `songs.json` manifest is fetched at boot; tracks stream through one `<audio>` element on demand, and preload is explicitly skipped under Electron. The 256 MB catalog is a **download-size** concern (Opus re-encode), not a runtime-memory one.
- **[POSITIVE] The analyser is a session-lifetime singleton by design** — one `MediaElementSource` cached in a WeakMap (the Web Audio spec forbids a second source per element), so *not* disposing it on theme switch is correct. Disposing it would orphan the only source and silently kill all audio reactivity. The one real omission: `SoundManager.cleanup()` never calls `audioContext.close()` on app teardown (minor, single-instance). **Document the streamed-music + singleton-analyser invariants in the module header** so a future contributor doesn't "fix" it into a regression.

### 2.8 Input Pipeline & Determinism Origin *(cross-cutting)*

**Verdict:** The input layer is where the "determinism" story actually breaks, and no prior analysis traced it.

- **[HIGH] DAS/ARR is a wall-clock delta accumulator whose state lives on the `InputController` singleton, not in `GameState` and not in the recorded demo.** Replay survives only because the recorder stamps each *accepted* discrete move with `simFrame` — but live recording is non-deterministic: the same physical key-hold yields a different move count under a frame hitch than at steady 60 fps. A fixed-tick gravity refactor that leaves `updateDAS` reading wall-clock delta will produce a deterministic core fed by a non-deterministic input stream; bit-reproducibility will not be achieved.
- **[MEDIUM] Gamepad input is a second, independently-clocked copy of the same DAS math** (`gamepad-controller.js`, 2,073 lines) on its own RAF poll loop, and it is **not** wired into the LocalMultiplayer loop — so keyboard P1/P2 and gamepad P3/P4 can advance their repeats on two different timebases within one match. Consolidate both engines into one shared `advanceDas(state, ticks, config)`.
- **[MEDIUM] Anti-cheat and jitter-buffer admission both run on `Date.now()`**, so whether an input is even *admitted* depends on real-world arrival timing — a non-deterministic gate at the front door of any tick-deterministic model.

### 2.9 Startup / Cold-Boot *(cross-cutting)*

**Verdict:** One of the better-engineered parts of the codebase; the "3-context serial GPU init blocks the menu" fear is largely unfounded.

- **[POSITIVE] Only one GPU context (Phaser WebGL) is created on the critical path.** The WebGL1 background engine is constructed but idle until post-menu; WebGPU/Three is absent until the user enters a 3D surface (`main.js` has zero static `three` imports; all modes load via async factories). The Odyssey full-journey warmup — the real TDR hazard — runs only on entering Odyssey and is explicitly skipped at boot.
- **[MEDIUM] The awaited intro animation dynamically loads a WebGPU/Three intro renderer on the critical path** (`await introAnimation.show()` → `import('./threejs-intro-renderer-webgpu.js')`). It's a deliberate branded-intro trade, but it gates time-to-interactive-menu on a Three+WebGPU init. `?skipIntro=1` and the minimal profile already prove the menu works without it; generalize to "intro plays over an already-interactive menu."
- **[LOW] A hard 2000 ms minimum-visible overlay floor** can make fast hardware feel artificially slow. Make it a profiled, policy-driven constant, and add a single derived `timeToInteractiveMenuMs` KPI (the per-phase markers already exist but nothing aggregates them into the one number a Steam launch cares about).

---

## 3. WebGPU/TSL Migration & Engine Strategy (vs. the Current Hybrid Stack)

### 3.1 The Phaser question is mis-framed

Phaser is **statically imported in exactly four app modules** plus one dynamic import in `main.js`, totals **~5,171 lines** under `src/rendering/phaser/`, handles **zero input** (not one `this.input` reference in the tree), and uses a tiny, conservative API: a `Phaser.Game` with `type: WEBGL`, `Scale.NONE/FIT`, immediate-mode `Graphics` primitives, particle emitters, tweens, and camera shake. It is a *confined 2D board renderer bolted onto a Three.js-centric stack* — **not the strategic engine.** Three.js is, with ~231 referencing files and ~440–460 NodeMaterial instantiations.

Therefore: **chasing a "Phaser 4.1.0 Salusa upgrade" as strategy is a category error.** Phaser's WebGPU roadmap does nothing for the Three.js/TSL migration that is the actual center of gravity. The board does not need Phaser's WebGPU support; it needs to keep drawing a tile grid cheaply, which it already does well.

The board-scene integration is, separately, **genuinely good engineering**: scenes are built by `createBoardScene(phaserLib)` factories that take the Phaser reference as a parameter (no module-scope import), share a `BaseBoardScene`, disable audio/physics, and composite transparently over the WebGL background. The seams are in the right places.

### 3.2 The one Phaser action worth taking: leave the pre-release

`package.json` pins **`"phaser": "4.0.0-rc.5"`** exactly (no caret) — a *pre-release* shipped to end users. The defensive shims in `main.js` are not generic robustness; they are workarounds for the exact ESM-build defects of that RC:

- `import('phaser').then((module) => module.default || module)` — works around the RC having **no default export**.
- `PhaserRef.Scale?.NONE ?? 0` and `if (!Phaser.Game || !Phaser.Scene)` — work around **missing/unstable named exports**, with the `new PhaserRef.Game(config)` call wrapped in a try/catch that falls back to canvas.

Stable Phaser **4.0.0 "Caladan"** and **4.1.0 "Salusa"** now exist. The board uses none of the risky API (a `grep` for `RoundedRect` in the Phaser tree returns **zero** hits), so the upgrade is low-risk. Of the three options, **upgrade to stable 4.1.0** is clearly best: keep Phaser as the dedicated 2D-board engine, delete the ESM shims, and pick up the fixes. Keeping `rc.5` frozen is the worst option (ships an unreleased build, never receives fixes, bakes in the shims permanently). Absorbing the board into Three.js/Canvas2D is feasible but a real multi-week port — the **~1,489-line `shared-effects.js`** (line-clear flash, combo popups, radial/cascade waves, perfect-clear, hit-stop, hard-drop) is the cost, not the board quads (~1–2 days). **Do not do the port before shipping.**

### 3.3 Finishing the TSL migration: a real "definition of done"

The migration is the strategic axis and is ~50% done at the theme layer. Sequence it by risk:

1. **Descope the two intentional WebGL holdouts.** `src/rendering/renderer.js` (1,624-line WebGL1 background engine) and `WarpTransitionRenderer.js` (1,312 lines, 5 GLSL `ShaderMaterial`s) are self-contained, performance-tuned, and decoupled. Porting them is high-risk churn for no user-visible gain. **Document them as permanent WebGL components** and exclude them from "done."
2. **Redefine "done" as:** *every theme and Odyssey render path constructs NodeMaterials only; no theme constructs a `WebGPURenderer` that is then fed a GLSL `ShaderMaterial`.* WebGL2 becomes a true fallback rather than a load-bearing path.
3. **Convert the ~16–20 "dual-state" themes first** (those that build a `WebGPURenderer` *and* raw `ShaderMaterial`s and only survive via the silent WebGL2 fallback) — they are the highest-risk, lowest-visibility debt. Then the WebGL2-only themes. Verify each with the existing short per-theme capture scripts to respect the iGPU TDR constraint.
4. **Add a tripwire test** that scans theme files and asserts the "mixed" set matches a documented allowlist — turning an emergent state into a conscious decision per theme.

### 3.4 Consolidating the three GPU stacks: not now

A full collapse onto one Three.js renderer (orthographic board + themes + Odyssey under one WebGPU context) would cut single-player from 3 contexts to 1 and unify device-loss handling — attractive on paper. But it is a multi-month rewrite of the core gameplay surface for a benefit that mostly matters in the local-MP edge case, and the migration is already done where it counts. **The high-ROI moves are: unify device-loss resilience, fix the local-MP per-player context explosion, and delete the dead Odyssey `ShaderMaterial` — none of which require re-platforming the board.**

---

## 4. Strategic Recommendations & Upgrades

Ordered by leverage. Effort: **S** ≤ 1 day, **M** = days–2 weeks, **L** = weeks+.

### 4.1 Short-term — Release blockers & near-free wins (do before any Steam build)

| # | Action | Effort | Why |
|---|---|---|---|
| 1 | **Replace `steam_appid.txt` (`480` → real AppID)** in both root and `electron/`, and add a release-gate assertion that fails the build if it still reads `480`. | S | Hard release blocker — initializes Steamworks against Spacewar, breaking leaderboards/matchmaking/achievements/cloud. |
| 2 | **Fix the host double-apply:** in `processPlayerInput`, when `useJitterBuffer` is on, buffer only — don't call `_applyInputToPlayer` eagerly. Add a regression test (one "move left" = one cell). | S | Default-on correctness bug that doubles every host input and guarantees client desync. |
| 3 | **Close the host-authority hole:** gate `game:host:migrated`/`handoff` off the *current* `hostSteamId`; make `_isSenderAllowedForMessage` default-deny all `game:*` from non-host peers; tighten the pre-session accept-all branch to handshake types only. | M | Any peer can currently seize host authority and then send fully-trusted state. |
| 4 | **Install a strict CSP** in the main process via `onHeadersReceived` and self-host the two webfonts. | S | The one missing structural control on the renderer trust boundary; backstops every markup-injection sink. |
| 5 | **Stand up a real CI gate:** add a `test`+`lint` job (`npm ci` → `npm run lint` → `npm test`) and make the Pages deploy `needs: test`. | S | Converts an already-green 398-test suite from "run when remembered" to enforced — highest-value process change in the review. |
| 6 | **Add `.gitattributes` (`* text=auto eol=lf`) + `git add --renormalize .`** | S | Collapses ~324k of ~330k ESLint problems (98% are CRLF noise) and unbreaks Prettier — prerequisite for #5's lint to mean anything. |
| 7 | **Fix the dead desync digest:** move the DJB2 digest into the message envelope (survives base64/JSON) so the comparison and chunked resync actually run on the binary path. | S | The advertised desync/resync safety system is currently inert in production. |
| 8 | **Delete dead code with false signal:** the orphaned `createNebula()`/`createAmbientParticles()` in Odyssey, the five dead `scoring.js` exports (two encode a *wrong* rule), the orphaned `CHAPTER_ENVIRONMENTS` map, and `utils/audio-manager.js` (+ its dead `neon-district` branch). | S | Each is a documented trap that misleads future work; deletion is behavior-preserving. |
| 9 | **Correct the `applyAttackScaling` comment** to match the live 10%-per-opponent scaling, with a pinning unit test. | S | Comment asserts the exact opposite of live behavior — a balance bug waiting to happen. |

### 4.2 Short-term — Quality & hygiene

- **(S) Upgrade Phaser `4.0.0-rc.5` → stable `4.1.0`** and delete the ESM/Scale shims in `main.js`; smoke-test the five `Game` configs. **(S) Move `phaser` to `dependencies`** (runtime-critical; current placement breaks `npm ci --omit=dev` and under-reports it in audit/SBOM).
- **(S) Slim the installer:** move `three` and the **entirely-unused `jimp` tree** (~463 asar entries, zero references) to `devDependencies` so electron-builder stops packing them; `three` currently ships twice (790 asar entries + the 1.5 MB dist chunk).
- **(M) WGSL-compile CI for Odyssey:** run the existing `odyssey-webgpu-validation.mjs` on a GitHub-hosted runner with a software WebGPU backend (Dawn/SwiftShader), scene-by-scene, once with WebGPU and once with `ODYSSEY_FORCE_WEBGL=1`. Sidesteps the dev-iGPU TDR risk entirely and catches the WGSL-compile/parity classes the build test cannot.
- **(M) Unify the two event buses:** fold throttle/batch/error-isolation into `event-bus.js`, re-point `multiplayer-events.js` at it (keep `ffa:` as a namespace), and emit opponent gameplay on the unified bus. Deletes the silent-miss class.
- **(S) Generate theme-container divs from the registry at boot** (fix `chiral-gold`); **(M) replace the substring "release gate" with one behavioral assertion per subsystem** plus a Phaser-board smoke test, a binary-protocol round-trip test, and an SRS/T-spin kick-table table-test — the three untested high-blast-radius surfaces.

### 4.3 Long-term — Architecture

- **(L) Extract a pure, synchronous `resolveCascade(boardGrid, lockContext) → { boardAfter, waves, holeMasks, scoreDelta, perfectClear }`** out of `processPhysics`, modeled on the existing headless `cascade-simulator.js`, then drive the flash/gravity animation as a *replay of precomputed waves*. This separates "what happened" (deterministic, testable, shareable with the bot AI) from "how it animates," removes input-blocking, and converts replay to pure-input. **This is the necessary refactor that WASM would also require — done in JS it is the whole job.**
- **(L) Make the sim fixed-tick end to end:** advance `processAutoDrop` *and* DAS/ARR in whole `simTickMs` quanta, move the DAS accumulator into snapshotted state, and unify the keyboard + gamepad DAS engines. Without quantizing *input* onto ticks, a fixed-tick gravity core is still fed a non-deterministic move stream. This is the real netcode/anti-cheat/replay prize. Then collapse the three game loops onto one runner and replace the 233,280-state LCG with mulberry32/xoshiro behind the existing `getState`/`setState` seam.
- **(L) Begin the god-class decomposition** with `ResyncCoordinator` → `NetworkHandlerRegistry` → overlay-to-UI, reusing existing CRC32/base64 helpers.
- **(L) Introduce a `StandardGameLoopMode`** between `BaseGameMode` and the single-board modes to own the loop wiring + event quartet that is currently copy-pasted across 4–6 modes; consolidate Odyssey's five chapter lists into one `CHAPTER_REGISTRY` mirroring the theme registry.

### 4.4 The two language questions, answered

**TypeScript — adopt incrementally, do *not* rewrite.** The simulation core and especially the network protocol are riddled with hand-maintained structural contracts that types would bind for free: the per-player snapshot shape is duplicated across 5+ sites (a rename silently writes `frags || 0` and round-trips a wrong value with no test failing), and `EVENTS.LINE_CLEAR` is emitted with **5 incompatible payload shapes** across the modes. The build is already TS-ready (esbuild transpiles the 7 `tornado/*.ts` files today; `typescript 5.9.2` and `@types/three` already resolve in `node_modules`). **Recommended Path A:** add a `tsconfig.json` (`allowJs`/`checkJs`/`noEmit`, `strict:false`), scoped via `include` to `src/core` + `src/events` only (avoids three.js node-material type-lag), wire `tsc --noEmit` into CI, and create a `types.d.ts` with `PlayerSnapshot`/`StateSnapshot`/`GameState`/`EventMap`. First 10 files in dependency order: `constants.js`, the new `types.d.ts`, `board.js`, `physics.js`, `game.js`, `binary-encoding.js`, the snapshot build/apply in the god-class, both event buses, `scoring.js`. **~3–4 focused weeks part-time, front-loaded on the protocol** where defects are hardest to reproduce. A hard `.ts` migration of all 584 files would take months and fight three.js type-lag ~40× across the WebGPU themes for marginal extra safety — **not justified.** Dispose of the `tornado/*.ts` orphans (currently ~14 strict `tsc` errors, several false positives from the untyped base class, never checked) by either renaming to `.js` or folding them into the checked island.

**WebAssembly for the physics core — decline, and record why.** Every premise fails against the evidence. There is **no perf bottleneck**: the cascade flood-fill runs on a fixed **240-cell integer grid**, a few times per second, gated by *tens of milliseconds of cosmetic animation delay* — WASM would shave microseconds off a routine bounded by VFX timing. There is **no float-determinism problem**: every board mutation is integer-indexed; floats appear only in cosmetic animation timing. The real determinism leak is the variable-delta tick model and wall-clock input (§2.8), which WASM does nothing to fix. A pure-JS deterministic resolver **already ships** in `cascade-simulator.js` (zero rendering coupling), proving the core extracts cleanly. And the JS↔WASM boundary would force the heterogeneous `{id,type,color}` board across the line every lock, adding a marshalling/debugging seam plus a Rust/AssemblyScript toolchain into Electron+Vite — recurring cost, zero gain, for a solo unshipped project. *If* the bot-AI placement search ever profiles as hot (the only place the sim runs uncapped), optimize `cascade-simulator.js` in pure JS first (index cursor instead of `queue.shift()`, scratch-buffer reuse).

---

## 5. Proposed Future Architecture Stack

The recommendation is **evolution, not revolution.** The current stack is sound; the changes below harden it without re-platforming.

### Rendering
- **Keep the 2D-board / 3D-theme split.** Phaser stays the dedicated board renderer, upgraded to **stable Phaser 4.1.0** (shims deleted). Three.js WebGPU/TSL remains the strategic surface.
- **One device-loss convention:** all themes + Odyssey route through `gpu-context-resilience.js` and the EventBus; Odyssey's WebGPU device gets registered with a real recovery handler.
- **Migration "done" = WebGL2 is a true fallback.** `renderer.js` (WebGL1 background) and `WarpTransitionRenderer.js` are documented permanent-WebGL components; every theme/Odyssey path is NodeMaterial-native; the ~16–20 dual-state themes are converted; a tripwire test enforces it.
- **One Phaser context in local MP** (multi-viewport), not one per player. One debounced resize broadcaster.

### Simulation
- **A pure, synchronous `resolveCascade` core** shared by gameplay, bot AI, and replay; animation becomes a replay of precomputed waves.
- **Fixed-tick everything:** gravity *and* DAS/ARR advanced in `simTickMs` quanta, accumulator in snapshotted state, one shared DAS module for keyboard + gamepad, one loop runner, a strong seeded PRNG. Replay becomes pure-input (checkpoints deleted); netcode gains a frame number to reconcile on.
- **`GameState` gains a read/write boundary** so future work has something to refactor behind.

### Networking
- **`FFAGameStateP2P` decomposed** into `ResyncCoordinator` + `NetworkHandlerRegistry` + a UI layer + a slim core sync loop.
- **Default-deny authority model:** all `game:*` control messages from non-host peers rejected; host-control messages gated off the current host identity; the DJB2 digest lives in the envelope so desync/resync actually fires.
- **Compacted wire envelope** (CBOR/short keys, drop rarely-changing per-packet fields) so the binary delta layer's savings survive transport.

### Types, Build & Quality Gates
- **Incremental `checkJs`** over `src/core` + `src/events`, with `types.d.ts` binding the snapshot and event contracts; `tsc --noEmit` in CI. No hard `.ts` rewrite. No WASM.
- **CI that actually gates:** lint (post-`.gitattributes`) + the 398-test Vitest suite on every push/PR, plus a SwiftShader/Dawn WGSL-compile run of the Odyssey validation harness on a hosted runner. The "release gate" becomes behavioral, not substring-presence.
- **Honest dependency manifest:** `phaser` in `dependencies` (pinned, then `^4.1.0`); `three` and `jimp` out of the runtime dep set; the `jimp` tree removed from the installer.
- **A leaner installer:** Opus-re-encoded audio and large media moved out of `app.asar` (via `asarUnpack`/`extraResources`) so the 619 MB monolith shrinks and delta-patching becomes viable.

### Security & Release
- **CSP enforced from the main process** (covering `file://`), self-hosted fonts, named IPC wrappers with per-argument validation on filename handlers.
- **A real ship checklist:** real `steam_appid.txt`, code-signing (`CSC_LINK`/`CSC_KEY_PASSWORD`) wired so the NSIS installer isn't unsigned, populated `author`, a depot-upload step, and a cold-boot `timeToInteractiveMenuMs` KPI with a regression threshold.

---

*Prepared from a direct read of the working tree. Where this review's figures differ from the original brief, the corrected, independently-verified numbers were used — most notably: `ffa-p2p-game-state.js` is **3,116** lines (not ~3,084); the Vitest suite is **67 files / 398 tests** (not 49); the Odyssey `.tsl.js` builders **are** the live render path (imported directly by the `<chapter>.js` files), so there is no live-vs-pilot divergence risk; and the audio layer has **one** live `AudioContext`, not two. All counts in this document are grep-sensitive and were taken against the tree at review time.*
