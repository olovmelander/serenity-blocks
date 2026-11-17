/**
 * Sunbraid — the three-free modules the world, the shaders and the playground share: the suns
 * (sunbraid-core.js), the baked noise (sunbraid-noise.js), the valley's plan (sunbraid-plan.js)
 * and the towers' shapes (sunbraid-monoliths.js: sculpted in Blender, read here as plain arrays).
 *
 * The look is still being tuned, so these hold relations (a sun on its circle, a third of a turn
 * apart; the lowest sun named as the era; a neutral white from three colours), not numbers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BRAID, BRAID_RATE, DEG, PIECE_CODE, PIECE_COLORS, PIECE_KEYS, SUNS, TAU, azElOf, cellsFromMatrix, clusterCentre,
    eraAt, hexToLinear, mulberry32, pieceCode, rigFor, smooth, sunDirection, sunVector,
} from '../../src/themes/sunbraid/sunbraid-core.js';
import {
    NOISE_PERIODS, NOISE_SIZE, bakeNoise, noiseAt, noiseData,
} from '../../src/themes/sunbraid/sunbraid-noise.js';
import {
    EYE_ALTITUDE, MAX_CASTERS, SPIRE_LAYOUT, TIER_OVERLAP, casterRanges, eyePosition, floorHeight, groundHeight,
    spireCasters, spireFoot, variantOf,
} from '../../src/themes/sunbraid/sunbraid-plan.js';
import {
    MONOLITH_BURY, MONOLITH_LEVELS, MONOLITH_VARIANTS, monolithKind, monolithMesh, monolithProxies,
} from '../../src/themes/sunbraid/sunbraid-monoliths.js';
import { SUNBRAID_TETROMINOS } from '../../src/themes/sunbraid/sunbraid-tetrominos.js';

const themeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'themes', 'sunbraid');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Where the cluster's centre points at clock `time` (unit vector). */
const centreAt = (time) => {
    const [az, el] = clusterCentre(time);
    return sunDirection(az, el);
};
/** The angle between two vectors (radians). */
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));

const PHASES = Array.from({ length: 97 }, (_, i) => -9 + i * 0.19);
const TIMES = [0, 37.5, 325, 900, 4000];

