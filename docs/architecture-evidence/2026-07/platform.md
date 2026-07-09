# Platform layer evidence report — Events / UI / Boot / Audio
*Verified against the working tree on 2026-07-03 (branch `cleanup/repository-files`, with uncommitted boot-reliability changes in `src/main.js`, `src/ui/intro-animation.js`, `src/ui/boot-warp-transition.js`, plus new untracked `src/ui/boot-warp-startup.js`, `src/ui/startup-debug.js`, `tests/unit/startup-animation-reliability.test.js`). All counts measured, not quoted.*

Plan items covered: Phase 2 (audio ownership, theme containers), Phase 4 (bus unification, resize broadcaster, intro/menu decoupling), Phase 8 (boot KPI, intro SFX packaging), and the Phase 6 "move countdown/overlay DOM to UI layer" item where it touches this area.

---

## 1. The dual event bus (Phase 4, item 1)

### 1.1 Current state — plan description is directionally right, numerically stale

Two buses plus a **third, unacknowledged transport** exist today:

- **Sync bus** — `src/events/event-bus.js` (73 lines). `EventBus.emit` at `event-bus.js:32-37` is a plain `forEach` with **no per-listener error isolation**: one throwing theme handler aborts every later handler *and* propagates the exception up into the emitter (which for `LINE_CLEAR` is gameplay/physics code in the mode classes). 25 event names in `EVENTS` (`event-bus.js:42-73`). No namespaces, no options, no listener-count API, no unknown-event guard.
- **Optimized bus** — `src/utils/event-optimizer.js` (359 lines), singleton `optimizedEventBus` at `:334`, consumed only through the `src/events/multiplayer-events.js` facade (46 lines, 21 `ffa:*` event names). Its non-batched `emit` **is** error-isolated (`event-optimizer.js:242-247`), but the batched dispatch path is **not** (`EventBatcher` flush → `l.callback(batch)` at `event-optimizer.js:192-196`, no try/catch). It also exposes a `window.eventOptimizer` debug global (`:337-355`) — exactly the "non-dev `window.*` debug handle" Phase 3d's fitness check would ban.
- **Window CustomEvents** — a third channel the plan never mentions: `settingsChanged` (`main.js:2968`), `gameModeChanged` (`main.js:2975`), `modalShown` (`modals.js:59`), `intro:phaseChanged` (`main.js:5546`), `intro:menuBgReady` (`intro-animation.js:519`). Any "one bus" exit criterion that ignores these is unfalsifiable.

**Measured subscriber counts (2026-07-03):**

| Metric | Value | Plan/review claim |
|---|---|---|
| `eventBus.on(` occurrences repo-wide | 237 across 73 files | — |
| Theme-file subscribers on sync bus | **222 subscriptions in 64 theme files** | "55 theme files" (review §2.3) / "55+ subscribers" — stale, it grew |
| `onMultiplayerEvent` subscription sites | 27 (multiline-aware grep) across 9 files | — |
| Subscriptions using optimizer options | **exactly 1** — `rafThrottle: true` at `src/ui/multi-player-canvas-layout.js:454` | review implies broad "narrow but real value" |
| Files touching `optimizedEventBus` directly | only `multiplayer-events.js` + `event-optimizer.js` itself | — |

The last two rows are the strongest new facts: **the entire optimizer feature set is load-bearing for one subscription**, and **every MP consumer already goes through the facade**, so re-pointing `multiplayer-events.js` at a beefed-up `event-bus.js` is a *single-file* cutover, not a 12-file migration.

### 1.2 Live bugs that prove the plan's missing "contract test" item

