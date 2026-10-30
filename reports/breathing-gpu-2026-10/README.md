# Breathing worlds on an RTX 5080 Laptop GPU: the full baseline (2026-10-30)

The tables behind docs/BREATHING_PERF_PASS_2026-10.md ("Measured on hardware"), made by
`scripts/breathing-gpu-bench.mjs` and read with `scripts/lib/breathing-bench-summary.mjs`.

One machine: an RTX 5080 Laptop GPU (driver 573.24, Dawn on D3D12), Electron 44.9.3 (Chromium 152),
Lenovo Balanced mode (95 W GPU limit). **Uncapped** (vsync and the frame-rate limit off), so the GPU
works at its power limit and a steady clock: work at a steady clock, not a player's frame cost at the
display's rate (the record explains why). Each cell is GPU ms per frame from every frame of every
resolved timestamp batch over a 1.5 s window (hundreds of frames), the closest of two or three repeats
that agree (p50 within 5 % or two 65.536 µs steps, p95 within 10 % or two steps, same draws and buffer).
Content pinned: clock 12 s, the first mood, visit seed 0.5; empty lungs breath 0 in the empty hold,
mid 0.5 on the in-breath, full 1 in the full hold.

#### The laptop's panel: 2560 × 1600 at a scale of 1.5 (1706 × 1066 CSS pixels)

Drawing buffers: Extreme 2400x1499 · Ultra 2191x1369 · High 1959x1224 · Medium 1549x968 · Low 1200x749 · Minimal 894x558.
216 of 216 readings have agreeing repeats; 0 void.

GPU ms per frame, p50 / p95, mid lungs (heaviest at High first):

| World | Extreme | Ultra | High | Medium | Low | Minimal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 5.01 / 5.34 | 4.03 / 4.26 | 3.15 / 3.38 | 1.97 / 2.10 | 1.11 / 1.28 | 0.59 / 0.62 |
| Cosmic Nebula | 3.67 / 3.87 | 2.92 / 3.11 | 2.36 / 2.49 | 1.44 / 1.61 | 0.75 / 0.88 | 0.39 / 0.46 |
| Zen Garden | 3.18 / 3.54 | 2.52 / 2.79 | 2.13 / 2.36 | 1.38 / 1.54 | 0.85 / 0.95 | 0.52 / 0.66 |
| Crystal Prism | 2.92 / 3.15 | 2.36 / 2.52 | 1.90 / 2.06 | 1.11 / 1.25 | 0.52 / 0.69 | 0.33 / 0.36 |
| Ocean Tide | 2.56 / 2.72 | 2.10 / 2.29 | 1.67 / 1.80 | 0.98 / 1.18 | 0.49 / 0.59 | 0.26 / 0.33 |
| Sacred Geometry | 2.52 / 2.75 | 1.97 / 2.23 | 1.57 / 1.74 | 0.92 / 1.05 | 0.46 / 0.59 | 0.26 / 0.33 |
| Aurora Dreams | 2.42 / 2.69 | 1.97 / 2.16 | 1.57 / 1.74 | 0.92 / 1.08 | 0.39 / 0.52 | 0.26 / 0.33 |
| Solar Flare | 1.93 / 2.13 | 1.57 / 1.74 | 1.25 / 1.41 | 0.69 / 0.85 | 0.39 / 0.52 | 0.20 / 0.23 |
| Heart Glow | 1.90 / 2.10 | 1.54 / 1.74 | 1.21 / 1.34 | 0.72 / 0.82 | 0.33 / 0.46 | 0.20 / 0.26 |
| Volcanic Fire | 1.84 / 2.03 | 1.51 / 1.67 | 1.18 / 1.34 | 0.72 / 0.85 | 0.39 / 0.46 | 0.20 / 0.26 |
| Moonlit Waters | 1.61 / 1.80 | 1.25 / 1.38 | 0.98 / 1.15 | 0.59 / 0.72 | 0.33 / 0.43 | 0.16 / 0.23 |
| Electric Storm | 1.57 / 1.77 | 1.18 / 1.31 | 0.88 / 1.02 | 0.46 / 0.56 | 0.20 / 0.36 | 0.13 / 0.13 |

