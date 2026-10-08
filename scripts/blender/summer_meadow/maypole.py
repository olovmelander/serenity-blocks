"""The midsommarstang: a pole and cross-arm dressed in birch leaves and meadow flowers.

It is raised on Midsummer's Eve already clothed: birch twigs bound up the whole pole and
along the arm, a leafy rope from the top of the pole to each end of the arm, a wreath
hanging under each end, and a tuft of birch at the very top. The ribbons are the
runtime's; nothing here moves.

The pole stands on the origin and faces +Z; "left" is -X as you look at it.
"""

import math

import numpy as np

from . import greenery
from .kit import TIMBER, X, Y, Z, Kit, unit

POLE_TOP = 7.3
ARM_HEIGHT = 5.6
ARM_HALF = 1.7
ARM_FORWARD = 0.085        # the arm is lashed across the front of the pole
WREATH_RADIUS = 0.45
WREATH_DROP = 0.3          # cord between the arm and the top of a wreath


def maypole():
    kit = Kit(7307)
    rng = kit.rng
    kit.tube([(0.0, -0.4, 0.0), (0.0, 1.2, 0.0), (0.0, 4.0, 0.0), (0.0, POLE_TOP, 0.0)], [0.078, 0.074, 0.064, 0.046],
             8, TIMBER, tone=0.55, wear=0.35, cap_end=True)
    arm = np.array([(-ARM_HALF, ARM_HEIGHT, ARM_FORWARD), (0.0, ARM_HEIGHT + 0.015, ARM_FORWARD),
                    (ARM_HALF, ARM_HEIGHT, ARM_FORWARD)])
    kit.tube(arm, [0.036, 0.042, 0.036], 6, TIMBER, tone=0.6, wear=0.3, cap_start=True, cap_end=True)
    # Birch bound up the pole from knee height, and along the arm.
    greenery.garland(kit, [(0.0, 0.95, 0.0), (0.0, 3.0, 0.0), (0.0, 5.3, 0.0), (0.0, POLE_TOP - 0.05, 0.0)], core=0.095,
                     spacing=0.06, leaf_size=0.2, lean=(0.0, -0.25, 0.0), sides=6)
    greenery.garland(kit, arm, core=0.065, spacing=0.068, leaf_size=0.18, lean=(0.0, -0.35, 0.0), sides=5)
    # A leafy rope from the top of the pole to each end of the arm, sagging a little.
    wreaths = {}
    for side, name in ((-1.0, "Left"), (1.0, "Right")):
        top = np.array([0.0, POLE_TOP - 0.12, 0.03])
        end = np.array([side * (ARM_HALF - 0.04), ARM_HEIGHT + 0.03, ARM_FORWARD])
        rope = [top + (end - top) * share - Y * 0.2 * math.sin(math.pi * share) for share in np.linspace(0.0, 1.0, 7)]
        greenery.garland(kit, rope, core=0.035, spacing=0.095, leaf_size=0.16, lean=(0.0, -0.45, 0.0), sides=4)
        # The wreath hangs from the arm on two cords.
        hang = np.array([side * (ARM_HALF - 0.16), ARM_HEIGHT, ARM_FORWARD])
        centre = hang - Y * (WREATH_DROP + WREATH_RADIUS)
        for spread in (-1.0, 1.0):
            angle = math.radians(90.0 + 34.0 * spread)
            grip = centre + (X * math.cos(angle) + Y * math.sin(angle)) * WREATH_RADIUS
            kit.tube([hang - Y * 0.03, grip], 0.007, 3, TIMBER, tone=0.75, wear=0.1)
        greenery.wreath(kit, centre, Z, WREATH_RADIUS, first_kind=0 if side < 0 else 4)
        wreaths[name] = [round(float(value), 4) for value in centre]
    # Flowers wound up the pole and set along the arm.
    for index in range(14):
        height = 1.3 + (POLE_TOP - 1.7) * index / 13.0
        angle = index * 2.1 + float(rng.uniform(-0.3, 0.3))
        radial = X * math.sin(angle) + Z * math.cos(angle)
        if radial[2] < -0.3:
            radial = unit(radial + Z * 0.9)          # most of them where they are seen
        greenery.flower(kit, np.array([0.0, height, 0.0]) + radial * 0.2, unit(radial + Y * 0.25),
                        float(rng.uniform(0.06, 0.08)), hue=greenery.hue_of(index * 3 + 1))
    for index in range(9):
        x = -ARM_HALF + 0.25 + (2.0 * ARM_HALF - 0.5) * index / 8.0
        if abs(x) < 0.2:
            continue
        angle = float(rng.uniform(-1.0, 1.0))
        radial = Z * math.cos(angle) + Y * math.sin(angle)
        greenery.flower(kit, np.array([x, ARM_HEIGHT, ARM_FORWARD]) + radial * 0.16, unit(radial + Z * 0.3),
                        float(rng.uniform(0.06, 0.08)), hue=greenery.hue_of(index * 3 + 5))
    # The tuft: a sheaf of birch twigs standing on the head of the pole.
    crown = np.array([0.0, POLE_TOP - 0.02, 0.0])
    for index in range(13):
        angle = index * 2.4 + float(rng.uniform(-0.3, 0.3))
        radial = X * math.cos(angle) + Z * math.sin(angle)
        greenery.sprig(kit, crown + radial * float(rng.uniform(0.01, 0.07)) + Y * float(rng.uniform(-0.05, 0.2)),
                       radial, Y + radial * float(rng.uniform(-0.2, 0.5)), 0.21, fan=0.9, lift=(0.1, 0.9))
    kit.anchors = dict(top=[0.0, POLE_TOP, 0.0], armLeft=[-ARM_HALF, ARM_HEIGHT, ARM_FORWARD],
                       armRight=[ARM_HALF, ARM_HEIGHT, ARM_FORWARD], wreathLeft=wreaths["Left"],
                       wreathRight=wreaths["Right"], wreathRadius=WREATH_RADIUS, base=[0.0, 0.0, 0.0])
    return kit
