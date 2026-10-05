"""The authored composition: where crystals grow, in game coordinates.

Families: 0 aqua, 1 amethyst, 2 sapphire, 3 rose, 4 amber.
A cluster is rooted where a ray from `kind` meets the rock: "floor" drops from above the
plan point, "ceiling" rises from below it, "wall" travels from `origin` along `aim`.
The player's board hides the middle fifth of a landscape screen, so the picture is
composed for the two side thirds and the strips above and below the board.
"""

# fmt: off
CLUSTERS = [
    # ---- left foreground: the turquoise fan (hero) ---------------------------------
    dict(kind="floor", x=-20.0, z=-7.0, count=13, height=14.8, radius=2.05, spread=0.72, family=0, accent=2, glow=1.15, seed=11, lean=(-0.06, 0.0, 0.02), druzy=40),
    dict(kind="floor", x=-25.5, z=-13.0, count=8, height=10.0, radius=1.5, spread=0.7, family=0, accent=1, glow=1.0, seed=12, druzy=22),
    dict(kind="floor", x=-12.8, z=2.5, count=6, height=4.6, radius=0.95, spread=0.9, family=2, accent=0, glow=1.0, seed=13, druzy=18),
    dict(kind="floor", x=-14.5, z=13.0, count=6, height=4.8, radius=0.95, spread=0.85, family=0, accent=4, glow=0.8, seed=14, druzy=14),
    # ---- right foreground: the amethyst geode (hero) -------------------------------
    dict(kind="floor", x=21.0, z=-9.0, count=13, height=14.0, radius=2.1, spread=0.84, family=1, accent=3, glow=1.15, seed=21, lean=(0.08, 0.0, 0.0), druzy=40),
    dict(kind="floor", x=26.0, z=-15.0, count=8, height=9.5, radius=1.45, spread=0.72, family=3, accent=1, glow=1.0, seed=22, druzy=22),
    dict(kind="floor", x=13.2, z=0.5, count=6, height=4.4, radius=0.95, spread=0.95, family=4, accent=3, glow=1.1, seed=23, druzy=18),
    dict(kind="floor", x=15.0, z=12.5, count=6, height=4.6, radius=0.95, spread=0.85, family=1, accent=2, glow=0.8, seed=24, druzy=14),
    # ---- shores receding into the hall ---------------------------------------------
    dict(kind="floor", x=-28.0, z=-27.0, count=9, height=10.0, radius=1.45, spread=0.7, family=2, accent=0, glow=1.0, seed=31, druzy=20),
    dict(kind="floor", x=31.5, z=-30.0, count=9, height=10.5, radius=1.5, spread=0.7, family=0, accent=4, glow=1.0, seed=32, druzy=20),
    dict(kind="floor", x=-41.0, z=-42.0, count=10, height=13.0, radius=1.8, spread=0.66, family=1, accent=3, glow=1.1, seed=33, druzy=18),
    dict(kind="floor", x=42.0, z=-54.0, count=10, height=13.5, radius=1.85, spread=0.66, family=2, accent=0, glow=1.1, seed=34, druzy=18),
    dict(kind="floor", x=-33.0, z=-72.0, count=9, height=11.5, radius=1.6, spread=0.7, family=3, accent=4, glow=1.2, seed=35, druzy=14),
    dict(kind="floor", x=30.0, z=-78.0, count=9, height=12.0, radius=1.6, spread=0.7, family=0, accent=1, glow=1.2, seed=36, druzy=14),
    dict(kind="floor", x=-53.0, z=-34.0, count=10, height=14.5, radius=1.95, spread=0.6, family=0, accent=2, glow=1.3, seed=37, druzy=14),
    dict(kind="floor", x=51.0, z=-58.0, count=10, height=14.5, radius=1.95, spread=0.6, family=1, accent=3, glow=1.3, seed=38, druzy=14),
    # ---- islands in the pool ---------------------------------------------------------
    dict(kind="floor", x=-7.5, z=-40.0, count=8, height=7.0, radius=1.1, spread=0.8, family=0, accent=4, glow=1.2, seed=41, druzy=16),
    dict(kind="floor", x=11.0, z=-63.0, count=9, height=8.5, radius=1.3, spread=0.8, family=3, accent=1, glow=1.2, seed=42, druzy=16),
    dict(kind="floor", x=-24.0, z=-58.0, count=8, height=7.5, radius=1.2, spread=0.8, family=2, accent=0, glow=1.2, seed=43, druzy=16),
    # ---- the sanctuary: a warm heart at the end of the hall -------------------------
    dict(kind="floor", x=3.0, z=-96.0, count=18, height=24.0, radius=3.1, spread=0.62, family=4, accent=3, glow=2.2, seed=51, druzy=30),
    dict(kind="floor", x=-13.0, z=-104.0, count=8, height=12.0, radius=1.8, spread=0.7, family=0, accent=4, glow=1.4, seed=52, druzy=12),
    dict(kind="floor", x=17.0, z=-102.0, count=8, height=11.5, radius=1.8, spread=0.7, family=3, accent=4, glow=1.4, seed=53, druzy=12),
    # ---- chandeliers under the vault --------------------------------------------------
    dict(kind="ceiling", x=-11.0, z=-14.0, count=8, height=6.8, radius=1.0, spread=0.62, family=1, accent=2, glow=1.1, seed=61, druzy=10),
    dict(kind="ceiling", x=13.0, z=-22.0, count=8, height=7.4, radius=1.05, spread=0.62, family=2, accent=0, glow=1.1, seed=62, druzy=10),
    dict(kind="ceiling", x=-26.0, z=-12.0, count=6, height=5.5, radius=0.85, spread=0.6, family=0, accent=4, glow=1.0, seed=63, druzy=8),
    dict(kind="ceiling", x=26.5, z=-19.0, count=6, height=6.0, radius=0.85, spread=0.6, family=3, accent=1, glow=1.0, seed=64, druzy=8),
    dict(kind="ceiling", x=0.0, z=-52.0, count=10, height=9.5, radius=1.3, spread=0.6, family=4, accent=3, glow=1.3, seed=65, druzy=10),
    dict(kind="ceiling", x=-38.0, z=-28.0, count=7, height=7.0, radius=1.05, spread=0.6, family=2, accent=1, glow=1.1, seed=66, druzy=8),
    dict(kind="ceiling", x=29.0, z=-52.0, count=7, height=7.5, radius=1.05, spread=0.6, family=0, accent=2, glow=1.1, seed=67, druzy=8),
    # ---- spars growing out of the walls ------------------------------------------------
    dict(kind="wall", origin=(-12.0, 9.0, -8.0), aim=(-1.0, 0.25, -0.15), count=6, height=7.5, radius=0.95, spread=0.55, family=4, accent=3, glow=1.1, seed=71, druzy=10),
    dict(kind="wall", origin=(12.0, 10.0, -12.0), aim=(1.0, 0.3, -0.1), count=6, height=7.5, radius=0.95, spread=0.55, family=3, accent=4, glow=1.0, seed=72, druzy=10),
    dict(kind="wall", origin=(-20.0, 12.0, -36.0), aim=(-1.0, 0.35, -0.3), count=7, height=9.5, radius=1.15, spread=0.5, family=0, accent=1, glow=1.1, seed=73, druzy=10),
    dict(kind="wall", origin=(22.0, 13.0, -42.0), aim=(1.0, 0.35, -0.3), count=7, height=9.5, radius=1.15, spread=0.5, family=1, accent=4, glow=1.1, seed=74, druzy=10),
]

#: Places along the water's edge where play makes new crystals grow. (x, z, family)
SPROUTS = [
    (-11.5, 9.0, 0), (-10.8, 4.0, 2), (-11.6, -1.5, 0), (-12.4, -8.0, 4), (-13.5, -14.0, 0), (-15.0, -20.0, 2),
    (-9.6, 13.0, 1), (-17.5, -27.0, 0), (-20.5, -34.0, 3), (-14.0, 15.5, 0), (-8.2, 17.5, 2), (-23.0, -42.0, 2),
    (11.2, 9.5, 1), (10.6, 4.5, 3), (11.4, -2.0, 1), (12.0, -9.0, 4), (13.4, -15.0, 1), (15.2, -21.0, 3),
    (9.4, 13.5, 0), (18.0, -29.0, 1), (21.0, -36.0, 2), (14.4, 16.0, 1), (8.0, 18.0, 3), (24.0, -45.0, 0),
    (-6.0, -37.0, 4), (-9.5, -43.0, 0), (9.0, -60.0, 3), (13.5, -66.0, 1), (-22.0, -55.0, 2), (-26.5, -61.0, 0),
]
# fmt: on
