/**
 * Golden Forest — the living lake, part one: the plain-number contracts (no scene, no assets).
 *
 * The airs (golden-forest-airs.js: five weathers on a clock of their own), the far ranges' height
 * function (golden-forest-ranges.js), the cues the reaction director gained for the events' own
 * shapes (golden-forest-reactions.js: the fan's shafts and the sunburst, the lake's tracks, the
 * bursts to throw, the skeins called, the rush, the dusk, the gilding), the stage's projection,
 * the tier table's new columns and the board's palette.
 *
 * The numbers these are tuned with are read from the modules, never typed here: a strength, a
 * time or a colour may change under these tests, the behaviour may not.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GOLDEN_FOREST_AIRS, GOLDEN_FOREST_AIR_HOLD, GOLDEN_FOREST_AIR_SCALARS, GOLDEN_FOREST_AIR_SECONDS,
    createGoldenForestAir, goldenForestAirAt, goldenForestAirDrift, goldenForestAirIndex, goldenForestAirName,
} from '../../src/themes/golden-forest/golden-forest-airs.js';
import { GOLDEN_FOREST_VIEWS } from '../../src/themes/golden-forest/golden-forest-composition.js';
import {
    GOLDEN_FOREST_ROAD, GOLDEN_FOREST_SWIRL, GOLDEN_FOREST_WAVE,
} from '../../src/themes/golden-forest/golden-forest-lake.js';
import { GOLDEN_FOREST_SUN_DIRECTION } from '../../src/themes/golden-forest/golden-forest-light.js';
import {
    GOLDEN_FOREST_MOODS, GOLDEN_FOREST_MOOD_SECONDS,
} from '../../src/themes/golden-forest/golden-forest-moods.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';
import { GOLDEN_FOREST_RANGES, createGoldenForestRanges } from '../../src/themes/golden-forest/golden-forest-ranges.js';
import {
    GOLDEN_FOREST_BEAM_SLOTS, GOLDEN_FOREST_DUSK, GOLDEN_FOREST_FAN, GOLDEN_FOREST_FLURRIES,
    GOLDEN_FOREST_TRACK_SECONDS, GOLDEN_FOREST_TRACK_SLOTS, GoldenForestReactions,
} from '../../src/themes/golden-forest/golden-forest-reactions.js';
import {
    GOLDEN_FOREST_DEFAULT_BOARD, GOLDEN_FOREST_STAGE_DEPTH, GoldenForestStage,
} from '../../src/themes/golden-forest/golden-forest-stage.js';
import { GOLDEN_FOREST_TETROMINOS } from '../../src/themes/golden-forest/golden-forest-tetrominos.js';
import { goldenForestCamera, seededRandom } from './helpers/golden-forest-lake.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const TRACK_KINDS = ['waves', 'swirls', 'roads'];

function create(seed = 271, quality = 'High') {
    return new GoldenForestReactions({ quality, rng: seededRandom(seed) });
}

/** Step a director in whole frames, handing every frame to `each`; returns the last frame. */
function advance(reactions, seconds, each = null) {
    const frames = Math.round(seconds / DT);
    let frame = reactions.getFrame();
    for (let index = 0; index < frames; index += 1) {
        frame = reactions.update(DT);
        each?.(frame, index);
    }
    return frame;
}

const cell = (x, y) => ({ x, y, shape: [[1]] });

/** The highest a cue reads over `seconds` after `events` have been played on a fresh director. */
function peakOf(key, events, seconds = 8) {
    const reactions = create();
    events(reactions);
    let top = 0;
    advance(reactions, seconds, (frame) => { top = Math.max(top, frame[key]); });
    return top;
}

describe('the airs of the lake', () => {
    const N = GOLDEN_FOREST_AIRS.length;

    it('are five weathers, each with a name and every number an air sets', () => {
        expect(GOLDEN_FOREST_AIRS.map((air) => air.name)).toEqual(['still', 'burning sky', 'breeze', 'clear', 'mist']);
        expect(Object.isFrozen(GOLDEN_FOREST_AIRS)).toBe(true);
        expect(Object.isFrozen(GOLDEN_FOREST_AIR_SCALARS)).toBe(true);
        expect(new Set(GOLDEN_FOREST_AIR_SCALARS).size).toBe(GOLDEN_FOREST_AIR_SCALARS.length);
        for (const air of GOLDEN_FOREST_AIRS) {
            expect(Object.isFrozen(air), air.name).toBe(true);
            expect(Object.keys(air).sort(), air.name).toEqual(['name', ...GOLDEN_FOREST_AIR_SCALARS].sort());
            for (const key of GOLDEN_FOREST_AIR_SCALARS) {
                expect(Number.isFinite(air[key]) && air[key] >= 0, `${air.name}.${key}`).toBe(true);
            }
            // Shares of the sky, of the smoke and of the far ridges' sharpness are shares.
            for (const key of ['deck', 'smoke', 'clarity']) {
                expect(air[key], `${air.name}.${key}`).toBeLessThanOrEqual(1);
            }
        }
    });

    it('start a session in the still air: the lake exactly as it was built', () => {
        expect(GOLDEN_FOREST_AIRS[0]).toMatchObject({
            name: 'still', deck: 0, bars: 1, mist: 1, haze: 1, rays: 1, wind: 0, ruffle: 0, drift: 1, glitter: 1,
        });
        // Somewhere to keep an air's numbers starts there too, and is the caller's own to fill.
        const first = createGoldenForestAir();
        const second = createGoldenForestAir();
        expect(first).not.toBe(second);
        expect(Object.isFrozen(first)).toBe(false);
        expect(Object.keys(first)).toEqual([...GOLDEN_FOREST_AIR_SCALARS]);
        for (const key of GOLDEN_FOREST_AIR_SCALARS) expect(first[key]).toBe(GOLDEN_FOREST_AIRS[0][key]);
        expect(goldenForestAirDrift(0)).toBe(0);
        expect(goldenForestAirName(goldenForestAirDrift(0))).toBe('still');
    });

    it('are that air exactly on a whole phase, round and round, and a mix of two between', () => {
        const out = createGoldenForestAir();
        for (let k = -2 * N; k <= 3 * N; k += 1) {
            const air = GOLDEN_FOREST_AIRS[((k % N) + N) % N];
            expect(goldenForestAirAt(k, out)).toBe(out);
            for (const key of GOLDEN_FOREST_AIR_SCALARS) expect(out[key], `${k} ${key}`).toBe(air[key]);
            expect(goldenForestAirName(k)).toBe(air.name);
        }
        // Between two airs every number lies between theirs, and moves steadily from one to the other.
        for (let a = 0; a < N; a += 1) {
            const from = GOLDEN_FOREST_AIRS[a];
            const to = GOLDEN_FOREST_AIRS[(a + 1) % N];
            let last = { ...goldenForestAirAt(a) };
            for (let step = 1; step <= 20; step += 1) {
                const now = goldenForestAirAt(a + step / 20);
                for (const key of GOLDEN_FOREST_AIR_SCALARS) {
                    const low = Math.min(from[key], to[key]) - 1e-12;
                    const high = Math.max(from[key], to[key]) + 1e-12;
                    expect(now[key] >= low && now[key] <= high, `${from.name} > ${to.name} ${key}`).toBe(true);
                    // Toward the next air, never back.
                    expect((now[key] - last[key]) * Math.sign(to[key] - from[key])).toBeGreaterThanOrEqual(-1e-12);
                }
                last = { ...now };
            }
            for (const key of GOLDEN_FOREST_AIR_SCALARS) expect(last[key]).toBeCloseTo(to[key], 12);
        }
        // Without somewhere to put it, a new place every call.
        expect(goldenForestAirAt(1)).not.toBe(goldenForestAirAt(1));
        expect(goldenForestAirAt(1)).toEqual(goldenForestAirAt(1));
    });

    it('turn by the clock alone: each rests a while, pure, then melts into the next without a jump', () => {
        const PERIOD = GOLDEN_FOREST_AIR_SECONDS;
        expect(PERIOD).toBeGreaterThan(0);
        expect(GOLDEN_FOREST_AIR_HOLD).toBeGreaterThan(0);
        expect(GOLDEN_FOREST_AIR_HOLD).toBeLessThan(1);
        for (let k = 0; k <= 2 * N; k += 1) {
            // On its hour, and still there at the end of its rest.
            expect(goldenForestAirDrift(k * PERIOD)).toBe(k);
            expect(goldenForestAirDrift((k + GOLDEN_FOREST_AIR_HOLD * 0.99) * PERIOD)).toBe(k);
            // Half-way through the melt it is neither.
            const halfMelted = k + GOLDEN_FOREST_AIR_HOLD + (1 - GOLDEN_FOREST_AIR_HOLD) * 0.5;
            const melting = goldenForestAirDrift(halfMelted * PERIOD);
            expect(melting).toBeGreaterThan(k);
            expect(melting).toBeLessThan(k + 1);
        }
        // Never backward and never a jump, frame by frame through two whole rounds.
        let last = 0;
        let worst = 0;
        for (let time = 0; time <= 2 * N * PERIOD; time += DT * 4) {
            const now = goldenForestAirDrift(time);
            expect(now).toBeGreaterThanOrEqual(last);
            worst = Math.max(worst, now - last);
            last = now;
        }
        // (A melt takes most of a period: a step of four frames is a sliver of an air.)
        expect(worst).toBeLessThan(0.01);
        // A function of the time alone, and of nothing a caller could have left behind.
        expect(goldenForestAirDrift(1234.5)).toBe(goldenForestAirDrift(1234.5));
        for (const time of [-5, NaN, undefined, null, 'soon']) expect(goldenForestAirDrift(time)).toBe(0);
    });

    it('turn at another pace than the hours, so the same hour is not long the same evening', () => {
        const hours = GOLDEN_FOREST_MOODS.length * GOLDEN_FOREST_MOOD_SECONDS;
        const airs = N * GOLDEN_FOREST_AIR_SECONDS;
        expect(GOLDEN_FOREST_AIR_SECONDS).not.toBe(GOLDEN_FOREST_MOOD_SECONDS);
        // The pair of wheels comes round later than either wheel alone.
        const gcd = (a, b) => (b < 1e-9 ? a : gcd(b, a % b));
        const together = (hours * airs) / gcd(hours, airs);
        expect(together).toBeGreaterThan(Math.max(hours, airs));
    });

    it('name the air a phase is nearest, and find an air by name or by number', () => {
        for (let k = 0; k < N; k += 1) {
            const { name } = GOLDEN_FOREST_AIRS[k];
            expect(goldenForestAirName(k + 0.49)).toBe(name);
            expect(goldenForestAirName(k - 0.49)).toBe(name);
            expect(goldenForestAirName(k + N * 7)).toBe(name);
            expect(goldenForestAirName(k - N * 7)).toBe(name);
            expect(goldenForestAirIndex(name)).toBe(k);
            expect(goldenForestAirIndex(name.toUpperCase())).toBe(k);
            expect(goldenForestAirIndex(`  ${name.replace(/ /g, '-')} `)).toBe(k);
            expect(goldenForestAirIndex(name.replace(/ /g, '_'))).toBe(k);
            expect(goldenForestAirIndex(name.replace(/ /g, ''))).toBe(k);
            expect(goldenForestAirIndex(k)).toBe(k);
            expect(goldenForestAirIndex(String(k))).toBe(k);
            expect(goldenForestAirIndex(k + N)).toBe(k);
            expect(goldenForestAirIndex(k - N)).toBe(k);
        }
        for (const phase of [NaN, Infinity, undefined, null, 'mist']) expect(goldenForestAirName(phase)).toBe('still');
        for (const none of [null, undefined, '', 'fog', 'burning', {}, NaN]) {
            expect(goldenForestAirIndex(none)).toBe(-1);
        }
    });
});

