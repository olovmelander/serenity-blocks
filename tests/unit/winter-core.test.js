/**
 * Winter — the plan (winter-core.js): the ground, the eye, the moon, the trees, the fox's round
 * and the small maths the choreography runs on. Structure and invariants only: the tuned numbers
 * are read from the module, never copied here.
 */

import { describe, expect, it } from 'vitest';
import {
    DEG,
    EYE,
    EYE_HEIGHT,
    FOX_ROUND,
    FOX_STATIONS,
    FRAME_TREES,
    FULL_GHOST_WITHIN,
    HOURS,
    HOUR_KEYS,
    ICE_Y,
    LAKE_Y,
    MOON,
    REST_RIG,
    RING_REACH,
    bearingFor,
    fovForAspect,
    foxAt,
    foxRound,
    glowDirection,
    groundHeight,
    groundNormal,
    groundSample,
    halfWidthFor,
    lakeMask,
    landDistance,
    linRGB,
    moonDirection,
    pieceColor,
    plantTrees,
    powerForCombo,
    ringArrival,
    ringRadius,
    smooth,
} from '../../src/themes/winter/winter-core.js';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 430 / 932;
/** Frames from a tall phone to an ultrawide monitor. */
const ASPECTS = [0.4, PORTRAIT, 9 / 16, 3 / 4, 1, 4 / 3, 16 / 10, LANDSCAPE, 21 / 9, 32 / 9];

/** Points of the lake's open ice in front of the viewer, well clear of every shore. */
function openIce() {
    const points = [];
    for (let z = -60; z >= -220; z -= 8) {
        for (let x = -150; x <= 150; x += 10) {
            if (lakeMask(x, z) === 1) points.push([x, z]);
        }
    }
    return points;
}

describe('winter plan: the ground', () => {
    it('is zero under the viewer\'s boots, where the eye stands', () => {
        expect(groundHeight(0, 0)).toBe(0);
        expect(EYE).toEqual({ x: 0, y: EYE_HEIGHT, z: 0 });
        expect(EYE_HEIGHT).toBeGreaterThan(1);
    });

    it('lays the lake as flat ice under the snowfield, and calls it lake', () => {
        // The ice lies lower than the snow the viewer stands on.
        expect(ICE_Y).toBeLessThan(0);
        expect(Number.isFinite(LAKE_Y)).toBe(true);
        const ice = openIce();
        // The lake fills most of the middle distance.
        expect(ice.length).toBeGreaterThan(200);
        ice.forEach(([x, z]) => {
            expect(landDistance(x, z), `(${x}, ${z})`).toBeLessThan(0);
            expect(groundHeight(x, z), `(${x}, ${z})`).toBeCloseTo(ICE_Y, 9);
        });
        // Nothing anywhere lies under the ice.
        for (let z = 20; z >= -400; z -= 7) {
            for (let x = -300; x <= 300; x += 11) {
                expect(groundHeight(x, z), `(${x}, ${z})`).toBeGreaterThanOrEqual(ICE_Y - 1e-9);
                const lake = lakeMask(x, z);
                expect(lake).toBeGreaterThanOrEqual(0);
                expect(lake).toBeLessThanOrEqual(1);
                // The mask and the signed distance agree about which side of the shore a point is.
                if (lake === 1) expect(landDistance(x, z)).toBeLessThan(0);
                if (landDistance(x, z) > 1) expect(lake).toBe(0);
            }
        }
    });

    it('keeps the viewer\'s snowfield land, down to the shore', () => {
        for (let z = -3; z >= -18; z -= 0.5) {
            expect(landDistance(0, z), `z = ${z}`).toBeGreaterThan(0);
            expect(lakeMask(0, z), `z = ${z}`).toBe(0);
            expect(groundHeight(0, z), `z = ${z}`).toBeGreaterThan(ICE_Y);
            // A snowfield, not a hillside: within a couple of metres of the viewer's own level.
            expect(Math.abs(groundHeight(0, z)), `z = ${z}`).toBeLessThan(2);
        }
        // Straight ahead the land ends and the lake begins before the far shore.
        let shore = null;
        for (let z = -18; z >= -80 && shore === null; z -= 0.5) {
            if (lakeMask(0, z) === 1) shore = z;
        }
        expect(shore).not.toBeNull();
    });

    it('climbs behind the far shore into fells', () => {
        const nearSnow = groundHeight(0, -10);
        let highest = -Infinity;
        for (let z = -1500; z >= -7000; z -= 250) {
            for (let x = -3000; x <= 3000; x += 250) highest = Math.max(highest, groundHeight(x, z));
        }
        expect(highest).toBeGreaterThan(nearSnow + 100);
        expect(Number.isFinite(highest)).toBe(true);
    });

    it('gives a unit normal that points up, straight up on the ice', () => {
        const n = [0, 0, 0];
        for (let z = 10; z >= -3000; z -= 37) {
            for (let x = -600; x <= 600; x += 53) {
                groundNormal(x, z, 0.25, n);
                expect(Math.hypot(n[0], n[1], n[2]), `(${x}, ${z})`).toBeCloseTo(1, 12);
                expect(n[1], `(${x}, ${z})`).toBeGreaterThan(0);
            }
        }
        // (Only where the whole stencil lies on the ice is the answer exactly up.)
        const flat = openIce().filter(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .every(([dx, dz]) => lakeMask(x + dx, z + dz) === 1));
        expect(flat.length).toBeGreaterThan(100);
        flat.forEach(([x, z]) => {
            groundNormal(x, z, 0.25, n);
            expect(n[0]).toBeCloseTo(0, 9);
            expect(n[1]).toBeCloseTo(1, 9);
            expect(n[2]).toBeCloseTo(0, 9);
        });
        // The default sample and a caller's own array.
        const own = [9, 9, 9];
        expect(groundNormal(3, -8, 0.25, own)).toBe(own);
        expect(groundNormal(3, -8)).toEqual(own);
    });

    it('samples the height and the distance inland in one evaluation of the plan', () => {
        const out = [9, 9];
        for (let z = 20; z >= -3000; z -= 61) {
            for (let x = -700; x <= 700; x += 47) {
                expect(groundSample(x, z, out)).toBe(out);
                // The very numbers the two separate functions give.
                expect(out[0], `(${x}, ${z})`).toBe(groundHeight(x, z));
                expect(out[1], `(${x}, ${z})`).toBe(landDistance(x, z));
            }
        }
        expect(groundSample(0, 0)).toEqual([0, landDistance(0, 0)]);
    });

    it('steps smoothly between two edges given in either order', () => {
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 0, 0.25)).toBeCloseTo(1 - smooth(0, 1, 0.25), 12);
        expect(smooth(2, 4, 3.5)).toBeGreaterThan(smooth(2, 4, 3));
    });
});

