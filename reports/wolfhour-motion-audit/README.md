# Wolfhour depth and motion audit

`baseline-build/` is an immutable production build of the **completed previous Wolfhour overhaul**. It is not the original repository version. `baseline-manifest.json` records the compiled asset hash and the readable source companion. Do not rebuild this directory from current source.

Start the frozen baseline server in a separate terminal:

```powershell
node reports/wolfhour-motion-audit/serve-baseline.mjs
```

The previous pass is served at port 4180. The current candidate uses the isolated production build and server already provided under `reports/wolfhour-overhaul/` (port 4178):

```powershell
node reports/wolfhour-overhaul/build-prototype.mjs
node reports/wolfhour-overhaul/serve-prototype.mjs
```

Capture tools start one private headless Chrome profile and close it afterward. Run them sequentially; never run two GPU captures at once.

## Static comparison

```powershell
$env:WOLFHOUR_CAPTURE_DIR = 'reports/wolfhour-motion-audit'
$env:WOLFHOUR_CAPTURE_NAME = 'previous-t8-center'
$env:WOLFHOUR_CAPTURE_URL = 'http://127.0.0.1:4180/reports/wolfhour-overhaul/prototype.html?shipping=1&quality=High&seed=73013&t=8&pointerX=0&pointerY=0'
node reports/wolfhour-overhaul/capture-original.mjs
node reports/wolfhour-overhaul/summarize-original.mjs previous-t8-center
```

For the candidate, replace port 4180 with 4178 and choose a different report name. Use `t=8`, `t=24`, and `t=50` for phase comparisons. Pointer values are normalized to `[-1,1]`; `pointerX=-1&pointerY=-1` and `pointerX=1&pointerY=1` provide settled extreme poses. The capture runner applies this pose through the exposed shipping theme, so the older frozen bundle supports the same pointer parameters without rebuilding it.

## Motion comparison

With the same environment variables, run:

```powershell
$env:WOLFHOUR_CAPTURE_NAME = 'previous-motion-t8-center'
node reports/wolfhour-motion-audit/capture-motion.mjs
```

This captures two independent 180-frame windows after 45 warmup frames per window. Each window resets to the requested `t`, advances simulation in exact 1/60-second steps, and stops after three simulated seconds. With `t=8`, screenshots show `t=8` before and `t=11` after. The report includes each achieved simulation time, camera and layer world positions at one-second intervals, render dimensions, content counters, and compiled asset hashes.

CPU samples include `effect.update()` and rendering. GPU samples are recorded once per completed timestamp resolve. The RAF intervals include query synchronization and must not be presented as gameplay FPS. This harness measures the isolated ambient surface and rejects event parameters; use static event captures separately. Both versions use their own shipping fixture update callback, including its existing zero-delta camera smoothing behavior; pointer captures therefore deliberately start in the settled pose.

`WOLFHOUR_VIEWPORT` defaults to `1280x720`; use `720x1280` for portrait framing checks. DPR remains 1. `WOLFHOUR_MCP_BIN` can override the local Chrome DevTools MCP executable path. A failed readiness check, WebGPU/browser error, missing timestamp samples, changed ambient draw content, or unexpected dimensions makes the motion runner exit nonzero and retain the diagnostic JSON.

## Accepted result

`verification.json` records the final source hashes, checks, motion comparison, and nine screenshot cases. Run `node reports/wolfhour-motion-audit/capture-static-set.mjs` against port4178 to repeat the screenshots, then `node reports/wolfhour-motion-audit/summarize-validation.mjs` after both motion reports are present. The summary rejects mismatched compiled assets and enforces equal draws and a triangle difference below2%.

The final motion medians matched the prior pass at0.196608ms, with22 draws in both and121715→119315 triangles. `revised-motion-first.json` retains an earlier launch of the same bundle that measured0.262144ms in both windows. Timestamp quantization and shared workstation load limit the conclusion; these observations do not certify full-game FPS. The original overhaul report uses a different, older baseline and is retained separately.
