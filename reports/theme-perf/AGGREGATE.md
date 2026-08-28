# Theme perf lane — aggregate

Cells: **61**, admissible **60**, inadmissible **1** (kept and marked, never dropped).

Adapter(s) observed: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Ranked — worst single pipeline compile first (the lava-lake signature)

| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first frame GPU ms | idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|
| 1 | lunara | WebGPURenderer | 2280 | 22 | 2911 | 3153 | 8.30 | 1.70 | 1.376 | 75 | 0.40 | ✓ |
| 2 | stillwater | WebGPURenderer | 2232 | 44 | 3592 | 5476 | 8.20 | 1.80 | 0.786 | 60 | 0.40 | ✓ |
| 3 | neon-district | WebGPURenderer | 1806 | 165 | 546 | 1062 | 8.20 | 5.30 | 1.442 | 417 | 0.60 | ✓ |
| 4 | fluid-dreams | WebGPURenderer | 1677 | 10 | 2246 | 3103 | 8.20 | 1.00 | 1.442 | 19 | 0.60 | ✓ |
| 5 | vesper-chrysalis | WebGPURenderer | 1272 | 62 | 2270 | 3105 | 15.90 | 2.50 | 1.114 | 106 | 0.40 | ✓ |
| 6 | golden-forest | WebGPURenderer | 1109 | 65 | 2713 | 3068 | 8.30 | 4.60 | 1.638 | 330 | 0.60 | ✓ |
| 7 | koi-pond | WebGPURenderer | 732 | 10 | 1743 | 2130 | 8.30 | 1.40 | 0.721 | 43 | 0.60 | ✓ |
| 8 | ice-temple | WebGPURenderer | 692 | 13 | 1330 | 1612 | 8.20 | 2.20 | 0.459 | 112 | 0.70 | ✓ |
| 9 | wolfhour | WebGPURenderer | 538 | 18 | 527 | 1056 | 8.20 | 1.20 | 1.376 | 32 | 0.40 | ✓ |
| 10 | ocean | WebGPURenderer | 401 | 76 | 2039 | 4441 | 8.20 | 2.40 | 1.180 | 196 | 0.60 | ✓ |
| 11 | black-hole | WebGPURenderer | 397 | 9 | 715 | 972 | 15.90 | 1.00 | 0.393 | 24 | 1.40 | ✓ |
| 12 | stellar-drift | WebGPURenderer | 303 | 10 | 972 | 1051 | 8.20 | 1.50 | 1.901 | 55 | 0.40 | ✓ |
| 13 | moonlit-forest | WebGPURenderer | 293 | 1 | 841 | 890 | 8.20 | 0.70 | 1.638 | 32 | 0.80 | ✓ |
| 14 | bioluminescence-2 | WebGPURenderer | 273 | 52 | 1317 | 2271 | 8.20 | 2.60 | 1.245 | 251 | 0.40 | ✓ |
| 15 | chromadelic-highway | WebGPURenderer | 130 | 27 | 1153 | 1272 | 15.90 | 1.40 | 0.393 | 69 | 1.00 | ✓ |
| 16 | cosmic-noir | WebGPURenderer | 122 | 18 | 907 | 1173 | 8.20 | 1.20 | 1.180 | 30 | 0.90 | ✓ |
| 17 | stellar-velocity | WebGPURenderer | 98 | 23 | 750 | 884 | 8.20 | 1.60 | 0.393 | 54 | 1.90 | ✓ |
| 18 | chiral-gold | WebGPURenderer | 66 | 17 | 633 | 996 | 16.20 | 1.00 | 0.459 | 25 | 1.40 | ✓ |
| 19 | pyrestorm | WebGLRenderer | 0 | 0 | 2180 | 2206 | 8.20 | 0.50 | — | 54 | 1.00 | ✓ |
| 20 | moonrise-summit | WebGLRenderer | 0 | 0 | 1581 | 1590 | 8.20 | 0.50 | — | 33 | 1.00 | ✓ |
| 21 | blood-moon | WebGLRenderer | 0 | 0 | 1553 | 1601 | 8.20 | 0.40 | — | 43 | 1.30 | ✓ |
| 22 | crystal-cave | WebGLRenderer | 0 | 0 | 987 | 1009 | 8.20 | 2.10 | — | 339 | 1.40 | ✓ |
| 23 | sakura-twilight | WebGLRenderer | 0 | 0 | 944 | 952 | 8.20 | 0.50 | — | 21 | 1.00 | ✓ |
| 24 | rainy-window | WebGLRenderer | 0 | 0 | 799 | 827 | 8.20 | 0.50 | — | 11 | 1.90 | ✓ |
| 25 | halcyon-apex | WebGPURenderer | 0 | 62 | 727 | 2424 | 8.20 | 3.00 | 0.852 | 308 | 0.40 | ✓ |
| 26 | sky-children | WebGPURenderer | 0 | 34 | 578 | 2118 | 8.10 | 1.40 | 0.983 | 73 | 0.50 | ✓ |
| 27 | cinder-drift | WebGLRenderer | 0 | 0 | 551 | 557 | 8.20 | 0.20 | — | 11 | 1.00 | ✓ |
| 28 | geode | WebGLRenderer | 0 | 0 | 541 | 558 | 8.20 | 1.30 | — | 189 | 2.60 | ✓ |
| 29 | sunset | WebGLRenderer | 0 | 0 | 535 | 565 | 8.20 | 0.50 | — | 32 | 1.10 | ✓ |
| 30 | neon-dusk | WebGPURenderer | 0 | 28 | 531 | 1352 | 8.20 | 1.10 | 0.786 | 56 | 0.90 | ✗ |
| 31 | singing-bowl | WebGLRenderer | 0 | 0 | 405 | 418 | 8.20 | 0.50 | — | 34 | 1.20 | ✓ |
| 32 | summer | WebGPURenderer | 0 | 121 | 388 | 3534 | 8.20 | 2.00 | 2.425 | 186 | 0.40 | ✓ |
| 33 | starlight | WebGPURenderer | 0 | 14 | 373 | 3275 | 8.20 | 1.00 | 2.621 | 19 | 0.70 | ✓ |
| 34 | nimbus-veil | WebGLRenderer | 0 | 0 | 364 | 373 | 8.20 | 0.40 | — | 31 | 1.40 | ✓ |
| 35 | synthwave-sunset | WebGPURenderer | 0 | 23 | 352 | 1071 | 8.20 | 1.50 | 0.655 | 111 | 2.00 | ✓ |
| 36 | himalayan-peak | WebGPURenderer | 0 | 14 | 327 | 922 | 8.20 | 1.10 | 1.769 | 20 | 0.60 | ✓ |
| 37 | winter | WebGPURenderer | 0 | 26 | 318 | 516 | 8.20 | 1.10 | 2.228 | 32 | 0.80 | ✓ |
| 38 | electric-dreams-v3 | WebGPURenderer | 0 | 11 | 311 | 1092 | 8.20 | 1.00 | 1.966 | 16 | 1.30 | ✓ |
| 39 | fall | WebGLRenderer | 0 | 0 | 301 | 722 | 8.20 | 0.40 | — | 22 | 1.00 | ✓ |
| 40 | galaxy | WebGLRenderer | 0 | 0 | 294 | 301 | 8.20 | 0.20 | — | 12 | 1.20 | ✓ |
| 41 | bioluminescence | WebGLRenderer | 0 | 0 | 268 | 1460 | 8.20 | 2.90 | — | 188 | 2.10 | ✓ |
| 42 | aurora | WebGLRenderer | 0 | 0 | 264 | 272 | 8.20 | 0.20 | — | 13 | 1.00 | ✓ |
| 43 | serenity-warp | WebGPURenderer | 0 | 46 | 257 | 728 | 8.20 | 1.20 | 2.163 | 36 | 0.30 | ✓ |
| 44 | astral-weave | WebGPURenderer | 0 | 27 | 252 | 1001 | 8.20 | 1.80 | 1.311 | 121 | 0.30 | ✓ |
| 45 | verdant-hills | WebGPURenderer | 0 | 6 | 234 | 308 | 8.30 | 1.00 | 0.459 | 83 | 1.30 | ✓ |
| 46 | shifting-sands | WebGPURenderer | 0 | 18 | 227 | 375 | 8.20 | 1.00 | 1.245 | 28 | 1.00 | ✓ |
| 47 | supernova | WebGLRenderer | 0 | 0 | 226 | 232 | 8.20 | 0.20 | — | 4 | 1.00 | ✓ |
| 48 | aether-tides | — | 0 | 0 | 216 | 216 | 8.20 | — | — | — | 1.20 | ✓ |
| 49 | voltage-storm | — | 0 | 0 | 193 | 193 | 8.20 | — | — | — | 1.20 | ✓ |
| 50 | nebula-flow | — | 0 | 0 | 191 | 191 | 8.20 | — | — | — | 1.10 | ✓ |
| 51 | chromatic-impasto | — | 0 | 0 | 187 | 187 | 8.20 | — | — | — | 1.00 | ✓ |
| 52 | void-ember | — | 0 | 7 | 186 | 186 | 8.20 | — | — | — | 0.90 | ✓ |
| 53 | tornado | WebGPURenderer | 0 | 11 | 177 | 249 | 8.20 | 1.00 | 1.901 | 16 | 1.60 | ✓ |
| 54 | moonlit-greenhouse | — | 0 | 0 | 97 | 97 | 8.70 | — | — | — | 1.40 | ✓ |
| 55 | misty-lake | WebGLRenderer | 0 | 0 | 80 | 1491 | 8.20 | 0.60 | — | 67 | 1.10 | ✓ |
| 56 | solar-eclipse | WebGLRenderer | 0 | 0 | 71 | 743 | 8.20 | 1.00 | — | 67 | 2.70 | ✓ |
| 57 | waves | WebGLRenderer | 0 | 0 | 69 | 406 | 8.20 | 0.40 | — | 17 | 1.00 | ✓ |
| 58 | luminous-tides | WebGLRenderer | 0 | 0 | 68 | 487 | 8.20 | 0.60 | — | 28 | 1.80 | ✓ |
| 59 | cosmic-chimes | — | 0 | 0 | 46 | 47 | 8.20 | — | — | — | 1.10 | ✓ |
| 60 | mountain | — | 0 | 0 | 43 | 43 | 8.30 | — | — | — | 1.20 | ✓ |
| 61 | forest | — | 0 | 0 | 14 | 14 | 8.20 | — | — | — | 1.20 | ✓ |

