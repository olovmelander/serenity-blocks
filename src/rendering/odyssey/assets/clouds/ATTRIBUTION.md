# Odyssey cloud asset attribution

All three files are generated, not captured. No photograph, scan, third-party model, simulation cache or texture is
involved, so there is nothing to attribute. They hold data, never colour: the game lights every cloud itself.

- `clouds.dat` (gzip): 18 clouds sculpted as distance fields (`scripts/blender/odyssey/clouds/sculpt.py`), the light inside
  each, solved offline (`light.py`), and a tiling billow noise (`odyssey_clouds.py`), packed by `pack.py`. Its index is
  `world/odyssey-cloud-volumes.js`.
- `high.png` (1024 x 1024 RGBA): cirrus, altocumulus, a veil and a patch noise (`clouds/high.py`).
- `sea.png` (512 x 512 RGBA): the sea of clouds' heights, sun, sky and firmness (`clouds/sea.py`).

Rebuild (pure Python inside Blender; the same seeds give the same files):

    blender -b --factory-startup -P scripts/blender/odyssey/odyssey_clouds.py -- volumes high sea
