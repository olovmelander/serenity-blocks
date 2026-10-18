/**
 * Grainfields — the plan of the land: one height function for everything on the ground, the
 * barley's clumps round the eye, the shelterbelts' trees, the plots and the path.
 *
 * The composition's promise, held by the low view's sight line: the eye stands in the barley and
 * the field rises to a crest whose ears stand at its height, so from the barley's reach to a
 * kilometre and a half out the land lies below the line over the crest's ears: the field is barley
 * all the way to its horizon, never a flat floor. Only the fort's knoll stands above it.
 */
import { describe, expect, it } from 'vitest';
import {
    CREST, DEG, EYE, PLACES, bearingOf, pointAt,
} from '../../src/themes/grainfields/grainfields-core.js';
import {
    BELTS, GRAIN_BEARINGS, PATH, PATH_POINTS, PLOT, beltAt, flowerWidth, grainCover, grainSites, groundHeight,
    groundSlope, nearField, pathDistance, plotAt, treeSites,
} from '../../src/themes/grainfields/grainfields-plan.js';
import { tierFor } from '../../src/themes/grainfields/grainfields-quality.js';

/** The barley's ears stand this high over the ground (metres). */
const EARS = 0.95;
/** Where the near barley ends and the land's own carpet takes over (metres, about the far reach). */
const BARLEY_REACH = 150;
/** The fort's knoll may stand over the line this many degrees either side of its bearing. */
const FORT_WINDOW = 6;

/** Elevation (degrees) of a point `h` metres up at `d` metres from the eye. */
const elevation = (h, d) => Math.atan2(h - EYE.y, d) / DEG;

/** The site table as rows: { x, y, z, scale, seed, yaw, plot, fade }. */
function rowsOf({ data, count }) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const o = i * 8;
        out.push({
            x: data[o], y: data[o + 1], z: data[o + 2], scale: data[o + 3], seed: data[o + 4], yaw: data[o + 5], plot: data[o + 6], fade: data[o + 7],
        });
    }
    return out;
}

const radiusOf = (site) => Math.hypot(site.x - EYE.x, site.z - EYE.z);

describe('Grainfields land: the low view\'s sight line', () => {
    it('keeps the land from the barley\'s reach to 1.5 km below the crest\'s ears, across the widest frame (bar the fort\'s knoll)', () => {
        const fort = bearingOf(PLACES.fort.x, PLACES.fort.z).bearing;
        const point = [0, 0];
        const over = [];
        let knollSeen = false;
        for (let bearing = -44; bearing <= 44; bearing += 0.5) {
            // The crest's horizon: the highest ear seen from the eye, out to the crest.
            let crest = -Infinity;
            for (let d = 2; d <= CREST.distance + CREST.sway; d += 0.5) {
                pointAt(bearing, d, point);
                crest = Math.max(crest, elevation(groundHeight(point[0], point[1]) + EARS, d));
            }
            let land = -Infinity;
            let at = 0;
            for (let d = BARLEY_REACH; d <= 1500; d += 2) {
                pointAt(bearing, d, point);
                const e = elevation(groundHeight(point[0], point[1]), d);
                if (e > land) {
                    land = e;
                    at = d;
                }
            }
            const nearFort = Math.abs(bearing - fort) <= FORT_WINDOW;
            if (land >= crest) {
                if (nearFort) knollSeen = true;
                else over.push(`${bearing}°: the land at ${at} m stands ${(land - crest).toFixed(3)}° over the crest`);
            }
        }
        expect(over).toEqual([]);
        // The exception is real: the knoll does stand over the barley (or the test would be blind to it).
        expect(knollSeen).toBe(true);
    });

    it('raises the near field from the eye\'s ground to the crest, then hands over to the far land', () => {
        expect(groundHeight(EYE.x, EYE.z)).toBeCloseTo(EYE.ground, 9);
        expect(nearField(EYE.x, EYE.z)).toEqual({ h: EYE.ground, behind: 0 });
        const point = [0, 0];
        for (let bearing = -50; bearing <= 50; bearing += 5) {
            let previous = -Infinity;
            // Rising (bar a small ripple) out to the crest's inner edge.
            for (let d = 0; d <= CREST.distance - CREST.sway; d += 4) {
                pointAt(bearing, d, point);
                const { h, behind } = nearField(point[0], point[1]);
                expect(h, `${bearing}° at ${d} m`).toBeGreaterThan(previous - 0.4);
                expect(behind, `${bearing}° at ${d} m`).toBe(0);
                previous = h;
            }
            pointAt(bearing, CREST.distance - CREST.sway, point);
            expect(nearField(point[0], point[1]).h).toBeGreaterThan(EYE.ground + CREST.rise * 0.6);
            pointAt(bearing, (CREST.distance + CREST.sway) * CREST.behind + 1, point);
            expect(nearField(point[0], point[1]).behind, `${bearing}°: the far land has taken over`).toBe(1);
        }
    });
});

