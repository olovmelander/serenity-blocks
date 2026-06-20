# Odyssey Wave V Capture Report

**Status:** Wave V capture/review complete June 12 2026; Wave R readability fixes in progress.
**Plan source:** `docs/ODYSSEY_CHAPTER_MASTERPIECE_PLAN.md`, Wave V.
**Capture harness:** `scripts/odyssey-chapter-capture.mjs`

## 1. Capture Protocol

Run chapter captures one chapter at a time so each Electron session compiles only the target chapter plus immediate neighbors.

```powershell
npm run capture:odyssey:chapter -- --chapter 1
npm run capture:odyssey:chapter -- --chapter 2
npm run capture:odyssey:chapter -- --chapter 3
npm run capture:odyssey:chapter -- --chapter 4
npm run capture:odyssey:chapter -- --chapter 5
npm run capture:odyssey:chapter -- --chapter 6
npm run capture:odyssey:chapter -- --chapter 7
npm run capture:odyssey:chapter -- --chapter 8
```

Backend and load checks:

```powershell
npm run capture:odyssey:chapter -- --chapter 1 --force-webgl
npm run capture:odyssey:chapter -- --chapter 5 --quality Minimal
npm run capture:odyssey:chapter -- --chapter 6 --quality Minimal
npm run capture:odyssey:chapter -- --seam 5-6
npm run capture:odyssey:chapter -- --seam 6-7
```

Harness defaults: 1280x720, pixel ratio 1.0, High quality, `skipIntro=1&odysseyAAA=1&odysseyOverlay=0`, scoped chapter loading via `odysseyCaptureChapters`, adaptive quality disabled for capture evidence, and no background chapter loading.

## 2. Artifact Map

Artifacts write to `artifacts/odyssey/wave-v/<variant>/`.

Each variant includes:

- `capture-manifest.json`
- one `.png` and one `.json` metrics sidecar per still frame
- three motion-burst frames per chapter
- `console.log`
- seam variants additionally include `seam-*-frame-metrics.json`

## 3. Harness Smoke

| Date | Command | Result |
|------|---------|--------|
| June 12 2026 | `npm run capture:odyssey:chapter -- --chapter 1 --frames 2 --quality Minimal` | Pass. Wrote two 1280x720 still frames, three 1280x720 motion-burst frames, and JSON sidecars to `artifacts/odyssey/wave-v/chapter-01-minimal-webgpu/`; manifest reported backend `webgpu`, pixel ratio `1`, debug overlay absent, and loaded chapters `1,2`. Spot-checked still and motion frames show no app chrome. |

## 3.1 Full Capture Run

| Date | Scope | Result |
|------|-------|--------|
| June 12 2026 | Chapters 1-8, High, WebGPU | Pass. Each chapter wrote 20 still frames, 3 motion-burst frames, JSON sidecars, a manifest, and a console log. All manifests report pixel ratio `1`, debug overlay absent, and capture-scoped chapter loading. |
| June 12 2026 | Chapter 1, High, WebGL2 fallback | Pass. Wrote the same 20 still + 3 motion-burst frame set to `artifacts/odyssey/wave-v/chapter-01-high-webgl2/`; manifest reports backend `webgl2`, pixel ratio `1`, debug overlay absent, and loaded chapters `1,2`. |
| June 12 2026 | Chapters 5 and 6, Minimal, WebGPU | Pass artifact generation. Both quality-ladder checks wrote full chapter frame sets; Ch5 fails readability at Minimal, while Ch6 preserves the High read but still inherits the chapter's void/hero failures. |
| June 12 2026 | Seams 5-6 and 6-7, High, WebGPU | Pass for artifact generation. Each seam wrote 8 visual ramp frames and metrics. Timing data is useful as failure evidence but remains caveated; screenshot capture and hidden-window throttling both affect `requestAnimationFrame` sampling, so a dedicated live/profiler pass is still needed for final hitch numbers. |

## 3.2 Wave R Follow-Up Captures

