"""Author Stillwater's two figures (Blender 4.5 LTS, headless).

    blender --background --factory-startup --python scripts/blender/stillwater_assets.py -- \
        --out src/themes/stillwater/assets [--only troll,spirit] [--source <troll.glb>] [--preview <dir>]

* troll-lod0..3.glb: the theme's own troll (assets/troll.glb, the author's sculpt reconstructed
  with TRELLIS.2) rebuilt into a body that can be posed: the shard pelt thickened and voxel-
  remeshed into one solid surface, masks carried over from its paint, skin, bare hide, pelt and loincloth
  told apart by place and thinness, four LODs, a 21-bone skeleton, baked occlusion (scripts/blender/stillwater/troll.py);
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
    source = Path(args.get('source', REPO / 'src/themes/stillwater/assets/troll.glb'))
    preview = Path(args['preview']) if 'preview' in args else None
    if preview is not None:
        preview.mkdir(parents=True, exist_ok=True)
    if 'troll' in only:
        troll_figure.build(source, out, log=log, preview_dir=preview)
    if 'spirit' in only:
        spirit_figure.build(out, log=log)
    log('done')


main()