describe('the far ranges', () => {
    const R = GOLDEN_FOREST_RANGES;
    const SEEDS = Array.from({ length: 40 }, (_, index) => 1 + index * 7919);
    const EYE = [0, GOLDEN_FOREST_VIEWS.landscape.position[1], R.eyeZ];

    /** How high the ranges stand against the sky on a bearing from the eye (degrees), and where. */
    function skyline(height, bearing) {
        let best = -Infinity;
        for (let z = R.maxZ; z >= R.minZ; z -= 5) {
            const x = Math.tan(bearing * DEG) * (R.eyeZ - z);
            const away = Math.hypot(x - EYE[0], z - EYE[2]);
            best = Math.max(best, Math.atan2(height(x, z) - EYE[1], away) / DEG);
        }
        return best;
    }

    it('are composed for the landscape eye and for where the sun really stands', () => {
        expect(Object.isFrozen(R)).toBe(true);
        for (const key of ['front', 'back', 'summit', 'col']) expect(Object.isFrozen(R[key]), key).toBe(true);
        expect(R.eyeZ).toBe(GOLDEN_FOREST_VIEWS.landscape.position[2]);
        const sun = GOLDEN_FOREST_SUN_DIRECTION;
        expect(Math.atan2(sun.x, -sun.z) / DEG).toBeCloseTo(R.sunAzimuth, 6);
        // Two ranges, the back one beyond the front one, both inside the grid; the summit too.
        expect(R.back.z).toBeLessThan(R.front.z);
        for (const line of [R.front, R.back]) {
            expect(line.z).toBeGreaterThan(R.minZ);
            expect(line.z).toBeLessThan(R.maxZ);
        }
        expect(R.summit.x).toBeGreaterThan(0);
        expect(R.summit.x).toBeLessThan(R.maxX);
        expect(R.summit.z).toBeGreaterThan(R.minZ);
        expect(R.summit.z).toBeLessThan(R.maxZ);
    });

    it('are finite ground at or above the lake everywhere, and nothing at all outside the grid', () => {
        const { height } = createGoldenForestRanges(2341);
        let highest = 0;
        for (let x = R.minX - 200; x <= R.maxX + 200; x += 37) {
            for (let z = R.minZ - 200; z <= R.maxZ + 200; z += 23) {
                const h = height(x, z);
                expect(Number.isFinite(h) && h >= 0, `(${x}, ${z}) = ${h}`).toBe(true);
                if (x < R.minX || x > R.maxX || z < R.minZ || z > R.maxZ) expect(h, `(${x}, ${z})`).toBe(0);
                highest = Math.max(highest, h);
            }
        }
        // Mountains, not hummocks: taller than either range's resting crest is not asked, but real height is.
        expect(highest).toBeGreaterThan(R.front.crest * 0.5);
        const far = [[1e9, R.front.z], [-1e9, R.front.z], [0, 1e9], [0, -1e9], [Infinity, 0], [0, -Infinity]];
        for (const [x, z] of far) {
            expect(height(x, z)).toBe(0);
        }
        // Over the lake, the near shores and the fells there is none of it.
        expect(height(0, 0)).toBe(0);
        expect(height(0, -400)).toBe(0);
    });

    it('are the same mountains for the same seed, and others for another', () => {
        const sample = (seed) => {
            const { height } = createGoldenForestRanges(seed);
            const values = [];
            for (let x = R.minX + 400; x < R.maxX - 400; x += 190) {
                values.push(height(x, R.front.z), height(x, R.back.z));
            }
            return values;
        };
        expect(sample(7)).toEqual(sample(7));
        expect(sample(8)).not.toEqual(sample(7));
        // A seed that is no number is the ranges' own.
        const own = sample(undefined);
        for (const seed of [NaN, Infinity, null, 'ranges']) expect(sample(seed)).toEqual(own);
        expect(sample(7.9)).toEqual(sample(7));
    });

    it('sink to the lake at either end of the grid, so no wall stands there', () => {
        for (const seed of SEEDS.slice(0, 8)) {
            const { height } = createGoldenForestRanges(seed);
            for (let z = R.minZ; z <= R.maxZ; z += 11) {
                expect(height(R.minX, z)).toBe(0);
                expect(height(R.maxX, z)).toBe(0);
                // And it comes up from there by degrees, not as a step.
                expect(height(R.minX + 2, z)).toBeLessThan(8);
                expect(height(R.maxX - 2, z)).toBeLessThan(8);
            }
        }
    });

    it('are one unbroken ground: no cliff between two paces anywhere inside the grid', () => {
        const { height } = createGoldenForestRanges(2341);
        let worst = 0;
        for (let x = R.minX + 1; x < R.maxX - 1; x += 61) {
            for (let z = R.minZ + 1; z < R.maxZ - 1; z += 13) {
                const here = height(x, z);
                worst = Math.max(worst, Math.abs(height(x + 1, z) - here), Math.abs(height(x, z + 1) - here));
            }
        }
        // Steep rock is a few metres up for a metre along; a seam in the function would be tens.
        expect(worst).toBeLessThan(8);
    });

    it('leave a col where the sun stands: the skyline is lower on its bearing than on either side', () => {
        const shoulders = (height) => [
            Math.max(skyline(height, R.sunAzimuth - 9), skyline(height, R.sunAzimuth - 13)),
            Math.max(skyline(height, R.sunAzimuth + 9), skyline(height, R.sunAzimuth + 13)),
        ];
        let cols = 0;
        let share = 0;
        for (const seed of SEEDS) {
            const { height } = createGoldenForestRanges(seed);
            const col = skyline(height, R.sunAzimuth);
            const [left, right] = shoulders(height);
            if (col < left && col < right) cols += 1;
            share += col / ((left + right) / 2);
            // The disc itself is never behind rock: the skyline on its bearing stays under the sun.
            expect(col, `seed ${seed}`).toBeLessThan(Math.asin(GOLDEN_FOREST_SUN_DIRECTION.y) / DEG);
        }
        // Rock is rough: now and then a shoulder is low too. But the col is the rule, and deep.
        expect(cols / SEEDS.length).toBeGreaterThan(0.8);
        expect(share / SEEDS.length).toBeLessThan(0.8);
        // (The lake's own ranges, seeded from the theme's stream, are held to it in the world's tests.)
    });

    it('raise one summit over the right shore', () => {
        const { summit } = R;
        let crowned = 0;
        for (const seed of SEEDS) {
            const { height } = createGoldenForestRanges(seed);
            // A horn of its own stands at the summit's place whatever the folds do there.
            expect(height(summit.x, summit.z), `seed ${seed}`).toBeGreaterThan(summit.lift * 0.5);
            // Right of the board (the summit's bearing) the skyline stands higher than left of it.
            const bearing = Math.atan2(summit.x, R.eyeZ - summit.z) / DEG;
            const over = Math.max(skyline(height, bearing - 6), skyline(height, bearing), skyline(height, bearing + 6));
            if (over > skyline(height, -bearing)) crowned += 1;
        }
        expect(crowned / SEEDS.length).toBeGreaterThan(0.8);
    });
});

