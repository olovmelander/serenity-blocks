/**
 * Aurora — every event its own form, and a sky with a life of its own.
 *
 * The rarer forms of the display (aurora-forms.js: the crown, the curl, the pillars), the ring of
 * ice dust a hard drop kicks up (aurora-spindrift.js), the hush of a run that has ended, and
 * what the sky does with no hand in it: lone falling stars, its own small substorms, the moon on
 * its arc and the stars turning round the pole. Everything is read from the modules, never
 * copied, and the director is plain numbers: no GPU here.
 */
import { describe, expect, it } from 'vitest';
import { AuroraDirector } from '../../src/themes/aurora/aurora-director.js';
import {
    CURL, ExcitationMap, FORMS, PILLARS, skyDirection,
} from '../../src/themes/aurora/aurora-field.js';
import {
    AURORA_HOURS, AuroraHours, HOUR_SECONDS, MOON_DIRECTION, SKY_TURN, moonDirectionAt, moonRise,
} from '../../src/themes/aurora/aurora-hours.js';
import { QUALITY_PRESETS } from '../../src/themes/aurora/aurora-quality.js';
import { SPINDRIFT, spindriftAt } from '../../src/themes/aurora/aurora-spindrift.js';
import { AURORA_TETROMINOS } from '../../src/themes/aurora/aurora-tetrominos.js';

function create(options = {}) {
    return new AuroraDirector({ excitation: new ExcitationMap(), seed: 11, ...options });
}

/** Advance on the director's own clock (which is then the world's too), 60 Hz. */
function advance(director, seconds, hz = 60) {
    let elapsed = 0;
    while (elapsed < seconds - 1e-9) {
        const delta = Math.min(1 / hz, seconds - elapsed);
        director.update(delta);
        elapsed += delta;
    }
}

const lock = (x = 3, color = '#6cf5ff') => ({
    piece: {
        x, y: 18, shape: [[1, 1, 1, 1]], color,
    },
});
const clear = (lineCount = 1) => ({
    lineCount, clearedRows: Array.from({ length: lineCount }, (_, i) => 23 - i), cascadeCount: 1,
});
const row = (director, index) => Array.from(director.forms.subarray(index * 4, index * 4 + 4));
const crownGain = (director) => director.forms[FORMS.crown * 4];
const crownGold = (director) => director.forms[FORMS.crown * 4 + 2];
const curlGain = (director, slot) => director.forms[(FORMS.curls + slot * FORMS.curlRows) * 4 + 3];
const pillarGains = (director) => Array.from(
    { length: PILLARS.slots },
    (_, i) => director.forms[(FORMS.pillars + i * 2) * 4 + 3],
);