describe('Sunbraid core: the three suns', () => {
    it('points each sun along a unit vector, whatever the phase, clock and spread', () => {
        for (const phase of PHASES) {
            for (const time of TIMES) {
                for (const spread of [0, 0.4, 1, 1.85, 3]) {
                    for (let k = 0; k < 3; k++) {
                        const v = sunVector(phase, k, time, spread);
                        expect(v.every(Number.isFinite)).toBe(true);
                        expect(len(v)).toBeCloseTo(1, 12);
                    }
                }
            }
        }
    });

    it('stands the three round the cluster\'s centre, BRAID.spread across, a third of a turn apart', () => {
        // The braid's ring: BRAID.spread across (east-west) and BRAID.flatten of that up and down
        // (a circle when there is no flatten). On the plane square to the centre (the gnomonic
        // view, where a ring on the sky is a ring), sun k stands at angle phase + k·120° round it.
        const flatten = BRAID.flatten ?? 1;
        for (const time of TIMES) {
            const [az, el] = clusterCentre(time);
            const centre = sunDirection(az, el);
            const east = [Math.cos(az), 0, Math.sin(az)];
            const north = [-Math.sin(az) * Math.sin(el), Math.cos(el), Math.cos(az) * Math.sin(el)];
            expect(dot(east, centre)).toBeCloseTo(0, 12);
            expect(dot(north, centre)).toBeCloseTo(0, 12);
            for (const phase of PHASES) {
                for (const spread of [0.5, 1, 1.85]) {
                    const reach = Math.tan(BRAID.spread * DEG * spread);
                    const turn = [];
                    for (let k = 0; k < 3; k++) {
                        const sun = sunVector(phase, k, time, spread);
                        const onPlane = sub(scale(sun, 1 / dot(sun, centre)), centre);
                        const x = dot(onPlane, east) / reach;
                        const y = dot(onPlane, north) / (reach * flatten);
                        expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
                        const a = phase + (k * TAU) / 3;
                        expect(x).toBeCloseTo(Math.cos(a), 9);
                        expect(y).toBeCloseTo(Math.sin(a), 9);
                        turn.push(Math.atan2(y, x));
                        // No farther from the centre than the ring's width.
                        expect(angle(sun, centre)).toBeLessThanOrEqual(BRAID.spread * DEG * spread + 1e-12);
                    }
                    for (let k = 0; k < 3; k++) {
                        const step = (((turn[(k + 1) % 3] - turn[k]) % TAU) + TAU) % TAU;
                        expect(step).toBeCloseTo(TAU / 3, 9);
                    }
                }
            }
        }
        expect(flatten).toBeGreaterThan(0);
        expect(flatten).toBeLessThanOrEqual(1);
    });

    it('turns the circle with the phase: a third of a turn puts each sun where the next one was', () => {
        for (const phase of PHASES.slice(0, 20)) {
            for (let k = 0; k < 3; k++) {
                const later = sunVector(phase + TAU / 3, k, 50);
                const next = sunVector(phase, (k + 1) % 3, 50);
                later.forEach((v, i) => expect(v).toBeCloseTo(next[i], 12));
            }
        }
    });

    it('gathers all three on the centre at spread 0 (one white sun)', () => {
        for (const time of TIMES) {
            const centre = centreAt(time);
            for (const phase of PHASES.slice(0, 12)) {
                for (let k = 0; k < 3; k++) {
                    sunVector(phase, k, time, 0).forEach((v, i) => expect(v).toBeCloseTo(centre[i], 12));
                    // A negative spread is no spread.
                    sunVector(phase, k, time, -2).forEach((v, i) => expect(v).toBeCloseTo(centre[i], 12));
                }
            }
        }
    });

    it('keeps the cluster low in front of the eye, nodding by BRAID.nod over BRAID.nodPeriod', () => {
        const els = [];
        for (let t = 0; t <= BRAID.nodPeriod; t += BRAID.nodPeriod / 64) {
            const [az, el] = clusterCentre(t);
            expect(az).toBeCloseTo(BRAID.azimuth * DEG, 12);
            els.push(el);
        }
        expect(Math.max(...els)).toBeCloseTo((BRAID.elevation + BRAID.nod) * DEG, 6);
        expect(Math.min(...els)).toBeCloseTo((BRAID.elevation - BRAID.nod) * DEG, 6);
        // Every sun stays above the horizon at the calm spread.
        for (const phase of PHASES) {
            for (const time of TIMES) {
                for (let k = 0; k < 3; k++) expect(sunVector(phase, k, time)[1]).toBeGreaterThan(0);
            }
        }
        // In front: toward -z, at the azimuth's side.
        const centre = centreAt(0);
        expect(centre[2]).toBeLessThan(0);
        expect(Math.sign(centre[0])).toBe(Math.sign(BRAID.azimuth));
        expect(BRAID_RATE).toBeCloseTo(TAU / BRAID.period, 15);
    });

    it('reads azimuth and elevation back from a direction', () => {
        for (const az of [-2.5, -0.47, 0, 0.3, 1.9]) {
            for (const el of [-0.4, 0, 0.16, 1.2]) {
                const [a, e] = azElOf(sunDirection(az, el));
                expect(a).toBeCloseTo(az, 12);
                expect(e).toBeCloseTo(el, 12);
            }
        }
    });

    it('names as the era the sun that rides lowest, and next the one that comes down after it', () => {
        let checked = 0;
        for (let i = 0; i <= 720; i++) {
            const phase = -TAU * 2 + (i / 720) * TAU * 4;
            const era = eraAt(phase);
            expect(era.mix).toBeGreaterThanOrEqual(0);
            expect(era.mix).toBeLessThanOrEqual(1);
            expect([0, 1, 2]).toContain(era.low);
            expect(era.next).not.toBe(era.low);
            // At the handover two suns ride equally low: only judge clear cases.
            if (era.mix < 0.02 || era.mix > 0.98) continue;
            for (const time of [0, 650]) {
                const elevations = [0, 1, 2].map((k) => azElOf(sunVector(phase, k, time))[1]);
                const lowest = elevations.indexOf(Math.min(...elevations));
                expect(era.low, `phase ${phase.toFixed(3)}`).toBe(lowest);
            }
            // The next era's sun is the one this era names next.
            expect(eraAt(phase + TAU / 3).low).toBe(era.next);
            checked += 1;
        }
        expect(checked).toBeGreaterThan(600);
        // A sun is exactly lowest in the middle of its era.
        for (let k = 0; k < 3; k++) {
            const phase = -Math.PI / 2 - (k * TAU) / 3;
            expect(eraAt(phase)).toMatchObject({ low: k });
            expect(eraAt(phase).mix).toBeCloseTo(0.5, 12);
        }
        // The era moves on as the phase rises (mix rises through it).
        expect(eraAt(-Math.PI / 2 + 0.1).mix).toBeGreaterThan(eraAt(-Math.PI / 2).mix);
    });

    it('sums the three suns\' colours by their powers to a near-neutral white', () => {
        expect(SUNS).toHaveLength(3);
        const sum = [0, 0, 0];
        SUNS.forEach((sun) => {
            expect(Math.max(...sun.rgb)).toBe(1); // peak channel 1
            sun.rgb.forEach((v, i) => { sum[i] += v * sun.power; });
            expect(sun.power).toBeGreaterThan(0);
            expect(sun.radius).toBeGreaterThan(0);
        });
        expect(Math.max(...sum) / Math.min(...sum)).toBeLessThan(1.15);
        // Each is its own colour: a different channel peaks in each.
        expect(new Set(SUNS.map((sun) => sun.rgb.indexOf(1))).size).toBe(3);
    });

    it('frames a portrait screen with a wider lens than a landscape one, and any aspect at all', () => {
        const wide = rigFor(16 / 9);
        const tall = rigFor(9 / 19.5);
        expect(tall.fov).toBeGreaterThan(wide.fov);
        for (const aspect of [0.2, 0.46, 1, 16 / 9, 21 / 9, 5, Number.NaN, undefined]) {
            const rig = rigFor(aspect);
            expect(rig.fov > 1 && rig.fov < 179, String(aspect)).toBe(true);
            expect(Number.isFinite(rig.pitch), String(aspect)).toBe(true);
            expect(Number.isFinite(rig.yaw), String(aspect)).toBe(true);
            // The lens never tips past straight down or up.
            expect(Math.abs(rig.pitch), String(aspect)).toBeLessThan(90);
        }
        // Nonsense reads as the landscape it is composed for; beyond the clamp nothing changes.
        expect(rigFor(Number.NaN)).toEqual(rigFor(16 / 9));
        expect(rigFor(9)).toEqual(rigFor(3.2));
    });
});

