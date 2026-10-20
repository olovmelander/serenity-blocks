/**
 * Sunbraid — the three-free modules the world, the shaders and the playground share: the suns
 * (sunbraid-core.js), the baked noise (sunbraid-noise.js), the valley's plan (sunbraid-plan.js)
 * and the towers' shapes (sunbraid-spire-shape.js).
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
    EYE_ALTITUDE, MAX_CASTERS, SPIRE_LAYOUT, eyePosition, floorHeight, groundHeight, spireCasters, spireFoot, variantOf,
} from '../../src/themes/sunbraid/sunbraid-plan.js';
import {
    SPIRE_BURY, SPIRE_VARIANTS, buildSpireMesh, spireAxis, spireKind, spireProxies, spireRecipe,
} from '../../src/themes/sunbraid/sunbraid-spire-shape.js';
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
            expect(s.variant >= 0 && s.variant < SPIRE_VARIANTS, `tower ${index}`).toBe(true);
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
            expect(own.length).toBe(spireProxies(s.variant).length);
            const foot = spireFoot(s);
            own.forEach((c) => {
                expect(c.y1, `tower ${index} part ${c.part}`).toBeGreaterThan(c.y0);
                expect(c.r, `tower ${index} part ${c.part}`).toBeGreaterThan(0);
                [c.x, c.z, c.y0, c.y1, c.r].forEach((v) => expect(Number.isFinite(v)).toBe(true));
                // Near its own foot (a mitten's tower stands off to one side, never off the stone).
                expect(Math.hypot(c.x - foot[0], c.z - foot[2])).toBeLessThan(s.h);
            });
            // Buried a little at the foot, as tall as the tower, the tiers stacked without a gap.
            expect(own[0].y0).toBeCloseTo(foot[1] - SPIRE_BURY * s.h, 6);
            expect(own[own.length - 1].y1).toBeCloseTo(foot[1] + s.h, 6);
            for (let k = 1; k < own.length; k++) expect(own[k].y0).toBeCloseTo(own[k - 1].y1, 9);
        });
    });
});

describe('Sunbraid spire shapes', () => {
    const KINDS = { tower: [0, 2, 4, 6], butte: [1, 5], mitten: [3, 7] };

    it('makes towers, buttes and mittens of the variants the layout names', () => {
        for (const [kind, variants] of Object.entries(KINDS)) {
            variants.forEach((v) => expect(spireKind(v), `variant ${v}`).toBe(kind));
        }
        expect(spireKind(SPIRE_VARIANTS + 1)).toBe(spireKind(1));
        expect(spireKind(-1)).toBe(spireKind(SPIRE_VARIANTS - 1));
        // A recipe is a function of its variant.
        expect(spireRecipe(3)).toEqual(spireRecipe(3));
        expect(spireRecipe(3)).not.toEqual(spireRecipe(4));
    });

    // Each variant at a modest resolution (the tiers' own budgets are the world's business).
    const VARIANTS = Array.from({ length: SPIRE_VARIANTS }, (_, v) => v);
    const meshes = Array.from({ length: SPIRE_VARIANTS }, (_, v) => buildSpireMesh(v, 40, 80));

    it.each(VARIANTS)('builds variant %i as a clean mesh', (v) => {
        const mesh = meshes[v];
        const count = mesh.position.length / 3;
        expect(mesh.normal).toHaveLength(count * 3);
        expect(mesh.spire).toHaveLength(count * 2);
        expect(mesh.position.every(Number.isFinite)).toBe(true);
        expect(mesh.normal.every(Number.isFinite)).toBe(true);
        expect(mesh.spire.every(Number.isFinite)).toBe(true);
        expect(mesh.index.length % 3).toBe(0);
        expect(Math.max(...mesh.index)).toBeLessThan(count);
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
        expect(lo).toBeCloseTo(-SPIRE_BURY, 6); // a Float32 attribute
        expect(hi).toBeGreaterThanOrEqual(1);
        expect(hi).toBeLessThan(1.01);
        // Occlusion stays in its range.
        for (let k = 0; k < count; k++) {
            const ao = mesh.spire[k * 2 + 1];
            expect(ao >= 0.3 && ao <= 1).toBe(true);
        }
    });

    it.each(VARIANTS)('turns variant %i\'s normals outward on its sides', (v) => {
        const mesh = meshes[v];
        const count = mesh.position.length / 3 - 1; // the cap's centre has no side
        const axis = [0, 0];
        let sum = 0;
        let n = 0;
        let inward = 0;
        for (let k = 0; k < count; k++) {
            const t = mesh.spire[k * 2];
            if (t < 0.02 || t > 0.95) continue; // the buried foot and the broken rim under the cap
            spireAxis(mesh.recipe, t, axis);
            const rx = mesh.position[k * 3] - axis[0];
            const rz = mesh.position[k * 3 + 2] - axis[1];
            const r = Math.hypot(rx, rz);
            if (r < 1e-6) continue;
            const d = (mesh.normal[k * 3] * rx + mesh.normal[k * 3 + 2] * rz) / r;
            sum += d;
            n += 1;
            if (d < 0) inward += 1;
        }
        expect(n).toBeGreaterThan(100);
        expect(sum / n).toBeGreaterThan(0.5);
        expect(inward / n).toBeLessThan(0.05);
    });

    it.each(VARIANTS)('stands variant %i\'s shadow cylinders inside its cliffs', (v) => {
        const mesh = meshes[v];
        const rec = mesh.recipe;
        const proxies = spireProxies(v);
        expect(proxies).toHaveLength(rec.tiers.length + 1);
        const count = mesh.position.length / 3 - 1;
        const axis = [0, 0];
        proxies.forEach((proxy, k) => {
            expect(proxy.t1).toBeGreaterThan(proxy.t0);
            expect(proxy.r).toBeGreaterThan(0);
            // The mesh's mean radius over the tier (above the scree apron on the bottom tier).
            const from = k === 0 ? Math.max(proxy.t0, rec.apronTop) : proxy.t0;
            let sum = 0;
            let n = 0;
            for (let i = 0; i < count; i++) {
                const t = mesh.spire[i * 2];
                if (t < from || t > Math.min(proxy.t1, rec.crown)) continue;
                spireAxis(rec, t, axis);
                sum += Math.hypot(mesh.position[i * 3] - axis[0], mesh.position[i * 3 + 2] - axis[1]);
                n += 1;
            }
            expect(n, `tier ${k}`).toBeGreaterThan(0);
            expect(proxy.r, `tier ${k}`).toBeLessThan(sum / n);
            expect(proxy.r, `tier ${k}`).toBeGreaterThan((sum / n) * 0.8);
            // The cylinder's axis is the shape's own at that height.
            spireAxis(rec, (proxy.t0 + proxy.t1) / 2, axis);
            expect(proxy.x).toBeCloseTo(axis[0], 12);
            expect(proxy.z).toBeCloseTo(axis[1], 12);
        });
        // Stacked from the buried foot to the top without a gap.
        expect(proxies[0].t0).toBeCloseTo(-SPIRE_BURY, 12);
        expect(proxies[proxies.length - 1].t1).toBe(1);
        for (let k = 1; k < proxies.length; k++) expect(proxies[k].t0).toBe(proxies[k - 1].t1);
    });
});
