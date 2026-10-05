# Neon District rendering verification

[verification-summary.json](verification-summary.json) records the completed checks
for the overhaul source. All six software-browser profiles passed all four phases:
ambient, piece-lock, four-line clear and combo.

| Profile | Quality | Native WebGPU | Forced WebGL2 |
| --- | --- | --- | --- |
| Desktop, 1280×720 | High | Pass | Pass |
| Portrait, 390×844 | Low | Pass | Pass |
| Landscape, 844×390 | Low | Pass | Pass |

The captures were visually inspected, with no graphics failures or non-finite
sampled geometry/transform values. High effects remain within six pooled slots
and 384 data particles; Low uses three slots and 64 particles.

To generate raw screenshots and detailed console/geometry reports, install
Playwright or provide `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH`, then run:

```sh
node scripts/neon-district-visual-validation.mjs --lane both --offscreen \
  --out reports/neon-district-overhaul/final
```

Raw capture files are generated locally. Native WebGPU uses target/readback in
the software renderer. Physical-device frame rates, native canvas presentation
and full game boot were not measured.