GPU ms p50, empty · mid · full lungs:

| World | Extreme | Ultra | High | Medium | Low | Minimal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 5.01 · 5.01 · 4.95 | 4.03 · 4.03 · 4.00 | 3.11 · 3.15 · 3.15 | 1.97 · 1.97 · 1.93 | 1.15 · 1.11 · 1.11 | 0.59 · 0.59 · 0.56 |
| Cosmic Nebula | 3.54 · 3.67 · 3.57 | 2.92 · 2.92 · 2.92 | 2.26 · 2.36 · 2.36 | 1.51 · 1.44 · 1.44 | 0.79 · 0.75 · 0.75 | 0.43 · 0.39 · 0.39 |
| Zen Garden | 3.15 · 3.18 · 3.18 | 2.42 · 2.52 · 2.62 | 2.16 · 2.13 · 2.16 | 1.34 · 1.38 · 1.38 | 0.85 · 0.85 · 0.85 | 0.52 · 0.52 · 0.52 |
| Crystal Prism | 2.65 · 2.92 · 2.92 | 2.16 · 2.36 · 2.39 | 1.74 · 1.90 · 1.87 | 1.02 · 1.11 · 1.05 | 0.49 · 0.52 · 0.52 | 0.26 · 0.33 · 0.33 |
| Ocean Tide | 2.49 · 2.56 · 2.82 | 2.10 · 2.10 · 2.29 | 1.67 · 1.67 · 1.87 | 1.02 · 0.98 · 1.11 | 0.49 · 0.49 · 0.52 | 0.26 · 0.26 · 0.33 |
| Sacred Geometry | 2.49 · 2.52 · 2.56 | 1.93 · 1.97 · 2.00 | 1.57 · 1.57 · 1.57 | 0.92 · 0.92 · 0.92 | 0.46 · 0.46 · 0.46 | 0.26 · 0.26 · 0.26 |
| Aurora Dreams | 2.42 · 2.42 · 2.42 | 1.97 · 1.97 · 1.93 | 1.54 · 1.57 · 1.57 | 0.95 · 0.92 · 0.95 | 0.39 · 0.39 · 0.46 | 0.26 · 0.26 · 0.26 |
| Solar Flare | 1.93 · 1.93 · 1.93 | 1.54 · 1.57 · 1.54 | 1.21 · 1.25 · 1.25 | 0.66 · 0.69 · 0.69 | 0.39 · 0.39 · 0.39 | 0.20 · 0.20 · 0.20 |
| Heart Glow | 1.90 · 1.90 · 1.87 | 1.51 · 1.54 · 1.51 | 1.21 · 1.21 · 1.18 | 0.66 · 0.72 · 0.66 | 0.33 · 0.33 · 0.33 | 0.20 · 0.20 · 0.20 |
| Volcanic Fire | 1.70 · 1.84 · 1.97 | 1.38 · 1.51 · 1.57 | 1.11 · 1.18 · 1.25 | 0.66 · 0.72 · 0.75 | 0.33 · 0.39 · 0.39 | 0.20 · 0.20 · 0.23 |
| Moonlit Waters | 1.51 · 1.61 · 1.57 | 1.18 · 1.25 · 1.25 | 0.95 · 0.98 · 0.98 | 0.52 · 0.59 · 0.59 | 0.33 · 0.33 · 0.33 | 0.16 · 0.16 · 0.20 |
| Electric Storm | 1.47 · 1.57 · 1.77 | 1.11 · 1.18 · 1.31 | 0.85 · 0.88 · 1.02 | 0.46 · 0.46 · 0.49 | 0.20 · 0.20 · 0.26 | 0.10 · 0.13 · 0.13 |