describe('winter plan: the eye and the frame', () => {
    it('holds the horizontal field of view and clamps the vertical one', () => {
        expect(REST_RIG.minFov).toBeLessThan(REST_RIG.maxFov);
        ASPECTS.forEach((aspect) => {
            const fov = fovForAspect(aspect);
            expect(fov, `aspect ${aspect}`).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fov, `aspect ${aspect}`).toBeLessThanOrEqual(REST_RIG.maxFov);
        });
        // A frame too wide or too tall to hold it is clamped...
        expect(fovForAspect(8)).toBe(REST_RIG.minFov);
        expect(fovForAspect(0.3)).toBe(REST_RIG.maxFov);
        // ...and between the clamps the horizontal field is the rig's own.
        const free = ASPECTS.filter((aspect) => fovForAspect(aspect) > REST_RIG.minFov
            && fovForAspect(aspect) < REST_RIG.maxFov);
        expect(free.length).toBeGreaterThan(1);
        free.forEach((aspect) => {
            expect((halfWidthFor(aspect) * 2) / DEG, `aspect ${aspect}`).toBeCloseTo(REST_RIG.hFov, 9);
        });
        // The wider the frame, the lower the lens (never higher).
        for (let i = 1; i < ASPECTS.length; i++) {
            expect(fovForAspect(ASPECTS[i])).toBeLessThanOrEqual(fovForAspect(ASPECTS[i - 1]));
        }
        // Nonsense in, the default frame out.
        for (const bad of [NaN, Infinity, undefined]) expect(fovForAspect(bad)).toBe(fovForAspect(LANDSCAPE));
        expect(Number.isFinite(fovForAspect(0))).toBe(true);
        expect(Number.isFinite(halfWidthFor(0))).toBe(true);
    });

    it('shows a narrower half width on an upright screen', () => {
        expect(halfWidthFor(PORTRAIT)).toBeLessThan(halfWidthFor(LANDSCAPE));
        for (let i = 1; i < ASPECTS.length; i++) {
            expect(halfWidthFor(ASPECTS[i])).toBeGreaterThanOrEqual(halfWidthFor(ASPECTS[i - 1]) - 1e-12);
        }
        ASPECTS.forEach((aspect) => {
            expect(halfWidthFor(aspect)).toBeGreaterThan(0);
            expect(halfWidthFor(aspect)).toBeLessThan(Math.PI / 2);
        });
    });

    it('lays bearings out in fractions of the half width the frame is planned for', () => {
        // Wide screens stop spreading at the planned half width, and a sliver of a screen stops
        // folding everything together: both ends are read from the function itself.
        const cap = bearingFor(1, 8);
        const floor = bearingFor(1, 0.2);
        expect(floor).toBeLessThan(cap);
        expect(bearingFor(1, 16)).toBeCloseTo(cap, 12);
        ASPECTS.forEach((aspect) => {
            // Fraction 1 is the edge of the frame, capped.
            const edge = Math.min(cap, Math.max(floor, halfWidthFor(aspect)));
            expect(bearingFor(1, aspect), `aspect ${aspect}`).toBeCloseTo(edge, 12);
            expect(bearingFor(0, aspect)).toBe(0);
            // Odd in the fraction, and monotonic.
            let previous = -Infinity;
            for (let fraction = -1.4; fraction <= 1.4001; fraction += 0.1) {
                const bearing = bearingFor(fraction, aspect);
                expect(bearing).toBeGreaterThan(previous);
                expect(bearingFor(-fraction, aspect)).toBeCloseTo(-bearing, 12);
                previous = bearing;
            }
        });
        // Where the frame is neither capped nor floored, fraction 1 is its very edge.
        const uncapped = ASPECTS.filter((aspect) => Math.abs(bearingFor(1, aspect) - halfWidthFor(aspect)) < 1e-9);
        expect(uncapped.length).toBeGreaterThan(0);
        // An upright screen keeps everything, closer together.
        expect(bearingFor(1, PORTRAIT)).toBeLessThan(bearingFor(1, LANDSCAPE));
        expect(bearingFor(0.5, PORTRAIT)).toBeLessThan(bearingFor(0.5, LANDSCAPE));
    });
});

