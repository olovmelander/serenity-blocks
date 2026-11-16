"""Author Waves' sea life (Blender, headless).

    blender --background --factory-startup --python scripts/blender/waves_sea_life_assets.py -- \
        [--out src/themes/waves/assets/sea-life.glb] [--only bottlenose,spinner] [--review <dir>] [--no-pack]

Seven animals, each drawn from numbers as one signed distance field of smooth masses and fins
(scripts/blender/waves_sea_life/cast.py; the humpback, the manta and the turtle are the Ocean's
own designs), meshed, decimated and told what each vertex is by the Ocean's builder
(scripts/blender/ocean_creatures/build.py), and written together as one compact GLB that
src/themes/waves/waves-cast.js reads. Nothing is downloaded. `--review` writes one PNG sheet per
animal (side, top, under, three-quarter; side and top with each part false-coloured).

What a vertex carries (the Ocean pack's layout):

  POSITION   int16, the node's scale and translation restore units (KHR_mesh_quantization)
  NORMAL     int8
  _SHAPE     uint8 rgba: (along the body 0 nose .. 1 tail, (part * 3 + side + 1) / 255,
             how far out along the fin 0..1, kind / 255)
  _SKIN      uint8 rgba: (ambient occlusion, pattern mask a, pattern mask b, eye)
  _PIVOT     int16 rgba: (where the vertex's part turns from xyz, 0)
"""

import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from fall_grove.glb import GlbWriter, quantize_unit  # noqa: E402
from ocean_creatures import build as builder  # noqa: E402
from waves_sea_life.cast import CAST, FAMILIES  # noqa: E402

REPO = HERE.parent.parent


def log(message, started=[time.time()]):  # noqa: B006 - a deliberate process-wide clock
    print('[waves] %6.1fs  %s' % (time.time() - started[0], message), flush=True)


def write_pack(path, cast):
    writer = GlbWriter(generator='Serenity Blocks - Waves sea life (Blender, built from numbers)')
    names = list(CAST.keys())
    for name, (_obj, d) in cast.items():
        kind = names.index(name)
        n = len(d['P'])
        code = d['part'] * 3 + d['side'] + 1
        shape = np.stack([d['along'], code / 255.0, d['span'], np.full(n, kind / 255.0)], 1)
        skin = np.stack([d['ao'], d['m1'], d['m2'], d['eye']], 1)
        piv = np.concatenate([d['pivot'], np.zeros((n, 1))], 1)
        unit = d['N'] / np.maximum(np.linalg.norm(d['N'], axis=1, keepdims=True), 1e-9)
        meta = d['meta']
        P = d['P']
        writer.add_mesh(name, {
            'POSITION': (P, False),
            'NORMAL': (quantize_unit(unit, np.int8), True),
            '_SHAPE': (quantize_unit(np.clip(shape, 0, 1), np.uint8), True),
            '_SKIN': (quantize_unit(np.clip(skin, 0, 1), np.uint8), True),
            '_PIVOT': (quantize_unit(np.clip(piv, -1, 1), np.int16), True),
        }, indices=d['tris'], extras={
            'kind': kind, 'family': FAMILIES[meta['family']], 'nose': meta['nose'], 'tail': meta['tail'],
            'triangles': int(len(d['tris'])),
            'extent': [P.min(0).round(4).tolist(), P.max(0).round(4).tolist()],
        })
    writer.set_extras({
        'wavesSeaLife': 1,
        'kinds': names,
        'shape': 'r along the body (0 nose, 1 tail), g (part * 3 + side + 1) / 255 (parts: 0 body, 1 pectoral, '
                 '2 tail, 3 dorsal, 4 head, 5 rear, 6 eye), b how far out along its fin, a kind / 255',
        'skin': 'r ambient occlusion, g pattern a, b pattern b, a eye',
        'pivot': 'xyz where the part turns from (units), w 0',
    })
    size = writer.write(str(path))
    log(f'wrote {path} ({size} bytes)')
    return size


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
    out = None if args.get('no-pack') else Path(args.get('out', REPO / 'src/themes/waves/assets/sea-life.glb'))
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
    only = set(str(args['only']).split(',')) if 'only' in args else None
    review = Path(args['review']) if 'review' in args else None
    if review is not None:
        review.mkdir(parents=True, exist_ok=True)
    builder._clear()
    cast = {}
    for name in CAST:
        if only and name not in only:
            continue
        cast[name] = builder.mesh_kind(name, log=log, cast=CAST)
    if out is not None:
        write_pack(out, cast)
    if review is not None:
        builder.review(cast, review, log=log)
    log('done')


main()