Where the frame goes, mid lungs, Extreme and High (mean GPU ms per pass):

| World | Tier | Scene | Bloom | Shafts | Output | Draws |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | Extreme | 4.53 | 0.14 | 0.28 | 0.07 | 18 |
| Ancient Forest | High | 2.87 | 0.11 | 0.15 | 0.05 | 18 |
| Cosmic Nebula | Extreme | 3.42 | 0.15 | — | 0.08 | 19 |
| Cosmic Nebula | High | 2.18 | 0.11 | — | 0.05 | 19 |
| Zen Garden | Extreme | 2.99 | 0.13 | — | 0.07 | 16 |
| Zen Garden | High | 2.01 | 0.09 | — | 0.05 | 16 |
| Crystal Prism | Extreme | 2.41 | 0.15 | 0.28 | 0.07 | 24 |
| Crystal Prism | High | 1.57 | 0.12 | 0.15 | 0.05 | 24 |
| Ocean Tide | Extreme | 2.33 | 0.14 | — | 0.08 | 14 |
| Ocean Tide | High | 1.51 | 0.11 | — | 0.05 | 14 |
| Sacred Geometry | Extreme | 2.03 | 0.14 | 0.28 | 0.07 | 50 |
| Sacred Geometry | High | 1.26 | 0.12 | 0.15 | 0.05 | 50 |
| Aurora Dreams | Extreme | 2.22 | 0.15 | — | 0.07 | 15 |
| Aurora Dreams | High | 1.40 | 0.11 | — | 0.05 | 15 |
| Solar Flare | Extreme | 1.41 | 0.15 | 0.29 | 0.08 | 16 |
| Solar Flare | High | 0.92 | 0.12 | 0.15 | 0.05 | 16 |
| Heart Glow | Extreme | 1.39 | 0.15 | 0.29 | 0.08 | 32 |
| Heart Glow | High | 0.89 | 0.12 | 0.15 | 0.05 | 32 |
| Volcanic Fire | Extreme | 1.63 | 0.14 | — | 0.07 | 18 |
| Volcanic Fire | High | 1.06 | 0.11 | — | 0.05 | 18 |
| Moonlit Waters | Extreme | 1.39 | 0.15 | — | 0.07 | 14 |
| Moonlit Waters | High | 0.84 | 0.11 | — | 0.05 | 14 |
| Electric Storm | Extreme | 1.08 | 0.15 | 0.27 | 0.07 | 18 |
| Electric Storm | High | 0.59 | 0.11 | 0.14 | 0.05 | 18 |

#### 1920 × 1080 at a scale of 1

Drawing buffers: Extreme 1920x1080 · Ultra 1920x1080 · High 1920x1080 · Medium 1632x918 · Low 1264x711 · Minimal 942x530.
216 of 216 readings have agreeing repeats; 0 void.

GPU ms per frame, p50 / p95, mid lungs (heaviest at High first):