| Date | Scope | Result |
|------|-------|--------|
| June 12 2026 | Chapter 3, High, WebGPU after blue-water/foliage/bird pass | Improved. The short early-only water strip was replaced by a longer blue corridor, the shoreline wet band no longer reads brown, grass/tree colors are deeper, and the bird silhouettes are larger/more legible with CC0 Quaternius candidates recorded for a future GLTF import. Late frames now keep cyan/blue water, but the chapter still needs a Zelda-like open-air value pass: cloud/snow wash and rail dominance remain too strong. |
| June 12 2026 | Chapter 5, High + Minimal, WebGPU after dark-backstop pass | Improved. The lavender/white wash is replaced by an indigo backstop with readable green aurora bands in both High and Minimal. Rail/marble are reduced but still visible as strong accents; the corona-overhead moment and final figure-ground pass remain open. |
| June 12 2026 | Chapter 7, High, WebGPU after violet-floor/fold/dust pass | Improved. The midsection now carries a blue-violet lensed floor/tunnel and corridor dust instead of pure black rail. Body frames 06-17 average `46.9%` near-black pixels by the `rgb < 8` screen metric, down from the original ~86% body void read. The chapter is still very dark by luminance and needs disk-plane crossing/hero dominance polish. |
| June 12 2026 | Chapter 8, High, WebGPU after Retrosun/facade/path pass | Partial. The facade salt-and-pepper is calmer, the cyan path is capped, and body frames 06-17 average `36.6%` near-black pixels by the `rgb < 8` screen metric with no sampled body frame over 50%. The pure-luminance dark read remains severe (`~90%` under luma 18), the Retrosun still reads cold/transition-bound rather than warm, and frames 09-10 still miss the sun/bridge hero event. |

## 4. Pass/Fail Matrix

| Ch | Capture set | Value bands | Void law | Hero visibility 10/50/90 | Rail figure-ground | Motion burst | Verdict |
|----|-------------|-------------|----------|----------------------------|--------------------|--------------|---------|
| 1 | `chapter-01-high-webgpu` | Fail: orange/red two-band body, repeated compositions | Fail: late seam/title-adjacent frames exceed 50% void | Fail: First Heart is not distinct at entry/midbody | Fail: rail/crystals compete with world hero | Fail: burst repeats crystal/rail composition, no lava-surf event | Fail |
| 2 | `chapter-02-high-webgpu` | Fail: cyan caustic wallpaper dominates body | Fail: entry/early body has empty transition void; depth floor weak | Fail: manta hero absent/unreadable; ring/rail become focal | Fail: rail and Pearl Gate outshine life/depth | Fail: burst stays cyan/ring, no escort read | Fail |
| 3 | `chapter-03-high-webgpu` | Partial after Wave R pass 1: blue water continuity and deeper foliage improved, but cloud/snow wash still flattens late frames | Pass: body frames are not mostly void | Partial: Great Tree/landscape read, birds improved, but not yet a dominant 10/50/90 landmark | Fail/Partial: yellow-white rail remains the strongest sustained edge in many frames | Partial: life/parallax and bird motion read better, but burst still needs one authored open-air adventure beat | Partial, needs Zelda-like value/rail polish |
| 4 | `chapter-04-high-webgpu` | Partial: mountains/flags/cairns add bands, snow still grey-blue and low contrast | Pass | Partial: summit identity appears, early/mid hero read is weak | Fail: white rail/marble still wins many frames | Partial: flags/eagles/spindrift read, but rail remains focal | Fail |
| 5 | `chapter-05-high-webgpu` | Partial after Wave R pass 1: indigo/green bands now read, lavender wash mostly removed | Pass | Partial: aurora reads through body, corona-overhead moment still unclear | Partial: rail is dimmer but remains a strong accent | Fail: burst lacks clear corona-overhead approach/peak/release | Partial, needs moment/rail polish |
| 6 | `chapter-06-high-webgpu` | Partial: crimson filament body works, but black field dominates | Fail: body average void ~54%, late frames up to ~88% | Fail: black hole reads late, not consistently at 10/50/90 | Fail: rail still competes until late hero frames | Partial: black-hole motion reads in one burst, body burst remains void/rail | Fail |
| 7 | `chapter-07-high-webgpu` | Partial after Wave R pass 1: blue-violet tunnel/floor now reads, but the chapter remains intentionally very dark | Partial: body frames 06-17 average `46.9%` near-black; worst body frames sit just under 50%, but dark-luminance coverage remains high | Partial: entry/exit hero still strong and midsection now has lensed structure; disk-plane crossing still missing | Partial: rail is capped but remains a strong contour in the body | Partial: burst now has lensed floor/dust continuity, but still lacks a single authored disk-plane crossing accent | Partial, needs hero/moment polish |
| 8 | `chapter-08-high-webgpu` | Partial after Wave R pass 1: window tiers and sky floor are calmer, but the mid-value sun/haze hierarchy still does not fully land | Pass by `rgb < 8`: body frames 06-17 average `36.6%` near-black; residual dark-luma coverage remains high | Fail/Partial: Retrosun reads in frames 06-08 but remains cold and drops out by 09-10 | Partial: path cap reduces electric-cyan dominance, but path/facade fragments still beat the sun limb in body frames | Fail: repeated tilted-facade corridor remains; Gate Bridge/sun event still unclear | Partial, needs structural Retrosun/bridge pass |

