# Serenity Blocks — repository audit

**Date:** 2026-10-03 · **Tree:** `main` @ `3d50d88e` · **Scope:** all of `src/` (~500K LOC), `electron/`, build/CI/config, `scripts/`, docs and agent-instruction surfaces (incl. Claude memory).

> **Status: a record, not a backlog.** Findings and line numbers describe `main` at `3d50d88e`
> (2026-10-03). Harvest open items into the roadmap before executing them; re-verify any line
> reference first — the tree has moved.
>
> **Fixed in the change set that added this file** (branch `fix/audit-quick-wins`, each with tests):
>
> | Audit item | Fix |
> |---|---|
> | #2 match cannot end after host migration | `FragTracker.isHost` reads the owning game state live |
> | #2 rejoin impossible | transport accepts a NET_HELLO with a new join nonce and forgets that sender's sequences; the host treats it as a reconnect |
> | #4 one packet hangs the host | peer attack requests are whitelisted, bounded, round-fenced and rate-limited in `ffa/attack-request.js` |
> | #6 chat keys move pieces, keys stick after alt-tab | text-entry guard in the keyboard handler, key isolation on the match chat input, held input released on window blur |
> | #5 Parhelion / Serenity Warp blank after prewarm | no inline opacity on lazily created theme containers; `BaseTheme.resume()` clears inline visibility |
> | #5 disposed Odyssey board never dies | `_disposed` flag checked by every self-rescheduling loop, the init tail and the chapter loader; `GameModeManager` only clears the mode it installed |
> | #1 Infinity expands mid-cascade | legacy expansion deferred while physics is processing |
> | #9 docs "fix first" | SFX instructions marked unavailable (`C:\AI` is gone); orphan r181 skill copy deleted and a mirror-equality test added; executed plans carry a status banner; AI-addressed prompt docs archived; CONTRIBUTING rewritten; RECOMMENDATIONS deleted; umbrella plan gained §0a status corrections |
>
> These are verified by unit tests, typecheck, lint deltas and the fitness gates only. The theme and
> Odyssey fixes have not been exercised in the running app, and nothing here has been through a
> two-machine Steam session.
>
> Still open from the suggested first sessions: the line-clear helper and T/J/L kick fixes (both change
> outcomes and need a rules-version decision), removing the dead warp transition, the boot-failure
> screen, the `wireV2` decision before 2026-10-31, and everything under #3 (Steam).

**Method.** Nine parallel static reviewers (core rules, multiplayer/networking, rendering + Odyssey, theme lifecycle, theme frame-time, app shell/UI/audio/boot, Electron/build/CI/deps, dead code/repo hygiene, docs/agent instructions), each instructed to verify every claim by reading code and to check the umbrella plan + ADRs before calling something a flaw. Nothing was executed at runtime: no tests, builds, Electron or GPU work (three peer sessions were active and the iGPU has a TDR history). Claims marked **✔** were re-verified by the coordinator against the code; the rest were verified by a reviewer reading the code; **(plausible)** marks mechanism-level claims that need a runtime check.

Paths are repo-relative. `ffa` = `src/core/multiplayer/ffa-p2p-game-state.js`.

---

## Part 1 — Top 10 improvements, most → least critical

### 1. Gameplay rules have real bugs on the default path, and the test strategy is structurally blind to them — **Critical** · S per fix, M with rules-versioning

The legacy path is the default (`fixedTick`/`cascadeV2` are off), so these hit every player.

- **✔ Line clears shift piece fragments *up*.** `removeClearedLines` (`src/core/cascade-helpers.js:154-173`) drops a locked piece's shape rows that sit on cleared lines but keeps `p.y`, so every row of that piece *below* a cleared line moves up one row. Locked pieces keep their full 3×3/4×4 matrices including empty rows (`game.js:1215-1220`, `constants.js:70-104`).
  - A flat I directly below a cleared row "hops" into it, falls back, and is marked *moved* → extra holes in multiplayer garbage (reviewer repro on the real `resolveCascade`: wave-2 hole mask `[0,1,2,3,9]` instead of `[9]`).
  - Multi-row shifts overlap other pieces → a block vanishes (repro: 28 − 10 = 18 cells expected, 17 remain).
  - Both cascade paths share the helper (`physics.js:922`, `:1242`; `cascade-resolver.js:315`), so the §5.10 legacy-vs-resolver differential gate can never see it.
- **✔ T/J/L SRS kicks are mirrored left↔right.** T/J/L spawn flat-side-up (`constants.js:80-104`) — that is SRS state 2 — but the kick lookup treats spawn as state 0 (`game.js:963-964`). Every T/J/L kick is x-negated; guideline TSD/TST setups fail near walls. (If NES-style spawn is deliberate, e.g. for legal distance, offset the lookup by 2 for T/J/L.)
- **Legacy Infinity expands the grid mid-cascade.** `_maybeExpandGrid()` runs from the draw callback with no physics check (`InfinityMode.js:957-960`); expansion shifts every piece +10 rows (`infinity-grid.js:62-98`) while `processPhysicsLegacy` holds `fullLines` across its await (`physics.js:712` → `:922`) → the wrong row is deleted and the real full row clears as a phantom wave 2 (score inflation). The fixed-tick path already guards this (`InfinityMode.js:1027`).
- **Inputs pressed during clear animations (≥ ~200 ms, `physics.js:67-109`) are dropped in Infinity, Odyssey and Local MP.** The buffering gate in `enqueueSinglePlayerCommand` checks main.js's own idle `GameState` (`main.js:3722-3747`, created `:2529`), not the active mode's; only Single Player installs a dispatcher (`SinglePlayerMode.js:741`). Even SP rejects during hit-stop *before* buffering (`SinglePlayerMode.js:787-801`), and the hard-drop hit-stop outlives the next spawn (`game.js:1309-1312`).
- **Odyssey "combo" objectives measure cascade depth.** `triggerCombo(cascadeCount)` (`physics.js:725-727`) feeds `victoryEvaluator.onCombo` (`GameplayHybridEngine.js:190-194`), while level text and modifiers define combo as consecutive clears (`levels.js:671`, `ModifierStack.js:46-53`; the real counter `gameState.comboCount` is never read). 18 bonus objectives and 9 star tiers (e.g. L55 "Reach 18x combo") are effectively unreachable; this caps the `odyssey_stars` stat/leaderboard.
- **Local 3–4 player attack scaling is computed but never applied** (`multi-player-state.js:647` vs `:680-746`; online applies it at `ffa-attack-router.js:289-300`) → 1.33–2× intended garbage. A bounding-box top-out check (`main.js:4677`) also kills valid spawns after garbage.
- **Single Player replays diverge after any frame > 50 ms.** Sim time advances by the raw delta (`game.js:1393`) while gravity/lock use the clamped delta (`:1345`, `:1428`); replay steps unclamped (`DemoPlayer.js:412-423`). "Watch again" can show a different game; the §5.10 banked-log corpus is not reproducible.
- **Fix.** Fix each (S). Bump the rules version for outcome-changing fixes (§5.8) so old demos still replay. Add *independent* oracles the differential suite lacks: a fast-check cell-conservation property over `resolveCascade` (cells after = cells before − 10 × lines), guideline SRS/T-spin fixtures per piece and orientation, a record → replay round-trip with injected stalls, and an Odyssey objective-semantics test.