| World | Extreme | Ultra | High | Medium | Low | Minimal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 2.92 / 3.11 | 2.75 / 2.95 | 2.79 / 2.98 | 1.97 / 2.10 | 1.15 / 1.28 | 0.56 / 0.62 |
| Cosmic Nebula | 2.13 / 2.26 | 2.03 / 2.20 | 2.03 / 2.23 | 1.44 / 1.57 | 0.72 / 0.85 | 0.39 / 0.46 |
| Zen Garden | 1.97 / 2.13 | 1.84 / 2.00 | 1.84 / 2.06 | 1.31 / 1.44 | 0.82 / 0.92 | 0.52 / 0.59 |
| Crystal Prism | 1.67 / 1.87 | 1.61 / 1.77 | 1.61 / 1.74 | 1.08 / 1.25 | 0.56 / 0.69 | 0.33 / 0.39 |
| Ocean Tide | 1.47 / 1.67 | 1.44 / 1.57 | 1.44 / 1.57 | 1.02 / 1.11 | 0.49 / 0.59 | 0.26 / 0.33 |
| Sacred Geometry | 1.47 / 1.64 | 1.38 / 1.54 | 1.34 / 1.51 | 0.92 / 1.05 | 0.46 / 0.59 | 0.26 / 0.33 |
| Aurora Dreams | 1.34 / 1.54 | 1.34 / 1.51 | 1.31 / 1.51 | 0.95 / 1.08 | 0.39 / 0.52 | 0.26 / 0.26 |
| Solar Flare | 1.11 / 1.25 | 1.05 / 1.18 | 1.05 / 1.21 | 0.66 / 0.79 | 0.36 / 0.46 | 0.16 / 0.23 |
| Heart Glow | 1.08 / 1.25 | 1.05 / 1.18 | 1.02 / 1.18 | 0.66 / 0.79 | 0.33 / 0.46 | 0.20 / 0.26 |
| Volcanic Fire | 1.08 / 1.21 | 1.02 / 1.18 | 1.02 / 1.15 | 0.69 / 0.82 | 0.33 / 0.46 | 0.20 / 0.26 |
| Moonlit Waters | 0.95 / 1.05 | 0.88 / 0.98 | 0.85 / 0.98 | 0.59 / 0.72 | 0.33 / 0.43 | 0.20 / 0.26 |
| Electric Storm | 0.88 / 1.02 | 0.79 / 0.92 | 0.72 / 0.85 | 0.39 / 0.56 | 0.20 / 0.33 | 0.10 / 0.13 |

GPU ms p50, empty · mid · full lungs:

| World | Extreme | Ultra | High | Medium | Low | Minimal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 2.88 · 2.92 · 2.95 | 2.75 · 2.75 · 2.75 | 2.72 · 2.79 · 2.79 | 1.97 · 1.97 · 1.93 | 1.15 · 1.15 · 1.15 | 0.56 · 0.56 · 0.49 |
| Cosmic Nebula | 2.10 · 2.13 · 2.13 | 2.03 · 2.03 · 2.00 | 2.03 · 2.03 · 2.00 | 1.44 · 1.44 · 1.44 | 0.72 · 0.72 · 0.75 | 0.43 · 0.39 · 0.39 |
| Zen Garden | 1.97 · 1.97 · 1.93 | 1.84 · 1.84 · 1.84 | 1.87 · 1.84 · 1.84 | 1.28 · 1.31 · 1.31 | 0.79 · 0.82 · 0.82 | 0.49 · 0.52 · 0.52 |
| Crystal Prism | 1.54 · 1.67 · 1.67 | 1.47 · 1.61 · 1.61 | 1.47 · 1.61 · 1.61 | 0.98 · 1.08 · 1.08 | 0.46 · 0.56 · 0.56 | 0.26 · 0.33 · 0.33 |
| Ocean Tide | 1.54 · 1.47 · 1.67 | 1.44 · 1.44 · 1.64 | 1.47 · 1.44 · 1.64 | 0.98 · 1.02 · 1.15 | 0.52 · 0.49 · 0.52 | 0.26 · 0.26 · 0.29 |
| Sacred Geometry | 1.47 · 1.47 · 1.47 | 1.41 · 1.38 · 1.41 | 1.38 · 1.34 · 1.34 | 0.92 · 0.92 · 0.92 | 0.46 · 0.46 · 0.46 | 0.26 · 0.26 · 0.26 |
| Aurora Dreams | 1.34 · 1.34 · 1.38 | 1.34 · 1.34 · 1.34 | 1.31 · 1.31 · 1.31 | 0.92 · 0.95 · 0.92 | 0.39 · 0.39 · 0.39 | 0.26 · 0.26 · 0.26 |
| Solar Flare | 1.11 · 1.11 · 1.11 | 1.05 · 1.05 · 1.05 | 1.05 · 1.05 · 1.02 | 0.66 · 0.66 · 0.69 | 0.36 · 0.36 · 0.39 | 0.20 · 0.16 · 0.16 |
| Heart Glow | 1.08 · 1.08 · 1.05 | 1.05 · 1.05 · 1.05 | 1.02 · 1.02 · 1.02 | 0.66 · 0.66 · 0.66 | 0.33 · 0.33 · 0.33 | 0.20 · 0.20 · 0.20 |
| Volcanic Fire | 1.02 · 1.08 · 1.15 | 0.98 · 1.02 · 1.05 | 0.92 · 1.02 · 1.05 | 0.66 · 0.69 · 0.72 | 0.33 · 0.33 · 0.39 | 0.20 · 0.20 · 0.20 |
| Moonlit Waters | 0.88 · 0.95 · 0.92 | 0.82 · 0.88 · 0.88 | 0.82 · 0.85 · 0.85 | 0.52 · 0.59 · 0.59 | 0.33 · 0.33 · 0.33 | 0.16 · 0.20 · 0.20 |
| Electric Storm | 0.82 · 0.88 · 0.95 | 0.72 · 0.79 · 0.88 | 0.69 · 0.72 · 0.85 | 0.43 · 0.39 · 0.46 | 0.20 · 0.20 · 0.26 | 0.07 · 0.10 · 0.13 |

