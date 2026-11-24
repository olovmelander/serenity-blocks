"""
Odyssey's clouds, sculpted as volumes (2026-11-24).

    blender -b --factory-startup -P scripts/blender/odyssey/odyssey_clouds.py -- [volumes] [high] [sea]

writes src/rendering/odyssey/assets/clouds/clouds.dat (gzip) and world/odyssey-cloud-volumes.js, its index:

  shapes   every cloud as a distance field, SDF_N cells, 8 bit, stacked along y into one 3D atlas
  light    two RGBA grids a shape, LIGHT_N cells: the sun's light for four turns; the sky's, the ground's
           and the body (light.py)
and assets/clouds/high.png, the high sky's sheets (clouds/high.py), and sea.png, the sea of clouds (clouds/sea.py).

  billow   the tiling noise that carves and boils their skins: R, G, B billows at 4, 8 and 16 cells, A a
           soft turbulence
"""

import gzip
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'clouds'))
sys.dont_write_bytecode = True

import numpy as np  # noqa: E402

import high  # noqa: E402
import light  # noqa: E402
import sculpt  # noqa: E402
import sea  # noqa: E402
from field import Lattice, fbm, resample, worley_tile  # noqa: E402

OUT = os.environ.get('ODYSSEY_CLOUDS_OUT', os.path.join(ROOT, 'src', 'rendering', 'odyssey', 'assets', 'clouds', 'clouds.dat'))
INDEX = os.environ.get('ODYSSEY_CLOUDS_INDEX', os.path.join(ROOT, 'src', 'rendering', 'odyssey', 'world', 'odyssey-cloud-volumes.js'))
SDF_N = (96, 64, 96)
LIGHT_N = (40, 26, 40)
NOISE_N = 64


def billow_noise():
    out = np.zeros((NOISE_N,) * 3 + (4,), np.float32)
    for c, cells in enumerate((4, 8, 16)):
        w = 1 - np.clip(worley_tile(NOISE_N, cells, 101 + c) / 0.95, 0, 1)
        lo, hi = np.percentile(w, [1, 99])
        out[..., c] = np.clip((w - lo) / (hi - lo), 0, 1)
    # A soft tiling turbulence (value noise on a lattice that wraps with the tile).
    g = (np.arange(NOISE_N) + 0.5) / NOISE_N
    X, Y, Z = np.meshgrid(g, g, g, indexing='ij')
    acc, amp, tot = 0.0, 1.0, 0.0
    for o, n in enumerate((4, 8, 16)):
        acc = acc + amp * Lattice(201 + o, n)(X * n, Y * n, Z * n)
        tot += amp
        amp *= 0.5
    t = acc / tot
    lo, hi = np.percentile(t, [1, 99])
    out[..., 3] = np.clip((t - lo) / (hi - lo), 0, 1)
    return out


def save_rgba(path, a, levels=64):
    """An RGBA PNG whose alpha is a channel like any other."""
    import struct
    import zlib
    a8 = np.rint(np.rint(np.clip(a, 0, 1) * (levels - 1)) / (levels - 1) * 255).astype(np.uint8)
    h, w, c = a8.shape
    rows = a8.reshape(h, w * c)
    left = np.concatenate([np.zeros((h, c), np.uint8), rows[:, :-c]], 1)
    raw = np.concatenate([np.full((h, 1), 1, np.uint8), rows - left], 1).tobytes()

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def one(args):
    name, s = args
    d = s.sdf()
    return d, light.solve(d, s.box, LIGHT_N)


