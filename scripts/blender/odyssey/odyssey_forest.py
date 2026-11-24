"""
Odyssey's forest, grown and photographed in Blender (2026-11-24).

    blender -b --factory-startup -P scripts/blender/odyssey/odyssey_forest.py -- [models] [leaves] [far]

  models   grow every specimen, write src/rendering/odyssey/world/odyssey-forest-models.js
  leaves   photograph the sprays, write src/rendering/odyssey/assets/forest/leaves.png
  far      photograph every specimen from 16 sides, write src/rendering/odyssey/assets/forest/far.png
           (slow: about half a minute a specimen)

With no step named, all three. The steps' notes for the game (the alpha cut a mip, the far frames) are
kept in forest/bake-info.json, so `models` can be rerun alone. The package beside this file is the tool:
growth (wood), sprays (leaves), families (which spray a species wears), trees (the specimens), bake (the
photographs), export (the game's file), preview (beauty renders). It was written and judged through the
Blender MCP; this entry point reruns it headless.
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'forest'))
sys.dont_write_bytecode = True

import bake  # noqa: E402
import export  # noqa: E402
import trees  # noqa: E402

ASSETS = os.path.join(ROOT, 'src', 'rendering', 'odyssey', 'assets', 'forest')
MODELS = os.path.join(ROOT, 'src', 'rendering', 'odyssey', 'world', 'odyssey-forest-models.js')
INFO = os.path.join(HERE, 'forest', 'bake-info.json')


def main(argv):
    steps = [a for a in argv if a in ('models', 'leaves', 'far')] or ['leaves', 'far', 'models']
    os.makedirs(ASSETS, exist_ok=True)
    info = json.load(open(INFO, encoding='utf-8')) if os.path.exists(INFO) else {}
    t0 = time.time()
    roster = trees.build_all()
    if 'leaves' in steps:
        r = bake.bake_leaf_atlas(os.path.join(ASSETS, 'leaves.png'))
        info['leaves'] = {'curve': r['curve'], 'tiles': r['tiles']}
        print('leaves', r['curve'], round(time.time() - t0))
    if 'far' in steps:
        r = bake.bake_far_atlas([t for t in roster if t.name not in NOT_FAR], os.path.join(ASSETS, 'far.png'))
        info['far'] = r
        print('far', r['curve'], round(time.time() - t0))
    with open(INFO, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(info, fh, indent=1)
        fh.write('\n')
    if 'models' in steps:
        r = export.export(roster, MODELS, info.get('leaves'), info.get('far'))
        print('models', json.dumps(r), round(time.time() - t0))


# The skirt is never drawn at the far tier (a bush a kilometre off is under two pixels).
NOT_FAR = {'hazel', 'hawthorn', 'thicket', 'juniper', 'dwarf-pine-b', 'snag-stub', 'fern-a', 'fern-b', 'fern-drift', 'bracken-a',
           'bracken-drift', 'log-mossy', 'log-short', 'stump-mossy'}

if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
