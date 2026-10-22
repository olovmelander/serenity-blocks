# Electron 38.8.6 → 44.9.3 (2026-10-22)

The desktop runtime moved from Electron 38.8.6 (Chromium 140, Node 22.22) to an exact pin of
44.9.3 (Chromium 152.0.7977.167, Node 24.22, V8 15.2). Electron 38 had been out of support since
2026-03-10 and carried 24 published advisories, 8 of them high. This is decision 5 of
[OWNER_DECISIONS_RESEARCH_2026-10-13.md](OWNER_DECISIONS_RESEARCH_2026-10-13.md); that document
named 44.7.1, the newest 44 release on 13 October. 44.9.3 is the newest patch of the same line.

## What changed in the code

| Change | Why |
|---|---|
| `package.json`: `"electron": "44.9.3"` (exact), `engines.node` `>=22.12.0` | Electron 44's package requires Node 22.12+. CI and the dev machine run Node 24. |
| `scripts/validate-all-themes.mjs` resolves `electron` when it first spawns a worker, not at import | From Electron 42, resolving the package downloads the binary (about 100 MB) when it is absent. A unit test imports this module, and CI installs with `--ignore-scripts`, so every `npm test` would have downloaded Electron. Checked by hiding `node_modules/electron/path.txt`: no download. |
| `electron/main.js`: the navigation guard reads `event.url` | The positional `url` argument of `will-navigate` / `will-redirect` is deprecated in 44. |

Every other breaking change in 39–44 was checked against `electron/`, the packaging hooks and the
capture scripts and does not touch this code. The full list is in the session record; the ones
worth knowing: ANGLE is linked statically in 44 (no `libEGL.dll` / `libGLESv2.dll`), and
`NativeImage.toBitmap()` converts to sRGB by default from 43 (capture scripts only).

## Measured: the same `dist/`, packaged twice

Method: `electron-builder --win dir` built the same `dist/` (one `app.asar`, 472 MB) once with
44.9.3 and once with `-c.electronVersion=38.8.6`. Each run launched the packaged exe with a fresh
`--user-data-dir`, `SERENITY_ENABLE_DIAGNOSTICS=1` and a CDP port. It read the startup marks from
`main-debug.jsonl`, dismissed the title, then played Single Player for 10 s per theme (Forest, then
Wolfhour, unlocked through `?unlockAll=1`) with hard drops spread across the well. Six runs,
interleaved 44/38, after one warm-up launch each (the first launch of a new unsigned build spends
about 20 s in a Defender scan). Laptop RTX 5080 (Blackwell), D3D12, 2561 × 1527, vsync at about
175 Hz. Medians of three:

| | 38.8.6 | 44.9.3 |
|---|---|---|
| Launch → `renderer-html-ready` | 537 ms | 397 ms |
| Launch → `startup-shell-ready` | 784 ms | 649 ms |
| Launch → `photosensitivity-warning:ready` (first screen) | 3,037 ms | 2,904 ms |
| Forest frame interval p50 / p95 / p99 | 5.6 / 6.3 / 6.8 ms | 5.6 / 6.4 / 6.8 ms |
| Wolfhour frame interval p50 / p95 / p99 | 5.6 / 6.3 / 7.0 ms | 5.6 / 6.3 / 6.7 ms |
| Main-thread long tasks during play | 0 | 0 |
| Wolfhour switch (cold Dawn cache) | 175 ms | 160 ms |
| GPU process working set, Forest | 668 MB | 610 MB |
| Renderer working set, Forest | 473 MB | 501 MB |
| Console errors (6 runs) | 0 | 0 |
| WebGPU adapter features | 15 | 20 (with `texture-component-swizzle`) |

Play is vsync-bound on this GPU, so frame intervals show pacing, not cost: identical. Boot is about
135 ms faster to every phase; the GPU process holds about 58 MB less and the renderer about 30 MB
more. Both versions ran every theme on the WebGPU backend.

## Packaged smoke on 44.9.3

- The steamworks.js N-API module loads from `resources/native_modules`. This machine has no Steam
  client, so init failed cleanly ("Could not determine Steam client install directory") and the
  game ran offline. Packet reads return V8-owned copies, so the V8 memory cage does not apply.
- Placeholder songs play from inside `app.asar` under their `?song=` URLs, and the player names
  each one correctly (Astral Weave, Chromadelic Highway, Blood Moon, back to Astral Weave).
- `window.open` returns null; `location.assign('https://…')` is blocked and the page stays on
  `app.asar/dist/index.html`.

## Not verified yet

- A Steam login, the overlay (Shift+Tab; ANGLE is now static) and a two-machine P2P session: they
  need a machine with the Steam client, and the session in
  [TWO_MACHINE_STEAM_VALIDATION.md](TWO_MACHINE_STEAM_VALIDATION.md) should run on this build.
- The integrated Radeon 610M (`force_low_power_gpu`), and the GPU-validation workflow.
- The compile timings in ADR-0020 were measured on Electron 38; re-measure them before quoting them
  again (ADR-0016).
- The capture harnesses' swizzle shim (`reports/wolfhour-moonlit-night/harness/wh-preload.cjs`) was
  needed because Chromium 140 lacked `texture-component-swizzle`; 44's adapter has it. Remove the
  shim once a capture without it is clean.
- The rest of decision 5 is still open: a meta CSP, a deny-by-default permission handler, IPC sender
  checks, fuses and an `app://` origin.