describe('winter plan: the moon and the last light', () => {
    it('hangs the moon to the right, ahead and well up, nearer the middle on an upright screen', () => {
        ASPECTS.forEach((aspect) => {
            const moon = moonDirection(aspect);
            expect(Math.hypot(moon[0], moon[1], moon[2]), `aspect ${aspect}`).toBeCloseTo(1, 12);
            expect(moon[0], `aspect ${aspect}`).toBeGreaterThan(0);
            expect(moon[1], `aspect ${aspect}`).toBeGreaterThan(0);
            expect(moon[2], `aspect ${aspect}`).toBeLessThan(0);
            // Its height does not depend on the frame; its bearing is the plan's fraction.
            expect(Math.asin(moon[1])).toBeCloseTo(MOON.elevation, 12);
            expect(Math.atan2(moon[0], -moon[2])).toBeCloseTo(bearingFor(MOON.fraction, aspect), 12);
            // Inside the frame it is planned for.
            expect(Math.atan2(moon[0], -moon[2])).toBeLessThan(bearingFor(1, aspect));
        });
        const bearing = (aspect) => Math.atan2(moonDirection(aspect)[0], -moonDirection(aspect)[2]);
        expect(bearing(PORTRAIT)).toBeLessThan(bearing(LANDSCAPE));
        const own = [0, 0, 0];
        expect(moonDirection(LANDSCAPE, own)).toBe(own);
    });

    it('lays the twilight along the horizon on the other side', () => {
        ASPECTS.forEach((aspect) => {
            const glow = glowDirection(aspect);
            expect(Math.hypot(glow[0], glow[1])).toBeCloseTo(1, 12);
            expect(glow[0]).toBeLessThan(0);
            expect(glow[1]).toBeLessThan(0);
        });
    });
});

