# Theme perf lane — aggregate

Cells: **61**, admissible **59**, inadmissible **2** (kept and marked, never dropped).

Adapter(s) observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Ranked — worst single pipeline compile first (the lava-lake signature)

| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first frame GPU ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|
| 1 | lunara | WebGPURenderer | 2754 | 22 | 3576 | 3831 | 8.30 | 2.70 | 1.442 | 75 | 0.40 | ✓ |
| 2 | stillwater | WebGPURenderer | 2739 | 44 | 4456 | 6384 | 8.30 | 3.10 | 0.721 | 60 | 0.40 | ✓ |
| 3 | fluid-dreams | WebGPURenderer | 2341 | 10 | 2994 | 3897 | 15.20 | 1.60 | 1.442 | 19 | 0.50 | ✓ |
| 4 | neon-district | WebGPURenderer | 1889 | 174 | 1622 | 2449 | 23.10 | 9.50 | 1.507 | 479 | 0.70 | ✓ |
| 5 | vesper-chrysalis | WebGPURenderer | 1567 | 62 | 2782 | 3663 | 22.40 | 3.90 | 1.311 | 106 | 0.40 | ✓ |
| 6 | golden-forest | WebGPURenderer | 1028 | 106 | 5043 | 5648 | 16.00 | 6.80 | 1.573 | 314 | 0.70 | ✓ |
| 7 | koi-pond | WebGPURenderer | 871 | 41 | 2314 | 3405 | 8.20 | 2.30 | 0.721 | 43 | 0.30 | ✓ |
| 8 | ice-temple | WebGPURenderer | 686 | 28 | 2637 | 3803 | 8.40 | 3.80 | 0.393 | 114 | 0.40 | ✓ |
| 9 | ocean | WebGPURenderer | 621 | 76 | 2937 | 5462 | 8.30 | 4.00 | 1.114 | 197 | 0.50 | ✓ |
| 10 | wolfhour | WebGPURenderer | 568 | 18 | 638 | 1201 | 8.30 | 1.90 | 0.786 | 32 | 0.40 | ✓ |
| 11 | bioluminescence-2 | WebGPURenderer | 385 | 52 | 1814 | 2798 | 15.60 | 4.40 | 1.114 | 251 | 0.60 | ✓ |
| 12 | stellar-drift | WebGPURenderer | 334 | 23 | 2168 | 2562 | 8.20 | 2.20 | 1.769 | 55 | 0.40 | ✓ |
| 13 | moonlit-forest | WebGPURenderer | 287 | 9 | 3071 | 3119 | 8.20 | 0.90 | 1.573 | 32 | 0.70 | ✓ |
| 14 | cosmic-noir | WebGPURenderer | 166 | 18 | 1149 | 1433 | 8.30 | 1.80 | 1.180 | 30 | 0.70 | ✓ |
| 15 | chromadelic-highway | WebGPURenderer | 161 | 27 | 1467 | 1631 | 16.20 | 2.20 | 0.459 | 68 | 1.10 | ✓ |
| 16 | stellar-velocity | WebGPURenderer | 127 | 23 | 975 | 1159 | 15.60 | 2.50 | — | 54 | 1.60 | ✗ |
| 17 | chiral-gold | WebGPURenderer | 70 | 17 | 763 | 1153 | 22.80 | 1.50 | 0.459 | 25 | 1.40 | ✓ |
| 18 | pyrestorm | WebGLRenderer | 0 | 0 | 2322 | 2344 | 8.20 | 0.80 | — | 1 | 1.20 | ✓ |
| 19 | moonrise-summit | WebGLRenderer | 0 | 0 | 1729 | 1742 | 8.20 | 0.70 | — | 1 | 1.00 | ✓ |
| 20 | blood-moon | WebGLRenderer | 0 | 0 | 1633 | 1687 | 8.30 | 0.60 | — | 1 | 1.20 | ✓ |
| 21 | crystal-cave | WebGLRenderer | 0 | 0 | 1096 | 1123 | 8.20 | 3.00 | — | 1 | 0.60 | ✓ |
| 22 | sakura-twilight | WebGLRenderer | 0 | 0 | 1086 | 1095 | 8.20 | 0.60 | — | 20 | 1.10 | ✓ |
| 23 | halcyon-apex | WebGPURenderer | 0 | 62 | 894 | 2623 | 8.30 | 4.70 | 0.786 | 308 | 0.40 | ✓ |
| 24 | rainy-window | WebGLRenderer | 0 | 0 | 820 | 850 | 8.20 | 0.70 | — | 11 | 2.00 | ✓ |
| 25 | sky-children | WebGPURenderer | 0 | 34 | 764 | 2870 | 15.20 | 2.20 | 1.114 | 68 | 0.40 | ✓ |
| 26 | geode | WebGLRenderer | 0 | 0 | 647 | 669 | 8.20 | 2.30 | — | 1 | 1.80 | ✓ |
| 27 | neon-dusk | WebGPURenderer | 0 | 28 | 634 | 1473 | 15.50 | 1.90 | 0.918 | 56 | 0.90 | ✗ |
| 28 | sunset | WebGLRenderer | 0 | 0 | 585 | 618 | 8.30 | 0.70 | — | 1 | 1.20 | ✓ |
| 29 | cinder-drift | WebGLRenderer | 0 | 0 | 580 | 590 | 8.20 | 0.20 | — | 11 | 1.10 | ✓ |
| 30 | singing-bowl | WebGLRenderer | 0 | 0 | 479 | 494 | 8.20 | 0.70 | — | 1 | 1.20 | ✓ |
| 31 | starlight | WebGPURenderer | 0 | 14 | 465 | 3472 | 8.20 | 1.70 | 2.556 | 23 | 0.70 | ✓ |
| 32 | summer | WebGPURenderer | 0 | 121 | 439 | 3798 | 8.20 | 3.20 | 2.294 | 186 | 0.30 | ✓ |
| 33 | nimbus-veil | WebGLRenderer | 0 | 0 | 419 | 432 | 8.20 | 0.60 | — | 1 | 1.50 | ✓ |
| 34 | synthwave-sunset | WebGPURenderer | 0 | 23 | 416 | 1174 | 15.60 | 2.60 | 0.721 | 111 | 1.80 | ✓ |
| 35 | electric-dreams-v3 | WebGPURenderer | 0 | 11 | 385 | 1175 | 8.30 | 1.60 | 1.769 | 16 | 1.40 | ✓ |
| 36 | himalayan-peak | WebGPURenderer | 0 | 14 | 385 | 1018 | 8.30 | 1.70 | 1.507 | 20 | 0.70 | ✓ |
| 37 | black-hole | WebGPURenderer | 0 | 21 | 378 | 1517 | 16.60 | 1.50 | 0.393 | 24 | 1.40 | ✓ |
| 38 | fall | WebGLRenderer | 0 | 0 | 355 | 829 | 8.20 | 0.60 | — | 1 | 1.20 | ✓ |
| 39 | aurora | WebGLRenderer | 0 | 0 | 350 | 358 | 8.30 | 0.30 | — | 13 | 1.20 | ✓ |
| 40 | winter | WebGPURenderer | 0 | 26 | 345 | 615 | 8.30 | 1.80 | 1.901 | 32 | 0.90 | ✓ |
| 41 | galaxy | WebGLRenderer | 0 | 0 | 329 | 338 | 8.20 | 0.30 | — | 12 | 1.00 | ✓ |
| 42 | bioluminescence | WebGLRenderer | 0 | 0 | 305 | 1584 | 8.30 | 4.80 | — | 1 | 1.70 | ✓ |
| 43 | astral-weave | WebGPURenderer | 0 | 27 | 288 | 1236 | 8.40 | 3.10 | 1.311 | 121 | 0.40 | ✓ |
| 44 | shifting-sands | WebGPURenderer | 0 | 18 | 264 | 459 | 15.20 | 1.70 | 1.442 | 28 | 1.00 | ✓ |
| 45 | serenity-warp | WebGPURenderer | 0 | 46 | 262 | 902 | 8.30 | 2.00 | 1.507 | 36 | 0.30 | ✓ |
| 46 | verdant-hills | WebGPURenderer | 0 | 6 | 261 | 358 | 8.20 | 1.40 | 1.245 | 83 | 1.20 | ✓ |
| 47 | aether-tides | — | 0 | 0 | 259 | 259 | 8.20 | — | — | — | 1.10 | ✓ |
| 48 | chromatic-impasto | — | 0 | 0 | 240 | 241 | 8.20 | — | — | — | 1.20 | ✓ |
| 49 | voltage-storm | — | 0 | 0 | 234 | 234 | 8.20 | — | — | — | 1.30 | ✓ |
| 50 | supernova | WebGLRenderer | 0 | 0 | 232 | 294 | 8.20 | 0.20 | — | 4 | 1.10 | ✓ |
| 51 | nebula-flow | — | 0 | 0 | 221 | 221 | 8.30 | — | — | — | 1.30 | ✓ |
| 52 | void-ember | — | 0 | 7 | 197 | 197 | 8.20 | — | — | — | 1.20 | ✓ |
| 53 | tornado | WebGPURenderer | 0 | 11 | 191 | 286 | 8.20 | 1.60 | 1.835 | 16 | 2.10 | ✓ |
| 54 | moonlit-greenhouse | — | 0 | 0 | 112 | 112 | 15.20 | — | — | — | 1.50 | ✓ |
| 55 | misty-lake | WebGLRenderer | 0 | 0 | 103 | 1595 | 8.20 | 1.00 | — | 1 | 1.30 | ✓ |
| 56 | waves | WebGLRenderer | 0 | 0 | 94 | 500 | 8.20 | 0.50 | — | 1 | 1.00 | ✓ |
| 57 | luminous-tides | WebGLRenderer | 0 | 0 | 89 | 568 | 8.20 | 1.00 | — | 1 | 2.00 | ✓ |
| 58 | solar-eclipse | WebGLRenderer | 0 | 0 | 87 | 832 | 8.20 | 1.60 | — | 1 | 3.00 | ✓ |
| 59 | cosmic-chimes | — | 0 | 0 | 52 | 52 | 8.30 | — | — | — | 1.30 | ✓ |
| 60 | mountain | — | 0 | 0 | 52 | 52 | 8.20 | — | — | — | 1.10 | ✓ |
| 61 | forest | — | 0 | 0 | 32 | 33 | 8.20 | — | — | — | 1.30 | ✓ |

