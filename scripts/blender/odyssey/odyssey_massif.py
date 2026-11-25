"""
Odyssey's mountain, grown as a landform (2026-11-25).

    blender -b --factory-startup -P scripts/blender/odyssey/odyssey_massif.py -- [form] [preview] [pack]

  form      reads the island under the summit plate (scripts/odyssey-massif-export.mjs, run here), designs the
            massif from its ridges (massif/design.py), lets rain and frost work on it (massif/erode.py) inside
            what the rail and the meadows allow (massif/constrain.py), and keeps the result in a scratch file
  preview   pictures of the form before and after, from the views the game holds it in (massif/preview.py)
  pack      writes src/rendering/odyssey/world/odyssey-massif-form.js: the height the form adds over the
            island's ground, and where water gathers, decoded by world/odyssey-massif-form-decode.js

With no stage named, all three run. ODYSSEY_MASSIF_SCRATCH moves the scratch folder (default: the system's).
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'massif'))
sys.dont_write_bytecode = True

import numpy as np  # noqa: E402

from constrain import air_cap, foot_mask, rail_cap  # noqa: E402
from design import design  # noqa: E402
from erode import Rock, cliff_bands, crisp, flow_field, frost, limit_slope, rain  # noqa: E402
from terrain import Grid, blur, laplacian, smin, smoothstep  # noqa: E402

N = 400
SCRATCH = os.environ.get('ODYSSEY_MASSIF_SCRATCH', os.path.join(tempfile.gettempdir(), 'odyssey-massif'))
OUT = os.path.join(ROOT, 'src', 'rendering', 'odyssey', 'world', 'odyssey-massif-form.js')
# Delta quantum (u): heights are stored as integers of this.
QUANT = 1.0 / 16.0


def load_export():
    os.makedirs(SCRATCH, exist_ok=True)
    path = os.path.join(SCRATCH, 'export.bin')
    subprocess.run(['node', os.path.join(ROOT, 'scripts', 'odyssey-massif-export.mjs'), path, str(N)], check=True, cwd=ROOT)
    raw = open(path, 'rb').read()
    hl = int.from_bytes(raw[:4], 'little')
    head = json.loads(raw[4:4 + hl].decode('utf-8'))
    off = 4 + hl
    n = head['n']
    base = np.frombuffer(raw, np.float32, n * n, off).reshape(n, n).astype(np.float64)
    off += n * n * 4
    macro = np.frombuffer(raw, np.float32, n * n, off).reshape(n, n).astype(np.float64)
    off += n * n * 4
    old = np.frombuffer(raw, np.float32, n * n, off).reshape(n, n).astype(np.float64)
    off += n * n * 4
    rail = np.frombuffer(raw, np.float32, head['railRows'] * 4, off).reshape(-1, 4).astype(np.float64)
    off += head['railRows'] * 16
    air = np.frombuffer(raw, np.float32, head.get('airRows', 0) * 3, off).reshape(-1, 3).astype(np.float64)
    return head, base, macro, old, rail, air


def form():
    t0 = time.time()
    head, base, macro, old, rail, air = load_export()
    grid = Grid(head['n'], head['x0'], head['z0'], head['step'])
    hero = next(m for m in head['massifs'] if m['id'] == 'hero')
    apex = (hero['x'], hero['z'])
    foot = hero['footY']

    H, _ = design(grid, apex, foot, macro, relief=base - macro)
    M = foot_mask(grid, apex, base)
    cap = np.minimum(rail_cap(grid, rail), air_cap(grid, air))
    N0 = base * (1 - M) + H * M
    N0 = smin(N0, cap, 10.0)
    print(f'[massif] design {time.time() - t0:.1f}s  top {N0.max():.1f}', flush=True)

    rock = Rock(grid, apex)
    # more rain where the mountain is steepest and highest: by area alone the summit's faces, small, caught
    # few droplets and stayed smooth
    spawn = M * smoothstep(foot + 40, foot + 220, N0) * (1 + 2.5 * smoothstep(800.0, 960.0, N0)) + 1e-6
    t1 = time.time()
    E, flow, depo = rain(N0, grid, rock, spawn, drops=130000, max_cut=0.04)
    # ...then a finer rain: rills on the faces between the gullies
    E, flow2, depo2 = rain(E, grid, rock, spawn, drops=260000, seed=6, radius=1, max_cut=0.025, life=48)
    flow = flow + flow2 * 0.5
    depo = depo + depo2
    print(f'[massif] rain {time.time() - t1:.1f}s  carved {np.percentile(N0 - E, 99):.1f} u (p99)', flush=True)
    # The rain works the bare mountain; under the treeline the forest's ground keeps its design.
    wet = smoothstep(505.0, 590.0, N0)
    E = N0 + (E - N0) * wet
    stages = {'rained': E.copy()}
    E = frost(E, grid, rock, M, iters=16)
    stages['frosted'] = E.copy()
    E = cliff_bands(E, rock, M, grid)
    stages['banded'] = E.copy()
    E = crisp(E, M, grid, foot)
    stages['crisped'] = E.copy()
    # rock at the scale the plate can hold (two posts and up), on the steep ground only
    from terrain import Noise2, ridged as rdg
    gx, gz = np.gradient(E, grid.step)
    steep = smoothstep(0.7, 1.3, np.hypot(gx, gz)) * M * smoothstep(540, 640, E)
    E = E + (rdg(Noise2(31), grid.X / 16.0, grid.Z / 16.0, 3) - 0.55) * 7.0 * steep
    stages['rocked'] = E.copy()
    # no face past 70 degrees: the world's lattice carries no steeper (odyssey-world-height.test.js)
    Nf = base * (1 - M) + E * M
    Nf = np.minimum(limit_slope(Nf, grid, M), cap)
    gully = flow_field(flow) * M

    # the clearance the world's test holds, read here first
    fi, fj = grid.ij(rail[:, 1], rail[:, 3])
    from terrain import bilinear
    inside = (fi > 1) & (fj > 1) & (fi < N - 2) & (fj < N - 2)
    clear = rail[inside, 2] - bilinear(Nf, fi[inside], fj[inside])
    print(f'[massif] rail clearance min {clear.min():.1f} u at p {rail[inside, 0][np.argmin(clear)]:.4f}', flush=True)
    np.savez_compressed(os.path.join(SCRATCH, 'form.npz'), base=base, old=old, design=N0, form=Nf, gully=gully, depo=depo,
                        mask=M, cap=cap, head=json.dumps(head), **stages)
    print(f'[massif] form {time.time() - t0:.1f}s  top {Nf.max():.1f}  delta {np.abs(Nf - base).max():.1f}', flush=True)


def load_form():
    z = np.load(os.path.join(SCRATCH, 'form.npz'))
    head = json.loads(str(z['head']))
    return head, z


def preview():
    import preview as pv
    head, z = load_form()
    grid = Grid(head['n'], head['x0'], head['z0'], head['step'])
    out = os.path.join(SCRATCH, 'preview')
    os.makedirs(out, exist_ok=True)
    pv.render(z['base'] + z['old'], grid, os.path.join(out, 'before'))
    pv.render(z['form'], grid, os.path.join(out, 'after'), flow=z['gully'])
    print(f'[massif] previews in {out}', flush=True)


def encode_i16(a):
    """A 2D predictor (left + up - up-left) on integers, zig-zag, little-endian int16, then zlib."""
    q = np.rint(a).astype(np.int64)
    p = np.zeros_like(q)
    p[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    p[0, 1:] = q[0, :-1]
    p[1:, 0] = q[:-1, 0]
    r = q - p
    zz = np.where(r >= 0, r * 2, -r * 2 - 1)
    assert zz.max() < 65536, 'residual too large for 16 bits'
    return zlib.compress(zz.astype('<u2').tobytes(), 9)


def pack():
    head, z = load_form()
    delta = z['form'] - z['base']
    n = head['n']
    dq = encode_i16(delta / QUANT)
    g8 = zlib.compress(np.rint(np.clip(z['gully'], 0, 1) * 255).astype(np.uint8).tobytes(), 9)
    meta = {
        'version': 1,
        'n': n,
        'x0': head['x0'],
        'z0': head['z0'],
        'step': head['step'],
        'quant': QUANT,
        'delta': base64.b64encode(dq).decode('ascii'),
        'gully': base64.b64encode(g8).decode('ascii'),
    }
    body = json.dumps(meta, separators=(',', ':'))
    text = ('/* eslint-disable */\n'
            '/**\n'
            ' * Odyssey\'s mountain: GENERATED by scripts/blender/odyssey/odyssey_massif.py (do not edit by hand).\n'
            ' * The height the massif\'s form adds over the island\'s ground (macro + relief) on ODYSSEY_SCULPT_PLATE\'s\n'
            ' * square, and where water gathers on it; decoded by world/odyssey-massif-form-decode.js.\n'
            ' */\n'
            f'export const ODYSSEY_MASSIF_FORM = {body};\n')
    with open(OUT, 'w') as fh:
        fh.write(text)
    print(f'[massif] wrote {OUT} ({len(text) / 1024:.0f} KB; delta {len(dq) / 1024:.0f} KB, gully {len(g8) / 1024:.0f} KB zlib)', flush=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    stages = argv or ['form', 'preview', 'pack']
    if 'form' in stages:
        form()
    if 'preview' in stages:
        preview()
    if 'pack' in stages:
        pack()
