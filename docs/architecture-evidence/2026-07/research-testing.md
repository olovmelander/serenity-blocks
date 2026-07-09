# Testing Strategy for Games — Research Report

**Scope:** Beyond unit tests, for a deterministic-sim-aspiring JS puzzle game (Serenity Blocks) with Steam P2P netcode.
**Context grounded in the repo:** Vitest + jsdom, ~400-test suite in `tests/unit/` (67 files), a deterministic `NetworkImpairmentHarness` (`src/core/network/network-impairment.js` — seeded loss/reorder/delay), demo-replay determinism tests with board signatures (`tests/unit/ffa-demo-replay-determinism.test.js`), a two-peer local sim test (`ffa-peer-local-sim.test.js`), binary codec (`src/core/network/binary-encoding.js` + roundtrip tests), jitter buffer (`src/core/network/input-jitter-buffer.js` + tests), snapshot interpolation tests, and a cascade simulator living in `src/core/` (physics/scoring/ffa-p2p-game-state).

**Headline finding:** This project is unusually well-positioned — it already has, in embryo, four of the seven practices below (deterministic replay test, impairment harness, two-peer sim, codec roundtrip). The highest-leverage moves are *generalizing* them: one hand-written demo → generated/golden replay corpora; one two-peer test → a seeded, impaired, invariant-checked mini-DST; roundtrip tests → adversarial decoder fuzzing.

---

## 1. Property-based testing for game rules (fast-check)