## Inadmissible cells, and why

- **neon-dusk** — pins: rendererPixelRatio moved 0.95 -> 0.8999999999999999 during the window
- **stellar-velocity** — no GPU timestamp samples (no-resolved-timestamp-in-window)

## Worst single pipelines across the fleet

| theme | ms | material class | label |
|---|---:|---|---|
| lunara | 2754 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| stillwater | 2739 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| fluid-dreams | 2341 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_18` |
| fluid-dreams | 2120 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_17` |
| neon-district | 1889 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| vesper-chrysalis | 1567 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_44` |
| stillwater | 1423 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_19` |
| vesper-chrysalis | 1353 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_46` |
| lunara | 1210 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| golden-forest | 1028 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| neon-district | 891 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_272` |
| lunara | 875 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| koi-pond | 871 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| stillwater | 822 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| stillwater | 821 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_21` |
| vesper-chrysalis | 796 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| stillwater | 788 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_22` |
| vesper-chrysalis | 745 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_49` |
| koi-pond | 714 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_28` |
| ice-temple | 686 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_28` |
| vesper-chrysalis | 678 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_51` |
| vesper-chrysalis | 636 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| ocean | 621 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_32` |
| stillwater | 611 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_26` |
| stillwater | 597 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |

## Sync pipeline creations (post-reveal stall candidates)

