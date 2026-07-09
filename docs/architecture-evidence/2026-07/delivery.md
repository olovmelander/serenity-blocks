# Delivery-area evidence report: Build, CI, tests, types, packaging, security, release

*Verified against the working tree on 2026-07-02, branch `cleanup/repository-files` (clean). Plan phases covered: 0, 1-security, 2-deps, 3, 8. Every number below was measured, not quoted.*

---

## 1. Executive corrections — where the plan is stale or wrong today

1. **The plan's central Phase 0 instruction ("run the one-time `git add --renormalize .`") is a no-op and misdiagnoses the problem.** The git *index* is already 100% LF: `git ls-files --eol` reports **1510 i/lf, 0 i/crlf, 0 i/mixed** (572 `i/-text` binary, 8 `i/none`). `core.autocrlf=true` always stored LF in the index; renormalize would produce an empty commit. What is actually dirty is the **local Windows working tree**: **1071 files w/crlf, 58 w/mixed, 381 w/lf** — checked out CRLF before `.gitattributes` landed and never refreshed. The fix is a *working-tree refresh on the dev machine* (`git checkout-index -f -a` after clearing, or the standard `git stash && git rm -q --cached -r . && git reset --hard`), not a renormalize commit. Crucially, **CI is already unaffected**: a fresh Linux checkout under `.gitattributes:13` (`* text=auto eol=lf`) gets LF, so the 280k CRLF lint noise is local-only.
2. **The Vitest suite is now 95 files / 584 tests — and 1 test currently FAILS.** `tests/unit/chapter-environment-manager.test.js` → "Chapter 3 to 4 ground continuity › keeps Chapter 4 grounded" expects `apronZ` `[-600,-860,-710]` while `src/rendering/odyssey/chapter-environments/mountain-peaks.js:664,683,691` places the apron meshes at −600/−710/−860. Because `npm test` is a **hard** CI gate (`pages.yml:38`), **CI is red on this branch right now**. The plan's counts ("67 files / 398 tests" in the review; "22 MP files / 152 tests" in the 06-30 refresh) are both stale, and no plan text acknowledges a red suite.
3. **`ffa-p2p-game-state.js` is at `src/core/multiplayer/ffa-p2p-game-state.js`, 5,116 lines** — the plan's 2026-07-01 figure is still exact (it did not grow further in the last day).
4. **The packaged artifact demonstrably ships the Spacewar AppID.** `release/win-unpacked/steam_appid.txt` = `480`, installer `Serenity Blocks Setup 1.0.0.exe` = **625,923,068 bytes (~597 MiB)**, built 2026-07-01. Root and `electron/steam_appid.txt` are both `480`. The plan is right that this is the top blocker; it is wrong to imply the packaging path is partially gated — **no gate of any kind runs during packaging** (see §3).
5. **The lint baseline is measurable and the plan should stop hedging.** Local run: 286,007 errors + 1,130 warnings; **280,101 are `linebreak-style`** (local CRLF only). The CI-visible baseline is therefore **≈5,906 errors + 1,130 warnings**, dominated by: `indent` 1,749, `max-len` 1,093 (warn), `object-curly-newline` 450, `no-tabs` 431, `object-property-newline` 383, `no-unused-vars` 347, `no-bitwise` 265, `import/no-unresolved` 154, `import/no-extraneous-dependencies` 149. The `pages.yml:33-35` comment ("~5.5k genuine") is roughly right but undocumented.
6. **Two lint rule classes are *architecture decisions*, not cleanup:** the 149 `import/no-extraneous-dependencies` errors exist **because** Phase 2 moved `phaser`/`three` to `devDependencies` (e.g. `src/main.js:169` "'phaser' should be listed in dependencies"). The 154 `import/no-unresolved` are `three/addons/*` (74 files import it) while `.eslintrc.json:36-38` registers only `three/webgpu`/`three/tsl` as core-modules. Phase 0's lint ratchet cannot finish until Phase 2's "packaging/SBOM decision" is made or the rules are configured — the plan does not connect these.

---

