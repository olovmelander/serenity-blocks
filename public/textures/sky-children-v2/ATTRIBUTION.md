# Sky Children V2 — texture attribution

All textures in this folder are from **[Poly Haven](https://polyhaven.com)** and are
licensed **CC0 1.0 (Public Domain)** — no attribution required, free for any use.
They are credited here as good practice.

These are used **luminance-only** as low-frequency painterly "tooth" / detail
multipliers inside the theme's hand-rolled unlit TSL materials — the source colour,
normal, and roughness maps are intentionally discarded (see `../../../src/themes/sky-children-v2/rendering/detail-texture.js`).
Only the 1k JPG **diffuse** map of each asset is shipped.

| file | Poly Haven asset | used for |
| --- | --- | --- |
| `leafy_grass_diff_1k.jpg` | [leafy_grass](https://polyhaven.com/a/leafy_grass) | meadow ground grain (valley terrain) |
| `dirt_diff_1k.jpg` | [dirt](https://polyhaven.com/a/dirt) | low-frequency soil variation (valley terrain) |
| `gray_rocks_diff_1k.jpg` | [gray_rocks](https://polyhaven.com/a/gray_rocks) | far-range massif micro-relief (mountains) |
| `cliff_side_diff_1k.jpg` | [cliff_side](https://polyhaven.com/a/cliff_side) | alternate rock tooth |
| `rock_05_diff_1k.jpg` | [rock_05](https://polyhaven.com/a/rock_05) | cliff-skirt tooth |
