# Neon District source art

The shopfront paintings and user billboard adverts the Neon District theme shows. They are not
shipped as they are: `scripts/neon-district/build-atlases.mjs` packs them into two WebP atlases
under `public/textures/neon-district/` and writes the cell table
`src/themes/neon-district/neon-district-atlas.js`.

```sh
node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs
# or, to try a change without touching the shipped files:
node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs --out=<dir>
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

The rest of `billboards.webp` (4096 × 3584, with a 2048 × 1792 half) is painted by the bake on a
2D canvas, from the campaign list in `src/themes/neon-district/neon-district-campaigns.js`:

- **District brands**: one 16:9 billboard and two 2:3 posters per brand, each with the brand's
  mark, its two colours, its name and slogan. The second poster (`brand-<id>-portrait-2`) is the
  same campaign in another design: a product close-up (Cascade), a comic strip (Combo), type
  alone (Stack), a parcel label (Drop), a price tag (Level), the roof sign (Next), an eye chart
  (Clear), a wall of washer doors (Spin).
- **Hale**: a billboard and a poster that leave an empty, dark ring area (`ring` in the cell
  table) for the theme's shader to breathe in.
- **Serenity Transit**: 34 world posters (2:3) and three mode posters (16:9). Each world poster
  is built round the game's own render of that world (captures under `docs/`), and takes its
  colours from it (a dominant and an accent hue sampled from the picture). They come in seven
  designs, as if by seven designers on one line — `vintage` (a framed print), `side` (full bleed,
  the name up the side), `swiss` (a colour field, an offset square picture, a big line number),
  `deco` (an arched window over sunburst rays), `duotone` (the picture posterised onto two inks,
  the name knocked out of a block), `ticket` (a boarding pass with a split-flap destination) and
  `porthole` (round glass in a brass ring, the line's name set round it) — used about equally and
  never twice in a row (the bake checks this). Every one carries the line's roundel. The three
  mode posters (from the menu's key art in `public/assets/menu-art/`, cropped clear of the board
  and its panels) each have their own design too. The pictures, regions, focus points, names,
  straplines and designs are listed in the bake script (`TRANSIT_WORLDS`, `TRANSIT_MODES`).

Type is the game's own (`public/fonts/`, all OFL): Unbounded, Orbitron, Manrope and Space Mono.
No real company, product, film or game is named or drawn, and no mark is built from four
squares or any other piece shape.