describe('Aurora forms: the table the march reads', () => {
    it('lays the crown, the curls and the pillars out without overlap, all at rest on a quiet sky', () => {
        expect(FORMS.curls).toBe(FORMS.crown + 5);
        expect(FORMS.pillars).toBe(FORMS.curls + CURL.slots * FORMS.curlRows);
        expect(FORMS.rows).toBe(FORMS.pillars + PILLARS.slots * 2);
        expect(FORMS.curlRows).toBe(2 + CURL.rays);
        const director = create({ ambient: false });
        expect(director.forms).toHaveLength(FORMS.rows * 4);
        advance(director, 1);
        expect(crownGain(director)).toBe(0);
        for (let slot = 0; slot < CURL.slots; slot += 1) expect(curlGain(director, slot)).toBe(0);
        expect(pillarGains(director).every((gain) => gain === 0)).toBe(true);
        expect(director.forms.every(Number.isFinite)).toBe(true);
    });

    it('stands the crown behind the board that opened it, on a frame square to its centre', () => {
        const director = create({ ambient: false });
        director.setBoard(0, 0.31, 0.12);
        director.setSkyFrame(0.72, 0.5);
        director.onPieceLock(lock());
        director.onLineClear(clear(4));
        advance(director, 0.5);
        expect(crownGain(director)).toBeGreaterThan(0.3);
        expect(crownGold(director)).toBe(0);
        const centre = row(director, FORMS.crown + 1).slice(0, 3);
        const right = row(director, FORMS.crown + 2).slice(0, 3);
        const up = row(director, FORMS.crown + 3).slice(0, 3);
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        skyDirection(0.31, 0.5).forEach((value, i) => expect(centre[i]).toBeCloseTo(value, 6));
        for (const axis of [centre, right, up]) expect(Math.hypot(...axis)).toBeCloseTo(1, 6);
        expect(dot(centre, right)).toBeCloseTo(0, 6);
        expect(dot(centre, up)).toBeCloseTo(0, 6);
        expect(dot(right, up)).toBeCloseTo(0, 6);
        // It closes again by itself.
        advance(director, 12);
        expect(crownGain(director)).toBe(0);
    });

    it('turns the crown gold for a perfect clear, brighter and wider than a breakup, then lets it go', () => {
        const quad = create({ ambient: false });
        quad.onPieceLock(lock());
        quad.onLineClear(clear(4));
        advance(quad, 0.8);

        const perfect = create({ ambient: false });
        perfect.onPieceLock(lock());
        perfect.onLineClear(clear(1));
        perfect.onPerfectClear({});
        advance(perfect, 0.8);
        expect(crownGold(perfect)).toBeGreaterThan(0.9);
        expect(crownGain(perfect)).toBeGreaterThan(crownGain(quad) * 1.5);
        expect(perfect.forms[FORMS.crown * 4 + 1]).toBeGreaterThan(quad.forms[FORMS.crown * 4 + 1]);
        // Amber, not the storm's lavender: red over green over blue.
        const [r, g, b] = row(perfect, FORMS.crown + 4);
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
        const [qr, , qb] = row(quad, FORMS.crown + 4);
        expect(qb).toBeGreaterThan(qr);
        advance(perfect, 14);
        expect(crownGold(perfect)).toBe(0);
        expect(crownGain(perfect)).toBe(0);
    });

    it('winds a curl up beside the board for a twist: rays along an arm that tightens, then gone', () => {
        const director = create({ ambient: false });
        director.setBoard(0, 0, 0.15);
        director.onPieceLock(lock(7));
        director.onTwist({ lineCount: 0 });
        advance(director, 0.3);
        const slot = [0, 1].find((s) => curlGain(director, s) > 0);
        expect(slot).toBeDefined();
        const base = FORMS.curls + slot * FORMS.curlRows;
        // Beside the board, on the side the piece went in (the right), never behind it.
        const centre = row(director, base);
        expect(Math.atan2(centre[0], -centre[2])).toBeGreaterThan(0.15);
        const feet = () => Array.from({ length: CURL.rays }, (_, j) => row(director, base + 2 + j));
        const early = feet();
        // The rim's ray is the faintest (the arm's tail fades in) and the feet close on the eye.
        expect(early[0][2]).toBe(0);
        expect(Math.hypot(early[0][0], early[0][1] * CURL.squash))
            .toBeGreaterThan(Math.hypot(early.at(-1)[0], early.at(-1)[1] * CURL.squash) * 5);
        for (const [, , gain, inverseHeight] of early.slice(1)) {
            expect(gain).toBeGreaterThan(0);
            expect(inverseHeight).toBeGreaterThan(0);
        }
        advance(director, 0.9);
        const later = feet();
        // It has turned: the feet are somewhere else, and it winds tighter.
        expect(Math.hypot(later[8][0] - early[8][0], later[8][1] - early[8][1])).toBeGreaterThan(0.01);
        advance(director, CURL.seconds);
        expect(curlGain(director, slot)).toBe(0);
    });

    it('answers a twist that clears with a second, smaller curl across the board', () => {
        const director = create({ ambient: false });
        director.onPieceLock(lock(7));
        director.onLineClear(clear(2));
        director.onTwist({ lineCount: 2 });
        advance(director, 0.4);
        const gains = [0, 1].map((slot) => curlGain(director, slot));
        expect(Math.min(...gains)).toBeGreaterThan(0);
        const sides = [0, 1].map((slot) => Math.sign(director.forms[(FORMS.curls + slot * FORMS.curlRows) * 4]));
        expect(sides[0]).toBe(-sides[1]);
    });

    it('raises a row of pillars either side of the board for a level, the nearest first, and a fireball', () => {
        const director = create({ ambient: false });
        director.setBoard(0, 0, 0.15);
        director.onLevelUp({ level: 2 });
        director.update(1 / 60);
        const fireballs = director.meteors.slice(0, director.meteorCount).filter((meteor) => meteor.kind === 1);
        expect(fireballs).toHaveLength(1);
        // It crosses the whole sky, over the board.
        expect(Math.sign(fireballs[0].fromAzimuth)).toBe(-Math.sign(fireballs[0].toAzimuth));
        expect(fireballs[0].duration).toBeGreaterThan(1.5);
        advance(director, 0.25);
        const rising = pillarGains(director);
        expect(rising[0]).toBeGreaterThan(rising[6]);
        advance(director, 0.6);
        const standing = pillarGains(director);
        expect(standing.every((gain) => gain > 0)).toBe(true);
        for (let i = 0; i < PILLARS.slots; i += 1) {
            const [azimuth, inverseWidth, height] = row(director, FORMS.pillars + i * 2);
            // Clear of the board on either side, thin, and under the top of the view.
            expect(Math.abs(azimuth)).toBeGreaterThan(0.15);
            expect(1 / inverseWidth).toBeLessThan(0.03);
            expect(height).toBeGreaterThan(0.05);
            expect(height).toBeLessThan(Math.tan(director.skyTop));
        }
        expect(new Set(standing.map((_, i) => Math.sign(row(director, FORMS.pillars + i * 2)[0]))).size).toBe(2);
        advance(director, 20);
        expect(pillarGains(director).every((gain) => gain === 0)).toBe(true);
    });
});