def main(argv):
    steps = [a for a in argv if a in ('volumes', 'high', 'sea')] or ['volumes', 'high', 'sea']
    t0 = time.time()
    if 'high' in steps:
        path = os.path.join(os.path.dirname(OUT), 'high.png')
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        save_rgba(path, high.build())
        print('wrote', path, os.path.getsize(path) // 1024, 'KB', '%.0fs' % (time.time() - t0))
    if 'sea' in steps:
        path = os.path.join(os.path.dirname(OUT), 'sea.png')
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        save_rgba(path, sea.build(), levels=256)
        print('wrote', path, os.path.getsize(path) // 1024, 'KB', '%.0fs' % (time.time() - t0))
    if 'volumes' in steps:
        volumes(t0)


def volumes(t0):
    shapes = sculpt.build_all(None)
    sdf = np.zeros((SDF_N[2], SDF_N[1] * len(shapes), SDF_N[0]), np.uint8)
    lit = np.zeros((2, LIGHT_N[2], LIGHT_N[1] * len(shapes), LIGHT_N[0], 4), np.uint8)
    meta = []
    # Each shape on its own thread (numpy lets go of the interpreter while it works).
    with ThreadPoolExecutor(8) as pool:
        done = list(pool.map(one, shapes))
    for i, (name, s) in enumerate(shapes):
        d, (suns, sky, ground, body) = done[i]
        f = resample(d, SDF_N)
        u8 = np.clip(np.rint((f / sculpt.REACH * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
        # The file is z, y, x (a 3D texture's own order).
        sdf[:, i * SDF_N[1]:(i + 1) * SDF_N[1], :] = u8.transpose(2, 1, 0)
        for q in range(4):
            lit[0, :, i * LIGHT_N[1]:(i + 1) * LIGHT_N[1], :, q] = np.rint(suns[q] * 255).astype(np.uint8).transpose(2, 1, 0)
        for c, v in enumerate((sky, ground, body)):
            lit[1, :, i * LIGHT_N[1]:(i + 1) * LIGHT_N[1], :, c] = np.rint(np.clip(v, 0, 1) * 255).astype(np.uint8).transpose(2, 1, 0)
        solid = f < 0
        where = np.argwhere(solid)
        lo = where.min(0) / np.array(SDF_N)
        hi = (where.max(0) + 1) / np.array(SDF_N)
        meta.append({'id': name, 'kind': s.kind, 'box': [round(float(b), 4) for b in s.box],
                     'lo': [round(float(v), 4) for v in lo], 'hi': [round(float(v), 4) for v in hi], 'fill': round(float(solid.mean()), 4)})
        print('cloud', name, 'fill %.3f' % solid.mean(), 'lo', np.round(lo, 2), 'hi', np.round(hi, 2), 'sun %.2f..%.2f' % (suns[0].min(), suns[0].max()),
              '%.0fs' % (time.time() - t0))
    noise = np.rint(billow_noise() * 255).astype(np.uint8)
    parts = [('sdf', sdf), ('sun', lit[0]), ('air', lit[1]), ('billow', noise)]
    blob = b''.join(p.tobytes() for _n, p in parts)
    at, spans = 0, {}
    for n, p in parts:
        spans[n] = [at, p.size]
        at += p.size
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # (mtime 0: the same clouds write the same bytes.)
    with open(OUT, 'wb') as fh:
        with gzip.GzipFile(fileobj=fh, mode='wb', compresslevel=9, mtime=0) as gz:
            gz.write(blob)
    head = {'version': 1, 'reach': sculpt.REACH, 'sdf': list(SDF_N), 'light': list(LIGHT_N), 'noise': NOISE_N, 'spans': spans,
            'bytes': len(blob), 'shapes': meta}
    text = ("/* eslint-disable */\n/**\n * Odyssey's cloud volumes: GENERATED by scripts/blender/odyssey/odyssey_clouds.py (do not edit by hand).\n"
            " * The index of assets/clouds/clouds.dat; world/odyssey-cloud-data.js reads it.\n */\nexport const ODYSSEY_CLOUD_VOLUMES = "
            + json.dumps(head, separators=(',', ':')).replace('{"id"', '\n{"id"') + ';\n')
    with open(INDEX, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB of', len(blob) // 1024, 'KB', '%.0fs' % (time.time() - t0))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