describe('the fan of sun rays a cleared line opens', () => {
    const newest = (frame) => frame.beams.reduce((latest, beam) => (beam.serial > latest.serial ? beam : latest));
    const nearestFan = (angle) => GOLDEN_FOREST_FAN.reduce((best, direction) => (
        Math.abs(angle / DEG - direction) < Math.abs(angle / DEG - best) ? direction : best));

    it('has a few slots, and a fan of distinct directions', () => {
        expect(Number.isInteger(GOLDEN_FOREST_BEAM_SLOTS) && GOLDEN_FOREST_BEAM_SLOTS >= 3).toBe(true);
        expect(create().beams).toHaveLength(GOLDEN_FOREST_BEAM_SLOTS);
        expect(Object.isFrozen(GOLDEN_FOREST_FAN)).toBe(true);
        expect(new Set(GOLDEN_FOREST_FAN).size).toBe(GOLDEN_FOREST_FAN.length);
        // Three lines open three shafts on three directions: the fan has at least that many.
        expect(GOLDEN_FOREST_FAN.length).toBeGreaterThanOrEqual(3);
        for (const direction of GOLDEN_FOREST_FAN) {
            expect(Number.isFinite(direction) && Math.abs(direction) <= 180, String(direction)).toBe(true);
        }
    });

    it('opens one shaft for every line of a one-, two- or three-line clear, and the sunburst for four', () => {
        for (const lines of [1, 2, 3]) {
            const reactions = create();
            expect(reactions.getFrame().beams).toEqual([]);
            reactions.onLineClear(lines);
            const frame = reactions.update(DT);
            expect(frame.beams, `${lines} lines`).toHaveLength(lines);
            expect(new Set(frame.beams.map((beam) => beam.serial)).size).toBe(lines);
            for (const beam of frame.beams) {
                expect(Object.keys(beam).sort()).toEqual(['angle', 'serial', 'sharp', 'strength']);
                expect(beam.strength).toBeGreaterThan(0);
                expect(beam.strength).toBeLessThanOrEqual(1);
                expect(beam.sharp).toBeGreaterThan(0);
                expect(Number.isFinite(beam.angle)).toBe(true);
            }
            // No sunburst for less than four.
            expect(peakOf('burst', (director) => director.onLineClear(lines))).toBe(0);
        }
        const four = create();
        four.onLineClear(4);
        expect(four.update(DT).beams).toEqual([]);
        expect(peakOf('burst', (director) => director.onLineClear(4))).toBeGreaterThan(0.5);
        // A lock, a combo, a twist, a back-to-back: none of them is a line cleared.
        for (const quiet of ['onPieceLock', 'onTwist', 'onBackToBack', 'onGameOver']) {
            const reactions = create();
            reactions[quiet]();
            expect(reactions.update(DT).beams, quiet).toEqual([]);
        }
    });

    it('opens line after line on successive directions round the fan', () => {
        const reactions = create();
        const turns = GOLDEN_FOREST_FAN.length * 2 + 3;
        for (let clear = 0; clear < turns; clear += 1) {
            reactions.onLineClear(1);
            const shaft = newest(reactions.update(DT));
            expect(shaft.serial).toBe(clear);
            expect(nearestFan(shaft.angle), `shaft ${clear}`).toBe(GOLDEN_FOREST_FAN[clear % GOLDEN_FOREST_FAN.length]);
            // Long enough between clears that the fan never fills.
            advance(reactions, 1.5);
        }
        // The lines of one clear take successive directions too.
        const three = create();
        three.onLineClear(3);
        const directions = three.update(DT).beams.sort((a, b) => a.serial - b.serial)
            .map((beam) => nearestFan(beam.angle));
        expect(directions).toEqual(GOLDEN_FOREST_FAN.slice(0, 3));
        // A new session starts round the fan again.
        three.reset();
        three.onLineClear(1);
        expect(nearestFan(newest(three.update(DT)).angle)).toBe(GOLDEN_FOREST_FAN[0]);
        expect(newest(three.getFrame()).serial).toBe(0);
    });

    it('broadens every shaft the more lines there are', () => {
        const sharpOf = (lines) => {
            const reactions = create();
            reactions.onLineClear(lines);
            const { beams } = reactions.update(DT);
            expect(new Set(beams.map((beam) => beam.sharp)).size).toBe(1);
            return beams[0].sharp;
        };
        expect(sharpOf(3)).toBeLessThan(sharpOf(1));
        expect(sharpOf(2)).toBeLessThanOrEqual(sharpOf(1));
        expect(sharpOf(2)).toBeGreaterThanOrEqual(sharpOf(3));
    });

    it('lets a shaft open quickly, stand, and fall away to nothing, leaning only a little as it stands', () => {
        const reactions = create();
        reactions.onLineClear(1);
        const light = [];
        const angles = [];
        advance(reactions, 30, (frame) => {
            if (!frame.beams.length) return;
            light.push(frame.beams[0].strength);
            angles.push(frame.beams[0].angle);
            // What the frame says is the director's own reading of the shaft.
            const held = reactions.beams.find((beam) => beam.active);
            expect(frame.beams[0].strength).toBe(GoldenForestReactions.beamLight(held));
        });
        // Gone well inside half a minute, and for good.
        expect(reactions.getFrame().beams).toEqual([]);
        expect(light.length).toBeGreaterThan(30);
        expect(light.length).toBeLessThan(25 / DT);
        const peak = Math.max(...light);
        const at = light.indexOf(peak);
        expect(peak).toBeLessThanOrEqual(1);
        // Up to its peak and down from it: one swell, no flicker.
        for (let index = 1; index <= at; index += 1) expect(light[index]).toBeGreaterThanOrEqual(light[index - 1]);
        for (let index = at + 1; index < light.length; index += 1) expect(light[index]).toBeLessThan(light[index - 1]);
        // It opens in a fraction of the time it takes to fall away.
        expect(at).toBeLessThan((light.length - at) / 2);
        // It goes out faint, not from full.
        expect(light.at(-1)).toBeLessThan(peak * 0.05);
        // It leans a few degrees as it stands, smoothly.
        expect(Math.abs(angles.at(-1) - angles[0])).toBeLessThan(20 * DEG);
        for (let index = 1; index < angles.length; index += 1) {
            expect(Math.abs(angles[index] - angles[index - 1])).toBeLessThan(0.5 * DEG);
        }
    });

    it('reads a shaft\'s light from its age and strength alone', () => {
        const at = (age, strength = 0.8) => GoldenForestReactions.beamLight({ age, strength });
        expect(at(0)).toBe(0);
        let peak = 0;
        for (let age = 0; age < 40; age += DT) {
            const light = at(age);
            expect(light).toBeGreaterThanOrEqual(0);
            expect(light).toBeLessThanOrEqual(0.8);
            peak = Math.max(peak, light);
        }
        // It all but reaches its strength, and all but nothing is left long after.
        expect(peak).toBeGreaterThan(0.8 * 0.9);
        expect(at(40)).toBeLessThan(1e-6);
        // Twice the strength is twice the light at every age, and never more than the lens takes.
        expect(at(0.3, 0.4)).toBeCloseTo(at(0.3, 0.8) / 2, 12);
        expect(at(0.5, 99)).toBe(1);
        expect(at(0.5, -3)).toBe(0);
    });

    it('never holds more shafts than its slots, and never cuts one still opening or standing', () => {
        // How long a shaft opens and stands: the frames a lone one takes to reach its brightest.
        const lone = create();
        lone.onLineClear(1);
        const alone = [];
        advance(lone, 20, (frame) => { if (frame.beams.length) alone.push(frame.beams[0].strength); });
        const standing = alone.indexOf(Math.max(...alone)) + 1;
        expect(standing).toBeGreaterThan(3);
        for (const [lines, every] of [[3, 1], [3, 6], [2, 9], [1, 3], [3, 22]]) {
            const reactions = create(lines * 100 + every);
            const seen = new Map();
            let most = 0;
            let opened = 0;
            const follow = (frame) => {
                most = Math.max(most, frame.beams.length);
                const now = new Set();
                for (const beam of frame.beams) {
                    now.add(beam.serial);
                    if (!seen.has(beam.serial)) {
                        seen.set(beam.serial, []);
                        opened += 1;
                    }
                    seen.get(beam.serial).push(beam.strength);
                }
                for (const [serial, light] of seen) {
                    if (now.has(serial)) continue;
                    // It had opened and stood its whole stand: a shaft on its way up, or standing, is never
                    // the one to go.
                    expect(light.length, `shaft ${serial} (${lines} lines every ${every} frames)`)
                        .toBeGreaterThanOrEqual(standing);
                    seen.delete(serial);
                }
            };
            for (let frame = 0; frame < 6 / DT; frame += 1) {
                if (frame % every === 0 && frame < 4 / DT) reactions.onLineClear(lines);
                follow(reactions.update(DT));
            }
            expect(most).toBeLessThanOrEqual(GOLDEN_FOREST_BEAM_SLOTS);
            expect(opened).toBeGreaterThanOrEqual(Math.min(GOLDEN_FOREST_BEAM_SLOTS, lines));
            // The fan filled: this really was more than it could hold.
            if (every <= 9) expect(most).toBe(GOLDEN_FOREST_BEAM_SLOTS);
        }
    });

    it('crowns a perfect clear with shafts and the whole sunburst, and lifts the burst a little at a level-up', () => {
        const perfect = create();
        perfect.onPerfectClear();
        expect(perfect.update(DT).beams.length).toBeGreaterThan(0);
        const quad = peakOf('burst', (director) => director.onLineClear(4));
        const crown = peakOf('burst', (director) => director.onPerfectClear());
        const level = peakOf('burst', (director) => director.onLevelUp());
        expect(crown).toBeGreaterThan(0.5);
        expect(level).toBeGreaterThan(0);
        expect(level).toBeLessThan(quad);
        for (const value of [quad, crown, level]) expect(value).toBeLessThanOrEqual(1);
        // It swells and is gone: nothing of it is left a quarter of a minute on.
        const reactions = create();
        reactions.onLineClear(4);
        reactions.onPerfectClear();
        expect(reactions.getFrame().burst).toBeLessThan(quad);
        expect(advance(reactions, 15).burst).toBeLessThan(quad * 0.1);
        expect(advance(reactions, 60).burst).toBeLessThan(0.01);
    });
});

