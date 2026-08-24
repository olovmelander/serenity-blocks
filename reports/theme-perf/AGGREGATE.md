# Theme perf lane — aggregate

Cells: **61**, admissible **59**, inadmissible **2** (kept and marked, never dropped).

Adapter(s) observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Ranked — worst single pipeline compile first (the lava-lake signature)

| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first frame GPU ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|
| 1 | stillwater | WebGPURenderer | 2230 | 43 | 3585 | 5504 | 8.20 | 3.90 | 0.786 | 131 | 0.60 | ✓ |
| 2 | neon-district | WebGPURenderer | 1688 | 180 | 1103 | 1713 | 15.80 | 23.30 | 1.245 | 1856 | 0.90 | ✓ |
| 3 | vesper-chrysalis | WebGPURenderer | 1262 | 62 | 2253 | 3025 | 15.90 | 5.90 | 1.114 | 257 | 0.60 | ✓ |
| 4 | golden-forest | WebGPURenderer | 959 | 106 | 4018 | 4553 | 8.20 | 14.30 | 1.507 | 1101 | 0.60 | ✓ |
| 5 | koi-pond | WebGPURenderer | 600 | 41 | 6142 | 7169 | 8.20 | 4.10 | 0.721 | 128 | 0.40 | ✓ |
| 6 | ice-temple | WebGPURenderer | 583 | 28 | 2093 | 3220 | 8.10 | 6.60 | 0.393 | 341 | 0.50 | ✓ |
| 7 | wolfhour | WebGPURenderer | 537 | 18 | 549 | 1079 | 8.20 | 3.80 | 0.786 | 95 | 0.40 | ✓ |
| 8 | ocean | WebGPURenderer | 408 | 76 | 2102 | 4500 | 8.30 | 4.80 | 1.245 | 393 | 0.60 | ✓ |
| 9 | stellar-drift | WebGPURenderer | 275 | 23 | 1719 | 2004 | 8.30 | 4.30 | 1.901 | 164 | 0.50 | ✓ |
| 10 | moonlit-forest | WebGPURenderer | 207 | 9 | 2269 | 2315 | 8.20 | 0.70 | 1.573 | 32 | 0.70 | ✓ |
| 11 | chromadelic-highway | WebGPURenderer | 136 | 27 | 1225 | 1344 | 15.90 | 5.20 | 0.393 | 257 | 1.10 | ✓ |
| 12 | cosmic-noir | WebGPURenderer | 123 | 18 | 920 | 1183 | 8.20 | 3.50 | 1.180 | 89 | 1.00 | ✓ |
| 13 | stellar-velocity | WebGPURenderer | 97 | 23 | 762 | 900 | 8.20 | 5.20 | — | 201 | 1.90 | ✗ |
| 14 | chiral-gold | WebGPURenderer | 63 | 17 | 693 | 1067 | 15.90 | 3.30 | 0.459 | 85 | 1.50 | ✓ |
| 15 | pyrestorm | WebGLRenderer | 0 | 0 | 2128 | 2144 | 8.10 | 1.10 | — | 55 | 1.40 | ✓ |
| 16 | moonrise-summit | WebGLRenderer | 0 | 0 | 1626 | 1634 | 8.20 | 1.00 | — | 34 | 1.00 | ✓ |
| 17 | blood-moon | WebGLRenderer | 0 | 0 | 1545 | 1593 | 8.20 | 0.90 | — | 44 | 1.30 | ✓ |
| 18 | crystal-cave | WebGLRenderer | 0 | 0 | 1005 | 1031 | 8.20 | 5.40 | — | 533 | 1.90 | ✓ |
| 19 | lunara | WebGPURenderer | 0 | 73 | 979 | 6173 | 8.30 | 4.70 | 1.769 | 224 | 0.50 | ✓ |
| 20 | sakura-twilight | WebGLRenderer | 0 | 0 | 960 | 968 | 8.20 | 0.50 | — | 22 | 1.10 | ✓ |
| 21 | rainy-window | WebGLRenderer | 0 | 0 | 780 | 806 | 8.20 | 0.80 | — | 16 | 2.20 | ✓ |
| 22 | halcyon-apex | WebGPURenderer | 0 | 62 | 752 | 2451 | 8.20 | 4.30 | 0.852 | 461 | 0.30 | ✓ |
| 23 | sky-children | WebGPURenderer | 0 | 34 | 603 | 2559 | 8.20 | 4.30 | 1.049 | 212 | 0.60 | ✓ |
| 24 | neon-dusk | WebGPURenderer | 0 | 28 | 574 | 1402 | 8.20 | 3.50 | 0.852 | 167 | 1.10 | ✗ |
| 25 | geode | WebGLRenderer | 0 | 0 | 571 | 586 | 8.20 | 2.90 | — | 201 | 2.60 | ✓ |
| 26 | cinder-drift | WebGLRenderer | 0 | 0 | 566 | 574 | 8.20 | 0.20 | — | 11 | 1.20 | ✓ |
| 27 | sunset | WebGLRenderer | 0 | 0 | 520 | 554 | 8.20 | 1.00 | — | 30 | 1.20 | ✓ |
| 28 | bioluminescence-2 | WebGPURenderer | 0 | 174 | 496 | 3628 | 8.20 | 4.90 | 1.180 | 501 | 0.60 | ✓ |
| 29 | summer | WebGPURenderer | 0 | 121 | 421 | 3543 | 8.30 | 3.00 | 2.425 | 278 | 0.40 | ✓ |
| 30 | fluid-dreams | WebGPURenderer | 0 | 14 | 409 | 3807 | 8.20 | 3.00 | 1.442 | 61 | 1.10 | ✓ |
| 31 | singing-bowl | WebGLRenderer | 0 | 0 | 400 | 411 | 8.30 | 1.10 | — | 46 | 1.20 | ✓ |
| 32 | winter | WebGPURenderer | 0 | 26 | 399 | 590 | 8.20 | 3.60 | 2.097 | 95 | 0.80 | ✓ |
| 33 | starlight | WebGPURenderer | 0 | 14 | 379 | 3180 | 8.20 | 2.00 | 2.359 | 37 | 0.70 | ✓ |
| 34 | synthwave-sunset | WebGPURenderer | 0 | 23 | 378 | 1095 | 8.30 | 4.50 | 0.655 | 332 | 2.10 | ✓ |
| 35 | nimbus-veil | WebGLRenderer | 0 | 0 | 372 | 381 | 8.20 | 0.80 | — | 32 | 1.40 | ✓ |
| 36 | black-hole | WebGPURenderer | 0 | 21 | 357 | 1446 | 15.90 | 2.90 | 0.459 | 71 | 1.40 | ✓ |
| 37 | himalayan-peak | WebGPURenderer | 0 | 14 | 351 | 939 | 8.20 | 3.30 | 1.376 | 59 | 0.70 | ✓ |
| 38 | electric-dreams-v3 | WebGPURenderer | 0 | 11 | 341 | 1121 | 8.20 | 1.90 | 1.966 | 31 | 1.30 | ✓ |
| 39 | fall | WebGLRenderer | 0 | 0 | 317 | 716 | 8.20 | 0.80 | — | 23 | 1.10 | ✓ |
| 40 | serenity-warp | WebGPURenderer | 0 | 46 | 314 | 779 | 8.30 | 2.50 | 2.163 | 71 | 0.40 | ✓ |
| 41 | galaxy | WebGLRenderer | 0 | 0 | 306 | 313 | 8.30 | 0.20 | — | 12 | 1.20 | ✓ |
| 42 | astral-weave | WebGPURenderer | 0 | 27 | 280 | 985 | 8.30 | 5.30 | 1.442 | 362 | 0.40 | ✓ |
| 43 | bioluminescence | WebGLRenderer | 0 | 0 | 279 | 1449 | 8.20 | 5.70 | — | 227 | 0.60 | ✓ |
| 44 | aurora | WebGLRenderer | 0 | 0 | 267 | 274 | 8.20 | 0.20 | — | 13 | 1.20 | ✓ |
| 45 | verdant-hills | WebGPURenderer | 0 | 6 | 263 | 343 | 8.30 | 1.00 | 1.114 | 101 | 1.10 | ✓ |
| 46 | shifting-sands | WebGPURenderer | 0 | 18 | 259 | 404 | 8.10 | 3.10 | 1.245 | 83 | 1.00 | ✓ |
| 47 | aether-tides | — | 0 | 0 | 241 | 241 | 8.20 | — | — | — | 1.20 | ✓ |
| 48 | void-ember | — | 0 | 7 | 223 | 223 | 8.20 | — | — | — | 1.30 | ✓ |
| 49 | chromatic-impasto | — | 0 | 0 | 219 | 220 | 8.20 | — | — | — | 1.10 | ✓ |
| 50 | nebula-flow | — | 0 | 0 | 213 | 213 | 8.20 | — | — | — | 1.30 | ✓ |
| 51 | voltage-storm | — | 0 | 0 | 212 | 212 | 8.20 | — | — | — | 1.10 | ✓ |
| 52 | supernova | WebGLRenderer | 0 | 0 | 206 | 261 | 8.30 | 0.20 | — | 4 | 1.20 | ✓ |
| 53 | tornado | WebGPURenderer | 0 | 11 | 164 | 235 | 8.20 | 3.00 | 2.163 | 47 | 1.80 | ✓ |
| 54 | misty-lake | WebGLRenderer | 0 | 0 | 98 | 1529 | 8.20 | 1.20 | — | 68 | 1.20 | ✓ |
| 55 | moonlit-greenhouse | — | 0 | 0 | 94 | 94 | 8.80 | — | — | — | 1.50 | ✓ |
| 56 | solar-eclipse | WebGLRenderer | 0 | 0 | 86 | 755 | 8.20 | 1.90 | — | 68 | 3.00 | ✓ |
| 57 | waves | WebGLRenderer | 0 | 0 | 81 | 411 | 8.20 | 0.80 | — | 18 | 1.30 | ✓ |
| 58 | luminous-tides | WebGLRenderer | 0 | 0 | 79 | 503 | 8.20 | 1.20 | — | 29 | 2.10 | ✓ |
| 59 | cosmic-chimes | — | 0 | 0 | 50 | 50 | 8.20 | — | — | — | 1.20 | ✓ |
| 60 | mountain | — | 0 | 0 | 42 | 42 | 8.20 | — | — | — | 1.20 | ✓ |
| 61 | forest | — | 0 | 0 | 24 | 24 | 8.20 | — | — | — | 1.10 | ✓ |