describe('Grainfields land: the height', () => {
    it('is finite everywhere the world reads it, out to the far fells', () => {
        const bad = [];
        for (let x = -20000; x <= 20000; x += 250) {
            for (let z = -24000; z <= 2000; z += 250) {
                const h = groundHeight(x, z);
                if (!Number.isFinite(h)) bad.push(`${x}, ${z}: ${h}`);
            }
        }
        expect(bad.slice(0, 5)).toEqual([]);
        // The farmed land stays above the vale's floor; the fort's knoll stands over the vale.
        expect(groundHeight(PLACES.fort.x, PLACES.fort.z)).toBeGreaterThan(PLACES.fort.height * 0.8);
    });

    it('is continuous: a centimetre never moves it more than a few centimetres, and half a centimetre half as much', () => {
        let worst = 0;
        let worstHalf = 0;
        const sites = [];
        // Round the eye, through the crest and the vale, over the knoll, toward the ridges.
        for (let x = -2500; x <= 2500; x += 37.3) {
            for (let z = -3000; z <= 60; z += 41.7) sites.push([x, z]);
        }
        for (let r = 0; r <= PLACES.fort.radius * 2; r += 3.1) {
            for (let a = 0; a < 360; a += 15) sites.push([PLACES.fort.x + r * Math.cos(a * DEG), PLACES.fort.z + r * Math.sin(a * DEG)]);
        }
        for (const [x, z] of sites) {
            const h = groundHeight(x, z);
            const step = Math.max(Math.abs(groundHeight(x + 0.01, z) - h), Math.abs(groundHeight(x, z + 0.01) - h));
            const half = Math.max(Math.abs(groundHeight(x + 0.005, z) - h), Math.abs(groundHeight(x, z + 0.005) - h));
            worst = Math.max(worst, step);
            worstHalf = Math.max(worstHalf, half);
        }
        expect(worst).toBeLessThan(0.03);
        expect(worstHalf / worst).toBeLessThan(0.6);
    });

    it('reads its slope by central differences, matching the height\'s own change', () => {
        const e = 1e-3;
        for (const [x, z] of [[10, -40], [-60, -300], [300, -900], [PLACES.fort.x + 60, PLACES.fort.z]]) {
            const [sx, sz] = groundSlope(x, z);
            expect(Number.isFinite(sx) && Number.isFinite(sz)).toBe(true);
            const fx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
            const fz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
            expect(Math.abs(sx - fx), `${x}, ${z}`).toBeLessThan(0.01);
            expect(Math.abs(sz - fz), `${x}, ${z}`).toBeLessThan(0.01);
        }
    });
});

