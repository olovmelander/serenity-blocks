"""The Sunfall chamber as a rock-positive distance field (negative in the air).

Shapes are combined as air: a union of air is a smooth minimum, an intersection a smooth
maximum. Geology is then written into the field as displacement: bedding planes (soft
layers recessed into ledges), two vertical joint sets that break the vault into cuboid
breakdown blocks, a rounded weathering fBm, and vertical ribbed drapery on the flowstone
wall. Coordinates are three.js metres (+y up).
"""

import numpy as np

from . import layout as L
from .noise import blocks3, fbm3, smax, smin, smoothstep


def floor_height(x, z):
    """The rubble floor the jungle grows on: a breakdown cone under the oculus."""
    f = L.FLOOR
    cx, cz = f["cone_center"]
    d = np.sqrt((x - cx) ** 2 + (z - cz) ** 2)
    cone = np.clip(1.0 - d / f["cone_radius"], 0.0, 1.0) ** 1.35 * f["cone_height"]
    tilt = (z + 400.0) * -0.012 + (x - 200.0) * -0.006
    lumps = (fbm3(x / 70.0, x * 0.0, z / 70.0, 3, seed=3) - 0.5) * 9.0
    return f["base"] + cone + tilt + lumps


def _chamber(x, y, z):
    c = L.CHAMBER
    cx, cz = c["center"]
    rx, rz = c["radii"]
    dx = (x - cx) / rx
    dz = (z - cz) / rz
    # Bays and buttresses in the outline, held off the near wall so the eye's ledge stays put.
    calm = smoothstep(60.0, 170.0, np.sqrt(x * x + z * z))
    wobble = (fbm3(x / 150.0, y / 110.0, z / 150.0, 3, seed=11) - 0.5) * 0.17 * calm
    r = np.sqrt(dx * dx + dz * dz) * (1.0 + wobble)
    wall_top = c["wall_top"] + (fbm3(x / 95.0, y * 0.0, z / 95.0, 2, seed=12) - 0.5) * 34.0
    rr = np.clip(r, 0.0, 1.0)
    ceil = wall_top + (c["crown"] - wall_top) * np.sqrt(1.0 - rr * rr)
    t_wall = (r - 1.0) * 385.0
    t_ceil = y - ceil
    t_floor = floor_height(x, z) - y
    return smax(smax(t_floor, t_ceil, 12.0), t_wall, 34.0)


def _skylight(x, y, z, spec, rag_scale, seed):
    ox, oz = spec["center"]
    rx, rz = spec["radii"]
    qx = (x - ox) / rx
    qz = (z - oz) / rz
    rag = (fbm3(x / rag_scale, y / (rag_scale * 1.4), z / rag_scale, 3, seed=seed) - 0.5) * 0.42
    q = np.sqrt(qx * qx + qz * qz) * (1.0 + rag)
    t_cyl = (q - 1.0) * min(rx, rz)
    t_low = (spec["underside"] - 45.0) - y
    return smax(t_cyl, t_low, 10.0)


def _outside(x, y, z, spec, reach, seed):
    """Open air above the roof round a skylight (the ground out there, to the domain's edge)."""
    ox, oz = spec["center"]
    d = np.sqrt((x - ox) ** 2 + (z - oz) ** 2)
    ground = spec["surface"] + (fbm3(x / 70.0, y * 0.0, z / 70.0, 3, seed=seed) - 0.5) * 16.0 + d * 0.035
    t_ground = ground - y
    t_reach = d - reach
    return smax(t_ground, t_reach, 24.0)


def _passage(x, y, z):
    p = L.PASSAGE
    ax, az = p["a"]
    bx, bz = p["b"]
    abx, abz = bx - ax, bz - az
    length = np.hypot(abx, abz)
    s_raw = ((x - ax) * abx + (z - az) * abz) / (length * length)
    s = np.clip(s_raw, -0.25, 1.0)
    px = ax + abx * s
    pz = az + abz * s
    h = np.sqrt((x - px) ** 2 + (z - pz) ** 2)
    sc = np.clip(s, 0.0, 1.0)
    w = (p["half_width"][0] + (p["half_width"][1] - p["half_width"][0]) * sc)
    w = w * (1.0 + (fbm3(x / 80.0, y / 60.0, z / 80.0, 2, seed=71) - 0.5) * 0.3)
    fl = p["floor"][0] + (p["floor"][1] - p["floor"][0]) * sc
    cr = p["crown"][0] + (p["crown"][1] - p["crown"][0]) * sc
    hh = np.clip(h / w, 0.0, 1.0)
    shoulder = fl + 70.0
    ceil = shoulder + (cr - shoulder) * np.sqrt(1.0 - hh * hh)
    t_side = h - w
    t_ceil = y - ceil
    t_floor = fl - y
    t_end = (s_raw - 1.0) * length - 30.0
    out = smax(smax(t_side, t_ceil, 16.0), t_floor, 8.0)
    return smax(out, t_end, 30.0)