## Inadmissible cells, and why

- **neon-dusk** — pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window
- **stellar-velocity** — no GPU timestamp samples (no-resolved-timestamp-in-window)

## Worst single pipelines across the fleet

| theme | ms | material class | label |
|---|---:|---|---|
| stillwater | 2230 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| neon-district | 1688 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| vesper-chrysalis | 1262 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_44` |
| stillwater | 1184 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_24` |
| stillwater | 1159 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_19` |
| vesper-chrysalis | 1059 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_46` |
| golden-forest | 959 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| neon-district | 753 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_300` |
| stillwater | 665 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| stillwater | 647 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_21` |
| stillwater | 647 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_22` |
| vesper-chrysalis | 634 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 600 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| ice-temple | 583 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_28` |
| vesper-chrysalis | 569 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_49` |
| vesper-chrysalis | 544 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_51` |
| vesper-chrysalis | 541 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| wolfhour | 537 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| stillwater | 495 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |
| stillwater | 495 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_26` |
| stillwater | 464 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_33` |
| stillwater | 464 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_29` |
| stillwater | 462 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |
| stillwater | 446 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_58` |
| stillwater | 438 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |

## Sync pipeline creations (post-reveal stall candidates)

These carry `ms: null` by construction — the call returns before the GPU compiles.