### 2. Online multiplayer breaks whenever a player leaves, rejoins, or the host changes — **Critical** · M

- **✔ Departures are never detected.** `LOBBY_PLAYER_LEFT` has a handler (`ffa:832`, `:1166-1175`) but no sender exists anywhere; the transport's disconnect monitor has no callers (`steam-networking.js:2227-2262`); Electron never forwards Steam lobby-member-left; peers merge the host roster but never remove (`ffa:1128-1157`); host-loss detection is off outside `playing` (`host-migration.js:39-42`). Consequences: ghosts are revived every round (`ffa:4040-4056`), soak garbage and lower attack scaling (`ffa-attack-router.js:281-294`), occupy slots, count in rematch votes, and can win the host election — which has no timeout (`host-migration.js:73-91`) → the match hangs. A host who quits from the waiting room/results strands every peer.
- **✔ Rejoining the same lobby is impossible.** `_validateEnvelope` drops any `seq ≤ last seen` per sender (`steam-networking.js:1767-1774`); the record is cleared only on a full lobby reset (`:1564`), while a rejoiner restarts its counters → its hello is dropped as a replay 12 times and the joiner waits forever.
- **✔ After a host migration the match can never end.** `FragTracker` caches `isHost` in its constructor (`frag-tracker.js:14`); `promoteToHost` (`ffa:3803-3850`) updates `attackRouter.isHost` but not the frag tracker, so `recordDeath`/`checkMatchEnd`/`endMatch` return early on the new host. `HOST_MIGRATED` has no subscriber.
- **Clock skew discards a player's inputs.** The validator rejects inputs whose peer `Date.now()` differs > 5 s from the host's (`input-validator.js:42`, `:118-130`) and still acknowledges them (`ffa:1508-1518`); no offset estimation exists.
- **Previous-round garbage lands in the next round** (attack requests carry no round id: `ffa:3176-3179`, `:936-958`; cascades survive `reset()`).
- **Timers outlive teardown:** the rematch `setTimeout(restartFullGame, 1000)` (`ffa:1413`) and ready-barrier timers survive `cleanup()` and can run `startMatch` on a disposed object, wiping a newly joined match; `HostMigration.startMonitoring` orphans its interval (`host-migration.js:29-49`); in-game chat leaks a document keydown listener per game object.
- **Wasted bandwidth:** reliable `GAME_SYNCPOINT` broadcasts on every lock/clear busy↔idle flip (`join-syncpoint.js:155-169`) that no peer reads — ~100+/s in an 8-player lobby on Steam's single reliable queue.
- **Fix.** Forward Steam lobby-member-left → `removePlayer`; host liveness from the existing peer→host `NET_PING`; send `LOBBY_PLAYER_LEFT`; peers adopt the host roster wholesale; election timeout with next candidate; reset a peer's seq record on an accepted hello (or add a per-session sender nonce); `FragTracker.isHost` as a getter; round id on attack requests; remove the absolute clock check; fence all timers in `cleanup()`. Then actually run `docs/TWO_MACHINE_STEAM_VALIDATION.md` (exists, run log empty) — it would have caught four of these.

### 3. Steam integration does not work as shipped — **Critical before launch** · S–M

