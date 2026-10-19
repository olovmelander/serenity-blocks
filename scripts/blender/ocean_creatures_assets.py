"""Author Ocean's large animals (Blender 4.5 LTS, headless).

    blender --background --factory-startup --python scripts/blender/ocean_creatures_assets.py -- \
        [--out src/themes/ocean/assets/creatures.glb] [--only humpback,manta] [--review <dir>] [--no-pack]

Nine animals, each drawn from numbers as one signed distance field of smooth masses and fins
(scripts/blender/ocean_creatures/cast.py), meshed, decimated and told what each vertex is
(scripts/blender/ocean_creatures/build.py), written together as one compact GLB that
src/themes/ocean/ocean-creatures.js reads: a humpback (and its calf), a blue whale, bottlenose
dolphins, a whale shark, scalloped hammerheads, an oceanic manta, spotted eagle rays, a green
turtle and an ocean sunfish. Nothing is downloaded. `--review` writes one PNG sheet per animal
(side, top, under, three-quarter; side and top with each part false-coloured).
"""

import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from ocean_creatures import build as creatures  # noqa: E402

REPO = HERE.parent.parent


def log(message, started=[time.time()]):  # noqa: B006 - a deliberate process-wide clock
    print('[ocean] %6.1fs  %s' % (time.time() - started[0], message), flush=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith('--'):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
                args[key] = argv[i + 1]
                i += 2
                continue
            args[key] = True
        i += 1
    out = None if args.get('no-pack') else Path(args.get('out', REPO / 'src/themes/ocean/assets/creatures.glb'))
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
    only = set(str(args['only']).split(',')) if 'only' in args else None
    review = Path(args['review']) if 'review' in args else None
    if review is not None:
        review.mkdir(parents=True, exist_ok=True)
    creatures.build(out, only=only, review_dir=review, log=log)
    log('done')


main()
