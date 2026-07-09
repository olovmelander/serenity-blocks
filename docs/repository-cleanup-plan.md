# Repository Cleanup Plan

**Date:** 2026-06-05
**Scope:** tracked repository files that appear stale, generated, misplaced, redundant, or risky to keep in the source tree.
**Goal:** reduce repository noise and tracked binary weight without deleting live game assets, canonical docs, or active work-in-progress plans.

## Research Summary

The repository currently has 2,416 tracked files and 432 tracked markdown files. A previous structured cleanup scan identified 53 candidate groups; I re-checked the high-value groups against the current working tree with `git ls-files`, `rg`, file-size scans, `.gitignore`, and selected file reads.

The main cleanup opportunities are:

- Generated or validation output is tracked even when it should be ignored.
- Large root-level asset dumps are not referenced by live code.
- The root contains hundreds of one-off implementation, fix, phase, and debug markdown notes.
- Electron has stale backup/preload/launcher files that are not loaded by the live entry points.
- A few media files are probably packaging mistakes and should be re-encoded or owner-verified before removal.

Do not treat this as a blind delete list. The plan below separates low-risk cleanup from archive-first or investigate-first work.

## Safety Rules

Before cleanup:

1. Create a branch, for example `cleanup/repository-files`.
2. Keep `README.md`, `CONTRIBUTING.md`, `CREDITS.md`, `HOW_TO_RUN.md`, `PHASER_QUICKSTART.md`, `RECOMMENDATIONS.md`, `game_description.md`, `single_player_death.md`, and music prompt docs.
3. Keep docs used by tests or source comments as living references.
4. Keep live assets under `src/themes/**`, `public/assets/music/**`, `public/textures/**`, and theme-specific `assets/` directories unless a per-asset reference audit proves otherwise.
5. Prefer `git rm --cached` plus `.gitignore` for generated outputs and raw working directories that may still be useful locally.
6. Archive historical markdown before deletion unless it is clearly a runtime/debug/generated artifact.

## Phase 1 - High-Confidence Untrack Or Delete

These have the best risk-to-reward ratio.

| Target | Current evidence | Action | Risk |
|---|---:|---|---|
| `theme-screenshots/` at repo root | 266 files, 379.33 MB. `scripts/capture-theme-screenshots.mjs` writes to `docs/theme-screenshots`, not root. No live code references root `theme-screenshots/`. | Archive locally, then `git rm -r --cached theme-screenshots/`; add `/theme-screenshots/` to `.gitignore`. | Low, but preserve `theme-icons-raw/` locally because it may contain original icon-generation source images. |
| `assets/` at repo root | 13 files, 123.38 MB. Contains `assets/characters/troll/**` TripoSR/UniRig work files. No non-binary live references to `troll-rigged`, `troll-triposr`, or `characters/troll`. | Archive locally, then `git rm -r --cached assets/`; add `/assets/` to `.gitignore`. | Medium because generated model source may be expensive to recreate. |
| `artifacts/` | 307 files, 89.15 MB. Already matched by existing `.gitignore` but still tracked. Mostly timestamped validation screenshots/reports. | `git rm -r --cached artifacts/`. | Low. |
| `docs/validation/` | 87 files, 33.9 MB. Timestamped validation captures and metrics. | `git rm -r --cached docs/validation/`; add `/docs/validation/` to `.gitignore`. | Low. |
| Root log/output files | `server.log`, `debug_output.txt`, `test_output.txt`, `test_output_2.txt`. | `git rm --cached server.log`; delete the three debug/test output files if no one needs the exact old logs. Add `debug_output.txt` and `test_output*.txt` to `.gitignore` if these recur. | Low. |
| `.vite/deps_temp_ee082f87/package.json` | Accidental Vite temp cache file. | `git rm -r --cached .vite/`; add `/.vite/` to `.gitignore`. | Low. |
| `.codex` | Empty tracked file. | `git rm .codex`. | Low. |
| `temp_img/*.cjs` | Four one-off image-processing scripts. | `git rm -r temp_img/`. | Low. |
| Root docs screenshots | `docs/May 11, 2026, 12_14_20 PM.png`, `docs/Skärmbild 2026-05-24 230340.png`, `docs/Skärmbild 2026-05-24 230518.png`; no references found. | `git rm` the three files. | Low. |

Suggested `.gitignore` additions:

```gitignore
# Repository cleanup: generated or local-only outputs
/.vite/
/theme-screenshots/
/assets/
/docs/validation/
debug_output.txt
test_output*.txt
```