- **✔ A release build initializes Steam as Spacewar (480).** `resolveSteamAppId()` (`electron/steam-integration.js:86-99`) reads `STEAM_APP_ID` (Steam sets `SteamAppId`), then `steam_appid.txt`, else `DEFAULT_STEAM_APP_ID = 480` (`:44`). `scripts/afterPack.cjs` deletes `steam_appid.txt` from every release build, so the hard-coded 480 *is* the release path. The release gate checks only the txt files, not code constants (`src/core/steam/steam-config.js:9` = 480; `src/core/steam/config.js` reads `process.env`, which doesn't exist in the sandboxed renderer). `restartAppIfNecessary` is never called.
- **✔ Leaderboards, cloud saves, achievements and friends are wired to APIs that don't exist.** steamworks.js 0.4.0 exposes `achievement, apps, auth, callback, cloud, input, localplayer, matchmaking, networking, overlay, stats, utils, workshop`; the code probes `leaderboards`/`userStats`, `remoteStorage*`, `achievements`, `friends` (`steam-integration.js:491-528`) → all null. `uploadScore` always returns "Leaderboard not found" (8 call sites across 4 modes). ez-steam-api, which has leaderboards/achievements, is started (`:474-475`) and never used.
- **Lobby browser throws on real lobbies:** Steam returns BigInt member counts (`:996-997`); `lobby-browser.js:247` divides them by Numbers → TypeError (mock lobbies use Numbers, hiding it).
- **(plausible) Steam overlay is never enabled** — the `electronEnableSteamOverlay` switches aren't applied and Steam loads after `did-finish-load`; friend-invite dialogs depend on the overlay.
- **Nothing tests the configuration players get.** The build job is push-only (`.github/workflows/pages.yml:75-77`), so `vite build`, the boot-closure guard, `check:ip-strings` and `check:pages-artifact` run only after merge; `scripts/build-win.mjs:124` runs bare `vite build` (release artifacts skip the boot-closure guard); no packaged smoke test exercises the CSP, sandboxed preload, or the real steamworks API.
- **Fix.** One AppID constant compiled into main and renderer; `restartAppIfNecessary` in packaged builds; remove the 480 fallback (go offline instead); gate on any literal 480 under `electron/` and `src/core/steam/`; wire leaderboards/achievements through ez-steam-api and cloud through `client.cloud`; convert BigInt at the IPC boundary; a contract test of every probed name against `client.d.ts`; run the build on PRs; a packaged smoke job (`electron-builder --dir` on windows-latest).

### 4. Trust boundaries: network → host, network → DOM, and the Electron shell — **High** · S–M

- **✔ The host trusts peers' attack summaries.** `calculateGarbage` takes wire `depth` unbounded (`src/core/garbage.js:446-465`): `{depth: 1e9, sendForPerfectClear: true}` loops ~5×10⁸ times → host hang/OOM ends the match for everyone; smaller forged values kill all opponents. No rate limit, phase/round check, or plausibility check against the host replica (`authoritativeAttacks` is off).
- **Anyone on Steam can enter a private lobby.** P2P sessions are auto-accepted (`steam-integration.js:312-324`), hellos are accepted without a lobby-membership check (`join-handshake.js:117-192`), kicks keep no ban list, and before auth one sender can grow the seq map without limit via a sender-chosen `channel`.
- **✔ The CSP is probably inert in packaged builds.** It's installed only via `webRequest.onHeadersReceived` (`electron/main.js:539`) while packaged builds use `loadFile` (`:648`); `index.html` has no `<meta>` CSP; Electron's security guidance says header CSP can't be used for `file://`. The code comment assumes it works; the project's own research note (`docs/architecture-evidence/2026-07/research-electron.md:19,31`) left it unverified. Meanwhile peer/lobby strings reach `innerHTML` unescaped: chat colour into `style` (`ingame-chat.js:99-105`, `match-results-modal.js:232-266`), lobby `end_condition`/`status` (`lobby-browser.js:246-276`), kill-feed counts, imported demo `gameMode` (`demo-browser.js:93-111`). `utils/dom-safety.js` exists but only 3 files import it (10 have private escapers).
- **Electron 38.8.6 / Chromium 140 is six majors behind.** Dependabot proposes 44.4.5 (`origin/dependabot/npm_and_yarn/dev-tooling-9cb53d5027`, 2026-10-01) but `dependabot.yml:10-12` groups it with vite 8, vitest 5 and TypeScript 7, so it never merges; the hard audit (`--omit=dev`) can't see Electron.
- **No Electron fuses; dev hooks live in the shipped exe:** RunAsNode/NODE_OPTIONS/`--inspect` work; packaged builds honor `STEAMWORKS_MODULE` → `await import(override)` in the main process (`steam-integration.js:355-359`), `SERENITY_ENABLE_DIAGNOSTICS` (CDP on 9222, `main.js:440-459`) and `SERENITY_DISABLE_CSP` (`main.js:529`).
- `will-navigate`/`window.open` hand any http(s) URL to `shell.openExternal` (`main.js:109-120`, `572-585`).
- **✔ Winter, Koi Pond and Summer download the Draco decoder from gstatic.com at runtime** (`winter-trees.js:76`, `koi-pond-forest.js:400`, `summer-meadow.effect.js:53`): breaks offline, and conflicts with `connect-src` if the CSP is enforced.
- **Fix.** Bound and rate-limit attack requests and check phase/round now (S); host-derived attacks later (§6B.1). Accept P2P and hellos only from lobby members; keep a ban set. Escape-by-default helper plus a lint rule against template-literal `innerHTML`. A build-time `<meta>` CSP with hashes, or an `app://` protocol, plus a packaged smoke test asserting `eval` throws. A separate Dependabot group for electron, upgraded under an ADR-0018-style capture protocol. `build.electronFuses`; strip dev hooks when packaged; an `openExternal` allowlist (never from `will-navigate`); self-host Draco under `public/`.

### 5. Async lifecycle has no single owner: blank backgrounds, zombie Odyssey boards, leaks, silent boot failures — **High** · S–M

- **✔ Boot-prewarm / mode-entry race → blank background** (root cause found independently by two reviewers). "Hidden" is a flag on the theme object (`theme._prewarmHidden`, `theme-manager.js:1530`), cleared only in the warm's own `finally` (`:1666`); any `start()` running meanwhile takes BaseTheme's hidden branch (`base-theme.js:229-237`), which removes `.active` and never re-adds it. Prewarm publishes no promise; mode entry only awaits `switchDrainPromise`. Three windows: entry during the warm's `start()`, entry during its frame loop, and the deferred `initial-theme-prewarm` task (`main.js:857`, cancel handle discarded) firing during the first click's activation. A common trigger: any key during the studio logo skips the intro without cancelling the prewarm.
- **✔ Parhelion and Serenity Warp go blank deterministically after a successful prewarm.** They have no static div; `ensureThemeContainer` creates one with inline `opacity: '0'` (`theme-registry.js:559-568`); the hidden start never clears inline styles and `resume()` only adds `.active` (`base-theme.js:864-876`).
- **✔ Odyssey teardown is a flag flip, not cancellation.** The background warm sweep reschedules every 500 ms while `!this.isActive` (`OdysseyBoardController.js:1744`); there is no disposed flag, so after `dispose()` it runs forever and retains the whole board (scene, One World data, 8 MB relief map). Same pattern in the prewarm drain (`:1589-1592`), the chapter loader's `setTimeout` chain (`ChapterEnvironmentManager.js:953-1003`), and the resize debounce. While parked during a level, the loader keeps running several-hundred-ms synchronous chapter builds.
- **Mid-build exit creates a zombie board and can clobber the current mode.** `initialize()` awaits ~18 times and ends with `isActive = true; animate()` (`:1233-1234`), undoing a mid-build dispose; the following `onLevelSelect` assignment throws, and `GameModeManager` clears `currentMode` without checking identity (`GameModeManager.js:225-235`) — e.g. a Steam invite during board build fails with "No mode is currently active".
- **VRAM retained per Odyssey visit.** `oneWorld.dispose()` is never called; shared noise textures (lattice 64³, lake 128³ half-float, Earth Core 96³ float) are never disposed; r186 texture dispose listeners keep old renderers reachable. On iGPUs, VRAM exhaustion is a device loss.
- **✔ A dead warp transition is built on every board show.** `_applyLevelTheme`, its only consumer, has no callers, yet `_preInitWarpTransition()` runs (`OdysseyMode.js:3522`, `:3581`) and builds a full-window MSAA WebGLRenderer plus 5 GLSL ShaderMaterials (2.9–5.9 s cold stalls per its own note), retained for the session. ~2.1K dead lines.
- **Boot failures are invisible.** `__serenityStartupShell.fail()` writes to `#startup-shell-status`/`#startup-shell-detail`, which no longer exist (`index.html:2595-2606`) → any pre-bootstrap failure leaves a permanent animated logo. The watchdog's degraded path then reads `app.gamepadController` on a null `app` (`main.js:5230`). The Electron main process has no `render-process-gone`/`unresponsive`/`did-fail-load` handling, and its logs are off by default in packaged builds.
- **Safe-mode suspend leaks.** `suspendThemes` calls plain `stop()` (`theme-manager.js:1759-1766`); heavy themes keep their GPU runtime, and moonrise-summit orphans a WebGL context per mode enter/exit.
- **Fix.** One cancellation token per async surface: a ThemeManager-owned prewarm/switch/resume sequence where hidden is a per-call `start()` option and "container active + visible" is a postcondition; an `OdysseyBackgroundScheduler` owning every timer with a disposed check after every await; delete the warp path; a visible boot-failure state with Restart / Safe mode; Electron crash handlers. Add tests for dispose mid-build, mid-sweep and 3× enter/exit.

### 6. Input has no owner: chat keys move pieces, keys stick after alt-tab, controllers get trapped — **High** · S now, L structural

- **✔ Typing in the online match chat moves, rotates and hard-drops your piece.** The keydown handler only exempts `.key-input` (`src/ui/controls.js:573`, `:822`); `#chat-input` (`index.html:1367`) isn't one. Space (hard drop) is `preventDefault()`ed, so spaces can't even be typed. The chat's Enter-to-focus targets a nonexistent `#match-chat-input` (`ingame-chat.js:20-21`).
- **Held keys stick across alt-tab.** DAS and latches clear only on `visibilitychange` (`controls.js:779-787`), which alt-tab doesn't fire in Electron (`backgroundThrottling: false`); there is no `blur` handler.
- **Controller players can't leave game over.** A/B/X/Y/Start all call `startGame()` (`gamepad-controller.js:668-733`) while menu navigation is disabled for that modal (`modals.js:62-64`, `:92`).
- **Root:** input flows through `window.move/rotate/softDrop/hardDrop`, which modes overwrite and restore (`SinglePlayerMode.js:720-741`, `OnlineMultiplayerMode.js:2800-2846`, `LocalMultiplayerMode.js:2113-2156`). `main.js` (5.7K lines, 56 `window.*` globals) holds copy-pasted P1–P4 input functions. This is also why item 1's dropped inputs exist.
- **Fix.** S: ignore events from input/textarea/select/contentEditable; on window `blur`, clear DAS, latches, `keyMap` and pad timers; add game-over pad navigation. L: an input router with a context stack (menu / gameplay / text entry / hub), one command gate keyed to the active `GameState`, and modes registering handlers instead of patching `window`.

### 7. The theme contract is advisory, so frame pacing, resolution and quality settings reach only part of the fleet — **High on the target hardware** · S–M per item

- **✔ The Target Frame Rate cap is bypassed by 28 of 62 themes (23 GPU-heavy).** The cap lives only in `BaseTheme.shouldRenderFrame()`/`safeAnimate()` (`base-theme.js:1262-1348`); themes with their own rAF loop that call neither (e.g. stellar-velocity, sky-children-v2, aurora, sunset, neon-dusk, galaxy, pyrestorm) render every refresh. High-refresh panels draw 2–4× the target, and a "30 fps" battery choice does nothing in 45 % of themes. `docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md:411-413` claims all themes obey; they don't.
- **✔ Dynamic resolution only ratchets down.** 16 per-theme controllers compare vsync-locked frame intervals with fixed targets. ice-temple on WebGPU targets 8.33 ms (`ice-temple-theme.js:572-576`) and is fed the inter-frame delta (`:5079`), so at 60 Hz it always decays to its 0.60–0.64 floor. sky-children steps down and permanently disables post; neon-district/neon-dusk never scale up; golden-forest and stellar-drift hit the floor at Target 30; lunara's knob is a no-op on WebGPU. The global controller **persists** lowered render scales into the player's settings (`main.js:1123-1134`, `persist: true`) and runs only while the FPS overlay is on. Correct implementations exist: nimbus-veil, synthwave-sunset, chromadelic, and black-hole (GPU timestamps).
- **Settings don't propagate.** Quality, Render Scale and AA changes reach ~13 themes over three different channels; ~49 read `window.settings` only in `createScene` (38 private quality getters). The Odyssey board reads quality once at init and never uses Render Scale.
- **First-event stalls.** ~18 themes create geometry and materials inside line-clear/combo handlers; only 3 implement `getWarmupRoots()`, so the first effect of a session compiles pipelines synchronously in play (70–190 ms measured for this class in Stillwater).
- **Also:**
  - 28 themes have no GPU device-loss handling.
  - The coordinator's 1-attempt cap resets on every re-registration.
  - The WebGL1 background overlay canvas is cleared, resolved and composited every frame even when empty.
  - ~11 composer themes pay for MSAA they never get.
  - 71 of 95 TSL noise/hash functions lack `setLayout`, spread across 5 forked noise libraries.
  - ~30 hand-built post stacks; quality-preset resolution scaling is a no-op in several.
  - winter builds its GLSL scene on WebGPU's WebGL2 backend (`winter-theme.js:1456-1563`) — the ADR-0019 black-screen class.
  - 47 raw resize listeners remain.
- **Fix.**
  - A BaseTheme-owned frame driver: one rAF, cap, pause and hidden handling.
  - One shared resolution controller: expected frame time = max(1000/target, refresh interval); steer on GPU time or missed frames; never persist automatic downscales; decouple it from the FPS overlay.
  - One settings hook, and one renderer-adoption point (`initializeRendererCandidate`) that wires resilience, viewport and settings.
  - A shared post builder; promote the Odyssey TSL noise library to `src/rendering/tsl/`.
  - One fitness rule per policy: theme rAF must go through the driver; no materials or geometry created in event handlers; `setLayout` required.

### 8. Finish or cut the dark migrations, and put every switch under governance — **Medium-High (architecture)** · M

- The determinism/netcode groundwork is best-in-class but has shipped dark since mid-July, and the legacy defaults carry the bugs in items 1–2:
  - `fixedTick`, `cascadeV2`/`prepareResolvedPhysics`, integer DAS, session RNG, `wireV2`, `authoritativeAttacks`.
  - Core sim files were last touched Aug 10–11; MP and the umbrella plan Jul 28.
  - Since late July, ~85 % of changed `src/` files are in rendering/themes/playground.
- **✔ `wireV2` expires 2026-10-31** (`src/core/flags.js:121`), and `tests/unit/flag-registry.test.js:7` compares against the real clock → **CI turns red on 2026-11-01** unless someone decides. `rngV2` has no reader; `simTickNetcode` is now only an alias.
- ~130 URL flags in production code are unregistered, including ≥10 rollback switches. 15 of 17 `reader: 'local'` flags read only the URL, but the packaged app loads `file://` with no query (`flags.js:5-8`), so rollback levers are unusable for players and support.
- Simulation-affecting flags (`garbageDrainAll`, `peerLocalSim`, `garbageIdempotent`, …) are read per machine and never negotiated (`ffa:279-384`; the welcome's `featureFlags` is always empty) → a stale localStorage value desyncs a peer permanently.
- The `core-nondeterminism` regex misses `Math.random` used as a value (`game.js:577`, `:709`), so the ratchet undercounts.
- **Fix.**
  - Sequence the cutovers (fixedTick → cascadeV2 → rngV2); run the §5.10 soak; flip defaults; delete legacy and flag together.
  - Decide `wireV2` before Oct 31.
  - Route every flag through `readFlag` with a localStorage fallback, and ban raw `URLSearchParams().get` for registered names.
  - The host puts sim flags in the match config, and peers adopt them.

### 9. Agent-facing docs and instructions are steering agents wrong — **Medium-High for an AI-driven workflow** · S–M

See Part 2 for the full cleanup plan. Headlines:

- **✔ CLAUDE.md and AGENTS.md send every agent to `C:\AI\sfx-foundry\generate-sfx.cmd`, which doesn't exist** — the Blackwell machine is gone per `docs/ASSET_PIPELINE_BLACKWELL.md`.
- **✔ An orphan r181 copy of the WebGPU skill (`.agents/webgpu-threejs-tsl/`) tells agents `RenderPipeline` "does not exist"** — wrong for the pinned 0.186.1, and it surfaces in searches.
- **The 174 KB umbrella plan is 2+ months stale.**
  - Many open or regressed items are already done in code: §1.2–§1.5, §2.5, §2.6, §2.9, §4.1, §4.5, most of §4.7.
  - A "SUPERSEDED SNAPSHOT" table still sits inside it.
  - It never mentions r185/r186 or ADR-0015–0020.
- **Executed plans still say "NOT STARTED", "PLAN ONLY" or "Do this first"** (5 Odyssey plans, 5 root `PLAN-*.md`).
- **✔ CONTRIBUTING.md is an AI task prompt** pointing at RECOMMENDATIONS.md, which describes a nonexistent `script.js` in "the Quadra game".
- **Operating rules live only in Claude's private memory,** so Codex never sees them.

### 10. Ship size, repo weight, and dead code — **Medium** · S–M

- **Installer:**
  - `build.files` lacks `!node_modules/**`, so electron-builder copies production node_modules into app.asar: phaser 111 MB and three 23 MB (both already bundled into dist), koffi 85 MB with 18 platform builds — **(plausible)** 100+ MB of dead payload.
  - 257 MB of music sits inside the asar with no `asarUnpack`.
  - 79 MB of WAV voice lines (two are 26 MB each).
  - ~51 MB of unused `public/` assets (63 unreferenced theme images, 21.7 MB; 19 MB of thumbnails never loaded; …).
  - No `publish: null`.
- **Repo:**
  - 1.01 GB tracked tree, 1.89 GiB history, no LFS; `public/playground-refs` is 141 MB and dev-only.
  - `reports/` (159 MB) holds 59 JS files, including a frozen 4,926-line copy of `cosmic-noir-theme.js` that shows up as a duplicate definition in searches.
  - ~6.5 GB of ignored local output on a nearly full C: drive.
- **Dead code is small (~5K LOC, ~1 %) but misleading:**
  - Dead duplicates of core functions: `pieces.js`'s biased-sort 7-bag and stub kicks, and `board.js`'s second flood fill, with tests that cover the dead copies.
  - main.js two-player scaffolding, pinned by a test.
  - The dead warp transition.
  - 930 LOC of sky-core vegetation.
- **God files growing outside the ratchet:**
  - `OdysseyBoardController.js`: 2,813 → 4,631 lines since July.
  - `odyssey-world-renderer.js`: 696 → 4,723, including a single 3,846-line `createOdysseyWorld`.
  - 15.5K LOC of production theme code lives under `src/playground/`.
- **History hygiene:** bulk commits with misleading messages — `e8df4db2` "Add unit tests for theme lifecycle and selection events" is 286 files, +61.6K/−28.1K. Since June there are 38 commits of ≥100 files or ≥10K lines.
- **Fix:**
  - Packaging: add `"!node_modules/**/*"`, `asarUnpack` for music, Opus for voice/music, and `publish: null`.
  - Repo: delete dead assets; use LFS or an external store for references/evidence; stop committing JS copies, logs and profiles into `reports/`.
  - Code: delete the dead duplicates and their tests; add line ceilings for the rendering god files and an unused-export ratchet.
  - Commits: one logical change per commit, with an honest message.

---

## Part 2 — Docs & agent-instruction cleanup (the user's explicit request)

### Fix first (an agent following these today does the wrong thing)
1. **SFX block** in `CLAUDE.md:34-41` and `AGENTS.md:34-41`, plus `.agents/skills/stable-audio-sfx/SKILL.md` (auto-triggers on any game-sound request), `.agents/workflows/generate-sfx.md` and `docs/SFX_GENERATION_WORKFLOW.md` (indexed "Active — Required"). `C:\AI` doesn't exist. Replace with one "currently unavailable" line, mark the workflow Dormant, add a `Test-Path` stop guard, and remove the `C:\AI` MCP paragraph from `docs/WEBGPU_THREEJS_WORKFLOW.md:145-150`.
2. **Delete `.agents/webgpu-threejs-tsl/`** (22 files, r181, wrong API advice).
   - Fix `AGENTS.md:30`, which points at `~/.codex/skills/`; Codex reads `.agents/skills/`.
   - Fix the skill-update procedure in `WEBGPU_THREEJS_WORKFLOW.md:173-174`. It says "re-pull upstream, copy over .claude/skills", which would wipe the repo-specific r186 checks and never update the mirror.
   - Re-stamp the two "(three r185)" headers.
   - Add a hash-equality test between `.claude/skills` and `.agents/skills`.
   - Old worktrees (chromadelic, newtheme, perflane) still carry an r185 skill: prune the merged ones, but check sl-ribbon and sl-world first, which may hold parked uncommitted work.
3. **Umbrella plan** (`docs/ARCHITECTURAL_REMEDIATION_PLAN.md`, 174 KB, last touched 07-28):
   - Re-verify statuses (see Part 4).
   - Move the §3 superseded snapshot and the July notes into an appendix or archive.
   - Produce a ≤300-line `docs/ROADMAP.md` as the live status page.
   - Cite other plans by filename. "Plan item 2.1" means different things in the R185 plan and the umbrella plan.
4. **Executed plans still marked unstarted** — archive or stamp "EXECUTED → see <record>":
   - `ODYSSEY_NORTH_ISLAND_LAKE_PLAN_2026-08` ("NOT STARTED"), `ODYSSEY_GHIBLI_WATER_PLAN_2026-08` and `ODYSSEY_ACT_II_SEAM_AND_OCEAN_PLAN_2026-08` ("PLAN ONLY"), `ODYSSEY_ACT_I_REBIRTH_PLAN_2026-08` ("PROPOSED", 121 KB), `ODYSSEY_ACT2_FOREST_VISIBILITY_PLAN_2026-08` ("Not implemented") — all landed.
   - The 5 root `PLAN-*.md` ("Rank 1 of 5. Do this first."), whose P0/OD markers are all in code (#306).
5. **Prompt-style docs:**
   - Archive `docs/architectural-review-prompt.md`. It is "You are an expert Principal Game Architect…", with a "verified — do not re-litigate" section that is now false (no typecheck, two buses, no fixed tick).
   - Archive `docs/ODYSSEY_CREATIVE_DIRECTOR_IMPLEMENTATION_PROMPT.md`. Following it would overwrite a 142 KB doc.
   - Rewrite `CONTRIBUTING.md` for humans. It is currently an agent task prompt that also asks for FPS metrics, conflicting with ADR-0016.
   - Delete `RECOMMENDATIONS.md`.

### Restructure (one source of truth per concern)
6. **One canonical agent guide.**
   - `AGENTS.md` becomes canonical, ≤150 lines: stack, commands, verification loop, operating rules, doc map.
   - `CLAUDE.md` becomes `@AGENTS.md` plus Claude-only notes.
   - `.agents/rules/webgpu-validation.md` becomes a pointer.
   - Move the memory-only operating rules in:
     - PR CI doesn't build; run `npm run build` before merging.
     - Never kill Electron globally.
     - Never leave files staged while peer sessions run.
     - The worktree `node_modules` junction means `npm ci` in one breaks all.
     - Scripted edits must keep LF line endings.
     - Electron script args must use `--key=value`.
     - Use the GPU lock for captures.
   - Fix the Codex MCP mismatch: AGENTS.md says chrome-devtools, but Codex has playwright.
7. **Verification instructions vs. practice.**
   - CLAUDE.md says "one small effect per session" via the MCP. The 2026-10 passes ran four parallel sessions with Electron captures on the RTX, serialized by `C:\Users\olov_\repos\odyssey-gpu\gpu-run.sh`, which is unversioned and refers to removed worktrees.
   - Move the GPU lock and protocol into the repo.
   - Change `odyssey-chapter-capture.mjs:48`'s default settle from 350 → 2500 ms. That fixes the trap in code, after which the memory note can go.
   - Reword ADR-0007 and CLAUDE.md to match the per-chapter, GPU-locked practice.
   - Fix the false playground-is-a-build-input claim (`WEBGPU_THREEJS_WORKFLOW.md:99-100`, ADR-0015).
8. **Memory (outside the repo):**
   - Fixed in this session: `theme-perf-lane.md` claimed two commits had "landed" that exist only on the unmerged `feature/game_improvements_20260724`.
   - Also stale: `odyssey-seamless-pass.md` still lists pre-merge steps.
   - Promote project facts into AGENTS.md or ADRs; track bugs in the repo backlog, not memory.
   - Prune from 22 files to ~8 pointers.
   - Rule: memory may point to a doc but must never be the only home of a bug, decision or protocol. Example: `ODYSSEY_PERF_MENU_DWELL=1500` exists only in memory, while the script defaults to 0.

### Root documents
| Path | Action | Reason |
|---|---|---|
| README.md | rewrite, **keep the Legal block verbatim** (required by `pages-artifact-check.mjs:40`, `ip-string-gate.mjs:33`) | rc.5 Phaser, "Three.js/WebGL", 6 of 7 doc links dead; ships in the Pages artifact |
| HOW_TO_RUN.md | merge useful bits into README, delete | `testSteam()`/`testFFA()` helpers don't exist; Linux commands |
| PHASER_QUICKSTART.md, public/README.md | delete | stale (rc.5; `/workspaces/quadra`) |
| CREDITS.md, steam_appid.txt | keep | functional |
| tetris_legal_review.md, quadra-provenance-attestation.md | **move** to `docs/legal/` (update cites in pages.yml, ip-string-gate, palette check) — never delete | legal |
| game_description.md, single_player_death.md | keep / move with legal docs | audited by the legal review |
| AUTO_DROP_*.txt ×2, RECOMMENDATIONS.md, PHASE_1_COMPLETE.md | delete | fixed/obsolete |
| PERFORMANCE_STABILITY_AUDIT.md, PERF_REMEDIATION_LOG.md, ODYSSEY_MODE_PERFORMANCE_AUDIT.md | archive under `docs/archive/2026-07-perf-audit/` (update code-comment refs) | dated records; one "done" item is contradicted by code (overlay canvas, Part 1 #7) |
| PLAN-*.md ×5 | archive, marked DONE (#306) | executed |
| CONTRIBUTING.md | rewrite for humans | agent task prompt |

### docs/ clusters — one entry point each
- **Odyssey** (52 docs, ~1.7 MB): new `docs/odyssey/README.md` as the entry point. Keep ~8:
  - the four 2026-10 records;
  - `ONE_WORLD_PLAN` (closed record);
  - `BACKGROUND_COMPILE` and `WORLD_BAKE_WORKER` (design contracts);
  - `LAVA_LAKE_REMAKE` (Stage 2).

  Archive the other ~44.
- **Multiplayer** (17): entry points are ROADMAP Phase 6, `ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18` and `TWO_MACHINE_STEAM_VALIDATION` (mark Active). Downgrade `ONLINE_MP_CURRENT_STATE_FIX_PLAN` to Reference. Archive 12, after harvesting the 3 open items from `QUADRA_EXPERIENCE_NEXTLEVEL`.
- **Winter** (9):
  - Entry point: `WINTER_SNOWFLOW_MASTERPLAN_2026-08` (add it to the index).
  - Keep `FOX_PAW_TRAILS_AAA` and `BLIZZARD_COMBO`.
  - Archive the other 6. `DISTANT_TREES` and `ICE_IMPRESSIVE` describe scene parts the snowflow remake disconnected.
- **Vesper Chrysalis** (4): keep V4, archive the rest.
- **Stillwater** (6):
  - Entry points: BAUER (art direction) and MASTERPIECE_PLAN (engineering ledger).
  - Turn `PRODUCTION_RENDERER_DECISION` into an ADR.
  - Keep `WAVES_4_8`, flagged for its dead evidence links.
  - Archive `RENDERER_DECISION` and `WAVE3_EVIDENCE`.
- **Starlight** (3): keep the 2026-07 review; archive 2.
- **Chromadelic** (5): keep the 2026-09 overhaul plus art direction; archive the upgrade plan, the QA checklist (34 unchecked boxes for the pre-#318 theme) and the baseline protocol.
- **three.js** (6): entry point is `THREE_UPGRADE_R185_TO_R186_2026-10`. Keep the r181→r185 record (ADR-0018's template). Retitle or fold the R185_FAST plan. Merge the 3 `UPSTREAM_*` docs into one, re-checked on 0.186.1.
- **Misc archive:** architectural-review-prompt, ARCHITECTURAL_REVIEW, repository-cleanup/review plans, ASSET_PIPELINE_BLACKWELL (move machine facts to AGENTS.md first), June perf audits, infinity-mode-implementation-plan (72 unchecked boxes for a shipped mode), HALCYON_APEX.
- **Index hygiene:**
  - Index the 35 unindexed docs (~1.2 MB, including the live release checklist and the current Stillwater/Winter direction).
  - Move the 8 Superseded docs still in the `docs/` root into the archive.
  - Define or remove the undefined "Plan"/"Design" statuses.
  - Mark or repair the 137 broken links: ~120 point into the gitignored `artifacts/`, likely lost with the RTX 5080 machine.
  - Give `docs/archive/` a README and exclude it, plus `reports/`, from default search (`.ignore`/`.rgignore` — confirm the agent search tools honour it).

### Target structure + enforcement
- **Root:** README, CREDITS, CONTRIBUTING, AGENTS and CLAUDE only.
- **Skill:** one source in `.claude/skills/`, mirrored byte-for-byte in `.agents/skills/`.
- **`docs/`:**
  - `INDEX.md`: every doc listed with a status and a last-verified date.
  - `ROADMAP.md`: the live status page, ≤300 lines.
  - `adr/`: decisions.
  - `<area>/README.md`: one entry point per cluster.
  - `records/YYYY-MM-*.md`: session records, immutable after merge; open items are copied into ROADMAP when the record is written.
  - `legal/` and `archive/`.
- **Enforcement:** add `docs:*` metrics to `scripts/architecture-fitness-check.mjs`. It already runs on every PR and is shrink-only, so it can land before the cleanup is finished. Metrics:
  - unindexed docs (35 → 0);
  - statuses from the defined set;
  - Superseded docs live under `archive/`;
  - root `.md` allowlist;
  - skill-mirror hash equality;
  - version strings in AGENTS/README/skill match `package.json`;
  - every `npm run x` and relative link in agent-facing files resolves;
  - Active/Tactical rows verified within 60 days.
- **Numbers:**
  - Inventory: ~666 tracked `.md`/`.txt` files. Recommended: archive ~92, delete ~31, merge ~5, move 2 legal, update ~12.
  - Default agent path: ~2.7 MB of current-looking docs leave it.
  - Required pre-structural-change reading drops from ~67K to ~30K tokens.

---

## Part 3 — Further findings by area (beyond the top 10)

**Core:**
- `REPLAY_VERIFIED` on leaderboard uploads compares metadata against itself (`replay-proof.js:62-79`), so it's meaningless.
- Every SP game is force-recorded despite the setting (`SinglePlayerMode.js:377-378`).
- The demo browser loads up to 200 full demos to render a list (`DemoManager.js:131-156`).
- `cascadeV2` path: 4× `JSON.stringify` per lock (`physics.js:1064-1098`).
- Legacy path: ≥3 grid rebuilds per lock, each allocating per cell. §5.1's "one grid, no rebuilds" didn't happen.
- 233,280-state LCG piece RNG: predictable after ~2 bags; legacy Infinity/Odyssey are unseeded.
- The Gravity Cascade modifier does nothing.
- `MAX_CONCURRENT_LOOPS` can never trip.

**Multiplayer:**
- The board-shape desync is invisible: digest = score/lines only (`ffa:2281-2283`, `snapshot-codec.js:105-119`).
- The HUD RTT is overwritten by a cross-clock value 30×/s (`OnlineMultiplayerMode.js:1273-1275`).
- Receive path: one IPC call per packet.
- Snapshots are serialized once per peer.
- `registerAttackerIds` is never called, so kill credit goes to `unknown_<hash>`.
- The heartbeat/disconnect subsystem in steam-networking (`:2125-2293`) is dead.

**Rendering/Odyssey:**
- Effect Quality and Render Scale never reach the Odyssey board.
- The first automatic resolution drop compiles a sharpen-wrapped post graph synchronously (`odyssey-tsl-pipeline.js:656-676`; plausible).
- Board resume keys off "parked", not "paused", leaving a frozen map in a 1.2 s window.
- WebGL1 background particles are frame-rate dependent (`renderer.js:367-560`).
- Per-frame Set/string churn in ghost/active outlines (`base-board-scene.js:1263-1449`).
- The `shared-effects.js:1963-1994` cap guard is inverted, so it never destroys anything.
- The OdysseyLayoutEditor ships as an unreachable lazy chunk.

**Themes:**
- Theme switches can't preempt (A→B→C fully builds B and switches music).
- Level/Random background modes switch themes mid-game without a loading surface.
- The adjacent-preload cache holds almost nothing.
- neon-district's line-clear lightning, dolly and Tetris sky flash have never fired: it subscribes to the nonexistent `EVENTS.LINES_CLEARED` (`neon-district-theme.js:8729`) and reads `data.lines` instead of `lineCount`. electric-dreams-v3 and himalayan-peak subscribe to nonexistent `GAME_OVER`/`GAME_START`. `setKnownEvents` is never enabled in dev.
- The prewarm fallback's whole-scene `compileAsync` ignores MRT themes (`theme-manager.js:1645-1662`; plausible blank objects under `?themeWarmAsync=0`).
- Non-theme code imports theme internals: the intro renderer → `themes/shared/bloom-dispose.js`, breaking the boot-import rule, and `core/constants.js` → a registry that now has DOM code.
- 3 themes ignore the render-scale and GPU-safety pixel-ratio caps (cinder-drift, electric-dreams-v3, singing-bowl).
- geode updates 15–70K stars per frame for ripples that are never created.

**Shell/UI:**
- No notification service: `serenity:toast` (kicked / lobby full / version mismatch) has no listener; ~28 window events, several with no listener (`return-to-menu` vs `returnToMenu`); 22 native `alert`/`confirm` calls that a controller can't navigate.
- Minimize/restore can stack duplicate theme render loops (plausible; ~29 of 58 loop starters lack guards).
- Settings: no schema or versioning; every slider tick does a full localStorage write and broadcast.
- Replay "Share Link" builds a `file://` URL leaking the install path.
- `index.html` is 169 KB: settings modal 64 KB, four copy-pasted player cards 32 KB.

**Platform/build:**
- `build.esbuild` (`vite.config.js:252-256`) isn't a Vite 5 option, so console stripping is ignored and 1,692 `console.log` ship.
- The `/vendor/webgpu-inspector.js` absolute path can never load in packaged builds.
- `check-boot-closure.mjs` breaks on paths with spaces.
- A second instance still reaches `createWindow`.
- "Borderless" keeps the frame.
- The release window shows a View menu with Reload (F5 mid-match).
- The `set-active-gpu-renderer` stub means software-renderer detection never runs.
- Lint, typecheck and depcruise skip `electron/`; `env.node` hides `process` use in renderer code, which is the root of the renderer-side 480.
- The lint ratchet is one total, so formatting fixes can pay for new real errors.
- The SBOM tool is fetched unpinned at release time.
- `build:linux` can never start Steam.

**Dead code/hygiene:**
- 4 orphan modules plus 6 unused shader files.
- 170 dead exports (~3.2K LOC).
- 38 unreferenced scripts (7.7K LOC; one drives a deleted flag).
- `rebuild-greenworks.sh`, `serve.sh`, `start-dev.sh` are obsolete.
- `vesper-chrysalis-theme-icon.png` is byte-identical to Stellar Drift's.
- OdysseyMode still lists the deleted theme id `electric-dreams` as heavy, giving its successor 900 ms less loading budget.

---

## Part 4 — Umbrella-plan statuses that are stale (re-verified 2026-10-03)

| Plan item | Plan says | Code today |
|---|---|---|
| §1.1 Steam AppID | open; afterPack "no-op" | gate + release strip landed; AppID constant, `restartAppIfNecessary` open — and the strip made the hard-coded 480 the release path (Part 1 #3) |
| §1.2 desync detection | regressed | fixed (`ffa:358` default-on, consecutive-mismatch + rate limit); but the digest is score/lines only |
| §1.3 sender validation | 5 holes | fixed (catalog enforced in `_isSenderAllowedForMessage` + handler checks); lobby-membership gap remains |
| §1.4 impairment harness | ungated | fixed (localStorage only in mock/dev/`?netImpair`) |
| §1.5 gamepad DAS | dead | fixed (`main.js:2269`) |
| §1.7 two-machine doc | missing | exists; run log empty |
| §2.5 deps placement | open | fixed (ADR-0001) |
| §2.6 shadow tests | open | fixed (`d0323465`); 0 unrun test files |
| §2.7 containers | open | partial — `ensureThemeContainer` wired; caused the Parhelion/Serenity Warp blank bug |
| §2.9 demo settings | open | fixed (`DemoRecorder.js:244-255`) |
| §2.10 tornado .ts | open | typechecked; still not linted |
| §4.1 event bus | open | core fixed (one bus, isolation, once/off); deferred deliveries un-isolated, name guard never on in dev |
| §4.2 device loss | Odyssey zero, Camp 0 ~38 | Odyssey WebGPU-only; 28 themes still unhandled |
| §4.4 viewport | open | broadcaster exists; ~47 theme folders still raw |
| §4.5 chapter registry | 5 lists | fixed (`chapter-environments/registry.js` + consistency tests) |
| §4.7 boot | open | mostly landed (state machine, 45 s watchdog, split KPI); degraded path throws |
| §5.1 mutation boundary | closed | boundary closed, but per-lock grid rebuilds remain |
| §6A.4 envelope | open | partial; `wireV2` dark, expires 10-31 |

## Part 5 — Strengths to keep (don't redo)

**Networking**
- Message-route catalog enforced on send and receive.
- Protocol version negotiated and locked per lobby.
- Decoders reject malformed input with bounds and trailing-byte checks; no prototype-pollution sinks.
- Chunked, CRC-checked resync.
- Two-phase input barrier (ADR-0014).

**Simulation**
- `fixed-tick-clock.js`: time-conserving, ADR-0012 overload handling, 30/60/144 Hz proofs.
- `simulation-tick.js` tick order.
- `das.js` + integer `player-input-state.js`.
- Pure resolver with commit-per-wave goldens.
- Generation-fenced mode lifecycles.

**Themes and app shell**
- ThemeManager's latest-wins queue with generation tokens and time-bounded steps.
- Startup state machine with watchdog and honest split KPI.
- Unified event bus with per-listener isolation.

**Odyssey**
- One World worker bakes with byte-identical sync fallback.
- Chapter light pool.
- Live-loop compile orchestration.
- GPU-timestamp profiling.
- black-hole's timestamp-steered resolution scaling.
- Stillwater's zero-allocation acceptance.

**Electron and supply chain**
- Electron sandbox, context isolation and channel allowlists.
- Ratchets: lint, TS, fitness, depcruise, boot-closure.
- Supply chain: `npm ci --ignore-scripts`, prod audit gate, SBOM, exact pins on three and the Steam natives.

## Part 6 — Suggested first sessions (S-effort, high value)
1. `FragTracker.isHost` getter + promote-then-finish-round test (MP #2).
2. Bound/validate attack requests: depth ≤ rows, mask length ≤ depth, perfect-clear only if the host's replica board is empty, phase/round check, rate limit (#4).
3. Reset the per-peer seq record on an accepted hello (#2).
4. Text-input guard + window `blur` input clear (#6).
5. Drop inline opacity from `ensureThemeContainer` (Parhelion/Serenity Warp) (#5).
6. Odyssey: disposed flag + timer fences; delete `_preInitWarpTransition` and the warp path (#5).
7. `removeClearedLines` fix + cell-conservation property test, behind a rules-version bump (#1).
8. T/J/L kick orientation offset + guideline T-spin fixtures (#1).
9. Infinity: no grid expansion while `isProcessingPhysics` (#1).
10. Decide `wireV2` before 2026-10-31 (#8).
11. Docs: SFX block, orphan skill, CONTRIBUTING/RECOMMENDATIONS (#9).
12. Startup shell `fail()` visible state + Restart / Safe mode (#5).