1. **`HOST_MIGRATED` is emitted with event name `undefined`.** `src/core/network/host-migration.js:152-154` emits `MULTIPLAYER_EVENTS.HOST_MIGRATED`, but that key **does not exist** in `multiplayer-events.js:3-29`. The "Notify UI" comment above it is a lie — nothing can ever receive it. This is a live instance of the exact silent-miss class Phase 4 targets, *inside the bus that was supposed to be the careful one*.
2. **Three orphan events with emitters and zero subscribers:** `JOIN_REJECTED` (`ffa-p2p-game-state.js:836,848`), `COUNTDOWN` (`ffa-p2p-game-state.js:5020,5060`), `ROUND_OVER` (`frag-tracker.js:291`). Grep for `MULTIPLAYER_EVENTS.<name>` finds no `on*` site for any of them.
3. **`OptimizedEventEmitter.once()` is broken.** `once` (`event-optimizer.js:258-265`) registers `wrappedCallback` (so the stored `original` is the wrapper) but unsubscribes with the *user's* callback; `off` matches `l.original === callback` (`:214`) → never matches → the listener fires forever. Latent only because `onceMultiplayerEvent` has **zero call sites** — but any Phase 4 "fold the optimizer in" work that copies this code inherits the bug.
4. **`EVENTS.LINE_CLEAR` payload drift is worse than the review's "5 shapes":** measured emit sites show at least 6 shapes — `{lineCount, clearedRows, cascadeCount}` (`SinglePlayerMode.js:833`, `InfinityMode.js:891`, `LocalMultiplayerMode.js:910`), `{lineCount, clearedRows}` (`OnlineMultiplayerMode.js:1390`, `main.js:3427`), `{lineCount, player, clearedRows}` (`main.js:4973`), `{lineCount: 4, comboCount: 10}` (`OdysseyMode.js:2891`), `{lineCount}` only (`stellar-velocity-theme.js:2671` — a *theme* self-emitting a gameplay event into the global bus for its idle demo).
5. **No unit test covers either bus.** `tests/unit/` (140 files) has no `event-bus`/`multiplayer-events`/`event-optimizer` test; the only grep hits are theme phase scripts.

### 1.3 The bridge, verified

`OnlineMultiplayerMode._registerEffectHandlers()` (`OnlineMultiplayerMode.js:1377`, called at `:1367`) bridges exactly **four** events from the optimized bus to the sync bus, all filtered to the local player: `LINE_CLEAR` (`:1390`), `COMBO` (`:1439`), `PIECE_LOCK` (`:1491`), `PERFECT_CLEAR` (`:1564`). Opponent variants are routed to `opponentWatchManager` instead (`:1461-1469`, `:1483-1485`). The review's claim that theme visuals never react to networked opponents **still holds today**. `MATCH_PREPARING`/`MATCH_STARTED`/`GAME_OVER`/`PLAYER_TOPPED_OUT` still have no sync-bus equivalent (`EVENTS` has no such keys).

### 1.4 Concrete design the plan omits

The plan's entire guidance is one row: "fold per-listener throttle/batch + error-isolated fan-out into event-bus.js, re-point multiplayer-events.js at it." A developer needs:

**Proposed unified API** (backwards-compatible superset of both):

```js
// src/events/event-bus.js
on(eventName, handler, options = {})
// options: { throttleMs?, debounceMs?, rafThrottle?: boolean,
//            batch?: { delayMs?: number },   // handler receives payload[]
//            signal?: AbortSignal }           // auto-off, replaces manual cleanupHandlers
once(eventName, handler)          // fixed semantics (off by wrapper identity)
off(eventName, handler)           // matches by ORIGINAL handler, wrapper-aware
emit(eventName, payload)          // try/catch per listener; failures -> onListenerError(event, err, handler)
listenerCount(eventName)          // for tests + fitness checks
setKnownEvents(namesIterable)     // DEV/TEST: emit/on of an unknown or undefined name throws
```

- **Namespaces:** keep flat strings with the `ffa:` prefix convention (already in place, `multiplayer-events.js:4-28`); enforce membership via a frozen `ALL_EVENTS = { ...EVENTS, ...MULTIPLAYER_EVENTS }` registered with `setKnownEvents` in dev/vitest. This single guard would have caught bug #1 (`undefined` name) at emit time.
- **Typed payloads:** this is Phase 3a's `EventPayloadMap` hook — the plan already says "make `EventBus.emit/on` generic over `EventPayloadMap`" but doesn't connect it to Phase 4; do the bus unification *first*, then type one bus instead of two.
- **Ordering guarantee to preserve:** default (option-less) listeners stay synchronous and in registration order — all 222 theme subscriptions rely on effects starting the same frame as the gameplay event.

