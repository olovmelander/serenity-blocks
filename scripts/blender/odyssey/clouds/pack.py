"""
Packing Odyssey's cloud volumes small (2026-11-24). Pure numpy.

A plane (one channel of a 3D grid, z, y, x) is taken down to a few levels and every value replaced by how far it
is from what its neighbours foretell (the 3D Lorenzo predictor), modulo 256: smooth volumes become mostly zeros,
and gzip does the rest. The game sums it back along x, y and z (world/odyssey-cloud-data.js `unpackPlane`).
"""

import numpy as np

# (grid, channels kept, levels): what the eye can tell apart in each.
PLANES = (('sdf', 1, 128), ('sun', 4, 64), ('air', 3, 48), ('billow', 4, 64))


def quantise(a, levels):
    return np.rint(a.astype(np.float32) / 255 * (levels - 1)).astype(np.uint8)


def residual(p):
    r = p.astype(np.int16)
    for ax in (0, 1, 2):
        r = np.diff(r, axis=ax, prepend=0)
    return (r & 255).astype(np.uint8)


def pack(grids):
    """`grids` name -> uint8 (z, y, x) or (z, y, x, c). The file's bytes before gzip."""
    out = []
    for name, channels, levels in PLANES:
        g = grids[name]
        g = g[..., None] if g.ndim == 3 else g
        for c in range(channels):
            out.append(residual(quantise(g[..., c], levels)).tobytes())
    return b''.join(out)
