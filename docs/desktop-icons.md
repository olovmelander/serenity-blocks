# Desktop / application icons & brand mark

The Serenity Blocks app mark is the logo's own symbol: the **O of BLOCKS with its separated
coral corner**, in the lavender → aqua → mint spectrum, on a night tile with a hairline rim.
Use **the same mark everywhere**: the executable, installer, taskbar, shortcut, browser tab,
Steam capsule/library art, website and social avatar. (Until 2026-10-25 the favicon was a white
S-wave on a cyan → purple disc and the Windows icon was the Forest theme picture.)

## Where it lives

All three files are generated from one module,
[`scripts/app-icon/app-mark.mjs`](../scripts/app-icon/app-mark.mjs), and committed:

| File | What it is | Read by |
| --- | --- | --- |
| [`public/favicon.svg`](../public/favicon.svg) | The 16 px cut on a 16-unit grid (crisp in a tab at 1x and 2x) | `index.html` |
| [`public/assets/branding/serenity-blocks.ico`](../public/assets/branding/serenity-blocks.ico) | 16, 20, 24, 32, 40, 48, 64, 128 and 256 px | `scripts/build-win.mjs` → `build/icon.ico` |
| [`public/assets/branding/serenity-blocks-app-icon.svg`](../public/assets/branding/serenity-blocks-app-icon.svg) | The 256 px master | Store, promo and social art |

`package.json` (`build.win.icon`, `installerIcon`, `uninstallerIcon`, `installerHeaderIcon`)
points electron-builder at `build/icon.ico`. `build/` is gitignored: `build-win.mjs` copies the
committed `.ico` there on every Windows build. `SERENITY_WINDOWS_ICON_SOURCE=<file.png>` still
overrides it with a single PNG.

## How it is drawn

- **40 px and up** use the logo's exact O outline and tile, 64 % of the tile tall, with a faint
  aqua glow rising from the bottom from 48 px up (the loading screen's light).
- **16, 20, 24 and 32 px** are drawn on the pixel grid instead (`APP_MARK_CUTS`): a scaled
  outline smears the corner gaps into the stroke and reads as a "G" or "Ü". The cuts keep every
  edge on a whole pixel, a gap of at least one pixel each side of the tile, and a slightly larger
  tile than the logo's so the coral survives. 24 px matters most: it is the Windows 11 taskbar at
  100 % scaling.
- The night tile keeps a cream hairline rim at 13 % so it holds its edge on a dark taskbar.

## Regenerate after a change

```sh
node scripts/generate-app-icon.mjs
```

It writes the three files, drawing each `.ico` size in Electron's Chromium (no image library
needed). `tests/unit/app-icon.test.js` fails if the committed files drift from the module, if the
`.ico` loses a size, or if a cut leaves the pixel grid or closes a gap.

macOS `.icns` and a Linux PNG set are not configured yet; draw them from the master.

## Brand-safety guardrails

When authoring or replacing any icon/mark, avoid:

- four equal squares in a conventional piece shape,
- seven equal block units,
- a 10×20 frame,
- falling or stacking animation,
- the familiar piece-specific color mapping.

## Verified (2026-10-25)

- Every `.ico` size and the favicon on a Windows dark and light taskbar and on Chrome dark and
  light tabs, and magnified, from the PNGs inside the committed `.ico`.

## Not yet verified (needs a real build/run)

- A **packaged** desktop shortcut and taskbar icon from `build/icon.ico`, at 100 % and 150 %
  display scaling.
- The Single Player menu icon's **idle / hover / gamepad-focused** states.