**Migration path (zero-regression, 4 steps):**
1. Add options + error isolation + `setKnownEvents` to `event-bus.js`; new vitest file pins: sync ordering, error isolation (listener 2 runs when listener 1 throws), once-fires-once, rafThrottle coalescing, batch delivery, unknown-name throw in dev.
2. Re-point the facade: `multiplayer-events.js` swaps `optimizedEventBus` → `eventBus` (its exported signatures are unchanged, so all 9 consumer files are untouched). The one options user (`multi-player-canvas-layout.js:454`) works unchanged.
3. Delete `OptimizedEventEmitter`, the `optimizedEventBus` singleton, and `window.eventOptimizer` (`event-optimizer.js:151-359`); keep the standalone `debounce/throttle/rafThrottle/memoize` helpers only if other importers exist (measured: **none** outside the facade — the whole file can go if the helpers move into the bus).
4. Fix the orphans as part of the same PR: add `HOST_MIGRATED` to the event map (and a subscriber or delete the emit), and either wire `COUNTDOWN`/`ROUND_OVER`/`JOIN_REJECTED` subscribers or document them as reserved (see §4 — `COUNTDOWN` is the Phase 6 UI-extraction seam and should stay).
5. *Then* (separate commit) emit opponent gameplay on the unified bus behind a theme-opt-in, since 64 theme files currently assume `LINE_CLEAR` == local player; blindly forwarding opponent clears would double-fire every theme effect in MP. **This is the regression trap the plan doesn't flag.**

**Back-pressure (missing from plan):** `RENDER_FRAME` is emitted from the unified MP loop every frame and consumed *without* rafThrottle at `OnlineMultiplayerMode.js:1216-1218`; under a 6-player event storm plus a resync, the sync bus has no drop/coalesce policy at all. The unified bus should expose `batch`/`rafThrottle` as the sanctioned coalescing tool and the Phase 3d budget should include "bus events dispatched per second" so storms are measurable.

**Success measure:** fitness check "no new event bus" (planned) + `listenerCount` snapshot test + the dev-mode unknown-name throw wired into vitest; A/B a 2-peer MP session before/after with `netEventLog` and assert identical event sequences.

**Perf impact:** negligible-positive. Per-listener try/catch costs nanoseconds against handlers that launch GPU work; deleting the second Map-of-arrays bus and the 16 ms `setTimeout` batcher removes a scheduling layer. No hot-path risk: gameplay-frequency events (`PIECE_MOVE`, `LINE_CLEAR`) already run through the identical `Set`-copy `forEach` today.

---

## 2. Cold boot & the intro-vs-menu race (Phase 4 item 7, Phase 8)

### 2.1 The plan's delta row is already stale — the tree moved *away* from it

The 2026-07-01 delta says "an initial-theme prewarm runs as a deferred startup task". **No longer true on the branded path.** The current cold-boot critical path (Electron, no skip flags), traced through `bootstrap()`:

1. `bootstrapStartedAt` anchor — `main.js:5423`
2. `revealStartupShell()` (studio ident) — `main.js:5447`
3. `appInitPromise` = `new SerenityBlocks().init()` — `main.js:5472-5488`, awaited at `:5514`
4. **`prepareFirstThemeBeforeIntro()`** — `main.js:5520` → `main.js:2822-2849`: theme *load* under a 6.5 s budget (`:2829`), ident-reveal wait ~1.65 s (`:2858-2877`), then theme WebGPU *warm* under a **15 s budget** (`:2845`) — all **before** the intro starts, on the critical path.
5. `waitForStartupLogoMinVisible(4000)` — `main.js:5525` (defined `:688`): a **hard 4 s ident floor**. The review's "[LOW] hard 2000 ms overlay floor" has silently **doubled**, and the plan's "make the 2000 ms floor policy-driven" now names the wrong number.
6. Intro `show({ deferTitle: true })` + 1.5 s phase race — `main.js:5542-5552`
7. Boot-warp gauntlet — `main.js:5560-5725`: title-reveal safety pushed **120,000 ms** (`BOOT_WARP_REQUIRED_TITLE_SAFETY_MS`, `boot-warp-startup.js:7`, applied `main.js:5580`); `waitForIntroRendererDecision` with a **120 s** timeout (`:5592-5594`); `waitForStartupThemeIdle` — a `while (true)` poll with **no timeout** (`boot-warp-startup.js:101-144`); then a **`while (!warpTransition)` retry loop with no attempt cap** (`main.js:5621-5700`) whose retryable statuses (`prewarm-timeout`, `prewarm-exception`, `setup-failed`, `webgpu-init-failed`, `:5613-5618`) all loop forever with per-attempt timeouts escalating to 20 s.
8. Warp play 2600 ms + fades — `main.js:5746-5773`; warp SFX one-shot fired at `:5745`.
9. **`await introPromise`** — `main.js:5798`: the menu waits for the *entire* intro.
10. `waitForMenuBgReady(2200)` — `main.js:5813`; `modalManager.show('start')` — `:5823`; `dismissStartupShell` — `:5832`; **`timeToInteractiveMenuMs` recorded** — `:5839-5847`; `menu-ready` stage — `:5848`.

