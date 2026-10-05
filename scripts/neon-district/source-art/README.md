# Neon District source art

The shopfront paintings and billboard adverts the Neon District theme shows. They are not
shipped as they are: `scripts/neon-district/build-atlases.mjs` packs them into two WebP atlases
under `public/textures/neon-district/` and writes the cell table
`src/themes/neon-district/neon-district-atlas.js`.

```sh
node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs
```

The bake is deterministic: the same sources give byte-identical atlases.

| Files | In the atlas |
| --- | --- |
| `storefront_02.jpg` to `storefront_18.jpg` | All seventeen, in `shopfronts.webp` |
| `ads_large_07.jpg` to `ads_large_13.jpg`, `ads_large_15.jpg` to `ads_large_18.jpg` | All eleven, in `billboards.webp` |
| `ads_large_06.jpg` | No: the picture carries a company name from a film |
| `ads_large_14.jpg` | No: a photographic portrait |

These images were added to the repository by the project owner in December 2025 (they used to
sit in `public/textures/synthcity/` beside the SynthCity texture set, which the rebuilt theme no
longer uses and which has been removed). To add a piece, drop it here, add it to the cell lists
at the top of the bake script and run the bake.
