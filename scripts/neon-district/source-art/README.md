# Neon District source art

The shopfront paintings and user billboard adverts the Neon District theme shows. They are not
shipped as they are: `scripts/neon-district/build-atlases.mjs` packs them into two WebP atlases
under `public/textures/neon-district/` and writes the cell table
`src/themes/neon-district/neon-district-atlas.js`.

```sh
node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs
```

The bake is deterministic: the same sources give byte-identical atlases. It runs Electron with
hardware acceleration off (canvas 2D only, no GPU).

| Files | In the atlas |
| --- | --- |
| `storefront_03.jpg` to `storefront_18.jpg` | All sixteen, in `shopfronts.webp` |
| `storefront_02.jpg` | No: its sign shows another game's characters |
| `ads_large_07.jpg` to `ads_large_13.jpg`, `ads_large_15.jpg` to `ads_large_17.jpg` | All ten, in `billboards.webp` (the campaign atlas) |
| `ads_large_06.jpg` | No: the picture carries a company name from a film |
| `ads_large_14.jpg` | No: a photographic portrait |
| `ads_large_18.jpg` | No: it is signed with a film company's name and mark |

These images were added to the repository by the project owner in December 2025 (they used to
sit in `public/textures/synthcity/` beside the SynthCity texture set, which the rebuilt theme no
longer uses and which has been removed). To add a piece, drop it here, add it to the cell lists
at the top of the bake script and run the bake.

## The generated campaigns

The rest of `billboards.webp` (4096 × 2048, with a 2048 × 1024 half) is painted by the bake on a
2D canvas, from the campaign list in `src/themes/neon-district/neon-district-campaigns.js`:

- **District brands**: one 16:9 billboard and one 2:3 poster per brand, each with the brand's
  mark, its two colours, its name and slogan.
- **Hale**: a billboard and a poster that leave an empty, dark ring area (`ring` in the cell
  table) for the theme's shader to breathe in.
- **Serenity Transit**: eight 2:3 world posters framed around the game's own renders of those
  worlds (captures under `docs/`), and three 16:9 mode posters made from the menu's key art
  (`public/assets/menu-art/`), cropped clear of the board and its panels. The crops, names and
  straplines are listed in the bake script (`TRANSIT_WORLDS`, `TRANSIT_MODES`).

Type is the game's own (`public/fonts/`, all OFL): Unbounded, Orbitron, Manrope and Space Mono.
No real company, product, film or game is named or drawn, and no mark is built from four
squares or any other piece shape.
