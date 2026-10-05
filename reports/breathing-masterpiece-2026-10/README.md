# Breathing worlds, masterpiece pass — capture evidence (2026-10-05)

Captures for [docs/BREATHING_WORLDS_MASTERPIECE_2026-10.md](../../docs/BREATHING_WORLDS_MASTERPIECE_2026-10.md).
All were taken in headless Chromium on SwiftShader (no GPU in the cloud container): WebGPU on
SwiftShader's Vulkan adapter, the WebGL2 backend on ANGLE's SwiftShader. Pixels match the hardware
path; nothing here is a timing (ADR-0016). The "before" of this pass is
[reports/breathing-overhaul-2026-10/breathing-pairs.jpg](../breathing-overhaul-2026-10/breathing-pairs.jpg).

## The twelve worlds (playground, `?effect=breathing`)

| File | What it shows | Backend / tier |
| --- | --- | --- |
| [breathing-pairs.jpg](breathing-pairs.jpg) | Every world with empty lungs and with full lungs, 1280×720 | WebGPU, High |
| [breathing-portrait.jpg](breathing-portrait.jpg) | Every world at 390×844, focus 0.24 — what a phone gets | WebGPU, Low (light post pipeline) |
| [breathing-webgl.jpg](breathing-webgl.jpg) | Every world at 70 % breath, `forceWebGL=1` | WebGL2, Medium |
| [breathing-motion.jpg](breathing-motion.jpg) | Aurora Dreams, Heart Glow and Zen Garden across one real breath cycle (8 frames each, their own rhythms) | WebGPU, High |

Scene time is pinned to 12 s. Every run reported no console errors, warnings or validation
messages. Reproduce with `scripts/capture-breathing-headless.mjs` (`--sheet=pairs,portrait,webgl`,
`--sheet=motion --worlds=…`).

## The real game

Driven by `scripts/capture-breathing-ingame.mjs`: boot `index.html?skipIntro=1`, enter Serenity
Mode through the menu, open the shipping guide on each world (later worlds arrive through the
guide's own world change).

| File | Step |
| --- | --- |
| [game-forest-1280x800.jpg](game-forest-1280x800.jpg) | Ancient Forest in the guide, High tier, light shafts on |
| [game-zen-garden-1440x900.jpg](game-zen-garden-1440x900.jpg) | Zen Garden in the guide |
| [game-moonlit-after-switch-1440x900.jpg](game-moonlit-after-switch-1440x900.jpg) | Moonlit Waters reached by switching from Zen Garden — before the stage's settle cap was raised it arrived black (see the record) |
| [game-heart-glow-1440x900.jpg](game-heart-glow-1440x900.jpg) | Heart Glow in the guide |
| [game-solar-flare-1440x900.jpg](game-solar-flare-1440x900.jpg) | Solar Flare in the guide |
| [phone-cosmic-nebula-390x844.jpg](phone-cosmic-nebula-390x844.jpg) | Cosmic Nebula at phone size: the guide picks the Low tier, post pipeline on |
| [phone-heart-glow-390x844.jpg](phone-heart-glow-390x844.jpg) | Heart Glow at phone size, Low tier, shafts on |

Stage diagnostics read back during those runs: WebGPU backend; High tier on desktop and Low on the
phone viewport, both with the post pipeline; 14–31 draw calls per world. The only console message
was the game's own background-theme prewarm timing out under software rendering (unrelated to
breathing).

## Limits

These show that the artwork renders, composes, follows the breath and survives the real guide on
both backends and at phone size. They are not frame-time measurements: integrated-GPU and phone
frame cost, and shader compile time on D3D12 and mobile drivers, remain unmeasured.
