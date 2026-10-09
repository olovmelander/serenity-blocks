"""The modelling kit of the Verdant Hills props: the Summer kit with this pack's materials.

Props are built as arrays, part by part (boards, stones, sheets); Blender only bakes their
ambient occlusion. Coordinates are glTF space: metres, +Y up, +Z the front.

One runtime material shades every prop, so each vertex says what it is made of:

    COLOR_0.r  tone: a per-part (or per-vertex) brightness variation 0..1
    COLOR_0.g  material code / 16 (see the constants below; there are more than eight)
    COLOR_0.b  ambient occlusion (baked afterwards)
    COLOR_0.a  wear: 0 fresh, 1 weathered (what that means for each material is in WEAR)

TEXCOORD_0 lays a surface out flat in metres, v along the grain of a board (up a wall,
along a rail, up the cap's boards from the curb) and u across it, stored as
0.5 + metres / UV_SPAN. Glass panes are mapped 0..1 across themselves.
"""

import numpy as np

from summer_meadow import kit as summer_kit
from summer_meadow.kit import UV_SPAN, X, Y, Z, patchy, planar_uv, smooth_normals, unit, weld  # noqa: F401

TIMBER, LIMEWASH, WHITE, TAR, STONE, GLASS, DOOR, CANVAS, WOOL, SKIN, IRON = range(11)
CODE_NAMES = ("timber", "limewash", "white", "tar", "stone", "glass", "door", "canvas", "wool", "skin", "iron")
CODES = 16.0
# What tone (R) and wear (A) mean on each material; written into the pack's attribution.
TONE = {
    "timber": "per-board brightness of the weathered grey wood",
    "limewash": "patchiness of the wash (it drifts across the tower)",
    "white": "per-part brightness of the paint",
    "tar": "per-board brightness of the tarred boards",
    "stone": "per-stone brightness",
    "glass": "per-pane brightness of the sky it reflects",
    "door": "per-plank brightness of the paint",
    "canvas": "per-cloth brightness",
    "wool": "brightness of the fleece (lumps catch more light)",
    "skin": "per-part brightness of the dark face, ears and legs",
    "iron": "per-part brightness",
}
WEAR = {
    "timber": "silvered and checked by weather",
    "limewash": "grime streaks under the windows, the stage and the curb, and moss at the foot",
    "white": "paint worn back to the wood",
    "tar": "tar weathered grey and dry",
    "stone": "lichen and moss (on the tops of stones and at the foot of a wall)",
    "glass": "unused (0)",
    "door": "paint worn at the foot of the door",
    "canvas": "stains and weathering toward the edges of a cloth",
    "wool": "soiled fleece: the belly, the breech and the lower flanks",
    "skin": "unused (0)",
    "iron": "rust",
}