describe('winter plan: the trees', () => {
    const ASK = { mid: 40, far: 180 };

    it('plants the same wood every time', () => {
        expect(plantTrees(LANDSCAPE, ASK)).toEqual(plantTrees(LANDSCAPE, ASK));
        expect(plantTrees(PORTRAIT, ASK)).toEqual(plantTrees(PORTRAIT, ASK));
        // Another seed, another wood (the framing trees are the plan's, whatever the seed).
        const other = plantTrees(LANDSCAPE, { ...ASK, seed: 0x1234 });
        expect(other).not.toEqual(plantTrees(LANDSCAPE, ASK));
        expect(other.slice(0, FRAME_TREES.length)).toEqual(plantTrees(LANDSCAPE, ASK).slice(0, FRAME_TREES.length));
    });

    it('returns the framing trees first, on the ground, where the plan\'s fractions put them', () => {
        expect(FULL_GHOST_WITHIN).toBeGreaterThan(0);
        ASPECTS.forEach((aspect) => {
            const trees = plantTrees(aspect, ASK);
            FRAME_TREES.forEach(([fraction, distance, height, kind, turn], i) => {
                const tree = trees[i];
                expect(tree.frame).toBe(true);
                // The full ghost close by, the next mesh down for a framing tree further off.
                expect(tree.lod, `framing tree ${i}`).toBe(distance > FULL_GHOST_WITHIN ? 1 : 0);
                expect(tree.kind).toBe(kind);
                expect(tree.height).toBe(height);
                expect(tree.turn).toBe(turn);
                expect(tree.y).toBe(groundHeight(tree.x, tree.z));
                expect(Math.hypot(tree.x, tree.z)).toBeCloseTo(distance, 9);
                expect(Math.atan2(tree.x, -tree.z)).toBeCloseTo(bearingFor(fraction, aspect), 9);
                // Left of the board or right of it, never behind it.
                expect(Math.sign(tree.x)).toBe(Math.sign(fraction));
            });
            // Nothing else frames the picture, and nothing else is drawn that finely.
            expect(trees.filter((tree) => tree.frame)).toHaveLength(FRAME_TREES.length);
            trees.slice(FRAME_TREES.length).forEach((tree) => {
                expect(tree.frame).toBe(false);
                expect(tree.lod).toBeGreaterThan(1);
            });
        });
        // A level of detail goes with the distance, not with the frame's shape: the same trees
        // are full ghosts on every screen (the world's instance buckets rely on it).
        const lods = (aspect) => plantTrees(aspect, ASK).map((tree) => tree.lod);
        ASPECTS.forEach((aspect) => expect(lods(aspect), `aspect ${aspect}`).toEqual(lods(LANDSCAPE)));
        expect(lods(LANDSCAPE).slice(0, FRAME_TREES.length)).toContain(0);
        // An upright screen draws them in toward the middle.
        const wide = plantTrees(LANDSCAPE, ASK);
        const tall = plantTrees(PORTRAIT, ASK);
        for (let i = 0; i < FRAME_TREES.length; i++) expect(Math.abs(tall[i].x)).toBeLessThan(Math.abs(wide[i].x));
    });

    // (A regression: one of the left stand's matrons was once planned 34 m out, which is about
    // four metres onto the lake's ice at every aspect.)
    it('stands every framing tree on land', () => {
        ASPECTS.forEach((aspect) => {
            plantTrees(aspect, ASK).slice(0, FRAME_TREES.length).forEach((tree, i) => {
                expect(lakeMask(tree.x, tree.z), `aspect ${aspect}, framing tree ${i}`).toBeLessThan(1);
            });
        });
    });

    it('plants the stands and the far wood on land, as many as asked and no more', () => {
        const trees = plantTrees(LANDSCAPE, ASK);
        const rest = trees.filter((tree) => !tree.frame);
        // Two more levels of detail: the stands on the spits, and the coarsest for the far shore.
        const coarsest = Math.max(...rest.map((tree) => tree.lod));
        const mid = rest.filter((tree) => tree.lod < coarsest);
        const far = rest.filter((tree) => tree.lod === coarsest);
        expect(new Set(mid.map((tree) => tree.lod)).size).toBe(1);
        expect(trees).toHaveLength(FRAME_TREES.length + mid.length + far.length);
        expect(mid.length).toBeLessThanOrEqual(ASK.mid);
        expect(far.length).toBeLessThanOrEqual(ASK.far);
        expect(mid.length).toBeGreaterThan(ASK.mid * 0.5);
        expect(far.length).toBeGreaterThan(ASK.far * 0.5);
        // In order: framing, the stands, the far wood.
        expect(trees.slice(0, FRAME_TREES.length).every((tree) => tree.frame)).toBe(true);
        const lods = rest.map((tree) => tree.lod);
        expect(lods).toEqual([...lods].sort((a, b) => a - b));
        [...mid, ...far].forEach((tree) => {
            expect(lakeMask(tree.x, tree.z)).toBe(0);
            expect(landDistance(tree.x, tree.z)).toBeGreaterThan(0);
            expect(tree.y).toBe(groundHeight(tree.x, tree.z));
            expect(tree.y).toBeGreaterThan(ICE_Y);
            expect(tree.height).toBeGreaterThan(1);
            expect(Number.isFinite(tree.turn)).toBe(true);
            expect(['sentinel', 'matron', 'leaner']).toContain(tree.kind);
            // Ahead of the viewer, inside the bearing a frame can show.
            expect(tree.z).toBeLessThan(0);
        });
        // The stands are not on top of one another; the far wood is beyond everything near.
        mid.forEach((a, i) => {
            for (let k = 0; k < i; k++) expect(Math.hypot(a.x - mid[k].x, a.z - mid[k].z)).toBeGreaterThan(1);
        });
        const framing = Math.max(...FRAME_TREES.map(([, distance]) => distance));
        far.forEach((tree) => expect(Math.hypot(tree.x, tree.z)).toBeGreaterThan(framing));
        // Asking for none plants none; the stands and the far wood do not depend on the frame.
        expect(plantTrees(LANDSCAPE, { mid: 0, far: 0 })).toHaveLength(FRAME_TREES.length);
        expect(plantTrees(PORTRAIT, ASK).slice(FRAME_TREES.length)).toEqual(trees.slice(FRAME_TREES.length));
    });
});

