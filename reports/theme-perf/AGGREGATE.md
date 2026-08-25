# Theme perf lane — aggregate

Cells: **61**, admissible **59**, inadmissible **2** (kept and marked, never dropped).

Adapter(s) observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Ranked — worst single pipeline compile first (the lava-lake signature)

| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first frame GPU ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|
| 1 | stillwater | WebGPURenderer | 2894 | 44 | 4643 | 6583 | 8.40 | 3.00 | 0.786 | 26 | 0.80 | ✓ |
| 2 | lunara | WebGPURenderer | 2717 | 22 | 3560 | 3824 | 8.20 | 2.80 | 1.311 | 74 | 0.40 | ✓ |
| 3 | fluid-dreams | WebGPURenderer | 2315 | 10 | 3002 | 3885 | 15.20 | 1.70 | 1.442 | 17 | 0.50 | ✓ |
| 4 | vesper-chrysalis | WebGPURenderer | 1619 | 62 | 2816 | 3681 | 16.60 | 3.80 | 1.311 | 58 | 0.60 | ✓ |
| 5 | neon-district | WebGPURenderer | 1172 | 60 | 637 | 1872 | 23.00 | 9.00 | 1.376 | 260 | 0.60 | ✓ |
| 6 | golden-forest | WebGPURenderer | 1040 | 106 | 4861 | 5383 | 16.20 | 6.70 | 1.442 | 162 | 0.70 | ✓ |
| 7 | koi-pond | WebGPURenderer | 904 | 41 | 2375 | 3466 | 8.20 | 2.30 | 0.655 | 42 | 0.40 | ✓ |
| 8 | ocean | WebGPURenderer | 685 | 76 | 3025 | 5605 | 8.30 | 4.00 | 1.114 | 194 | 0.50 | ✓ |
| 9 | ice-temple | WebGPURenderer | 679 | 28 | 2621 | 3937 | 8.30 | 3.90 | 0.328 | 116 | 0.50 | ✓ |
| 10 | wolfhour | WebGPURenderer | 554 | 18 | 638 | 1190 | 8.30 | 1.90 | 0.786 | 31 | 0.40 | ✓ |
| 11 | bioluminescence-2 | WebGPURenderer | 385 | 52 | 1760 | 2730 | 15.40 | 4.40 | 1.114 | 250 | 0.60 | ✓ |
| 12 | stellar-drift | WebGPURenderer | 321 | 23 | 2202 | 2608 | 8.20 | 2.30 | 1.901 | 54 | 0.40 | ✓ |
| 13 | moonlit-forest | WebGPURenderer | 277 | 9 | 3037 | 3093 | 8.20 | 0.90 | 1.573 | 32 | 0.70 | ✓ |
| 14 | cosmic-noir | WebGPURenderer | 165 | 18 | 1135 | 1418 | 8.20 | 1.90 | 0.655 | 29 | 0.70 | ✓ |
| 15 | chromadelic-highway | WebGPURenderer | 161 | 27 | 1468 | 1637 | 16.20 | 2.30 | 0.459 | 66 | 0.70 | ✓ |
| 16 | stellar-velocity | WebGPURenderer | 127 | 23 | 959 | 1150 | 15.60 | 2.60 | — | 52 | 1.50 | ✗ |
| 17 | chiral-gold | WebGPURenderer | 68 | 17 | 765 | 1154 | 22.40 | 1.50 | 0.459 | 23 | 1.30 | ✓ |
| 18 | pyrestorm | WebGLRenderer | 0 | 0 | 2283 | 2300 | 8.20 | 0.90 | — | 54 | 1.30 | ✓ |
| 19 | moonrise-summit | WebGLRenderer | 0 | 0 | 1705 | 1716 | 8.20 | 0.70 | — | 33 | 1.10 | ✓ |
| 20 | blood-moon | WebGLRenderer | 0 | 0 | 1606 | 1658 | 8.20 | 0.70 | — | 43 | 1.20 | ✓ |
| 21 | crystal-cave | WebGLRenderer | 0 | 0 | 1072 | 1103 | 8.20 | 3.70 | — | 185 | 1.80 | ✓ |
| 22 | sakura-twilight | WebGLRenderer | 0 | 0 | 1061 | 1070 | 8.20 | 0.60 | — | 20 | 1.00 | ✓ |
| 23 | halcyon-apex | WebGPURenderer | 0 | 62 | 896 | 2601 | 8.20 | 4.80 | 0.655 | 153 | 0.30 | ✓ |
| 24 | rainy-window | WebGLRenderer | 0 | 0 | 834 | 863 | 8.20 | 0.70 | — | 5 | 2.30 | ✓ |
| 25 | sky-children | WebGPURenderer | 0 | 34 | 719 | 2810 | 15.20 | 2.30 | 1.114 | 69 | 0.50 | ✓ |
| 26 | neon-dusk | WebGPURenderer | 0 | 28 | 659 | 1488 | 15.50 | 1.90 | 0.983 | 55 | 1.30 | ✗ |
| 27 | geode | WebGLRenderer | 0 | 0 | 637 | 656 | 8.20 | 2.30 | — | 190 | 2.10 | ✓ |
| 28 | sunset | WebGLRenderer | 0 | 0 | 583 | 614 | 8.20 | 0.70 | — | 21 | 1.20 | ✓ |
| 29 | cinder-drift | WebGLRenderer | 0 | 0 | 573 | 583 | 8.20 | 0.20 | — | 11 | 1.00 | ✓ |
| 30 | singing-bowl | WebGLRenderer | 0 | 0 | 473 | 488 | 8.20 | 0.70 | — | 24 | 1.20 | ✓ |
| 31 | starlight | WebGPURenderer | 0 | 14 | 471 | 3381 | 8.20 | 1.60 | 2.228 | 18 | 0.70 | ✓ |
| 32 | summer | WebGPURenderer | 0 | 121 | 433 | 3795 | 8.20 | 3.10 | 2.228 | 92 | 0.30 | ✓ |
| 33 | synthwave-sunset | WebGPURenderer | 0 | 23 | 425 | 1178 | 15.40 | 2.50 | 0.721 | 110 | 1.90 | ✓ |
| 34 | nimbus-veil | WebGLRenderer | 0 | 0 | 412 | 424 | 8.20 | 0.60 | — | 31 | 1.40 | ✓ |
| 35 | electric-dreams-v3 | WebGPURenderer | 0 | 11 | 382 | 1181 | 8.30 | 1.60 | 2.032 | 15 | 1.10 | ✓ |
| 36 | black-hole | WebGPURenderer | 0 | 21 | 381 | 1514 | 16.30 | 1.50 | 0.328 | 23 | 1.40 | ✓ |
| 37 | himalayan-peak | WebGPURenderer | 0 | 14 | 374 | 1010 | 8.30 | 1.70 | 1.442 | 19 | 0.80 | ✓ |
| 38 | fall | WebGLRenderer | 0 | 0 | 360 | 810 | 8.20 | 0.60 | — | 22 | 1.10 | ✓ |
| 39 | winter | WebGPURenderer | 0 | 26 | 354 | 647 | 8.30 | 1.90 | 1.901 | 31 | 0.80 | ✓ |
| 40 | galaxy | WebGLRenderer | 0 | 0 | 339 | 349 | 8.20 | 0.30 | — | 12 | 1.10 | ✓ |
| 41 | bioluminescence | WebGLRenderer | 0 | 0 | 318 | 1617 | 8.30 | 4.30 | — | 89 | 1.00 | ✓ |
| 42 | astral-weave | WebGPURenderer | 0 | 27 | 287 | 1238 | 8.30 | 3.10 | 1.114 | 120 | 0.40 | ✓ |
| 43 | aurora | WebGLRenderer | 0 | 0 | 286 | 293 | 8.30 | 0.30 | — | 13 | 0.90 | ✓ |
| 44 | serenity-warp | WebGPURenderer | 0 | 46 | 263 | 909 | 8.20 | 2.00 | 1.507 | 35 | 0.30 | ✓ |
| 45 | shifting-sands | WebGPURenderer | 0 | 18 | 258 | 455 | 15.20 | 1.70 | 1.442 | 27 | 1.00 | ✓ |
| 46 | aether-tides | — | 0 | 0 | 247 | 247 | 8.20 | — | — | — | 1.30 | ✓ |
| 47 | verdant-hills | WebGPURenderer | 0 | 6 | 246 | 362 | 8.20 | 1.70 | 1.311 | 116 | 1.30 | ✓ |
| 48 | voltage-storm | — | 0 | 0 | 235 | 235 | 8.20 | — | — | — | 1.30 | ✓ |
| 49 | chromatic-impasto | — | 0 | 0 | 229 | 229 | 8.10 | — | — | — | 1.30 | ✓ |
| 50 | nebula-flow | — | 0 | 0 | 228 | 228 | 8.20 | — | — | — | 1.20 | ✓ |
| 51 | supernova | WebGLRenderer | 0 | 0 | 223 | 257 | 8.20 | 0.20 | — | 4 | 1.10 | ✓ |
| 52 | void-ember | — | 0 | 7 | 204 | 204 | 8.30 | — | — | — | 1.20 | ✓ |
| 53 | tornado | WebGPURenderer | 0 | 11 | 197 | 296 | 8.20 | 1.60 | 1.966 | 15 | 2.00 | ✓ |
| 54 | moonlit-greenhouse | — | 0 | 0 | 103 | 103 | 15.20 | — | — | — | 1.60 | ✓ |
| 55 | solar-eclipse | WebGLRenderer | 0 | 0 | 99 | 835 | 8.20 | 1.60 | — | 67 | 3.00 | ✓ |
| 56 | misty-lake | WebGLRenderer | 0 | 0 | 98 | 1581 | 8.20 | 1.00 | — | 67 | 1.10 | ✓ |
| 57 | luminous-tides | WebGLRenderer | 0 | 0 | 84 | 568 | 8.20 | 0.90 | — | 28 | 2.00 | ✓ |
| 58 | waves | WebGLRenderer | 0 | 0 | 82 | 473 | 8.20 | 0.60 | — | 17 | 1.10 | ✓ |
| 59 | mountain | — | 0 | 0 | 54 | 54 | 8.20 | — | — | — | 1.10 | ✓ |
| 60 | cosmic-chimes | — | 0 | 0 | 43 | 44 | 8.20 | — | — | — | 1.30 | ✓ |
| 61 | forest | — | 0 | 0 | 24 | 24 | 8.20 | — | — | — | 1.20 | ✓ |