These carry `ms: null` by construction — the call returns before the GPU compiles.

| theme | sync count | first at ms | labels (first 5) |
|---|---:|---:|---|
| neon-district | 174 | 4431 | `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_23` `renderPipeline_PMREM_ggx_22` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` |
| summer | 121 | 4744 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| golden-forest | 106 | 5974 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_ShadowMaterial_114` `renderPipeline_MeshStandardMaterial_48` `renderPipeline_MeshBasicMaterial_47` |
| ocean | 76 | 4792 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_41` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` |
| halcyon-apex | 62 | 4788 | `mipmap-rgba8unorm-2d-array` `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_32` `renderPipeline_MeshStandardNodeMaterial_17` |
| vesper-chrysalis | 62 | 4568 | `renderPipeline_PMREM.Background_42` `renderPipeline_MeshBasicNodeMaterial_32` `renderPipeline_MeshBasicNodeMaterial_39` `renderPipeline_MeshBasicNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_37` |
| bioluminescence-2 | 52 | 6011 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshBasicNodeMaterial_199` `renderPipeline_MeshBasicNodeMaterial_177` `renderPipeline_MeshBasicNodeMaterial_178` `renderPipeline_MeshBasicNodeMaterial_195` |
| serenity-warp | 46 | 4890 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_48` `renderPipeline_PMREM_ggx_47` |
| stillwater | 44 | 5869 | `renderPipeline_MeshStandardNodeMaterial_58` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 41 | 6430 | `renderPipeline_MeshBasicNodeMaterial_28` `renderPipeline_MeshBasicNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshStandardNodeMaterial_31` `renderPipeline_MeshStandardNodeMaterial_35` |
| sky-children | 34 | 4753 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_outputColorTransform_17` `renderPipeline_MeshBasicMaterial_19` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` |
| ice-temple | 28 | 4598 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_PMREM_equirect_48` `renderPipeline_PMREM_ggx_47` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshPhysicalMaterial_28` |
| neon-dusk | 28 | 4719 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_27` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_25` |
| astral-weave | 27 | 4582 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_PointsNodeMaterial_54` `renderPipeline_MeshBasicNodeMaterial_41` |
| chromadelic-highway | 27 | 4848 | `mipmap-rgba8unorm-2d-array` `renderPipeline_outputColorTransform_60` `renderPipeline_MeshBasicNodeMaterial_52` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_MeshBasicNodeMaterial_40` |
| winter | 26 | 4936 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_19` |
| stellar-drift | 23 | 5149 | `mipmap-rgba8unorm-srgb-2d-array` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_53` `renderPipeline_MeshStandardNodeMaterial_45` `renderPipeline_MeshBasicNodeMaterial_37` |
| stellar-velocity | 23 | 5361 | `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_SpriteNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_20` |
| synthwave-sunset | 23 | 4527 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_34` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_25` |
| lunara | 22 | 4593 | `renderPipeline_PMREM.Background_21` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PMREM_blur_19` `renderPipeline_PMREM_blur_19` |
| black-hole | 21 | 4680 | `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| cosmic-noir | 18 | 4782 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_PointsNodeMaterial_18` |
| shifting-sands | 18 | 4847 | `renderPipeline_MeshBasicNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicMaterial_25` `mipmap-rgba8unorm-2d-array` `renderPipeline_SpriteMaterial_21` |
| wolfhour | 18 | 4901 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_21` |
| chiral-gold | 17 | 4963 | `renderPipeline_outputColorTransform_28` `renderPipeline_MeshBasicNodeMaterial_23` `renderPipeline_MeshBasicNodeMaterial_23` `renderPipeline_PointsNodeMaterial_20` `renderPipeline_PointsNodeMaterial_16` |
| himalayan-peak | 14 | 4621 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_LineBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_17` |
| starlight | 14 | 4866 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| electric-dreams-v3 | 11 | 4654 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_Bloom_highPass_19` `renderPipeline_Bloom_separable_20` |
| tornado | 11 | 4702 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_18` `renderPipeline_Bloom_highPass_20` `renderPipeline_Bloom_separable_21` |
| fluid-dreams | 10 | 7184 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_RTT_21` `renderPipeline_Bloom_highPass_22` `renderPipeline_Bloom_separable_23` `renderPipeline_Bloom_separable_24` |
| moonlit-forest | 9 | 7387 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_39` |
| void-ember | 7 | 4617 | `void-ember/scene-pipeline` `void-ember/particle-pipeline` `void-ember/post-pipeline` `void-ember/present-pipeline` `void-ember/bloom-prefilter-pipeline` |
| verdant-hills | 6 | 4802 | `renderPipeline_MeshLambertNodeMaterial_53` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_193` |