describe('winter plan: the fox\'s round', () => {
    it('is a closed loop over land, sampled evenly, for every frame', () => {
        ASPECTS.forEach((aspect) => {
            const round = foxRound(aspect);
            const { points, count, length } = round;
            expect(points).toHaveLength(count * 3);
            expect(length, `aspect ${aspect}`).toBeGreaterThan(10);
            const stride = length / count;
            let walked = 0;
            for (let i = 0; i < count; i++) {
                const k = (i + 1) % count;
                const x = points[i * 3];
                const z = points[i * 3 + 1];
                expect(Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(points[i * 3 + 2])).toBe(true);
                // On the snowfield in front of the viewer, never on the ice.
                expect(landDistance(x, z), `aspect ${aspect}, sample ${i}`).toBeGreaterThan(1);
                expect(lakeMask(x, z)).toBe(0);
                expect(z).toBeLessThan(0);
                // Evenly spaced (the chord of a gentle curve is a hair shorter than its arc).
                const chord = Math.hypot(points[k * 3] - x, points[k * 3 + 1] - z);
                expect(chord, `aspect ${aspect}, sample ${i}`).toBeGreaterThan(stride * 0.9);
                expect(chord, `aspect ${aspect}, sample ${i}`).toBeLessThan(stride * 1.02);
                walked += chord;
                // The heading is the way to the next sample (to within the curve's own turn).
                const along = Math.atan2(points[k * 3] - x, points[k * 3 + 1] - z);
                const off = Math.atan2(Math.sin(along - points[i * 3 + 2]), Math.cos(along - points[i * 3 + 2]));
                expect(Math.abs(off), `aspect ${aspect}, sample ${i}`).toBeLessThan(0.2);
            }
            expect(walked).toBeGreaterThan(length * 0.98);
            expect(walked).toBeLessThanOrEqual(length * 1.0001);
        });
    });

    it('passes both open sides of the board, narrower on an upright screen', () => {
        const xs = (aspect) => {
            const { points, count } = foxRound(aspect);
            return Array.from({ length: count }, (_, i) => points[i * 3]);
        };
        const wide = xs(LANDSCAPE);
        const tall = xs(PORTRAIT);
        expect(Math.min(...wide)).toBeLessThan(-1);
        expect(Math.max(...wide)).toBeGreaterThan(1);
        expect(Math.max(...tall) - Math.min(...tall)).toBeLessThan(Math.max(...wide) - Math.min(...wide));
        expect(foxRound(PORTRAIT).length).toBeLessThan(foxRound(LANDSCAPE).length);
        // More samples, the same round.
        expect(foxRound(LANDSCAPE, 512).length).toBeCloseTo(foxRound(LANDSCAPE).length, 6);
        expect(foxRound(LANDSCAPE, 64).count).toBe(64);
    });

    it('finds the fox\'s place at any distance, round and round', () => {
        const round = foxRound(LANDSCAPE);
        const { length, count, points } = round;
        // Distance 0 is the first sample; a whole lap later it is there again.
        expect(foxAt(round, 0)).toEqual([points[0], points[1], points[2]]);
        expect(foxAt(round, length)).toEqual(foxAt(round, 0));
        const stride = length / count;
        for (const d of [0.3, length * 0.37, length - 0.01]) {
            const here = foxAt(round, d);
            for (const laps of [-2, -1, 1, 3]) {
                const there = foxAt(round, d + laps * length);
                expect(Math.hypot(there[0] - here[0], there[1] - here[1])).toBeLessThan(1e-3);
            }
        }
        // Continuous through the seam, and everywhere else: a step along it moves it a step.
        const step = stride * 0.25;
        let previous = foxAt(round, -step);
        for (let d = 0; d < length + stride; d += step) {
            const here = foxAt(round, d);
            const moved = Math.hypot(here[0] - previous[0], here[1] - previous[1]);
            expect(moved, `at ${d}`).toBeLessThanOrEqual(step * 1.001);
            expect(moved, `at ${d}`).toBeGreaterThan(step * 0.8);
            // The heading never jumps (it is carried the short way round).
            const turn = Math.atan2(Math.sin(here[2] - previous[2]), Math.cos(here[2] - previous[2]));
            expect(Math.abs(turn), `at ${d}`).toBeLessThan(0.1);
            previous = here;
        }
        // It walks the way it faces.
        for (let d = 0; d < length; d += length / 23) {
            const a = foxAt(round, d);
            const b = foxAt(round, d + 0.05);
            const facing = (b[0] - a[0]) * Math.sin(a[2]) + (b[1] - a[1]) * Math.cos(a[2]);
            expect(facing / 0.05, `at ${d}`).toBeGreaterThan(0.95);
        }
        const own = [0, 0, 0];
        expect(foxAt(round, 5, own)).toBe(own);
    });

    it('marks its stopping places as distances along the round', () => {
        ASPECTS.forEach((aspect) => {
            const round = foxRound(aspect);
            expect(round.stations).toHaveLength(FOX_STATIONS.length);
            round.stations.forEach((station, n) => {
                expect(station, `aspect ${aspect}`).toBeGreaterThanOrEqual(0);
                expect(station, `aspect ${aspect}`).toBeLessThan(round.length);
                // On the bearing of the plan's own knot, and no farther out than the plan puts it
                // (an upright screen draws the round in under the board's foot).
                const [fraction, distance] = FOX_ROUND[FOX_STATIONS[n]];
                const at = foxAt(round, station);
                expect(Math.atan2(at[0], -at[1]), `aspect ${aspect}`).toBeCloseTo(bearingFor(fraction, aspect), 2);
                const away = Math.hypot(at[0], at[1]);
                expect(away, `aspect ${aspect}`).toBeLessThan(distance + 0.3);
                expect(away, `aspect ${aspect}`).toBeGreaterThan(distance * 0.4);
            });
            // One to each side of the board.
            const sides = round.stations.map((station) => Math.sign(foxAt(round, station)[0]));
            expect(new Set(sides).size).toBe(2);
        });
    });
});

