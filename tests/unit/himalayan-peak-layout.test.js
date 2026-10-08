import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import {
    DEG, EYE, EYE_HEIGHT, GRID, HEIGHT_RANGE, REST_RIG, fovForAspect, mulberry32,
} from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import {
    BASIN_FLOOR, GROUND_UNDER_SNOW, HERO_SUMMIT, RIDGES, buildPlanHeights, crestPoints, planHeight,
} from '../../src/themes/himalayan-peak/himalayan-peak-massif.js';
import {
    BOOTS, CAIRN, CHORTEN, PASS_MARRY, PASS_REACH, anchors, avalancheTrack, crestEmitters, flagLines, linePoint,
    passHeight, shoulderHeight,
} from '../../src/themes/himalayan-peak/himalayan-peak-layout.js';
import { PLAN_SIZE, planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import { decodeMassif, sampleField } from '../../src/themes/himalayan-peak/himalayan-peak-field.js';
import { MAX_LINES } from '../../src/themes/himalayan-peak/himalayan-peak-flags.js';
import { EAGLE_ROUND, eaglePath } from '../../src/themes/himalayan-peak/himalayan-peak-eagle.js';
import { decodePng } from '../../scripts/himalayan-peak/png.mjs';

const ASPECTS = [16 / 9, 4 / 3, 21 / 9, 430 / 932];

/** A small stand-in amphitheatre, the one the theme falls back to, and the baked one. */
let small;
let standIn;
let baked;
beforeAll(() => {
    small = planMassif(96);
    standIn = planMassif(PLAN_SIZE);
    const file = new URL('../../src/themes/himalayan-peak/assets/massif.png', import.meta.url);
    const image = decodePng(readFileSync(file));
    baked = { heights: decodeMassif(image.rgba, image.width).heights, size: image.width };
});

const groundOf = (field, x, z) => sampleField(field.heights, field.size, x, z);
const lengthOf = (line) => Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1], line.b[2] - line.a[2]);

describe('himalayan peak plan: the height of the amphitheatre', () => {
    it('is a pure function of the point', () => {
        const rand = mulberry32(60);
        for (let n = 0; n < 60; n++) {
            const x = GRID.x0 + rand() * GRID.span;
            const z = GRID.z0 + rand() * GRID.span;
            const h = planHeight(x, z);
            expect(Number.isFinite(h)).toBe(true);
            expect(planHeight(x, z)).toBe(h);
        }
        // The sampled grid is that function at its nodes, row by row from z0.
        const size = 24;
        const grid = buildPlanHeights(size);
        expect(grid).toBeInstanceOf(Float32Array);
        expect(grid).toHaveLength(size * size);
        const cell = GRID.span / (size - 1);
        for (const [i, j] of [[0, 0], [5, 17], [23, 2], [11, 11], [23, 23]]) {
            expect(grid[j * size + i]).toBe(Math.fround(planHeight(GRID.x0 + i * cell, GRID.z0 + j * cell)));
        }
        expect(Array.from(buildPlanHeights(size))).toEqual(Array.from(grid));
    });

    it('stands the viewer on it: the ground under the eye lies exactly under the pass\'s snow', () => {
        expect(planHeight(EYE.x, EYE.z)).toBeCloseTo(EYE.y - EYE_HEIGHT - GROUND_UNDER_SNOW, 3);
        expect(BOOTS).toBe(EYE.y - EYE_HEIGHT);
        // Round the eye it is calm ground: no crag stands up into the view.
        for (let a = 0; a < 360; a += 30) {
            for (const r of [10, 40, 120]) {
                const h = planHeight(EYE.x + Math.sin(a * DEG) * r, EYE.z - Math.cos(a * DEG) * r);
                expect(h, `${r} m at ${a}°`).toBeLessThan(EYE.y + 4);
                expect(h, `${r} m at ${a}°`).toBeGreaterThan(EYE.y - 140);
            }
        }
    });

    it('raises the hero over three thousand metres and nothing else as high', () => {
        let top = -Infinity;
        for (let dz = -400; dz <= 400; dz += 40) {
            for (let dx = -400; dx <= 400; dx += 40) {
                top = Math.max(top, planHeight(HERO_SUMMIT.x + dx, HERO_SUMMIT.z + dz));
            }
        }
        expect(top).toBeGreaterThan(3000);
        expect(top).toBeLessThan(HEIGHT_RANGE.max - 200);
        expect(Math.abs(top - HERO_SUMMIT.y)).toBeLessThan(150);
        // The summit the plan names is a crest point of the hero's ridge.
        const hero = RIDGES.find((ridge) => ridge.name === 'hero');
        expect(hero.pts).toContainEqual([HERO_SUMMIT.x, HERO_SUMMIT.y, HERO_SUMMIT.z]);
        expect(Math.max(...RIDGES.flatMap((ridge) => ridge.pts.map((p) => p[1])))).toBe(HERO_SUMMIT.y);
        // On a coarse grid the highest node is the hero's too, and the whole plan fits the range
        // the bake stores heights over.
        const size = 128;
        const grid = buildPlanHeights(size);
        const cell = GRID.span / (size - 1);
        let best = 0;
        let lowest = Infinity;
        for (let i = 0; i < grid.length; i++) {
            if (grid[i] > grid[best]) best = i;
            lowest = Math.min(lowest, grid[i]);
        }
        const x = GRID.x0 + (best % size) * cell;
        const z = GRID.z0 + Math.floor(best / size) * cell;
        expect(Math.hypot(x - HERO_SUMMIT.x, z - HERO_SUMMIT.z)).toBeLessThan(600);
        expect(grid[best]).toBeLessThan(HEIGHT_RANGE.max);
        expect(lowest).toBeGreaterThan(HEIGHT_RANGE.min);
    });

    it('lies under the cloud in the basins, far from every ridge', () => {
        for (const [x, z] of [[800, -4500], [0, -5500], [1200, -9800], [-200, -6000], [500, -3000], [1500, -4000]]) {
            const h = planHeight(x, z);
            expect(h, `${x}, ${z}`).toBeLessThan(0);
            expect(Math.abs(h - BASIN_FLOOR), `${x}, ${z}`).toBeLessThan(100);
        }
        expect(BASIN_FLOOR).toBeGreaterThan(HEIGHT_RANGE.min);
    });
});

