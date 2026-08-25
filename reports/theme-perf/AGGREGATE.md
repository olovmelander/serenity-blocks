# Theme perf lane — aggregate

Cells: **61**, admissible **59**, inadmissible **2** (kept and marked, never dropped).

Adapter(s) observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Ranked — worst single pipeline compile first (the lava-lake signature)

| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first frame GPU ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|
| 1 | lunara | WebGPURenderer | 3027 | 22 | 3862 | 4118 | 8.20 | 2.80 | 1.245 | 75 | 0.40 | ✓ |
| 2 | stillwater | WebGPURenderer | 2873 | 44 | 4561 | 6505 | 8.30 | 3.00 | 0.721 | 60 | 0.40 | ✓ |
| 3 | ocean | WebGPURenderer | 2640 | 76 | 2862 | 5447 | 8.30 | 4.00 | 1.114 | 197 | 0.50 | ✓ |
| 4 | fluid-dreams | WebGPURenderer | 2255 | 10 | 2918 | 3781 | 15.20 | 1.60 | 1.442 | 19 | 0.60 | ✓ |
| 5 | neon-district | WebGPURenderer | 1738 | 156 | 644 | 1203 | 22.90 | 9.10 | 1.376 | 471 | 0.60 | ✓ |
| 6 | vesper-chrysalis | WebGPURenderer | 1580 | 62 | 2840 | 3737 | 22.30 | 3.90 | 1.245 | 106 | 0.40 | ✓ |
| 7 | golden-forest | WebGPURenderer | 1054 | 106 | 5123 | 5673 | 16.10 | 7.00 | 1.507 | 324 | 0.80 | ✓ |
| 8 | koi-pond | WebGPURenderer | 920 | 41 | 2383 | 3495 | 8.30 | 2.30 | 0.721 | 43 | 0.40 | ✓ |
| 9 | ice-temple | WebGPURenderer | 670 | 28 | 2634 | 3944 | 8.40 | 3.80 | 0.328 | 114 | 0.40 | ✓ |
| 10 | wolfhour | WebGPURenderer | 553 | 18 | 656 | 1210 | 8.20 | 1.90 | 1.049 | 32 | 0.30 | ✓ |
| 11 | bioluminescence-2 | WebGPURenderer | 379 | 52 | 1786 | 2768 | 15.60 | 4.30 | 1.180 | 251 | 0.40 | ✓ |
| 12 | stellar-drift | WebGPURenderer | 322 | 23 | 2176 | 2560 | 8.30 | 2.20 | 1.835 | 55 | 0.40 | ✓ |
| 13 | moonlit-forest | WebGPURenderer | 292 | 9 | 3011 | 3064 | 8.20 | 0.90 | 1.442 | 32 | 0.90 | ✓ |
| 14 | cosmic-noir | WebGPURenderer | 169 | 18 | 1164 | 1447 | 8.30 | 1.90 | 0.590 | 30 | 1.10 | ✓ |
| 15 | chromadelic-highway | WebGPURenderer | 153 | 27 | 1480 | 1651 | 16.30 | 2.30 | 0.459 | 68 | 0.90 | ✓ |
| 16 | stellar-velocity | WebGPURenderer | 129 | 23 | 955 | 1139 | 15.60 | 2.50 | — | 54 | 1.60 | ✗ |
| 17 | chiral-gold | WebGPURenderer | 70 | 17 | 757 | 1138 | 22.50 | 1.50 | 0.524 | 25 | 1.20 | ✓ |
| 18 | pyrestorm | WebGLRenderer | 0 | 0 | 2270 | 2289 | 8.20 | 0.80 | — | 54 | 1.20 | ✓ |
| 19 | moonrise-summit | WebGLRenderer | 0 | 0 | 1719 | 1732 | 8.20 | 0.70 | — | 33 | 1.20 | ✓ |
| 20 | blood-moon | WebGLRenderer | 0 | 0 | 1596 | 1649 | 8.20 | 0.70 | — | 43 | 1.20 | ✓ |
| 21 | crystal-cave | WebGLRenderer | 0 | 0 | 1075 | 1104 | 8.30 | 3.10 | — | 268 | 0.80 | ✓ |
| 22 | sakura-twilight | WebGLRenderer | 0 | 0 | 1065 | 1074 | 8.20 | 0.70 | — | 22 | 1.00 | ✓ |
| 23 | halcyon-apex | WebGPURenderer | 0 | 62 | 906 | 2634 | 8.20 | 4.60 | 0.721 | 308 | 0.40 | ✓ |
| 24 | rainy-window | WebGLRenderer | 0 | 0 | 816 | 846 | 8.20 | 0.70 | — | 11 | 2.50 | ✓ |
| 25 | sky-children | WebGPURenderer | 0 | 34 | 771 | 2850 | 15.20 | 2.20 | 1.049 | 63 | 0.50 | ✓ |
| 26 | neon-dusk | WebGPURenderer | 0 | 28 | 674 | 1520 | 15.60 | 1.90 | 0.918 | 56 | 0.80 | ✗ |
| 27 | geode | WebGLRenderer | 0 | 0 | 624 | 644 | 8.20 | 2.30 | — | 201 | 2.30 | ✓ |
| 28 | sunset | WebGLRenderer | 0 | 0 | 587 | 616 | 8.20 | 0.70 | — | 32 | 1.20 | ✓ |
| 29 | cinder-drift | WebGLRenderer | 0 | 0 | 574 | 583 | 8.20 | 0.20 | — | 11 | 1.20 | ✓ |
| 30 | singing-bowl | WebGLRenderer | 0 | 0 | 477 | 492 | 8.20 | 0.70 | — | 35 | 1.10 | ✓ |
| 31 | summer | WebGPURenderer | 0 | 121 | 453 | 3812 | 8.20 | 3.20 | 2.294 | 186 | 0.30 | ✓ |
| 32 | starlight | WebGPURenderer | 0 | 14 | 453 | 3439 | 8.20 | 1.60 | 2.425 | 19 | 0.80 | ✓ |
| 33 | synthwave-sunset | WebGPURenderer | 0 | 23 | 424 | 1169 | 15.60 | 2.50 | 0.721 | 111 | 2.00 | ✓ |
| 34 | nimbus-veil | WebGLRenderer | 0 | 0 | 416 | 428 | 8.20 | 0.60 | — | 31 | 1.40 | ✓ |
| 35 | himalayan-peak | WebGPURenderer | 0 | 14 | 385 | 1031 | 8.20 | 1.70 | 1.507 | 20 | 0.80 | ✓ |
| 36 | black-hole | WebGPURenderer | 0 | 21 | 379 | 1529 | 16.40 | 1.50 | 0.393 | 24 | 1.40 | ✓ |
| 37 | winter | WebGPURenderer | 0 | 26 | 366 | 655 | 8.20 | 1.80 | 1.901 | 32 | 0.80 | ✓ |
| 38 | fall | WebGLRenderer | 0 | 0 | 360 | 793 | 8.20 | 0.60 | — | 22 | 1.10 | ✓ |
| 39 | electric-dreams-v3 | WebGPURenderer | 0 | 11 | 357 | 1174 | 8.30 | 1.50 | 1.901 | 16 | 1.30 | ✓ |
| 40 | aurora | WebGLRenderer | 0 | 0 | 345 | 351 | 8.20 | 0.30 | — | 13 | 1.10 | ✓ |
| 41 | galaxy | WebGLRenderer | 0 | 0 | 337 | 346 | 8.20 | 0.30 | — | 12 | 1.10 | ✓ |
| 42 | bioluminescence | WebGLRenderer | 0 | 0 | 323 | 1593 | 8.20 | 4.00 | — | 152 | 0.90 | ✓ |
| 43 | astral-weave | WebGPURenderer | 0 | 27 | 285 | 1279 | 8.50 | 3.20 | 1.114 | 121 | 0.40 | ✓ |
| 44 | verdant-hills | WebGPURenderer | 0 | 6 | 269 | 379 | 8.20 | 1.50 | 1.311 | 110 | 1.10 | ✓ |
| 45 | shifting-sands | WebGPURenderer | 0 | 18 | 258 | 462 | 15.30 | 1.70 | 1.442 | 28 | 1.00 | ✓ |
| 46 | serenity-warp | WebGPURenderer | 0 | 46 | 253 | 896 | 8.30 | 1.90 | 1.573 | 36 | 0.30 | ✓ |
| 47 | aether-tides | — | 0 | 0 | 247 | 247 | 8.20 | — | — | — | 1.30 | ✓ |
| 48 | voltage-storm | — | 0 | 0 | 241 | 241 | 8.20 | — | — | — | 1.40 | ✓ |
| 49 | nebula-flow | — | 0 | 0 | 237 | 237 | 8.20 | — | — | — | 1.30 | ✓ |
| 50 | supernova | WebGLRenderer | 0 | 0 | 237 | 269 | 8.20 | 0.20 | — | 4 | 1.10 | ✓ |
| 51 | chromatic-impasto | — | 0 | 0 | 224 | 224 | 8.20 | — | — | — | 1.10 | ✓ |
| 52 | void-ember | — | 0 | 7 | 195 | 195 | 8.20 | — | — | — | 1.50 | ✓ |
| 53 | tornado | WebGPURenderer | 0 | 11 | 184 | 280 | 8.20 | 1.60 | 1.966 | 16 | 1.90 | ✓ |
| 54 | moonlit-greenhouse | — | 0 | 0 | 99 | 99 | 15.30 | — | — | — | 1.60 | ✓ |
| 55 | misty-lake | WebGLRenderer | 0 | 0 | 97 | 1612 | 8.30 | 1.00 | — | 67 | 1.20 | ✓ |
| 56 | waves | WebGLRenderer | 0 | 0 | 86 | 480 | 8.20 | 0.50 | — | 17 | 1.00 | ✓ |
| 57 | luminous-tides | WebGLRenderer | 0 | 0 | 84 | 565 | 8.20 | 0.90 | — | 28 | 2.00 | ✓ |
| 58 | solar-eclipse | WebGLRenderer | 0 | 0 | 83 | 819 | 8.20 | 1.50 | — | 67 | 2.60 | ✓ |
| 59 | mountain | — | 0 | 0 | 50 | 50 | 8.20 | — | — | — | 1.20 | ✓ |
| 60 | cosmic-chimes | — | 0 | 0 | 43 | 43 | 8.30 | — | — | — | 1.20 | ✓ |
| 61 | forest | — | 0 | 0 | 30 | 30 | 8.20 | — | — | — | 1.00 | ✓ |

