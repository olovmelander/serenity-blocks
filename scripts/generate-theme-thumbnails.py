#!/usr/bin/env python3

from pathlib import Path
import sys

try:
    from PIL import Image
except ImportError:
    print('[theme-thumbnails] Pillow is not installed; skipping packaged thumbnail generation.')
    sys.exit(0)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / 'src' / 'themes'
OUTPUT_DIR = ROOT / 'public' / 'assets' / 'theme-thumbnails'
TARGET_SIZE = (192, 192)


def iter_theme_icons():
    return sorted(SOURCE_DIR.glob('**/*-theme-icon.png'))


def ensure_thumbnail(source_path: Path) -> bool:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / source_path.name

    if output_path.exists() and output_path.stat().st_mtime >= source_path.stat().st_mtime:
        return False

    with Image.open(source_path).convert('RGBA') as image:
        if image.size != TARGET_SIZE:
            image = image.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        image.save(output_path, format='PNG', optimize=True)

    return True


def main():
    generated = 0
    skipped = 0

    for source_path in iter_theme_icons():
        if ensure_thumbnail(source_path):
            generated += 1
        else:
            skipped += 1

    print(
        f'[theme-thumbnails] Ready: generated {generated}, skipped {skipped}, output={OUTPUT_DIR.relative_to(ROOT)}'
    )


if __name__ == '__main__':
    main()