describe('himalayan peak plan: the crest lines', () => {
    it('walks every ridge in even steps from its first crest point', () => {
        for (const ridge of RIDGES) {
            let total = 0;
            for (let i = 1; i < ridge.pts.length; i++) {
                total += Math.hypot(ridge.pts[i][0] - ridge.pts[i - 1][0], ridge.pts[i][2] - ridge.pts[i - 1][2]);
            }
            for (const step of [45, 90, 200]) {
                const points = crestPoints(ridge.name, step);
                const label = `${ridge.name} at ${step} m`;
                expect(points, label).toHaveLength(Math.floor(total / step) + 1);
                expect(points[0][0], label).toBeCloseTo(ridge.pts[0][0], 9);
                expect(points[0][1], label).toBeCloseTo(ridge.pts[0][2], 9);
                expect(points[0][2], label).toBe(0);
                for (let i = 1; i < points.length; i++) {
                    // Metres along the crest: exactly a step on.
                    expect(points[i][2] - points[i - 1][2], label).toBeCloseTo(step, 9);
                    // As the crow flies: a step, or a little less across a bend.
                    const apart = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
                    expect(apart, label).toBeLessThanOrEqual(step + 1e-6);
                    expect(apart, label).toBeGreaterThan(step * 0.9);
                }
                expect(points[points.length - 1][2], label).toBeLessThanOrEqual(total);
            }
        }
    });

    it('keeps every point on the ridge it walks', () => {
        for (const ridge of RIDGES) {
            const offLine = crestPoints(ridge.name, 60).filter(([x, z]) => {
                let nearest = Infinity;
                for (let i = 1; i < ridge.pts.length; i++) {
                    const a = ridge.pts[i - 1];
                    const b = ridge.pts[i];
                    const dx = b[0] - a[0];
                    const dz = b[2] - a[2];
                    const k = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)));
                    nearest = Math.min(nearest, Math.hypot(x - a[0] - dx * k, z - a[2] - dz * k));
                }
                return nearest > 1e-6;
            });
            expect(offLine, ridge.name).toHaveLength(0);
        }
    });

    it('knows no ridge it was not given', () => {
        expect(crestPoints('nope', 90)).toEqual([]);
        expect(crestPoints(undefined, 90)).toEqual([]);
        expect(new Set(RIDGES.map((ridge) => ridge.name)).size).toBe(RIDGES.length);
    });
});

