/**
 * Kaleidosonic — the renderer-free core: small maths, the piece codes and notes, the temple's CPU
 * field and its march, the eye and the dive's lane, the mood wheel, the trance and the kaleidoscope.
 *
 * The look is still being tuned, so nothing here pins a colour, a wavelength or a timing: the tests
 * hold the relations the world is built on (the lane the dive flies down is clear of stone for
 * every shape the temple refolds to, a step to a neighbouring mood never passes through grey, the
 * palette drifts with the clock by itself) and read every number from the core.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEG, DIVE_LENGTH, EYE, FOLD_AT, MOODS, MOOD_COLOURS, MOOD_COUNT, MoodWheel, NOTES, PIECE_CODE, PIECE_COLORS,
    PIECE_ORDER, REFOLDS, RIG, SHAPES, SHAPE_KEYS, TAU, TEMPLE, TIMING, approach, cellsFromMatrix, chroma, clamp,
    clamp01, clampInt, foldLens, hexToLinear, hueOf, lerp, marchTemple, moodMix, moodPlace, mulberry32, pieceCode,
    rigFor, smooth, smoother, springStep, templeDistance, tranceFor,
} from '../../src/themes/kaleidosonic/kaleidosonic-core.js';
import { KALEIDOSONIC_TETROMINOS } from '../../src/themes/kaleidosonic/kaleidosonic-tetrominos.js';

const coreFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'kaleidosonic',
    'kaleidosonic-core.js',
);

/** A point along the dive's lane, t units from the eye. */
const lane = (t) => [EYE.x + EYE.dir[0] * t, EYE.y + EYE.dir[1] * t, EYE.z + EYE.dir[2] * t];
/** Signed hue step from a to b in degrees, in (−180, 180]. */
const hueStep = (a, b) => {
    const d = (((b - a) % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
};
/** Two linear colours mixed. */
const mixRgb = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
/** A few hundred points scattered through a few cells of the lattice (deterministic). */
const scatter = (n = 300, seed = 11) => {
    const random = mulberry32(seed);
    return Array.from({ length: n }, () => [random() * 6 - 3, random() * 6 - 3, random() * 6 - 3]);
};

describe('Kaleidosonic maths', () => {
    it('stays three-free and DOM-free: the director, the playground and the tests share it', () => {
        const source = readFileSync(coreFile, 'utf8');
        expect([...source.matchAll(/^\s*import\b/gm)]).toHaveLength(0);
        expect(source).not.toMatch(/\b(document|window|THREE)\./);
    });

    it('clamps, steps and eases as the shaders do', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(Number.NaN, 2, 3)).toBe(2);
        expect(clamp01(1.5)).toBe(1);
        expect(clampInt(2.6, 0, 10)).toBe(3);
        expect(lerp(2, 4, 0.25)).toBe(2.5);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        // Equal edges are a step, never a division by zero.
        expect(smooth(3, 3, 2.9)).toBe(0);
        expect(smooth(3, 3, 3)).toBe(1);
        expect(DEG * 180).toBeCloseTo(Math.PI, 12);
        expect(TAU).toBeCloseTo(2 * Math.PI, 12);
    });

    it('approaches a target at a rate independent of how the time is sliced', () => {
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, 1e6)).toBeCloseTo(1, 12);
        const once = approach(1.5, 0.2);
        const twice = 1 - (1 - approach(1.5, 0.1)) ** 2;
        expect(twice).toBeCloseTo(once, 12);
    });

    it('draws the same deterministic sequence for a seed, in [0, 1)', () => {
        const seqA = Array.from({ length: 200 }, mulberry32(42));
        expect(Array.from({ length: 200 }, mulberry32(42))).toEqual(seqA);
        expect(Array.from({ length: 200 }, mulberry32(43))).not.toEqual(seqA);
        seqA.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
    });

    it('reads sRGB hex as linear light and anything else as black', () => {
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('808080')[0]).toBeCloseTo(0.2158605, 6);
        expect(hexToLinear('nonsense')).toEqual([0, 0, 0]);
        expect(hexToLinear(null)).toEqual([0, 0, 0]);
        const out = [9, 9, 9];
        expect(hexToLinear('#ff0000', out)).toBe(out);
        expect(out).toEqual([1, 0, 0]);
    });

    it('measures hue and chroma the way the mood tests read them', () => {
        expect(hueOf([1, 0, 0])).toBe(0);
        expect(hueOf([0, 1, 0])).toBeCloseTo(120, 9);
        expect(hueOf([0, 0, 1])).toBeCloseTo(240, 9);
        expect(hueOf([1, 0, 1])).toBeCloseTo(300, 9);
        expect(hueOf([0.4, 0.4, 0.4])).toBe(-1); // grey has no hue
        expect(chroma([1, 0, 0])).toBe(1);
        expect(chroma([0.5, 0.5, 0.5])).toBe(0);
        expect(chroma([0, 0, 0])).toBe(0);
        // Chroma does not care how bright a colour is.
        expect(chroma([2, 1, 0.5])).toBeCloseTo(chroma([0.2, 0.1, 0.05]), 12);
    });

    it('springs critically damped toward a target, the same however the time is sliced', () => {
        for (const omega of [1.5, 4.2, 7]) {
            const s = { x: 0, v: 0 };
            let peak = -Infinity;
            for (let i = 0; i < 1200; i++) {
                expect(springStep(s, 1, 1 / 60, omega)).toBe(s);
                peak = Math.max(peak, s.x);
            }
            expect(s.x, `omega ${omega}`).toBeCloseTo(1, 4);
            expect(Math.abs(s.v), `omega ${omega}`).toBeLessThan(1e-3);
            // From rest it never overshoots: a refold settles, it does not wobble.
            expect(peak, `omega ${omega}`).toBeLessThanOrEqual(1 + 1e-9);
        }
        // One second in one call, in ten, or in sixty frames: the same state (fixed sub-steps).
        const one = springStep({ x: 0.3, v: 0.5 }, 1.2, 1, 4.2);
        const ten = { x: 0.3, v: 0.5 };
        for (let i = 0; i < 10; i++) springStep(ten, 1.2, 0.1, 4.2);
        const sixty = { x: 0.3, v: 0.5 };
        for (let i = 0; i < 60; i++) springStep(sixty, 1.2, 1 / 60, 4.2);
        expect(ten.x).toBeCloseTo(one.x, 9);
        expect(sixty.x).toBeCloseTo(one.x, 9);
        expect(sixty.v).toBeCloseTo(one.v, 9);
        // Time never runs backward.
        expect(springStep({ x: 0.3, v: 0.5 }, 1, -2, 4.2)).toEqual({ x: 0.3, v: 0.5 });
    });

    it('eases the dive and the roll with a smootherstep that starts and ends at rest', () => {
        expect(smoother(0)).toBe(0);
        expect(smoother(1)).toBe(1);
        expect(smoother(0.5)).toBeCloseTo(0.5, 12);
        expect(smoother(-3)).toBe(0);
        expect(smoother(4)).toBe(1);
        let previous = -1;
        for (let i = 0; i <= 100; i++) {
            const v = smoother(i / 100);
            expect(v).toBeGreaterThanOrEqual(previous);
            previous = v;
        }
        // Flat at both ends (no jolt as the flight starts or lands).
        expect(smoother(0.01)).toBeLessThan(0.001);
        expect(1 - smoother(0.99)).toBeLessThan(0.001);
    });
});