def base_field(x, y, z):
    """The shapes alone: chamber, oculus collapse, passage, far doline and the air outside."""
    phi = _chamber(x, y, z)
    phi = smin(phi, _passage(x, y, z), 46.0)
    phi = smin(phi, _skylight(x, y, z, L.OCULUS, 24.0, 21), 30.0)
    phi = smin(phi, _skylight(x, y, z, L.FAR_DOLINE, 18.0, 22), 18.0)
    phi = smin(phi, _outside(x, y, z, L.OCULUS, 300.0, 31), 10.0)
    phi = smin(phi, _outside(x, y, z, L.FAR_DOLINE, 150.0, 32), 10.0)
    return phi


def flowstone_mask(x, y, z):
    f = L.FLOWSTONE
    cx, cz = f["center"]
    d = np.sqrt((x - cx) ** 2 + (z - cz) ** 2)
    return (1.0 - smoothstep(0.55, 1.0, d / f["radius"])) * smoothstep(-150.0, -110.0, y) * (
        1.0 - smoothstep(70.0, 120.0, y))


def collapse_mask(x, y, z):
    """Near the oculus the vault is freshly broken: bigger, sharper blocks."""
    ox, oz = L.OCULUS["center"]
    d = np.sqrt((x - ox) ** 2 + (z - oz) ** 2)
    return (1.0 - smoothstep(60.0, 190.0, d)) * smoothstep(40.0, 110.0, y)


def geology(x, y, z, phi):
    """Write bedding, joint blocks, weathering and flowstone drapery into the field."""
    flow = flowstone_mask(x, y, z)
    broken = collapse_mask(x, y, z)

    # Bedding: soft layers between hard beds weather back into ledges and stepped ceilings.
    warp = (fbm3(x / 130.0, y / 70.0, z / 130.0, 2, seed=41) - 0.5) * 16.0
    v = (y + warp) / 9.5
    f = v - np.floor(v)
    soft = smoothstep(0.64, 0.73, f) * (1.0 - smoothstep(0.90, 0.99, f))
    phi = phi - (2.4 * (1.0 - 0.7 * flow)) * soft

    # Two vertical joint sets and the bedding make cuboid blocks: a rotated lattice.
    ca, sa = np.cos(0.47), np.sin(0.47)
    bx = (x * ca - z * sa) / 27.0
    bz = (x * sa + z * ca) / 21.0
    blocks = blocks3(bx, y / 11.0, bz, seed=51, edge=0.10) - 0.5
    cb, sb = np.cos(1.21), np.sin(1.21)
    fx = (x * cb - z * sb) / 9.0
    fz = (x * sb + z * cb) / 7.5
    fine = blocks3(fx, y / 5.5, fz, seed=52, edge=0.16) - 0.5
    block_amp = (3.2 + 4.5 * broken) * (1.0 - 0.85 * flow)
    phi = phi + block_amp * blocks + (1.2 + 1.4 * broken) * (1.0 - 0.8 * flow) * fine

    # Rounded weathering.
    phi = phi + 3.2 * (fbm3(x / 48.0, y / 48.0, z / 48.0, 3, seed=61) - 0.5)

    # Flowstone: vertical ribbed curtains that stand out of the wall.
    u = x / 6.5 + (fbm3(x / 60.0, y / 34.0, z / 60.0, 2, seed=81) - 0.5) * 3.2
    flute = (0.5 + 0.5 * np.cos(u * np.pi * 2.0)) ** 3
    drape = 0.6 + 0.4 * fbm3(x / 20.0, y / 70.0, z / 20.0, 2, seed=82)
    phi = phi + flow * (2.6 * flute * drape + 1.5)
    return phi


def shell_field(x, y, z):
    return geology(x, y, z, base_field(x, y, z))