## Inadmissible cells, and why

- **neon-dusk** — pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window
- **stellar-velocity** — no GPU timestamp samples (no-resolved-timestamp-in-window)

## Worst single pipelines across the fleet

| theme | ms | material class | label |
|---|---:|---|---|
| lunara | 3027 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| stillwater | 2873 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| ocean | 2640 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_32` |
| fluid-dreams | 2255 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_18` |
| fluid-dreams | 2004 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_17` |
| neon-district | 1738 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_259` |
| stillwater | 1607 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_19` |
| vesper-chrysalis | 1580 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_44` |
| vesper-chrysalis | 1316 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_46` |
| lunara | 1221 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| golden-forest | 1054 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| stillwater | 952 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| stillwater | 940 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_21` |
| koi-pond | 920 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| stillwater | 912 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_22` |
| lunara | 889 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| vesper-chrysalis | 798 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 728 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_28` |
| vesper-chrysalis | 715 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_49` |
| vesper-chrysalis | 688 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_51` |
| ice-temple | 670 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_28` |
| vesper-chrysalis | 649 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| stillwater | 616 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |
| stillwater | 616 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |
| stillwater | 595 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_26` |

## Sync pipeline creations (post-reveal stall candidates)

These carry `ms: null` by construction — the call returns before the GPU compiles.

