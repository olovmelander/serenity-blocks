"""Author Stillwater's two figures (Blender 4.5 LTS, headless).

    blender --background --factory-startup --python scripts/blender/stillwater_assets.py -- \
        --out src/themes/stillwater/assets [--only troll,spirit] [--preview <dir>] [--voxel 0.003]

* troll-lod0..3.glb: the theme's own troll, drawn clean from numbers in the character of the
  author's sculpt (assets/troll.glb): one signed distance field of smooth masses under a mane of
  matted moss locks (scripts/blender/stillwater/troll_shape.py), meshed once, four LODs, a 21-bone
  skeleton, every vertex told what it is, baked occlusion (scripts/blender/stillwater/troll.py);
* spirit-lod0..1.glb: the spirit, built from numbers (scripts/blender/stillwater/spirit.py).

Both are written in the compact layout src/themes/stillwater/stillwater-rig.js reads
(scripts/blender/stillwater/figure_glb.py): no clips, the skeleton in the scene's extras; every
pose is made at run time (stillwater-troll-body.js, stillwater-spirit-body.js). Nothing is
downloaded.
"""

import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from stillwater import spirit as spirit_figure  # noqa: E402
from stillwater import troll as troll_figure  # noqa: E402

REPO = HERE.parent.parent


def log(message, started=[time.time()]):  # noqa: B006 - a deliberate process-wide clock
    print('[stillwater] %6.1fs  %s' % (time.time() - started[0], message), flush=True)


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
    out = Path(args.get('out', REPO / 'src/themes/stillwater/assets'))
    out.mkdir(parents=True, exist_ok=True)
    only = set(str(args.get('only', 'troll,spirit')).split(','))
    preview = Path(args['preview']) if 'preview' in args else None
    if preview is not None:
        preview.mkdir(parents=True, exist_ok=True)
    if 'troll' in only:
        troll_figure.build(out, log=log, preview_dir=preview, voxel=float(args.get('voxel', 0.003)))
    if 'spirit' in only:
        spirit_figure.build(out, log=log)
    log('done')


main()