Where the frame goes, mid lungs, Extreme and High (mean GPU ms per pass):

| World | Tier | Scene | Bloom | Shafts | Output | Draws |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | Extreme | 2.62 | 0.10 | 0.16 | 0.04 | 18 |
| Ancient Forest | High | 2.52 | 0.10 | 0.13 | 0.04 | 18 |
| Cosmic Nebula | Extreme | 1.97 | 0.10 | — | 0.04 | 19 |
| Cosmic Nebula | High | 1.89 | 0.10 | — | 0.04 | 19 |
| Zen Garden | Extreme | 1.83 | 0.09 | — | 0.04 | 16 |
| Zen Garden | High | 1.73 | 0.09 | — | 0.04 | 16 |
| Crystal Prism | Extreme | 1.38 | 0.11 | 0.15 | 0.04 | 24 |
| Crystal Prism | High | 1.34 | 0.10 | 0.12 | 0.05 | 24 |
| Ocean Tide | Extreme | 1.36 | 0.11 | — | 0.04 | 14 |
| Ocean Tide | High | 1.31 | 0.10 | — | 0.04 | 14 |
| Sacred Geometry | Extreme | 1.17 | 0.10 | 0.15 | 0.04 | 50 |
| Sacred Geometry | High | 1.08 | 0.11 | 0.13 | 0.04 | 50 |
| Aurora Dreams | Extreme | 1.24 | 0.10 | — | 0.04 | 15 |
| Aurora Dreams | High | 1.19 | 0.10 | — | 0.04 | 15 |
| Solar Flare | Extreme | 0.81 | 0.11 | 0.15 | 0.04 | 16 |
| Solar Flare | High | 0.78 | 0.10 | 0.13 | 0.04 | 16 |
| Heart Glow | Extreme | 0.79 | 0.11 | 0.15 | 0.04 | 32 |
| Heart Glow | High | 0.76 | 0.10 | 0.13 | 0.04 | 32 |
| Volcanic Fire | Extreme | 0.93 | 0.10 | — | 0.04 | 18 |
| Volcanic Fire | High | 0.88 | 0.10 | — | 0.04 | 18 |
| Moonlit Waters | Extreme | 0.79 | 0.10 | — | 0.04 | 14 |
| Moonlit Waters | High | 0.71 | 0.10 | — | 0.04 | 14 |
| Electric Storm | Extreme | 0.59 | 0.10 | 0.13 | 0.04 | 18 |
| Electric Storm | High | 0.49 | 0.10 | 0.12 | 0.04 | 18 |
