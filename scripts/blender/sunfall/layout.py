"""The Sunfall doline in metres (three.js axes: +y up, the eye looks down -z).

The eye stands on a calcite ledge on the near wall of a giant collapse chamber, about
110 m above the jungle canopy, looking across the void. The oculus (the collapse
skylight) is in the vault up and to the left; the column of sunlight it lets in lands on
the canopy in the left third of the frame; the passage runs on to the right and away, with
the far doline at its end. These numbers are mirrored in src/themes/sunfall/sunfall-core.js
(`SUNFALL_LAYOUT`) and written to the asset manifest, which a unit test compares.
"""

EYE = (0.0, 0.0, 0.0)

# The chamber: a plan ellipse with vertical lower walls that curve into a dome.
CHAMBER = {
    "center": (-40.0, -390.0),      # (x, z)
    "radii": (370.0, 402.0),        # (x, z) semi-axes of the plan outline
    "wall_top": 34.0,               # where the vertical lower wall curves into the vault
    "crown": 168.0,                 # vault height at the plan centre
}

# The floor under the jungle: a breakdown cone under the oculus on a gently tilted base.
FLOOR = {
    "base": -150.0,
    "cone_center": (-150.0, -365.0),
    "cone_radius": 260.0,
    "cone_height": 46.0,
}

# The oculus (collapse skylight): an ellipse through a thin roof, its rim flared by the collapse.
OCULUS = {
    "center": (-198.0, -432.0),     # (x, z)
    "radii": (54.0, 44.0),          # (x, z)
    "underside": 150.0,             # roof underside at the rim
    "surface": 182.0,               # the ground outside, round the hole
}

# The passage: an arched tube leaving the chamber on the right and running away.
PASSAGE = {
    "a": (215.0, -470.0),           # (x, z) where it leaves the chamber
    "b": (520.0, -930.0),
    "half_width": (104.0, 78.0),    # at a and at b
    "floor": (-152.0, -160.0),
    "crown": (142.0, 112.0),
}

# The far doline: a second, smaller skylight in the passage roof near its end.
FAR_DOLINE = {
    "center": (452.0, -828.0),
    "radii": (34.0, 30.0),
    "underside": 96.0,
    "surface": 132.0,
}

# The flowstone wall: cream calcite curtains on the chamber's right-hand far wall.
FLOWSTONE = {
    "center": (150.0, -720.0),      # (x, z) of the curtain field
    "radius": 190.0,
}

# The canopy: tree heights over the floor.
CANOPY = {
    "tree_height": (30.0, 46.0),
    "emergent_height": (50.0, 62.0),
}

# Shell field domain (three.js axes) and voxel size for the far shell.
DOMAIN = {
    "min": (-440.0, -180.0, -1060.0),
    "max": (660.0, 270.0, 30.0),
}

# The rest camera on 16:9.
CAMERA = {
    "position": EYE,
    "pitch_deg": -4.0,
    "yaw_deg": 0.0,
    "fov_deg": 52.0,
}

# Five sun stations (the light walks with the level): unit vectors toward the sun.
# The sun stands beyond the oculus and to the left, so the column leans toward the eye
# (forward scattering makes it a body of light) and the canopy it lands on is lit through.
STATIONS = (
    (-0.30, 0.90, -0.31),
    (-0.21, 0.93, -0.30),
    (-0.13, 0.95, -0.28),
    (-0.06, 0.96, -0.27),
    (-0.25, 0.88, -0.40),
)


def manifest():
    return {
        "eye": EYE,
        "chamber": CHAMBER,
        "floor": FLOOR,
        "oculus": OCULUS,
        "passage": PASSAGE,
        "farDoline": FAR_DOLINE,
        "flowstone": FLOWSTONE,
        "canopy": CANOPY,
        "camera": CAMERA,
        "stations": STATIONS,
    }