describe('Sunbraid core: small helpers', () => {
    it('smooths between edges in either order, and steps when they meet', () => {
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 0, 0.25)).toBeCloseTo(1 - smooth(0, 1, 0.25), 12);
        expect(smooth(2, 2, 1.9)).toBe(0);
        expect(smooth(2, 2, 2)).toBe(1);
    });

    it('draws the same sequence from the same seed', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        const values = Array.from({ length: 64 }, () => a());
        expect(values).toEqual(Array.from({ length: 64 }, () => b()));
        values.forEach((v) => expect(v >= 0 && v < 1).toBe(true));
        expect(new Set(values).size).toBe(64);
    });

    it('reads a hex colour as linear light', () => {
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
        expect(hexToLinear('808080')[0]).toBeCloseTo(0.2158605, 6);
    });

    it('reads a locked matrix as four cells round their own centre, y up', () => {
        const cells = cellsFromMatrix([[1, 1, 1, 1]]);
        expect(cells).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        const t = cellsFromMatrix([[0, 1, 0], [1, 1, 1]]);
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < 8; i += 2) {
            sx += t[i];
            sy += t[i + 1];
        }
        expect(sx).toBeCloseTo(0, 12);
        expect(sy).toBeCloseTo(0, 12);
        // The top cell (row 0) stands above the others (y up).
        expect(t[1]).toBeGreaterThan(t[3]);
        const out = new Array(8);
        expect(cellsFromMatrix([[1, 1], [1, 1]], out)).toBe(out);
        for (const nonsense of [null, 'T', [[1, 1, 1]], [[0, 0], [0, 0]], [[1], 'x']]) {
            expect(cellsFromMatrix(nonsense), JSON.stringify(nonsense)).toBeNull();
        }
    });
});

