# Theme perf lane — aggregate

Cells: **61**, admissible **59**, inadmissible **2** (kept and marked, never dropped).

Adapter(s) observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Ranked — worst single pipeline compile first (the lava-lake signature)

| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first GPU frame ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|
| 1 | ocean | WebGPURenderer | 2577 | 76 | 2200 | 9706 | 8.30 | 5.00 | 1.311 | 393 | 0.60 | ✓ |
| 2 | neon-district | WebGPURenderer | 1591 | 160 | 540 | 8001 | 8.30 | 14.50 | 1.376 | 1192 | 0.70 | ✓ |
| 3 | golden-forest | WebGPURenderer | 940 | 106 | 3960 | 5991 | 8.30 | 10.10 | 1.507 | 782 | 0.60 | ✓ |
| 4 | ice-temple | WebGPURenderer | 576 | 28 | 2092 | 4132 | 8.20 | 4.50 | 0.459 | 227 | 0.50 | ✓ |
| 5 | koi-pond | WebGPURenderer | 545 | 41 | 6032 | 8094 | 8.20 | 2.90 | 0.721 | 85 | 0.50 | ✓ |
| 6 | wolfhour | WebGPURenderer | 540 | 18 | 554 | 3500 | 8.20 | 2.30 | 1.114 | 63 | 0.80 | ✓ |
| 7 | stellar-drift | WebGPURenderer | 270 | 23 | 1725 | 4100 | 8.30 | 2.80 | 1.901 | 109 | 0.40 | ✓ |
| 8 | moonlit-forest | WebGPURenderer | 241 | 9 | 2420 | 4478 | 8.20 | 0.70 | 1.573 | 32 | 0.70 | ✓ |
| 9 | chromadelic-highway | WebGPURenderer | 131 | 27 | 1206 | 3438 | 15.80 | 3.60 | 0.393 | 189 | 1.10 | ✓ |
| 10 | cosmic-noir | WebGPURenderer | 122 | 18 | 941 | 3029 | 8.20 | 2.30 | 0.721 | 59 | 1.00 | ✓ |
| 11 | stellar-velocity | WebGPURenderer | 96 | 23 | 764 | 2965 | 8.20 | 3.50 | — | 147 | 2.00 | ✗ |
| 12 | chiral-gold | WebGPURenderer | 59 | 17 | 649 | 2690 | 16.00 | 2.20 | 0.459 | 60 | 1.60 | ✓ |
| 13 | pyrestorm | WebGLRenderer | 0 | 0 | 2140 | 4216 | 8.20 | 1.10 | — | — | 1.20 | ✓ |
| 14 | moonrise-summit | WebGLRenderer | 0 | 0 | 1629 | 3720 | 8.20 | 0.90 | — | — | 1.00 | ✓ |
| 15 | blood-moon | WebGLRenderer | 0 | 0 | 1570 | 3651 | 8.20 | 0.80 | — | — | 1.30 | ✓ |
| 16 | crystal-cave | WebGLRenderer | 0 | 0 | 972 | 3041 | 8.20 | 4.10 | — | — | 0.40 | ✓ |
| 17 | lunara | WebGPURenderer | 0 | 73 | 966 | 6087 | 8.20 | 3.20 | 1.573 | 149 | 0.50 | ✓ |
| 18 | sakura-twilight | WebGLRenderer | 0 | 0 | 953 | 3036 | 8.20 | 0.50 | — | — | 1.00 | ✓ |
| 19 | rainy-window | WebGLRenderer | 0 | 0 | 786 | 2868 | 8.20 | 0.70 | — | — | 2.10 | ✓ |
| 20 | halcyon-apex | WebGPURenderer | 0 | 62 | 756 | 2811 | 8.20 | 4.50 | 0.852 | 461 | 0.40 | ✓ |
| 21 | vesper-chrysalis | WebGPURenderer | 0 | 103 | 718 | 6478 | 15.90 | 5.80 | 1.049 | 257 | 0.50 | ✓ |
| 22 | stillwater | WebGPURenderer | 0 | 58 | 715 | 10492 | 8.30 | 3.60 | — | 131 | 0.70 | ✗ |
| 23 | sky-children | WebGPURenderer | 0 | 34 | 611 | 4596 | 8.20 | 2.80 | 0.983 | 143 | 0.60 | ✓ |
| 24 | neon-dusk | WebGPURenderer | 0 | 28 | 579 | 2693 | 8.20 | 2.30 | 0.918 | 111 | 1.50 | ✓ |
| 25 | geode | WebGLRenderer | 0 | 0 | 554 | 2562 | 8.20 | 2.80 | — | — | 2.60 | ✓ |
| 26 | cinder-drift | WebGLRenderer | 0 | 0 | 537 | 2631 | 8.20 | 0.20 | — | — | 1.20 | ✓ |
| 27 | sunset | WebGLRenderer | 0 | 0 | 489 | 2574 | 8.20 | 0.90 | — | — | 1.20 | ✓ |
| 28 | bioluminescence-2 | WebGPURenderer | 0 | 174 | 488 | 3939 | 8.30 | 5.00 | 1.245 | 501 | 0.40 | ✓ |
| 29 | summer | WebGPURenderer | 0 | 121 | 451 | 5881 | 8.30 | 2.90 | 2.425 | 278 | 0.40 | ✓ |
| 30 | fluid-dreams | WebGPURenderer | 0 | 14 | 426 | 3986 | 8.20 | 2.10 | 1.442 | 42 | 1.00 | ✓ |
| 31 | singing-bowl | WebGLRenderer | 0 | 0 | 399 | 2492 | 8.20 | 1.00 | — | — | 1.10 | ✓ |
| 32 | winter | WebGPURenderer | 0 | 26 | 393 | 5410 | 8.20 | 2.30 | 2.163 | 63 | 0.80 | ✓ |
| 33 | starlight | WebGPURenderer | 0 | 14 | 378 | 3426 | 8.20 | 1.90 | 2.359 | 37 | 0.90 | ✓ |
| 34 | synthwave-sunset | WebGPURenderer | 0 | 23 | 378 | 2452 | 8.30 | 2.90 | 0.655 | 221 | 2.10 | ✓ |
| 35 | nimbus-veil | WebGLRenderer | 0 | 0 | 358 | 2436 | 8.20 | 0.80 | — | — | 1.60 | ✓ |
| 36 | black-hole | WebGPURenderer | 0 | 21 | 346 | 2496 | 16.00 | 1.90 | 0.328 | 47 | 1.50 | ✓ |
| 37 | electric-dreams-v3 | WebGPURenderer | 0 | 11 | 331 | 2394 | 8.30 | 1.90 | 2.228 | 31 | 1.20 | ✓ |
| 38 | himalayan-peak | WebGPURenderer | 0 | 14 | 326 | 2430 | 8.20 | 2.70 | 1.442 | 39 | 0.70 | ✓ |
| 39 | galaxy | WebGLRenderer | 0 | 0 | 291 | 2384 | 8.20 | 0.20 | — | — | 1.10 | ✓ |
| 40 | fall | WebGLRenderer | 0 | 0 | 290 | 2364 | 8.20 | 0.80 | — | — | 1.20 | ✓ |
| 41 | astral-weave | WebGPURenderer | 0 | 27 | 278 | 3028 | 8.20 | 3.70 | 1.245 | 241 | 0.40 | ✓ |
| 42 | bioluminescence | WebGLRenderer | 0 | 0 | 275 | 2345 | 8.20 | 6.70 | — | — | 1.60 | ✓ |
| 43 | aurora | WebGLRenderer | 0 | 0 | 260 | 2323 | 8.20 | 0.20 | — | — | 1.30 | ✓ |
| 44 | shifting-sands | WebGPURenderer | 0 | 18 | 259 | 2438 | 8.20 | 2.00 | 1.245 | 55 | 1.00 | ✓ |
| 45 | aether-tides | — | 0 | 0 | 242 | 2321 | 8.20 | — | — | — | 1.20 | ✓ |
| 46 | verdant-hills | WebGPURenderer | 0 | 6 | 235 | 2443 | 8.20 | 1.10 | 1.180 | 113 | 1.30 | ✓ |
| 47 | serenity-warp | WebGPURenderer | 0 | 46 | 232 | 3095 | 8.30 | 2.30 | 2.032 | 71 | 0.50 | ✓ |
| 48 | void-ember | — | 0 | 7 | 228 | 2329 | 8.20 | — | — | — | 1.30 | ✓ |
| 49 | chromatic-impasto | — | 0 | 0 | 221 | 2299 | 8.20 | — | — | — | 1.10 | ✓ |
| 50 | voltage-storm | — | 0 | 0 | 210 | 2301 | 8.20 | — | — | — | 1.50 | ✓ |
| 51 | nebula-flow | — | 0 | 0 | 209 | 2289 | 8.20 | — | — | — | 1.20 | ✓ |
| 52 | supernova | WebGLRenderer | 0 | 0 | 195 | 2291 | 8.30 | 0.20 | — | — | 1.30 | ✓ |
| 53 | tornado | WebGPURenderer | 0 | 11 | 166 | 2293 | 8.20 | 2.00 | 2.097 | 31 | 1.80 | ✓ |
| 54 | moonlit-greenhouse | — | 0 | 0 | 93 | 2137 | 8.90 | — | — | — | 1.60 | ✓ |
| 55 | misty-lake | WebGLRenderer | 0 | 0 | 84 | 2153 | 8.20 | 1.40 | — | — | 1.30 | ✓ |
| 56 | solar-eclipse | WebGLRenderer | 0 | 0 | 79 | 2182 | 8.20 | 2.00 | — | — | 3.00 | ✓ |
| 57 | waves | WebGLRenderer | 0 | 0 | 76 | 2092 | 8.20 | 0.70 | — | — | 1.10 | ✓ |
| 58 | luminous-tides | WebGLRenderer | 0 | 0 | 71 | 2165 | 8.30 | 1.20 | — | — | 2.10 | ✓ |
| 59 | mountain | — | 0 | 0 | 60 | 2154 | 8.20 | — | — | — | 1.30 | ✓ |
| 60 | cosmic-chimes | — | 0 | 0 | 54 | 2147 | 8.20 | — | — | — | 1.30 | ✓ |
| 61 | forest | — | 0 | 0 | 15 | 2082 | 8.20 | — | — | — | 1.30 | ✓ |