describe('cues that build instead of popping', () => {
    /** The same play twice, the second with one more event at `at` seconds: frame pairs from then on. */
    function twins(first, second, at, key, seconds = 4) {
        const plain = create();
        const more = create();
        first(plain);
        first(more);
        advance(plain, at);
        advance(more, at);
        second(more);
        const pairs = [];
        for (let frame = 0; frame < seconds / DT; frame += 1) {
            pairs.push([plain.update(DT)[key], more.update(DT)[key]]);
        }
        return pairs;
    }

    it.each([
        ['burst', (r) => r.onLineClear(4), (r) => r.onLevelUp()],
        ['burst', (r) => r.onLineClear(4), (r) => r.onLineClear(4)],
        ['burst', (r) => r.onLevelUp(), (r) => r.onPerfectClear()],
        ['rush', (r) => r.onLevelUp(), (r) => r.onLevelUp()],
        ['gild', (r) => r.onCombo(6), (r) => r.onCombo(3)],
        ['gildReach', (r) => r.onCombo(6), (r) => r.onCombo(3)],
        ['gild', (r) => r.onCombo(4), (r) => r.onBackToBack()],
    ])('never lowers %s with a new event, whenever it comes', (key, first, second) => {
        let lifted = false;
        for (const at of [0.05, 0.3, 1, 2.5]) {
            for (const [plain, more] of twins(first, second, at, key)) {
                expect(more).toBeGreaterThanOrEqual(plain - 1e-12);
                expect(more).toBeLessThanOrEqual(1);
                if (more > plain + 1e-6) lifted = true;
            }
        }
        // (Not vacuous: somewhere the second event did add to the first.)
        if (key !== 'gildReach' && key !== 'gild') expect(lifted).toBe(true);
    });

    it('turns the cloud on for a moment at a level-up, and at nothing else', () => {
        expect(peakOf('rush', (r) => r.onLevelUp())).toBeGreaterThan(0.5);
        for (const other of ['onPieceLock', 'onTwist', 'onBackToBack', 'onPerfectClear', 'onGameOver']) {
            expect(peakOf('rush', (r) => r[other](), 3), other).toBe(0);
        }
        expect(peakOf('rush', (r) => { r.onLineClear(4); r.onCombo(9); }, 3)).toBe(0);
        // It comes on over a moment (the cloud does not lurch) and has passed a quarter of a minute on.
        const reactions = create();
        reactions.onLevelUp();
        const first = reactions.update(DT).rush;
        expect(first).toBeLessThan(0.2);
        let last = first;
        let rose = 0;
        advance(reactions, 15, (frame) => {
            expect(Math.abs(frame.rush - last)).toBeLessThan(0.1);
            if (frame.rush > last) rose += 1;
            last = frame.rush;
        });
        expect(rose).toBeGreaterThan(3);
        expect(last).toBeLessThan(0.1);
        expect(advance(reactions, 60).rush).toBeLessThan(0.01);
    });

    it('gilds the shores as far round the lake as the combo river has climbed', () => {
        const reactions = create();
        expect(reactions.getFrame()).toMatchObject({ gild: 0, gildReach: 0 });
        const samples = [];
        for (let combo = 2; combo <= 12; combo += 1) {
            reactions.onLineClear(1);
            reactions.onCombo(combo);
            advance(reactions, 0.4, (frame) => samples.push([frame.vortex, frame.gild, frame.gildReach]));
        }
        advance(reactions, 25, (frame) => samples.push([frame.vortex, frame.gild, frame.gildReach]));
        samples.sort((a, b) => a[0] - b[0]);
        for (let index = 0; index < samples.length; index += 1) {
            const [, gild, reach] = samples[index];
            expect(gild >= 0 && gild <= 1 && reach >= 0 && reach <= 1).toBe(true);
            if (index > 0) {
                // The higher the river, the brighter the gilding and the further round it has come.
                expect(gild).toBeGreaterThanOrEqual(samples[index - 1][1] - 1e-12);
                expect(reach).toBeGreaterThanOrEqual(samples[index - 1][2] - 1e-12);
            }
        }
        // A river in full spate gilds all the way round; when it has run out the shores are dark again.
        const [high, bright, far] = samples.at(-1);
        expect(high).toBeGreaterThan(0.8);
        expect(bright).toBeGreaterThan(0.8);
        expect(far).toBeGreaterThan(0.8);
        expect(reactions.getFrame()).toMatchObject({ vortex: 0, gild: 0, gildReach: 0 });
        // A lone lock gilds nothing.
        expect(peakOf('gild', (r) => r.onPieceLock())).toBe(0);
    });
});