| theme | sync count | first at ms | labels (first 5) |
|---|---:|---:|---|
| neon-district | 156 | 4458 | `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_23` `renderPipeline_PMREM_ggx_22` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` |
| summer | 121 | 4606 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| golden-forest | 106 | 5851 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicMaterial_47` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_ShadowMaterial_115` |
| ocean | 76 | 4686 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_41` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` |
| halcyon-apex | 62 | 4715 | `mipmap-rgba8unorm-2d-array` `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_32` `renderPipeline_MeshStandardNodeMaterial_17` |
| vesper-chrysalis | 62 | 4594 | `renderPipeline_PMREM.Background_42` `renderPipeline_MeshBasicNodeMaterial_32` `renderPipeline_MeshBasicNodeMaterial_39` `renderPipeline_MeshBasicNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_37` |
| bioluminescence-2 | 52 | 5829 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshBasicNodeMaterial_199` `renderPipeline_MeshBasicNodeMaterial_177` `renderPipeline_MeshBasicNodeMaterial_178` `renderPipeline_MeshBasicNodeMaterial_195` |
| serenity-warp | 46 | 4817 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_48` `renderPipeline_PMREM_ggx_47` |
| stillwater | 44 | 5608 | `renderPipeline_MeshStandardNodeMaterial_58` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 41 | 6531 | `renderPipeline_MeshBasicNodeMaterial_28` `renderPipeline_MeshBasicNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshStandardNodeMaterial_31` `renderPipeline_MeshStandardNodeMaterial_35` |
| sky-children | 34 | 4668 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_outputColorTransform_17` `renderPipeline_MeshBasicMaterial_19` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` |
| ice-temple | 28 | 4677 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_PMREM_equirect_48` `renderPipeline_PMREM_ggx_47` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshPhysicalMaterial_28` |
| neon-dusk | 28 | 4926 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_27` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_25` |
| astral-weave | 27 | 4737 | `renderPipeline_PointsNodeMaterial_54` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_MeshBasicNodeMaterial_62` |
| chromadelic-highway | 27 | 4773 | `mipmap-rgba8unorm-2d-array` `renderPipeline_outputColorTransform_60` `renderPipeline_MeshBasicNodeMaterial_52` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_MeshBasicNodeMaterial_40` |
| winter | 26 | 4735 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_19` |
| stellar-drift | 23 | 5020 | `mipmap-rgba8unorm-srgb-2d-array` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_53` `renderPipeline_MeshStandardNodeMaterial_45` `renderPipeline_MeshBasicNodeMaterial_37` |
| stellar-velocity | 23 | 5231 | `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_SpriteNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_20` |
| synthwave-sunset | 23 | 4650 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_34` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_25` |
| lunara | 22 | 4567 | `renderPipeline_PMREM.Background_21` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PMREM_blur_19` `renderPipeline_PMREM_blur_19` |
| black-hole | 21 | 4618 | `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| cosmic-noir | 18 | 5011 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_PointsNodeMaterial_18` |
| shifting-sands | 18 | 4766 | `renderPipeline_MeshBasicNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicMaterial_25` `mipmap-rgba8unorm-2d-array` `renderPipeline_SpriteMaterial_21` |
| wolfhour | 18 | 4989 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_21` |
| chiral-gold | 17 | 5190 | `renderPipeline_outputColorTransform_28` `renderPipeline_PointsNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_PointsNodeMaterial_16` |
| himalayan-peak | 14 | 4587 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_LineBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_17` |
| starlight | 14 | 4634 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| electric-dreams-v3 | 11 | 4781 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_Bloom_highPass_19` `renderPipeline_Bloom_separable_20` |
| tornado | 11 | 4620 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_18` `renderPipeline_Bloom_highPass_20` `renderPipeline_Bloom_separable_21` |
| fluid-dreams | 10 | 7106 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_RTT_21` `renderPipeline_Bloom_highPass_22` `renderPipeline_Bloom_separable_23` `renderPipeline_Bloom_separable_24` |
| moonlit-forest | 9 | 7329 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_39` |
| void-ember | 7 | 4627 | `void-ember/scene-pipeline` `void-ember/particle-pipeline` `void-ember/post-pipeline` `void-ember/present-pipeline` `void-ember/bloom-prefilter-pipeline` |
| verdant-hills | 6 | 4533 | `renderPipeline_MeshLambertNodeMaterial_53` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_217` |

## Drift between the two visits (bounds how much of a delta is noise)

| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |
|---|---:|---:|:--:|---|
| aether-tides | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| astral-weave | <0.065536 | 0.20 | ✓ | — |
| aurora | — | — | ✗ | draw calls unavailable in one visit |
| bioluminescence-2 | <0.065536 | 0.20 | ✓ | — |
| bioluminescence | — | — | ✗ | draw calls differ (v1=152, v2=146) |
| black-hole | <0.065536 | 0.20 | ✓ | — |
| blood-moon | — | — | ✗ | draw calls differ (v1=43, v2=28) |
| chiral-gold | <0.065536 | 0.40 | ✓ | — |
| chromadelic-highway | <0.065536 | 0.20 | ✓ | — |
| chromatic-impasto | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cinder-drift | — | — | ✗ | draw calls unavailable in one visit |
| cosmic-chimes | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cosmic-noir | <0.065536 | 0.10 | ✓ | — |
| crystal-cave | — | — | ✗ | draw calls differ (v1=268, v2=227) |
| electric-dreams-v3 | <0.065536 | 0.10 | ✓ | — |
| fall | — | — | ✗ | draw calls differ (v1=22, v2=7) |
| fluid-dreams | 0.066 | 0.10 | ✓ | — |
| forest | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| galaxy | — | — | ✗ | draw calls unavailable in one visit |
| geode | — | — | ✗ | draw calls differ (v1=201, v2=159) |
| golden-forest | — | — | ✗ | draw calls differ (v1=324, v2=312) |
| halcyon-apex | 0.066 | 0.10 | ✓ | — |
| himalayan-peak | 0.197 | 0.00 | ✓ | — |
| ice-temple | <0.065536 | 0.20 | ✓ | — |
| koi-pond | <0.065536 | 0.00 | ✓ | — |
| luminous-tides | — | — | ✗ | draw calls differ (v1=28, v2=13) |
| lunara | <0.065536 | 0.10 | ✓ | — |
| misty-lake | — | — | ✗ | draw calls differ (v1=67, v2=52) |
| moonlit-forest | <0.065536 | 0.00 | ✓ | — |
| moonlit-greenhouse | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| moonrise-summit | — | — | ✗ | draw calls unavailable in one visit |
| mountain | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| nebula-flow | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| neon-district | — | — | ✗ | draw calls differ (v1=471, v2=428) |
| neon-dusk | 0.066 | 0.00 | ✓ | — |
| nimbus-veil | — | — | ✗ | draw calls differ (v1=31, v2=16) |
| ocean | — | — | ✗ | draw calls differ (v1=197, v2=196) |
| pyrestorm | — | — | ✗ | draw calls differ (v1=54, v2=38) |
| rainy-window | — | — | ✗ | draw calls differ (v1=11, v2=4) |
| sakura-twilight | — | — | ✗ | draw calls differ (v1=22, v2=1) |
| serenity-warp | <0.065536 | 0.10 | ✓ | — |
| shifting-sands | <0.065536 | 0.20 | ✓ | — |
| singing-bowl | — | — | ✗ | draw calls differ (v1=35, v2=20) |
| sky-children | — | — | ✗ | draw calls differ (v1=63, v2=68) |
| solar-eclipse | — | — | ✗ | draw calls differ (v1=67, v2=51) |
| starlight | 0.131 | 0.10 | ✓ | — |
| stellar-drift | <0.065536 | 0.00 | ✓ | — |
| stellar-velocity | — | 0.10 | ✓ | — |
| stillwater | — | 0.00 | ✓ | — |
| summer | 0.197 | 0.00 | ✓ | — |
| sunset | — | — | ✗ | draw calls differ (v1=32, v2=6) |
| supernova | — | — | ✗ | draw calls unavailable in one visit |
| synthwave-sunset | <0.065536 | 0.20 | ✓ | — |
| tornado | <0.065536 | 0.10 | ✓ | — |
| verdant-hills | — | — | ✗ | draw calls differ (v1=110, v2=120) |
| vesper-chrysalis | 0.066 | 0.40 | ✓ | — |
| void-ember | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| voltage-storm | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| waves | — | — | ✗ | draw calls differ (v1=17, v2=2) |
| winter | <0.065536 | 0.10 | ✓ | — |
| wolfhour | 0.066 | 0.00 | ✓ | — |

---

Notes carried from every cell:

- firstFrameGpuDoneMs is GPU-work completion for the first frame, not scanout. A page cannot observe presentation.
- allQuiescedGpuDoneMs INCLUDES a 2000-2100 ms compile-quiet wait by construction. It is not a latency; use firstFrameGpuDoneMs for that.
- pipelines.asyncSumMs is the sum of per-object awaited compiles (r185 Renderer awaits per object), not a wall-clock.
- pipelines.syncRows always carry ms=null: createRenderPipeline returns at once and the GPU process blocks at first draw.
- gpuMs is null for a classic THREE.WebGLRenderer: that renderer kind has no timestamp API in 0.185.1 (ADR-0019, ADR-0008).
- Two configurations inside 0.065536 ms mean "difference below resolution", never "zero cost" (ADR-0016).
- GPU samples are pushed once per RESOLVED query, never once per frame: Info.reset() does not clear render.timestamp.