describe('Kaleidosonic pieces and notes', () => {
    it('numbers the pieces in one order and colours them as the board does', () => {
        expect(PIECE_ORDER).toEqual(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
        expect(PIECE_COLORS).toHaveLength(PIECE_ORDER.length);
        PIECE_ORDER.forEach((key, code) => {
            expect(PIECE_CODE[key]).toBe(code);
            expect(PIECE_COLORS[code]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(PIECE_COLORS[code].toLowerCase(), key).toBe(KALEIDOSONIC_TETROMINOS.colors[key].toLowerCase());
        });
        // Seven distinct piece colours.
        expect(new Set(PIECE_COLORS.slice(0, 7).map((c) => c.toLowerCase())).size).toBe(7);
    });

    it('reads a shape key however it is spelt and treats anything else as garbage', () => {
        expect(pieceCode('T')).toBe(PIECE_CODE.T);
        expect(pieceCode(' s ')).toBe(PIECE_CODE.S);
        expect(pieceCode('garbage')).toBe(PIECE_CODE.GARBAGE);
        for (const other of ['X', '', 'toString', '__proto__', null, undefined, 5, {}]) {
            expect(pieceCode(other), String(other)).toBe(PIECE_CODE.GARBAGE);
        }
    });

    it('turns every spawn matrix into four cells centred on their box', () => {
        expect([...SHAPE_KEYS].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        expect(cellsFromMatrix(SHAPES.I)).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(cellsFromMatrix(SHAPES.O)).toEqual([-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
        for (const key of SHAPE_KEYS) {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells, key).toHaveLength(8);
            const xs = cells.filter((_, i) => i % 2 === 0);
            const ys = cells.filter((_, i) => i % 2 === 1);
            expect(Math.max(...xs) + Math.min(...xs), key).toBeCloseTo(0, 12);
            expect(Math.max(...ys) + Math.min(...ys), key).toBeCloseTo(0, 12);
            expect(new Set(xs.map((x, i) => `${x},${ys[i]}`)).size, key).toBe(4);
        }
        // y runs up: the T's stem is above its bar.
        const t = cellsFromMatrix(SHAPES.T);
        expect(t[1]).toBeGreaterThan(t[3]);
    });

    it('refuses what is not a matrix, and pads a short one', () => {
        for (const bad of [null, 'I', [], [[0, 0], [0, 0]], [null, 'row']]) expect(cellsFromMatrix(bad)).toBeNull();
        expect(cellsFromMatrix([[1]])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(cellsFromMatrix([[1, 1, 1, 1, 1, 1]])).toHaveLength(8);
        expect(cellsFromMatrix([['1', 0], [0, true]])).toEqual([-0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5]);
    });

    it('gives every piece its own note: the long I rings highest, the square O lowest', () => {
        expect(NOTES).toHaveLength(PIECE_ORDER.length);
        NOTES.forEach((note, code) => {
            expect(note.piece, `code ${code}`).toBe(PIECE_ORDER[code]);
            expect(Number.isFinite(note.wavelength) && note.wavelength > 0, note.piece).toBe(true);
            expect(Number.isFinite(note.speed) && note.speed > 0, note.piece).toBe(true);
        });
        // In code order the pitch falls: each piece's ripples are longer than the one before.
        for (let code = 1; code < NOTES.length; code++) {
            expect(NOTES[code].wavelength, `${NOTES[code].piece} after ${NOTES[code - 1].piece}`)
                .toBeGreaterThan(NOTES[code - 1].wavelength);
        }
        const pieces = NOTES.slice(0, 7);
        const shortest = Math.min(...pieces.map((n) => n.wavelength));
        const longest = Math.max(...pieces.map((n) => n.wavelength));
        expect(NOTES[PIECE_CODE.I].wavelength).toBe(shortest);
        expect(NOTES[PIECE_CODE.O].wavelength).toBe(longest);
        // A ripple is a ripple: many to a hall, never as long as a cell of the lattice.
        expect(longest).toBeLessThan(TEMPLE.period / 10);
    });
});

describe('Kaleidosonic temple: the field and its march', () => {
    it('keeps its shapes in order: the rest shape inside its bounds, the deep trance finer', () => {
        expect(TEMPLE.sMin).toBeLessThan(TEMPLE.s);
        expect(TEMPLE.s).toBeLessThan(TEMPLE.sMax);
        expect(TEMPLE.detailDeep).toBeGreaterThan(TEMPLE.detailRest);
        expect(TEMPLE.period).toBeGreaterThan(0);
        // A clear walks the refolds; the walk starts on the rest shape and never leaves the bounds.
        expect(REFOLDS[0]).toBe(TEMPLE.s);
        REFOLDS.forEach((s, i) => {
            expect(s, `refold ${i}`).toBeGreaterThanOrEqual(TEMPLE.sMin);
            expect(s, `refold ${i}`).toBeLessThanOrEqual(TEMPLE.sMax);
            // Each step is a new hall: neighbours (round the loop) are never the same shape.
            expect(REFOLDS[(i + 1) % REFOLDS.length], `refold ${i} → ${i + 1}`).not.toBe(s);
        });
    });

    it('repeats the temple exactly every period, on every axis', () => {
        const P = TEMPLE.period;
        for (const [x, y, z] of scatter()) {
            const d = templeDistance(x, y, z);
            expect(d).toBeGreaterThanOrEqual(0);
            for (const [dx, dy, dz] of [[P, 0, 0], [0, P, 0], [0, 0, P], [-P, 0, 0], [0, -2 * P, 0], [3 * P, P, -P]]) {
                const shifted = templeDistance(x + dx, y + dy, z + dz);
                expect(Math.abs(shifted - d), `(${x}, ${y}, ${z}) + (${dx}, ${dy}, ${dz})`)
                    .toBeLessThan(1e-9 * Math.max(1, d));
            }
        }
    });

    it('lays its floors and vaults at whole periods, and stands the eye in the open air between them', () => {
        const P = TEMPLE.period;
        for (const y of [0, P, -P, 2 * P]) {
            expect(templeDistance(EYE.x, y, EYE.z), `y = ${y}`).toBeLessThan(1e-9);
        }
        expect(templeDistance(EYE.x, EYE.y, EYE.z)).toBeGreaterThan(0.05);
        expect(EYE.y).toBeGreaterThan(0);
        expect(EYE.y).toBeLessThan(P);
        // The eye's line of sight is a unit diagonal across the halls, level with the floors.
        expect(Math.hypot(...EYE.dir)).toBeCloseTo(1, 12);
        expect(EYE.dir[1]).toBe(0);
        expect(EYE.x - EYE.z).toBeCloseTo(EYE.lane, 12);
    });

    it('keeps the dive\'s lane clear of stone for every shape the temple refolds to, rest and deep', () => {
        const shapes = [...new Set([...REFOLDS, TEMPLE.s, TEMPLE.sMin, TEMPLE.sMax])];
        const misses = [];
        for (const s of shapes) {
            for (const folds of [TEMPLE.detailRest, TEMPLE.detailDeep]) {
                for (let i = 0; i <= 400; i++) {
                    const t = (i / 400) * DIVE_LENGTH;
                    const d = templeDistance(...lane(t), s, folds);
                    if (!(d > 0.05)) misses.push(`s ${s}, ${folds} folds, t ${t.toFixed(3)}: ${d.toFixed(4)}`);
                }
            }
        }
        expect(misses.slice(0, 8)).toEqual([]);
    });

    it('dives exactly one diagonal period: it lands on the view it left', () => {
        const P = TEMPLE.period;
        const flight = EYE.dir.map((v) => v * DIVE_LENGTH);
        // A whole number of lattice periods on every axis, and not none.
        flight.forEach((v, axis) => expect(Math.abs(v / P - Math.round(v / P)), `axis ${axis}`).toBeLessThan(1e-12));
        expect(Math.hypot(...flight)).toBeGreaterThan(P * 0.99);
        // So the temple seen from the end of the flight is the temple seen from its start.
        for (const [x, y, z] of scatter(120, 5)) {
            const before = templeDistance(x, y, z);
            const after = templeDistance(x + flight[0], y + flight[1], z + flight[2]);
            expect(Math.abs(after - before)).toBeLessThan(1e-9 * Math.max(1, before));
        }
    });

    it('marches a ray to the stone it meets, and nowhere when there is none in reach', () => {
        const eye = [EYE.x, EYE.y, EYE.z];
        // Straight down onto the floor, straight up into the vault.
        const down = marchTemple(eye, [0, -1, 0]);
        expect(down).not.toBeNull();
        expect(down.y).toBeGreaterThanOrEqual(-1e-6);
        expect(down.y).toBeLessThan(0.02);
        expect(down.t).toBeCloseTo(EYE.y - down.y, 9);
        const up = marchTemple(eye, [0, 1, 0]);
        expect(up.y).toBeGreaterThan(TEMPLE.period - 0.02);
        expect(up.y).toBeLessThanOrEqual(TEMPLE.period + 1e-6);
        // What it reports is on the ray and on the stone.
        expect(templeDistance(down.x, down.y, down.z)).toBeLessThan(0.002);
        expect([down.x, down.z]).toEqual([EYE.x, EYE.z]);
        // The lane is open the whole flight (and further): nothing to hit.
        expect(marchTemple(eye, EYE.dir, { far: DIVE_LENGTH })).toBeNull();
        // Out of reach is a miss; the caller's object is filled and handed back.
        expect(marchTemple(eye, [0, -1, 0], { far: EYE.y * 0.5 })).toBeNull();
        const out = {};
        expect(marchTemple(eye, [0, -1, 0], { out })).toBe(out);
        expect(out.t).toBeCloseTo(down.t, 9);
        // Never nearer than it is asked to start.
        expect(marchTemple(eye, [0, -1, 0], { near: 0.3 }).t).toBeGreaterThanOrEqual(0.3);
    });
});

describe('Kaleidosonic eye', () => {
    it('widens the lens and levels the yaw for tall frames; landscape keeps its rest lens', () => {
        expect(rigFor(16 / 9)).toEqual({ fov: RIG.fov, yaw: RIG.yaw, pitch: RIG.pitch });
        expect(rigFor(21 / 9)).toEqual(rigFor(16 / 9));
        for (const nonsense of [Number.NaN, 0, -1, undefined, Infinity]) {
            expect(rigFor(nonsense), String(nonsense)).toEqual(rigFor(16 / 9));
        }
        let previous = rigFor(3).fov;
        for (const aspect of [2, 1.5, 1.2, 1, 0.8, 0.6, 9 / 19.5, 0.3]) {
            const { fov } = rigFor(aspect);
            expect(fov, `aspect ${aspect}`).toBeGreaterThanOrEqual(previous);
            expect(fov).toBeGreaterThan(10);
            expect(fov).toBeLessThan(179);
            previous = fov;
        }
        expect(rigFor(9 / 19.5).fov).toBeGreaterThan(RIG.fov);
        expect(Math.abs(rigFor(9 / 19.5).yaw)).toBeLessThan(Math.abs(RIG.yaw));
        expect(RIG.near).toBeGreaterThan(0);
        expect(RIG.far).toBeGreaterThan(RIG.near);
    });
});

describe('Kaleidosonic moods', () => {
    it('turns six moods, each with every colour the shader reads', () => {
        expect(MOODS).toHaveLength(6);
        expect(MOOD_COUNT).toBe(MOODS.length);
        expect(new Set(MOODS.map((m) => m.name)).size).toBe(MOODS.length);
        MOODS.forEach((mood) => {
            for (const key of MOOD_COLOURS) {
                const rgb = mood[key];
                expect(Array.isArray(rgb) && rgb.length === 3, `${mood.name}.${key}`).toBe(true);
                rgb.forEach((v) => expect(Number.isFinite(v) && v >= 0, `${mood.name}.${key}`).toBe(true));
            }
            expect(Number.isFinite(mood.exposure) && mood.exposure > 0, mood.name).toBe(true);
            // The heart is the light; the stone and the air are dark under it.
            const peak = (rgb) => Math.max(...rgb);
            for (const dark of ['stoneA', 'stoneB', 'haze']) {
                expect(peak(mood.heart), `${mood.name}: heart over ${dark}`).toBeGreaterThan(4 * peak(mood[dark]));
            }
            expect(chroma(mood.heart), `${mood.name} heart`).toBeGreaterThan(0.5);
        });
    });

    it('orders the hearts by hue round the wheel: one way, one full turn, no doubling back', () => {
        const hues = MOODS.map((m) => hueOf(m.heart));
        hues.forEach((h, i) => expect(h, MOODS[i].name).toBeGreaterThanOrEqual(0));
        const steps = hues.map((h, i) => hueStep(h, hues[(i + 1) % hues.length]));
        // Every step turns the same way and none is a jump across the wheel.
        const sign = Math.sign(steps[0]);
        steps.forEach((d, i) => {
            const label = `${MOODS[i].name} → ${MOODS[(i + 1) % MOODS.length].name}`;
            expect(Math.sign(d), label).toBe(sign);
            expect(Math.abs(d), label).toBeGreaterThan(5);
            expect(Math.abs(d), label).toBeLessThan(120);
        });
        expect(Math.abs(steps.reduce((a, b) => a + b, 0))).toBeCloseTo(360, 6);
    });

    it('never passes through grey on the way from a mood to the next', () => {
        MOODS.forEach((mood, i) => {
            const next = MOODS[(i + 1) % MOODS.length];
            for (const k of [0.25, 0.5, 0.75]) {
                expect(chroma(mixRgb(mood.heart, next.heart, k)), `${mood.name} → ${next.name} at ${k}`)
                    .toBeGreaterThan(0.35);
            }
        });
    });

    it('rests on each mood at both ends of its step, and wraps round the wheel', () => {
        const rest = TIMING.moodRest;
        expect(rest).toBe(0.15); // the house rule for every turning palette
        for (let whole = -2; whole < 9; whole++) {
            const from = ((whole % MOOD_COUNT) + MOOD_COUNT) % MOOD_COUNT;
            let previous = -1;
            for (let i = 0; i < 100; i++) {
                const f = i / 100;
                const m = moodMix(whole + f);
                expect(m.from, `place ${whole + f}`).toBe(from);
                expect(m.to).toBe((from + 1) % MOOD_COUNT);
                if (f < rest) expect(m.mix, `rests at ${whole + f}`).toBe(0);
                if (f > 1 - rest) expect(m.mix, `rests at ${whole + f}`).toBe(1);
                expect(m.mix).toBeGreaterThanOrEqual(previous);
                previous = m.mix;
            }
        }
        // On its way for the rest of the step; the wheel repeats every six moods.
        expect(moodMix(0.5).mix).toBeCloseTo(0.5, 12);
        const lap = moodMix(MOOD_COUNT + 0.4);
        expect([lap.from, lap.to]).toEqual([moodMix(0.4).from, moodMix(0.4).to]);
        expect(lap.mix).toBeCloseTo(moodMix(0.4).mix, 12);
        expect(moodMix(-0.5)).toMatchObject({ from: MOOD_COUNT - 1, to: 0 });
        expect(moodMix(Number.NaN)).toEqual(moodMix(0));
    });

    it('places the wheel by the level and the clock together', () => {
        for (const level of [1, 2, 5, 13]) {
            for (const time of [0, 7.5, 100, 3456]) {
                const expected = level - 1 + time / TIMING.mood;
                expect(moodPlace(level, time), `level ${level}, ${time} s`).toBeCloseTo(expected, 12);
            }
        }
        expect(moodPlace(undefined, 0)).toBe(0);
        expect(moodPlace(1, -50)).toBe(0); // the clock never runs backward
        expect(moodPlace(3, Number.NaN)).toBe(2);
    });
});

describe('Kaleidosonic mood wheel', () => {
    it('drifts with the clock alone: no level-up, and the palette is visibly on its way within a minute', () => {
        const wheel = new MoodWheel();
        expect(wheel.place(0)).toBe(0);
        expect(wheel.place(60) - wheel.place(0)).toBeGreaterThan(0.5);
        // The colour itself changes: the heart a minute in is not the heart at the start.
        const heartAt = (place) => {
            const { from, to, mix } = moodMix(place);
            return mixRgb(MOODS[from].heart, MOODS[to].heart, mix);
        };
        const start = heartAt(wheel.place(0));
        const minute = heartAt(wheel.place(60));
        expect(Math.max(...start.map((v, i) => Math.abs(v - minute[i])))).toBeGreaterThan(0.1);
        // The light rests at most a quarter of a minute on a mood before it moves on.
        expect(TIMING.moodRest * TIMING.mood).toBeLessThan(60);
        // A level-up does not stop the clock's drift: a minute later it has moved as far again.
        wheel.levelUp(3, 20);
        const settled = 20 + TIMING.levelTurn;
        expect(wheel.place(settled + 60) - wheel.place(settled)).toBeCloseTo(60 / TIMING.mood, 12);
        expect(TIMING.levelTurn).toBeLessThan(TIMING.mood);
    });

    it('steps forward on a level-up, eased over the turn, by the levels gained', () => {
        const wheel = new MoodWheel();
        wheel.levelUp(2, 10);
        let previous = -Infinity;
        for (let t = 10; t <= 10 + TIMING.levelTurn + 1; t += 0.1) {
            const share = wheel.place(t) - t / TIMING.mood;
            expect(share, `t ${t}`).toBeGreaterThanOrEqual(previous - 1e-12);
            previous = share;
        }
        expect(wheel.place(10) - 10 / TIMING.mood).toBeCloseTo(0, 12); // eased, not snapped
        expect(wheel.place(10 + TIMING.levelTurn) - (10 + TIMING.levelTurn) / TIMING.mood).toBeCloseTo(1, 12);
        // Two levels at once step two moods.
        const leap = new MoodWheel();
        leap.levelUp(3, 0);
        expect(leap.levelShare(TIMING.levelTurn + 1)).toBeCloseTo(2, 12);
        // A silent level-up (a rebuild putting the world back on its level) lands at once.
        const silent = new MoodWheel();
        silent.levelUp(4, 30, true);
        expect(silent.place(30) - 30 / TIMING.mood).toBeCloseTo(3, 12);
    });

    it('steps on from where the last turn was heading, never back from where it has eased to', () => {
        const wheel = new MoodWheel();
        wheel.levelUp(2, 10);
        // Mid-turn, the next level: the turn heads one further than the first was heading.
        const mid = 10 + TIMING.levelTurn * 0.3;
        const before = wheel.place(mid);
        wheel.levelUp(3, mid);
        expect(wheel.place(mid)).toBeCloseTo(before, 12); // no jump at the moment of the level-up
        expect(wheel.turnTo).toBe(2);
        let previous = -Infinity;
        for (let t = mid; t <= mid + TIMING.levelTurn + 1; t += 0.05) {
            expect(wheel.place(t), `t ${t}`).toBeGreaterThan(previous);
            previous = wheel.place(t);
        }
        expect(wheel.levelShare(mid + TIMING.levelTurn)).toBeCloseTo(2, 12);
        // A level that is no step up turns nothing.
        const share = wheel.levelShare(200);
        wheel.levelUp(3, 200);
        wheel.levelUp(1, 200);
        expect(wheel.levelShare(300)).toBe(share);
    });

    it('keeps its place through a new run; the next run\'s level-ups step on from it', () => {
        const wheel = new MoodWheel();
        wheel.levelUp(4, 10);
        const t = 10 + TIMING.levelTurn + 2;
        const place = wheel.place(t);
        wheel.newRun();
        expect(wheel.level).toBe(1);
        expect(wheel.place(t)).toBe(place);
        wheel.levelUp(2, t);
        expect(wheel.place(t + TIMING.levelTurn) - wheel.place(t)).toBeCloseTo(1 + TIMING.levelTurn / TIMING.mood, 12);
        // reset() is a new sitting: the wheel starts from the first mood again.
        wheel.reset();
        expect(wheel.place(0)).toBe(0);
    });

    it('round-trips its state through export and import', () => {
        const wheel = new MoodWheel();
        wheel.levelUp(2, 12);
        wheel.levelUp(5, 14);
        const state = structuredClone(wheel.exportState());
        const other = new MoodWheel();
        other.importState(state);
        expect(other.exportState()).toEqual(state);
        for (const t of [14, 15.5, 19, 400]) expect(other.place(t), `t ${t}`).toBeCloseTo(wheel.place(t), 12);
        // Nothing, or nonsense, changes nothing / falls back to rest.
        other.importState(null);
        expect(other.exportState()).toEqual(state);
        const odd = new MoodWheel();
        odd.importState({
            turnFrom: 'x', turnTo: undefined, turnAt: Number.NaN, level: -4,
        });
        expect(odd.exportState()).toEqual(new MoodWheel().exportState());
    });
});

describe('Kaleidosonic trance and kaleidoscope', () => {
    it('deepens the trance with the chain, from none toward (never reaching) all', () => {
        expect(tranceFor(0)).toBe(0);
        let previous = 0;
        for (let n = 1; n <= 60; n++) {
            const v = tranceFor(n);
            expect(v, `chain ${n}`).toBeGreaterThan(previous);
            expect(v, `chain ${n}`).toBeLessThan(1);
            previous = v;
        }
        for (const nonsense of [-3, Number.NaN, undefined, 'x']) expect(tranceFor(nonsense), String(nonsense)).toBe(0);
    });

    it('opens its stages one after another as a chain grows', () => {
        expect(FOLD_AT).toHaveLength(3);
        FOLD_AT.forEach((at, k) => {
            expect(Number.isInteger(at) && at >= 2, `stage ${k}`).toBe(true);
            if (k > 0) expect(at, `stage ${k}`).toBeGreaterThan(FOLD_AT[k - 1]);
        });
    });

    it('leaves the lens alone while no stage is more than half open', () => {
        for (const [x, y] of [[0.3, -0.2], [-0.7, 0.1], [0, 0], [1.2, 0.9]]) {
            for (const stages of [[0, 0, 0], [0.5, 0.5, 0.5], [0.2, 0.4, 0]]) {
                expect(foldLens(x, y, 2.6, stages), `${stages}`).toEqual([x, y]);
            }
        }
    });

    it('folds every point into the core\'s wedge, keeping its distance from the lens\'s axis', () => {
        const random = mulberry32(3);
        for (let i = 0; i < 500; i++) {
            const x = random() * 2 - 1;
            const y = random() * 2 - 1;
            const bearing = random() * TAU - Math.PI;
            const r = Math.hypot(x, y);
            for (const stages of [[1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]) {
                const [px, py] = foldLens(x, y, bearing, stages);
                expect(Math.hypot(px, py), `stages ${stages}`).toBeCloseTo(r, 12);
            }
            // The mirror alone keeps the core's half (its line square to the core's bearing) and
            // leaves that half untouched.
            const [mx, my] = foldLens(x, y, bearing, [1, 0, 0]);
            const along = (a, b) => a * Math.cos(bearing) + b * Math.sin(bearing);
            expect(along(mx, my)).toBeGreaterThanOrEqual(-1e-12);
            if (along(x, y) >= 0) expect([mx, my]).toEqual([x, y]);
            else expect(along(mx, my)).toBeCloseTo(-along(x, y), 12);
            // All three: within a twelfth of the circle from the core's bearing.
            const [px, py] = foldLens(x, y, bearing, [1, 1, 1]);
            const d = (((Math.atan2(py, px) - bearing) % TAU) + TAU) % TAU;
            const off = d > Math.PI ? d - TAU : d;
            expect(off).toBeGreaterThanOrEqual(-1e-9);
            expect(off).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
        }
    });
});

describe('Kaleidosonic timings', () => {
    it('keeps every timing positive, and a chain lets go more slowly than it gathers', () => {
        Object.entries(TIMING).forEach(([key, value]) => {
            expect(Number.isFinite(value) && value > 0, key).toBe(true);
        });
        // The dive and the roll are moments, the mood a long while.
        expect(TIMING.dive).toBeLessThan(TIMING.mood);
        expect(TIMING.roll).toBeLessThan(TIMING.mood);
        expect(TIMING.foldOut).toBeGreaterThanOrEqual(TIMING.foldIn);
        expect(DIVE_LENGTH).toBeCloseTo(TEMPLE.period * Math.SQRT2, 12);
    });
});