## 2. Phase 0 — what remains of the ratchet (exact enumeration)

**Current state (accurate parts):** `pages.yml` has a `test` job: `npm run typecheck` hard (line 31), `npm run lint` with `continue-on-error: true` (lines 36-37), `npm test` hard (line 38); `build` `needs: test` (line 41) and only runs on push; deploy to Pages after. Node 20 + `engines: node >=20` (`package.json:138-140`). `tsconfig.json` + green `npm run typecheck` confirmed by direct run.

**Remaining, in dependency order:**

1. **Fix the red test** (chapter-environment-manager vs mountain-peaks.js) — nothing else can "hard-gate" while the suite fails.
2. **Local working-tree EOL refresh** (not a renormalize commit — see §1.1). Also settle the 58 `w/mixed` files, which will produce noisy whole-file diffs when next touched.
3. **Lint baseline burn-down:** ~5.9k CI-visible errors. Mechanical bulk (`indent`+`object-curly-newline`+`object-property-newline`+`no-tabs`+`comma-dangle`+spacing ≈ 3,100) is one `eslint --fix` + review commit. Decisions needed: `no-bitwise` (265 — legitimately used in binary encoding/CRC; turn off or per-file disable), `no-unused-vars` (347 — real triage), `import/no-extraneous-dependencies` + `import/no-unresolved` (see §1.6). Then flip `continue-on-error: false`.
4. **Release gates in CI: absent.** `npm run check:release-gates` appears nowhere in `pages.yml` and nowhere in the packaging path. Minimum: add `- run: npm run check:release-gates` to the test job (dev mode passes today, exit 0 verified) and a release workflow step with `SERENITY_RELEASE=1` (verified exit 1 today — good).
5. **Supply-chain gate: entirely missing.** Measured: `npm audit --omit=dev` = **0 vulnerabilities** (runtime deps are only `ez-steam-api` + `steamworks.js`, `package.json:119-122`); full tree = **24 vulnerabilities (1 critical: vitest <3.2.6, GHSA-5xrq-8626-4rwp, fix available)**. No `.github/dependabot.yml`, no `.husky`, no SBOM tooling, no lockfile-integrity step (beyond `npm ci`'s implicit check). Concrete additions: `npm audit --omit=dev --audit-level=high` as a hard step; full-tree `npm audit` as warning; Dependabot config for npm + github-actions ecosystems; `npx @cyclonedx/cyclonedx-npm --output-file sbom.json` on release builds.
6. **`docs/ARCHITECTURE_INDEX.md` + ADR stubs: do not exist** (no `docs/adr/`, no index file). Plan item still open, effort accurate.

**Success measure:** a PR with a type error, failing test, or (post-flip) lint error cannot merge; `SERENITY_RELEASE=1` run in the release workflow fails while AppID is 480. **Risk:** the bulk `--fix` commit will conflict with any open branch — do it at a quiet moment, immediately after the EOL working-tree refresh, as separate commits (fix-only vs. manual).

---

## 3. Phase 1 security / release-blocker items (delivery view)

- **`release-gate-check.mjs` behavior verified:** substring/file-existence checks (`scripts/release-gate-check.mjs:6-27`) plus the AppID check (`:62-80`). Dev mode warns + exit 0; `SERENITY_RELEASE=1` exit 1. The plan's description is accurate. Gap: it is **wired to nothing** — not CI, not `build-win.mjs`.
- **Packaging path has zero gates.** `scripts/build-win.mjs:116-134` runs `vite build` → `electron-builder` directly; no typecheck, no tests, no release-gate call. `scripts/afterPack.cjs:11-13` is an explicit no-op — so the plan's "strip `steam_appid.txt` in an afterPack/release-packaging step" has an obvious landing site but **nothing is implemented**. `package.json:80-85` still copies root `steam_appid.txt` via `extraFiles` (confirmed present in `win-unpacked`).
  - *Implementation guidance the plan lacks:* in `afterPack.cjs`, when `process.env.SERENITY_RELEASE === '1'`, `fs.rmSync(path.join(context.appOutDir, 'steam_appid.txt'), {force:true})` and fail if the file read `480`; keep `extraFiles` for dev builds. Add `node scripts/release-gate-check.mjs` at the top of `build-win.mjs`'s `build()` (dev-warn mode) and require `SERENITY_RELEASE=1` for installer targets.
- **CSP is landed and matches the plan text.** `electron/content-security-policy.js` (63 lines): packaged policy at `:50-62` — no remote script origins, hashed first-party inline scripts (computed at runtime from `dist/index.html`, `electron/main.js:350-361`), `style-src 'unsafe-inline'` retained, Google Fonts origins still allowed (`content-security-policy.js:3`; the live `<link>` is `index.html:73`). Escape hatch `SERENITY_DISABLE_CSP=1` (`main.js:364`) — the plan never mentions that this bypass exists; the ship checklist should assert it is unset. CSP unit test exists (`tests/unit/content-security-policy.test.js`).
- **IPC surface:** `electron/preload.cjs` allowlist Sets (`:9-44`) throw on unknown channels, but the **generic `invoke` is still exposed** on `electronAPI` (`preload.cjs:100`) — plan Phase 8 "named wrappers" item still fully open. **`steam:cloud*` handlers pass `filename` unvalidated** to the steamworks API (`electron/steam-integration.js:819-871`) — plan item still open; guidance: validate `^[A-Za-z0-9._-]{1,64}$` and reject path separators at the `ipcMain.handle` boundary.
- **Main process** (`electron/main.js`, 561 lines): `contextIsolation:true, nodeIntegration:false, sandbox:true` (`:397-403`), navigation allowlist (`:78-95`), popups denied (`:406-409`). Accurate per plan/review.

---

## 4. Phase 2 — dependency/packaging hygiene (current facts)

- `dependencies`: only `ez-steam-api ^0.57.1`, `steamworks.js ^0.4.0`. `phaser ^4.1.0`, `three ^0.181.2`, `typescript ^5.9.3`, `vitest ^3.2.4` in devDeps (`package.json:119-137`). Plan's status row is accurate.
- **The unstated conflict (§1.6):** leaving `phaser`/`three` in devDeps generates 149 hard lint errors under airbnb's `import/no-extraneous-dependencies`. Either move bundled browser deps back to `dependencies` (helps SBOM honesty too — they ship compiled into `dist/`), or configure the rule (`"import/no-extraneous-dependencies": ["error", {"devDependencies": true}]` loses signal; better: move them). The plan should make this a *decision with a deadline*, because Phase 0's lint flip is blocked on it.
- `extraResources` filters are tight as described (`package.json:52-79`): steamworks.js excludes linux64/osx dists, ez-steam-api excludes linux bin, koffi ships only `win32_x64`.
- `tornado/*.ts` is now **6 files** (plan says 7; `TornadoBurst.ts` was deleted). They are outside the tsconfig `include` (src/core, src/events only) *and* outside lint (`lint` script is `eslint src --ext .js`, `package.json:17`) — still completely unchecked. Decision still open as the plan says.

---

## 5. Phase 3 — types, tests, gates, fitness (the largest gaps in plan guidance)

### 5a. TypeScript ratchet — mechanics the plan does not give

Current state: `tsconfig.json` `checkJs:false` opt-in (`:9`), include = `src/core/types.d.ts` + `src/core/**/*.js` + `src/events/**/*.js` (`:17-21`) = **76 non-test JS files in scope; exactly 3 carry `// @ts-check`** (`src/core/constants.js`, `src/core/network/message-types.js`, `src/core/scoring.js`) — **4% ratcheted**. `src/core/types.d.ts` is 128 lines: `PlayerSnapshot` (`:50-69`), `StateSnapshot` (`:72-80`), `EventPayloadMap` (`:91-102`), window globals (`:118-128`). The plan's Phase 3a call to extend it for `awaitingSpawn`/`roundGeneration`/`migrationEpoch`/spectator metadata is **not done** — none of those fields appear in the file.

**Proposed ratchet script the plan lacks** (`scripts/ts-ratchet-check.mjs`, run in CI after typecheck):

```
baseline = JSON.parse(read('ts-ratchet.json'))   // {"checkedFiles": ["src/core/constants.js", ...]}
current  = glob(tsconfig.include).filter(f => firstLine(f).startsWith('// @ts-check'))
missing  = baseline.checkedFiles.filter(f => !current.includes(f))
if (missing.length) fail(`@ts-check pragma removed from: ${missing}`)   // backsliding
if (current.length > baseline.checkedFiles.length) warn('update ts-ratchet.json to lock in new coverage')
```

Backsliding today is trivially possible: deleting a pragma silently un-checks a file and `tsc` stays green. The ratchet file makes coverage monotonic. Per-file `@ts-check` is the right mechanism (include-scope expansion would immediately hit three.js type-lag outside core/events); flip `checkJs:true` only when `current.length === scope.length`. Next candidates in dependency order: `src/core/board.js`, `binary-encoding.js`, the event buses — matching the plan's Phase 3a intent.

### 5b. Tests — current inventory and the plan's stale claims

- **95 test files** (65 `tests/unit/` + 30 in `src/`), **584 tests, 583 pass / 1 fail** (~3 s). All plan/review counts are stale.
- **`vitest.config.js:5` includes only `tests/unit/**` and `src/**`** — the 3 files under `tests/integration/` and 29 under `tests/performance/` are *never run by the runner*, and `tests/test-binary-encoding.js`/`test-delta-encoding.js` (root, non-`.test.js` names) are dead to Vitest. The plan never mentions this shadow test estate; it should be triaged (migrate, or delete as false signal — a Phase 2-style trap).
- Coverage gaps confirmed: **no SRS kick-table/T-spin test** (`tests/unit/pieces-rotation-bag.test.js` has 12 tests, zero "kick" references; the only "kick" hits in tests are player-kick in `ffa-spectator.test.js`); **no Phaser board smoke test** (no test boots a `Phaser.Game`); binary round-trip **does** exist (`tests/unit/binary-encoding-roundtrip.test.js`, plus `steam-networking-binary-snapshot.test.js`) — the plan's Track 3b status line is accurate here.
- **Replacing the substring release gate:** concrete behavioral assertions per gated subsystem: (a) performance-monitor: call `getReleaseGateSnapshot()` in a unit test and assert shape+thresholds; (b) theme-manager: activate 2 themes under jsdom and assert `recordThemeSwitch` fired; (c) AppID: keep the file check but also assert `electron/steam-integration.js` reads the same source. Wire as a Vitest `release-gate.test.js` so it rides the existing hard gate.

### 5c. GPU gate (Track 3c)

`scripts/odyssey-webgpu-validation.mjs` is real and CI-shaped: boots Vite on :4178, opens each of **10 scenes** in an Electron `BrowserWindow`, greps console against a shader-error regex, writes PNGs to `artifacts/odyssey/webgpu-validation/{webgpu|webgl2}`, exits non-zero on error (`:1-33`). What the plan omits for actually wiring it: a Linux runner needs `xvfb-run` and SwiftShader/lavapipe flags (`--use-gl=swiftshader` / `--enable-features=Vulkan --use-vulkan=swiftshader` for WebGPU-on-Dawn), a `ODYSSEY_VALIDATION_PORT` collision guard, and a ~15-min timeout. Run it on a schedule or on `src/rendering/odyssey/**` path filters — not every PR (cost).

### 5d. Architecture fitness checks (Track 3d) — concrete design

`scripts/architecture-fitness-check.mjs` **does not exist** (verified against `scripts/` listing). Recommendation: **hand-rolled grep/AST walker, not dependency-cruiser** — the rules are string-pattern shaped, the repo is plain ESM, and dependency-cruiser's config/learning overhead buys little here. Baseline-file pattern (same as the ts-ratchet): each rule has a committed allowlist; CI fails on *new* entries, warning-only until baselines are trimmed.

Measured baselines to seed the rules:

| Rule | Today's baseline | Check |
|---|---|---|
| No DOM in `src/core/**` | **10 files** match `document\.\|getElementById` (incl. the god-class's overlay code) | `grep -rln` allowlist; fail on new file |
| No new raw `ShaderMaterial` | **392 hits in 54 files** under `src/` | count per file vs baseline JSON; fail on growth |
| No new event bus | 2 known (`src/events/event-bus.js`, `multiplayer-events.js` optimized bus) | fail if a new file matches `class .*EventBus\|createEventBus` outside the two |
| No `window.*` debug handles outside dev | grep `window\.__\|window\.[a-z]+ =` with allowlist | fail on new |
| Netcode file size | `ffa-p2p-game-state.js` = 5,116 lines | fail if any `src/core/multiplayer/*.js` exceeds baseline+5% (freeze-then-shrink; supports the plan's scope-freeze boundary) |

Sample rule pseudocode:

```
rules = [
  { id:'core-no-dom', glob:'src/core/**/*.js', pattern:/\bdocument\.|getElementById/,
    baseline:'fitness-baselines/core-dom.json', mode:'no-new-files' },
  { id:'no-raw-shadermaterial-growth', glob:'src/**/*.js', pattern:/new (THREE\.)?ShaderMaterial/,
    baseline:'fitness-baselines/shadermaterial.json', mode:'no-count-growth' },
]
for rule: hits = scan(rule); diff = compare(hits, load(rule.baseline))
  if diff.newViolations.length → exit 1 with file:line list
```

### 5e. Perf-budget file — concrete format the plan lacks

No budget file exists anywhere (`reports/` holds one ad-hoc `chromadelic-short-baseline-report.json`). `timeToInteractiveMenuMs` is computed at `src/main.js:5695-5701` (console + report only — no threshold). Proposed `perf-budgets.json` at repo root:

```json
{ "capturedAt": "2026-07-XX", "machine": "RTX5080-laptop/iGPU-noted",
  "budgets": {
    "timeToInteractiveMenuMs": { "baseline": null, "max": 4000 },
    "installerBytes":          { "baseline": 625923068, "max": 450000000 },
    "appAsarBytes":            { "baseline": 677591834, "max": 250000000 },
    "snapshotBytesP95":        { "baseline": null, "max": null },
    "odysseyFrameP95Ms":       { "baseline": null, "max": null } } }
```

Capture protocol: boot metric from the existing `desktop:startup-mark`/report path under `SERENITY_ENABLE_LOGGING=1`; installer/asar bytes from `release/` after `build:win` (checkable in CI-release only); frame p95 via the existing `odyssey-perf-baseline.mjs` artifacts; snapshot bytes from `netDiag` counters in a 2-peer soak. Nulls mark "budget declared, baseline pending" — making the plan's "a budget with no baseline is unfalsifiable" concern explicit and lintable.

---

## 6. Phase 8 — packaging/release facts and missing guidance

- **Sizes (measured):** `public/assets/music` = **257 MB, 36 MP3s** (largest 12 MB `shifting-sands.mp3`); `public/assets` total 358 MB; `dist/` = **648 MB** (music copied verbatim); `app.asar` = **677,591,834 bytes (~646 MiB)**; installer ~597 MiB. **No `asarUnpack` and no media `extraResources` exist in the build config** (`package.json:38-109`) — the whole catalog is inside the asar, so every update rewrites a ~646 MiB monolith. Opus/Ogg at ~96-128 kbps VBR would take 257 MB → ~60-80 MB; note `assets/audio/intro/*.ogg` already proves Ogg playback works in-app (`public/assets/audio/intro/warp.ogg` is git-tracked and present in `dist/` — the plan's "ensure tracked+packaged" item is **done**).
- **Signing:** `win.signtoolOptions.signingHashAlgorithms` present (`package.json:89-93`) but no cert is wired; `build-win.mjs:18-21` documents `CSC_LINK`/`CSC_KEY_PASSWORD` as env-only. **`author` is still `""`** (`package.json:117`) — electron-builder warns and NSIS metadata is blank. *Missing from plan:* OV/EV cert acquisition lead time (days-to-weeks of business validation — order early), and that SmartScreen reputation accrues per-cert, so signing the *first* public build matters most.
- **Steam depot upload:** no `steamcmd`/depot script exists anywhere in `scripts/`. Guidance the plan lacks: an `app_build.vdf` + `depot_build.vdf` pair pointing at `release/win-unpacked/`, driven by `steamcmd +login <builder> +run_app_build`, with the release workflow asserting the release gate passed and `steam_appid.txt` is absent from the depot content before upload.
- **Auto-update ambiguity:** the packaged app contains `app-update.yml` and `latest.yml` is emitted to `release/` — electron-updater scaffolding exists but Steam builds must NOT self-update (Steam owns updates). Decide and document; strip `latest.yml` from depot content.
- **Crash reporting:** nothing exists (no `crashReporter` reference in `electron/`). Options: Electron `crashReporter` + a crash endpoint, or Sentry Electron SDK (needs CSP `connect-src` addition — note the interaction with the CSP module the plan doesn't flag). The support-bundle path also has no implementation yet.
- **Fonts:** self-hosting Orbitron/Space Mono means downloading 2 woff2 families to `public/assets/fonts/`, a local `@font-face` css, deleting `index.html:73`, and dropping both Google origins from `content-security-policy.js:3` — then updating the CSP unit test. Half a day, fully specified nowhere in the plan.

---

## 7. Per-item risk / abort criteria the plan should add

- **Lint hard-flip:** abort if the `--fix` bulk commit changes runtime behavior (run full Vitest before/after; the 1,749 `indent` fixes are safe, `prefer-destructuring` autofixes are not always). Land fix-only and manual-triage as separate commits.
- **EOL working-tree refresh:** do it with zero open branches on the machine; `w/mixed` files (58) may show as fully rewritten in the next real diff — expected, but it will pollute `git blame` for those files (consider `.git-blame-ignore-revs`, which the plan never mentions).
- **asarUnpack/extraResources media move:** risk is the Electron absolute-path trap already in project memory (music manifest fetch broke packaged builds once). Success = packaged smoke test plays music from the new location; abort = any `fetch` of moved assets 404s in `win-unpacked`.
- **CI release gates:** risk of blocking dev flow if `SERENITY_RELEASE=1` leaks into PR jobs — keep the hard mode exclusively in the release workflow/packaging path.
- **GPU gate in CI:** SwiftShader WebGPU support is version-sensitive; abort criterion = if Dawn-on-SwiftShader cannot compile the pipelines, fall back to running only the `ODYSSEY_FORCE_WEBGL=1` leg in CI and keep the WebGPU leg as a local pre-release step.

## 8. Validation / success measures per area

| Item | Measure |
|---|---|
| Phase 0 ratchet done | Red typecheck/test/lint/release-gate PR cannot merge; lint job has `continue-on-error` removed; `ts-ratchet.json` committed |
| AppID/packaging gate | `SERENITY_RELEASE=1` packaging fails on 480; `win-unpacked` contains no `steam_appid.txt` in release mode (scriptable assert in afterPack) |
| Supply chain | `npm audit --omit=dev --audit-level=high` green in CI (already 0 today); Dependabot PRs flowing; SBOM artifact attached to releases |
| Test harness | 584→N tests all green in CI; SRS-kick + Phaser-smoke files exist; integration/performance test estate triaged (in runner or deleted) |
| Fitness checks | `architecture-fitness-check.mjs` runs in CI with committed baselines; god-class line count monotonically non-increasing |
| Perf budgets | `perf-budgets.json` committed with ≥3 non-null baselines; release workflow compares installer/asar bytes against it |
| Installer slimming | app.asar < 250 MiB after Opus re-encode + media unpack; delta-update viability (blockmap effectiveness) rechecked |

---

*Report prepared from direct measurement: `git ls-files --eol`, full ESLint JSON run, full Vitest run, `npm audit` both scopes, `du` on assets/dist/release, and file reads of every config cited.*