describe('Aurora events: each its own', () => {
    it('kicks ice dust up for a hard drop that rides the ring it opened, and none for a soft lock', () => {
        const soft = create({ ambient: false });
        soft.onPieceLock(lock());
        soft.update(1 / 60);
        expect(soft.burstCount).toBe(0);
        expect(soft.rippleCount).toBe(1);

        const hard = create({ ambient: false });
        hard.onHardDrop({ distance: 16 });
        hard.onPieceLock(lock());
        hard.update(1 / 60);
        expect(hard.burstCount).toBe(1);
        const [burst] = hard.bursts;
        const [ring] = hard.ripples;
        expect(burst.azimuth).toBe(ring.azimuth);
        expect(burst.range).toBe(ring.range);
        expect(burst.speed).toBe(ring.speed);
        expect(hard.ripples[0].strength).toBeGreaterThan(soft.ripples[0].strength);
        // The next frame starts no second burst.
        hard.update(1 / 60);
        expect(hard.burstCount).toBe(0);
    });

    it('flings the dust clear of the board at once, keeps it near the ring\'s front and lands it again', () => {
        const speed = 28;
        // Within a third of a second every crystal is out past a board's half-width at that range.
        for (const seed of [0, 0.5, 1]) expect(spindriftAt(seed, 0.5, 0.33, speed, 1)[0]).toBeGreaterThan(14);
        for (const age of [0.6, 1.2, 2]) {
            const front = speed * age;
            for (const seed of [0, 0.3, 0.7, 1]) {
                const [radius, height] = spindriftAt(seed, seed, age, speed, 1);
                expect(radius).toBeGreaterThan(front * (1 - SPINDRIFT.lag));
                expect(radius).toBeLessThan(front * 1.05 + SPINDRIFT.fling);
                expect(height).toBeGreaterThan(0);
                expect(height).toBeLessThan(5);
            }
        }
        expect(spindriftAt(1, 1, SPINDRIFT.seconds, speed, 1)[1]).toBeCloseTo(0.25, 6);
        for (const preset of Object.values(QUALITY_PRESETS)) expect(preset.spindriftCount).toBeGreaterThan(0);
    });

    it('washes the land with more of the piece\'s colour for every line cleared', () => {
        const washed = [1, 2, 3, 4].map((lines) => {
            const director = create({ ambient: false });
            director.onPieceLock(lock(3, '#ff3030'));
            director.onLineClear(clear(lines));
            advance(director, 0.1);
            return director.light[0];
        });
        for (let i = 1; i < washed.length; i += 1) expect(washed[i]).toBeGreaterThanOrEqual(washed[i - 1]);
        expect(washed[3]).toBeGreaterThan(washed[0] * 1.5);
        // Bounded: a storm of clears never bleaches the snow.
        expect(washed[3]).toBeLessThan(0.5);
    });

    it('holds a hush when the run ends: the display dims under one last falling star, then returns', () => {
        const director = create({ ambient: false });
        advance(director, 1);
        const resting = director.arcGain[0];
        const light = director.light[1];
        director.onGameOver();
        expect(director.meteorCount).toBe(1);
        expect(director.meteors[0].duration).toBeGreaterThan(1.2);
        advance(director, 1.6);
        expect(director.hush).toBeGreaterThan(0.6);
        expect(director.arcGain[0]).toBeLessThan(resting * 0.7);
        expect(director.arcGain[0]).toBeGreaterThan(resting * 0.3);
        expect(director.light[1]).toBeLessThan(light);
        advance(director, 30);
        expect(director.hush).toBe(0);
        expect(director.arcGain[0]).toBeCloseTo(resting, 6);
    });

    it('gives every piece a hue of its own on the dark field', () => {
        const hue = (hex) => {
            const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
            const max = Math.max(r, g, b);
            const d = max - Math.min(r, g, b);
            let h = 0;
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            return (h * 60 + 360) % 360;
        };
        const hues = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((shape) => hue(AURORA_TETROMINOS.colors[shape]));
        for (let i = 0; i < hues.length; i += 1) {
            for (let j = i + 1; j < hues.length; j += 1) {
                const apart = Math.abs(hues[i] - hues[j]);
                expect(Math.min(apart, 360 - apart), `${i} against ${j}`).toBeGreaterThan(20);
            }
        }
    });
});