## Phase 2 - Dead Or Stale Code/Script Files

These are small but reduce confusion and package noise.

| Target | Evidence | Action | Risk |
|---|---|---|---|
| `electron/SerenityBlocksLauncher.exe` | Compiled binary committed to source. `scripts/afterPack.cjs` says the GPU preference launcher was removed in favor of `app.commandLine.appendSwitch('force-high-performance-gpu')`. | `git rm electron/SerenityBlocksLauncher.exe`. | Low. |
| `electron/gpu-preference-launcher.c` and `scripts/build-gpu-launcher.sh` | Only produce the removed launcher. Not wired into package scripts. | `git rm electron/gpu-preference-launcher.c scripts/build-gpu-launcher.sh`. | Low. |
| `electron/main-original.js` | Historical backup. Live entry is `electron/main.js` from `package.json`. It is also bundled because build files include `electron/**/*`. | `git rm electron/main-original.js`. | Low. |
| `electron/preload.js` | Live `electron/main.js` loads `preload.mjs`; `main-minimal.js` loads `preload-minimal.cjs`. `preload.js` is a stale CommonJS variant. | Delete after updating stale docs that still mention it as live. | Medium because preload docs are security-sensitive. |
| `dynamic-songs-snippet.js` | Copy-paste snippet, only references stale `generate-songs.js`. | `git rm dynamic-songs-snippet.js`. | Low. |
| `generate-songs.js` | Uses CommonJS in a `"type": "module"` package, scans root `songs/`, but music lives in `public/assets/music/`. Still referenced by stale music docs. | Either replace with a working ESM generator for `public/assets/music/`, or remove it and update `public/assets/music/README.md` plus `INTEGRATION_GUIDE.md`. | Medium. |
| `install-electron-deps.sh` vs `install-electron-deps-fixed.sh` | Duplicate install helpers. | Keep the fixed script, remove or archive the older one after checking docs. | Medium. |

## Phase 3 - Archive Markdown Clutter

This is the biggest readability cleanup. There are 231 tracked root-level markdown files and 432 tracked markdown files total. The scan identified about 344 archive-grade markdown files: implementation summaries, completion reports, phase notes, fix logs, quick-test notes, and one-off debug guides.

Recommended approach:

1. Create `docs/archive/2026-06-repository-cleanup/`.
2. Move historical notes there in batches with `git mv`, or move them outside the repo if the team does not want them in source control.
3. Keep only canonical guides, active plans, docs linked by `README.md`/`CONTRIBUTING.md`, and docs used by tests/source references.
4. After each batch, run `rg "<moved filename>" README.md CONTRIBUTING.md docs src tests package.json` to catch broken references.

Archive candidate groups:

| Group | Count | Suggested handling |
|---|---:|---|
| `FIX_*`, `*FIX*`, and resolved bugfix summaries | 38 | Archive. |
| `DEBUG_*`, investigation notes, and transient debug guides | 17 | Archive. |
| `PHASE_*` completion, implementation, status, and summary notes | 42 root files plus 27 docs phase reports | Archive, keeping only current migration plans. |
| `QUICK_TEST*`, `TEST_*`, testing-ready notes | 36 | Archive unless still used as current QA docs. |
| `NEBULA_FLOW_*` family | 11 | Archive. |
| `BREATHING_*` family | 10 | Archive, except keep `docs/BREATHING_INDICATOR_GUIDE.md` if still useful. |
| `GAMEPAD_*` and `SERENITY_GAMEPAD_*` family | 10 | Archive. |
| Multiplayer/lobby/FFA development notes | 19 root files plus 13 docs files | Consolidate into one current multiplayer plan plus archive the rest. |
| Performance/optimization development notes | 14 | Archive or consolidate into `optimization-reports/`. |
| Serenity Hub, game-mode, theme, and effects feature notes | 33 | Archive unless actively owned. |
| Per-theme WebGPU/AAA plan docs not cited by code/tests | 33 | Archive after a human glance; many are design history, not active implementation docs. |
| Reorganization, migration-status, and integration completion docs | 8 | Archive. |
| Infinity-mode `phaseN-complete` reports | 7 | Archive; keep `docs/infinity-mode-implementation-plan.md`. |
| Misc completed feature/UI/test-status summaries | 11 | Archive. |
| `docs/minimap-visual-improvements-plan.md` | 1 | Archive if superseded. |

Do not archive:

- `README.md`, `CONTRIBUTING.md`, `CREDITS.md`, `HOW_TO_RUN.md`, `PHASER_QUICKSTART.md`, `RECOMMENDATIONS.md`.
- Active untracked plans visible in the current worktree: `docs/ODYSSEY_CINEMATIC_JOURNEY_PLAN.md`, `docs/gameplay-effects-plan.md`, `docs/quadra-adoption-plan.md`, and the existing `docs/repository-review-plan.md`.
- Docs read by tests as fixtures.
- Source-cited art direction docs unless their source references are removed first.

## Phase 4 - Consolidate Duplicate Or Misplaced Docs

| Target | Action | Notes |
|---|---|---|
| `docs/ONLINE_MULTIPLAYER_IMPROVEMENT_PLAN.md` and `docs/ONLINE_MULTIPLAYER_IMPROVEMENT_PLAN_version2.md` | Keep one canonical plan, archive/delete the older one. | Medium risk because they differ and online multiplayer is active. |
| `optimization-reports/SMOOTHNESS_AUDIT_REPORT.md` and `optimization-reports/SMOOTHNESS_AUDIT_2026-06-04.md` | Keep the dated clean copy, delete `_REPORT.md`. | `_REPORT.md` has stale generated preamble/mojibake. |
| `optimization-reports/optimization-2025-10-02.md` and `optimization-reports/optimization-2025-10-02-1.md` | Human diff, then keep the superset or archive both. | Not a trivial duplicate. |
| `themes/` root dir | Delete or move any still-useful template text into `docs/archive/`. | Live themes are under `src/themes/`; root `themes/` refers to old `script.js`/`style.css` architecture. |
| `styles/CSS_ORGANIZATION_GUIDE.md` | Move to `docs/archive/` or delete. | Live styles live in `public/styles/`; this is a stray top-level planning doc. |

## Phase 5 - Investigate Before Changing

These may be unnecessary, but they need one extra owner or asset check.

| Target | Why flagged | Next step |
|---|---|---|
| `public/assets/audio/breathwork/voices/elixir/r3_hold.wav` and `r3_recovery.wav` | 25.92 MB and 24.86 MB, around 60x larger than sibling breathwork clips. Breathwork voices are live. | Inspect with `ffprobe`; if they are accidental high-rate/uncompressed files, re-encode to match the other voice clips. Do not delete blindly. |
| `docs/theme-screenshots/` | The capture script writes here, and current docs reference it as a committed precedent. | Keep if screenshots are intentional QA baselines; otherwise move to generated artifact storage and ignore future captures. |
| `TOOLING_SETUP.md` and `ONLINE_MULTIPLAYER_TESTING_GUIDE.md` | Potentially still useful despite weak references. | Ask owners or fold into current setup/testing docs. |
| `assets/characters/troll/**` final outputs | No live references, but final GLBs/OBJ may be planned content. | Archive locally first; delete only after owner confirms this character is abandoned. |
| Live theme/media binaries | Many are large, but most map to shipped themes. | Do not bulk-delete. Run a per-theme asset reference audit if size remains a concern. |

## Suggested Cleanup Order

1. Untrack generated outputs: `artifacts/`, `docs/validation/`, root `theme-screenshots/`, root `assets/`, `.vite/`, and `server.log`.
2. Delete small obvious artifacts: `.codex`, `temp_img/`, root debug/test output files, unreferenced root docs screenshots.
3. Remove stale Electron backup/launcher files, then update stale docs that mention removed Electron files.
4. Consolidate duplicate plans and optimization reports.
5. Archive markdown groups in batches, checking references after each batch.
6. Investigate and fix media anomalies, especially the two oversized elixir WAVs.

## Verification Checklist

After each cleanup batch:

```powershell
git status --short
git ls-files -ci --exclude-standard
rg "main-original|preload\.js|SerenityBlocksLauncher|gpu-preference-launcher|theme-screenshots|characters/troll" README.md docs src tests package.json
npm run build
npm run lint
npx vitest run
```

Expected outcomes:

- `git ls-files -ci --exclude-standard` should be empty or only show intentional exceptions.
- `npm run build` should still include live assets under `src/themes/**`, `public/assets/**`, and `electron/main.js`.
- No source or README references should point to deleted files.
- Packaged Electron output should no longer include dead backup files such as `electron/main-original.js` or the removed launcher.

## Cleanup Impact Estimate

High-confidence untrack/delete candidates account for roughly 630 MB of tracked working-tree weight before history cleanup. Re-encoding the two anomalous elixir WAVs could recover another roughly 50 MB while preserving live breathwork audio.

This plan does not rewrite Git history. To shrink the repository clone size from past commits, a later history-rewrite pass would be needed after the team agrees on the removals.