describe('winter plan: gameplay maths', () => {
    it('times a ring\'s arrival as the inverse of its radius', () => {
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(-1)).toBe(0);
        expect(ringArrival(0)).toBeCloseTo(0, 12);
        for (const reach of [1, 1.25, 1.8]) {
            const limit = RING_REACH * reach;
            let previous = -1;
            for (let k = 0.02; k < 0.97; k += 0.05) {
                const arrives = ringArrival(limit * k, reach);
                expect(arrives).toBeGreaterThan(previous);
                expect(ringRadius(arrives, reach)).toBeCloseTo(limit * k, 9);
                previous = arrives;
            }
            // It never quite gets to its reach: beyond that it never arrives.
            expect(ringArrival(limit, reach)).toBe(Infinity);
            expect(ringArrival(limit * 3, reach)).toBe(Infinity);
            expect(ringRadius(1e3, reach)).toBeCloseTo(limit, 9);
            expect(ringRadius(1, reach)).toBeLessThan(limit);
        }
        // A longer reach gets there sooner.
        expect(ringArrival(8, 1.25)).toBeLessThan(ringArrival(8, 1));
    });

    it('burns brighter the longer the chain, and never quite at full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-3)).toBe(0);
        let previous = 0;
        for (let combo = 1; combo <= 40; combo++) {
            const power = powerForCombo(combo);
            expect(power).toBeGreaterThan(previous);
            expect(power).toBeLessThan(1);
            previous = power;
        }
        expect(powerForCombo(1)).toBeGreaterThan(0.1);
        expect(powerForCombo(1e6)).toBeLessThanOrEqual(1);
    });

    it('reads a piece\'s colour from a hex string or a number, and falls back when it cannot', () => {
        const fallback = pieceColor(undefined);
        const inRange = (rgb) => {
            expect(rgb).toHaveLength(3);
            rgb.forEach((c) => {
                expect(c).toBeGreaterThan(0);
                expect(c).toBeLessThanOrEqual(1);
            });
        };
        const colours = [
            '#5df2a6', '#eaf6ff', '#6de0ff', '#ff9ccf', '#b79bff', '#ffe2a0', '#4a9fd8', '#ffffff', '#ff0000',
        ];
        colours.forEach((hex) => {
            const rgb = pieceColor(hex);
            inRange(rgb);
            // Peak-normalised: its strongest channel is 1, and it is the hex's strongest too.
            expect(Math.max(...rgb), hex).toBeCloseTo(1, 12);
            const lin = linRGB(Number.parseInt(hex.slice(1), 16));
            expect(rgb.indexOf(Math.max(...rgb))).toBe(lin.indexOf(Math.max(...lin)));
            // The same colour however it is written.
            expect(pieceColor(Number.parseInt(hex.slice(1), 16))).toEqual(rgb);
            expect(pieceColor(hex.slice(1).toUpperCase())).toEqual(rgb);
            expect(pieceColor(` ${hex} `)).toEqual(rgb);
        });
        // The order of a colour's channels survives the push toward its own hue.
        const rose = pieceColor('#ff9ccf');
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(rose[2]).toBeGreaterThan(rose[1]);
        // Different pieces, different lights.
        expect(pieceColor('#5df2a6')).not.toEqual(pieceColor('#ff9ccf'));
        // What cannot be read is the fallback.
        for (const bad of ['', 'rose', '#12', '#12345g', null, undefined, NaN, Infinity, {}, []]) {
            expect(pieceColor(bad), String(bad)).toEqual(fallback);
        }
        inRange(fallback);
        expect(pieceColor('nope', 0xff0000)).toEqual(pieceColor('#ff0000'));
        // Even black gives a light of some colour, never a zero or a NaN.
        inRange(pieceColor(0x000000));
    });

    it('gives every hour both of its ends, in full', () => {
        expect(HOURS.length).toBeGreaterThan(1);
        expect(new Set(HOURS.map((hour) => hour.name)).size).toBe(HOURS.length);
        HOURS.forEach((hour) => {
            expect(typeof hour.name).toBe('string');
            for (const end of ['calm', 'lit']) {
                HOUR_KEYS.forEach((key) => {
                    const colour = hour[end][key];
                    expect(colour, `${hour.name} ${end} ${key}`).toHaveLength(3);
                    colour.forEach((c) => {
                        expect(Number.isFinite(c), `${hour.name} ${end} ${key}`).toBe(true);
                        expect(c, `${hour.name} ${end} ${key}`).toBeGreaterThanOrEqual(0);
                    });
                });
                expect(hour[end].stars).toBeGreaterThanOrEqual(0);
                expect(hour[end].stars).toBeLessThanOrEqual(1);
                // Nothing the world does not ease: every colour of an hour is one of the keys.
                expect(Object.keys(hour[end]).sort()).toEqual([...HOUR_KEYS, 'stars'].sort());
            }
            // The fires make a night of it: the sky is darker lit than calm, the stars no fewer.
            const sum = (c) => c[0] + c[1] + c[2];
            expect(sum(hour.lit.zenith)).toBeLessThan(sum(hour.calm.zenith));
            expect(hour.lit.stars).toBeGreaterThanOrEqual(hour.calm.stars);
        });
    });
});