describe('the lake\'s tracks: a great wave, a spiral, a pulse on the sun\'s road', () => {
    const LIFE = GOLDEN_FOREST_TRACK_SECONDS;
    /** The event that starts a track of each kind. */
    const STARTS = {
        waves: (r) => r.onLineClear(4), swirls: (r) => r.onTwist(), roads: (r) => r.onBackToBack(),
    };
    const SLOTS = GOLDEN_FOREST_TRACK_SLOTS;

    it('lasts in the director as long as the lake draws it, in as many slots', () => {
        expect(Object.keys(LIFE)).toEqual(TRACK_KINDS);
        expect(Object.keys(SLOTS)).toEqual(TRACK_KINDS);
        expect(Object.isFrozen(LIFE) && Object.isFrozen(SLOTS)).toBe(true);
        // The director is three-free, so each life is written twice: they must agree.
        expect(LIFE.waves).toBe(GOLDEN_FOREST_WAVE.life);
        expect(LIFE.swirls).toBe(GOLDEN_FOREST_SWIRL.life);
        expect(LIFE.roads).toBe(GOLDEN_FOREST_ROAD.life);
        const reactions = create();
        for (const kind of TRACK_KINDS) {
            expect(Number.isInteger(SLOTS[kind]) && SLOTS[kind] >= 1, kind).toBe(true);
            expect(reactions.tracks[kind]).toHaveLength(SLOTS[kind]);
            expect(reactions.getFrame()[kind]).toEqual([]);
        }
    });

    it('starts each from its own event: four lines, a twist, a back-to-back', () => {
        const started = (events) => {
            const reactions = create();
            events(reactions);
            const frame = reactions.update(DT);
            return Object.fromEntries(TRACK_KINDS.map((kind) => [kind, frame[kind].length]));
        };
        expect(started((r) => r.onLineClear(4))).toEqual({ waves: 1, swirls: 0, roads: 0 });
        expect(started((r) => r.onTwist({ piece: cell(8, 12) }))).toEqual({ waves: 0, swirls: 1, roads: 0 });
        expect(started((r) => r.onBackToBack())).toEqual({ waves: 0, swirls: 0, roads: 1 });
        expect(started((r) => r.onLevelUp())).toEqual({ waves: 1, swirls: 0, roads: 0 });
        expect(started((r) => r.onPerfectClear())).toEqual({ waves: 1, swirls: 0, roads: 0 });
        // A perfect clear is the crown on the clear still playing: that clear's own wave is the wave.
        expect(started((r) => { r.onLineClear(4); r.onPerfectClear(); })).toEqual({ waves: 1, swirls: 0, roads: 0 });
        for (const lines of [1, 2, 3]) {
            expect(started((r) => r.onLineClear(lines)), `${lines} lines`).toEqual({ waves: 0, swirls: 0, roads: 0 });
        }
        expect(started((r) => { r.onHardDrop({ distance: 18 }); r.onPieceLock(); r.onCombo(9); r.onGameOver(); }))
            .toEqual({ waves: 0, swirls: 0, roads: 0 });
    });

    it('carries where it happened: the spiral beside the piece, turning the way the piece stood', () => {
        const swirl = (piece) => {
            const reactions = create();
            reactions.onTwist({ piece });
            return reactions.update(DT).swirls[0];
        };
        const left = swirl(cell(1, 20));
        const right = swirl(cell(8, 8));
        expect(left.turn).toBe(-1);
        expect(right.turn).toBe(1);
        expect(left.column).toBeLessThan(0.5);
        expect(right.column).toBeGreaterThan(0.5);
        expect(right.row).toBeGreaterThan(left.row);
        for (const track of [left, right]) {
            expect(Object.keys(track).sort()).toEqual(['active', 'age', 'column', 'row', 'serial', 'strength', 'turn']);
            expect(track).toMatchObject({ active: true, serial: 0 });
            expect(track.age).toBeCloseTo(DT, 12);
            expect(track.strength).toBeGreaterThan(0);
        }
        // A twist that says nothing of where still winds the water, somewhere on the card.
        const blind = swirl(undefined);
        expect([blind.column, blind.row].every((value) => value >= 0 && value <= 1)).toBe(true);
        expect([-1, 1]).toContain(blind.turn);
    });

    it('pours more gold down the road for every back-to-back in a row, up to a brim', () => {
        const reactions = create();
        const pulses = [];
        for (let chain = 0; chain < 8; chain += 1) {
            reactions.onBackToBack();
            const { roads } = reactions.update(DT);
            pulses.push(roads.reduce((latest, road) => (road.serial > latest.serial ? road : latest)).strength);
            // (Each has run its road before the next: none is waiting on a slot.)
            advance(reactions, LIFE.roads + 0.2);
        }
        for (let index = 1; index < pulses.length; index += 1) {
            expect(pulses[index]).toBeGreaterThanOrEqual(pulses[index - 1]);
        }
        expect(pulses[1]).toBeGreaterThan(pulses[0]);
        expect(pulses.at(-1)).toBe(pulses.at(-2));
        expect(pulses.at(-1)).toBeLessThanOrEqual(1.5);
        // A long quiet, or the end of the game, and the next is the first of a new row.
        advance(reactions, 120);
        reactions.onBackToBack();
        expect(reactions.update(DT).roads[0].strength).toBe(pulses[0]);
        reactions.onGameOver();
        advance(reactions, LIFE.roads + 0.2);
        reactions.onBackToBack();
        expect(reactions.update(DT).roads[0].strength).toBe(pulses[0]);
    });

    it.each(TRACK_KINDS)('runs a %s track for its whole life and no longer', (kind) => {
        const start = STARTS[kind];
        const reactions = create();
        start(reactions);
        let last = 0;
        let frames = 0;
        advance(reactions, LIFE[kind] + 1, (frame) => {
            if (!frame[kind].length) return;
            const [track] = frame[kind];
            expect(frame[kind]).toHaveLength(1);
            // The same track all along, its age the time since it began.
            expect(track.serial).toBe(0);
            expect(track.age - last).toBeCloseTo(DT, 9);
            last = track.age;
            frames += 1;
        });
        expect(last).toBeLessThan(LIFE[kind]);
        expect(frames * DT).toBeGreaterThan(LIFE[kind] - 2 * DT);
        expect(reactions.getFrame()[kind]).toEqual([]);
        // The slot is free again: the next one starts at once, with a serial of its own.
        start(reactions);
        expect(reactions.update(DT)[kind]).toMatchObject([{ serial: 1 }]);
    });

    it('never runs more of a kind than the lake has slots for: a new one is let go, a plain one is not cut', () => {
        for (const kind of TRACK_KINDS) {
            const start = STARTS[kind];
            const reactions = create();
            // One after another, a few frames apart: every slot is running and none is nearly spent.
            for (let n = 0; n < SLOTS[kind] + 3; n += 1) {
                start(reactions);
                advance(reactions, 0.1);
            }
            const running = reactions.getFrame()[kind];
            expect(running, kind).toHaveLength(SLOTS[kind]);
            // The first ones are the ones still running, each at its own age: the late ones were let go.
            expect(running.map((track) => track.serial).sort((a, b) => a - b)).toEqual([...Array(SLOTS[kind]).keys()]);
            for (const track of running) {
                const frames = SLOTS[kind] + 3 - track.serial;
                expect(track.age, `${kind} ${track.serial}`).toBeCloseTo(frames * Math.round(0.1 / DT) * DT, 9);
            }
        }
    });

    it('keeps every running track whole through a flood of events: none restarts, none is cut while plain', () => {
        const reactions = create(9);
        const last = Object.fromEntries(TRACK_KINDS.map((kind) => [kind, new Map()]));
        const most = Object.fromEntries(TRACK_KINDS.map((kind) => [kind, 0]));
        const ended = Object.fromEntries(TRACK_KINDS.map((kind) => [kind, 0]));
        const serials = new Set();
        for (let frame = 0; frame < 40 / DT; frame += 1) {
            if (frame < 30 / DT) {
                if (frame % 31 === 0) reactions.onLineClear(4);
                if (frame % 19 === 7) reactions.onTwist({ piece: cell(frame % 10, 12) });
                if (frame % 23 === 11) reactions.onBackToBack();
                if (frame % 301 === 150) reactions.onLevelUp();
                if (frame % 407 === 99) reactions.onPerfectClear();
            }
            const state = reactions.update(DT);
            for (const kind of TRACK_KINDS) {
                const now = new Map(state[kind].map((track) => [track.serial, track.age]));
                most[kind] = Math.max(most[kind], now.size);
                let eldest = 0;
                last[kind].forEach((age) => { eldest = Math.max(eldest, age); });
                for (const [serial, age] of last[kind]) {
                    if (now.has(serial)) {
                        // The same track, one frame older: never set back to its start.
                        expect(now.get(serial) - age, `${kind} ${serial}`).toBeCloseTo(DT, 9);
                    } else {
                        ended[kind] += 1;
                        // It ran out; or, with every slot running, it was the eldest and well through its life.
                        const ranOut = age + DT >= LIFE[kind] - 1e-9;
                        if (!ranOut) {
                            expect(age, `${kind} ${serial} cut at ${age.toFixed(2)} s`).toBe(eldest);
                            expect(age / LIFE[kind], `${kind} ${serial}`).toBeGreaterThan(0.5);
                        }
                    }
                }
                for (const serial of now.keys()) {
                    if (!last[kind].has(serial)) {
                        // No serial is ever used twice, by any kind.
                        expect(serials.has(serial), `${kind} ${serial}`).toBe(false);
                        serials.add(serial);
                    }
                }
                last[kind] = now;
            }
        }
        for (const kind of TRACK_KINDS) {
            expect(most[kind], kind).toBe(SLOTS[kind]);
            expect(ended[kind], kind).toBeGreaterThan(SLOTS[kind]);
            expect(reactions.getFrame()[kind]).toEqual([]);
        }
    });
});