## Inadmissible cells, and why

- **neon-dusk** — pins: rendererPixelRatio moved 0.85 -> 0.7999999999999999 during the window

## Worst single pipelines across the fleet

| theme | ms | material class | label |
|---|---:|---|---|
| lunara | 2280 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| stillwater | 2232 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_23` |
| neon-district | 1806 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_252` |
| fluid-dreams | 1677 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_18` |
| fluid-dreams | 1565 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_17` |
| vesper-chrysalis | 1272 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_44` |
| stillwater | 1172 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_19` |
| golden-forest | 1109 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_45` |
| vesper-chrysalis | 1057 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_46` |
| golden-forest | 1021 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_46` |
| lunara | 975 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| koi-pond | 732 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| lunara | 697 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_27` |
| ice-temple | 692 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_29` |
| ice-temple | 672 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_22` |
| stillwater | 661 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| vesper-chrysalis | 659 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_16` |
| stillwater | 651 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_21` |
| stillwater | 619 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_22` |
| ice-temple | 615 | MeshPhysicalMaterial | `renderPipeline_MeshPhysicalMaterial_28` |
| vesper-chrysalis | 606 | MeshPhysicalNodeMaterial | `renderPipeline_MeshPhysicalNodeMaterial_49` |
| koi-pond | 585 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_28` |
| vesper-chrysalis | 557 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_51` |
| wolfhour | 538 | MeshBasicNodeMaterial | `renderPipeline_MeshBasicNodeMaterial_20` |
| stillwater | 538 | MeshStandardNodeMaterial | `renderPipeline_MeshStandardNodeMaterial_25` |

## Sync pipeline creations (post-reveal stall candidates)

These carry `ms: null` by construction — the call returns before the GPU compiles.

| theme | sync count | first at ms | labels (first 5) |
|---|---:|---:|---|
| neon-district | 165 | 6539 | `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_23` `renderPipeline_PMREM_ggx_22` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_17` |
| summer | 121 | 6525 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_20` |
| ocean | 76 | 6832 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_41` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` `renderPipeline_MeshBasicNodeMaterial_42` |
| golden-forest | 65 | 6817 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_ShadowMaterial_112` `renderPipeline_MeshStandardMaterial_48` |
| halcyon-apex | 62 | 6866 | `mipmap-rgba8unorm-2d-array` `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshStandardNodeMaterial_33` `renderPipeline_MeshStandardNodeMaterial_32` `renderPipeline_MeshStandardNodeMaterial_17` |
| vesper-chrysalis | 62 | 6465 | `renderPipeline_PMREM.Background_42` `renderPipeline_MeshBasicNodeMaterial_32` `renderPipeline_MeshBasicNodeMaterial_39` `renderPipeline_MeshBasicNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_37` |
| bioluminescence-2 | 52 | 7476 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_MeshBasicNodeMaterial_199` `renderPipeline_MeshBasicNodeMaterial_177` `renderPipeline_MeshBasicNodeMaterial_178` `renderPipeline_MeshBasicNodeMaterial_195` |
| serenity-warp | 46 | 6872 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `mipmap-rgba8unorm-2d-array` `renderPipeline_PMREM_cubemap_48` `renderPipeline_PMREM_ggx_47` |
| stillwater | 44 | 7607 | `renderPipeline_MeshStandardNodeMaterial_58` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_25` `renderPipeline_MeshStandardNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` |
| sky-children | 34 | 6615 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_outputColorTransform_17` `renderPipeline_MeshBasicMaterial_19` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` |
| neon-dusk | 28 | 6878 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_27` `renderPipeline_PointsNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_25` |
| astral-weave | 27 | 6799 | `renderPipeline_PointsNodeMaterial_54` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_MeshBasicNodeMaterial_69` `renderPipeline_MeshBasicNodeMaterial_41` |
| chromadelic-highway | 27 | 6673 | `mipmap-rgba8unorm-2d-array` `renderPipeline_outputColorTransform_60` `renderPipeline_MeshBasicNodeMaterial_52` `renderPipeline_MeshBasicNodeMaterial_44` `renderPipeline_MeshBasicNodeMaterial_40` |
| winter | 26 | 6835 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_19` |
| stellar-velocity | 23 | 7118 | `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_MeshStandardNodeMaterial_46` `renderPipeline_SpriteNodeMaterial_25` `renderPipeline_MeshBasicNodeMaterial_20` |
| synthwave-sunset | 23 | 6729 | `renderPipeline_MeshBasicMaterial_16` `renderPipeline_MeshBasicNodeMaterial_34` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_29` `renderPipeline_MeshBasicNodeMaterial_25` |
| lunara | 22 | 6645 | `renderPipeline_PMREM.Background_21` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_PMREM_blur_19` `renderPipeline_PMREM_blur_19` |
| cosmic-noir | 18 | 6948 | `mipmap-rgba8unorm-2d-array` `renderPipeline_MeshStandardNodeMaterial_24` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_PointsNodeMaterial_18` |
| shifting-sands | 18 | 6824 | `renderPipeline_MeshBasicNodeMaterial_26` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicMaterial_25` `mipmap-rgba8unorm-2d-array` `renderPipeline_SpriteMaterial_21` |
| wolfhour | 18 | 6686 | `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_30` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_21` |
| chiral-gold | 17 | 7064 | `renderPipeline_outputColorTransform_28` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_MeshBasicNodeMaterial_22` `renderPipeline_PointsNodeMaterial_20` `renderPipeline_PointsNodeMaterial_16` |
| himalayan-peak | 14 | 6731 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_20` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_LineBasicNodeMaterial_19` `renderPipeline_MeshBasicNodeMaterial_17` |
| starlight | 14 | 6849 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_19` |
| ice-temple | 13 | 6680 | `mipmap-rgba8unorm-srgb-2d-array` `renderPipeline_PMREM_equirect_48` `renderPipeline_PMREM_ggx_47` `mipmap-rgba8unorm-2d-array` `mipmap-rgba16float-2d-array` |
| electric-dreams-v3 | 11 | 6840 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_Bloom_highPass_19` `renderPipeline_Bloom_separable_20` |
| tornado | 11 | 6721 | `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_18` `renderPipeline_Bloom_highPass_20` `renderPipeline_Bloom_separable_21` |
| fluid-dreams | 10 | 8579 | `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_RTT_21` `renderPipeline_Bloom_highPass_22` `renderPipeline_Bloom_separable_23` `renderPipeline_Bloom_separable_24` |
| koi-pond | 10 | 8034 | `renderPipeline_MeshStandardNodeMaterial_35` `renderPipeline_MeshStandardNodeMaterial_35` `renderPipeline_Bloom_highPass_62` `renderPipeline_Bloom_separable_63` `renderPipeline_Bloom_separable_64` |
| stellar-drift | 10 | 6849 | `mipmap-rgba8unorm-srgb-2d-array` `mipmap-rgba8unorm-2d-array` `renderPipeline_Bloom_highPass_56` `renderPipeline_Bloom_separable_57` `renderPipeline_Bloom_separable_58` |
| black-hole | 9 | 7121 | `renderPipeline_Bloom_highPass_29` `renderPipeline_Bloom_separable_30` `renderPipeline_Bloom_separable_31` `renderPipeline_Bloom_separable_32` `renderPipeline_Bloom_separable_33` |
| void-ember | 7 | 6577 | `void-ember/scene-pipeline` `void-ember/particle-pipeline` `void-ember/post-pipeline` `void-ember/present-pipeline` `void-ember/bloom-prefilter-pipeline` |
| verdant-hills | 6 | 6583 | `renderPipeline_MeshLambertNodeMaterial_35` `renderPipeline_MeshBasicNodeMaterial_17` `renderPipeline_MeshBasicNodeMaterial_18` `renderPipeline_MeshBasicNodeMaterial_16` `renderPipeline_PointsNodeMaterial_217` |
| moonlit-forest | 1 | 7242 | `renderPipeline_outputColorTransform_42` |

## Drift between the two visits (bounds how much of a delta is noise)

| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |
|---|---:|---:|:--:|---|
| aether-tides | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| astral-weave | 0.262 | 0.00 | ✓ | — |
| aurora | — | — | ✗ | draw calls unavailable in one visit |
| bioluminescence-2 | <0.065536 | 0.10 | ✓ | — |
| bioluminescence | — | — | ✗ | draw calls differ (v1=188, v2=137) |
| black-hole | <0.065536 | 0.00 | ✓ | — |
| blood-moon | — | — | ✗ | draw calls differ (v1=43, v2=28) |
| chiral-gold | <0.065536 | 0.30 | ✓ | — |
| chromadelic-highway | — | — | ✗ | draw calls differ (v1=69, v2=68) |
| chromatic-impasto | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cinder-drift | — | — | ✗ | draw calls unavailable in one visit |
| cosmic-chimes | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| cosmic-noir | <0.065536 | 0.00 | ✓ | — |
| crystal-cave | — | — | ✗ | draw calls differ (v1=339, v2=299) |
| electric-dreams-v3 | <0.065536 | 0.10 | ✓ | — |
| fall | — | — | ✗ | draw calls differ (v1=22, v2=7) |
| fluid-dreams | 0.066 | 0.10 | ✓ | — |
| forest | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| galaxy | — | — | ✗ | draw calls unavailable in one visit |
| geode | — | — | ✗ | draw calls differ (v1=189, v2=163) |
| golden-forest | — | — | ✗ | draw calls differ (v1=330, v2=328) |
| halcyon-apex | <0.065536 | 0.00 | ✓ | — |
| himalayan-peak | 0.196 | 0.00 | ✓ | — |
| ice-temple | — | — | ✗ | draw calls differ (v1=112, v2=113) |
| koi-pond | <0.065536 | 0.10 | ✓ | — |
| luminous-tides | — | — | ✗ | draw calls differ (v1=28, v2=13) |
| lunara | <0.065536 | 0.10 | ✓ | — |
| misty-lake | — | — | ✗ | draw calls differ (v1=67, v2=52) |
| moonlit-forest | <0.065536 | 0.00 | ✓ | — |
| moonlit-greenhouse | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| moonrise-summit | — | — | ✗ | draw calls unavailable in one visit |
| mountain | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| nebula-flow | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| neon-district | — | — | ✗ | draw calls differ (v1=417, v2=406) |
| neon-dusk | 0.196 | 0.00 | ✓ | — |
| nimbus-veil | — | — | ✗ | draw calls differ (v1=31, v2=16) |
| ocean | — | — | ✗ | draw calls differ (v1=196, v2=197) |
| pyrestorm | — | — | ✗ | draw calls differ (v1=54, v2=38) |
| rainy-window | — | — | ✗ | draw calls differ (v1=11, v2=4) |
| sakura-twilight | — | — | ✗ | draw calls unavailable in one visit |
| serenity-warp | <0.065536 | 0.00 | ✓ | — |
| shifting-sands | <0.065536 | 0.00 | ✓ | — |
| singing-bowl | — | — | ✗ | draw calls differ (v1=34, v2=20) |
| sky-children | — | — | ✗ | draw calls differ (v1=73, v2=75) |
| solar-eclipse | — | — | ✗ | draw calls differ (v1=67, v2=51) |
| starlight | 0.131 | 0.00 | ✓ | — |
| stellar-drift | <0.065536 | 0.00 | ✓ | — |
| stellar-velocity | <0.065536 | 0.00 | ✓ | — |
| stillwater | — | 0.00 | ✓ | — |
| summer | 0.131 | 0.10 | ✓ | — |
| sunset | — | — | ✗ | draw calls differ (v1=32, v2=6) |
| supernova | — | — | ✗ | draw calls unavailable in one visit |
| synthwave-sunset | <0.065536 | 0.00 | ✓ | — |
| tornado | 0.589 | 0.10 | ✓ | — |
| verdant-hills | — | — | ✗ | draw calls differ (v1=83, v2=86) |
| vesper-chrysalis | <0.065536 | 0.10 | ✓ | — |
| void-ember | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| voltage-storm | — | — | ✗ | theme owns no three renderer — nothing to content-match |
| waves | — | — | ✗ | draw calls differ (v1=17, v2=2) |
| winter | <0.065536 | 0.00 | ✓ | — |
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