## Inadmissible cells, and why

- **neon-dusk** — pins: rendererPixelRatio moved 0.95 -> 0.8999999999999999 during the window
- **stellar-velocity** — no GPU timestamp samples (no-resolved-timestamp-in-window)

## Worst single pipelines across the fleet

| theme | ms | material class | label |
|---|---:|---|---|
| stillwater | 2894 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| lunara | 2717 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| fluid-dreams | 2315 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_18` |
| fluid-dreams | 2114 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_17` |
| vesper-chrysalis | 1619 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_44` |
| stillwater | 1586 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_19` |
| vesper-chrysalis | 1243 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_46` |
| neon-district | 1172 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| lunara | 1152 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| golden-forest | 1040 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| stillwater | 976 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| stillwater | 961 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_21` |
| stillwater | 938 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_22` |
| koi-pond | 904 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| lunara | 880 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| vesper-chrysalis | 804 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| vesper-chrysalis | 718 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_49` |
| ocean | 685 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_31` |
| koi-pond | 680 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_28` |
| ice-temple | 679 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_28` |
| vesper-chrysalis | 650 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_51` |
| vesper-chrysalis | 629 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| stillwater | 618 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |
| stillwater | 618 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |
| stillwater | 593 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_26` |

## Sync pipeline creations (post-reveal stall candidates)

These carry `ms: null` by construction — the call returns before the GPU compiles.

| theme | sync count | first at ms | labels (first 5) |
|---|---:|---:|---|
| summer | 121 | 4518 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| golden-forest | 106 | 5925 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_ShadowMaterial_114` `renderPipeline_MeshStandardMaterial_48` `renderPipeline_MeshBasicMaterial_47` |
| ocean | 76 | 4674 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_41` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` |
| halcyon-apex | 62 | 4790 | `mipmap-rgba8unorm-2d-array` `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_32` `renderPipeline_MeshStandardNodeMaterial_17` |
| vesper-chrysalis | 62 | 4657 | `renderPipeline_PMREM.Background_42` `renderPipeline_MeshBasicNodeMaterial_32` `renderPipeline_MeshBasicNodeMaterial_39` `renderPipeline_MeshBasicNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_37` |
| neon-district | 60 | 4591 | `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_23` `renderPipeline_PMREM_ggx_22` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` |
| bioluminescence-2 | 52 | 5888 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshBasicNodeMaterial_199` `renderPipeline_MeshBasicNodeMaterial_177` `renderPipeline_MeshBasicNodeMaterial_178` `renderPipeline_MeshBasicNodeMaterial_195` |
| serenity-warp | 46 | 4904 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_48` `renderPipeline_PMREM_ggx_47` |
| stillwater | 44 | 5560 | `renderPipeline_MeshStandardNodeMaterial_58` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` |
| koi-pond | 41 | 6471 | `renderPipeline_MeshBasicNodeMaterial_28` `renderPipeline_MeshBasicNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshStandardNodeMaterial_31` `renderPipeline_MeshStandardNodeMaterial_35` |
| sky-children | 34 | 4448 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_outputColorTransform_17` `renderPipeline_MeshBasicMaterial_19` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` |
| ice-temple | 28 | 4487 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_PMREM_equirect_48` `renderPipeline_PMREM_ggx_47` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshPhysicalMaterial_28` |
| neon-dusk | 28 | 4867 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_27` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_25` |
| astral-weave | 27 | 4870 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_68` `renderPipeline_MeshBasicNodeMaterial_68` `renderPipeline_PointsNodeMaterial_54` `renderPipeline_MeshBasicNodeMaterial_60` |
| chromadelic-highway | 27 | 4723 | `mipmap-rgba8unorm-2d-array` `renderPipeline_outputColorTransform_60` `renderPipeline_MeshBasicNodeMaterial_52` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_MeshBasicNodeMaterial_40` |
| winter | 26 | 4813 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_19` |
| stellar-drift | 23 | 4951 | `mipmap-rgba8unorm-srgb-2d-array` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_53` `renderPipeline_MeshStandardNodeMaterial_45` `renderPipeline_MeshBasicNodeMaterial_37` |
| stellar-velocity | 23 | 5411 | `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_SpriteNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_20` |
| synthwave-sunset | 23 | 4530 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_34` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_25` |
| lunara | 22 | 4470 | `renderPipeline_PMREM.Background_21` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PMREM_blur_19` `renderPipeline_PMREM_blur_19` |
| black-hole | 21 | 4732 | `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PointsNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| cosmic-noir | 18 | 5017 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_PointsNodeMaterial_18` |
| shifting-sands | 18 | 4860 | `renderPipeline_MeshBasicNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicMaterial_25` `mipmap-rgba8unorm-2d-array` `renderPipeline_SpriteMaterial_21` |
| wolfhour | 18 | 4794 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_21` |
| chiral-gold | 17 | 4948 | `renderPipeline_outputColorTransform_28` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_PointsNodeMaterial_20` `renderPipeline_PointsNodeMaterial_16` |
| himalayan-peak | 14 | 4734 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_LineBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_17` |
| starlight | 14 | 4591 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| electric-dreams-v3 | 11 | 4527 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_Bloom_highPass_19` `renderPipeline_Bloom_separable_20` |
| tornado | 11 | 4721 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_18` `renderPipeline_Bloom_highPass_20` `renderPipeline_Bloom_separable_21` |
| fluid-dreams | 10 | 7137 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_RTT_21` `renderPipeline_Bloom_highPass_22` `renderPipeline_Bloom_separable_23` `renderPipeline_Bloom_separable_24` |
| moonlit-forest | 9 | 7511 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_21` `renderPipeline_MeshBasicNodeMaterial_39` |
| void-ember | 7 | 4541 | `void-ember/scene-pipeline` `void-ember/particle-pipeline` `void-ember/post-pipeline` `void-ember/present-pipeline` `void-ember/bloom-prefilter-pipeline` |
| verdant-hills | 6 | 4549 | `renderPipeline_MeshLambertNodeMaterial_167` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_223` |

## Drift between the two visits (bounds how much of a delta is noise)

| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |
|---|---:|---:|:--:|---|
| aether-tides | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| astral-weave | 0.131 | 0.10 | ✓ | — |
| aurora | — | — | ✗ | draw calls unavailable in one visit |
| bioluminescence-2 | <0.065536 | 0.10 | ✓ | — |
| bioluminescence | — | — | ✗ | draw calls differ (v1=89, v2=75) |
| black-hole | <0.065536 | 0.10 | ✓ | — |
| blood-moon | — | — | ✗ | draw calls differ (v1=43, v2=28) |
| chiral-gold | <0.065536 | 0.30 | ✓ | — |
| chromadelic-highway | <0.065536 | 0.10 | ✓ | — |
| chromatic-impasto | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cinder-drift | — | — | ✗ | draw calls unavailable in one visit |
| cosmic-chimes | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cosmic-noir | <0.065536 | 0.10 | ✓ | — |
| crystal-cave | — | — | ✗ | draw calls differ (v1=185, v2=136) |
| electric-dreams-v3 | 0.262 | 0.00 | ✓ | — |
| fall | — | — | ✗ | draw calls differ (v1=22, v2=7) |
| fluid-dreams | <0.065536 | 0.10 | ✓ | — |
| forest | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| galaxy | — | — | ✗ | draw calls unavailable in one visit |
| geode | — | — | ✗ | draw calls differ (v1=190, v2=167) |
| golden-forest | — | — | ✗ | draw calls differ (v1=162, v2=167) |
| halcyon-apex | <0.065536 | 0.10 | ✓ | — |
| himalayan-peak | 0.132 | 0.10 | ✓ | — |
| ice-temple | <0.065536 | 0.20 | ✓ | — |
| koi-pond | <0.065536 | 0.10 | ✓ | — |
| luminous-tides | — | — | ✗ | draw calls differ (v1=28, v2=13) |
| lunara | 0.066 | 0.20 | ✓ | — |
| misty-lake | — | — | ✗ | draw calls differ (v1=67, v2=52) |
| moonlit-forest | <0.065536 | 0.10 | ✓ | — |
| moonlit-greenhouse | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| moonrise-summit | — | — | ✗ | draw calls differ (v1=33, v2=19) |
| mountain | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| nebula-flow | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| neon-district | — | — | ✗ | draw calls differ (v1=260, v2=264) |
| neon-dusk | 0.066 | 0.00 | ✓ | — |
| nimbus-veil | — | — | ✗ | draw calls differ (v1=31, v2=16) |
| ocean | — | — | ✗ | draw calls differ (v1=194, v2=196) |
| pyrestorm | — | — | ✗ | draw calls differ (v1=54, v2=38) |
| rainy-window | — | 0.10 | ✓ | — |
| sakura-twilight | — | — | ✗ | draw calls unavailable in one visit |
| serenity-warp | <0.065536 | 0.10 | ✓ | — |
| shifting-sands | <0.065536 | 0.00 | ✓ | — |
| singing-bowl | — | — | ✗ | draw calls differ (v1=24, v2=10) |
| sky-children | — | — | ✗ | draw calls differ (v1=69, v2=71) |
| solar-eclipse | — | — | ✗ | draw calls differ (v1=67, v2=51) |
| starlight | 0.131 | 0.00 | ✓ | — |
| stellar-drift | <0.065536 | 0.00 | ✓ | — |
| stellar-velocity | — | 0.00 | ✓ | — |
| stillwater | — | 0.20 | ✓ | — |
| summer | 0.066 | 0.00 | ✓ | — |
| sunset | — | — | ✗ | draw calls unavailable in one visit |
| supernova | — | — | ✗ | draw calls unavailable in one visit |
| synthwave-sunset | <0.065536 | 0.10 | ✓ | — |
| tornado | <0.065536 | 0.00 | ✓ | — |
| verdant-hills | — | — | ✗ | draw calls differ (v1=116, v2=101) |
| vesper-chrysalis | <0.065536 | 5.50 | ✓ | — |
| void-ember | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| voltage-storm | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| waves | — | — | ✗ | draw calls differ (v1=17, v2=2) |
| winter | 0.066 | 0.00 | ✓ | — |
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