describe('the bursts the director asks the world to throw', () => {
    const live = (frame) => frame.flurries.filter((flurry) => flurry.serial >= 0).sort((a, b) => a.serial - b.serial);

    it('asks for each from its own event, in the kinds the world knows', () => {
        expect(Object.isFrozen(GOLDEN_FOREST_FLURRIES)).toBe(true);
        expect([...GOLDEN_FOREST_FLURRIES].sort()).toEqual(['droplets', 'goldfall', 'helix', 'pollen']);
        const asked = (events) => {
            const reactions = create();
            events(reactions);
            return live(reactions.getFrame()).map((flurry) => flurry.kind);
        };
        const struck = (r) => { r.onHardDrop({ distance: 16 }); r.onPieceLock({ piece: cell(2, 20) }); };
        expect(asked(struck)).toEqual(['droplets']);
        expect(asked((r) => r.onTwist({ piece: cell(8, 12) }))).toEqual(['helix']);
        expect(asked((r) => r.onLineClear(4))).toEqual(['pollen']);
        expect(asked((r) => r.onPerfectClear()).sort()).toEqual(['goldfall', 'pollen']);
        // A piece set down gently strikes nothing; nor do the lesser clears, a combo, the hour or the end.
        expect(asked((r) => r.onPieceLock({ piece: cell(2, 20) }))).toEqual([]);
        expect(asked((r) => { r.onHardDrop({ distance: 1 }); r.onPieceLock({ piece: cell(2, 20) }); })).toEqual([]);
        expect(asked((r) => { r.onLineClear(1); r.onLineClear(2); r.onLineClear(3); })).toEqual([]);
        expect(asked((r) => { r.onCombo(9); r.onBackToBack(); r.onLevelUp(); r.onGameOver(); })).toEqual([]);
        // The drop that was armed is spent by its lock: the next lock is a gentle one again.
        const twoLocks = (r) => { r.onHardDrop({ distance: 16 }); r.onPieceLock(); r.onPieceLock(); };
        expect(asked(twoLocks)).toEqual(['droplets']);
    });

    it('says where on the board and on which side, and how hard', () => {
        const drop = (distance, piece) => {
            const reactions = create();
            reactions.onHardDrop({ distance });
            reactions.onPieceLock({ piece });
            return live(reactions.getFrame())[0];
        };
        const left = drop(20, cell(1, 22));
        const right = drop(20, cell(8, 22));
        expect(left).toMatchObject({ kind: 'droplets', side: -1, serial: 0 });
        expect(right).toMatchObject({ kind: 'droplets', side: 1, serial: 0 });
        expect(left.column).toBeLessThan(0.5);
        expect(right.column).toBeGreaterThan(0.5);
        // The further the fall, the harder the lake is struck.
        expect(drop(20, cell(1, 22)).strength).toBeGreaterThan(drop(9, cell(1, 22)).strength);
        expect(drop(400, cell(1, 22)).strength).toBeLessThanOrEqual(1.5);
        const twist = create();
        twist.onTwist({ piece: cell(1, 20) });
        expect(live(twist.getFrame())[0]).toMatchObject({ kind: 'helix', side: -1 });
        twist.onTwist({ piece: cell(8, 20) });
        expect(live(twist.getFrame())[1]).toMatchObject({ kind: 'helix', side: 1, serial: 1 });
        for (const flurry of live(twist.getFrame())) {
            expect(Object.keys(flurry).sort()).toEqual(['column', 'kind', 'row', 'serial', 'side', 'strength']);
            expect(flurry.strength).toBeGreaterThan(0);
        }
    });

    it('holds every burst the busiest single lock can ask for', () => {
        const reactions = create();
        // One piece: a hard-dropped twist that clears four lines, empties the board and levels up.
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock({ piece: cell(4, 20) });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onCombo(5);
        reactions.onTwist({ piece: cell(4, 20) });
        reactions.onBackToBack();
        reactions.onPerfectClear();
        reactions.onLevelUp();
        const asked = live(reactions.getFrame());
        // None was overwritten before a frame could read it: the lock's own crown of drops is still first.
        expect(asked.map((flurry) => flurry.serial)).toEqual([...Array(asked.length).keys()]);
        expect(asked[0].kind).toBe('droplets');
        expect(asked.map((flurry) => flurry.kind).sort())
            .toEqual(['droplets', 'goldfall', 'helix', 'pollen', 'pollen']);
        expect(asked.length).toBeLessThanOrEqual(reactions.flurries.length);
    });

    it('queues them by serial, wrapping without ever reusing one, and starts over with a new session', () => {
        const reactions = create();
        const queue = reactions.flurries.length;
        const pool = reactions.flurries;
        for (let twist = 0; twist < queue * 2 + 3; twist += 1) {
            reactions.onTwist({ piece: cell(twist % 10, 12) });
            const frame = reactions.update(DT);
            // The frame hands out the director's own queue, always whole.
            expect(frame.flurries).toBe(pool);
            expect(frame.flurries).toHaveLength(queue);
            const asked = live(frame);
            expect(asked).toHaveLength(Math.min(twist + 1, queue));
            // Always the newest ones, one serial each.
            expect(asked.map((flurry) => flurry.serial))
                .toEqual([...Array(asked.length).keys()].map((index) => twist + 1 - asked.length + index));
        }
        // Time asks for nothing and forgets nothing.
        const before = JSON.stringify(reactions.getFrame().flurries);
        advance(reactions, 20);
        expect(JSON.stringify(reactions.getFrame().flurries)).toBe(before);
        const { epoch } = reactions;
        reactions.reset();
        expect(reactions.epoch).toBe(epoch + 1);
        expect(reactions.flurries).toBe(pool);
        expect(live(reactions.getFrame())).toEqual([]);
        reactions.onTwist();
        expect(live(reactions.getFrame()).map((flurry) => flurry.serial)).toEqual([0]);
    });
});

