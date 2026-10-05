# Breathing identity and Hale entry validation

All 12 breathing worlds now have distinct foreground structures. The monochrome sheet shows their silhouettes without relying on their palettes. Each world was captured during inhale and exhale at the same scene time; Sacred Geometry also has all four phase traces.

Hale now has a labelled global entry and a Breathing library action. Native phone checks follow the visible button into the catalogue, select **Start Hale Base**, and use the initially visible preparation action without choosing an intention. The default Present Moment countdown starts the guided session.

## Evidence

| File | View |
| --- | --- |
| [desktop-color.jpg](desktop-color.jpg) | All 12 foreground identities in color |
| [desktop-grayscale.jpg](desktop-grayscale.jpg) | All 12 silhouettes in monochrome |
| [portrait-identities.jpg](portrait-identities.jpg) | All 12 worlds at phone quality and aspect ratio |
| [phase-pairs.jpg](phase-pairs.jpg) | Paired inhale/exhale deformation for every world |
| [hale-phone-entry.jpg](hale-phone-entry.jpg) | Visible global Hale button and the opened catalogue |
| [hale-phone-preparation.jpg](hale-phone-preparation.jpg) | Start action visible before optional intentions |
| [hale-phone-countdown-guide.jpg](hale-phone-countdown-guide.jpg) | Native countdown and active guided session |
| [single-paused-guide.jpg](single-paused-guide.jpg) | Guided overlay in active single-player mode with gameplay paused |

The eight JPEGs total 661 KB. Full screenshots remain in the capture workspace; [validation.json](validation.json) preserves capture names, source fingerprints, resource checks, UI bounds, native integration state and image hashes.

## Capture checks

- **64 isolated screenshots pass:** 12 inhale/exhale pairs on desktop and phone, all four Sacred Geometry phases, Moon/Solar ultrawide alignment, reduced-motion phase deformation and actual context-loss fallbacks for ribbons, square and triangle.
- **Rendering work stays bounded:** maximum 3 draw calls, with 3 geometries, 0 textures and 3 programs before and after 26 technique switches. Native ResizeObserver follows portrait, landscape and desktop sizes. Teardown leaves no guide canvas, frame callbacks or session timers.
- **Phone entry passes:** all four Hub labels are visible, the selected Hale tab spans x288–366 inside the 390 px viewport, and the preparation Start button is enabled and visible without an intention selection. The persistent entry does not overlap phase steps or session progress.
- **Pause ownership passes:** active single-player gameplay stays paused during guided breathwork, including pause-toggle and direct-resume attempts. Completion keeps gameplay paused while the Hub is open; the final normal close resumes it.
- **Mode exit passes on final source:** Return to Menu during either a pending countdown or a live session closes the Hub, stops the indicator/session, clears UI and phase timers, cancels audio/preloads and prevents a late completion. No harness action closes the Hub in these checks.

The renderer matrix remains immutable. Later scoped Hub navigation and mode-exit changes have separate final application fingerprints. The final phone route and cancellation checks ran against stable shipping source; desktop pause/completion evidence predates those scoped fixes, with identical Main pause-guard and rendering hashes. The JSON records these boundaries explicitly.

The final native checks report no errors. Two existing `THREE.Clock` deprecation warnings occur when starting the single-player board; they are retained in the report.

These are software-rendered Chrome 153 checks of shader compatibility, composition and resource bounds. They do not measure physical-phone or hardware GPU frame rate. Native checks run the Vite development entry, with session audio muted through its supported API; production build validation is separate.

## Repository checks

The full repository suite passed 5,938 tests in 543 files before the final scoped navigation and mode-exit refinements. The final source passed 135 targeted tests in nine files covering rendering, timing, Hale entry, session presentation, mode transitions and audio lifecycle.

Production build, typecheck, TypeScript and lint ratchets, architecture and theme lifecycle gates, import boundaries, performance budgets, release gates and the IP string gate pass. The Pages artifact gate passes against a fresh isolated production output using the existing Vite pruning hook. Browser evidence above checks the development application separately.

## Reproduce

Set `PLAYWRIGHT_MODULE` to the absolute Playwright `index.mjs` path and `PLAYWRIGHT_EXECUTABLE_PATH` to the Chrome headless executable. The dependencies are provided by the project install; Playwright is an optional capture dependency.

```sh
node scripts/capture-breathing-overhaul.mjs --identity --artworkOnly --sessions 0 --out /tmp/breathing-identity
node scripts/capture-breathing-overhaul.mjs --profile none --gameSmoke --haleEntry --gameMode serenity --cancelCases --out /tmp/hale-entry
node scripts/capture-breathing-overhaul.mjs --profile none --gameSmoke --haleEntry --gameMode single --out /tmp/hale-single
```

The artwork capture temporarily hides common HTML guide elements for comparison. Full native application screenshots retain the product UI. Scene time is pinned to 12 seconds; paired shots use 90% phase progress. The JSON contains the exact shader, renderer, guidance, application and stylesheet hashes for each capture scope.