describe('Grainfields land: the barley round the eye', () => {
    const NEAR = {
        count: 6000, near: 2.5, far: 18, knee: 7, seed: 0x6a7e,
    };

    it('honours the count it is asked for, and never gives more', () => {
        for (const quality of ['Minimal', 'High']) {
            const { grain } = tierFor(quality);
            const near = grainSites({
                count: grain.near, near: 2.5, far: grain.nearReach, knee: 7, seed: 0x6a7e,
            });
            expect(near.count, `${quality} near`).toBe(grain.near);
            expect(near.data).toHaveLength(grain.near * 8);
            if (quality === 'Minimal') {
                const far = grainSites({
                    count: grain.far, near: grain.nearReach * 0.92, far: grain.farReach, seed: 0x6a7f,
                });
                expect(far.count, `${quality} far`).toBe(grain.far);
                expect(far.data).toHaveLength(grain.far * 8);
            }
        }
        // Where little barley grows it stops trying (six tries a site), with what it found.
        const sparse = grainSites({
            count: 400, near: 0.2, far: 2.4, seed: 3,
        });
        expect(sparse.count).toBeLessThan(400);
        expect(sparse.data).toHaveLength(sparse.count * 8);
        expect(grainSites({ count: 0, near: 2.5, far: 18 }).count).toBe(0);
    });

    it('stands every clump within its distances and bearings, where barley grows, on the ground', () => {
        const { far } = NEAR;
        const sites = rowsOf(grainSites(NEAR));
        sites.forEach((s, i) => {
            const label = `site ${i}`;
            const r = radiusOf(s);
            expect(r, label).toBeGreaterThanOrEqual(NEAR.near - 1e-3);
            expect(r, label).toBeLessThanOrEqual(far + 1e-3);
            const { bearing } = bearingOf(s.x, s.z);
            expect(bearing, label).toBeGreaterThanOrEqual(GRAIN_BEARINGS[0] - 1e-3);
            expect(bearing, label).toBeLessThanOrEqual(GRAIN_BEARINGS[1] + 1e-3);
            expect(grainCover(s.x, s.z), label).toBeGreaterThan(0);
            expect(s.y, label).toBeCloseTo(groundHeight(s.x, s.z), 3);
            expect(s.scale >= 0.9 && s.scale <= 1.12 + 1e-6, label).toBe(true);
            expect(s.seed >= 0 && s.seed < 1, label).toBe(true);
            expect(s.yaw >= 0 && s.yaw <= Math.PI * 2 + 1e-6, label).toBe(true);
            expect(s.plot >= 0 && s.plot < 1, label).toBe(true);
            // It fades out over the last eighth of the reach only.
            if (r < far * 0.86) expect(s.fade, label).toBe(1);
            expect(s.fade >= 0 && s.fade <= 1, label).toBe(true);
        });
        // None on the path, none brushing the lens.
        expect(sites.every((s) => pathDistance(s.x, s.z).distance > PATH.track * 0.9)).toBe(true);
        expect(sites.every((s) => radiusOf(s) > 1.2)).toBe(true);
    });

    it('keeps the barley off the path, the belts, the fort\'s knoll and the lens, and grows it in the open field', () => {
        expect(grainCover(EYE.x, EYE.z)).toBe(0);
        PATH_POINTS.forEach(([x, z]) => expect(grainCover(x, z), `path ${x}, ${z}`).toBe(0));
        expect(grainCover(PLACES.fort.x, PLACES.fort.z)).toBe(0);
        BELTS.forEach((belt, i) => {
            const [x, z] = belt.points[1];
            expect(grainCover(x, z), `belt ${i}`).toBe(0);
        });
        expect(grainCover(10, -40)).toBe(1);
        for (let i = 0; i < 400; i++) {
            const c = grainCover(-300 + (i % 20) * 31, -5 - Math.floor(i / 20) * 47);
            expect(c >= 0 && c <= 1).toBe(true);
        }
    });

    it('stands uniform over the ground inside the knee, at constant density on screen beyond it', () => {
        // The right half of the frame: no path, no belt, no knoll that near, so the cover is whole and
        // the distances are the sampler's own.
        const sites = rowsOf(grainSites({ ...NEAR, count: 24000 })).filter((s) => bearingOf(s.x, s.z).bearing > 2);
        sites.forEach((s) => expect(grainCover(s.x, s.z)).toBe(1));
        const { near, knee, far } = NEAR;
        const radii = sites.map(radiusOf);
        // Inside the knee: equal-area rings hold equal counts.
        const rings = 4;
        const area = (r) => r * r;
        const inner = Array.from({ length: rings }, (_, k) => {
            const a = Math.sqrt(area(near) + ((area(knee) - area(near)) * k) / rings);
            const b = Math.sqrt(area(near) + ((area(knee) - area(near)) * (k + 1)) / rings);
            return radii.filter((r) => r >= a && r < b).length;
        });
        const innerMean = inner.reduce((s, n) => s + n, 0) / rings;
        expect(innerMean).toBeGreaterThan(300);
        inner.forEach((n, k) => expect(n / innerMean, `equal-area ring ${k}: ${inner}`).toBeGreaterThan(0.85));
        inner.forEach((n, k) => expect(n / innerMean, `equal-area ring ${k}: ${inner}`).toBeLessThan(1.15));
        // Beyond it: rings of equal ratio (equal on screen) hold equal counts.
        const outer = Array.from({ length: rings }, (_, k) => {
            const a = knee * (far / knee) ** (k / rings);
            const b = knee * (far / knee) ** ((k + 1) / rings);
            return radii.filter((r) => r >= a && r < b).length;
        });
        const outerMean = outer.reduce((s, n) => s + n, 0) / rings;
        outer.forEach((n, k) => expect(n / outerMean, `log ring ${k}: ${outer}`).toBeGreaterThan(0.85));
        outer.forEach((n, k) => expect(n / outerMean, `log ring ${k}: ${outer}`).toBeLessThan(1.15));
        // Continuous at the knee: the density per square metre just inside equals that just outside.
        const band = 0.6;
        const perArea = (a, b) => radii.filter((r) => r >= a && r < b).length / (b * b - a * a);
        expect(perArea(knee, knee + band) / perArea(knee - band, knee)).toBeGreaterThan(0.8);
        expect(perArea(knee, knee + band) / perArea(knee - band, knee)).toBeLessThan(1.25);
    });

    it('without a knee lays the whole reach at constant density on screen; a knee past the reach lays it all uniform', () => {
        const counts = (sites, edges) => edges.slice(1).map((b, k) => sites.filter((r) => r >= edges[k] && r < b).length);
        const right = (opts) => rowsOf(grainSites(opts)).filter((s) => bearingOf(s.x, s.z).bearing > 2).map(radiusOf);
        const near = 3;
        const far = 24;
        const logEdges = Array.from({ length: 5 }, (_, k) => near * (far / near) ** (k / 4));
        const log = counts(right({
            count: 12000, near, far, seed: 11,
        }), logEdges);
        const logMean = log.reduce((s, n) => s + n, 0) / 4;
        log.forEach((n) => expect(Math.abs(n / logMean - 1), `${log}`).toBeLessThan(0.15));
        const areaEdges = Array.from({ length: 5 }, (_, k) => Math.sqrt(near * near + ((far * far - near * near) * k) / 4));
        const flat = counts(right({
            count: 12000, near, far, knee: 1000, seed: 11,
        }), areaEdges);
        const flatMean = flat.reduce((s, n) => s + n, 0) / 4;
        flat.forEach((n) => expect(Math.abs(n / flatMean - 1), `${flat}`).toBeLessThan(0.15));
    });

    it('is deterministic for a seed, and another seed lays another field', () => {
        const a = grainSites({ ...NEAR, count: 800 });
        const b = grainSites({ ...NEAR, count: 800 });
        expect(Array.from(b.data)).toEqual(Array.from(a.data));
        const c = grainSites({ ...NEAR, count: 800, seed: NEAR.seed + 1 });
        expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
    });
});