| theme | sync count | first at ms | labels (first 5) |
|---|---:|---:|---|
| neon-district | 180 | 4584 | `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_23` `renderPipeline_PMREM_ggx_22` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` |
| bioluminescence-2 | 174 | 4500 | `renderPipeline_MeshBasicNodeMaterial_23` `renderPipeline_MeshBasicNodeMaterial_139` `renderPipeline_MeshBasicNodeMaterial_106` `renderPipeline_MeshBasicNodeMaterial_105` `renderPipeline_MeshBasicNodeMaterial_16` |
| summer | 121 | 4833 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| golden-forest | 106 | 5649 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicMaterial_47` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_ShadowMaterial_115` |
| ocean | 76 | 4811 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_41` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` |
| lunara | 73 | 4706 | `renderPipeline_PMREM.Background_21` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PMREM_blur_19` `renderPipeline_PMREM_blur_19` |
| halcyon-apex | 62 | 4837 | `mipmap-rgba8unorm-2d-array` `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_32` `renderPipeline_MeshStandardNodeMaterial_17` |
| vesper-chrysalis | 62 | 4721 | `renderPipeline_PMREM.Background_42` `renderPipeline_MeshBasicNodeMaterial_32` `renderPipeline_MeshBasicNodeMaterial_39` `renderPipeline_MeshBasicNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_37` |
| serenity-warp | 46 | 4917 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_48` `renderPipeline_PMREM_ggx_47` |
| stillwater | 43 | 5445 | `renderPipeline_MeshStandardNodeMaterial_58` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 41 | 10347 | `renderPipeline_MeshBasicNodeMaterial_28` `renderPipeline_MeshBasicNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshStandardNodeMaterial_31` `renderPipeline_MeshStandardNodeMaterial_35` |
| sky-children | 34 | 4664 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_outputColorTransform_17` `renderPipeline_MeshBasicMaterial_19` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` |
| ice-temple | 28 | 4795 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_PMREM_equirect_48` `renderPipeline_PMREM_ggx_47` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshPhysicalMaterial_28` |
| neon-dusk | 28 | 4937 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_27` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_25` |
| astral-weave | 27 | 4702 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_68` `renderPipeline_MeshBasicNodeMaterial_68` `renderPipeline_PointsNodeMaterial_54` `renderPipeline_MeshBasicNodeMaterial_59` |
| chromadelic-highway | 27 | 4925 | `mipmap-rgba8unorm-2d-array` `renderPipeline_outputColorTransform_60` `renderPipeline_MeshBasicNodeMaterial_52` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_MeshBasicNodeMaterial_40` |
| winter | 26 | 4731 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_19` |
| stellar-drift | 23 | 4812 | `mipmap-rgba8unorm-srgb-2d-array` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_53` `renderPipeline_MeshStandardNodeMaterial_45` `renderPipeline_MeshBasicNodeMaterial_37` |
| stellar-velocity | 23 | 5303 | `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_SpriteNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_20` |
| synthwave-sunset | 23 | 4782 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_34` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_25` |
| black-hole | 21 | 4578 | `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| cosmic-noir | 18 | 4697 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_PointsNodeMaterial_18` |
| shifting-sands | 18 | 4921 | `renderPipeline_MeshBasicNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicMaterial_25` `mipmap-rgba8unorm-2d-array` `renderPipeline_SpriteMaterial_21` |
| wolfhour | 18 | 4933 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_21` |
| chiral-gold | 17 | 5164 | `renderPipeline_outputColorTransform_28` `renderPipeline_PointsNodeMaterial_20` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_PointsNodeMaterial_18` |
| fluid-dreams | 14 | 4609 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| himalayan-peak | 14 | 4766 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_LineBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_17` |
| starlight | 14 | 4687 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| electric-dreams-v3 | 11 | 4820 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_Bloom_highPass_19` `renderPipeline_Bloom_separable_20` |
| tornado | 11 | 4493 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_18` `renderPipeline_Bloom_highPass_20` `renderPipeline_Bloom_separable_21` |
| moonlit-forest | 9 | 6747 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_39` |
| void-ember | 7 | 4622 | `void-ember/scene-pipeline` `void-ember/particle-pipeline` `void-ember/post-pipeline` `void-ember/present-pipeline` `void-ember/bloom-prefilter-pipeline` |
| verdant-hills | 6 | 4830 | `renderPipeline_MeshLambertNodeMaterial_77` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_181` |

