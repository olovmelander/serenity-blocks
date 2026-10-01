# Serenity Blocks opening and identity - 2026-10-01

Branch: `feature/cinematic-boot-redesign`, based on main at `16ea2e64`.
The opening combines a colorful cosmic atmosphere, a continuous title handoff,
and an original wordmark shared across loading, intro, and menus.

## Logo research and direction

Reviewed official logos and a published game identity case study on 2026-10-01. These are design
observations, not an objective ranking of game logos:

| Reference | Observation | Applied to Serenity Blocks |
| --- | --- | --- |
| [Lumines Arise](https://lumines.game/) | Heavy, readable title lettering; a small signature detail; clear hierarchy. | Make the name the primary identity with a strong two-row silhouette. |
| [Tetris Effect: Connected](https://www.tetriseffect.game/) | Color and light belong to the title's presentation as well as its world. | Use a coherent spectrum through BLOCKS, with a high-contrast ivory first row. |
| [COCOON](https://www.cocoongame.com/) | Repeated geometry gives the lettering a consistent visual language. | Draw the glyphs on a common grid with repeated stroke widths and corner shapes. |
| [Lumen identity case study](https://www.toptal.com/designers/graphic/logo-case-study) | The designer revised the lettering to reflect the game's visual world and kept the icon and marketing identity related. | Derive the small symbol from the wordmark's block-fitting O. |

No reference logo or font was used in the shipping assets. The new SVG paths are
original lettering.

## Current design

- **Consistent tagline:** "Stack · Breath · Ascend" now appears below the logo on
  loading, the live intro, both menu variants, and the Serenity hub. Centered dots, balanced tracking and slightly brighter lettering keep it readable. It remains
  visible on short screens, with space reserved between the menu logo and cards.
  Latest captures: [intro](tagline-dots-title.png), [desktop menu](tagline-dots-menu-desktop.png),
  [mobile loading](tagline-loading-mobile.png), [mobile menu](tagline-dots-menu-mobile.png).
- **Custom wordmark:** two optically aligned rows, ivory SERENITY above lavender,
  aqua and mint BLOCKS. A coral square completes the O's separated corner. The
  same detail supplies the compact symbol and its one-time settling entrance.
  [Color master](../../public/assets/branding/serenity-blocks-logo.svg),
  [monochrome master](../../public/assets/branding/serenity-blocks-logo-mono.svg),
  [compact symbol](../../public/assets/branding/serenity-blocks-symbol.svg).
  All are font-independent SVGs; the monochrome master uses `currentColor` inline
  and defaults to black when loaded as an image.
- **Responsive scale:** the accepted design is retained at smaller sizes. Loading
  is capped at 380 px, the live title at 520 px, and the menu artwork at 180 px.
  Width and small-viewport-height constraints reduce these further on phones and
  short windows. Short layouts simplify supporting copy; compact menus place the
  logo in normal flow and reserve the profile card's top row before it loads.
  See [measured sizing checks](wordmark-sizing.json).
- **One continuous 3.2 s opening:** the loading wordmark grows directly into the
  final title while the cover dissolves. The full-color live intro
  appears underneath from the beginning. A transparent aurora adds passing light;
  there is no separate tunnel, opaque middle scene, or second title entrance.
- **Connected geometry:** a ResizeObserver follows the untransformed wordmark
  wrapper and destination title, keeping their alignment through viewport changes. The live copy becomes opaque
  before the cover wordmark fades, preventing a dip in brightness. Supporting copy
  fades before the expanding wordmark can cross it.
  It disconnects after the handoff or on dismissal. No per-frame layout reads.
- **Full background color:** removed the old intro-only 30% saturation / 50%
  brightness filter. Nebula, particles, and blocks keep their original color.
- **Input:** the real "Tap to continue" button unlocks after the handoff. Its
  hit area stays still while its opacity breathes. Keyboard and tap open the menu.
- **Readiness:** the watchdog still protects incomplete startup, but no longer
  skips a ready title merely because the player has not pressed a key. It rearms
  when the player begins the menu transition.
- **Fallbacks:** WebGL/disabled opening uses a 1.2 s CSS dissolve. OS reduced motion
  retains the direct-to-menu path with a brief cover fade and no intro renderer.
  Custom image logos and static/paused warm-up gates remain supported.

The aurora scene (`src/ui/boot-aurora-scene.js`) uses one analytic fullscreen TSL
pass, with no compute buffers, simulation, texture assets, or bloom chain. It was
verified first in the isolated playground:
`playground.html?effect=aurora-opening&orbit=0&phase=hold&t=1.44`.

Existing BootWarp names remain for flags, telemetry, orchestration, and lifecycle
compatibility. Async compilation, priming, GPU drain, frame cadence checks, retries,
abort handling, and awaited shared-device disposal remain in the controller.
The legacy tunnel is only used by its existing playground effect.

## Visual evidence

Captured and inspected through Playwright MCP (chrome-devtools MCP was unavailable):

| Surface | Evidence |
| --- | --- |
| Color, monochrome, 140/200 px wordmarks and 24/32/48/80 px symbol | [Brand proof](wordmark-brand-proof.png) |
| Mobile opening, 390 x 844 | [Loading logo and tagline](tagline-loading-mobile.png) |
| Desktop live title, WebGL/CSS fallback | [Wordmark and dotted tagline](tagline-dots-title.png) |
| Menu identity, WebGL/CSS fallback | [Desktop](tagline-dots-menu-desktop.png), [phone](tagline-dots-menu-mobile.png) |
| Isolated TSL accent | [Playground](continuous-light-prototype.png) |

These six images are the committed visual reference set. Draft captures and browser
diagnostics are ignored; earlier capture names in `validation.json` identify local
inspection records, not additional committed files. Game assets remain versioned.

The final dotted-tagline captures used the shared intro/menu DOM and CSS through
the WebGL fallback. The first default-path attempt skipped the intro with
`startup-pipeline-aborted`; the fallback completed without console errors. Earlier
WebGPU handoff, input, resizing, and reduced-motion checks are recorded separately
in `validation.json` and `wordmark-sizing.json`.

No WebGPU validation or TSL compile errors occurred in these scenes. Existing
messages remain: Windows ignores adapter powerPreference, the legacy intro uses
THREE.Clock, and browser autoplay may reject music before a user gesture. None
blocked the opening or menu input. Mobile had no horizontal overflow.

## Performance and limits

The logo was subsequently refined through SVG, DOM and CSS changes. The final
revision passed all 4,318 tests across 395 files, build and boot closure, type
checking, lint at the existing baseline, architecture and import-boundary gates,
theme lifecycle checks, and production artifact checks. The production dependency
audit reported zero vulnerabilities. Eleven isolated viewport layouts and live
intro/menu resizing were checked. No new shader or renderer changes were needed
for the logo refinements. The cold Electron performance capture below preceded
the identity and sizing revision; it is not a new measurement of this logo.

The [cold-profile Electron capture](flow-electron-cold.json) recorded 86.8 ms of
aurora prewarm, cover handoff at 6.68 s, and completion at 9.95 s: **3.28 s for
the handoff with zero measured transition freezes**. Earlier loading had 1.30 s
of visibly frozen time (worst gap 732 ms). Final command results are recorded in
[validation.json](validation.json). This is a capture on one Windows device, not a hardware-wide
performance guarantee. The opening retains the existing initial theme/intro warm-up;
synchronous output/bake work can still cause loading hitches before the handoff.

The regression suite covers analytic scenes without compute, async compilation,
resize, shared-device cleanup, input locking, aborts during fade, wordmark observer
cleanup, and watchdog behavior during loading, player idle, and menu dismissal.

Reproduce with `npm run dev`; use `?introV2=0&noBootWarp=1` for the WebGL/CSS fallback.
A cold Electron capture can be run with:

```powershell
node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs --port=5185 --show=1 --duration=25000 --shots-phase=boot-warp:visible-start --shots-offsets=500,1400,2300,3500 --out=reports/boot-aurora/flow-electron-cold.json
```