describe('Aurora: a sky with a life of its own', () => {
    it('sends lone falling stars now and then with no hand in it, the same ones every night', () => {
        const count = (director) => {
            let stars = 0;
            for (let i = 0; i < 60 * 240; i += 1) {
                director.update(1 / 60);
                stars += director.meteorCount;
            }
            return stars;
        };
        const first = count(create());
        expect(first).toBeGreaterThanOrEqual(4);
        expect(first).toBeLessThanOrEqual(14);
        expect(count(create())).toBe(first);
        expect(count(create({ ambient: false }))).toBe(0);
    });

    it('wakes the display in a small substorm of its own every few minutes, far under what play does', () => {
        const idle = create();
        let peak = 0;
        let awakeFrames = 0;
        let sweeps = 0;
        for (let i = 0; i < 60 * 300; i += 1) {
            idle.update(1 / 60);
            peak = Math.max(peak, idle.activity);
            if (idle.activity > 0.1) awakeFrames += 1;
            sweeps = Math.max(sweeps, idle.sweepGain);
        }
        // It comes, it is seen, and it is a murmur: most of the night is the quiet sky.
        expect(peak).toBeGreaterThan(0.2);
        expect(peak).toBeLessThan(0.45);
        expect(sweeps).toBeGreaterThan(0.1);
        expect(awakeFrames / 60).toBeGreaterThan(20);
        expect(awakeFrames / 60).toBeLessThan(120);
        expect(idle.corona).toBe(0);
        expect(idle.heatLevel).toBe(0);

        const quad = create({ ambient: false });
        quad.onPieceLock(lock());
        quad.onLineClear(clear(4));
        let played = 0;
        for (let i = 0; i < 120; i += 1) {
            quad.update(1 / 60);
            played = Math.max(played, quad.crown + quad.corona + quad.surge);
        }
        expect(played).toBeGreaterThan(1);
    });

    it('replays its own life exactly, whatever the frame rate asked of the clock', () => {
        const a = create();
        const b = create();
        advance(a, 130, 60);
        advance(b, 130, 60);
        expect(a.activity).toBe(b.activity);
        expect(Array.from(a.weather.cells)).toEqual(Array.from(b.weather.cells));
        // And stays out of the way while the hands are busy.
        const busy = create();
        advance(busy, 96);
        for (let i = 0; i < 40; i += 1) {
            busy.onHardDrop({ distance: 16 });
            busy.onPieceLock(lock());
            busy.onLineClear(clear(2));
            advance(busy, 0.5);
        }
        expect(busy.substormLift).toBe(0);
    });

    it('brings the moon up over the range through its hour, and turns the stars with the night', () => {
        const moonHour = AURORA_HOURS.findIndex((night) => night.moon > 0);
        expect(AURORA_HOURS[moonHour].name).toBe('Moonlit night');
        expect(moonRise(moonHour - 1)).toBe(0);
        expect(moonRise(moonHour + 1)).toBe(1);
        let last = -1;
        for (let k = 0; k <= 20; k += 1) {
            const rise = moonRise(moonHour - 0.65 + (k / 20) * 1.65);
            expect(rise).toBeGreaterThanOrEqual(last);
            last = rise;
        }
        const elevation = (rise) => Math.asin(moonDirectionAt(rise)[1]) * (180 / Math.PI);
        // Low enough over the water at its hour's rest that the lake mirrors it, high at the end.
        expect(elevation(0)).toBeLessThan(7);
        expect(elevation(moonRise(moonHour))).toBeGreaterThan(9);
        expect(elevation(moonRise(moonHour))).toBeLessThan(15);
        expect(elevation(1)).toBeGreaterThan(28);
        expect(moonDirectionAt(1)).toEqual([...MOON_DIRECTION]);
        expect(Math.hypot(...moonDirectionAt(0.4))).toBeCloseTo(1, 9);

        const hours = new AuroraHours();
        hours.update(0, 0);
        expect(hours.skyTurn).toBe(0);
        hours.update(0, HOUR_SECONDS * 3);
        expect(hours.skyTurn).toBeCloseTo(3 * SKY_TURN, 9);
        // A level is an hour's turn more: the time-lapse of the night moving on.
        hours.levelUp();
        for (let i = 0; i < 600; i += 1) hours.update(1 / 30, HOUR_SECONDS * 3);
        expect(hours.skyTurn).toBeCloseTo(4 * SKY_TURN, 3);
        expect(SKY_TURN).toBeGreaterThan(0.05);
        expect(SKY_TURN).toBeLessThan(0.4);
    });

    it('turns the curtains the hour\'s own hue, and the storm on from there', () => {
        const rose = AURORA_HOURS.findIndex((night) => night.name === 'Rose night');
        expect(rose).toBeGreaterThan(0);
        const director = create({ ambient: false });
        director.update(1 / 60, 0);
        // A quiet night: the resting green, no tint at all.
        expect(director.tint[3]).toBe(0);
        director.setHourSteps(rose);
        director.update(1 / 60, 0);
        expect(director.tint[3]).toBeCloseTo(AURORA_HOURS[rose].bodyMix, 6);
        // The shader's mix of its green toward the tint lands on the hour's hue.
        const green = [0.115, 0.94, 0.385];
        green.forEach((value, i) => {
            const mixed = value + (director.tint[i] - value) * director.tint[3];
            expect(mixed).toBeCloseTo(director.bodyColor[i], 6);
        });
        expect(director.bodyColor[0]).toBeGreaterThan(director.bodyColor[1]);
        // Snow and water take the hour's light too: redder than green on the rose night.
        expect(director.light[0]).toBeGreaterThan(director.light[1]);
    });
});