describe('Sunbraid core: the pieces\' colours', () => {
    it('keeps PIECE_COLORS in step with SUNBRAID_TETROMINOS, by piece code I T Z L S J O, then garbage', () => {
        expect(PIECE_KEYS).toEqual(['I', 'T', 'Z', 'L', 'S', 'J', 'O']);
        PIECE_KEYS.forEach((key, code) => {
            expect(PIECE_CODE[key], key).toBe(code);
            expect(pieceCode(key), key).toBe(code);
            expect(PIECE_COLORS[code], key).toBe(SUNBRAID_TETROMINOS.colors[key]);
        });
        expect(PIECE_COLORS[7]).toBe(SUNBRAID_TETROMINOS.colors.GARBAGE);
        expect(pieceCode('nope')).toBe(7);
        expect(pieceCode(undefined)).toBe(7);
        // Seven distinct colours, separated by value as well as hue.
        const pieces = PIECE_KEYS.map((key) => SUNBRAID_TETROMINOS.colors[key]);
        expect(new Set(pieces.map((hex) => hex.toUpperCase())).size).toBe(7);
        pieces.forEach((hex) => expect(hex).toMatch(/^#[0-9A-F]{6}$/i));
    });

    // The logic of scripts/palette-guideline-check.mjs (it exports nothing: it is a CLI gate).
    const GUIDELINE_BANDS = {
        I: [[160, 210]],
        O: [[32, 75]],
        T: [[245, 315]],
        S: [[90, 170]],
        Z: [[320, 360], [0, 20]],
        J: [[200, 250]],
        L: [[20, 50]],
    };
    function hexToHue(hex) {
        const n = hex.replace('#', '');
        const r = parseInt(n.slice(0, 2), 16) / 255;
        const g = parseInt(n.slice(2, 4), 16) / 255;
        const b = parseInt(n.slice(4, 6), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === min) return null;
        const d = max - min;
        let h;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return (h * 60 + 360) % 360;
    }
    const inBands = (hue, bands) => hue !== null && bands.some(([lo, hi]) => hue >= lo && hue <= hi);

    it('passes the palette gate with no familiar shape-to-hue role kept (0/7)', () => {
        // The gate reads the first hex after each shape key in the source file, as the script does.
        const source = readFileSync(path.join(themeDir, 'sunbraid-tetrominos.js'), 'utf8');
        const matched = [];
        for (const shape of Object.keys(GUIDELINE_BANDS)) {
            const pattern = `\\b${shape}\\s*:\\s*(?:\\{[^}]*?color\\s*:\\s*)?['"](#[0-9a-fA-F]{6})['"]`;
            const m = source.match(new RegExp(pattern));
            expect(m, shape).toBeTruthy();
            expect(m[1].toUpperCase(), shape).toBe(SUNBRAID_TETROMINOS.colors[shape].toUpperCase());
            if (inBands(hexToHue(m[1]), GUIDELINE_BANDS[shape])) matched.push(shape);
        }
        expect(matched).toEqual([]);
        // The config is wired: the theme reads it (the gate's dead-config check).
        const theme = readFileSync(path.join(themeDir, 'sunbraid-theme.js'), 'utf8');
        expect(theme).toContain('SUNBRAID_TETROMINOS');
        expect(source).toMatch(/\bcolors\s*:/);
    });
});

describe('Sunbraid noise: one bake for the CPU and the shaders', () => {
    const data = noiseData();
    const texel = (i, j, c) => data[((((j % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE) * NOISE_SIZE
        + (((i % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE)) * 4 + c] / 255;

    it('bakes once, deterministically, four independent fields of real range', () => {
        expect(noiseData()).toBe(data);
        expect(data).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        expect(NOISE_PERIODS).toHaveLength(4);
        const small = bakeNoise(32);
        expect(bakeNoise(32)).toEqual(small);
        expect(bakeNoise(32, 7)).not.toEqual(small);
        for (let c = 0; c < 4; c++) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < data.length; i += 4) {
                lo = Math.min(lo, data[i]);
                hi = Math.max(hi, data[i]);
            }
            expect(hi - lo, `channel ${c}`).toBeGreaterThan(60);
        }
    });

    it('reads a texel centre exactly, and bilinearly between centres', () => {
        for (const [i, j, c] of [[0, 0, 0], [17, 200, 1], [255, 3, 2], [128, 128, 3], [255, 255, 0]]) {
            const u = (i + 0.5) / NOISE_SIZE;
            const v = (j + 0.5) / NOISE_SIZE;
            expect(noiseAt(u, v, c)).toBeCloseTo(texel(i, j, c), 12);
            // A quarter of the way to the next texel along x, and halfway along y.
            const fx = 0.25;
            const fy = 0.5;
            const expected = (texel(i, j, c) * (1 - fx) + texel(i + 1, j, c) * fx) * (1 - fy)
                + (texel(i, j + 1, c) * (1 - fx) + texel(i + 1, j + 1, c) * fx) * fy;
            expect(noiseAt(u + fx / NOISE_SIZE, v + fy / NOISE_SIZE, c)).toBeCloseTo(expected, 12);
        }
    });

    it('wraps: a read a whole tile away is the same read, and the edge blends into the far texel', () => {
        const random = mulberry32(9);
        for (let n = 0; n < 50; n++) {
            const u = random();
            const v = random();
            const c = n % 4;
            const read = noiseAt(u, v, c);
            expect(noiseAt(u + 1, v, c)).toBeCloseTo(read, 9);
            expect(noiseAt(u - 3, v + 2, c)).toBeCloseTo(read, 9);
            expect(read >= 0 && read <= 1).toBe(true);
        }
        // u = 0 lies halfway between the last texel's centre and the first's.
        expect(noiseAt(0, 0.5 / NOISE_SIZE, 0)).toBeCloseTo((texel(NOISE_SIZE - 1, 0, 0) + texel(0, 0, 0)) / 2, 12);
    });
});

describe('Sunbraid plan: the valley floor and the towers', () => {
    it('gives a finite floor everywhere in a 20 km square', () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let x = -10000; x <= 10000; x += 250) {
            for (let z = -10000; z <= 10000; z += 250) {
                const h = groundHeight(x, z);
                expect(Number.isFinite(h), `${x}, ${z}`).toBe(true);
                lo = Math.min(lo, h);
                hi = Math.max(hi, h);
            }
        }
        expect(hi - lo).toBeGreaterThan(50);
        expect(groundHeight).toBe(floorHeight);
    });

    it('rises to the far rim: the floor out at 9-10 km stands well above the valley round the eye', () => {
        const ring = (r) => {
            let sum = 0;
            for (let i = 0; i < 72; i++) {
                const a = (i / 72) * TAU;
                sum += groundHeight(Math.sin(a) * r, -Math.cos(a) * r);
            }
            return sum / 72;
        };
        const valley = (ring(300) + ring(1000) + ring(1800)) / 3;
        const rim = (ring(9000) + ring(9600) + ring(10000)) / 3;
        expect(rim - valley).toBeGreaterThan(120);
        expect(ring(10000)).toBeGreaterThan(ring(5000));
    });

    it('hovers the eye EYE_ALTITUDE over the floor beneath it', () => {
        const eye = eyePosition();
        expect(eye[0]).toBe(0);
        expect(eye[2]).toBe(0);
        expect(eye[1]).toBeCloseTo(groundHeight(0, 0) + EYE_ALTITUDE, 12);
        const out = [9, 9, 9];
        expect(eyePosition(out)).toBe(out);
    });

    it('lays every tower out with a shape it has, out in the valley', () => {
        expect(SPIRE_LAYOUT.length).toBeGreaterThan(0);
        SPIRE_LAYOUT.forEach((s, index) => {
            expect(Number.isInteger(s.variant), `tower ${index}`).toBe(true);
            expect(s.variant >= 0 && s.variant < MONOLITH_VARIANTS, `tower ${index}`).toBe(true);
            expect(variantOf(index)).toBe(s.variant);
            expect(s.distance, `tower ${index}`).toBeGreaterThan(500);
            expect(s.h, `tower ${index}`).toBeGreaterThan(0);
            expect(Math.abs(s.bearing), `tower ${index}`).toBeLessThan(90); // in front of the eye
            expect(Number.isFinite(s.twist), `tower ${index}`).toBe(true);
            const foot = spireFoot(s);
            expect(Math.hypot(foot[0], foot[2])).toBeCloseTo(s.distance, 6);
            expect(foot[1]).toBeCloseTo(groundHeight(foot[0], foot[2]), 12);
        });
        expect(variantOf(SPIRE_LAYOUT.length + 3)).toBe(0);
    });

    it('casts each tower\'s shadow from flat-topped cylinders standing on its foot, up to its top', () => {
        const casters = spireCasters();
        expect(casters.length).toBeLessThanOrEqual(MAX_CASTERS);
        SPIRE_LAYOUT.forEach((s, index) => {
            const own = casters.filter((c) => c.stone === index);
            expect(own.length, `tower ${index}`).toBeGreaterThanOrEqual(1);
            expect(own.length).toBe(monolithProxies(s.variant).length);
            const foot = spireFoot(s);
            own.forEach((c) => {
                expect(c.y1, `tower ${index} part ${c.part}`).toBeGreaterThan(c.y0);
                expect(c.r, `tower ${index} part ${c.part}`).toBeGreaterThan(0);
                [c.x, c.z, c.y0, c.y1, c.r].forEach((v) => expect(Number.isFinite(v)).toBe(true));
                // Near its own foot (a mitten's tower stands off to one side, never off the stone).
                expect(Math.hypot(c.x - foot[0], c.z - foot[2])).toBeLessThan(s.h);
            });
            // Buried a little at the foot, as tall as the tower, each tier reaching a little down
            // into the one under it (stacked edge to edge, a pale band crossed the shadow at each
            // joint: both cylinders were half hidden there).
            expect(own[0].y0).toBeCloseTo(foot[1] - MONOLITH_BURY * s.h, 6);
            expect(own[own.length - 1].y1).toBeCloseTo(foot[1] + s.h, 6);
            for (let k = 1; k < own.length; k++) {
                expect(own[k].y0).toBeCloseTo(own[k - 1].y1 - TIER_OVERLAP * s.h, 9);
                expect(own[k].y0).toBeGreaterThan(own[k - 1].y0);
            }
        });
        expect(TIER_OVERLAP).toBeGreaterThan(0);
        expect(TIER_OVERLAP).toBeLessThan(0.06);
        // Each tower's own rows in the list (its stone leaves them out of its shadows): one run
        // a tower, in the layout's order, covering the list exactly.
        const ranges = casterRanges(casters);
        expect(ranges).toHaveLength(SPIRE_LAYOUT.length);
        let row = 0;
        ranges.forEach((range, index) => {
            expect(range.first, `tower ${index}`).toBe(row);
            expect(range.count).toBe(monolithProxies(SPIRE_LAYOUT[index].variant).length);
            for (let k = 0; k < range.count; k++) expect(casters[row + k].stone).toBe(index);
            row += range.count;
        });
        expect(row).toBe(casters.length);
        expect(casterRanges()).toEqual(ranges);
    });
});

describe('Sunbraid monoliths', () => {
    const KINDS = { tower: [0, 2, 4, 6], butte: [1, 5], mitten: [3, 7] };
    /** Triangles a level may hold (the sculpt's own budget: scripts/blender/sunbraid_monoliths.py). */
    const BUDGET = { hi: 9000, lo: 2500 };
    const VARIANTS = Array.from({ length: MONOLITH_VARIANTS }, (_, v) => v);
    const CASES = VARIANTS.flatMap((v) => MONOLITH_LEVELS.map((level) => [v, level]));

    it('makes towers, buttes and mittens of the variants the layout names', () => {
        expect(MONOLITH_VARIANTS).toBe(8);
        expect(MONOLITH_LEVELS).toEqual(['hi', 'lo']);
        for (const [kind, variants] of Object.entries(KINDS)) {
            variants.forEach((v) => expect(monolithKind(v), `variant ${v}`).toBe(kind));
        }
        expect(monolithKind(MONOLITH_VARIANTS + 1)).toBe(monolithKind(1));
        expect(monolithKind(-1)).toBe(monolithKind(MONOLITH_VARIANTS - 1));
        // A shape is decoded once a page.
        expect(monolithMesh(3, 'hi')).toBe(monolithMesh(3, 'hi'));
        expect(monolithMesh(3, 'hi')).not.toBe(monolithMesh(3, 'lo'));
        expect(() => monolithMesh(0, 'mid')).toThrow(/no monolith/);
    });

    it.each(CASES)('decodes variant %i at %s as a clean mesh', (v, level) => {
        const mesh = monolithMesh(v, level);
        const count = mesh.vertexCount;
        expect(mesh.kind).toBe(monolithKind(v));
        expect(mesh.position).toHaveLength(count * 3);
        expect(mesh.normal).toHaveLength(count * 3);
        expect(mesh.shade).toHaveLength(count * 2);
        expect(mesh.index).toHaveLength(mesh.triangleCount * 3);
        expect(mesh.triangleCount).toBeLessThanOrEqual(BUDGET[level]);
        expect(mesh.triangleCount).toBeGreaterThan(400);
        expect(mesh.position.every(Number.isFinite)).toBe(true);
        expect(Math.max(...mesh.index)).toBe(count - 1);
        for (let k = 0; k < count; k++) {
            expect(Math.hypot(mesh.normal[k * 3], mesh.normal[k * 3 + 1], mesh.normal[k * 3 + 2])).toBeCloseTo(1, 5);
        }
        // Buried at the foot, capped at unit height.
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k < count; k++) {
            lo = Math.min(lo, mesh.position[k * 3 + 1]);
            hi = Math.max(hi, mesh.position[k * 3 + 1]);
        }
        expect(lo).toBeCloseTo(-MONOLITH_BURY, 3);
        expect(hi).toBeGreaterThan(0.99);
        expect(hi).toBeLessThan(1.01);
        // Occlusion and crest stay in their range, and use it (joints dark, arrises worn).
        let dark = 0;
        let worn = 0;
        for (let k = 0; k < count; k++) {
            const ao = mesh.shade[k * 2];
            const crest = mesh.shade[k * 2 + 1];
            expect(ao >= 0 && ao <= 1 && crest >= 0 && crest <= 1).toBe(true);
            if (ao < 0.4) dark += 1;
            if (crest > 0.8) worn += 1;
        }
        expect(dark).toBeGreaterThan(count * 0.05);
        expect(worn).toBeGreaterThan(count * 0.05);
    });

    it.each(CASES)('winds variant %i at %s outward, with no sliver of no area', (v, level) => {
        const { position: P, normal: N, index: I } = monolithMesh(v, level);
        let inward = 0;
        let empty = 0;
        for (let f = 0; f < I.length; f += 3) {
            const a = I[f] * 3;
            const b = I[f + 1] * 3;
            const c = I[f + 2] * 3;
            const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
            const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
            const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            if (Math.hypot(...n) < 1e-10) {
                empty += 1;
                continue;
            }
            // The face the winding makes looks the way its corners' normals do.
            const facing = n[0] * (N[a] + N[b] + N[c]) + n[1] * (N[a + 1] + N[b + 1] + N[c + 1])
                + n[2] * (N[a + 2] + N[b + 2] + N[c + 2]);
            if (facing <= 0) inward += 1;
        }
        expect(empty).toBe(0);
        expect(inward / (I.length / 3)).toBeLessThan(0.002);
    });

    it.each(VARIANTS)('stands variant %i\'s shadow cylinders in its stone', (v) => {
        const mesh = monolithMesh(v, 'hi');
        const proxies = monolithProxies(v);
        // At most four (the shadow rows are a budget), stacked from the buried foot to the top.
        expect(proxies.length).toBeGreaterThanOrEqual(2);
        expect(proxies.length).toBeLessThanOrEqual(4);
        expect(proxies[0].t0).toBeCloseTo(-MONOLITH_BURY, 9);
        expect(proxies[proxies.length - 1].t1).toBe(1);
        for (let k = 1; k < proxies.length; k++) expect(proxies[k].t0).toBe(proxies[k - 1].t1);
        const count = mesh.vertexCount;
        proxies.forEach((proxy, k) => {
            expect(proxy.t1).toBeGreaterThan(proxy.t0);
            expect(proxy.r).toBeGreaterThan(0);
            // Where the tier's stone stands from the cylinder's axis (above the talus at the
            // foot): the cylinder runs through the middle of it, so a shadow has stone above it
            // and the stone a shadow under it.
            const radii = [];
            for (let i = 0; i < count; i++) {
                const y = mesh.position[i * 3 + 1];
                if (y < Math.max(proxy.t0, 0.1) || y > proxy.t1) continue;
                radii.push(Math.hypot(mesh.position[i * 3] - proxy.x, mesh.position[i * 3 + 2] - proxy.z) / proxy.r);
            }
            radii.sort((p, q) => p - q);
            expect(radii.length, `tier ${k}`).toBeGreaterThan(40);
            const median = radii[Math.floor(radii.length / 2)];
            expect(median, `tier ${k}`).toBeGreaterThan(0.85);
            expect(median, `tier ${k}`).toBeLessThan(1.3);
            expect(radii[Math.floor(radii.length * 0.9)], `tier ${k}`).toBeLessThan(1.9);
        });
        // A mitten's tower stands off to one side of its shoulder; a tower's tiers keep to one axis.
        const top = proxies[proxies.length - 1];
        const off = Math.hypot(top.x - proxies[0].x, top.z - proxies[0].z);
        if (monolithKind(v) === 'mitten') expect(off).toBeGreaterThan(proxies[0].r * 0.5);
        else expect(off).toBeLessThan(proxies[0].r);
    });

    it('keeps every level of every shape in the generated module, a megabyte or so in all', () => {
        const bytes = readFileSync(path.join(themeDir, 'sunbraid-monolith-models.js')).length;
        expect(bytes).toBeLessThan(1.3 * 1024 * 1024);
        const source = readFileSync(path.join(themeDir, 'sunbraid-monolith-models.js'), 'utf8');
        expect(source).toMatch(/GENERATED/);
        expect(source).not.toMatch(/\r/);
    });
});