describe('Grainfields land: the shelterbelts and their trees', () => {
    it('plants larch, birch and spruce (kinds 0..2), on the ground, in their belts', () => {
        expect(BELTS.length).toBeGreaterThan(0);
        BELTS.forEach((belt, i) => {
            expect([0, 1, 2], `belt ${i}`).toContain(belt.kind);
            expect(belt.width, `belt ${i}`).toBeGreaterThan(0);
            expect(belt.points.length, `belt ${i}`).toBeGreaterThan(1);
        });
        const trees = treeSites();
        expect(trees).toBeInstanceOf(Float32Array);
        expect(trees.length % 8).toBe(0);
        const count = trees.length / 8;
        expect(count).toBeGreaterThan(100);
        const kinds = new Set();
        let outside = 0;
        for (let i = 0; i < count; i++) {
            const o = i * 8;
            const [x, y, z, height, kind, seed, width, lean] = trees.subarray(o, o + 8);
            const label = `tree ${i}`;
            expect([0, 1, 2], label).toContain(kind);
            kinds.add(kind);
            expect(y, label).toBeCloseTo(groundHeight(x, z), 1);
            expect(height, label).toBeGreaterThan(5);
            expect(height, label).toBeLessThan(40);
            expect(width, label).toBeGreaterThan(0);
            expect(width, label).toBeLessThan(height);
            expect(seed >= 0 && seed < 1, label).toBe(true);
            expect(Math.abs(lean), label).toBeLessThanOrEqual(0.03 + 1e-6);
            if (beltAt(x, z).cover <= 0) outside += 1;
        }
        expect([...kinds].sort()).toEqual([0, 1, 2]);
        // Only the few lone trees in the fields stand outside a belt.
        expect(outside).toBeLessThanOrEqual(5);
    });

    it('is deterministic for a seed, and plants fewer trees at a lower density', () => {
        expect(Array.from(treeSites(7))).toEqual(Array.from(treeSites(7)));
        expect(Array.from(treeSites(7))).not.toEqual(Array.from(treeSites(8)));
        expect(treeSites(7, 0.5).length).toBeLessThan(treeSites(7, 1).length);
    });
});