describe('the skeins called and the evening after', () => {
    it('counts a skein of cranes called for every perfect clear and every level-up, and for nothing else', () => {
        const reactions = create();
        expect(reactions.getFrame().flights).toBe(0);
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock();
        reactions.onLineClear(4);
        reactions.onCombo(9);
        reactions.onTwist();
        reactions.onBackToBack();
        reactions.onGameOver();
        expect(advance(reactions, 3).flights).toBe(0);
        reactions.onPerfectClear();
        expect(reactions.getFrame().flights).toBe(1);
        reactions.onLevelUp();
        expect(reactions.getFrame().flights).toBe(2);
        // Time calls none and takes none back; a new session counts from nothing, in a new epoch.
        expect(advance(reactions, 60).flights).toBe(2);
        const { epoch } = reactions;
        reactions.reset();
        expect(reactions.getFrame()).toMatchObject({ flights: 0, epoch: epoch + 1 });
        // A disposed director calls none.
        reactions.dispose();
        expect(reactions.onPerfectClear()).toBe(false);
        expect(reactions.onLevelUp()).toBe(false);
        expect(reactions.getFrame().flights).toBe(0);
    });

    it('lets the light sink toward the blue hour after a game: a moment that stays a while and passes', () => {
        const DUSK = GOLDEN_FOREST_DUSK;
        expect(Object.isFrozen(DUSK)).toBe(true);
        expect(Object.keys(DUSK).sort()).toEqual(['dawn', 'fall', 'hold', 'lift']);
        for (const value of Object.values(DUSK)) expect(Number.isFinite(value) && value > 0).toBe(true);
        // The fastest it ever moves in a frame: no rate of its own could take it further.
        const most = 1 - Math.exp(-DT * Math.max(DUSK.fall, DUSK.dawn, DUSK.lift)) + 1e-12;
        const reactions = create();
        reactions.onPieceLock();
        reactions.onLineClear(4);
        expect(advance(reactions, 5).dusk).toBe(0);
        expect(reactions.onGameOver()).toBe(true);
        // It sinks by degrees for as long as it stays, never past the blue hour.
        let last = 0;
        const first = reactions.update(DT).dusk;
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThanOrEqual(most);
        last = first;
        advance(reactions, DUSK.hold - 2 * DT, (frame) => {
            expect(frame.dusk).toBeGreaterThanOrEqual(last);
            expect(frame.dusk).toBeLessThanOrEqual(1);
            expect(frame.dusk - last).toBeLessThanOrEqual(most);
            last = frame.dusk;
        });
        const deepest = last;
        expect(deepest).toBeGreaterThan(0.5);
        // Nobody plays: after its while the light comes back by itself, slowly and all the way. The
        // lake behind the menus is not left dim until the next game.
        const dawn = [];
        advance(reactions, 12 / DUSK.dawn, (frame) => {
            expect(Math.abs(frame.dusk - last)).toBeLessThanOrEqual(most);
            expect(frame.dusk).toBeLessThanOrEqual(Math.max(last, deepest) + 1e-12);
            last = frame.dusk;
            dawn.push(frame.dusk);
        });
        const turned = dawn.findIndex((value, index) => index > 0 && value < dawn[index - 1]);
        expect(turned).toBeGreaterThanOrEqual(0);
        expect(turned * DT).toBeLessThan(1);
        for (let index = turned + 1; index < dawn.length; index += 1) {
            expect(dawn[index]).toBeLessThanOrEqual(dawn[index - 1]);
        }
        expect(last).toBe(0);
        expect(advance(reactions, 60).dusk).toBe(0);

        // The next piece played sends it back at once: sooner than it would have come back by itself.
        const secondsToHalf = (play) => {
            const director = create();
            director.onGameOver();
            const from = advance(director, DUSK.hold * 0.5).dusk;
            if (play) expect(director.onPieceLock({ piece: cell(3, 20) })).toBe(true);
            let frames = 0;
            let before = from;
            while (director.update(DT).dusk > from / 2) {
                // Whichever way it is going, never a jump.
                expect(Math.abs(director.dusk - before)).toBeLessThanOrEqual(most);
                before = director.dusk;
                frames += 1;
                if (frames > 600 / DT) throw new Error('the dusk never lifted');
            }
            return { seconds: frames * DT, director };
        };
        const played = secondsToHalf(true);
        const waited = secondsToHalf(false);
        expect(played.seconds).toBeLessThan(waited.seconds);
        expect(played.seconds).toBeLessThan(DUSK.hold * 0.5);
        // With the piece played it only ever lifts from there, all the way.
        last = played.director.dusk;
        advance(played.director, 12 / DUSK.lift, (frame) => {
            expect(frame.dusk).toBeLessThanOrEqual(last);
            last = frame.dusk;
        });
        expect(last).toBe(0);
        // And it does not come down again with the while that had been counting: the game is on.
        expect(advance(played.director, DUSK.hold * 2).dusk).toBe(0);

        // A second game over while the light is down keeps it down for its own while; it never drops it.
        const twice = create();
        twice.onGameOver();
        last = advance(twice, DUSK.hold * 0.9).dusk;
        twice.onGameOver();
        advance(twice, DUSK.hold * 0.9, (frame) => {
            expect(frame.dusk).toBeGreaterThanOrEqual(last);
            last = frame.dusk;
        });
        expect(last).toBeGreaterThan(0.5);
        // A new session is a new evening, at once.
        twice.reset();
        expect(twice.getFrame().dusk).toBe(0);
        expect(advance(twice, DUSK.hold * 2).dusk).toBe(0);
    });
});