Deferred tasks (theme warm *backup* `:1050-1055`, player card `:1057`, Steam cloud sync `:2529`) start only on first interaction or a 2 s menu-idle timer (`main.js:5851-5865`). The deferred `initial-theme-warmup` task correctly no-ops when the pre-intro warm already ran (`main.js:1033-1035`).

**Consequences the plan must absorb:**
- The Phase 4 "race intro-complete vs menu-ready" item is no longer a *decoupling* of two roughly-independent things; the boot is now a **serial choreography with two theoretically-unbounded waits** (theme-idle poll, prewarm retry loop). A theme whose `deferredMaterialLoadPromise` never settles (flag protocol in `boot-warp-startup.js:15-68` is duck-typed against 8 optional theme fields) stalls boot behind the ident indefinitely, with the title safety being re-postponed 120 s at a time (`main.js:5606`, `:5694`). **Abort criteria are absent**: there is no global "boot must reach menu-ready in N seconds or degrade" watchdog.
- `timeToInteractiveMenuMs` **now includes the intro and warp by construction** (recorded after `await introPromise`). As a Phase 8 regression KPI it conflates a deliberate ~10-20 s brand experience with actual boot cost. Any threshold set on today's number is either meaningless (too loose) or trips on an intentional intro tweak (too tight).

### 2.2 What "menu interactive" actually requires (for the state-machine design)

