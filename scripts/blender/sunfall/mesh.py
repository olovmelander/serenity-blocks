"""Polygonise a distance field with OpenVDB and hand back numpy vertices and triangles.

The field is evaluated in slabs so memory stays bounded. Geology (the expensive part) is
only evaluated in a narrow band round the base shapes' surface, which is the only place
the zero level can be.
"""

import time

import numpy as np


def sample_grid(fn_base, fn_detail, lo, hi, voxel, band=26.0, slab=12, log=print):
    """Evaluate the field on a regular grid; returns (array[nx, ny, nz], origin)."""
    lo = np.asarray(lo, dtype=np.float64)
    hi = np.asarray(hi, dtype=np.float64)
    dims = np.ceil((hi - lo) / voxel).astype(int) + 1
    nx, ny, nz = (int(d) for d in dims)
    grid = np.empty((nx, ny, nz), dtype=np.float32)
    xs = lo[0] + np.arange(nx) * voxel
    ys = lo[1] + np.arange(ny) * voxel
    zs = lo[2] + np.arange(nz) * voxel
    started = time.time()
    for k0 in range(0, nz, slab):
        k1 = min(nz, k0 + slab)
        X, Y, Z = np.meshgrid(xs, ys, zs[k0:k1], indexing="ij")
        base = fn_base(X, Y, Z).astype(np.float32)
        near = np.abs(base) < band
        out = np.clip(base, -band, band)
        if near.any():
            out[near] = np.clip(fn_detail(X[near], Y[near], Z[near], base[near]), -band, band)
        grid[:, :, k0:k1] = out
    log(f"[sunfall] field {nx}x{ny}x{nz} = {nx * ny * nz / 1e6:.1f} M voxels in {time.time() - started:.1f} s")
    return grid, lo


def polygonise(grid, origin, voxel, adaptivity=0.0):
    """Zero level set -> (vertices in metres, triangle indices) with normals facing the air."""
    import openvdb as vdb

    level = vdb.FloatGrid()
    level.copyFromArray(grid)
    points, tris, quads = level.convertToPolygons(0.0, adaptivity)
    points = np.asarray(points, dtype=np.float64) * voxel + origin
    faces = []
    if len(tris):
        faces.append(np.asarray(tris, dtype=np.int64))
    if len(quads):
        q = np.asarray(quads, dtype=np.int64)
        faces.append(q[:, [0, 1, 2]])
        faces.append(q[:, [0, 2, 3]])
    faces = np.concatenate(faces, axis=0)
    # Outside the array OpenVDB reads the background value (0, the iso level), so wherever the
    # field is air at the domain's edge (the sky above the skylights) it closes a lid along the
    # edge. Drop every face lying on a domain face: the air there is meant to stay open.
    hi = origin + (np.asarray(grid.shape) - 1) * voxel
    on_edge = np.zeros(len(faces), dtype=bool)
    for axis in range(3):
        coord = points[faces][:, :, axis]
        on_edge |= np.all(coord <= origin[axis] + voxel * 1.01, axis=1)
        on_edge |= np.all(coord >= hi[axis] - voxel * 1.01, axis=1)
    faces = faces[~on_edge]
    return points, faces


def face_normals(points, faces):
    a = points[faces[:, 0]]
    b = points[faces[:, 1]]
    c = points[faces[:, 2]]
    n = np.cross(b - a, c - a)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def orient_to_air(points, faces, field_fn, probe=1.5):
    """Flip the winding if face normals point into the rock (field increasing along them)."""
    centres = points[faces].mean(axis=1)
    n = face_normals(points, faces)
    sample = np.random.default_rng(7).choice(len(faces), size=min(4000, len(faces)), replace=False)
    c = centres[sample]
    m = n[sample]
    ahead = field_fn(c[:, 0] + m[:, 0] * probe, c[:, 1] + m[:, 1] * probe, c[:, 2] + m[:, 2] * probe)
    behind = field_fn(c[:, 0] - m[:, 0] * probe, c[:, 1] - m[:, 1] * probe, c[:, 2] - m[:, 2] * probe)
    if np.mean(ahead > behind) > 0.5:
        faces = faces[:, [0, 2, 1]]
    return faces
