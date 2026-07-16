# Desktop / application icons & brand mark

The single source of truth for the Serenity Blocks brand mark is
[`../public/favicon.svg`](../public/favicon.svg) — one continuous S-shaped wave on the
cyan→purple circle. Use **the same mark everywhere**: the executable, installer,
taskbar, shortcut, Steam capsule/library art, website, and social avatar.

## The packaged Windows icon is separate from the favicon

`package.json` (`build.win.icon`, `installerIcon`, `uninstallerIcon`,
`installerHeaderIcon`) points electron-builder at **`build/icon.ico`**. The `build/`
directory is **gitignored**, so `icon.ico` is a build artifact — generated locally or in
CI, never committed. Regenerate it from `favicon.svg` whenever the mark changes; the
browser favicon change alone does **not** update the packaged Windows/Store icon.

## Regenerate `build/icon.ico` (+ a PNG master)

Requires an SVG rasterizer and an ICO packer (e.g. `librsvg` + ImageMagick). Run from the
repo root:

```sh
mkdir -p build

# 1. Rasterize the SVG to the sizes Windows uses.
for s in 16 24 32 48 64 128 256; do
  rsvg-convert -w "$s" -h "$s" public/favicon.svg -o "build/icon-$s.png"
done

# 2. Pack them into a single multi-resolution .ico.
magick build/icon-16.png build/icon-24.png build/icon-32.png build/icon-48.png \
       build/icon-64.png build/icon-128.png build/icon-256.png build/icon.ico

# 3. High-res PNG master for the store and promotional exports.
rsvg-convert -w 1024 -h 1024 public/favicon.svg -o build/icon-master-1024.png

# 4. (Optional) clean up the intermediate PNGs.
rm build/icon-{16,24,32,48,64,128,256}.png
```

macOS `.icns` and the Linux `.png` set can be produced from the same 1024px master.

## Brand-safety guardrails

When authoring or replacing any icon/mark, avoid:

- four equal squares in a conventional piece shape,
- seven equal block units,
- a 10×20 frame,
- falling or stacking animation,
- the familiar piece-specific color mapping.

## Not yet verified (needs a real build/run — cannot be checked from source)

- Favicon legibility at **16×16** and **32×32**.
- The Single Player menu icon's **idle / hover / gamepad-focused** states.
- A **packaged** desktop shortcut / taskbar icon rendered from `build/icon.ico`.