Measured dependencies of a clickable start menu: DOM (`index.html` `start-modal`), `appInitPromise` resolved (settings, `modalManager` — `src/ui/modals.js:19`, `ModalManager.show` `:42-66` is pure classList + `modalShown` CustomEvent + gamepad menu-nav enable), and nothing else — **not** audio (context is gesture-lazy, `sound-manager.js:105-127`), **not** the theme (menu background is the intro's), **not** Steam (essential services start *after* core-ready, `main.js:5810`, `:972-1010`). `?skipIntro=1` already proves menu-without-intro works (`main.js:5497-5508`).

**Proposed state machine** (what the plan should specify):

```
BOOT_STARTED ─→ APP_READY (appInitPromise)
APP_READY ─→ MENU_READY   (modal DOM armed + input handlers live; hidden behind overlay)
APP_READY ─→ INTRO_RUNNING (ident → warp → intro; purely presentational layer, z>menu)
MENU_READY + (INTRO_DONE | INTRO_SKIPPED | BOOT_WATCHDOG_FIRED) ─→ MENU_VISIBLE
```

Key rules: (a) `MENU_READY` is reached *without* awaiting `introPromise` — the modal is shown (or at minimum armed for input) under the overlay; (b) a single **boot watchdog** (e.g. 45 s wall-clock) forces `INTRO_SKIPPED`, dismisses shell + warp, and reveals the menu — this converts both unbounded loops into bounded degradation; (c) `timeToInteractiveMenuMs` splits into `timeToMenuReadyMs` (the real KPI, ends at MENU_READY) and `introDurationMs` (a product choice, tracked separately); (d) user input during INTRO_RUNNING (click/key) is the skip affordance and transitions to MENU_VISIBLE immediately.

**Success measure:** the existing `startup-animation-reliability.test.js` (new, untracked — 8 tests over renderer-decision/prewarm-budget/theme-idle) is the right harness to extend with watchdog + state-machine transition tests; plus the Phase 3d budget file gaining `timeToMenuReadyMs` (baseline: measure with `?startupDebug=1` — the new `startup-debug.js` trace ring buffer, 400 entries, `startup-debug.js:5`, already captures every `markStartup` stage with ms timestamps — the "boot-time budget breakdown" the plan asks for **already exists as instrumentation**; what's missing is only the aggregation/budget assertion).

**Perf impact:** decoupling makes TTI dramatically better on the branded path (menu armed seconds earlier) at zero GPU cost; the risk is *visual* (menu flash under a translucent overlay) — mitigate by keeping the overlay opaque until MENU_VISIBLE.

**Stale plan nits:** "2000 ms overlay floor" → 4000 ms (`main.js:5525`); "intro prewarm as deferred task" → pre-intro critical path (`main.js:5520`); the delta's "fold boot-warp prewarm, theme prewarm, warp-SFX decode into the timeToInteractiveMenuMs budget" is now impossible as stated because all three are *inside* the number already — the work is the opposite: **decompose** the number.

---

## 3. Resize/visibility broadcaster (Phase 4 item 4)

Measured today: **61 `addEventListener('resize')` in 60 files; 6 `visibilitychange` in 6 files; 64 unique files combined.** The plan's "~69 listeners" (from the review) is close but stale. `main.js` already owns a debounced (150 ms) resize handler (`main.js:2937-2944`) — but it only calls `this.handleResize()`; it does **not** broadcast on the bus, so all 60 other files self-listen with divergent throttling.

Missing implementation guidance: (1) add `EVENTS.VIEWPORT_RESIZED` `{width, height, dpr}` emitted from the one debounced handler; (2) migrate `BaseTheme` first — most theme listeners are inherited/copy-pasted; one base-class change plus deletion of per-theme listeners covers the bulk of the 60 files; (3) themes also need *current* size at activation (they read `window.innerWidth` on `init`) — the broadcaster must expose `getViewport()` for pull, not just push; (4) `visibilitychange` should **not** be folded into the same event — 5 of the 6 users (e.g. `sound-manager.js:237`) gate audio/render loops and need the raw event semantics; recommend leaving them and descoping visibility from this item. Success: fitness check "no `addEventListener('resize')` outside the broadcaster + documented holdouts"; perf impact: strictly positive (one debounce instead of ~60 independent handlers doing sync GPU `setSize` on F11 — the exact freeze the `main.js:2934-2936` comment documents).

---

## 4. UI layer & netcode overlays (Phase 6 item "move showCountdown/overlay DOM out", UI patterns)

- `OnlineMultiplayerMode.js` is **3,285 lines** with **165 DOM-op occurrences** (`getElementById|querySelector|.style.|classList`) — the review's "118 calls" grew ~40%. `ffa-p2p-game-state.js` is **5,116 lines** — the plan's delta figure is still exact.
- **The countdown extraction seam already half-exists and the plan doesn't know it:** `showCountdown` (`ffa-p2p-game-state.js:4941`, invoked from `:1367`, `:2146`, `:4722`) builds the full-screen overlay with `style.cssText` (`:4960`) **and simultaneously emits `MULTIPLAYER_EVENTS.COUNTDOWN`** (`:5020`, `:5060`) — which has **zero subscribers**. The Phase 6 task should be rewritten as: build a `CountdownOverlay` UI component subscribing to `COUNTDOWN` (+ a new `COUNTDOWN_FINISHED` or callback-token event), verify visual parity, then delete the DOM block from the god-class. The emit side is already shipped; only the listener and the deletion remain. This also converts orphan event #2 (§1.2) into the load-bearing contract.
- Recommended pattern for the plan to name explicitly (it currently just says "move DOM out"): *netcode emits facts on the bus; UI components own DOM; a mode class only wires lifecycles*. The four `_registerEffectHandlers` bridges (§1.3) and `opponentWatchManager` routing already follow this shape — cite them as the house pattern.

---

## 5. Audio platform (Phase 2 item 4, Phase 8 item 2)

**Mostly landed — the plan should mark these done:**
- `utils/audio-manager.js` is **deleted** (file absent). ✔
- `SoundManager` is the single `AudioContext` owner (`sound-manager.js:111`, gesture-lazy via `resumeAudioContext` `:109-127`) and `cleanup()` **now closes the context** (`:1626-1628`) — the review §2.7 omission is fixed. ✔
- Music manifest fetch is relative: `fetch('./assets/music/songs.json')` (`music-loader.js:22`) — the packaged-Electron absolute-path trap is closed (Vite `base: './'`, `vite.config.js:19`). ✔
- `public/assets/audio/intro/` is **git-tracked**: `git ls-files` returns `begin.ogg` (25 KB) *and* `warp.ogg` (52 KB). The Phase 8 "ensure git-tracked + packaged" item is done for tracking; packaging flows through Vite `publicDir` → `dist` → asar automatically. The plan only names `warp.ogg`; `begin.ogg` is new and should be added to the item so it isn't treated as untracked debris. ✔ (mostly)
- `playOneShotFile` (`sound-manager.js:189-230`) uses XHR (file://-safe), decodes once into an unbounded-but-tiny `oneShotBuffers` Map (`:196-215`), routes through the SFX bus + limiter (`:220-226`), double-checks mute after the async decode (`:218`), and never throws — wired at `main.js:5745`. Solid; no plan action needed beyond keeping the Phase 8 "best-effort playback silently no-ops if the file is missing" caveat, which remains true by design (`:227-229` warn-only).

**Remaining gap:** nothing in this area blocks; the only note is that intro SFX decode happens *during* the warp handoff (fire-and-forget at `main.js:5745`), so first-boot SFX can start late on slow disks — irrelevant to TTI, worth one line in the Phase 8 polish item at most.

---

## 6. Theme containers in index.html (Phase 2 item 5)

Measured: **62 themes registered** in `theme-registry.js`; **61 hand-written `id="*-theme"` divs** in `index.html`; the only missing one is still `chiral-gold`, which self-creates its container at `chiral-gold-theme.js:840-842`. No `ensureThemeContainer`/generation code exists in `theme-manager.js` or `theme-registry.js` (grep: none). The plan item is accurate but gives no design. Concretely: a ~15-line `ensureThemeContainer(themeId)` in the registry, called from the theme-manager activation path (not boot — generating 62 divs at boot adds DOM noise; lazily creating on first activation matches chiral-gold's proven pattern), then delete the 61 static divs *or* keep them and make the helper idempotent (`getElementById` first — zero-risk option). **Risks the plan omits:** the static divs have a fixed document order that determines stacking against `background-canvas` and each other; CSS keyed to `#<id>-theme` must be audited; the safest cutover is helper-with-fallback first, static-div deletion as a separate verified commit. Success measure: the §1.4-style contract test comparing `getThemeIds()` to live containers after activation of each theme (a 62-iteration jsdom test).

---

## 7. Per-item verdicts (plan accuracy today)

| Plan item | Description accurate today? | Biggest omission |
|---|---|---|
| P4 bus unification | Direction right; counts stale (64 theme files/222 subs, not 55); misses the facade-only consumption fact that makes it cheap; misses window-CustomEvent third channel | No API design, no migration order, no contract tests, no opponent-event double-fire trap, unaware of 4 live orphan/undefined-event bugs |
| P4 intro/menu race | **Stale** — tree moved further from it (pre-intro warm on critical path, 4 s floor, two unbounded waits, 120 s title safety) | No state machine, no watchdog/abort criterion, KPI decomposition unspecified |
| P4 resize broadcaster | Count slightly stale (61+6 across 64 files); main.js debounced handler exists but doesn't broadcast | BaseTheme-first migration path; pull API for activation-time size; descope visibilitychange |
| P2 audio ownership | **Done** — plan should mark landed (deletion, ctx close both shipped) | — |
| P2 theme containers | Accurate (chiral-gold still the only gap; 62 vs 61) | Lazy-create vs boot-generate decision, stacking-order risk, idempotent fallback design |
| P8 intro SFX tracked/packaged | **Done** (both .ogg files tracked); plan unaware of `begin.ogg` | — |
| P8 `timeToInteractiveMenuMs` threshold | Metric exists (`main.js:5839-5847`) but **its meaning changed** — it now contains the whole intro/warp | Must split into `timeToMenuReadyMs` + `introDurationMs` before any threshold is set; `startup-debug.js` trace is the existing breakdown to aggregate |
| P6 countdown DOM extraction | Accurate | The emit side already exists with zero subscribers (`COUNTDOWN`) — item is half-done and the plan should say "build the subscriber, delete the DOM" |

## 8. Missing from the plan entirely (this area)

1. **Event-name/payload contract tests** — the `HOST_MIGRATED`-undefined bug and 6-shape `LINE_CLEAR` drift are shipping today; a 30-line vitest file (known-names assertion + per-event payload schema) prevents the whole class and is a prerequisite safety net for the Phase 4 fold-in.
2. **Bus back-pressure/observability budget** — events/sec counter + coalescing policy for `RENDER_FRAME`-class storms; wire into the Phase 3d budget file (which does not exist yet — `scripts/` has only `odyssey-perf-baseline.mjs`).
3. **Boot watchdog / abort criteria** — both unbounded boot waits (`boot-warp-startup.js:101`, `main.js:5621`) need a bounded-degradation guarantee; the plan's own Movement C rule ("every phase gets an abort criterion") should apply to the boot choreography it praises.
4. **The uncommitted boot work has no landing plan** — ~730 changed lines across 4 files plus 3 new files implement exactly the Phase 4/8 surface this plan governs, and the plan's delta table predates them; the rewrite should absorb them as the new baseline (with `startup-animation-reliability.test.js` as their pin) rather than describing the 07-01 tree.
5. **`window.eventOptimizer` debug global deletion** — becomes free during the fold-in; should be listed so the Phase 3d "no non-dev window.* handles" fitness check starts clean.
