# Theme bench snippets

In-page probes for `scripts/theme-fleet-bench.mjs --eval-file=<snippet> --exit-after-eval=1`. Each one
runs in the real game once the theme under test is up, and its return value lands in the cell's
`phases.evalAfterLoad`. Give long probes a longer `--eval-timeout-ms` (the census takes ~90 s).

| Snippet | What it measures |
|---|---|
| `cost-census.js` | Hides each part of the theme's scene in turn (recursing into groups that cost over 0.12 ms) and measures the frame time it saves, uncapped. `emptySceneMs` is the frame with the whole scene hidden: post chain, clears, board and compositor. |
| `cost-census-storm.js` | The same while locks, clears, combos, T-spins and perfect clears fire every 350 ms, for themes whose cost is in their effects. |
| `pass-profile.js` | GPU ms per render pass per frame from three's timestamp queries, the theme capped at 60 fps so the 2048-query pool is resolved before it fills. Passes are labelled by target name, size, samples and scene/quad. three reuses render-context ids across passes, so they are keyed by label, not id. |

Node tools for `--profile=1` / `--profile-load=1` CPU profiles (`<cell>.storm1.cpuprofile`, `<cell>.load1.cpuprofile`):

- `profile-summary.mjs <file> [topN]`: self time per bucket (three, phaser, theme, app) and the top functions.
- `profile-timeline.mjs <file> [bucketMs] [fromMs] [toMs]`: busy ms per time bucket with the top call chains,
  for finding what a load does tick by tick.

Profile an unminified build (`vite build --minify false`) or the function names are mangled.