### The practice
Instead of asserting on hand-picked examples, you state **invariants** ("laws that hold for all inputs") and let the framework generate hundreds of random inputs, then **shrink** any failure to a minimal counterexample. fast-check is the de-facto JS/TS framework (QuickCheck lineage), and `@fast-check/vitest` integrates it directly into Vitest `test.prop` with reproducible seeds — failures print `{ seed, path }` so a randomized failure is never irreproducible ([fast-check](https://github.com/dubzzz/fast-check), [@fast-check/vitest](https://www.npmjs.com/package/@fast-check/vitest), [fast-check blog on controlled randomness in Vitest](https://fast-check.dev/blog/2025/03/28/beyond-flaky-tests-bringing-controlled-randomness-to-vitest/)).

The game-relevant superpower is **model-based testing** (`fc.commands` + `modelRun`): you define commands (each with `check(model)` and `run(model, real)`), and fast-check generates *random sequences of user actions* against your real system plus a simplified model, shrinking failing sequences to minimal reproductions ([fast-check model-based testing docs](https://fast-check.dev/docs/advanced/model-based-testing/)). The fast-check examples repo demonstrates exactly this on a stateful "music player" state machine plus game-like algorithmic examples (maze generation, knight moves) ([fast-check examples](https://github.com/dubzzz/fast-check/tree/main/examples)). Tutorials like [jrsinclair's guide](https://jrsinclair.com/articles/2021/how-to-get-started-with-property-based-testing-in-javascript-with-fast-check/) cover the invariant-finding mindset.

### Why
Example-based tests encode the bugs you already thought of. A cascade-puzzle rule set has a combinatorially huge state space (piece sequences × rotations × garbage timing × hold × cascade chains); PBT explores it mechanically and — crucially for a netcode game — the same properties double as **determinism probes** (see §3).

### Concrete application to Serenity Blocks
- Add `fast-check` + `@fast-check/vitest` as devDependencies; new files `tests/unit/pbt-*.test.js` picked up by the existing `vitest.config.js` include glob. No config changes needed.
- **Invariants for the cascade sim** (pure `src/core` code, no jsdom):
  - Board consistency: every cell is a valid value; piece never overlaps locked cells; no out-of-bounds writes after any input sequence.
  - Cascade settlement: after cascade resolution, no block is floating (per the game's support rule); cascade loop terminates (bounded iterations).
  - Score monotonicity: score never decreases across any input stream; lines-cleared counter only increments.
  - Bag/RNG properties: every 7 consecutive draws from the bag contain each tetromino exactly once (the `pieces-rotation-bag.test.js` suite is the natural home).
  - Garbage idempotency: applying the same garbage event twice = applying once (generalizes `ffa-garbage-idempotent.test.js`).
  - No NaN/Infinity in any numeric sim field after arbitrary input streams.
- **Metamorphic / determinism properties** (generalizing the existing one-demo determinism test): for *arbitrary generated* `{seed, inputs[]}`, `replay(seed, inputs)` twice → identical board signature; `decode(encode(state))` → deep-equal state for *arbitrary generated* states (generalizes `binary-encoding-roundtrip.test.js` beyond hand-built cases).
- **Model-based input streams**: commands `MoveLeft/MoveRight/RotateCW/RotateCCW/SoftDrop/HardDrop/Hold/Tick(n)/ReceiveGarbage(k)`; the "model" can be as thin as column heights + piece count — the point is the generated sequence plus invariant checks in each `run()`. Use `replayPath` when re-running a shrunk command sequence.
- Keep `numRuns` modest in CI (100–250 per property; the suite must stay fast) and crank it locally/nightly (see §4).

### Pitfalls
- **Tautological properties**: if the test re-implements the sim to compute the expected answer, it tests nothing. Prefer invariants, metamorphic relations (same-seed-same-result), and roundtrips.
- **Hidden nondeterminism**: any `Math.random()`/`Date.now()` inside the sim makes properties flaky. Inject the PRNG and tick count (the sim already takes a seed — keep it that way).
- **Command shrinking** needs `replayPath` in addition to `{seed, path}` — documented gotcha in the fast-check docs.
- **Slow properties**: never boot the full game/jsdom inside a property; drive only the headless sim.

### Overkill for a solo dev
`scheduledModelRun` race-condition detection for async UI; PBT over rendering; exhaustive properties for every module. Target the cascade sim, bag RNG, codec, and jitter buffer — the deterministic core — and stop there.

---

## 2. Replay-based regression testing (golden replays + digests)

### The practice
A deterministic sim means a replay is just `{seed, input stream}` — re-running it must reproduce the exact same state, bit for bit. Studios exploit this two ways:
1. **Replays as regression tests**: store a corpus of recorded replays plus a **digest** (hash/CRC of final — and optionally periodic — sim state); CI re-simulates and compares.
2. **Determinism verification**: Factorio's integration tests "create a small map, place couple of objects on the map, run updates and then verify that expected conditions are met," and after every test "a CRC check is made against presaved CRC values" specifically to catch determinism regressions across platforms ([FFF-60](https://factorio.com/blog/post/fff-60)). For desync hunting they run a mode that CRCs the whole map *every tick* and binary-diff saves to localize the single diverging variable ([FFF-62](https://www.factorio.com/blog/post/fff-62), FFF-188). They credit these tests with saving the multiplayer release: "without the automated tests, the stable multiplayer release date would be delayed a lot."
3. RTS lineage: in a lockstep engine "the replay file only needs to store player inputs. Simply re-run the game feeding the inputs from the replay file and you'll get the exact same result"; Supreme Commander hashed the entire game state once per second and any hash disagreement = desync; debugging is a "binary search of printf-ing the current memory hash" ([ForrestTheWoods — Synchronous RTS Engines and a Tale of Desyncs](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/)). The founding lesson comes from Age of Empires: any divergent client was tagged "out of sync" and stopped, and "very subtle differences would multiply over time" — hence *periodic* checksums, not just end-state ones ([1500 Archers on a 28.8](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)). The flip side: StarCraft II replays break on patches because the sim changed — replays are implicitly *versioned against the rules* ([SC2 forums example](https://us.forums.blizzard.com/en/sc2/t/old-5012-version-replays-are-broken-after-5013-patch/28404)). Fighting games treat rollback re-simulation itself as the test (GGPO SyncTest, §3).
4. **Solo-dev proof of concept — Retro City Rampage** (GDC 2015, Brian Provinciano): a deterministic engine + input recording meant "every new build of your game could automatically play itself from the first level through the final boss, at the push of a button," bugs became "100% reproducible," and the same machinery gave kilobyte-sized shareable replays ([GDC Vault](https://www.gdcvault.com/play/1021825/Automated-Testing-and-Instant-Replays)). This is the closest published analog to Serenity Blocks' situation: one developer, one deterministic sim, replays as the whole regression strategy.

### Why
Golden replays are the cheapest possible full-integration test of game rules: one fixture exercises gravity, rotation kicks, cascades, scoring, garbage, and hold *in combination*, at real gameplay density that generated inputs rarely reach. And the digest doubles as the P2P desync-detection primitive — the same signature function should serve tests and live netcode.

### Concrete application
- `ffa-demo-replay-determinism.test.js` already does this with **one** hand-written DEMO and a board `signature`. Generalize:
  - Add a dev capture path: a debug keybind (or `?recordDemo=1`) that dumps `{ rulesVersion, seed, inputs[], digestEveryN, finalDigest }` as JSON. Store curated ones in `tests/fixtures/replays/*.json`.
  - A single parameterized Vitest file iterates the corpus: re-simulate headless, assert every periodic digest and the final digest. Periodic digests (every N ticks, Factorio/SupCom style) turn "it diverged somewhere" into "it diverged between tick 840 and 900" for free.
  - Curate replays around risk: long cascade chains, simultaneous garbage + line clear, hold at spawn, top-out edge, round restart (`ffa-round-restart-reset` territory).
- **Re-blessing workflow**: rules changes legitimately change digests. Stamp each replay with `rulesVersion`; provide `npm run replays:rebless` that re-simulates and rewrites digests, and make the diff reviewable in git. Never rebless silently in CI.
- Reuse the *same* digest function in the netcode path (periodic state-hash exchange between peers) so tests and production desync detection can never drift apart.

### Pitfalls
- **Golden rot**: without an explicit rebless script + version field, every intentional rules tweak turns into an hour of fixture archaeology.
- **Float-contaminated digests**: digest only integer/quantized sim state. If the sim has floats, they must be deterministic (fixed operation order; no dependence on `Math.fround` platform quirks). JS doubles are IEEE-754 deterministic for the same operation sequence — the danger is *order* differences and transcendental functions, not the arithmetic ([Gaffer On Games — Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/); JS is safer than C++ here since there's one execution model, but `Math.sin` etc. can vary across engines — avoid them in sim code or table-ize).
- **Iteration-order traps**: object key order, `Set`/`Map` iteration seeded by insertion — any divergence between "fresh game" and "restored from snapshot" states breaks digests (this is exactly what the late-joiner/download-join tests guard).
- Giant replays slow CI — keep fixtures under ~1–2k inputs each; long soaks belong in §4.

### Overkill
Storing per-tick full-state snapshots in the repo; replaying rendered video. A dozen curated digest-checked replays gives most of the value.

---

## 3. Netcode test harnesses

### 3a. In-process impairment simulation
The practice: wrap the transport in a virtual link that injects **latency, jitter, loss, duplication, reorder** deterministically, in-process — the application-level equivalent of `tc netem`, as game networking stacks ship built-in (e.g., [FishNet's latency simulator](https://fish-networking.gitbook.io/docs/tutorials/simple/simulating-bad-network-connections); OS-level reference: [tc netem](https://oneuptime.com/blog/post/2026-03-04-simulate-network-latency-packet-loss-tc-netem-rhel-9/view)). Realistic targets: 100–300 ms latency and 2–5% loss for mobile-grade conditions, plus 500 ms+/extreme-loss runs to confirm graceful failure.

**You already have this**: `NetworkImpairmentHarness` with `lossPct/reorderPct/minDelayMs/maxDelayMs/reorderDelayMs`, deterministic, env-configurable, with stats — plus `network-impairment.test.js`. The remaining work is *coverage*, not construction: run the FFA host-authority + jitter-buffer + reconcile suites under a matrix of impairment presets (clean / wifi / bad-mobile / pathological) rather than only clean links.

### 3b. Deterministic two-peer simulation in one process (mini-DST)
The practice: run *all* peers as state machines inside one process with a **simulated clock and virtual network**, all randomness from one seed — so any failure replays exactly from the seed, and simulated hours run in wall-clock seconds. This is FoundationDB/TigerBeetle-style Deterministic Simulation Testing: TigerBeetle's VOPR "simulates an entire cluster, including clock, disk, and network interfaces… using a random seed to tune parameters for injecting faults such as dropping and reordering packets," all as a single process ([TigerBeetle VOPR docs](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md), [DST overview](https://pierrezemb.fr/posts/learn-about-dst/)). Games converge on the same idea from the other side: **GGPO SyncTest** is "a special, single player session designed to find errors in your simulation's determinism" — it executes a 1-frame rollback every frame and "compares the state of the frame when it was executed the first time to the state executed during the rollback, and raises an error if they differ"; the guide's advice: "By running synctest on developer systems continuously when writing game code, you can identify desync causing bugs immediately after they're introduced" ([GGPO Developer Guide](https://github.com/pond3r/ggpo/blob/master/doc/DeveloperGuide.md)). The cost of *not* having this from the start is documented by NetherRealm's rollback retrofit for Mortal Kombat XL / Injustice 2: making the existing engine deterministic and building the desync-detection tooling took 4–12 concurrent engineers ~9 months (~7–8 engineer-years) ([8 Frames in 16ms, GDC 2018](https://www.gdcvault.com/play/1025471/8-Frames-in-16ms-Rollback)) — determinism testing is vastly cheaper to keep than to regain.

**Concrete application**: `ffa-peer-local-sim.test.js` is the seed of this. Grow it into a small harness: N peer game-states + host authority, connected via `NetworkImpairmentHarness` links, driven by a virtual clock (Vitest fake timers or explicit tick pump), inputs from a seeded PRNG. Invariants checked continuously:
- **Convergence**: after quiescence (all in-flight packets flushed), every peer's board digest for a given player equals the authority's.
- Jitter buffer never delivers inputs out of order or twice to the sim (`input-jitter-buffer` + `ffa-adaptive-input-jitter` invariants under random jitter).
- Garbage application idempotent under packet duplication; migration-epoch fencing holds when the host drops mid-round (`ffa-migration-epoch`, `ffa-round-fence-and-reconcile` scenarios, but under seeded random impairment instead of scripted sequences).
- A **SyncTest-style check** inside the sim: snapshot state, re-simulate the last frame from the snapshot, compare digests — catches "leaked" state (anything mutated outside the snapshot boundary) locally without any network at all. Cheap to run in dev builds behind a flag.

### 3c. Fuzzing the binary protocol decoder
The practice: any decoder parsing untrusted peer bytes must never crash, hang, or allocate unboundedly on garbage input. Gold standard is coverage-guided, libFuzzer-style fuzzing; in JS that's **Jazzer.js** — "coverage-guided, in-process fuzzing for Node.js… based on libFuzzer," with instrumentation feedback and a Jest integration; it's also how OSS-Fuzz supports JavaScript ([Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js/), [OSS-Fuzz JS guide](https://google.github.io/oss-fuzz/getting-started/new-project-guide/javascript-lang/)). The lighter-weight alternative: fast-check in **fuzzing mode** — crank `numRuns` (up to `Number.POSITIVE_INFINITY`) and optionally wrap predicates in `neverFailingPredicate` to log-without-stopping ([fast-check fuzzing docs](https://fast-check.dev/docs/advanced/fuzzing/)).

**Concrete application** for `binary-encoding.js` (+ `steam-networking-binary-snapshot`):
- Property 1 (already partly there): `decode(encode(x)) ≡ x` for *generated* states.
- Property 2 (new, adversarial): for arbitrary `fc.uint8Array()`, `decode` either returns a structurally valid snapshot or throws the designated protocol error — never a `RangeError` from a raw `DataView` read, never a hang, never `NaN` smuggled into the sim.
- Property 3 (mutation-based, highest hit rate): take a *valid* encoded buffer, then truncate at a random offset / flip random bytes / splice random lengths — this reaches deep parse paths that pure-random bytes never do.
- Feed every decoded-successfully result through the same validators the game applies, asserting the sim can never be poisoned by a hostile peer (relevant since P2P means every peer is an untrusted input source).

### Pitfalls
- Real timers in impairment tests = flakiness; keep the harness on a virtual clock (the deterministic design already avoids unseeded `Math.random` — preserve that; a config-provided seed per test is the contract).
- Jazzer.js is a native addon; on Windows it can be install friction, and its value is highest for *complex* parsers. A compact hand-rolled codec gets ~90% of the benefit from fast-check + the mutation corpus above.
- Two-peer sims that accidentally share object references between "peers" test nothing — serialize across the virtual link (the impairment harness should carry bytes or structured-cloned messages, not live references).

### Overkill
Antithesis-style hypervisor DST; running the real Steam transport in CI (Steam isn't there anyway — the transport abstraction + mock is the right seam, and real-Steam behavior stays a manual playtest concern).

---

## 4. Soak / fuzz testing the game sim

### The practice
Long-running randomized play with continuous invariant checks — the "does it survive hours?" class of bug: leaks, drift, unbounded queues, rare-state crashes. Soak testing standard practice is sustained load over 12–72 h to expose "memory leaks, gradual resource exhaustion, increasing GC pause times" ([RadView soak playbook](https://www.radview.com/blog/soak-testing-software-playbook-memory-leak-detection-stability)); game studios do it with bots — Riot automates "a complete game loop" in the League client pipeline and expects devs to own functional/perf/load tests ([Riot: Automated Testing for League of Legends](https://technology.riotgames.com/news/automated-testing-league-legends), [League client test pipeline](https://technology.riotgames.com/news/running-automated-test-pipeline-league-client-update)); Rare ran bot-driven gameplay and network tests continuously for Sea of Thieves ([GDC 2019 talk](https://www.gdcvault.com/play/1026366/Automated-Testing-of-Gameplay-Features), [slides PDF](https://media.gdcvault.com/gdc2019/presentations/Masella_Robert_AutomatedTestingOf.pdf)); DICE's "AutoPlayers" bots ran everything from "full 64 player soak tests to specific scripted test cases" for Battlefield V ([GDC 2019](https://www.gdcvault.com/play/1026308/AI-for-Testing-The-Development)), and Ubisoft used client bots that "mimic human input while reporting issues" for The Division ([GDC 2019](https://gdcvault.com/play/1026382/Automated-Testing-Using-AI-Controlled)) — those two being the AAA-scale ceiling a solo dev explicitly should *not* rebuild. The deterministic-sim twist (from DST, §3b): decouple sim ticks from wall clock so "one minute of simulation equals days of real-world testing" — time compression makes soak cheap.

### Why
A cascade sim + P2P reconciliation layer has state that only goes wrong after thousands of events (jitter-buffer watermarks, event-log growth, score overflow paths, cascade-chain edge states). Unit tests and even golden replays never reach tick 500,000.

### Concrete application
- A standalone Node script (not Vitest): `npm run soak -- --seed 1234 --ticks 5e6 --peers 4 --impairment bad-mobile`. It drives the headless sim (and optionally the §3b two-peer harness) with a seeded random-input bot at maximum speed, checking each tick (or every Nth tick):
  - no `NaN`/`Infinity` anywhere in sim state (a recursive numeric-scan helper);
  - board consistency (valid cell values, no floating blocks post-settle, piece conservation through cascades);
  - score/lines monotonically non-decreasing; counters within sane bounds;
  - bounded queues: jitter buffer depth, net-event log length, attack router backlog;
  - `process.memoryUsage().heapUsed` trend over the run (leak smoke signal).
- On violation: print `{seed, tick, last N inputs}` and exit non-zero — the seed makes it a one-command repro, and the last-N-inputs dump can be saved directly as a §2 replay fixture (fuzzer output becomes regression corpus).
- Two tiers: a **60-second smoke soak** inside the normal Vitest run (fixed seed, ~50k ticks), and a **nightly 30–60 min** randomized-seed run (GitHub Actions cron or a local scheduled task).
- Bot policy matters: pure-random inputs mostly top out instantly. Weight toward heuristic play (mostly sensible drops, occasional deliberate tall-stack + cascade-bait sequences) — the Quadra cascade-bot work is directly reusable as the soak driver.

### Pitfalls
- Full-board invariant checks every tick can dominate runtime — check cheap digests every tick, expensive invariants every N.
- Unlogged seeds make failures worthless; log seed *first*, before anything can crash.
- Random-only bots systematically miss deep states (long chains, near-top-out survival) — that's why the weighted-policy point above is load-bearing.

### Overkill
Multi-day multi-machine soak farms; RL/ML playtesting agents; soaking through the real renderer (soak the sim headless; the renderer gets §5 treatment).

---

## 5. Visual regression testing for GPU rendering

### The practice
Screenshot-diff a rendered frame against a blessed baseline with tolerances. The reference implementation for WebGL/WebGPU is **three.js's own E2E suite**: Puppeteer captures each example and compares with **pixelmatch** at pixel threshold `0.1` and a max **0.1% differing pixels** budget; determinism is forced by injecting a seeded `Math.random` and disabling WebGPU timestamp queries; irreducibly flaky examples live on an explicit exception list; runs are parallelized and retried ([three.js test/e2e/puppeteer.js](https://github.com/mrdoob/three.js/blob/dev/test/e2e/puppeteer.js)). Tools: [pixelmatch](https://github.com/mapbox/pixelmatch) (~150 LOC, YIQ perceptual color metric, anti-aliasing-aware, works on raw typed arrays — runs anywhere; it's also the comparator inside Playwright's `toHaveScreenshot` and jest-image-snapshot) and [odiff](https://github.com/dmtrKovalenko/odiff) (SIMD-native, milliseconds on large images, `--antialiasing` flag and 0–1 color threshold) for when diffing itself becomes the bottleneck. Notably, **Vitest now ships this natively**: browser-mode `toMatchScreenshot()` with pixelmatch as default comparator, "stable screenshot detection" (re-captures until the page stops changing), and two independent knobs — per-pixel color `threshold` and `allowedMismatchedPixelRatio` — with the docs' own stability warning that font rendering, GPU drivers, and OS differences change pixels between machines, so baselines demand "the same environment everywhere" ([Vitest visual regression guide](https://vitest.dev/guide/browser/visual-regression-testing)). If tier 2 below ever graduates to automation, this is the zero-new-dependency path since the project is already on Vitest. Rare used "last known good" screenshot comparison for Sea of Thieves — but with a device farm and humans triaging diffs ([GDC 2019](https://www.gdcvault.com/play/1026366/Automated-Testing-of-Gameplay-Features)).

### When it's worth it vs console-error gates
Honest cost accounting for this specific project:
- Baselines are only stable when captured and compared **on the same GPU/driver/OS**. CI runners render via SwiftShader (or not at all for WebGPU), so cross-machine baselines diff constantly — three.js absorbs this with tolerances, exception lists, and maintainer patience.
- The dev machine has a documented **TDR crash risk** on sustained WebGPU capture (CLAUDE.md: full-journey captures have crashed the iGPU) — an automated multi-theme screenshot suite is actively dangerous here.
- Meanwhile the cheapest gate catches the most common regression class: **WebGPU validation errors and shader compile failures in the console**, which are deterministic and machine-independent.

**Recommendation:** two tiers.
1. **Automated, in CI:** console-error gates only. A Playwright/Puppeteer smoke that loads the playground (and one gameplay scene), waits for `window.__PLAYGROUND_READY__`, and fails on any console error / WebGPU validation message. Zero baselines, zero flake, catches broken shaders and crashed pipelines.
2. **Semi-automated, local-only:** the existing playground workflow already has the key ingredient — **phase-locked time** (`?t=<seconds>`) for reproducible frames. A small script captures 1–3 fixed-`t` playground shots per changed theme on the dev machine, diffs vs local baselines with pixelmatch at generous settings (threshold 0.1–0.2, fail above ~1% differing pixels), and shows the diff image. Run it as a pre-commit ritual on theme work, never in CI, one theme per session (TDR constraint). Baselines re-blessed explicitly, same discipline as §2 goldens.

### Pitfalls
- Animated scenes without frozen time/seeded RNG diff 100% — three.js's deterministic injection (seeded random, fixed frame) is the pattern to copy; the playground's `?t=` already provides it.
- Tonemapping/color-space differences between capture paths (the project has a documented playground-vs-in-game grading gap) — baselines must be per-pipeline.
- Tight thresholds create bless-fatigue; loose thresholds miss regressions. Start loose (catching "theme went black / bloom exploded / geometry vanished"), not pixel-perfect.

### Overkill
Per-commit CI screenshots across ~20 themes; cross-GPU baseline matrices; DOM-based visual testing services. For a solo dev, "console clean + a handful of same-machine phase-locked diffs" is the right size.

---

## 6. Simulation-vs-animation decoupling test patterns

### The practice
Test **what happened** (sim events/state) separately from **how it looks** (animation/render), by making the presentation layer a **Humble Object**: "move as much logic as possible out of the hard-to-test element" so the untestable shell is too thin to harbor bugs ([xunitpatterns — Humble Object](http://xunitpatterns.com/Humble%20Object.html), [Fowler bliki](https://martinfowler.com/bliki/HumbleObject.html); the Unity formulation — humble MonoBehaviours over pure C# logic — is the same shape as "humble Phaser/THREE adapters over pure JS sim": [Unity3D.College](https://unity3d.college/2018/11/07/humble-object-game-programming-patterns-unity-c-makes-unit-testing-easy/)). The engine-architecture mirror of this is Supreme Commander running its sim at a fixed 10 fps while the UI renders at 60 fps by interpolation — two clocks, two layers, independently verifiable ([ForrestTheWoods](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/)).

### Why
This decoupling is not just testability — it **is** the determinism requirement of §§2–3. Any sim decision influenced by animation state (frame rate, tween completion, render timing) is a desync generator. The tests are how the boundary stays honest.

### Concrete application
- **Boundary enforcement test** (cheap, high value): a Vitest file that imports the sim modules (`physics.js`, `scoring.js`, `ffa-p2p-game-state.js`, cascade logic) in a bare Node environment — no jsdom — and instantiates them. If someone adds a `document`/`window`/THREE/Phaser dependency to sim code, this test fails at import time. Optionally back it with an ESLint `no-restricted-imports` rule scoped to `src/core/**`.
- **Event-log contract**: have the sim emit a typed domain-event stream (`pieceLocked`, `linesCleared{rows}`, `cascadeStep{n}`, `garbageQueued{k}`, `topOut`) — the project's `multiplayer-events.js` and `online-battle-log` are already close. Then:
  - Rules tests assert on the *event sequence* for a replay (a second, more readable golden alongside the board digest of §2).
  - Presentation tests feed a *synthetic* event stream into the animation adapters with a fake renderer, asserting event→animation-call mapping only. `odyssey-presentation-sync.test.js`, `opponent-watch-animation.test.js`, and `snapshot-interpolation.test.js` already work this way — the pattern just needs to be named and made the default.
- **Two-clock testing**: sim advances by explicit ticks (testable without timers); interpolation/render smoothing is tested as a pure function of (previous snapshot, next snapshot, alpha) — which is exactly what the snapshot-interpolation tests do. The `logic-freezing-hitstops` suite shows the risky inverse direction (presentation-driven time affecting logic) — anything in that category deserves a determinism test proving hitstops don't alter the input-to-state mapping, only its timing.

### Pitfalls
- Convenience leaks: reading `performance.now()` in sim code for "just a cooldown," gating a lock on a tween's `onComplete`. Each one silently breaks replay/netcode determinism; the bare-Node import test plus same-seed-twice properties (§1) are the tripwires.
- Over-mocking the renderer until presentation tests assert mock-call trivia. Keep them at the level of "linesCleared(2) triggers exactly one clear animation for rows [r1, r2]," not internal call counts.

### Overkill
Full MVP/MVVM ceremony over every UI widget; testing tween math. The sim/presentation seam and the event contract are the two things worth guarding.

---

## 7. Test pyramids for games — what studios actually automate

### The practice / evidence
Studios that automate successfully still form a pyramid, but with genre-specific layers, and they are explicit that **automation verifies correctness while humans verify fun**:
- **Factorio**: unit tests (mocked, no graphics) → integration/scenario tests ("create a small map… run updates… verify") with CRC determinism checks → emerging black-box tests coordinating multiple game instances for multiplayer edge cases ([FFF-60](https://factorio.com/blog/post/fff-60)); the whole thing on a build server running daily across OSes ([FFF-62](https://www.factorio.com/blog/post/fff-62)).
- **Riot**: "testing and automation a fundamental concern for the entire team," devs own unit/functional/perf/load tests; the expensive top of the pyramid is a fully automated game loop in the client pipeline, used precisely *because* it saved release-team toil ([Riot tech blog](https://technology.riotgames.com/news/automated-testing-league-legends), [pipeline article](https://technology.riotgames.com/news/running-automated-test-pipeline-league-client-update)).
- **Rare / Sea of Thieves**: gameplay built test-first from the start; a framework spanning unit tests, actor/integration tests, bot-driven network tests, and last-known-good screenshot tests — with heavy investment in flakiness management and reliability practices ([GDC 2019 talk](https://www.gdcvault.com/play/1026366/Automated-Testing-of-Gameplay-Features), [slides](https://media.gdcvault.com/gdc2019/presentations/Masella_Robert_AutomatedTestingOf.pdf)).
- The GDC **Automated Testing In Games (ATIG)** community runs annual roundtables (2026: Process / Legacy / Implementation tracks, plus a Blizzard-indie-Rare panel on automation as a business investment) — the industry hub for "what do you actually automate" ([atig.dev/gdc](https://atig.dev/gdc)).
- What stays manual everywhere: feel, balance, fun, first-run UX — plus anything whose oracle is a human aesthetic judgment.

### The Serenity Blocks pyramid (concrete)
| Layer | Contents | Runs |
|---|---|---|
| **1. Unit + property (seconds)** | existing ~400 tests; add §1 PBT for sim/codec/bag/jitter | every `vitest` run |
| **2. Sim integration (seconds)** | §2 golden replays w/ digests; §6 event-log goldens; bare-Node sim-purity import test | every run |
| **3. Netcode DST (seconds–minutes)** | §3 two-peer/N-peer seeded sim under impairment matrix + convergence invariants; decoder mutation-fuzz properties | every run (short) |
| **4. Soak/fuzz (minutes–hours)** | §4 nightly seeded soak + long fast-check fuzz (`numRuns` cranked); failures auto-exported as layer-2 fixtures | nightly / pre-release |
| **5. Rendering gates (minutes)** | console-error smoke in CI; local phase-locked screenshot diffs on theme changes only | CI smoke + local ritual |
| **6. Manual (irreplaceable)** | feel/juice/theme aesthetics; real Steam P2P sessions with a second machine/friend; packaged-Electron pass (the absolute-path class of bug lives only here) | pre-release |

### Pitfalls
- **Inverted pyramid via jsdom**: DOM-heavy UI tests are the slowest, most brittle layer in this stack; prefer pushing logic below the Humble Object line (§6) so jsdom tests stay thin.
- **Flake tolerance**: every studio source emphasizes it — one flaky test teaches you to ignore red. Quarantine or delete; the deterministic-seed discipline in §§1–4 exists so nothing in layers 1–4 is *ever* allowed to be flaky.
- **Automating fun**: bots can't tell you cascade chains feel great. Don't try; budget real playtest sessions instead.

### Overkill
Device farms, build-verification bot fleets, per-platform matrices — those exist to coordinate hundreds of developers. For one developer, the pyramid above is a weekend-scale buildout on top of what already exists, and every layer pays rent in P2P-desync prevention.

---

## Priority order (effort → value, for this codebase)

1. **Golden replay corpus + rebless script** (§2) — smallest step, uses existing signature machinery, directly protects netcode determinism.
2. **fast-check on sim/codec/bag** (§1 + §3c) — one dependency; the metamorphic determinism property and adversarial decoder property are the two single highest-value tests this project can add.
3. **Seeded two-peer DST with impairment matrix + convergence invariant** (§3b) — extends `ffa-peer-local-sim` + `NetworkImpairmentHarness`, both already built.
4. **Sim-purity import test + event-log goldens** (§6) — an hour of work, permanent guardrail.
5. **Nightly soak script** (§4) — reuses the cascade-bot work; fuzzer failures feed corpus #1.
6. **Console-error CI gate; local screenshot diffs only** (§5) — deliberately last and deliberately small.

---

## Sources

- fast-check (repo): https://github.com/dubzzz/fast-check
- fast-check model-based testing docs: https://fast-check.dev/docs/advanced/model-based-testing/
- fast-check fuzzing docs: https://fast-check.dev/docs/advanced/fuzzing/
- fast-check examples (music-player state machine, maze, race conditions): https://github.com/dubzzz/fast-check/tree/main/examples
- @fast-check/vitest: https://www.npmjs.com/package/@fast-check/vitest
- fast-check blog — controlled randomness in Vitest: https://fast-check.dev/blog/2025/03/28/beyond-flaky-tests-bringing-controlled-randomness-to-vitest/
- jrsinclair — getting started with PBT in JS: https://jrsinclair.com/articles/2021/how-to-get-started-with-property-based-testing-in-javascript-with-fast-check/
- Factorio FFF-60 — Tests all around: https://factorio.com/blog/post/fff-60
- Factorio FFF-62 — The automation of Factorio: https://www.factorio.com/blog/post/fff-62
- Factorio FFF-188 — Bug, Bug, Desync: https://factorio.com/blog/post/fff-188
- ForrestTheWoods — Synchronous RTS Engines and a Tale of Desyncs: https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/
- 1500 Archers on a 28.8 — Network Programming in Age of Empires (lockstep, out-of-sync checks): https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond
- GDC 2015 — Automated Testing and Instant Replays in Retro City Rampage (Brian Provinciano): https://www.gdcvault.com/play/1021825/Automated-Testing-and-Instant-Replays
- GDC 2018 — 8 Frames in 16ms: Rollback Networking in Mortal Kombat and Injustice 2 (Michael Stallone, NetherRealm): https://www.gdcvault.com/play/1025471/8-Frames-in-16ms-Rollback
- SC2 forums — patch breaks old replays: https://us.forums.blizzard.com/en/sc2/t/old-5012-version-replays-are-broken-after-5013-patch/28404
- GGPO Developer Guide (SyncTest): https://github.com/pond3r/ggpo/blob/master/doc/DeveloperGuide.md
- GGPO SDK: https://www.ggpo.net/
- Gaffer On Games — Deterministic Lockstep: https://gafferongames.com/post/deterministic_lockstep/
- Gaffer On Games — Floating Point Determinism: https://gafferongames.com/post/floating_point_determinism/
- TigerBeetle VOPR (deterministic simulation testing): https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md
- Pierre Zemb — Learn about Deterministic Simulation Testing: https://pierrezemb.fr/posts/learn-about-dst/
- FishNet — simulating bad network connections: https://fish-networking.gitbook.io/docs/tutorials/simple/simulating-bad-network-connections
- Jazzer.js — coverage-guided in-process fuzzing for Node.js: https://github.com/CodeIntelligenceTesting/jazzer.js/
- OSS-Fuzz — integrating a JavaScript project: https://google.github.io/oss-fuzz/getting-started/new-project-guide/javascript-lang/
- RadView — soak testing playbook (leak detection): https://www.radview.com/blog/soak-testing-software-playbook-memory-leak-detection-stability
- Riot Games — Automated Testing for League of Legends: https://technology.riotgames.com/news/automated-testing-league-legends
- Riot Games — Running an Automated Test Pipeline for the League Client Update: https://technology.riotgames.com/news/running-automated-test-pipeline-league-client-update
- GDC 2019 — Automated Testing of Gameplay Features in Sea of Thieves (Robert Masella, Rare): https://www.gdcvault.com/play/1026366/Automated-Testing-of-Gameplay-Features
- Sea of Thieves GDC slides (PDF): https://media.gdcvault.com/gdc2019/presentations/Masella_Robert_AutomatedTestingOf.pdf
- GDC 2019 — AI for Testing: Bots that Play Battlefield V (DICE AutoPlayers, soak tests): https://www.gdcvault.com/play/1026308/AI-for-Testing-The-Development
- GDC 2019 — Automated Testing: AI Controlled Players to Test The Division (Ubisoft): https://gdcvault.com/play/1026382/Automated-Testing-Using-AI-Controlled
- GDC Automated Testing In Games roundtables: https://atig.dev/gdc
- three.js E2E screenshot testing (puppeteer + pixelmatch, thresholds, deterministic injection): https://github.com/mrdoob/three.js/blob/dev/test/e2e/puppeteer.js
- Vitest — Visual Regression Testing guide (toMatchScreenshot, browser mode): https://vitest.dev/guide/browser/visual-regression-testing
- pixelmatch: https://github.com/mapbox/pixelmatch
- odiff: https://github.com/dmtrKovalenko/odiff
- xunitpatterns — Humble Object: http://xunitpatterns.com/Humble%20Object.html
- Martin Fowler — Humble Object bliki: https://martinfowler.com/bliki/HumbleObject.html
- Unity3D.College — Humble Object in games: https://unity3d.college/2018/11/07/humble-object-game-programming-patterns-unity-c-makes-unit-testing-easy/
- omsim — community regression simulator for Opus Magnum solutions: https://github.com/ianh/omsim