## Drift between the two visits (bounds how much of a delta is noise)

| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |
|---|---:|---:|:--:|---|
| aether-tides | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| astral-weave | 0.262 | 0.10 | ✓ | — |
| aurora | — | — | ✗ | draw calls unavailable in one visit |
| bioluminescence-2 | <0.065536 | 0.00 | ✓ | — |
| bioluminescence | — | — | ✗ | draw calls differ (v1=1, v2=167) |
| black-hole | <0.065536 | 0.20 | ✓ | — |
| blood-moon | — | — | ✗ | draw calls differ (v1=1, v2=28) |
| chiral-gold | <0.065536 | 6.10 | ✓ | — |
| chromadelic-highway | 0.066 | 0.10 | ✓ | — |
| chromatic-impasto | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cinder-drift | — | — | ✗ | draw calls unavailable in one visit |
| cosmic-chimes | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cosmic-noir | <0.065536 | 0.10 | ✓ | — |
| crystal-cave | — | — | ✗ | draw calls differ (v1=1, v2=291) |
| electric-dreams-v3 | <0.065536 | 0.10 | ✓ | — |
| fall | — | — | ✗ | draw calls differ (v1=1, v2=7) |
| fluid-dreams | 0.066 | 0.10 | ✓ | — |
| forest | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| galaxy | — | — | ✗ | draw calls unavailable in one visit |
| geode | — | — | ✗ | draw calls differ (v1=1, v2=170) |
| golden-forest | — | — | ✗ | draw calls differ (v1=314, v2=308) |
| halcyon-apex | 0.066 | 0.20 | ✓ | — |
| himalayan-peak | 0.197 | 0.10 | ✓ | — |
| ice-temple | — | — | ✗ | draw calls differ (v1=114, v2=112) |
| koi-pond | <0.065536 | 0.00 | ✓ | — |
| luminous-tides | — | — | ✗ | draw calls differ (v1=1, v2=13) |
| lunara | 0.066 | 0.00 | ✓ | — |
| misty-lake | — | — | ✗ | draw calls differ (v1=1, v2=52) |
| moonlit-forest | <0.065536 | 0.00 | ✓ | — |
| moonlit-greenhouse | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| moonrise-summit | — | — | ✗ | draw calls differ (v1=1, v2=19) |
| mountain | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| nebula-flow | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| neon-district | — | — | ✗ | draw calls differ (v1=479, v2=475) |
| neon-dusk | 0.066 | 0.10 | ✓ | — |
| nimbus-veil | — | — | ✗ | draw calls differ (v1=1, v2=16) |
| ocean | — | — | ✗ | draw calls differ (v1=197, v2=196) |
| pyrestorm | — | — | ✗ | draw calls differ (v1=1, v2=38) |
| rainy-window | — | — | ✗ | draw calls differ (v1=11, v2=4) |
| sakura-twilight | — | — | ✗ | draw calls unavailable in one visit |
| serenity-warp | 0.066 | 0.10 | ✓ | — |
| shifting-sands | <0.065536 | 0.00 | ✓ | — |
| singing-bowl | — | — | ✗ | draw calls differ (v1=1, v2=20) |
| sky-children | — | — | ✗ | draw calls differ (v1=68, v2=70) |
| solar-eclipse | — | — | ✗ | draw calls differ (v1=1, v2=51) |
| starlight | — | — | ✗ | draw calls differ (v1=23, v2=19) |
| stellar-drift | <0.065536 | 0.00 | ✓ | — |
| stellar-velocity | — | 0.00 | ✓ | — |
| stillwater | — | 0.10 | ✓ | — |
| summer | 0.132 | 0.00 | ✓ | — |
| sunset | — | — | ✗ | draw calls differ (v1=1, v2=6) |
| supernova | — | — | ✗ | draw calls unavailable in one visit |
| synthwave-sunset | <0.065536 | 0.10 | ✓ | — |
| tornado | <0.065536 | 0.10 | ✓ | — |
| verdant-hills | — | — | ✗ | draw calls differ (v1=83, v2=104) |
| vesper-chrysalis | <0.065536 | 0.10 | ✓ | — |
| void-ember | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| voltage-storm | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| waves | — | — | ✗ | draw calls differ (v1=1, v2=2) |
| winter | <0.065536 | 0.10 | ✓ | — |
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