## Drift between the two visits (bounds how much of a delta is noise)

| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |
|---|---:|---:|:--:|---|
| aether-tides | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| astral-weave | <0.065536 | 0.10 | ✓ | — |
| aurora | — | — | ✗ | draw calls unavailable in one visit |
| bioluminescence-2 | 0.066 | 0.10 | ✓ | — |
| bioluminescence | — | — | ✗ | draw calls differ (v1=227, v2=224) |
| black-hole | <0.065536 | 0.10 | ✓ | — |
| blood-moon | — | — | ✗ | draw calls differ (v1=44, v2=28) |
| chiral-gold | 0.066 | 0.20 | ✓ | — |
| chromadelic-highway | <0.065536 | 0.10 | ✓ | — |
| chromatic-impasto | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cinder-drift | — | — | ✗ | draw calls unavailable in one visit |
| cosmic-chimes | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cosmic-noir | <0.065536 | 0.10 | ✓ | — |
| crystal-cave | — | — | ✗ | draw calls differ (v1=533, v2=389) |
| electric-dreams-v3 | 0.066 | 0.00 | ✓ | — |
| fall | — | — | ✗ | draw calls differ (v1=23, v2=7) |
| fluid-dreams | 0.066 | 0.10 | ✓ | — |
| forest | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| galaxy | — | — | ✗ | draw calls unavailable in one visit |
| geode | — | — | ✗ | draw calls differ (v1=201, v2=168) |
| golden-forest | — | — | ✗ | draw calls differ (v1=1101, v2=1171) |
| halcyon-apex | <0.065536 | 0.00 | ✓ | — |
| himalayan-peak | 0.131 | 0.10 | ✓ | — |
| ice-temple | — | — | ✗ | draw calls differ (v1=341, v2=344) |
| koi-pond | <0.065536 | 0.00 | ✓ | — |
| luminous-tides | — | — | ✗ | draw calls differ (v1=29, v2=13) |
| lunara | <0.065536 | 0.10 | ✓ | — |
| misty-lake | — | — | ✗ | draw calls differ (v1=68, v2=52) |
| moonlit-forest | <0.065536 | 0.10 | ✓ | — |
| moonlit-greenhouse | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| moonrise-summit | — | — | ✗ | draw calls differ (v1=34, v2=19) |
| mountain | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| nebula-flow | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| neon-district | — | — | ✗ | draw calls differ (v1=1856, v2=1617) |
| neon-dusk | 0.131 | 0.00 | ✓ | — |
| nimbus-veil | — | — | ✗ | draw calls differ (v1=32, v2=16) |
| ocean | — | — | ✗ | draw calls differ (v1=393, v2=389) |
| pyrestorm | — | — | ✗ | draw calls differ (v1=55, v2=38) |
| rainy-window | — | — | ✗ | draw calls differ (v1=16, v2=5) |
| sakura-twilight | — | — | ✗ | draw calls unavailable in one visit |
| serenity-warp | 0.197 | 0.20 | ✓ | — |
| shifting-sands | <0.065536 | 0.10 | ✓ | — |
| singing-bowl | — | — | ✗ | draw calls differ (v1=46, v2=30) |
| sky-children | <0.065536 | 0.10 | ✓ | — |
| solar-eclipse | — | — | ✗ | draw calls differ (v1=68, v2=51) |
| starlight | <0.065536 | 0.00 | ✓ | — |
| stellar-drift | 0.131 | 0.00 | ✓ | — |
| stellar-velocity | — | 0.00 | ✓ | — |
| stillwater | — | 0.00 | ✓ | — |
| summer | 0.131 | 0.10 | ✓ | — |
| sunset | — | — | ✗ | draw calls differ (v1=30, v2=6) |
| supernova | — | — | ✗ | draw calls unavailable in one visit |
| synthwave-sunset | <0.065536 | 0.10 | ✓ | — |
| tornado | 0.131 | 0.00 | ✓ | — |
| verdant-hills | — | — | ✗ | draw calls differ (v1=101, v2=107) |
| vesper-chrysalis | <0.065536 | 0.10 | ✓ | — |
| void-ember | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| voltage-storm | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| waves | — | — | ✗ | draw calls differ (v1=18, v2=2) |
| winter | 0.131 | 0.10 | ✓ | — |
| wolfhour | <0.065536 | 0.00 | ✓ | — |

---

Notes carried from every cell:

- firstFrameGpuDoneMs is GPU-work completion for the first frame, not scanout. A page cannot observe presentation.
- allQuiescedGpuDoneMs INCLUDES a 2000-2100 ms compile-quiet wait by construction. It is not a latency; use firstFrameGpuDoneMs for that.
- pipelines.asyncSumMs is the sum of per-object awaited compiles (r185 Renderer awaits per object), not a wall-clock.
- pipelines.syncRows always carry ms=null: createRenderPipeline returns at once and the GPU process blocks at first draw.
- gpuMs is null for a classic THREE.WebGLRenderer: that renderer kind has no timestamp API in 0.185.1 (ADR-0019, ADR-0008).
- Two configurations inside 0.065536 ms mean "difference below resolution", never "zero cost" (ADR-0016).
- GPU samples are pushed once per RESOLVED query, never once per frame: Info.reset() does not clear render.timestamp.
