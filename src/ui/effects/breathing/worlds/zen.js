/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Zen Garden — a moonlit karesansui, seen from the temple veranda on an autumn night.
 * Inhale: a ring of moonlight travels out from the main stone across the raked sand and the furrow
 * crests sparkle as it passes. Full: it rests wide, shimmering. Exhale: it returns. Empty: it rests
 * against the main stone's moss. The ring also glows up into the low mist, and the garden and the
 * bloom brighten a little with the in-breath.
 *
 * The garden is a small ray-traced scene on the backdrop quad rather than a flat painting: a virtual
 * camera seated on the veranda (its eye height and lens shift chosen so the main stone always lands
 * on the hero point) sends one ray per pixel to the sand, the stones, the low back wall and the
 * borrowed scenery beyond it. Perspective, foreshortening and the breathing camera's parallax all
 * come from that one ray, so every layer agrees with every other.
 *
 * The sand is raked: rings hug each stone's moss island, and the rake's last ring is a groove that
 * the long straight furrows run into. The furrow relief has an analytic normal (the derivative of
 * the rake's phase), so the low moon — behind the garden and to the right — silvers one side of every
 * crest and leaves the grooves in soft blue shade. The stones are sphere-traced: ellipsoids split by
 * fracture planes and weathered by noise, with ledges, cracks, lichen, moss and a damp top; they
 * cast soft moon shadows and darken the sand at their feet. Thin mist lies over the furrows and
 * thickens with distance; beyond the wall, clipped shrubs, two far ridges and a starry sky.
 *
 * Warm against the silver-blue: a stone lantern by the wall throws a pool of light on the sand and
 * the plaster behind it, and a Japanese maple reaches over the top-right corner, close to the lens,
 * its leaves glowing crimson with the moon behind them; a few drift down past the lens. Thin cloud
 * shade wanders over the garden, the mist rolls slowly along the breeze, sand grains twinkle.
 *
 * Moods: the autumn moon (the poster), a snowy dawn (snow on the stones, the moss, the wall and the
 * hedges, a bare branch, flakes falling, a low pink sun), a spring dusk (cherry blossom on the branch,
 * petals falling, the afterglow), and a morning rain (grey light, wet sand and stones, thick mist,
 * fine rain, green leaves). Now and then: a meteor over the ridges at night, a bird crossing a bright
 * sky, a single leaf or petal spiralling down past the lens, a bank of mist drifting across the
 * garden; each keeps to the visit's own timetable (u.seed) and rests under reduced motion.
 */
import { Vector4 } from 'three/webgpu';
import {
    Break, Fn, If, Loop, clamp, dot, exp, float, length, max, min, mix, normalize, select, sin, smoothstep, sqrt, step,
    uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import {
    backdropPoint, eventWindow, fadeOut, fbm, fbm3, gnoise, gnoise3, hash21, hash22, layer, shootingStar, starfield,
    turn,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION, MOTE_SHAPE } from '../stage/breath-motes.js';

const TAU = Math.PI * 2;
const unit = (v) => {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
};

/** The main stone's foot lands this far below the hero point (hero units), this far from the eye (m). */
const HERO_Y = -0.12;
const HERO_Z = 5;
/** The rake: tine spacing (m), ridge height (m), and the furrow profile's groove level. */
const RAKE = 0.15;
const RAKE_K = TAU / RAKE;
const RELIEF = 0.11 * RAKE;
const GROOVE = -1.22;
/** The rake draws this many rings round an island before the straight furrows begin (it ends in a groove). */
const RING_ZONE = 3.5 * RAKE;
/** Sand-grain mirrors that glint (m). */
const GRAIN = 0.024;
/** The back wall (m): distance, plaster height and its tiled cap. Clipped shrubs stand beyond it. */
const WALL_Z = 13;
const WALL_H = 0.8;
const CAP_H = 0.3;
const HEDGE_Z = 14.8;
/** The moss border at the near edge of the garden (m from the eye). */
const BORDER_Z = 2.38;
/** The breath ring's distance from the main stone's moss (m): at rest and at full lungs. */
const RING_REST = 0.32;
const RING_FULL = 1.92;

/** A stone lantern on the moss strip by the wall, left of the main stone: x and depth (m), flame height. */
const LANTERN = {
    x: -3.1, z: 11.7, flame: 1.38, scale: 1.3,
};
/**
 * The lantern's stacked stones, bottom to top: [from, to] height and half-width at each (in its own
 * units: metres before `scale`); the roof sweeps in on a curve. Base, post, collar, platform, fire
 * box, eaves, roof, jewel.
 */
const LANTERN_PARTS = [
    [0.0, 0.15, 0.3, 0.26], [0.15, 0.8, 0.085, 0.074], [0.45, 0.51, 0.105, 0.105], [0.8, 0.93, 0.13, 0.25],
    [0.93, 1.2, 0.17, 0.165], [1.2, 1.255, 0.38, 0.35], [1.255, 1.43, 0.34, 0.06, true], [1.43, 1.55, 0.07, 0.015],
];
/** Light thrown back at the stones by the moonlit sand in front of them. */
const BOUNCE = vec3(...unit([0.15, -0.05, -1]));

/**
 * Three stone groups, each on a moss island (ground ellipse: centre x/z, radii, turn; the main one
 * gets extra rings). A stone is one or two ellipsoids (centre, half-sizes, yaw, lean) split by
 * fracture planes (normal and offset in the stone's own frame): flat faces, sharp edges, and a ledge
 * where two meet. Metres; groups close in toward the middle on narrow screens.
 */
const GROUPS = [
    {
        island: {
            c: [0.04, 5.0], r: [0.8, 0.62], yaw: 0.25, extra: 2,
        },
        rocks: [
            {
                c: [0.02, 0.26, 5.04],
                r: [0.44, 0.95, 0.38],
                yaw: 0.35,
                lean: -0.1,
                cuts: [[[0.35, 1, -0.25], 0.74], [[-1, 0.2, -0.4], 0.32], [[0.55, -0.1, -1], 0.28]],
            },
            {
                c: [-0.42, 0.06, 5.14],
                r: [0.37, 0.52, 0.31],
                yaw: -0.5,
                lean: 0.32,
                cuts: [[[-0.2, 1, 0.15], 0.37], [[-0.3, 0, -1], 0.24]],
            },
        ],
    },
    {
        island: {
            c: [-2.1, 3.75], r: [0.98, 0.62], yaw: 0.4, extra: 0,
        },
        rocks: [
            {
                c: [-2.22, -0.02, 3.78],
                r: [0.64, 0.36, 0.43],
                yaw: 0.5,
                lean: 0.07,
                cuts: [[[0.2, 1, 0.1], 0.33]],
            },
            {
                c: [-1.6, -0.02, 3.62],
                r: [0.24, 0.28, 0.21],
                yaw: 0.6,
                lean: 0.18,
                cuts: [[[0.9, 0.7, -0.3], 0.17]],
            },
        ],
    },
    {
        island: {
            c: [2.05, 8.0], r: [0.72, 0.56], yaw: -0.3, extra: 0,
        },
        rocks: [
            {
                c: [2.04, 0.14, 8.0],
                r: [0.37, 0.68, 0.33],
                yaw: -0.3,
                lean: 0.14,
                cuts: [[[0.5, 1, 0], 0.52], [[-1, 0, -0.3], 0.28]],
            },
            {
                c: [2.4, -0.02, 7.86],
                r: [0.28, 0.3, 0.25],
                yaw: 0.2,
                lean: -0.15,
                cuts: [[[-0.8, 0.75, -0.2], 0.2]],
            },
        ],
    },
];
/** A small seeded generator, so the stones keep their shape from build to build. */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Extra fracture planes round a stone: faces at spread headings, each shaving up to `shave` off its ellipsoid. */
function fractures(r, count, seed, shave) {
    const rand = seeded(seed);
    return Array.from({ length: count }, (_, i) => {
        const heading = (i / count) * TAU + rand() * 1.1;
        const rise = -0.25 + rand() * 1.0;
        const n = unit([Math.cos(heading) * Math.cos(rise), Math.sin(rise), Math.sin(heading) * Math.cos(rise)]);
        const extent = Math.hypot(n[0] * r[0], n[1] * r[1], n[2] * r[2]);
        return [n, extent * (1 - shave + rand() * shave * 0.75)];
    });
}
const ROCKS = GROUPS.flatMap((group, g) => group.rocks.map((rock, i) => ({
    ...rock,
    home: group.island.c[0],
    cy: Math.cos(rock.yaw),
    sy: Math.sin(rock.yaw),
    cl: Math.cos(rock.lean),
    sl: Math.sin(rock.lean),
    // The main stone is the most broken; the low reclining stone is worn round.
    cuts: [
        ...rock.cuts.map(([n, h]) => [unit(n), h]),
        ...fractures(rock.r, i === 0 ? 5 : 3, 17 + g * 7 + i * 3, g === 1 ? 0.16 : 0.3),
    ],
})));
/**
 * A Japanese maple branch over the top-right corner, close to the lens (parallax 2.4): a bough and
 * five twigs as tapered segments [from, to, width at each] and their palmate leaves [centre, tip
 * heading, size, shade], in hero units from the screen's top-right corner. Seeded: it never changes.
 */
const MAPLE_K = 2.4;
const MAPLE = (() => {
    const rand = seeded(91);
    const bough = (t) => {
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        return [a * 0.12 + b * -0.3 + c * -0.86, a * -0.02 + b * 0.0 + c * -0.36];
    };
    const segments = [];
    for (let i = 0; i < 6; i++) {
        segments.push([bough(i / 6), bough((i + 1) / 6), 0.026 - i * 0.003, 0.026 - (i + 1) * 0.003]);
    }
    const leaves = [];
    // Where each twig leaves the bough, and where it reaches.
    const twigs = [
        [0.2, [0.02, -0.2]], [0.4, [-0.12, -0.22]], [0.6, [0.07, -0.19]], [0.8, [-0.16, -0.16]], [1.0, [-0.15, -0.06]],
    ];
    twigs.forEach(([at, off]) => {
        const from = bough(at);
        const to = [from[0] + off[0], from[1] + off[1]];
        segments.push([from, to, 0.008, 0.004]);
        const heading = Math.atan2(off[0], off[1]);
        for (let k = 0; k < 6; k++) {
            const along = 0.35 + rand() * 0.75;
            const centre = [
                from[0] + off[0] * along + (rand() - 0.5) * 0.11,
                from[1] + off[1] * along + (rand() - 0.5) * 0.08,
            ];
            // [centre, tip heading, size, brightness: leaves deeper in the spray sit in their neighbours' shade]
            leaves.push([centre, heading + (rand() - 0.5) * 1.9, 0.065 + rand() * 0.04, 0.45 + rand() * 0.55]);
        }
    });
    // The corner region the branch can reach (with room for sway and blur): the shader skips the rest.
    const reach = [
        ...segments.flatMap(([from, to, w0]) => [[from[0] - w0, from[1] - w0], [to[0] - w0, to[1] - w0]]),
        ...leaves.map(([c, , size]) => [c[0] - size, c[1] - size]),
    ];
    const left = Math.min(...reach.map((q) => q[0])) - 0.08;
    const low = Math.min(...reach.map((q) => q[1])) - 0.08;
    return {
        segments, leaves, left, low,
    };
})();

/** A bounding sphere per group (centre, radius) so the march only runs where a stone may be. */
const BOUNDS = GROUPS.map((group) => {
    const centre = [0, 1, 2].map((i) => group.rocks.reduce((sum, rock) => sum + rock.c[i], 0) / group.rocks.length);
    const radius = Math.max(...group.rocks.map((rock) => (
        Math.hypot(...rock.c.map((c, i) => c - centre[i])) + Math.max(...rock.r))));
    return { centre, radius: radius + 0.08, home: group.island.c[0] };
});

/** A world vector in a rock's own frame: undo its yaw (about y), then its lean (about z). */
function intoRock(v, rock) {
    const x1 = v.x.mul(rock.cy).sub(v.z.mul(rock.sy));
    const z1 = v.x.mul(rock.sy).add(v.z.mul(rock.cy));
    return vec3(x1.mul(rock.cl).add(v.y.mul(rock.sl)), v.y.mul(rock.cl).sub(x1.mul(rock.sl)), z1);
}

/** intoRock for a constant direction, in JS. */
function intoRockJS([x, y, z], rock) {
    const x1 = x * rock.cy - z * rock.sy;
    const z1 = x * rock.sy + z * rock.cy;
    return [x1 * rock.cl + y * rock.sl, y * rock.cl - x1 * rock.sl, z1];
}

/** A point's centre on the ground: groups close in toward the middle on narrow screens. */
const placed = (c, home, spread) => vec3(float(c[0]).add(spread.sub(1).mul(home)), c[1], c[2]);

/**
 * Distance (m) from a ground point to an elliptical island's edge, and its unit gradient, as
 * vec3(d, grad). The first-order ellipse distance: exact for a circle, gently elliptical rings
 * farther out. A real shader function (the rake, the ring, the mist and the stones all ask it);
 * the island comes in as shape = (centre x, z, radii) and its turn as (cos, sin).
 */
const islandFn = /* @__PURE__ */ Fn(([x, z, shape, turnCS, spread]) => {
    const dx = x.sub(spread.mul(shape.x)).toVar();
    const dz = z.sub(shape.y).toVar();
    const qx = dx.mul(turnCS.x).sub(dz.mul(turnCS.y)).toVar();
    const qz = dx.mul(turnCS.y).add(dz.mul(turnCS.x)).toVar();
    const k = vec2(qx.div(shape.z), qz.div(shape.w)).length().toVar();
    const gx = qx.div(shape.z.mul(shape.z)).toVar();
    const gz = qz.div(shape.w.mul(shape.w)).toVar();
    const glen = vec2(gx, gz).length().max(1e-4).toVar();
    const ux = gx.div(glen).toVar();
    const uz = gz.div(glen).toVar();
    const grad = vec2(ux.mul(turnCS.x).add(uz.mul(turnCS.y)), uz.mul(turnCS.x).sub(ux.mul(turnCS.y)));
    return vec3(k.sub(1).mul(k).div(glen), grad);
}).setLayout({
    name: 'zen_island',
    type: 'vec3',
    inputs: [
        { name: 'x', type: 'float' }, { name: 'z', type: 'float' }, { name: 'shape', type: 'vec4' },
        { name: 'turnCS', type: 'vec2' }, { name: 'spread', type: 'float' },
    ],
});

/** One island's { d, grad } at a ground point. */
function islandField(x, z, island, spread) {
    const shape = vec4(island.c[0], island.c[1], island.r[0], island.r[1]);
    const field = islandFn(x, z, shape, vec2(Math.cos(island.yaw), Math.sin(island.yaw)), spread).toVar();
    return { d: field.x, grad: field.yz };
}

/** Polynomial smooth union of two distance fields; its gradient is exactly the blend of theirs. */
function smoothUnion(a, b, k) {
    const h = b.d.sub(a.d).div(k).mul(0.5).add(0.5)
        .saturate()
        .toVar();
    return {
        d: mix(b.d, a.d, h).sub(h.mul(float(1).sub(h)).mul(k)).toVar(),
        grad: mix(b.grad, a.grad, h).toVar(),
    };
}

/** The rake's furrow profile: broad rounded crests at phase 0, narrower grooves at phase pi. */
const profile = (phase) => phase.cos().sub(phase.mul(2).cos().mul(0.22));
const profileSlope = (phase) => phase.mul(2).sin().mul(0.44).sub(phase.sin());

/**
 * x^n for a small integer n, by repeated squaring of shader variables (pow() of a value that may
 * touch zero is undefined, and a chain of n products of one expression would repeat it n times).
 */
const power = (x, n) => {
    let base = x.toVar();
    let result = null;
    for (let k = n; k > 0; k >>= 1) {
        if (k & 1) result = result ? result.mul(base) : base;
        if (k > 1) base = base.mul(base).toVar();
    }
    return result;
};

/**
 * The stones' signed distance (m): each an ellipsoid cut by its fracture planes, the union weathered
 * by noise. A real shader function (setLayout): the march, the normal, the occlusion and the shadow
 * all call it, so it is emitted once. Pure: the screen's spread comes in as a parameter.
 */
const stoneField = /* @__PURE__ */ Fn(([at, spread]) => {
    let field = null;
    ROCKS.forEach((rock) => {
        const q = intoRock(at.sub(placed(rock.c, rock.home, spread)), rock).toVar();
        const k0 = q.div(vec3(...rock.r)).length();
        const k1 = q.div(vec3(...rock.r.map((r) => r * r))).length().max(1e-5);
        let d = k0.mul(k0.sub(1)).div(k1);
        rock.cuts.forEach(([n, h]) => {
            d = max(d, dot(q, vec3(...n)).sub(h));
        });
        field = field ? min(field, d) : d;
    });
    return field.sub(gnoise3(at.mul(2.3)).sub(0.5).mul(0.15));
}).setLayout({
    name: 'zen_stoneField', type: 'float', inputs: [{ name: 'at', type: 'vec3' }, { name: 'spread', type: 'float' }],
});

/**
 * Finer weathering that only bends the light: pits, grit and the stone's strata. (The strata are a
 * continuous wave: a wrapped ramp would put a seam in the normal.)
 */
const grit = /* @__PURE__ */ Fn(([at]) => gnoise3(at.mul(5.2).add(3.1)).sub(0.5).mul(0.06)
    .add(gnoise3(at.mul(13.7).add(7.7)).sub(0.5).mul(0.022))
    .add(at.y.mul(21).add(at.x.mul(3.7)).add(gnoise3(at.mul(2.2)).mul(5)).sin()
        .mul(0.004))).setLayout({ name: 'zen_grit', type: 'float', inputs: [{ name: 'at', type: 'vec3' }] });

/** intoRock with the rock's turn read from shader data: (cos yaw, sin yaw, cos lean, sin lean). */
function intoRockBy(v, turnCS) {
    const x1 = v.x.mul(turnCS.x).sub(v.z.mul(turnCS.y)).toVar();
    const z1 = v.x.mul(turnCS.y).add(v.z.mul(turnCS.x));
    return vec3(x1.mul(turnCS.z).add(v.y.mul(turnCS.w)), v.y.mul(turnCS.z).sub(x1.mul(turnCS.w)), z1);
}

/**
 * Low mist and night air between the eye and a point `t` along the ray, `height` above the sand:
 * the mist lies MIST_H deep, rolls along the breeze, scatters moonlight (more toward the moon), and
 * carries the breath ring's light and the lantern's warmth. A real shader function (the sand, the
 * wall, the lantern and the stones all call it), so the view comes in packed: eyeR = (eye, |dir|),
 * dirD = (dir, -dir.y), scene = (toMoon, drift, time, ring distance), lampF = (lamp, flame).
 */
const veilCache = new Map();
function makeVeil(look) {
    if (veilCache.has(look.id)) return veilCache.get(look.id);
    const MOONLIGHT = vec3(...look.light);
    const SKYLIGHT = vec3(...look.skylight);
    const RING_LIGHT = vec3(...look.ring);
    const WARM = vec3(...look.warm);
    const HAZE = vec3(...look.haze);
    const MIST_H = look.mist[0];
    const veilFn = Fn(([colour, t, height, ringGlow, eyeR, dirD, scene, lampF, spread]) => {
        const dt = float(MIST_H).sub(height).max(0).div(dirD.w)
            .min(t)
            .toVar();
        const mid = eyeR.xyz.add(dirD.xyz.mul(t.sub(dt.mul(0.5)))).toVar();
        // Wisps drawn out along the breeze (x), slowly rolling.
        const dens = fbm3(vec3(mid.x.mul(0.22).add(scene.y), mid.z.mul(0.5), scene.z.mul(0.025)), 3);
        const thick = smoothstep(0.38, 0.66, dens).mul(0.9).add(0.1);
        const mist = float(1).sub(exp(dt.mul(eyeR.w).mul(thick).mul(-0.5 * look.mist[1])));
        const forward = exp(scene.x.sub(1).mul(2.4)).toVar();
        // The mist carries light: the breath ring glowing up into it, the lantern's warmth near it.
        const gap = islandField(mid.x, mid.z, GROUPS[0].island, spread).d.sub(scene.w).toVar();
        const toLamp = lampF.xyz.sub(mid).toVar();
        const mistColor = MOONLIGHT.mul(forward.mul(0.15).add(0.075)).add(SKYLIGHT.mul(0.3))
            .add(RING_LIGHT.mul(exp(gap.mul(gap).mul(-9))).mul(ringGlow.mul(0.15)))
            .add(WARM.mul(lampF.w).mul(float(0.14).div(dot(toLamp, toLamp).mul(0.9).add(1))));
        const c = mix(colour, mistColor, mist).toVar();
        const air = float(1).sub(exp(t.mul(eyeR.w).mul(-0.02 * look.mist[2])));
        return mix(c, HAZE.add(MOONLIGHT.mul(forward).mul(0.025)), air);
    }).setLayout({
        name: `zen_veil_${look.id.replace(/-/g, '_')}`,
        type: 'vec3',
        inputs: [
            { name: 'colour', type: 'vec3' }, { name: 't', type: 'float' }, { name: 'height', type: 'float' },
            { name: 'ringGlow', type: 'float' }, { name: 'eyeR', type: 'vec4' }, { name: 'dirD', type: 'vec4' },
            { name: 'scene', type: 'vec4' }, { name: 'lampF', type: 'vec4' }, { name: 'spread', type: 'float' },
        ],
    });
    veilCache.set(look.id, veilFn);
    return veilFn;
}

/** The hedge's domes: two interleaved sets [slot width, seed, rise], each read at offsets -1, 0, 1. */
const DOMES = [[1.7, 4.7, 1.3], [2.6, 9.1, 1.15]].flatMap((set) => [-1, 0, 1].map((o) => [...set, o]));

/**
 * Everything the shader repeats (stones, bounds, hedge domes, lantern stones, maple segments and
 * leaves), as shader data read in loops: each loop body compiles once instead of once per item. All
 * of it lives in ONE uniform array (every array is a uniform buffer, and a stage may bind only 12):
 * blocks of vec4 rows, `stride` rows per item; `row(block, i, k)` reads row k of item i.
 */
function createTables(MOON_DIR) {
    const rows = [];
    const block = (items, ...pack) => {
        const offset = rows.length;
        items.forEach((item, index) => pack.forEach((fn) => rows.push(new Vector4(...fn(item, index)))));
        return { offset, stride: pack.length, count: items.length };
    };
    const rocks = block(
        ROCKS,
        (rock) => [...rock.c, rock.home],
        (rock) => [rock.cy, rock.sy, rock.cl, rock.sl],
        (rock) => [...rock.r, Math.min(...rock.r)],
        (rock) => {
            // The moonbeam in the rock's scaled frame, and its squared length.
            const l = intoRockJS(MOON_DIR, rock).map((c, i) => c / rock.r[i]);
            return [...l, l.reduce((sum, c) => sum + c * c, 0)];
        },
    );
    const bounds = block(BOUNDS, (b) => [...b.centre, b.home], (b) => [b.radius * b.radius, 0, 0, 0]);
    const domes = block(DOMES, (dome) => dome);
    // A part's top half-width is stored negative when its sides sweep in on a curve (all are > 0).
    const parts = block(LANTERN_PARTS, ([from, to, w0, w1, curved]) => [from, to, w0, curved ? -w1 : w1]);
    const segments = block(
        MAPLE.segments,
        ([from, to]) => [...from, ...to],
        ([from, to, w0, w1]) => [w0, w1, (to[0] - from[0]) ** 2 + (to[1] - from[1]) ** 2, 0],
    );
    const leaves = block(
        MAPLE.leaves,
        ([c, heading, size]) => [...c, heading, size],
        ([, , , bright], index) => [bright, 0.6 + (index % 5) * 0.11, index * 1.7, 0],
    );
    const data = uniformArray(rows, 'vec4');
    const row = (at, i, k = 0) => data.element(i.mul(at.stride).add(at.offset + k));
    return {
        rocks, bounds, domes, parts, segments, leaves, row,
    };
}

/** Dust and dew hanging in the light over the sand. */
const dust = (count, gain, colorA = [0.7, 0.8, 1.0], colorB = [0.95, 0.95, 0.88]) => ({
    motion: MOTE_MOTION.wander,
    count,
    size: 0.008,
    speed: 0.25,
    spread: 0.9,
    band: [-0.6, 0.35],
    depth: 2.2,
    bokeh: 0.1,
    colorA,
    colorB,
    gain,
});
/** Leaves or petals coming down from the branch, many passing close to the lens, out of focus. */
const falling = (shape, count, size, colorA, colorB, gain) => ({
    motion: MOTE_MOTION.fall,
    shape,
    blend: 'alpha',
    count,
    size,
    speed: 0.3,
    spread: 0.95,
    depth: 1.6,
    bokeh: 0.35,
    spin: 0.5,
    tumble: 0.8,
    flutter: 1,
    colorA,
    colorB,
    gain,
});

/**
 * The versions of this world a visit can show (stage/breath-moods.js); the first is the poster's.
 * Linear RGB. lightDir/light/power: the key light (the moon, or a low sun) — it rakes the furrows and
 * shadows the stones; lightGlow: how much it brightens the sky round it; skylight: the fill from the
 * sky; sandlight: light thrown back off the ground. zenith/horizon/haze: the sky and the air; ring: the
 * breath ring's light; warm/lamp: the lantern. leaves: the branch over the corner ('maple', 'blossom'
 * or 'none'), leaf its colour. snow: how much snow lies on everything (0..1); relief: the furrows'
 * depth; mist: [depth (m), density, distance haze]; stars: amount. Events: meteor (a night sky),
 * bird (crossing a bright sky), faller: what spirals down past the lens now and then.
 */
export const MOODS = Object.freeze([
    {
        id: 'autumn-moon',
        name: 'Autumn Moon',
        lightDir: [0.5, 0.45, 0.62],
        light: [0.62, 0.75, 1.0],
        power: 0.85,
        lightGlow: 1,
        skylight: [0.026, 0.036, 0.062],
        sandlight: [0.78, 0.8, 0.86],
        sand: [0.6, 0.59, 0.56],
        moss: [0.03, 0.07, 0.028],
        rock: [0.36, 0.34, 0.31],
        lichen: [0.47, 0.5, 0.45],
        plaster: [0.36, 0.26, 0.17],
        tile: [0.06, 0.065, 0.07],
        hedge: [0.016, 0.027, 0.024],
        ridge: [0.008, 0.013, 0.026],
        zenith: [0.003, 0.006, 0.02],
        horizon: [0.018, 0.028, 0.056],
        haze: [0.022, 0.032, 0.058],
        ring: [1.0, 0.94, 0.8],
        warm: [1.0, 0.6, 0.28],
        lamp: 1.3,
        leaves: 'maple',
        leaf: [0.55, 0.04, 0.03],
        snow: 0,
        relief: 1,
        mist: [0.42, 1, 1],
        stars: 0.9,
        mistBank: true,
        meteor: true,
        bird: false,
        faller: 'maple',
        motes: [
            falling(MOTE_SHAPE.maple, 14, 0.05, [0.2, 0.03, 0.025], [0.34, 0.07, 0.035], 0.95),
            dust(40, 0.3),
        ],
        bloom: {
            strength: 0.32, radius: 0.6, threshold: 0.72, breath: 0.4,
        },
        grade: {
            shadows: [0.93, 0.97, 1.05], highlights: [1.03, 1.0, 0.95], saturation: 0.9, contrast: 1.06, vignette: 0.5,
        },
        exposure: 1.05,
    },
    {
        id: 'snow-dawn',
        name: 'Snowy Dawn',
        lightDir: [-0.55, 0.3, 0.78],
        light: [1.0, 0.7, 0.52],
        power: 0.95,
        lightGlow: 3.2,
        skylight: [0.1, 0.13, 0.22],
        sandlight: [0.9, 0.86, 0.88],
        sand: [0.82, 0.84, 0.9],
        moss: [0.03, 0.06, 0.03],
        rock: [0.3, 0.29, 0.28],
        lichen: [0.42, 0.45, 0.42],
        plaster: [0.4, 0.3, 0.22],
        tile: [0.06, 0.065, 0.075],
        hedge: [0.02, 0.035, 0.032],
        ridge: [0.1, 0.12, 0.2],
        zenith: [0.1, 0.15, 0.3],
        horizon: [0.5, 0.36, 0.4],
        haze: [0.3, 0.28, 0.36],
        ring: [1.0, 0.82, 0.66],
        warm: [1.0, 0.58, 0.3],
        lamp: 0.7,
        leaves: 'none',
        leaf: [0.3, 0.2, 0.15],
        snow: 1,
        relief: 0.55,
        mist: [0.5, 0.7, 1.4],
        stars: 0,
        meteor: false,
        bird: true,
        faller: null,
        motes: [
            {
                // Snow, falling slowly through the still dawn air; flakes near the lens drift by out of focus.
                motion: MOTE_MOTION.fall,
                shape: MOTE_SHAPE.flake,
                count: 120,
                size: 0.024,
                speed: 0.22,
                spread: 1.0,
                depth: 2.4,
                bokeh: 0.22,
                spin: 0.3,
                colorA: [0.85, 0.9, 1.0],
                colorB: [1.0, 0.92, 0.88],
                gain: 0.75,
            },
        ],
        bloom: {
            strength: 0.26, radius: 0.6, threshold: 0.86, breath: 0.35,
        },
        grade: {
            shadows: [0.94, 0.98, 1.08],
            highlights: [1.04, 1.0, 0.97],
            saturation: 0.95,
            contrast: 1.04,
            vignette: 0.42,
        },
        exposure: 0.95,
    },
    {
        id: 'spring-dusk',
        name: 'Spring Dusk',
        lightDir: [0.42, 0.14, 0.9],
        light: [1.0, 0.62, 0.46],
        power: 0.62,
        lightGlow: 2.6,
        skylight: [0.05, 0.045, 0.09],
        sandlight: [0.85, 0.75, 0.75],
        sand: [0.62, 0.6, 0.58],
        moss: [0.035, 0.085, 0.03],
        rock: [0.36, 0.33, 0.31],
        lichen: [0.47, 0.5, 0.45],
        plaster: [0.38, 0.27, 0.18],
        tile: [0.06, 0.06, 0.07],
        hedge: [0.018, 0.034, 0.024],
        ridge: [0.03, 0.022, 0.05],
        zenith: [0.025, 0.025, 0.085],
        horizon: [0.42, 0.2, 0.15],
        haze: [0.1, 0.07, 0.1],
        ring: [1.0, 0.82, 0.78],
        warm: [1.0, 0.6, 0.3],
        lamp: 1.3,
        leaves: 'blossom',
        leaf: [1.0, 0.62, 0.72],
        snow: 0,
        relief: 1,
        mist: [0.36, 0.8, 1.1],
        stars: 0.35,
        meteor: false,
        bird: true,
        faller: 'petal',
        motes: [
            falling(MOTE_SHAPE.petal, 30, 0.026, [0.5, 0.3, 0.34], [0.66, 0.4, 0.44], 0.9),
            dust(24, 0.25, [1.0, 0.8, 0.7], [0.9, 0.85, 1.0]),
        ],
        bloom: {
            strength: 0.34, radius: 0.62, threshold: 0.74, breath: 0.4,
        },
        grade: {
            shadows: [0.96, 0.95, 1.06],
            highlights: [1.05, 0.99, 0.95],
            saturation: 0.98,
            contrast: 1.05,
            vignette: 0.5,
        },
        exposure: 1.05,
    },
    {
        id: 'morning-rain',
        name: 'Morning Rain',
        lightDir: [0.2, 0.8, 0.55],
        light: [0.56, 0.6, 0.66],
        power: 0.62,
        lightGlow: 0.5,
        skylight: [0.09, 0.1, 0.12],
        sandlight: [0.62, 0.62, 0.64],
        sand: [0.4, 0.4, 0.39],
        moss: [0.04, 0.1, 0.03],
        rock: [0.22, 0.22, 0.21],
        lichen: [0.35, 0.4, 0.33],
        plaster: [0.3, 0.24, 0.18],
        tile: [0.04, 0.045, 0.05],
        hedge: [0.02, 0.045, 0.025],
        ridge: [0.15, 0.16, 0.18],
        zenith: [0.15, 0.16, 0.18],
        horizon: [0.21, 0.22, 0.24],
        haze: [0.19, 0.2, 0.22],
        ring: [0.95, 0.95, 0.9],
        warm: [1.0, 0.6, 0.28],
        lamp: 1.0,
        leaves: 'maple',
        leaf: [0.3, 0.95, 0.2],
        snow: 0,
        relief: 0.85,
        mist: [0.6, 1.4, 2.2],
        stars: 0,
        wet: 1,
        rain: true,
        mistBank: true,
        meteor: false,
        bird: false,
        faller: 'maple',
        motes: [
            falling(MOTE_SHAPE.maple, 6, 0.045, [0.05, 0.12, 0.03], [0.08, 0.16, 0.04], 0.9),
        ],
        bloom: {
            strength: 0.28, radius: 0.6, threshold: 0.8, breath: 0.35,
        },
        grade: {
            shadows: [0.97, 1.0, 1.03], highlights: [1.02, 1.0, 0.98], saturation: 0.88, contrast: 1.04, vignette: 0.45,
        },
        exposure: 1.0,
    },
]);

export function createZenWorld({ u, quality, mood }) {
    const { octaves } = quality;
    const look = MOODS.find((entry) => entry.id === mood?.id) ?? MOODS[0];
    const MOON_DIR = unit(look.lightDir);
    const MOON = vec3(...MOON_DIR);
    const MOONLIGHT = vec3(...look.light);
    const MOON_POWER = look.power;
    const SKYLIGHT = vec3(...look.skylight);
    /** Light thrown back off the pale ground: a little warmer than the light itself. */
    const SANDLIGHT = vec3(...look.sandlight);
    const SAND = vec3(...look.sand);
    const MOSS = vec3(...look.moss);
    const ROCK = vec3(...look.rock);
    const LICHEN = vec3(...look.lichen);
    const PLASTER = vec3(...look.plaster);
    const TILE = vec3(...look.tile);
    const HEDGE = vec3(...look.hedge);
    const RIDGE = vec3(...look.ridge);
    const SKY_ZENITH = vec3(...look.zenith);
    const SKY_HORIZON = vec3(...look.horizon);
    const HAZE = vec3(...look.haze);
    const RING_LIGHT = vec3(...look.ring);
    const WARM = vec3(...look.warm);
    const LAMP_POWER = look.lamp;
    const MAPLE_LEAF = vec3(...look.leaf);
    /** Snow's own colour: it takes the key light and the sky's fill like the sand does. */
    const SNOW = vec3(0.88, 0.9, 0.95);
    const { snow } = look;
    const veilFn = makeVeil(look);
    const marchSteps = Math.round(12 + 14 * quality.detail);
    const shadowSteps = quality.detail >= 0.6 ? 5 : 3;
    const tables = createTables(MOON_DIR);
    const { row } = tables;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const breath = u.breathSoft.toVar();

        // The camera, seated on the veranda. Tall screens look down more steeply, so the garden
        // recedes up the frame; the eye height follows so the main stone's foot stays put.
        const tall = u.ext.y.sub(1).div(1.16).saturate().toVar();
        const spread = clamp(u.ext.x.div(1.78), 0.45, 1).toVar();
        const shift = mix(float(0.6), float(1.55), tall).toVar();
        const focal = mix(float(2.5), float(3.0), tall).toVar();
        const eyeH = shift.sub(HERO_Y).mul(HERO_Z).div(focal).toVar();
        // The breathing camera: the pan slides the eye, the dolly carries it toward the hero point.
        const pace = float(HERO_Z).div(focal).toVar();
        const rest = vec3(u.pan.x.mul(pace), eyeH.add(u.pan.y.mul(pace)), 0);
        const aim = vec3(0, pace.mul(-HERO_Y), HERO_Z);
        const eye = mix(rest, aim, float(1).sub(float(1).div(u.zoom))).toVar();
        const dir = vec3(p.x.div(focal), p.y.sub(shift).div(focal), 1).toVar();
        const view = normalize(dir).toVar();
        const reach = length(dir).toVar();
        const half = normalize(MOON.sub(view)).toVar();
        const toMoon = dot(view, MOON).toVar();
        // One pixel, in metres per metre of depth.
        const pxm = u.px.div(focal).toVar();
        const down = dir.y.negate().max(1e-4).toVar();
        const tg = eye.y.div(down).min(400).toVar();
        const gx = eye.x.add(dir.x.mul(tg)).toVar();
        const gz = eye.z.add(tg).toVar();
        const drift = u.time.mul(0.04).add(u.seed.mul(37)).toVar();
        const ringAt = mix(float(RING_REST), float(RING_FULL), breath).toVar();
        // The lantern's flame: it breathes slowly, never flickers fast.
        const lampX = float(LANTERN.x).mul(spread.max(0.6)).toVar();
        const lamp = vec3(lampX, LANTERN.flame, LANTERN.z).toVar();
        const flame = u.time.mul(1.7).sin().mul(0.05).add(u.time.mul(2.9).add(1.3).sin().mul(0.035))
            .add(1)
            .mul(LAMP_POWER)
            .toVar();
        /** Warm light reaching a surface at `at` with normal `n` (inverse square, from the fire box). */
        const lampOn = (at, n) => {
            const to = lamp.sub(at).toVar();
            const d2 = dot(to, to).toVar();
            return WARM.mul(flame).mul(dot(n, to.div(sqrt(d2))).max(0)).div(d2.max(0.35));
        };

        /** Thin cloud drifting under the moon: its soft shade wanders slowly over the garden (~a minute across). */
        const cloudShade = (x, z) => float(1).sub(smoothstep(0.42, 0.7, fbm(vec2(
            x.mul(0.11).add(u.time.mul(0.018)),
            z.mul(0.16).sub(u.time.mul(0.006)),
        ), 3)).mul(0.24));

        // The view, packed once for the mist (a shader function every surface calls).
        const eyeR = vec4(eye, reach).toVar();
        const dirD = vec4(dir, down).toVar();
        const scene = vec4(toMoon, drift, u.time, ringAt).toVar();
        const lampF = vec4(lamp, flame).toVar();
        const view4 = [eyeR, dirD, scene, lampF, spread];
        const veil = (colour, t, height, ringGlow = 1) => veilFn(colour, t, height, float(ringGlow), ...view4);

        /** The raked garden floor: sand, moss islands, shadows, the breath ring. */
        const garden = () => {
            // A pixel's footprint on the sand (m): across, and much longer in depth.
            const fx = pxm.mul(tg).toVar();
            const fz = fx.mul(tg).div(eyeH).toVar();
            const ground = vec2(gx, gz).toVar();
            const isles = GROUPS.map((group) => islandField(gx, gz, group.island, spread));
            const rings = isles.map((isle, index) => ({
                d: isle.d.sub(GROUPS[index].island.extra * RAKE), grad: isle.grad,
            })).reduce((a, b) => smoothUnion(a, b, 0.7));

            // Long rakes, gently meandering as a hand draws them, and the rings round the islands.
            const a1 = gx.mul(0.42).add(gz.mul(0.23)).add(1.3).toVar();
            const a2 = gx.mul(1.15).sub(gz.mul(0.37)).add(4.1).toVar();
            const straight = gz.add(a1.sin().mul(0.16)).add(a2.sin().mul(0.05)).toVar();
            const across = vec2(
                a1.cos().mul(0.16 * 0.42).add(a2.cos().mul(0.05 * 1.15)),
                a1.cos().mul(0.16 * 0.23).sub(a2.cos().mul(0.05 * 0.37)).add(1),
            ).toVar();
            const phaseR = rings.d.mul(RAKE_K).toVar();
            const phaseS = straight.mul(RAKE_K).toVar();
            const heightR = profile(phaseR).toVar();
            const heightS = profile(phaseS).toVar();
            // The straight furrows dip into the rake's last ring groove instead of crossing it.
            const k = rings.d.sub(RING_ZONE).div(RAKE * 0.8).saturate().toVar();
            const w = k.mul(k).mul(float(3).sub(k.mul(2))).toVar();
            const wd = k.mul(float(1).sub(k)).mul(6 / (RAKE * 0.8)).toVar();
            const inner = rings.d.lessThan(RING_ZONE).toVar();
            const slopeR = rings.grad.mul(profileSlope(phaseR).mul(RAKE_K)).toVar();
            const slopeS = across.mul(profileSlope(phaseS).mul(RAKE_K).mul(w))
                .add(rings.grad.mul(heightS.sub(GROOVE).mul(wd))).toVar();
            const height = select(inner, heightR, mix(float(GROOVE), heightS, w)).toVar();
            const slope = select(inner, slopeR, slopeS).toVar();
            // Where a furrow is narrower than a few pixels its relief fades (no moiré far away).
            const along = select(inner, rings.grad, across).toVar();
            const rate = vec2(along.x.mul(fx), along.y.mul(fz)).length().div(RAKE);
            const relief = fadeOut(0.14, 0.34, rate).toVar();
            // A hand-raked bed: the furrows run a little deeper here, a little softer there.
            const rough = gnoise(ground.mul(1.3)).mul(0.5).add(0.75);
            const tilt = slope.mul(RELIEF * look.relief).mul(relief).mul(rough).toVar();
            const normal = normalize(vec3(tilt.x.negate(), 1, tilt.y.negate())).toVar();
            const crest = height.sub(GROOVE).div(2).toVar();
            const cavity = mix(float(0.75), crest.mul(0.6).add(0.4), relief).toVar();

            // Moon shadows: each stone (closest approach of the moonbeam to its ellipsoid), and the
            // wall's band of shade along the back. Stones also darken the sand round their feet.
            const shade = float(1).toVar();
            const contact = float(1).toVar();
            const at = vec3(gx, 0, gz).toVar();
            Loop(tables.rocks.count, ({ i }) => {
                const where = row(tables.rocks, i, 0).toVar();
                const size = row(tables.rocks, i, 2).toVar();
                const moonward = row(tables.rocks, i, 3).toVar();
                const centre = vec3(where.x.add(spread.sub(1).mul(where.w)), where.y, where.z);
                const o = intoRockBy(at.sub(centre), row(tables.rocks, i, 1).toVar()).div(size.xyz).toVar();
                const ol = dot(o, moonward.xyz).toVar();
                const beam = ol.negate().div(moonward.w).toVar();
                const miss = sqrt(dot(o, o).sub(ol.mul(ol).div(moonward.w)).max(0));
                const soft = beam.mul(0.07).add(0.05).div(size.w).min(0.7)
                    .toVar();
                const blocked = fadeOut(float(0.97).sub(soft), float(0.97).add(soft), miss)
                    .mul(smoothstep(0, 0.2, beam));
                shade.mulAssign(float(1).sub(blocked.mul(0.92)));
                const foot = smoothstep(0.95, float(0.35).div(size.w).add(1), o.length());
                contact.mulAssign(mix(float(0.35), float(1), foot));
            });
            shade.mulAssign(cloudShade(gx, gz));
            const toWall = float(WALL_Z).sub(gz).div(MOON_DIR[2]).toVar();
            const pen = toWall.mul(0.035).add(0.03);
            const overWall = toWall.mul(MOON_DIR[1]).sub(WALL_H + CAP_H);
            shade.mulAssign(float(1).sub(fadeOut(pen.negate(), pen, overWall).mul(0.9)));

            // The sand: pale granite, a little darker where it lies damp.
            const tone = fbm(ground.mul(0.55), Math.max(3, octaves - 2)).mul(0.26).add(0.87);
            const speck = gnoise(ground.mul(52)).sub(0.5).mul(fadeOut(0.006, 0.02, fz)).mul(0.6);
            const albedo = SAND.mul(tone).mul(speck.add(1)).toVar();
            const ndl = dot(normal, MOON).toVar();
            // A crisp terminator: sand lit at a low angle shows hard-edged light and shade.
            const lit = smoothstep(-0.02, 0.22, ndl).mul(ndl.max(0)).mul(shade).toVar();
            const sand = albedo.mul(MOONLIGHT.mul(lit.mul(MOON_POWER)).add(SKYLIGHT.mul(cavity).mul(normal.y))).toVar();
            sand.addAssign(MOONLIGHT.mul(power(dot(normal, half).max(0), 12)).mul(shade).mul(0.04));
            if (look.wet) {
                // Rain-darkened sand: water stands in the grooves and mirrors the grey sky.
                const pool = fadeOut(0.12, 0.3, crest).mul(relief).toVar();
                sand.assign(mix(sand, SKY_HORIZON.mul(1.5).add(sand.mul(0.2)), pool.mul(0.5 * look.wet)));
                sand.addAssign(MOONLIGHT.mul(power(dot(normal, half).max(0), 6)).mul(0.08 * look.wet));
            }
            // The lantern's pool of warm light; its platform shades the sand right at its foot.
            const lampward = vec2(gx.sub(lampX), gz.sub(LANTERN.z)).length();
            const warmth = lampOn(at, normal).mul(smoothstep(1.1, 2.1, lampward).mul(0.8).add(0.2)).toVar();
            sand.addAssign(albedo.mul(warmth));

            // The breath ring: moonlight on the sand at one distance from the main stone's moss. It
            // lights the crests most, and leaves a faint glow on the sand it has crossed.
            const d0 = isles[0].d;
            const g0 = isles[0].grad;
            const perPx = vec2(g0.x.mul(fx), g0.y.mul(fz)).length();
            const width = max(float(0.045), perPx.mul(3.2)).toVar();
            const off = d0.sub(ringAt).toVar();
            // The ring shimmers as it rests: a slow, drifting unevenness along it (sampled on the
            // direction round the stone, so there is no seam), each stretch changing over seconds.
            const mainIsle = vec2(spread.mul(GROUPS[0].island.c[0]), GROUPS[0].island.c[1]);
            const round = ground.sub(mainIsle).add(vec2(1e-4, 0)).normalize();
            const shimmer = gnoise(round.mul(2.4).add(vec2(u.time.mul(0.11), u.time.mul(-0.07)))).mul(0.42).add(0.79);
            const ring = exp(off.mul(off).div(width.mul(width)).negate()).mul(shimmer).toVar();
            const halo = exp(off.mul(off).div(width.mul(width).mul(6)).negate()).mul(0.22);
            const wake = smoothstep(ringAt.sub(1.6), ringAt, d0).mul(fadeOut(ringAt.sub(0.05), ringAt.add(0.2), d0))
                .mul(0.12);
            const ringLight = ring.mul(crest.mul(1.6).add(0.3)).add(halo).add(wake).toVar();
            sand.addAssign(RING_LIGHT.mul(albedo).mul(ringLight));

            // Grain mirrors: a few sand grains catch the moon. Each sits in its own cell, is a pixel
            // or two wide on screen, and turns slowly; inside the breath ring they blaze.
            const cell = ground.div(GRAIN).toVar();
            const id = cell.floor().toVar();
            const r1 = hash22(id).toVar();
            const r2 = hash22(id.add(31.7)).toVar();
            const offset = cell.fract().sub(r1.mul(0.6).add(0.2)).mul(GRAIN).toVar();
            const inPx = vec2(offset.x.div(fx), offset.y.div(fz));
            const spot = exp(dot(inPx, inPx).mul(-0.7)).toVar();
            const facet = normalize(normal.add(vec3(r2.x.sub(0.5), 0, r2.y.sub(0.5)).mul(0.9))).toVar();
            const align = power(dot(facet, half).max(0), 24);
            const twinkle = r1.x.mul(0.6).add(0.25).mul(u.time).add(r2.x.mul(TAU))
                .sin()
                .mul(0.5)
                .add(0.5)
                .toVar();
            const visible = fadeOut(0.35, 0.75, fz.div(GRAIN)).toVar();
            const glint = spot.mul(align).mul(twinkle).mul(smoothstep(0.55, 0.65, r2.y)).mul(visible)
                .mul(shade.mul(0.7).add(0.3));
            sand.addAssign(MOONLIGHT.mul(glint).mul(ring.mul(9).add(0.5)));
            const lampHalf = normalize(lamp.sub(at).normalize().sub(view));
            const lampGlint = power(dot(facet, lampHalf).max(0), 24);
            sand.addAssign(warmth.mul(spot).mul(lampGlint).mul(smoothstep(0.55, 0.65, r2.y)).mul(visible)
                .mul(6));

            // Moss islands with soft, fuzzy edges; a moss border at the near edge of the garden.
            const nearest = min(isles[0].d, min(isles[1].d, isles[2].d)).toVar();
            const fuzz = gnoise(ground.mul(4.7)).sub(0.5).mul(0.16)
                .add(gnoise(ground.mul(13.3)).sub(0.5).mul(0.06))
                .toVar();
            const edge = max(fx, fz).add(0.015);
            const wave = gnoise(vec2(gx.mul(1.1), 2.7)).sub(0.5).mul(0.22)
                .add(gnoise(vec2(gx.mul(3.7), 5.1)).sub(0.5).mul(0.06));
            const border = float(BORDER_Z).add(wave).sub(gz).toVar();
            const moss = fadeOut(edge.negate(), edge, nearest.add(fuzz))
                .max(smoothstep(edge.negate(), edge, border)).toVar();
            const clump = gnoise(ground.mul(8.5)).toVar();
            const fine = gnoise(ground.mul(29)).sub(0.5).mul(fadeOut(0.004, 0.012, fz));
            const mossAlbedo = MOSS.mul(clump.mul(0.9).add(0.55)).mul(fine.add(1)).toVar();
            if (snow > 0) {
                // Snow lies on the moss too, the tallest clumps showing through.
                mossAlbedo.assign(mix(mossAlbedo, SAND.mul(0.95), fadeOut(0.8, 0.97, clump).mul(snow)));
            }
            // Each island is a low cushion: its rim rolls down to the sand, catching the moon on the
            // side that faces it. Its clumps catch the light too.
            // (The near border is a bank too: it rolls down toward the garden.)
            const bank = border.greaterThan(nearest.add(fuzz).negate()).toVar();
            const isleOut = select(
                isles[0].d.lessThan(min(isles[1].d, isles[2].d)),
                isles[0].grad,
                select(isles[1].d.lessThan(isles[2].d), isles[1].grad, isles[2].grad),
            ).toVar();
            const outward = select(bank, vec2(0, 1), isleOut).toVar();
            const roll = smoothstep(-0.3, 0.0, select(bank, border.negate(), nearest.add(fuzz))).mul(0.9);
            const cushion = normalize(vec3(outward.x.mul(roll), 1, outward.y.mul(roll)));
            const clumpLit = dot(cushion, MOON).max(0).mul(clump.mul(0.7).add(0.65));
            const mossColor = mossAlbedo.mul(MOONLIGHT.mul(shade.mul(clumpLit).mul(MOON_POWER)).add(SKYLIGHT)).toVar();
            // Dew on the moss: a softer, sparser sparkle.
            mossColor.addAssign(MOONLIGHT.mul(spot).mul(smoothstep(0.9, 0.94, r2.y)).mul(twinkle).mul(shade)
                .mul(0.25)
                .mul(visible));
            mossColor.addAssign(RING_LIGHT.mul(ring.add(halo)).mul(mossAlbedo).mul(0.8));
            mossColor.addAssign(mossAlbedo.mul(warmth).mul(1.4));

            // A gutter of dark pebbles along the foot of the wall.
            const gutter = smoothstep(WALL_Z - 0.42, WALL_Z - 0.3, gz);
            const floor = mix(sand, mossColor, moss).mul(contact).toVar();
            floor.assign(mix(floor, vec3(0.01, 0.012, 0.016).add(SKYLIGHT.mul(0.1)), gutter));
            return veil(floor, tg, float(0));
        };

        /** Beyond the garden: the wall, the shrubs over it, the borrowed ridges and the sky. */
        const beyond = () => {
            // The sky: deep blue overhead, paler toward the horizon and the moon (up and right, out of frame).
            const up = view.y.toVar();
            const sky = mix(SKY_HORIZON, SKY_ZENITH, smoothstep(-0.02, 0.32, up)).toVar();
            const moonGlow = exp(toMoon.sub(1).mul(4)).mul(0.12).add(exp(toMoon.sub(1).mul(1.3)).mul(0.03));
            sky.addAssign(MOONLIGHT.mul(moonGlow).mul(look.lightGlow));
            // A few long, thin clouds, silvered toward the moon.
            const lift = up.max(0).add(0.08).toVar();
            const cloudQ = vec2(view.x.div(lift).mul(0.9).add(drift.mul(0.3)), float(1).div(lift).mul(1.6));
            const cloud = smoothstep(0.52, 0.8, fbm(cloudQ.mul(vec2(0.5, 1.8)), Math.max(3, octaves - 1)))
                .mul(smoothstep(0.0, 0.08, up));
            const silvered = SKY_HORIZON.mul(0.8).add(MOONLIGHT.mul(exp(toMoon.sub(1).mul(2)).mul(0.08).add(0.012)));
            sky.assign(mix(sky, silvered, cloud.mul(0.7)));
            if (look.stars > 0) {
                sky.addAssign(starfield(p, u, look.stars).mul(smoothstep(0.02, 0.14, up)).mul(float(1).sub(cloud))
                    .mul(0.85));
            }
            if (look.meteor) {
                // Now and then a meteor crosses the strip of night above the ridges (measured from the
                // top of the screen, so it finds the sky on every shape of screen).
                const fromTop = p.sub(vec2(0, u.ext.y.sub(u.focus)));
                sky.addAssign(shootingStar(fromTop, u, {
                    period: 23,
                    duration: 1.4,
                    chance: 0.6,
                    salt: 3.3,
                    area: [-1.3, -0.1, 1.3, -0.02],
                    travel: 0.4,
                    length: 0.22,
                    color: [0.8, 0.88, 1.0],
                }).mul(float(1).sub(cloud.mul(0.8))));
            }
            const c = sky.toVar();

            // Borrowed scenery: two far ridges in the night haze, the nearer darker, valley mist between.
            [[0.075, 0.05, 1.1, 2.3, 0.72], [0.035, 0.07, 2.4, 7.1, 0.42]].forEach(([base, amp, freq, seed, fog]) => {
                const crestLine = float(base)
                    .add(fbm(vec2(dir.x.mul(freq).add(seed), seed), Math.max(3, octaves - 1)).sub(0.5).mul(amp * 2));
                const over = dir.y.sub(crestLine).toVar();
                const mask = fadeOut(pxm.negate(), pxm, over);
                const rim = exp(over.min(0).mul(140)).mul(0.6).add(0.4);
                const hill = mix(RIDGE.mul(rim), sky, fog).add(MOONLIGHT.mul(exp(over.min(0).mul(60))).mul(0.01));
                c.assign(mix(c, hill, mask));
                c.addAssign(MOONLIGHT.mul(exp(over.mul(over).mul(-1600)).mul(0.012)).mul(1 - fog));
            });

            // Clipped shrubs beyond the wall (o-karikomi): a row of rounded domes, each its own
            // width and height. Their tops face the moon behind them, so a silver rim runs along them.
            const th = float(HEDGE_Z).sub(eye.z).toVar();
            const hy = eye.y.add(dir.y.mul(th)).toVar();
            const hx = eye.x.add(dir.x.mul(th)).toVar();
            const top = float(0).toVar();
            const side = float(0).toVar();
            // Two interleaved sets of domes of different widths, so no rhythm repeats.
            Loop(tables.domes.count, ({ i }) => {
                const set = row(tables.domes, i).toVar();
                const cid = hx.div(set.x).floor().add(set.w).toVar();
                const r = hash22(vec2(cid, set.y)).toVar();
                const across = hx.sub(cid.add(r.x.mul(0.6).add(0.2)).mul(set.x))
                    .div(r.y.mul(0.5).add(set.x.mul(0.42))).toVar();
                const dome = r.x.mul(0.5).add(set.z).mul(sqrt(float(1).sub(across.mul(across)).max(0))).toVar();
                side.assign(select(dome.greaterThan(top), across, side));
                top.assign(max(top, dome));
            });
            // Leafy, not smooth: the outline frays into clumps and sprigs.
            const leafy = gnoise(vec2(hx.mul(3.4), hy.mul(3.4))).sub(0.5).mul(0.1)
                .add(gnoise(vec2(hx.mul(11), hy.mul(11))).sub(0.5).mul(0.04));
            const inside = top.add(leafy).sub(hy).toVar();
            const fh = pxm.mul(th).mul(1.2);
            const clumps = gnoise(vec2(hx, hy).mul(4.5)).mul(0.6).add(gnoise(vec2(hx, hy).mul(14)).mul(0.4)).toVar();
            const rimLit = exp(inside.max(0).mul(-14)).mul(side.mul(0.35).add(0.65)).toVar();
            let hedge = HEDGE.mul(clumps.mul(0.9).add(0.3))
                .add(MOONLIGHT.mul(rimLit.mul(0.1).add(smoothstep(0.55, 0.8, clumps).mul(0.012))).mul(clumps));
            if (snow > 0) {
                // Snow caps every dome, broken where sprigs poke through.
                const capped = fadeOut(0.03, 0.16, inside).mul(smoothstep(0.3, 0.55, clumps)).mul(snow);
                hedge = mix(hedge, SNOW.mul(SKYLIGHT.mul(1.5).add(MOONLIGHT.mul(rimLit.mul(0.25).add(0.05)))), capped);
            }
            c.assign(mix(c, mix(hedge, HAZE, 0.18), smoothstep(fh.negate(), fh, inside)));

            // The wall: a tiled cap over oil-stained plaster, lit only by the moonlit sand below it.
            const tw = float(WALL_Z).sub(eye.z).toVar();
            const wy = eye.y.add(dir.y.mul(tw)).toVar();
            const wx = eye.x.add(dir.x.mul(tw)).toVar();
            const fw = pxm.mul(tw).mul(1.2).toVar();
            const capTop = float(WALL_H + CAP_H);
            // Round tiles run up the cap: each catches a little moon on the flank turned toward it.
            const ribPhase = wx.div(0.26).fract().sub(0.5).mul(Math.PI)
                .toVar();
            const ribLit = dot(normalize(vec3(ribPhase.sin(), ribPhase.cos().mul(0.9), -0.45)), MOON).max(0);
            const aged = gnoise(vec2(wx.mul(1.7), wy.mul(4))).toVar();
            const tileLight = MOONLIGHT.mul(ribLit.mul(0.22).add(0.14).mul(MOON_POWER)).add(SKYLIGHT);
            const cap = TILE.mul(aged.mul(0.8).add(0.6)).mul(tileLight)
                .toVar();
            // The ridge of the cap is edged with moonlight from behind.
            cap.addAssign(MOONLIGHT.mul(exp(capTop.sub(wy).max(0).mul(-90))).mul(0.09));
            cap.mulAssign(smoothstep(WALL_H, WALL_H + 0.1, wy).mul(0.65).add(0.35));
            if (snow > 0) {
                // A bank of snow along the cap, its edge catching the low sun.
                const heap = gnoise(vec2(wx.mul(6), 1.7)).mul(0.03);
                const bank = smoothstep(WALL_H + CAP_H - 0.1, WALL_H + CAP_H - 0.06, wy.add(heap));
                cap.assign(mix(cap, SNOW.mul(SKYLIGHT.mul(1.6).add(MOONLIGHT.mul(MOON_POWER * 0.12))), bank.mul(snow)));
            }
            const stain = fbm(vec2(wx.mul(0.6), wy.mul(1.5)), Math.max(3, octaves - 1)).toVar();
            const streaks = gnoise(vec2(wx.mul(9), wy.mul(0.8))).mul(0.25).add(0.85);
            const plaster = PLASTER.mul(stain.mul(0.75).add(0.45)).mul(streaks).toVar();
            const bounce = SANDLIGHT.mul(MOON_POWER * 0.22).mul(fadeOut(0, WALL_H, wy).mul(0.5).add(0.5));
            const under = smoothstep(WALL_H - 0.25, WALL_H, wy);
            const face = plaster.mul(bounce.add(SKYLIGHT.mul(0.6))).mul(float(1).sub(under.mul(0.65))).toVar();
            face.mulAssign(smoothstep(0.0, 0.07, wy).mul(0.7).add(0.3));
            // The lantern's glow pools on the plaster behind it.
            const pool = lampOn(vec3(wx, wy, WALL_Z), vec3(0, 0, -1)).toVar();
            face.addAssign(plaster.mul(pool).mul(0.9));
            cap.addAssign(TILE.mul(pool).mul(1.5));
            const wall = mix(face, cap, smoothstep(WALL_H - 0.005, WALL_H + 0.005, wy));
            c.assign(mix(c, veil(wall, tw, wy), fadeOut(capTop.sub(fw), capTop.add(fw), wy)));
            return c;
        };

        const col = vec3(0).toVar();
        If(gz.lessThan(WALL_Z), () => {
            col.assign(garden());
        }).Else(() => {
            col.assign(beyond());
        });

        // The lantern: a card at its own depth, its outline the union of its stacked stones. Its parts
        // are drawn in its own units (world metres / scale), the fire box's flame at 1.06.
        const lt = float(LANTERN.z).sub(eye.z).toVar();
        const lx = eye.x.add(dir.x.mul(lt)).sub(lampX).div(LANTERN.scale).toVar();
        const ly = eye.y.add(dir.y.mul(lt)).div(LANTERN.scale).toVar();
        If(gz.greaterThan(LANTERN.z).and(lx.abs().lessThan(0.5)).and(ly.lessThan(1.7)), () => {
            const ax = lx.abs().toVar();
            const shape = float(1e3).toVar();
            Loop(tables.parts.count, ({ i }) => {
                const part = row(tables.parts, i).toVar();
                const top = part.w.abs().toVar();
                const s = ly.sub(part.x).div(part.y.sub(part.x)).saturate().toVar();
                const swept = top.add(float(1).sub(s).mul(float(1).sub(s)).mul(part.z.sub(top)));
                const hw = mix(mix(part.z, top, s), swept, select(part.w.lessThan(0), float(1), float(0)));
                shape.assign(min(shape, max(ax.sub(hw), max(part.x.sub(ly), ly.sub(part.y)))));
            });
            const lp = pxm.mul(lt).div(LANTERN.scale).toVar();
            const cover = fadeOut(lp.negate(), lp, shape).toVar();
            // Granite, rounded at its edges: a silver rim on the moon's side, warm light where the fire
            // box spills onto the platform and under the roof.
            const inset = shape.negate().max(0).toVar();
            const edge = fadeOut(0.0, 0.05, inset).toVar();
            const grain = gnoise(vec2(lx, ly).mul(16)).mul(0.5).add(0.75);
            const mossTop = smoothstep(1.27, 1.33, ly).mul(gnoise(vec2(lx, ly).mul(9)).mul(0.6).add(0.4));
            const body = mix(vec3(0.24, 0.23, 0.21).mul(grain), MOSS.mul(1.6), mossTop).toVar();
            if (snow > 0) {
                // Snow on the roof and on the platform's ledge.
                const ledge = smoothstep(1.28, 1.32, ly).add(smoothstep(0.9, 0.915, ly).mul(fadeOut(0.925, 0.94, ly)))
                    .saturate();
                body.assign(mix(body, SNOW.mul(2.2), ledge.mul(snow)));
            }
            const roofUp = smoothstep(1.24, 1.3, ly).mul(fadeOut(1.44, 1.48, ly));
            const lit = edge.mul(smoothstep(0.0, 0.05, lx)).mul(0.5).add(roofUp.mul(0.35));
            const stoneLight = MOONLIGHT.mul(lit.add(0.06).mul(MOON_POWER)).add(SKYLIGHT.mul(0.5));
            const glow = exp(ly.sub(1.06).abs().mul(-9)).mul(exp(ax.mul(-5)));
            const underRoof = smoothstep(1.17, 1.2, ly).mul(fadeOut(1.215, 1.24, ly)).mul(smoothstep(0.15, 0.2, ax));
            const onPlatform = smoothstep(0.88, 0.91, ly).mul(fadeOut(0.92, 0.935, ly)).mul(smoothstep(0.15, 0.2, ax));
            const spill = glow.mul(0.5).add(underRoof.mul(1.2)).add(onPlatform);
            const lantern = body.mul(stoneLight.add(WARM.mul(flame).mul(spill)))
                .toVar();
            // The fire box's window: a warm paper glow with a dark centre bar.
            const pane = smoothstep(0.0, 0.01, float(0.09).sub(ax)).mul(smoothstep(0.96, 0.975, ly))
                .mul(fadeOut(1.145, 1.16, ly));
            const bar = smoothstep(0.006, 0.012, ax);
            const light = WARM.mul(flame).mul(float(2.6).sub(ly.sub(1.06).abs().mul(10))).mul(bar.mul(0.85).add(0.15));
            lantern.assign(mix(lantern, light, pane));
            col.assign(mix(col, veil(lantern, lt, ly.mul(LANTERN.scale)), cover));
        });
        // The warm air round the lamp (painted, so it glows on tiers without bloom too).
        const lampFrom = lamp.sub(eye).toVar();
        const lampOff = lampFrom.sub(dir.mul(dot(lampFrom, dir).div(reach.mul(reach)))).toVar();
        const lampAir = dot(lampOff, lampOff).toVar();
        col.addAssign(WARM.mul(flame).mul(exp(lampAir.mul(-14)).mul(0.11).add(exp(lampAir.mul(-1.2)).mul(0.025))));

        // The stones, sphere-traced: each is an ellipsoid cut by fracture planes, weathered by noise.
        /** Lichen is crusty, never a flat coat: break each patch up into rosettes. */
        const speckle = (at) => smoothstep(0.35, 0.6, gnoise3(at.mul(29).add(4.4))).mul(0.7).add(0.3);
        const rockField = (at) => stoneField(at, spread);

        // Only rays that pass near a stone march.
        const a = dot(dir, dir).toVar();
        const tStart = float(1e4).toVar();
        const tEnd = float(0).toVar();
        Loop(tables.bounds.count, ({ i }) => {
            const where = row(tables.bounds, i, 0).toVar();
            const oc = eye.sub(vec3(where.x.add(spread.sub(1).mul(where.w)), where.y, where.z)).toVar();
            const b = dot(oc, dir).toVar();
            const disc = b.mul(b).sub(a.mul(dot(oc, oc).sub(row(tables.bounds, i, 1).x))).toVar();
            const s = sqrt(disc.max(0)).toVar();
            const near = b.negate().sub(s).div(a);
            const far = b.negate().add(s).div(a);
            tStart.assign(select(disc.greaterThan(0), min(tStart, near.max(0.1)), tStart));
            tEnd.assign(select(disc.greaterThan(0), max(tEnd, far), tEnd));
        });
        tEnd.assign(min(tEnd, tg.add(0.1)));
        If(tStart.lessThan(tEnd), () => {
            const t = tStart.toVar();
            const best = float(1e4).toVar();
            const bestT = tStart.toVar();
            const hit = float(0).toVar();
            Loop(marchSteps, () => {
                const d = rockField(eye.add(dir.mul(t))).toVar();
                const ratio = d.div(pxm.mul(t)).toVar();
                If(ratio.lessThan(best), () => {
                    best.assign(ratio);
                    bestT.assign(t);
                });
                If(ratio.lessThan(0.25), () => {
                    hit.assign(1);
                    Break();
                });
                t.addAssign(d.mul(0.85).max(0.002));
                If(t.greaterThan(tEnd), () => {
                    Break();
                });
            });
            const at = eye.add(dir.mul(bestT)).toVar();
            const pixel = pxm.mul(bestT).toVar();
            // A soft outer fringe from the closest approach; the stone's foot meets the sand softly.
            const cover = select(hit.greaterThan(0.5), float(1), float(1).sub(best).mul(0.5).saturate())
                .mul(at.y.div(pixel).add(0.5).saturate())
                .toVar();
            If(cover.greaterThan(0.002), () => {
                const e = 0.0035;
                const probe = (o) => rockField(at.add(o)).sub(grit(at.add(o)));
                const k1 = vec3(1, -1, -1);
                const k2 = vec3(-1, -1, 1);
                const k3 = vec3(-1, 1, -1);
                const k4 = vec3(1, 1, 1);
                const normal = normalize(k1.mul(probe(k1.mul(e))).add(k2.mul(probe(k2.mul(e))))
                    .add(k3.mul(probe(k3.mul(e))))
                    .add(k4.mul(probe(k4.mul(e))))
                    .add(vec3(0, 1e-6, 0))).toVar();
                // Creases between the stones' faces stay dark: how open the surface is a hand away.
                const open = rockField(at.add(normal.mul(0.07))).div(0.07).saturate().mul(0.55)
                    .add(0.45)
                    .toVar();
                // The stone's own shadow (a ledge shading the face below it), a short soft march.
                const sun = float(1).toVar();
                const st = float(0.04).toVar();
                Loop(shadowSteps, () => {
                    const h = rockField(at.add(MOON.mul(st))).toVar();
                    sun.assign(min(sun, h.mul(10).div(st).saturate()));
                    st.addAssign(h.max(0.03));
                });
                const tint = gnoise3(at.mul(0.45)).toVar();
                const crack = fadeOut(0.0, 0.03, gnoise3(at.mul(3.1).add(1.7)).sub(0.5).abs())
                    .mul(fadeOut(0.5, 0.8, open)).toVar();
                // Lichen: a few broad pale patches, and small round spots scattered over the faces.
                const lichen = max(
                    smoothstep(0.63, 0.7, gnoise3(at.mul(4.3).add(8.1))).mul(speckle(at))
                        .mul(smoothstep(-0.1, 0.5, normal.y)),
                    smoothstep(0.72, 0.78, gnoise3(at.mul(17).add(2.9))).mul(0.8),
                ).mul(normal.y.mul(0.5).add(0.5));
                const mossy = smoothstep(0.55, 0.9, normal.y.add(tint.sub(0.5).mul(0.8)))
                    .add(fadeOut(0.05, 0.28, at.y.add(tint.sub(0.5).mul(0.3)))).saturate()
                    .toVar();
                const stoneTone = mix(vec3(0.9, 0.95, 1.03), vec3(1.05, 1.0, 0.94), tint);
                // Granite grain and the pits the weather has opened (the bump's own low points stay dark).
                const speck = gnoise3(at.mul(43)).sub(0.5).mul(fadeOut(0.003, 0.012, pixel)).mul(0.6)
                    .add(1);
                const pits = grit(at).div(0.07).add(0.5).saturate()
                    .mul(0.6)
                    .add(0.55)
                    .toVar();
                // Weathering: blotches of darker stone, and rain stains running down the faces.
                const blotch = gnoise3(at.mul(3.3).add(5.5)).mul(0.9).add(0.55);
                const stain = smoothstep(0.45, 0.75, gnoise3(vec3(at.x.mul(9), at.y.mul(0.9), at.z.mul(9)))).mul(0.45);
                const albedo = mix(
                    mix(ROCK.mul(stoneTone).mul(blotch).mul(speck).mul(float(1).sub(stain)), LICHEN, lichen.mul(0.65)),
                    MOSS.mul(speckle(at.mul(0.45)).mul(0.9).add(0.35)),
                    mossy.mul(0.85),
                )
                    .mul(float(1).sub(crack.mul(0.7))).toVar();
                if (snow > 0) {
                    // Snow on every face that looks up, thinning off the steeper ones.
                    const lying = smoothstep(0.58, 0.84, normal.y.add(tint.sub(0.5).mul(0.4)));
                    albedo.assign(mix(albedo, SNOW, lying.mul(snow)));
                }
                const ndl = dot(normal, MOON).toVar();
                const direct = smoothstep(-0.05, 0.3, ndl).mul(ndl.max(0)).mul(sun).mul(cloudShade(at.x, at.z));
                const fill = dot(normal, BOUNCE).mul(0.5).add(0.5).toVar();
                const ambient = SKYLIGHT.mul(normal.y.mul(0.4).add(0.6))
                    .add(SANDLIGHT.mul(MOON_POWER * 0.5).mul(fill.mul(fill))
                        .mul(fadeOut(0.0, 1.4, at.y).mul(0.4).add(0.6)));
                const foot = smoothstep(0.0, 0.25, at.y).mul(0.4).add(0.6);
                const light = MOONLIGHT.mul(direct.mul(MOON_POWER)).add(ambient.mul(open));
                const stone = albedo.mul(light).mul(foot).mul(pits)
                    .toVar();
                // A damp sheen on the tops, a cool rim where the surface turns from the eye toward the moon.
                const wet = look.wet
                    ? smoothstep(-0.2, 0.9, normal.y).mul(float(1).sub(mossy.mul(0.4))).mul(1.6)
                    : smoothstep(0.3, 0.9, normal.y).mul(float(1).sub(mossy.mul(0.6)));
                stone.addAssign(MOONLIGHT.mul(power(dot(normal, half).max(0), 32)).mul(wet.mul(0.7).add(0.04)).mul(sun)
                    .mul(MOON_POWER));
                const facing = float(1).sub(dot(normal, view.negate()).saturate());
                stone.addAssign(MOONLIGHT.mul(power(facing, 4)).mul(ndl.max(0)).mul(sun).mul(0.2));
                // The breath ring lights the foot of a stone as it passes.
                const isle = islandField(at.x, at.z, GROUPS[0].island, spread);
                const near = isle.d.sub(ringAt).toVar();
                // (Its light comes up off the sand: faces turned down and out take most of it.)
                const fromSand = normal.y.negate().add(0.35).saturate().mul(0.7)
                    .add(0.3);
                stone.addAssign(RING_LIGHT.mul(albedo).mul(exp(near.mul(near).mul(-25)))
                    .mul(exp(at.y.mul(-4)))
                    .mul(fromSand)
                    .mul(0.6));
                col.assign(mix(col, veil(stone, bestT, at.y, 0.2), cover));
            });
        });

        if (look.bird) {
            // Now and then a bird crosses the upper frame, wings beating slowly: a dark silhouette
            // against the bright sky and the snow or the afterglow.
            const flight = eventWindow(u.time, float(29), float(12), float(0.75), u.seed.mul(17.3).add(8.8)).toVar();
            const birdShow = flight.x.mul(u.life).toVar();
            If(birdShow.greaterThan(0.001), () => {
                const heading = select(hash21(vec2(flight.z, 2.2)).greaterThan(0.5), float(1), float(-1)).toVar();
                const top = u.ext.y.sub(u.focus);
                const bx = mix(u.ext.x.negate().sub(0.2), u.ext.x.add(0.2), flight.y).mul(heading);
                const by = top.sub(mix(float(0.1), float(0.26), hash21(vec2(flight.z, 5.1))))
                    .add(sin(flight.y.mul(3.8).add(flight.z.mul(9))).mul(0.03));
                const bq = layer(p, u, 1.5).sub(vec2(bx, by)).div(0.072).toVar();
                const flap = sin(u.time.mul(5.5).add(flight.z.mul(20))).toVar();
                const ax = bq.x.abs().toVar();
                // Each wing an arched blade from the body to its tip, raised or lowered by the beat.
                const wingY = ax.mul(0.9).sub(ax.mul(ax).mul(0.4)).mul(flap.mul(0.6)).add(ax.mul(0.12));
                const thick = float(1).sub(ax).max(0).pow(0.7)
                    .mul(0.12)
                    .add(0.02);
                const wing = fadeOut(thick.sub(0.05), thick.add(0.05), bq.y.sub(wingY).abs())
                    .mul(fadeOut(0.95, 1.02, ax));
                const body = fadeOut(0.85, 1.15, vec2(bq.x.div(0.24), bq.y.add(0.03).div(0.09)).length());
                const bird = max(wing, body).mul(birdShow).mul(0.88);
                col.assign(mix(col, vec3(0.012, 0.011, 0.016).add(HAZE.mul(0.2)), bird));
            });
        }

        // A Japanese maple reaches in over the top-right corner, near the lens and out of focus. Its
        // leaves are backlit by the moon behind them: they glow a deep translucent crimson.
        const corner = vec2(u.ext.x, u.ext.y.sub(u.focus));
        // The branch sways about the corner, and dips a little with each in-breath.
        const sway = u.time.mul(0.42).sin().mul(0.012).add(breath.mul(0.01));
        const mq = turn(layer(p, u, MAPLE_K).sub(corner), sway).toVar();
        If(mq.x.greaterThan(MAPLE.left).and(mq.y.greaterThan(MAPLE.low)), () => {
            const blur = float(0.011);
            const bark = float(0).toVar();
            const upper = float(0).toVar();
            Loop(tables.segments.count, ({ i }) => {
                const seg = row(tables.segments, i, 0).toVar();
                const wide = row(tables.segments, i, 1).toVar();
                const ba = seg.zw.sub(seg.xy).toVar();
                const pa = mq.sub(seg.xy).toVar();
                const h = dot(pa, ba).div(wide.z).saturate().toVar();
                const off = pa.sub(ba.mul(h)).toVar();
                const width = mix(wide.x, wide.y, h).toVar();
                const m = fadeOut(width.sub(blur), width.add(blur), off.length()).toVar();
                upper.assign(max(upper, m.mul(smoothstep(0.0, 1.0, off.y.div(width)))));
                bark.assign(max(bark, m));
            });
            let twig = vec3(0.004, 0.003, 0.003).add(MOONLIGHT.mul(upper).mul(0.025));
            if (snow > 0) {
                // Snow lies along the top of the bough and every twig.
                twig = mix(twig, SNOW.mul(SKYLIGHT.mul(1.4).add(MOONLIGHT.mul(MOON_POWER * 0.2))), upper.mul(snow));
            }
            if (look.leaves === 'none') {
                col.assign(mix(col, twig, bark.mul(0.97)));
            } else {
                const blossom = look.leaves === 'blossom';
                const leaf = float(0).toVar();
                const vein = float(0).toVar();
                const depth = float(0).toVar();
                Loop(tables.leaves.count, ({ i }) => {
                    const place = row(tables.leaves, i, 0).toVar();
                    const leafLook = row(tables.leaves, i, 1).toVar();
                    const flutter = u.time.mul(leafLook.y).add(leafLook.z).sin().mul(0.08);
                    // Blossoms are smaller than the maple's leaves.
                    const size = blossom ? place.w.mul(0.62) : place.w;
                    const local = turn(mq.sub(place.xy), place.z.add(flutter)).div(size).toVar();
                    const r = local.length().toVar();
                    // Five lobes (|sin| keeps the atan seam at the stem; nudged off the origin: atan(0, 0)
                    // is undefined in GLSL).
                    const angle = local.x.atan(local.y.add(1e-5)).toVar();
                    const lobe = float(1).sub(angle.mul(2.5).sin().abs()).toVar();
                    // Maple: a broad palm and five lobes that taper to points (lobe^0.6: wide at the base,
                    // sharp tip), the lower pair smaller. Blossom: five round petals, each notched at its tip.
                    const outline = blossom
                        ? lobe.max(1e-4).pow(0.3).mul(0.7).add(0.25)
                            .sub(exp(lobe.sub(1).mul(60)).mul(0.08))
                        : lobe.max(1e-4).pow(0.6).mul(0.56).add(0.44)
                            .mul(angle.cos().mul(0.24).add(0.76));
                    const soft = blur.div(size);
                    const m = fadeOut(outline.sub(soft), outline.add(soft), r).toVar();
                    // Later leaves lie over earlier ones.
                    depth.assign(mix(depth, leafLook.x, m));
                    leaf.assign(max(leaf, m));
                    // Maple: the veins; blossom: the deeper pink at the heart of the flower.
                    const mark = blossom ? fadeOut(0.12, 0.4, r) : exp(lobe.sub(1).mul(r).mul(r).mul(60)).mul(0.25);
                    vein.assign(mix(vein, mark, m));
                });
                const backlit = toMoon.max(0).toVar();
                const glowLeaf = blossom
                    ? mix(MAPLE_LEAF, vec3(0.9, 0.3, 0.42), vein.mul(0.7)).mul(backlit.mul(0.16).add(0.05))
                        .mul(depth.mul(0.5).add(0.5))
                    : MAPLE_LEAF.mul(backlit.mul(0.12).add(0.02)).mul(depth).mul(float(1).sub(vein));
                const maple = mix(twig, glowLeaf, leaf.mul(float(1).sub(bark)));
                col.assign(mix(col, maple, max(leaf, bark).mul(0.97)));
            }
        });

        if (look.mistBank) {
            // Now and then a bank of mist drifts slowly across the garden and on, over half a minute.
            const bank = eventWindow(u.time, float(41), float(26), float(0.8), u.seed.mul(11.1).add(6.6)).toVar();
            const bankShow = bank.x.mul(u.life).toVar();
            If(bankShow.greaterThan(0.001), () => {
                const heading = select(hash21(vec2(bank.z, 7.7)).greaterThan(0.5), float(1), float(-1));
                const centre = mix(float(-2.4), float(2.4), bank.y).mul(heading).mul(u.ext.x.min(1.4));
                const bq = layer(p, u, 1.2).toVar();
                const lowY = mix(float(-0.25), float(0.15), hash21(vec2(bank.z, 1.9)));
                const wq = vec2(bq.x.mul(0.9).sub(bank.y.mul(heading).mul(2.2)), bq.y.mul(2.6));
                const wisp = fbm(wq.add(bank.z.mul(31)), 3);
                const across = bq.x.sub(centre).div(u.ext.x.mul(0.8)).toVar();
                const rise = bq.y.sub(lowY).div(0.5).toVar();
                const veilAmount = smoothstep(0.25, 0.65, wisp).mul(exp(across.mul(across).negate()))
                    .mul(exp(rise.mul(rise).negate())).mul(bankShow)
                    .mul(0.75);
                // Lit through by the key light: a pale veil that softens whatever lies behind it.
                col.assign(mix(col, HAZE.mul(1.5).add(MOONLIGHT.mul(0.1 * MOON_POWER + 0.04)), veilAmount));
            });
        }

        if (look.rain) {
            // Fine rain, in two depths: thin streaks, slightly slanted, faint against the grey (it
            // thins out while a session holds still and is gone under reduced motion).
            const rain = float(0).toVar();
            [[70, 9.0, 0.55, 0.6], [34, 6.5, 0.4, 1.0]].forEach(([scale, speed, amount, gain]) => {
                const rq = layer(p, u, gain > 0.8 ? 2.5 : 1.3).toVar();
                const g = vec2(rq.x.add(rq.y.mul(0.1)).mul(scale), rq.y.mul(scale / 9).add(u.time.mul(speed))).toVar();
                const cell = g.floor().toVar();
                const f = g.fract().toVar();
                const h = hash22(cell.add(scale)).toVar();
                const dx = f.x.sub(h.x.mul(0.6).add(0.2)).toVar();
                const w = u.px.mul(scale).mul(0.9).max(0.02);
                const streak = exp(dx.mul(dx).div(w.mul(w)).negate())
                    .mul(smoothstep(h.y.mul(0.5), h.y.mul(0.5).add(0.12), f.y))
                    .mul(fadeOut(h.y.mul(0.5).add(0.3), h.y.mul(0.5).add(0.45), f.y))
                    .mul(step(hash21(cell.add(7.3)), amount));
                rain.addAssign(streak.mul(gain));
            });
            col.addAssign(vec3(0.62, 0.66, 0.72).mul(rain).mul(0.075).mul(u.life));
        }

        if (look.faller) {
            // Now and then a single leaf (or petal) comes down close to the lens, spiralling, turning
            // over as it falls: out of focus, slow, never a flash.
            const fall = eventWindow(u.time, float(31), float(13), float(0.7), u.seed.mul(23.9).add(1.4)).toVar();
            const fallShow = fall.x.mul(u.life).toVar();
            If(fallShow.greaterThan(0.001), () => {
                const petal = look.faller === 'petal';
                const top = u.ext.y.sub(u.focus);
                const fx = mix(float(-0.75), float(0.75), hash21(vec2(fall.z, 3.3))).mul(u.ext.x)
                    .add(sin(fall.y.mul(TAU * 1.3).add(fall.z.mul(40))).mul(0.22));
                const fy = mix(top.add(0.15), top.sub(u.ext.y.mul(2)).sub(0.15), fall.y);
                const spin = fall.y.mul(TAU * 2.2).add(fall.z.mul(TAU));
                const flip = sin(fall.y.mul(TAU * 1.7).add(fall.z.mul(13))).abs().mul(0.75).add(0.25);
                const fsize = petal ? 0.04 : 0.075;
                const fl = turn(layer(p, u, 3).sub(vec2(fx, fy)), spin).div(fsize).toVar();
                const fq = vec2(fl.x.div(flip), fl.y).toVar();
                const fr = fq.length().toVar();
                const fa = fq.x.atan(fq.y.add(1e-5)).toVar();
                let outline;
                if (petal) {
                    // One petal: broad, rounded toward its notched tip.
                    const t = fq.y.add(1).mul(0.5).saturate();
                    const halfW = sin(t.pow(0.62).mul(Math.PI)).max(0).pow(0.75).mul(0.62);
                    outline = { d: fq.x.abs().sub(halfW).max(fq.y.abs().sub(1)) };
                } else {
                    const lobe = float(1).sub(fa.mul(2.5).sin().abs());
                    outline = {
                        d: fr.sub(lobe.max(1e-4).pow(0.6).mul(0.56).add(0.44)
                            .mul(fa.cos().mul(0.24).add(0.76))),
                    };
                }
                const blurred = fadeOut(-0.06, 0.06, outline.d).mul(fallShow).toVar();
                const tone = petal
                    ? MAPLE_LEAF.mul(toMoon.max(0).mul(0.14).add(0.06))
                    : MAPLE_LEAF.mul(toMoon.max(0).mul(0.1).add(0.03));
                col.assign(mix(col, tone.mul(flip.mul(0.4).add(0.6)), blurred.mul(0.92)));
            });
        }

        // The garden brightens a little as the lungs fill.
        return col.mul(breath.mul(0.08).add(0.96));
    })();

    return {
        backdrop,
        motes: look.motes,
        bloom: look.bloom,
        grade: look.grade,
        camera: { dolly: 0.04, drift: [0.03, 0.012], period: 70 },
        exposure: look.exposure,
    };
}