describe('himalayan peak layout: the pass under the viewer', () => {
    it('lies level under the boots and rolls over a brow ahead', () => {
        expect(shoulderHeight(0, 0)).toBe(BOOTS);
        // Within a pace or two the drifts are still faded out.
        for (let a = 0; a < 360; a += 20) {
            const x = Math.sin(a * DEG) * 1.2;
            const z = -Math.cos(a * DEG) * 1.2;
            expect(Math.abs(shoulderHeight(x, z) - BOOTS), `${a}°`).toBeLessThan(0.12);
        }
        // Behind the viewer and to the sides it stays a shoulder: drifts, no fall.
        for (const [x, z] of [[0, 10], [4, 14], [-6, 20], [5, 0], [-5, 2]]) {
            expect(Math.abs(shoulderHeight(x, z) - BOOTS), `${x}, ${z}`).toBeLessThan(0.3);
        }
        // Ahead it falls away, faster the farther out.
        const ahead = [-5, -10, -20, -40, -80].map((z) => shoulderHeight(0, z));
        for (let i = 1; i < ahead.length; i++) expect(ahead[i]).toBeLessThan(ahead[i - 1]);
        expect(ahead[1]).toBeGreaterThan(BOOTS - 1.5);
        expect(ahead[3]).toBeLessThan(BOOTS - 20);
        for (let i = 2; i < ahead.length; i++) {
            expect(ahead[i - 1] - ahead[i]).toBeGreaterThan(ahead[i - 2] - ahead[i - 1]);
        }
        // The chorten and the cairn stand on mounds: still on the shoulder, proud of the open
        // snow that has already begun to fall away at their depth.
        for (const mound of [CHORTEN, CAIRN]) {
            const foot = shoulderHeight(mound.x, mound.z);
            expect(foot).toBeLessThan(BOOTS + 1);
            expect(foot).toBeGreaterThan(BOOTS - 3);
            expect(foot - shoulderHeight(0, mound.z)).toBeGreaterThan(0.1);
        }
    });

    it('is the shoulder near the viewer whatever the massif, and the baked ground at its rim', () => {
        for (const field of [small, standIn, baked]) {
            expect(passHeight(field, EYE.x, EYE.z)).toBeCloseTo(BOOTS, 6);
            // Inside the first marrying radius the baked ground has no say.
            for (let a = 0; a < 360; a += 24) {
                for (const r of [3, 12, PASS_MARRY[0] - 0.1]) {
                    const x = Math.sin(a * DEG) * r;
                    const z = -Math.cos(a * DEG) * r;
                    expect(passHeight(field, EYE.x + x, EYE.z + z)).toBeCloseTo(shoulderHeight(x, z), 9);
                }
            }
            // From the second on it is the baked ground, tucked under it by a few metres.
            let previous = 0;
            for (const r of [PASS_MARRY[1], 160, 170, 180, PASS_REACH]) {
                const tucks = [];
                for (let a = 0; a < 360; a += 24) {
                    const x = EYE.x + Math.sin(a * DEG) * r;
                    const z = EYE.z - Math.cos(a * DEG) * r;
                    tucks.push(groundOf(field, x, z) - passHeight(field, x, z));
                }
                // The same all the way round...
                expect(Math.max(...tucks) - Math.min(...tucks), `${r} m`).toBeLessThan(1e-6);
                // ...and deeper the farther out.
                expect(tucks[0], `${r} m`).toBeGreaterThan(previous);
                [previous] = tucks;
            }
            // At the rim: clear of the baked mesh by metres, not by a hair and not by a cliff.
            expect(previous).toBeGreaterThan(2);
            expect(previous).toBeLessThan(30);
            // Past the rim it stays there.
            const out = EYE.x + PASS_REACH + 40;
            expect(groundOf(field, out, EYE.z) - passHeight(field, out, EYE.z)).toBeCloseTo(previous, 6);
        }
        expect(PASS_MARRY[0]).toBeLessThan(PASS_MARRY[1]);
        expect(PASS_MARRY[1]).toBeLessThan(PASS_REACH);
    });

    it('has no step anywhere between the shoulder and the baked ground', () => {
        for (const [name, field] of [['plan, 96', small], ['plan stand-in', standIn], ['baked', baked]]) {
            let worst = 0;
            let samples = 0;
            for (let a = -180; a < 180; a += 7.5) {
                let previous = null;
                for (let r = 0; r <= PASS_REACH + 20; r += 1) {
                    const y = passHeight(field, EYE.x + Math.sin(a * DEG) * r, EYE.z - Math.cos(a * DEG) * r);
                    // (A NaN would leave `worst` a NaN, which fails the bound below.)
                    if (previous !== null) worst = Math.max(worst, Math.abs(y - previous));
                    previous = y;
                    samples += 1;
                }
            }
            expect(samples).toBeGreaterThan(10000);
            // Beyond the brow it drops at up to 70°: under three metres in a metre. A seam would
            // show as a jump of tens.
            expect(worst, name).toBeLessThan(4);
        }
    });

    it('stands the chorten left and the cairn right of the view, on the pass\'s own snow', () => {
        const at = anchors(baked);
        for (const [foot, mound] of [[at.chorten, CHORTEN], [at.cairn, CAIRN]]) {
            const x = EYE.x + mound.x;
            const z = EYE.z + mound.z;
            expect(foot).toEqual([x, passHeight(baked, x, z), z]);
        }
        // The spire stands the chorten's height over its foot, the pole over the cairn's stones.
        expect(at.spire[0]).toBe(at.chorten[0]);
        expect(at.spire[2]).toBe(at.chorten[2]);
        expect(at.spire[1] - at.chorten[1]).toBeCloseTo(CHORTEN.height, 9);
        expect(at.pole[0]).toBe(at.cairn[0]);
        expect(at.pole[2]).toBe(at.cairn[2]);
        expect(at.pole[1] - at.cairn[1]).toBeGreaterThan(CAIRN.pole);
        expect(at.pole[1] - at.cairn[1]).toBeLessThan(CAIRN.pole + 1.5);
        // Left and right of the view axis, both ahead, both above the eye at their tops.
        expect(at.chorten[0]).toBeLessThan(EYE.x);
        expect(at.cairn[0]).toBeGreaterThan(EYE.x);
        expect(at.chorten[2]).toBeLessThan(EYE.z);
        expect(at.cairn[2]).toBeLessThan(EYE.z);
        expect(at.spire[1]).toBeGreaterThan(EYE.y);
        expect(at.pole[1]).toBeGreaterThan(EYE.y);
        // They stand inside the first marrying radius, so the massif under them changes nothing.
        expect(Math.hypot(CHORTEN.x, CHORTEN.z)).toBeLessThan(PASS_MARRY[0]);
        expect(Math.hypot(CAIRN.x, CAIRN.z)).toBeLessThan(PASS_MARRY[0]);
        expect(anchors(small)).toEqual(at);
        expect(anchors(standIn)).toEqual(at);
    });
});