class Kit(summer_kit.Kit):
    """The Summer kit writing this pack's codes: sixteen steps in the green channel, not eight."""

    def mesh(self, positions, triangles, normals, uvs, code, tone=None, wear=0.0):
        super().mesh(positions, triangles, normals, uvs, code, tone=tone, wear=wear)
        self.colors[-1][:, 1] = code / CODES

    def poly(self, points, outward, code, tone=None, wear=0.0, grain=None, uvs=None):
        """A flat polygon facing `outward`, as the Summer kit builds it.

        A four-cornered one that is not quite flat (a stone's face, the bevel into its
        joint) is split along whichever diagonal keeps both halves facing the way the whole
        does: a fan from the wrong corner can fold a thin bevel inside out.
        """
        points = np.asarray(points, dtype=float)
        if len(points) == 4:
            if uvs is not None:
                uvs = np.asarray(uvs, dtype=float)
            whole = sum(np.cross(points[index], points[(index + 1) % 4]) for index in range(4))
            if float(np.dot(whole, outward)) < 0:
                points = points[::-1]
                whole = -whole
                uvs = None if uvs is None else uvs[::-1]

            def agreement(a, b, c, d):
                """How nearly the halves (a, b, c) and (a, c, d) face the way the whole polygon does."""
                return min(float(np.dot(unit(np.cross(b - a, c - a)), unit(whole))),
                           float(np.dot(unit(np.cross(c - a, d - a)), unit(whole))))

            if agreement(*points[[1, 2, 3, 0]]) > agreement(*points) + 1e-9:
                points = points[[1, 2, 3, 0]]
                uvs = None if uvs is None else uvs[[1, 2, 3, 0]]
        super().poly(points, outward, code, tone=tone, wear=wear, grain=grain, uvs=uvs)

    def weather(self, rule):
        """Rewrite wear from `rule(positions, normals, codes, wear)` over the whole prop."""
        offset = 0
        positions = np.concatenate(self.positions)
        normals = np.concatenate(self.normals)
        colors = np.concatenate(self.colors)
        codes = np.round(colors[:, 1] * CODES).astype(int)
        wear = np.clip(rule(positions, normals, codes, colors[:, 3]), 0.0, 1.0)
        for chunk in self.colors:
            chunk[:, 3] = wear[offset:offset + len(chunk)]
            offset += len(chunk)

    # -- parts the Summer kit has no word for -----------------------------------------------
    def slab(self, corners, depth, code, tone=None, wear=0.0, grain=None, skip=()):
        """A board given by the four corners of its front face (in order) and a thickness.

        The back face lies `depth` behind the front along its normal. `skip` may name
        "front", "back" and the edges "0".."3" (edge n runs from corner n to corner n + 1).
        """
        front = np.asarray(corners, dtype=float)
        normal = unit(np.cross(front[1] - front[0], front[3] - front[0]))
        back = front - normal * depth
        if tone is None:
            tone = self.part_tone()
        if grain is None:
            grain = front[1] - front[0] if (np.linalg.norm(front[1] - front[0]) >= np.linalg.norm(front[3] - front[0])
                                           ) else front[3] - front[0]
        if "front" not in skip:
            self.poly(front, normal, code, tone=tone, wear=wear, grain=grain)
        if "back" not in skip:
            self.poly(back, -normal, code, tone=tone, wear=wear, grain=grain)
        centre = front.mean(axis=0)
        for index in range(4):
            if str(index) in skip:
                continue
            a, b = front[index], front[(index + 1) % 4]
            outward = (a + b) * 0.5 - centre
            outward = outward - normal * float(np.dot(outward, normal))
            self.poly([a, b, b - normal * depth, a - normal * depth], outward, code, tone=tone, wear=wear, grain=grain)

    def lump(self, directions, faces, centre, radii, code, tone=None, wear=0.0, swell=None, shear=None):
        """A rounded, smooth-shaded body: a unit sphere mesh stretched to `radii` about `centre`.

        `swell` (one factor per direction) pushes vertices in or out before the stretch.
        `shear` = (axis moved, axis measured, amount) leans the body: each vertex moves along
        the first axis by `amount` times its offset from the centre along the second.
        """
        directions = np.asarray(directions, dtype=float)
        scale = np.ones(len(directions)) if swell is None else np.asarray(swell, dtype=float)
        offsets = directions * scale[:, None] * np.asarray(radii, dtype=float)
        if shear is not None:
            moved, measured, amount = shear
            offsets[:, moved] += offsets[:, measured] * amount
        positions = np.asarray(centre, dtype=float) + offsets
        faces = np.asarray(faces, dtype=np.int64).reshape(-1, 3).copy()
        first, second, third = positions[faces[:, 0]], positions[faces[:, 1]], positions[faces[:, 2]]
        outward = np.cross(second - first, third - first)
        inside = np.einsum("ij,ij->i", outward, positions[faces].mean(axis=1) - np.asarray(centre, dtype=float)) < 0
        faces[inside] = faces[inside][:, [0, 2, 1]]
        normals = smooth_normals(positions, faces)
        uvs = np.stack([0.5 + positions[:, 0] / UV_SPAN, 0.5 + positions[:, 2] / UV_SPAN], axis=1)
        self.mesh(positions, faces, normals, uvs, code, tone=tone, wear=wear)
        return positions