## Inadmissible cells, and why

- **stellar-velocity** — no GPU timestamp samples (no-resolved-timestamp-in-window)
- **stillwater** — no GPU timestamp samples (no-resolved-timestamp-in-window)

## Worst single pipelines across the fleet

| theme | ms | material class | label |
|---|---:|---|---|
| ocean | 2577 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_33` |
| neon-district | 1591 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_131` |
| golden-forest | 940 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| ice-temple | 576 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_28` |
| koi-pond | 545 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| wolfhour | 540 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| neon-district | 515 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 413 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_28` |
| koi-pond | 347 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_16` |
| koi-pond | 309 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_19` |
| ice-temple | 297 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_29` |
| koi-pond | 292 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_17` |
| stellar-drift | 270 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_37` |
| ice-temple | 266 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_22` |
| moonlit-forest | 241 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_18` |
| koi-pond | 220 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_24` |
| koi-pond | 216 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_34` |
| koi-pond | 213 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_33` |
| koi-pond | 211 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_43` |
| koi-pond | 206 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_38` |
| koi-pond | 205 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_18` |
| koi-pond | 205 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_23` |
| stellar-drift | 195 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_42` |
| koi-pond | 193 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_20` |
| koi-pond | 192 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_31` |

## Sync pipeline creations (post-reveal stall candidates)

These carry `ms: null` by construction — the call returns before the GPU compiles.

| theme | sync count | first at ms | labels (first 5) |
|---|---:|---:|---|
| bioluminescence-2 | 174 | 4697 | `renderPipeline_MeshBasicNodeMaterial_103` `renderPipeline_MeshBasicNodeMaterial_23` `renderPipeline_MeshBasicNodeMaterial_139` `renderPipeline_MeshBasicNodeMaterial_106` `renderPipeline_MeshBasicNodeMaterial_16` |
| neon-district | 160 | 4573 | `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_23` `renderPipeline_PMREM_ggx_22` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` |
| summer | 121 | 4823 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| golden-forest | 106 | 5660 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicMaterial_47` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_ShadowMaterial_115` |
| vesper-chrysalis | 103 | 4633 | `renderPipeline_PMREM.Background_42` `renderPipeline_MeshBasicNodeMaterial_32` `renderPipeline_MeshBasicNodeMaterial_39` `renderPipeline_MeshBasicNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_37` |
| ocean | 76 | 4743 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_41` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` |
| lunara | 73 | 4600 | `renderPipeline_PMREM.Background_21` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PMREM_blur_19` `renderPipeline_PMREM_blur_19` |
| halcyon-apex | 62 | 4913 | `mipmap-rgba8unorm-2d-array` `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_32` `renderPipeline_MeshStandardNodeMaterial_17` |
| stillwater | 58 | 4741 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshStandardNodeMaterial_22` `renderPipeline_MeshStandardNodeMaterial_26` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_30` |
| serenity-warp | 46 | 4674 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_48` `renderPipeline_PMREM_ggx_47` |
| koi-pond | 41 | 10307 | `renderPipeline_MeshBasicNodeMaterial_28` `renderPipeline_MeshBasicNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshStandardNodeMaterial_31` `renderPipeline_MeshStandardNodeMaterial_35` |
| sky-children | 34 | 4676 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_outputColorTransform_17` `renderPipeline_MeshBasicMaterial_19` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` |
| ice-temple | 28 | 4679 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_PMREM_equirect_48` `renderPipeline_PMREM_ggx_47` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshPhysicalMaterial_28` |
| neon-dusk | 28 | 4843 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_27` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_25` |
| astral-weave | 27 | 4803 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_PointsNodeMaterial_54` `renderPipeline_MeshBasicNodeMaterial_56` |
| chromadelic-highway | 27 | 4792 | `mipmap-rgba8unorm-2d-array` `renderPipeline_outputColorTransform_60` `renderPipeline_MeshBasicNodeMaterial_52` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_MeshBasicNodeMaterial_40` |
| winter | 26 | 4826 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_19` |
| stellar-drift | 23 | 5035 | `mipmap-rgba8unorm-srgb-2d-array` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_53` `renderPipeline_MeshStandardNodeMaterial_45` `renderPipeline_MeshBasicNodeMaterial_37` |
| stellar-velocity | 23 | 5295 | `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_SpriteNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_20` |
| synthwave-sunset | 23 | 4564 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_34` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_25` |
| black-hole | 21 | 4620 | `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| cosmic-noir | 18 | 4807 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_PointsNodeMaterial_18` |
| shifting-sands | 18 | 4579 | `renderPipeline_MeshBasicNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicMaterial_25` `mipmap-rgba8unorm-2d-array` `renderPipeline_SpriteMaterial_21` |
| wolfhour | 18 | 4939 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_21` |
| chiral-gold | 17 | 5777 | `renderPipeline_outputColorTransform_28` `renderPipeline_PointsNodeMaterial_20` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_PointsNodeMaterial_18` |
| fluid-dreams | 14 | 4736 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| himalayan-peak | 14 | 4600 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_LineBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_17` |
| starlight | 14 | 4753 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| electric-dreams-v3 | 11 | 4661 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_Bloom_highPass_19` `renderPipeline_Bloom_separable_20` |
| tornado | 11 | 4675 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_18` `renderPipeline_Bloom_highPass_20` `renderPipeline_Bloom_separable_21` |
| moonlit-forest | 9 | 6888 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_39` |
| void-ember | 7 | 4586 | `void-ember/scene-pipeline` `void-ember/particle-pipeline` `void-ember/post-pipeline` `void-ember/present-pipeline` `void-ember/bloom-prefilter-pipeline` |
| verdant-hills | 6 | 4792 | `renderPipeline_MeshLambertNodeMaterial_65` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_169` |

## Drift between the two visits (bounds how much of a delta is noise)

| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |
|---|---:|---:|:--:|---|
| aether-tides | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| astral-weave | <0.065536 | 0.10 | ✓ | — |
| aurora | — | — | ✗ | no draw calls observed — content guard cannot run |
| bioluminescence-2 | 0.131 | 0.20 | ✓ | — |
| bioluminescence | — | — | ✗ | no draw calls observed — content guard cannot run |
| black-hole | <0.065536 | 0.10 | ✓ | — |
| blood-moon | — | — | ✗ | no draw calls observed — content guard cannot run |
| chiral-gold | 0.066 | 0.10 | ✓ | — |
| chromadelic-highway | <0.065536 | 0.10 | ✓ | — |
| chromatic-impasto | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cinder-drift | — | — | ✗ | no draw calls observed — content guard cannot run |
| cosmic-chimes | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cosmic-noir | 0.787 | 18.40 | ✓ | — |
| crystal-cave | — | — | ✗ | no draw calls observed — content guard cannot run |
| electric-dreams-v3 | 0.066 | 0.00 | ✓ | — |
| fall | — | — | ✗ | no draw calls observed — content guard cannot run |
| fluid-dreams | <0.065536 | 0.00 | ✓ | — |
| forest | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| galaxy | — | — | ✗ | no draw calls observed — content guard cannot run |
| geode | — | — | ✗ | no draw calls observed — content guard cannot run |
| golden-forest | — | — | ✗ | draw calls differ (v1=782, v2=864) |
| halcyon-apex | <0.065536 | 0.00 | ✓ | — |
| himalayan-peak | 0.196 | 0.00 | ✓ | — |
| ice-temple | — | — | ✗ | draw calls differ (v1=227, v2=229) |
| koi-pond | 0.066 | 0.00 | ✓ | — |
| luminous-tides | — | — | ✗ | no draw calls observed — content guard cannot run |
| lunara | <0.065536 | 0.00 | ✓ | — |
| misty-lake | — | — | ✗ | no draw calls observed — content guard cannot run |
| moonlit-forest | <0.065536 | 0.00 | ✓ | — |
| moonlit-greenhouse | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| moonrise-summit | — | — | ✗ | no draw calls observed — content guard cannot run |
| mountain | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| nebula-flow | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| neon-district | — | — | ✗ | draw calls differ (v1=1192, v2=1285) |
| neon-dusk | <0.065536 | 0.00 | ✓ | — |
| nimbus-veil | — | — | ✗ | no draw calls observed — content guard cannot run |
| ocean | — | — | ✗ | draw calls differ (v1=393, v2=391) |
| pyrestorm | — | — | ✗ | no draw calls observed — content guard cannot run |
| rainy-window | — | — | ✗ | no draw calls observed — content guard cannot run |
| sakura-twilight | — | — | ✗ | no draw calls observed — content guard cannot run |
| serenity-warp | 0.131 | 0.00 | ✓ | — |
| shifting-sands | <0.065536 | 0.00 | ✓ | — |
| singing-bowl | — | — | ✗ | no draw calls observed — content guard cannot run |
| sky-children | — | — | ✗ | draw calls differ (v1=143, v2=137) |
| solar-eclipse | — | — | ✗ | no draw calls observed — content guard cannot run |
| starlight | 0.131 | 0.00 | ✓ | — |
| stellar-drift | 0.131 | 0.10 | ✓ | — |
| stellar-velocity | — | 0.00 | ✓ | — |
| stillwater | — | 0.00 | ✓ | — |
| summer | 0.197 | 0.10 | ✓ | — |
| sunset | — | — | ✗ | no draw calls observed — content guard cannot run |
| supernova | — | — | ✗ | no draw calls observed — content guard cannot run |
| synthwave-sunset | <0.065536 | 0.00 | ✓ | — |
| tornado | <0.065536 | 0.00 | ✓ | — |
| verdant-hills | — | — | ✗ | draw calls differ (v1=113, v2=89) |
| vesper-chrysalis | <0.065536 | 0.00 | ✓ | — |
| void-ember | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| voltage-storm | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| waves | — | — | ✗ | no draw calls observed — content guard cannot run |
| winter | 0.196 | 0.00 | ✓ | — |
| wolfhour | 0.066 | 0.00 | ✓ | — |

---

Notes carried from every cell:

- firstFrameGpuCompleteMs is GPU-work completion, not scanout. A page cannot observe presentation.
- pipelines.asyncSumMs is the sum of per-object awaited compiles (r185 Renderer awaits per object), not a wall-clock.
- pipelines.syncRows always carry ms=null: createRenderPipeline returns at once and the GPU process blocks at first draw.
- gpuMs is null for a classic THREE.WebGLRenderer: that renderer kind has no timestamp API in 0.185.1 (ADR-0019, ADR-0008).
- Two configurations inside 0.065536 ms mean "difference below resolution", never "zero cost" (ADR-0016).
- GPU samples are pushed once per RESOLVED query, never once per frame: Info.reset() does not clear render.timestamp.