describe('himalayan peak layout: the lines of prayer flags', () => {
    it('strings at least four lines for every frame, each with flags, a belly and finite ends', () => {
        const at = anchors(baked);
        for (const aspect of ASPECTS) {
            const lines = flagLines(at, aspect);
            const label = `aspect ${aspect.toFixed(2)}`;
            expect(lines.length, label).toBeGreaterThanOrEqual(4);
            expect(lines.length, label).toBeLessThanOrEqual(MAX_LINES);
            expect(new Set(lines.map((line) => line.name)).size, label).toBe(lines.length);
            for (const line of lines) {
                const name = `${label}, ${line.name}`;
                expect(Number.isInteger(line.count), name).toBe(true);
                expect(line.count, name).toBeGreaterThanOrEqual(1);
                expect(line.sag, name).toBeGreaterThan(0);
                expect(line.size, name).toBeGreaterThan(0);
                expect(line.a, name).toHaveLength(3);
                expect(line.b, name).toHaveLength(3);
                expect([...line.a, ...line.b].every((v) => Number.isFinite(v)), name).toBe(true);
                // Long enough that its flags hang side by side, and it sags less than it spans.
                expect((lengthOf(line) * 0.9) / line.count, name).toBeGreaterThan(line.size);
                expect(line.sag, name).toBeLessThan(lengthOf(line) * 0.5);
                // Every line is tied to the spire or the pole at one end at least.
                expect([at.spire, at.pole].includes(line.a) || [at.spire, at.pole].includes(line.b), name).toBe(true);
                // Its ends are ahead of the viewer and off the snow.
                for (const end of [line.a, line.b]) {
                    expect(end[2], name).toBeLessThan(EYE.z);
                    expect(end[1], name).toBeGreaterThan(BOOTS - 6);
                }
            }
            // One hangs between the two, in every frame.
            const low = lines.find((line) => line.a === at.spire && line.b === at.pole);
            expect(low, label).toBeTruthy();
        }
    });

    it('runs the free ends out of the frame it is strung for', () => {
        const at = anchors(baked);
        for (const aspect of ASPECTS) {
            const vertical = fovForAspect(aspect) * DEG;
            const horizontal = Math.atan(Math.tan(vertical / 2) * aspect);
            const free = flagLines(at, aspect).filter((line) => line.b !== at.pole);
            expect(free.length).toBeGreaterThanOrEqual(3);
            // Bearing and elevation of each free end from the eye.
            const outside = free.filter((line) => {
                const dx = line.b[0] - EYE.x;
                const dy = line.b[1] - EYE.y;
                const dz = line.b[2] - EYE.z;
                const bearing = Math.abs(Math.atan2(dx, -dz));
                const elevation = Math.atan2(dy, Math.hypot(dx, dz));
                return bearing > horizontal || elevation > REST_RIG.pitch + vertical / 2;
            });
            // (One of them may be retuned to end in the picture; the lines as a set must not.)
            expect(outside.length, `aspect ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        }
    });

    it('hangs a line as a parabola under its chord', () => {
        const line = {
            a: [-3, 10, 2], b: [9, 14, -6], sag: 1.5,
        };
        expect(linePoint(line, 0)).toEqual(line.a);
        expect(linePoint(line, 1)).toEqual(line.b);
        for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
            const p = linePoint(line, s);
            // Straight under the chord...
            expect(p[0]).toBeCloseTo(line.a[0] + (line.b[0] - line.a[0]) * s, 9);
            expect(p[2]).toBeCloseTo(line.a[2] + (line.b[2] - line.a[2]) * s, 9);
            // ...by its sag at the middle, less toward the knots.
            const chord = line.a[1] + (line.b[1] - line.a[1]) * s;
            expect(chord - p[1]).toBeCloseTo(line.sag * 4 * s * (1 - s), 9);
            expect(p[1]).toBeLessThan(chord);
        }
        expect(line.a[1] + (line.b[1] - line.a[1]) * 0.5 - linePoint(line, 0.5)[1]).toBeCloseTo(line.sag, 9);
        // No allocation when a point is handed in.
        const out = [0, 0, 0];
        expect(linePoint(line, 0.3, out)).toBe(out);
        expect(out).toEqual(linePoint(line, 0.3));
        // The real lines hang the same way.
        for (const real of flagLines(anchors(baked), 16 / 9)) {
            expect(linePoint(real, 0)).toEqual(real.a);
            linePoint(real, 1).forEach((v, k) => expect(v).toBeCloseTo(real.b[k], 9));
            expect(linePoint(real, 0.5)[1]).toBeCloseTo((real.a[1] + real.b[1]) / 2 - real.sag, 9);
        }
    });
});

describe('himalayan peak layout: where the crests throw their snow', () => {
    it('hands back exactly the emitters asked for, a third of them the hero\'s banner', () => {
        for (const field of [small, baked]) {
            for (const count of [3, 10, 220, 1200]) {
                const emitters = crestEmitters(field, count);
                expect(emitters).toHaveLength(count);
                const banner = emitters.filter((emitter) => emitter[4] === 1).length;
                // About a third of them are the banner.
                expect(banner).toBeGreaterThanOrEqual(Math.floor(count * 0.25));
                expect(banner).toBeLessThanOrEqual(Math.ceil(count * 0.42));
                // [x, y, z, strength 0..1, banner 0|1], every one of them, the banner first...
                const malformed = emitters.filter((emitter, index) => !(emitter.length === 5
                    && emitter.every((v) => Number.isFinite(v))
                    && emitter[4] === (index < banner ? 1 : 0)
                    && emitter[3] > 0 && emitter[3] <= 1));
                expect(malformed).toEqual([]);
                // ...which streams from the top of the hero.
                const strays = emitters.slice(0, banner)
                    .filter((emitter) => Math.hypot(emitter[0] - HERO_SUMMIT.x, emitter[2] - HERO_SUMMIT.z) > 400);
                expect(strays).toEqual([]);
            }
            expect(crestEmitters(field, 0)).toEqual([]);
        }
    });

    it('sets every emitter on or over the ground, the rest of them along the high crests', () => {
        for (const field of [small, baked]) {
            const emitters = crestEmitters(field, 600);
            const sunk = emitters.filter((e) => e[1] < groundOf(field, e[0], e[2]));
            expect(sunk).toHaveLength(0);
            const smoke = emitters.filter((e) => e[4] === 0);
            // Well above the cloud, and near a crest line of the plan.
            expect(smoke.every((e) => e[1] > 150)).toBe(true);
            const crests = RIDGES.flatMap((ridge) => crestPoints(ridge.name, 60));
            const onCrest = (e) => crests.some(([x, z]) => Math.hypot(e[0] - x, e[2] - z) <= 120);
            expect(smoke.filter((e) => !onCrest(e))).toHaveLength(0);
            // More than one ridge smokes.
            expect(smoke.some((e) => e[0] > 2000)).toBe(true);
            expect(smoke.some((e) => e[0] < -2000)).toBe(true);
        }
        // On the baked ground the banner sits within a few metres of the summit's own height.
        const banner = crestEmitters(baked, 600).filter((e) => e[4] === 1);
        expect(Math.max(...banner.map((e) => e[1]))).toBeGreaterThan(HERO_SUMMIT.y - 150);
    });

    it('is the same for a seed and different for another', () => {
        const a = crestEmitters(baked, 300);
        expect(crestEmitters(baked, 300)).toEqual(a);
        expect(crestEmitters(baked, 300, 4471)).toEqual(a);
        const other = crestEmitters(baked, 300, 99);
        expect(other).toHaveLength(300);
        expect(other).not.toEqual(a);
    });
});

describe('himalayan peak layout: the avalanche\'s track', () => {
    /** What a track must be on any ground it is given; returns its longest stride. */
    function expectFallLine(track, field, label) {
        expect(track.length, label).toBeGreaterThanOrEqual(2);
        expect(track.length, label).toBeLessThanOrEqual(64);
        // It starts high on the hero, east of the summit...
        const [start] = track;
        expect(start[1], label).toBeGreaterThan(2000);
        expect(start[0], label).toBeGreaterThan(HERO_SUMMIT.x);
        expect(Math.hypot(start[0] - HERO_SUMMIT.x, start[2] - HERO_SUMMIT.z), label).toBeLessThan(800);
        expect(start[3], label).toBe(0);
        const hops = [];
        for (let i = 0; i < track.length; i++) {
            const [x, y, z, along] = track[i];
            expect(track[i].every((v) => Number.isFinite(v)), label).toBe(true);
            expect(y, label).toBeCloseTo(groundOf(field, x, z), 9);
            if (i === 0) continue;
            // ...never climbs more than a few metres from one point to the next...
            expect(y - track[i - 1][1], `${label}, step ${i}`).toBeLessThan(3);
            // ...and counts its metres along the ground.
            const hop = along - track[i - 1][3];
            expect(hop, `${label}, step ${i}`).toBeGreaterThan(0);
            expect(Math.hypot(x - track[i - 1][0], z - track[i - 1][2]), `${label}, step ${i}`).toBeCloseTo(hop, 6);
            hops.push(hop);
        }
        // A full stride, or that stride halved (and halved again) where a full one would climb.
        const stride = Math.max(...hops);
        hops.forEach((hop) => {
            const halvings = Math.log2(stride / hop);
            expect(Math.abs(halvings - Math.round(halvings)), `${label}: a stride of ${hop} m`).toBeLessThan(1e-9);
        });
        // It ends far below where it started, and under the cloud only at its very end.
        const end = track[track.length - 1];
        expect(end[1], label).toBeLessThan(start[1] - 1500);
        const drowned = track.findIndex((p) => p[1] < -40);
        expect(drowned === -1 || drowned === track.length - 1, label).toBe(true);
        return stride;
    }

    it('follows the baked ground down the hero\'s east face to the cloud', () => {
        const track = avalancheTrack(baked);
        const stride = expectFallLine(track, baked, 'baked');
        expect(track.length).toBeGreaterThan(10);
        expect(stride).toBeGreaterThan(10);
        // Near or under the cloud at its end, having run out east toward the basin.
        const end = track[track.length - 1];
        expect(end[1]).toBeLessThan(150);
        expect(end[0]).toBeGreaterThan(track[0][0]);
        // On the weathered ground no stride has to be shortened: it never climbs at all.
        for (let i = 1; i < track.length; i++) {
            expect(track[i][1]).toBeLessThanOrEqual(track[i - 1][1]);
            expect(track[i][3] - track[i - 1][3]).toBeCloseTo(stride, 9);
        }
    });

    it('never climbs on the stand-ins either, coarse as they are', () => {
        // The plan sampled at 256² is what the theme falls back to; 96² and 64² are what tests
        // build worlds on. Their gullies are a cell or two wide: a full stride overshoots them.
        const coarse = planMassif(64);
        for (const [label, field] of [['256²', standIn], ['96²', small], ['64²', coarse]]) {
            const track = avalancheTrack(field);
            expectFallLine(track, field, label);
            expect(track.length, label).toBeGreaterThan(10);
            expect(avalancheTrack(field), label).toEqual(track);
        }
        // On the stand-in the theme falls back to it comes down to the cloud.
        const fallback = avalancheTrack(standIn);
        expect(fallback[fallback.length - 1][1]).toBeLessThan(150);
    });

    it('is cut off at the number of points asked for, and always has two ends', () => {
        const short = avalancheTrack(baked, 10);
        expect(short).toHaveLength(10);
        expect(short).toEqual(avalancheTrack(baked).slice(0, 10));
        expect(avalancheTrack(baked, 2)).toEqual(avalancheTrack(baked).slice(0, 2));
        // One point is no track: a second is set beside it.
        const single = avalancheTrack(baked, 1);
        expect(single).toHaveLength(2);
        expect(single[0]).toEqual(avalancheTrack(baked)[0]);
        // Ground that gives it nowhere to go (all of it under the cloud) still gives two ends,
        // the second no higher than the first and a step along.
        const drowned = { heights: new Float32Array(64 * 64).fill(-500), size: 64 };
        const stuck = avalancheTrack(drowned);
        expect(stuck).toHaveLength(2);
        expect(stuck.flat().every((v) => Number.isFinite(v))).toBe(true);
        expect(stuck[1][1]).toBeLessThanOrEqual(stuck[0][1]);
        expect(stuck[1][3]).toBeGreaterThan(stuck[0][3]);
        expect(Math.hypot(stuck[1][0] - stuck[0][0], stuck[1][2] - stuck[0][2])).toBeGreaterThan(0);
    });
});

describe('himalayan peak: the eagle\'s round', () => {
    it('comes round to the same place every round', () => {
        for (const time of [0, 3.7, 20, 51.3, 73.9]) {
            const now = eaglePath(time);
            const later = eaglePath(time + EAGLE_ROUND);
            const much = eaglePath(time + EAGLE_ROUND * 40);
            for (const key of ['x', 'y', 'z', 'hx', 'hy', 'hz', 'bank']) {
                expect(later[key], key).toBeCloseTo(now[key], 9);
                expect(much[key], key).toBeCloseTo(now[key], 6);
            }
        }
        // And it does move in between.
        const a = eaglePath(0);
        const b = eaglePath(EAGLE_ROUND / 2);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(200);
    });

    it('soars over the cloud sea in front of the eye, heading the way it flies', () => {
        for (let time = 0; time < EAGLE_ROUND; time += 0.37) {
            const at = eaglePath(time);
            expect(Math.hypot(at.hx, at.hy, at.hz)).toBeCloseTo(1, 9);
            // Above the cloud sea, and in front of the eye.
            expect(at.y).toBeGreaterThan(300);
            expect(at.z).toBeLessThan(0);
            expect(at.z).toBeLessThan(EYE.z);
            // It leans into its turn, never onto its back.
            expect(Math.abs(at.bank)).toBeLessThan(1);
            // Its heading is the direction it is moving in over the ground.
            const next = eaglePath(time + 0.01);
            const vx = next.x - at.x;
            const vz = next.z - at.z;
            const along = (vx * at.hx + vz * at.hz) / (Math.hypot(vx, vz) * Math.hypot(at.hx, at.hz));
            expect(along).toBeGreaterThan(0.9999);
            // It never dives or climbs steeply.
            expect(Math.abs(at.hy)).toBeLessThan(0.3);
        }
    });

    it('writes into the object it is handed', () => {
        const out = {
            x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, bank: 0,
        };
        expect(eaglePath(12, out)).toBe(out);
        expect(out).toEqual(eaglePath(12));
        expect(eaglePath(12)).not.toBe(eaglePath(12));
    });
});