## 5. Seam Measurements

| Seam | Capture set | Max frame ms | >33 ms frames | Luminance / continuity read | Verdict |
|------|-------------|--------------|---------------|------------------------------|---------|
| 5-6 | `seam-5-6-high-webgpu` | 701.4 | 10 | Fail: lavender/white atmosphere drops into dark space; carried membrane/filament is not enough to bridge value | Fail timing and continuity, caveated |
| 6-7 | `seam-6-7-high-webgpu` | 125.2 | 45 | Fail: disk appears abruptly, then collapses back to black-void rail frames | Fail timing and continuity |

## 6. Backend / Quality Checks

| Check | Capture set | Expected | Result | Verdict |
|-------|-------------|----------|--------|---------|
| Chapter 1 WebGL2 fallback | `chapter-01-high-webgl2` | Same composition/readability as WebGPU smoke | Pass parity: visually matches WebGPU, including the same Ch1 failures | Pass parity |
| Chapter 5 Minimal | `chapter-05-minimal-webgpu` | Heavy sky systems degrade by count/load without losing chapter read | Improved after Wave R pass 1: Minimal preserves the new indigo/aurora read, but still lacks the corona-overhead moment | Partial |
| Chapter 6 Minimal | `chapter-06-minimal-webgpu` | Space additive systems degrade by count/load without losing hero aim | Pass parity/degradation smoke: Minimal preserves the same read as High; chapter still fails void/hero criteria | Pass parity, chapter fail |

## 7. Review Notes

Capture evidence exists for the full Wave V set, and the visual review confirms the June 11 implementation is still not acceptance-clean. The assets are present in many chapters, but the recurring failure remains value hierarchy: authored features often lose to rail/marble brightness, additive wash, or black void.

Review sheets were generated under `artifacts/odyssey/wave-v/review-sheets/` for the chapter, seam, WebGL2, and Minimal checks.

Seam timing note: sampling frame timing while screenshots are captured pollutes the metric, while hidden Electron windows throttle `requestAnimationFrame`. A timing-only visible-window experiment produced useful evidence but proved brittle on rerun, so the committed artifacts should be treated as capture evidence plus preliminary timing, not final profiler telemetry.

Seam timing result: both measured seams miss the 33 ms gate in the available capture evidence and should be treated as Wave R/performance failures unless a later live-session profile contradicts these measurements.

Wave R priority from the captures:

1. Ch5 dark backstop/value structure before any aurora/corona brightening. First pass complete; remaining Ch5 work is corona-overhead motion/rail polish.
2. Ch7 midsection violet floor/fold arcs/corridor dust. First pass complete; remaining Ch7 work is disk-plane crossing, hero dominance, and final rail polish.
3. Ch8 Retrosun apparent placement plus facade value tiers/horizon haze. First pass complete; remaining Ch8 work is structural Retrosun/skyline staging for frames 09-10, a warm-sun read independent of the 7-8 transition, and the Gate Bridge shadow/reveal event.
4. Ch3 second art-direction pass: Zelda-like open-air value grouping, rail/cloud subordination, and eventual CC0 bird GLTF import.
5. Ch2 darkness inversion and manta hero staging; the chapter still reads as cyan wallpaper.
6. Journey-wide rail/marble luminance caps, especially Ch3-Ch5 and Ch7.
7. Ch6 hero aim/void reduction so the black hole owns the 10/50/90 read.
8. Ch4 snow-shadow value correction and rail subordination.
9. Ch1 First Heart isolation and repeated composition/lava-surf event fix.