describe('Grainfields land: the patchwork and the path', () => {
    it('names a plot at every point, with its distance to the plot\'s edge', () => {
        for (let i = 0; i < 300; i++) {
            const x = -3000 + ((i * 97) % 6000);
            const z = -((i * 61) % 3000);
            const plot = plotAt(x, z);
            expect(plot.id >= 0 && plot.id < 1).toBe(true);
            expect(plot.edge).toBeGreaterThanOrEqual(-1e-6);
            expect(plot.edge).toBeLessThanOrEqual(Math.max(PLOT.across * 1.3, PLOT.along) / 2 + 1e-6);
            expect(Number.isInteger(plot.row) && Number.isInteger(plot.col)).toBe(true);
            expect(plotAt(x, z)).toEqual(plot);
        }
    });

    it('runs the path from the near field on the left to the fort\'s knoll, along it from 0 to 1', () => {
        let previous = -1;
        PATH_POINTS.forEach(([x, z], i) => {
            const { distance, along } = pathDistance(x, z);
            expect(distance, `point ${i}`).toBeCloseTo(0, 9);
            expect(along, `point ${i}`).toBeGreaterThan(previous);
            previous = along;
        });
        expect(pathDistance(...PATH_POINTS[0]).along).toBe(0);
        expect(pathDistance(...PATH_POINTS[PATH_POINTS.length - 1]).along).toBeCloseTo(1, 12);
        // It starts beside the eye, left of the view, and ends on the knoll.
        const [sx, sz] = PATH_POINTS[0];
        expect(sx).toBeLessThan(EYE.x);
        expect(bearingOf(sx, sz).distance).toBeLessThan(10);
        const [ex, ez] = PATH_POINTS[PATH_POINTS.length - 1];
        expect(Math.hypot(ex - PLACES.fort.x, ez - PLACES.fort.z)).toBeLessThan(PLACES.fort.radius);
        // A point beside it is as far from it as it is set off.
        expect(pathDistance(sx + 3, sz).distance).toBeLessThanOrEqual(3 + 1e-9);
        // The seam of flowers stays narrow by the eye and is never negative.
        for (let along = 0; along <= 1; along += 0.01) expect(flowerWidth(along)).toBeGreaterThan(0);
        expect(flowerWidth(0)).toBeLessThan(flowerWidth(0.5) + PATH.flowers * 0.5);
    });
});