describe('the stage: where a point of the world stands on screen', () => {
    const ASPECTS = [16 / 9, 4 / 3, 21 / 9, 9 / 19.5];

    it('projects what it places: a point set at a screen position and depth reads back as that', () => {
        for (const aspect of ASPECTS) {
            const stage = new GoldenForestStage(goldenForestCamera(aspect));
            const target = new THREE.Vector3();
            for (const depth of [0.5, GOLDEN_FOREST_STAGE_DEPTH, 60, 900]) {
                for (const sx of [-0.2, 0, 0.3, 0.5, 0.97, 1.3]) {
                    for (const sy of [-0.1, 0, 0.42, 1, 1.2]) {
                        const point = stage.point(sx, sy, depth);
                        const seen = stage.project(point.x, point.y, point.z, target);
                        expect(seen).toBe(target);
                        expect(seen.x).toBeCloseTo(sx, 6);
                        expect(seen.y).toBeCloseTo(sy, 6);
                        expect(seen.z).toBeCloseTo(depth, 6);
                    }
                }
            }
            // The card's own places come back as the card's own screen positions.
            for (const [side, row] of [[-1, 0], [1, 0], [-1, 1], [1, 0.5]]) {
                const edge = stage.edge(side, row);
                const seen = stage.project(edge.x, edge.y, edge.z);
                const { board } = stage;
                expect(seen.x).toBeCloseTo(side < 0 ? board.x0 : board.x1, 6);
                expect(seen.y).toBeCloseTo(board.y1 + (board.y0 - board.y1) * row, 6);
            }
        }
    });

    it('agrees with the camera itself about where things are', () => {
        for (const aspect of ASPECTS) {
            const camera = goldenForestCamera(aspect);
            const stage = new GoldenForestStage(camera);
            const clip = new THREE.Vector3();
            const view = new THREE.Vector3();
            for (const [x, y, z] of [[0, 4, -46], [-17, 9, -45], [60, 30, -140], [-132, 37, -112], [560, 400, -1440],
                [9.7, 0, -3.3], [-10.9, 12, 3.4]]) {
                clip.set(x, y, z).project(camera);
                view.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
                const seen = stage.project(x, y, z);
                expect(seen.x).toBeCloseTo((clip.x + 1) / 2, 6);
                expect(seen.y).toBeCloseTo((1 - clip.y) / 2, 6);
                // Depth is metres in front of the eye, not the depth buffer's value.
                expect(seen.z).toBeCloseTo(-view.z, 6);
            }
        }
    });

    it('says a point behind the eye is behind it, in finite numbers, and makes its own target if given none', () => {
        const stage = new GoldenForestStage(goldenForestCamera());
        const {
            origin, forward, right, up,
        } = stage;
        for (const depth of [-0.001, -1, -40, -3000]) {
            for (const [across, upward] of [[0, 0], [3, 1], [-200, 40]]) {
                const seen = stage.project(
                    origin.x + forward.x * depth + right.x * across + up.x * upward,
                    origin.y + forward.y * depth + right.y * across + up.y * upward,
                    origin.z + forward.z * depth + right.z * across + up.z * upward,
                );
                expect(seen.isVector3).toBe(true);
                expect(seen.toArray().every(Number.isFinite)).toBe(true);
                // Not positive: nothing that asks "is it in front, how far" takes it for in sight.
                expect(seen.z).toBeLessThanOrEqual(0);
                expect(seen.z).toBeCloseTo(depth, 6);
            }
        }
        // The eye itself is no depth at all, and still no NaN.
        const self = stage.project(origin.x, origin.y, origin.z);
        expect(self.z).toBe(0);
        expect(self.toArray().every(Number.isFinite)).toBe(true);
        expect(stage.project(1, 2, 3)).not.toBe(stage.project(1, 2, 3));
        // It reads the rest lens: after the camera is framed again, so does the projection.
        const camera = goldenForestCamera();
        const moving = new GoldenForestStage(camera);
        const before = moving.project(0, 4, -46).clone();
        camera.position.x += 6;
        expect(moving.project(0, 4, -46).equals(before)).toBe(true);
        moving.refresh();
        expect(moving.project(0, 4, -46).x).toBeLessThan(before.x);
    });

    it('knows what the board card covers, with a margin round it, wherever the card is measured to be', () => {
        const stage = new GoldenForestStage(goldenForestCamera());
        const board = GOLDEN_FOREST_DEFAULT_BOARD;
        const middle = [(board.x0 + board.x1) / 2, (board.y0 + board.y1) / 2];
        expect(stage.covered(...middle)).toBe(true);
        expect(stage.covered(board.x0 + 0.001, board.y0 + 0.001)).toBe(true);
        expect(stage.covered(board.x1 - 0.001, board.y1 - 0.001)).toBe(true);
        for (const [sx, sy] of [[board.x0 - 0.001, middle[1]], [board.x1 + 0.001, middle[1]],
            [middle[0], board.y0 - 0.001],
            [middle[0], board.y1 + 0.001], [0, 0], [1, 1], [-3, 0.5], [NaN, 0.5], [0.5, NaN]]) {
            expect(stage.covered(sx, sy), `${sx}, ${sy}`).toBe(false);
        }
        // A margin widens the card on every side; a negative one narrows it.
        expect(stage.covered(board.x0 - 0.03, middle[1], 0.05)).toBe(true);
        expect(stage.covered(middle[0], board.y1 + 0.03, 0.05)).toBe(true);
        expect(stage.covered(board.x0 - 0.06, middle[1], 0.05)).toBe(false);
        expect(stage.covered(board.x0 + 0.01, middle[1], -0.05)).toBe(false);
        // It follows the measured card.
        stage.setBoard({
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        });
        expect(stage.covered(...middle)).toBe(false);
        expect(stage.covered(0.15, 0.5)).toBe(true);
        stage.setBoard(null);
        expect(stage.covered(...middle)).toBe(true);
    });
});

describe('the tier table and the palette', () => {
    it('scales the smoke on the water, the events\' bursts and the pollen clouds with the tier', () => {
        for (const [name, tier] of Object.entries(GOLDEN_FOREST_TIERS)) {
            for (const key of ['smoke', 'flurry', 'puffs']) {
                expect(Number.isInteger(tier[key]) && tier[key] >= 0, `${name}.${key}`).toBe(true);
            }
            // The clouds are the flurry's second draw: no tier has them without it.
            if (tier.puffs > 0) expect(tier.flurry, name).toBeGreaterThan(0);
        }
        for (let index = 1; index < TIER_ORDER.length; index += 1) {
            const cheaper = GOLDEN_FOREST_TIERS[TIER_ORDER[index]];
            const dearer = GOLDEN_FOREST_TIERS[TIER_ORDER[index - 1]];
            for (const key of ['smoke', 'flurry', 'puffs']) {
                expect(cheaper[key], `${TIER_ORDER[index]}.${key}`).toBeLessThanOrEqual(dearer[key]);
            }
        }
        // Every tier answers the events with something in the air.
        for (const name of TIER_ORDER) expect(GOLDEN_FOREST_TIERS[name].flurry, name).toBeGreaterThan(0);
    });

    it('keeps the seven pieces seven hues apart: J is no longer I\'s neighbour', () => {
        const hue = (hex) => {
            const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            expect(max - min, hex).toBeGreaterThan(0.15);
            let h = 0;
            if (max === r) h = ((g - b) / (max - min)) % 6;
            else if (max === g) h = (b - r) / (max - min) + 2;
            else h = (r - g) / (max - min) + 4;
            return (h * 60 + 360) % 360;
        };
        const apart = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
        const pieces = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        const { colors } = GOLDEN_FOREST_TETROMINOS;
        for (const piece of pieces) expect(colors[piece], piece).toMatch(/^#[0-9a-f]{6}$/i);
        let nearest = Infinity;
        for (let a = 0; a < pieces.length; a += 1) {
            for (let b = a + 1; b < pieces.length; b += 1) {
                const between = apart(hue(colors[pieces[a]]), hue(colors[pieces[b]]));
                expect(between, `${pieces[a]} and ${pieces[b]}`).toBeGreaterThan(15);
                nearest = Math.min(nearest, between);
            }
        }
        // The two that read as one piece in the stack: well apart now.
        expect(apart(hue(colors.I), hue(colors.J))).toBeGreaterThan(30);
        expect(nearest).toBeGreaterThan(15);
    });
});
