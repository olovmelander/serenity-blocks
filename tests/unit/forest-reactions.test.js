import { describe, expect, it } from 'vitest';
import { FOREST_FIGURE_IDS } from '../../src/themes/forest/forest-figures.js';
import {
    FOREST_FIGURE_TIMING, FOREST_REACTION_LIMITS, ForestReactions,
} from '../../src/themes/forest/forest-reactions.js';

// The director is pure: these tests assert what it promises its consumers (bounds, ordering,
// pool reuse, timelines), not the strengths and rates it is tuned to today.
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const ENVELOPES = ['gust', 'moon', 'shafts', 'glow'];
const STEP = 1 / 60;
const HANDLERS = ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCombo', 'onTSpin', 'onBackToBack', 'onPerfectClear',
    'onLevelUp', 'onGameOver'];
const FRAME_KEYS = ['beatRate', 'emitters', 'epoch', 'figure', 'front', 'glow', 'gust', 'heat', 'moon', 'settled',
    'shafts', 'stars', 'streak', 'sync', 'wake', 'waves'];
const EMITTER_KEYS = ['active', 'age', 'column', 'duration', 'id', 'kind', 'lines', 'progress', 'row', 'seed', 'serial',
    'side', 'strength'];
const WAVE_KEYS = ['column', 'heat', 'kind', 'row', 'serial', 'strength'];

function seededRandom(seed = 419) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function director(quality = 'High', seed = 5) {
    return new ForestReactions({ quality, rng: seededRandom(seed) });
}

/** A piece of one cell at board column `x` (0..9) and matrix row `y` (4 is the top visible row). */
function cell(x, y) {
    return { x, y, shape: [[1]] };
}

/** A T piece as the game hands it over: its box origin and its filled cells. */
function tee(x, y) {
    return { x, y, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] };
}

function advance(reactions, seconds, step = STEP) {
    const steps = Math.round(seconds / step);
    for (let index = 0; index < steps; index++) reactions.update(step);
    return reactions.getFrame();
}

/** Lock a piece and clear `lines` rows with it, the way one move of the game arrives. */
function clearingMove(reactions, lines = 1, piece = cell(4, 22)) {
    reactions.onPieceLock({ piece });
    return reactions.onLineClear(lines, { clearedRows: Array.from({ length: lines }, (_, index) => 23 - index) });
}

function queuedWaves(frame) {
    return frame.waves.filter((wave) => wave.serial >= 0).sort((a, b) => a.serial - b.serial);
}

function finiteDeep(value, path = 'frame') {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`);
    } else if (Array.isArray(value)) value.forEach((entry, index) => finiteDeep(entry, `${path}[${index}]`));
    else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => finiteDeep(entry, `${path}.${key}`));
    }
}

function expectBoundedFrame(frame, limit) {
    finiteDeep(frame);
    for (const key of [...ENVELOPES, 'wake', 'heat', 'sync']) {
        expect(frame[key], key).toBeGreaterThanOrEqual(0);
        expect(frame[key], key).toBeLessThanOrEqual(1);
    }
    expect(frame.beatRate).toBeGreaterThan(0);
    expect(frame.emitters.length).toBeLessThanOrEqual(limit);
    for (const emitter of frame.emitters) {
        expect([-1, 1]).toContain(emitter.side);
        for (const key of ['column', 'row', 'strength', 'progress']) {
            expect(emitter[key], `emitter.${key}`).toBeGreaterThanOrEqual(0);
            expect(emitter[key], `emitter.${key}`).toBeLessThanOrEqual(1);
        }
        expect(emitter.duration).toBeGreaterThan(0);
        expect(emitter.age).toBeLessThanOrEqual(emitter.duration);
    }
    for (const wave of frame.waves) {
        for (const key of ['column', 'row', 'heat']) {
            expect(wave[key], `wave.${key}`).toBeGreaterThanOrEqual(0);
            expect(wave[key], `wave.${key}`).toBeLessThanOrEqual(1);
        }
        expect(wave.strength).toBeGreaterThanOrEqual(0);
    }
    if (frame.front) {
        expect([-1, 1]).toContain(frame.front.direction);
        expect(frame.front.strength).toBeGreaterThanOrEqual(0);
        expect(frame.front.strength).toBeLessThanOrEqual(1);
    }
    if (frame.figure) {
        expect(frame.figure.presence).toBeGreaterThanOrEqual(0);
        expect(frame.figure.presence).toBeLessThanOrEqual(1);
    }
}

describe('Forest reactions: tiers and the resting frame', () => {
    it('gives every tier a pool of emitters, never a larger one to a cheaper tier', () => {
        expect(Object.isFrozen(FOREST_REACTION_LIMITS)).toBe(true);
        expect(Object.keys(FOREST_REACTION_LIMITS).sort()).toEqual([...TIER_ORDER].sort());
        for (let index = 0; index < TIER_ORDER.length; index++) {
            const limit = FOREST_REACTION_LIMITS[TIER_ORDER[index]];
            expect(Number.isInteger(limit) && limit >= 2, TIER_ORDER[index]).toBe(true);
            if (index > 0) expect(limit).toBeLessThanOrEqual(FOREST_REACTION_LIMITS[TIER_ORDER[index - 1]]);
            const reactions = director(TIER_ORDER[index]);
            expect(reactions.quality).toBe(TIER_ORDER[index]);
            expect(reactions.maxEmitters).toBe(limit);
            expect(reactions.emitters).toHaveLength(limit);
            expect(reactions.emitters.map((emitter) => emitter.id))
                .toEqual(Array.from({ length: limit }, (_, id) => id));
        }
    });

    it.each([
        ['low', 'Low'], ['MINIMAL', 'Minimal'], ['med', 'Medium'], ['Ultra', 'Ultra'], ['potato', 'High'], ['', 'High'],
        [undefined, 'High'], [null, 'High'], [7, 'High'], [{}, 'High'],
    ])('reads the tier name %j as %s', (quality, expected) => {
        const reactions = new ForestReactions({ quality });
        expect(reactions.quality).toBe(expected);
        expect(reactions.maxEmitters).toBe(FOREST_REACTION_LIMITS[expected]);
    });

    it('builds with no options at all', () => {
        const reactions = new ForestReactions();
        expect(reactions.quality).toBe('High');
        expect(() => { reactions.onPieceLock(); reactions.update(STEP); }).not.toThrow();
        expectBoundedFrame(reactions.getFrame(), FOREST_REACTION_LIMITS.High);
    });

    it('starts calm: no light, no wind, nobody awake, nothing queued', () => {
        const reactions = director();
        const frame = reactions.getFrame();
        expect(Object.keys(frame).sort()).toEqual(FRAME_KEYS);
        for (const key of ENVELOPES) expect(frame[key], key).toBe(0);
        expect(frame).toMatchObject({
            wake: 0, heat: 0, sync: 0, streak: 0, stars: 0, settled: false, figure: null, front: null, epoch: 1,
        });
        expect(frame.beatRate).toBeGreaterThan(0);
        expect(frame.emitters).toEqual([]);
        expect(frame.waves.length).toBeGreaterThan(0);
        for (const wave of frame.waves) {
            expect(Object.keys(wave).sort()).toEqual(WAVE_KEYS);
            expect(wave.serial).toBe(-1);
            expect(wave.strength).toBe(0);
        }
        // The property and the method are the same reading.
        expect(reactions.frame).toEqual(frame);
        // Time alone changes nothing in a calm forest.
        expect(advance(reactions, 5)).toEqual(frame);
        expect(reactions.time).toBeCloseTo(5, 6);
    });

    it('returns the frame from update, and ignores steps that are not a positive finite time', () => {
        const reactions = director();
        clearingMove(reactions, 2);
        reactions.onCombo(4);
        const before = reactions.getFrame();
        for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, '0.1', {}]) {
            expect(reactions.update(dt)).toEqual(before);
        }
        expect(reactions.time).toBe(0);
        const after = reactions.update(STEP);
        expect(after).toEqual(reactions.getFrame());
        expect(reactions.time).toBe(STEP);
        expect(after.gust).toBeLessThan(before.gust);
    });
});

describe('Forest reactions: envelopes', () => {
    it('lifts every envelope with a perfect clear and lets each fall away to nothing', () => {
        const reactions = director();
        reactions.onPerfectClear();
        let previous = reactions.getFrame();
        for (const key of ENVELOPES) {
            expect(previous[key], key).toBeGreaterThan(0.5);
            expect(previous[key], key).toBeLessThanOrEqual(1);
        }
        const emptied = Object.fromEntries(ENVELOPES.map((key) => [key, null]));
        for (let frame = 1; frame <= 60 * 60; frame++) {
            const next = reactions.update(STEP);
            for (const key of ENVELOPES) {
                // Never rising on its own, never negative, and exactly zero in the end.
                expect(next[key]).toBeLessThanOrEqual(previous[key]);
                expect(next[key]).toBeGreaterThanOrEqual(0);
                if (next[key] === 0 && emptied[key] === null) emptied[key] = frame * STEP;
            }
            previous = next;
        }
        for (const key of ENVELOPES) {
            expect(emptied[key], key).not.toBeNull();
            // Seconds, not frames and not minutes.
            expect(emptied[key], key).toBeGreaterThan(1);
            expect(emptied[key], key).toBeLessThan(40);
        }
    });

    it('decays by the clock, not by the frame rate', () => {
        const smooth = director();
        const choppy = director();
        const hitch = director();
        for (const reactions of [smooth, choppy, hitch]) reactions.onPerfectClear();
        advance(smooth, 1.2, 1 / 240);
        advance(choppy, 1.2, 1 / 20);
        hitch.update(1.2);
        for (const key of ENVELOPES) {
            expect(choppy.getFrame()[key], key).toBeCloseTo(smooth.getFrame()[key], 9);
            expect(hitch.getFrame()[key], key).toBeCloseTo(smooth.getFrame()[key], 9);
            expect(smooth.getFrame()[key], key).toBeGreaterThan(0);
        }
    });

    it('keeps the stronger of two excitements and never lets a small event dim a big one', () => {
        const reactions = director();
        reactions.onPerfectClear();
        const peak = reactions.getFrame();
        reactions.onPieceLock({ piece: cell(2, 20) });
        reactions.onLineClear(1, { clearedRows: [23] });
        reactions.onLevelUp();
        reactions.onTSpin({});
        const after = reactions.getFrame();
        for (const key of ENVELOPES) expect(after[key], key).toBe(peak[key]);
        // And the other way round: a bigger event raises what a smaller one left.
        const quiet = director();
        quiet.onPieceLock({ piece: cell(2, 20) });
        const small = quiet.getFrame();
        quiet.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        const large = quiet.getFrame();
        for (const key of ENVELOPES) expect(large[key], key).toBeGreaterThan(small[key]);
    });

    it('answers more lines with more of everything', () => {
        const frames = [1, 2, 3, 4].map((lines) => {
            const reactions = director();
            clearingMove(reactions, lines);
            return reactions.getFrame();
        });
        for (let index = 1; index < frames.length; index++) {
            for (const key of ENVELOPES) {
                expect(frames[index][key], `${index + 1} lines ${key}`).toBeGreaterThan(frames[index - 1][key]);
            }
        }
        frames.forEach((frame) => expectBoundedFrame(frame, FOREST_REACTION_LIMITS.High));
    });

    it('stays inside its bounds however hard the game pushes', () => {
        const reactions = director('Extreme');
        for (let round = 0; round < 40; round++) {
            reactions.onHardDrop({ distance: 400 });
            reactions.onPieceLock({ piece: tee(round % 10, 4 + (round % 20)) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(60);
            reactions.onTSpin({ piece: tee(8, 5) });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            expectBoundedFrame(reactions.update(STEP), FOREST_REACTION_LIMITS.Extreme);
        }
        expectBoundedFrame(advance(reactions, 3), FOREST_REACTION_LIMITS.Extreme);
    });
});

describe('Forest reactions: streaks and the waking forest', () => {
    it('counts one streak step for each piece that clears, however many clears it makes', () => {
        const reactions = director();
        expect(clearingMove(reactions)).toBe(true);
        expect(reactions.getFrame().streak).toBe(1);
        // A cascade from the same piece is still the same move.
        reactions.onLineClear(2, { clearedRows: [22, 23] });
        reactions.onLineClear(1, { clearedRows: [23] });
        expect(reactions.getFrame().streak).toBe(1);
        clearingMove(reactions);
        clearingMove(reactions, 3);
        expect(reactions.getFrame().streak).toBe(3);
    });

    it('ends the streak when a piece lands without clearing anything', () => {
        const reactions = director();
        clearingMove(reactions);
        clearingMove(reactions);
        clearingMove(reactions);
        expect(reactions.getFrame().streak).toBe(3);
        reactions.onPieceLock({ piece: cell(1, 22) });
        reactions.onPieceLock({ piece: cell(2, 22) });
        expect(reactions.getFrame().streak).toBe(0);
        // The next clearing piece starts a new one from the beginning.
        clearingMove(reactions);
        expect(reactions.getFrame().streak).toBe(1);
        // A piece that clears nothing between two that do breaks the run as well.
        reactions.onPieceLock({ piece: cell(3, 22) });
        clearingMove(reactions);
        expect(reactions.getFrame().streak).toBe(1);
    });

    it('does not wake for a single clear, and wakes further with each clearing piece in a row', () => {
        const single = director();
        clearingMove(single, 4);
        expect(advance(single, 2).wake).toBe(0);

        const levels = [2, 3, 5, 8].map((moves) => {
            const reactions = director();
            for (let move = 0; move < moves; move++) clearingMove(reactions);
            return advance(reactions, 1.5).wake;
        });
        expect(levels[0]).toBeGreaterThan(0);
        for (let index = 1; index < levels.length; index++) expect(levels[index]).toBeGreaterThan(levels[index - 1]);
        expect(levels.at(-1)).toBeLessThanOrEqual(1);
    });

    it('rises toward a combo, holds while clears keep coming, then ebbs to nothing', () => {
        const reactions = director();
        expect(reactions.onCombo(8)).toBe(true);
        expect(reactions.getFrame().wake).toBe(0);
        // It comes up smoothly, not in one frame.
        let previous = 0;
        const rise = [];
        for (let frame = 0; frame < 60; frame++) {
            const { wake } = reactions.update(STEP);
            expect(wake).toBeGreaterThan(previous);
            rise.push(wake);
            previous = wake;
        }
        expect(rise[0]).toBeLessThan(rise.at(-1) * 0.2);
        const awake = previous;
        expect(awake).toBeGreaterThan(0.5);
        // Kept alive by another combo step every second, it does not sink.
        for (let second = 0; second < 6; second++) {
            reactions.onCombo(8);
            expect(advance(reactions, 1).wake).toBeGreaterThanOrEqual(awake);
        }
        // Left alone it holds for a while, then ebbs steadily to exactly zero.
        let level = reactions.getFrame().wake;
        let ebbingSince = null;
        let asleepAt = null;
        for (let frame = 1; frame <= 60 * 60 && asleepAt === null; frame++) {
            const { wake } = reactions.update(STEP);
            if (ebbingSince === null && wake < level) ebbingSince = frame * STEP;
            // Once it has begun to ebb it never comes back up by itself.
            if (ebbingSince !== null) expect(wake).toBeLessThanOrEqual(level);
            else expect(wake).toBeGreaterThanOrEqual(level);
            level = wake;
            if (wake === 0) asleepAt = frame * STEP;
        }
        // The hold is seconds long: time for the next piece to land and keep the forest awake.
        expect(ebbingSince).toBeGreaterThan(1);
        expect(ebbingSince).toBeLessThan(15);
        expect(asleepAt).not.toBeNull();
        expect(asleepAt).toBeGreaterThan(ebbingSince + 1);
        expect(reactions.getFrame()).toMatchObject({ wake: 0, heat: 0, sync: 0 });
    });

    it('wakes further for a longer combo and not at all for a combo of one', () => {
        for (const count of [0, 1, 1.9, -3, '1']) {
            const reactions = director();
            expect(reactions.onCombo(count)).toBe(false);
            expect(advance(reactions, 1)).toMatchObject({ wake: 0, emitters: [] });
            expect(queuedWaves(reactions.getFrame())).toEqual([]);
        }
        const levels = [2, 4, 8, 16, 60].map((count) => {
            const reactions = director();
            reactions.onCombo(count);
            return advance(reactions, 1.5);
        });
        for (let index = 1; index < levels.length; index++) {
            expect(levels[index].wake).toBeGreaterThan(levels[index - 1].wake);
            expect(levels[index].glow).toBeGreaterThanOrEqual(levels[index - 1].glow);
        }
        // A count beyond anything the game sends is the longest combo there is, not an error.
        const huge = director();
        huge.onCombo(1e9);
        expect(advance(huge, 1.5).wake).toBeCloseTo(levels.at(-1).wake, 9);
    });

    it('lets the fireflies fall into step, whiten and quicken only as the forest wakes', () => {
        const reactions = director();
        reactions.onCombo(30);
        const resting = director().getFrame();
        let previous = reactions.getFrame();
        let warmedAt = null;
        for (let frame = 0; frame < 120; frame++) {
            const next = reactions.update(STEP);
            expect(next.sync).toBeGreaterThanOrEqual(previous.sync);
            expect(next.heat).toBeGreaterThanOrEqual(previous.heat);
            expect(next.beatRate).toBeGreaterThanOrEqual(previous.beatRate);
            if (next.heat > 0 && warmedAt === null) warmedAt = next.wake;
            previous = next;
        }
        expect(previous.sync).toBe(1);
        expect(previous.heat).toBeGreaterThan(0);
        expect(previous.beatRate).toBeGreaterThan(resting.beatRate);
        // They only whiten once the forest is well awake; they fall into step long before.
        expect(warmedAt).toBeGreaterThan(0.3);
    });

    it('keeps a back-to-back from lowering a forest that is already wide awake', () => {
        const drowsy = director();
        expect(drowsy.onBackToBack()).toBe(true);
        const lifted = advance(drowsy, 1.5).wake;
        expect(lifted).toBeGreaterThan(0);

        const awake = director();
        awake.onCombo(40);
        const before = advance(awake, 1.5).wake;
        expect(before).toBeGreaterThan(lifted);
        awake.onBackToBack();
        expect(advance(awake, 0.5).wake).toBeGreaterThanOrEqual(before);
        // It queues no wave and throws no fireflies of its own.
        const alone = director();
        alone.onBackToBack({ active: true });
        expect(alone.getFrame().emitters).toEqual([]);
        expect(queuedWaves(alone.getFrame())).toEqual([]);
    });
});

describe('Forest reactions: waves of light', () => {
    it('queues one wave per lock, numbered in the order they were asked for', () => {
        const reactions = director();
        for (let lock = 0; lock < 5; lock++) reactions.onPieceLock({ piece: cell(lock * 2, 22) });
        const waves = queuedWaves(reactions.getFrame());
        expect(waves.map((wave) => wave.serial)).toEqual([0, 1, 2, 3, 4]);
        for (const wave of waves) {
            expect(Object.keys(wave).sort()).toEqual(WAVE_KEYS);
            expect(wave.strength).toBeGreaterThan(0);
            expect(typeof wave.kind).toBe('string');
        }
        // Each starts from under the piece that made it.
        const columns = waves.map((wave) => wave.column);
        for (let index = 1; index < columns.length; index++) expect(columns[index]).toBeGreaterThan(columns[index - 1]);
    });

    it('hands out the same queue every frame and reuses its slots in a ring', () => {
        const reactions = director();
        const pool = reactions.getFrame().waves;
        const size = pool.length;
        expect(size).toBeGreaterThanOrEqual(4);
        const total = size * 3 + 2;
        for (let lock = 0; lock < total; lock++) reactions.onPieceLock({ piece: cell(lock % 10, 22) });
        const frame = reactions.update(STEP);
        // No allocation: it is the pool itself, at its fixed size.
        expect(frame.waves).toBe(pool);
        expect(frame.waves).toHaveLength(size);
        // It holds the most recent requests, each once, and nothing older.
        const serials = frame.waves.map((wave) => wave.serial).sort((a, b) => a - b);
        expect(serials).toEqual(Array.from({ length: size }, (_, index) => total - size + index));
        expect(new Set(serials).size).toBe(size);
    });

    it('never numbers two waves alike across every kind of event', () => {
        const reactions = director();
        const seen = new Set();
        let highest = -1;
        const script = [
            () => reactions.onPieceLock({ piece: cell(1, 22) }),
            () => reactions.onLineClear(1, { clearedRows: [23] }),
            () => reactions.onLineClear(3, { clearedRows: [21, 22, 23] }),
            () => reactions.onCombo(5),
            () => reactions.onTSpin({ piece: tee(6, 18) }),
            () => reactions.onPerfectClear(),
            () => reactions.onLevelUp(),
            () => { reactions.onHardDrop({ distance: 18 }); reactions.onPieceLock({ piece: cell(8, 22) }); },
        ];
        for (const act of script) {
            act();
            const played = highest;
            const fresh = queuedWaves(reactions.getFrame()).filter((wave) => wave.serial > played);
            // Every event that reaches the floor asks for at least one wave.
            expect(fresh.length).toBeGreaterThan(0);
            for (const wave of fresh) {
                expect(seen.has(wave.serial)).toBe(false);
                seen.add(wave.serial);
                highest = Math.max(highest, wave.serial);
            }
            reactions.update(STEP);
        }
        expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: seen.size }, (_, index) => index));
    });

    it('sends a taller call for more lines, and a second wave from two lines up', () => {
        const calls = [1, 2, 3, 4].map((lines) => {
            const reactions = director();
            reactions.onLineClear(lines, { clearedRows: Array.from({ length: lines }, (_, index) => 23 - index) });
            return queuedWaves(reactions.getFrame());
        });
        expect(calls[0]).toHaveLength(1);
        for (let index = 1; index < calls.length; index++) {
            expect(calls[index].length).toBeGreaterThanOrEqual(2);
            // The first wave of a bigger clear is at least as strong and as hot.
            expect(calls[index][0].strength).toBeGreaterThan(calls[index - 1][0].strength);
            expect(calls[index][0].heat).toBeGreaterThanOrEqual(calls[index - 1][0].heat);
        }
        // Four lines is its own kind of wave: consumers give it its own shape.
        expect(calls[3][0].kind).not.toBe(calls[0][0].kind);
        // The wave rises from under the rows that were cleared.
        const low = director();
        low.onLineClear(1, { clearedRows: [23] });
        const high = director();
        high.onLineClear(1, { clearedRows: [6] });
        expect(queuedWaves(high.getFrame())[0].row).toBeGreaterThan(queuedWaves(low.getFrame())[0].row + 0.5);
    });

    it('makes a hard drop strengthen the lock that follows it, and only that one', () => {
        const strengthAfter = (prepare) => {
            const reactions = director();
            prepare(reactions);
            reactions.onPieceLock({ piece: cell(4, 22) });
            const frame = reactions.getFrame();
            return {
                wave: queuedWaves(frame).at(-1),
                lock: frame.emitters.find((emitter) => emitter.kind === 'lock'),
                kinds: frame.emitters.map((emitter) => emitter.kind),
                frame,
                reactions,
            };
        };
        const soft = strengthAfter(() => {});
        const short = strengthAfter((reactions) => reactions.onHardDrop({ distance: 2 }));
        const long = strengthAfter((reactions) => reactions.onHardDrop({ distance: 18 }));
        const beyond = strengthAfter((reactions) => reactions.onHardDrop({ distance: 5000 }));
        expect(short.wave.strength).toBeGreaterThan(soft.wave.strength);
        expect(long.wave.strength).toBeGreaterThan(short.wave.strength);
        expect(long.lock.strength).toBeGreaterThan(soft.lock.strength);
        for (const key of ['gust', 'glow', 'shafts']) expect(long.frame[key], key).toBeGreaterThan(soft.frame[key]);
        // A drop longer than the board is the longest drop there is.
        const whole = strengthAfter((reactions) => reactions.onHardDrop({ distance: 20 }));
        expect(beyond.wave.strength).toBeCloseTo(whole.wave.strength, 12);
        expect(beyond.lock.strength).toBeLessThanOrEqual(1);
        // A long drop shakes the boughs and sends its own kind of wave; a gentle lock does neither.
        expect(long.kinds).toContain('dew');
        expect(soft.kinds).not.toContain('dew');
        expect(short.kinds).not.toContain('dew');
        expect(long.wave.kind).not.toBe(soft.wave.kind);
        // The drop is spent: the next piece lands as softly as any other.
        long.reactions.onPieceLock({ piece: cell(4, 22) });
        expect(queuedWaves(long.reactions.getFrame()).at(-1).strength).toBe(soft.wave.strength);
    });

    it.each([
        [{ startY: 2, endY: 20 }, true], [{ distance: '18' }, false], [{ distance: -8 }, false],
        [{ distance: NaN }, false],
        [{ startY: 'a', endY: 9 }, false], [{}, false], [undefined, false], [null, false], [42, false],
        [{ detail: { distance: 18 } }, true], [{ distance: Infinity, startY: 0, endY: 19 }, true],
    ])('reads the hard drop %j as a long fall: %s', (payload, long) => {
        const reactions = director();
        expect(reactions.onHardDrop(payload)).toBe(true);
        reactions.onPieceLock({ piece: cell(4, 22) });
        const frame = reactions.getFrame();
        finiteDeep(frame);
        expect(frame.emitters.some((emitter) => emitter.kind === 'dew')).toBe(long);
    });
});

describe('Forest reactions: where things happen on the board', () => {
    it('places a lock by the piece: side from its half of the board, height from its row', () => {
        const at = (piece) => {
            const reactions = director();
            reactions.onPieceLock({ piece });
            const frame = reactions.getFrame();
            return { emitter: frame.emitters[0], wave: queuedWaves(frame)[0] };
        };
        const left = at(cell(0, 23));
        const right = at(cell(9, 23));
        expect(left.emitter.side).toBe(-1);
        expect(right.emitter.side).toBe(1);
        expect(left.emitter.column).toBeLessThan(0.2);
        expect(right.emitter.column).toBeGreaterThan(0.8);
        expect(left.wave.column).toBe(left.emitter.column);
        // Row 0 is the foot of the board, 1 its top: the hidden rows above count as the top.
        const foot = at(cell(4, 23));
        const middle = at(cell(4, 14));
        const top = at(cell(4, 4));
        expect(foot.emitter.row).toBeLessThan(0.1);
        expect(middle.emitter.row).toBeGreaterThan(0.4);
        expect(middle.emitter.row).toBeLessThan(0.6);
        expect(top.emitter.row).toBeGreaterThan(0.9);
        expect(at(cell(4, 0)).emitter.row).toBe(1);
        expect(at(cell(4, 900)).emitter.row).toBe(0);
        expect(at(cell(-50, 23)).emitter.column).toBe(0);
        expect(at(cell(50, 23)).emitter.column).toBe(1);
        // The centre of the filled cells counts, not the corner of the piece's box.
        const flat = at({ x: 3, y: 20, shape: [[1, 1, 1, 1]] });
        expect(flat.emitter.column).toBeCloseTo(0.5, 9);
    });

    it('prefers the on-screen origin a scrolling mode supplies over the piece', () => {
        const reactions = director();
        reactions.onPieceLock({ piece: cell(0, 4000), viewportOrigin: { x: 0.9, y: 0.25 } });
        const [emitter] = reactions.getFrame().emitters;
        expect(emitter.side).toBe(1);
        expect(emitter.column).toBeCloseTo(0.9, 12);
        // The origin's y runs down the screen; the director's row runs up the board.
        expect(emitter.row).toBeCloseTo(0.75, 12);
        // Out-of-range origins are clamped to the card.
        const outside = director();
        outside.onPieceLock({ viewportOrigin: { x: -4, y: 9 } });
        expect(outside.getFrame().emitters[0]).toMatchObject({ column: 0, row: 0, side: -1 });
    });

    it('still answers a lock it cannot place, from the middle of the foot of the board', () => {
        for (const payload of [undefined, null, {}, { piece: null }, { piece: { x: NaN, y: 3 } }, { piece: 'T' }, 7,
            { piece: { x: 2, y: Infinity, shape: [[1]] } }, { viewportOrigin: { x: 'a', y: 0.5 } }, { detail: null }]) {
            const reactions = director();
            expect(reactions.onPieceLock(payload)).toBe(true);
            const frame = reactions.getFrame();
            finiteDeep(frame);
            expect(frame.emitters).toHaveLength(1);
            expect(frame.emitters[0].column).toBe(0.5);
            expect(frame.emitters[0].row).toBeLessThan(0.3);
            expect([-1, 1]).toContain(frame.emitters[0].side);
            expect(queuedWaves(frame)).toHaveLength(1);
        }
        // With no place to go by, successive puffs alternate sides rather than piling up on one.
        const reactions = director();
        for (let lock = 0; lock < 6; lock++) reactions.onPieceLock({});
        const sides = reactions.getFrame().emitters.map((emitter) => emitter.side);
        expect(sides.filter((side) => side === -1).length).toBe(3);
        expect(sides.filter((side) => side === 1).length).toBe(3);
        // A piece with a malformed shape is placed by its origin.
        const odd = director();
        odd.onPieceLock({ piece: { x: 7, y: 20, shape: [null, 'x', [0, 0]] } });
        expect(odd.getFrame().emitters[0]).toMatchObject({ side: 1 });
        expect(odd.getFrame().emitters[0].column).toBeCloseTo(0.75, 9);
    });

    it('blows the fireflies out of both sides at the height of the cleared rows', () => {
        const jets = (rows, detail = {}) => {
            const reactions = director();
            reactions.onLineClear(rows.length || 1, { clearedRows: rows, ...detail });
            return reactions.getFrame().emitters.filter((emitter) => emitter.kind === 'clear');
        };
        const low = jets([23]);
        expect(low.map((emitter) => emitter.side).sort()).toEqual([-1, 1]);
        expect(low[0].row).toBe(low[1].row);
        expect(low[0].row).toBeLessThan(0.1);
        expect(jets([4])[0].row).toBeGreaterThan(0.9);
        // Several rows: their middle.
        const spread = jets([10, 11, 12, 13])[0].row;
        expect(spread).toBeGreaterThan(jets([13])[0].row);
        expect(spread).toBeLessThan(jets([10])[0].row);
        // Rows that mean nothing on a standard board (a scrolling mode's absolute rows), or no
        // rows at all, fall back to the on-screen origin when there is one.
        expect(jets([400, 401], { viewportOrigin: { x: 0.5, y: 0.2 } })[0].row).toBeCloseTo(0.8, 12);
        const lost = jets([400, 401])[0].row;
        expect(lost).toBeGreaterThanOrEqual(0);
        expect(lost).toBeLessThan(0.5);
        expect(jets([])[0].row).toBe(lost);
        expect(jets([NaN, 'x', null])[0].row).toBe(lost);
        expect(jets([-30])[0].row).toBe(lost);
    });
});

describe('Forest reactions: the emitter pool', () => {
    it.each(TIER_ORDER)('never plays more emitters than the %s tier allows, each in a slot of its own', (quality) => {
        const reactions = director(quality);
        const limit = FOREST_REACTION_LIMITS[quality];
        for (let lock = 0; lock < limit * 3; lock++) {
            reactions.onPieceLock({ piece: cell(lock % 10, 22) });
            const { emitters } = reactions.getFrame();
            expect(emitters.length).toBe(Math.min(lock + 1, limit));
            const ids = emitters.map((emitter) => emitter.id);
            expect(new Set(ids).size).toBe(ids.length);
            for (const id of ids) expect(id >= 0 && id < limit).toBe(true);
        }
        // Serials go on counting, so a consumer can tell a reused slot from the event before it.
        const serials = reactions.getFrame().emitters.map((emitter) => emitter.serial);
        expect(new Set(serials).size).toBe(limit);
        expect(Math.max(...serials)).toBe(limit * 3 - 1);
        expect(Math.min(...serials)).toBe(limit * 2);
    });

    it('takes a free slot first and otherwise the emitter nearest the end of its life', () => {
        const reactions = director('Minimal');
        const limit = FOREST_REACTION_LIMITS.Minimal;
        // A long emitter first, then the pool filled with short ones a little later.
        reactions.onPerfectClear();
        const long = reactions.getFrame().emitters.find((emitter) => emitter.kind === 'rise');
        advance(reactions, 0.2);
        for (let lock = 1; lock < limit; lock++) reactions.onPieceLock({ piece: cell(lock, 22) });
        advance(reactions, 0.4);
        const before = reactions.getFrame().emitters;
        expect(before).toHaveLength(limit);
        const furthest = [...before].sort((a, b) => b.progress - a.progress)[0];
        expect(furthest.id).not.toBe(long.id);
        // The pool is full: the next event takes the slot that was furthest through its life.
        reactions.onTSpin({ piece: tee(1, 10) });
        const after = reactions.getFrame().emitters;
        expect(after).toHaveLength(limit);
        const spin = after.find((emitter) => emitter.kind === 'spin');
        expect(spin.id).toBe(furthest.id);
        expect(spin.age).toBe(0);
        expect(spin.serial).toBeGreaterThan(Math.max(...before.map((emitter) => emitter.serial)));
        // The long one is still playing where it was.
        expect(after.find((emitter) => emitter.id === long.id)).toMatchObject({ kind: 'rise', serial: long.serial });
        // Once one has run out, its slot is the one that is taken.
        advance(reactions, 1.2);
        const playing = reactions.getFrame().emitters.map((emitter) => emitter.id);
        expect(playing.length).toBeLessThan(limit);
        reactions.onLevelUp();
        reactions.onPieceLock({ piece: cell(5, 22) });
        const refilled = reactions.getFrame().emitters;
        const fresh = refilled.find((emitter) => emitter.age === 0);
        expect(playing).not.toContain(fresh.id);
    });

    it('plays each emitter through from start to finish, then frees it', () => {
        const reactions = director();
        clearingMove(reactions, 2);
        const started = reactions.getFrame().emitters;
        expect(started.length).toBeGreaterThanOrEqual(3);
        for (const emitter of started) {
            expect(Object.keys(emitter).sort()).toEqual(EMITTER_KEYS);
            expect(emitter).toMatchObject({ active: true, age: 0, progress: 0 });
            expect(emitter.seed).toBeGreaterThanOrEqual(0);
            expect(emitter.seed).toBeLessThan(1);
        }
        const last = new Map(started.map((emitter) => [emitter.id, 0]));
        const lifetimes = new Map();
        for (let frame = 1; frame <= 600 && lifetimes.size < started.length; frame++) {
            const { emitters } = reactions.update(STEP);
            for (const emitter of emitters) {
                expect(emitter.progress).toBeGreaterThan(last.get(emitter.id));
                expect(emitter.progress).toBeLessThanOrEqual(1);
                last.set(emitter.id, emitter.progress);
            }
            for (const emitter of started) {
                if (!lifetimes.has(emitter.id) && !emitters.some((entry) => entry.id === emitter.id)) {
                    lifetimes.set(emitter.id, frame * STEP);
                }
            }
        }
        expect(lifetimes.size).toBe(started.length);
        for (const emitter of started) {
            // It was seen nearly to the end, and it ended when its own duration said.
            expect(last.get(emitter.id)).toBeGreaterThan(0.9);
            expect(lifetimes.get(emitter.id)).toBeCloseTo(emitter.duration, 1);
        }
        expect(reactions.getFrame().emitters).toEqual([]);
    });

    it('hands out copies: a consumer scribbling on its frame cannot disturb the director', () => {
        const reactions = director();
        reactions.onPieceLock({ piece: cell(2, 20) });
        const first = reactions.getFrame();
        const [emitter] = first.emitters;
        const kept = { ...emitter };
        emitter.active = false;
        emitter.strength = 99;
        emitter.side = 0;
        first.emitters.length = 0;
        first.gust = 42;
        const second = reactions.getFrame();
        expect(second.emitters).toHaveLength(1);
        expect(second.emitters[0]).toEqual(kept);
        expect(second.gust).toBeLessThanOrEqual(1);
        expect(second.emitters).not.toBe(first.emitters);
    });

    it('gives a bigger clear a stronger, longer jet and remembers how many lines it was', () => {
        const jets = [1, 2, 3, 4].map((lines) => {
            const reactions = director();
            reactions.onLineClear(lines, {});
            return reactions.getFrame().emitters.find((emitter) => emitter.kind === 'clear');
        });
        jets.forEach((jet, index) => expect(jet.lines).toBe(index + 1));
        for (let index = 1; index < jets.length; index++) {
            expect(jets[index].strength).toBeGreaterThan(jets[index - 1].strength);
            expect(jets[index].duration).toBeGreaterThanOrEqual(jets[index - 1].duration);
        }
        // Four lines lift fireflies off the whole floor as well; three do not.
        const kinds = (lines) => {
            const reactions = director();
            reactions.onLineClear(lines, {});
            return reactions.getFrame().emitters.map((emitter) => emitter.kind);
        };
        expect(kinds(4)).toContain('rise');
        expect(kinds(3)).not.toContain('rise');
    });
});

describe('Forest reactions: the wind front and the falling stars', () => {
    it('sends a front of wind across the view for two lines or more, alternating its direction', () => {
        const calm = director();
        calm.onLineClear(1, {});
        expect(calm.getFrame().front).toBeNull();

        const reactions = director();
        const directions = [];
        for (let sweep = 0; sweep < 4; sweep++) {
            reactions.onLineClear(2, {});
            const { front } = reactions.getFrame();
            expect(front).not.toBeNull();
            expect(Object.keys(front).sort()).toEqual(['direction', 'position', 'strength']);
            directions.push(front.direction);
            // It starts off-screen on the side it comes from.
            expect(Math.sign(front.position)).toBe(-front.direction);
            expect(Math.abs(front.position)).toBeGreaterThan(1);
            expect(front.strength).toBe(0);
            reactions.update(STEP);
        }
        expect(directions).toEqual([directions[0], -directions[0], directions[0], -directions[0]]);
    });

    it('carries the front right across, swelling and fading, and then lets it go', () => {
        const reactions = director();
        reactions.onPerfectClear();
        const { direction } = reactions.getFrame().front;
        let previous = reactions.getFrame().front.position * direction;
        let peak = 0;
        let crossed = false;
        let frames = 0;
        for (; frames < 600; frames++) {
            const { front } = reactions.update(STEP);
            if (!front) break;
            expect(front.direction).toBe(direction);
            // Always moving the way it faces.
            expect(front.position * direction).toBeGreaterThan(previous);
            previous = front.position * direction;
            expect(front.strength).toBeGreaterThanOrEqual(0);
            expect(front.strength).toBeLessThanOrEqual(1);
            peak = Math.max(peak, front.strength);
            crossed = crossed || Math.abs(front.position) < 0.05;
        }
        expect(reactions.getFrame().front).toBeNull();
        expect(crossed).toBe(true);
        expect(peak).toBeGreaterThan(0.5);
        // It ends beyond the far edge, within a few seconds.
        expect(previous).toBeGreaterThan(1);
        expect(frames * STEP).toBeGreaterThan(0.5);
        expect(frames * STEP).toBeLessThan(10);
        // A stronger clear is a stronger front.
        const peakOf = (lines) => {
            const wind = director();
            wind.onLineClear(lines, {});
            let most = 0;
            for (let frame = 0; frame < 600; frame++) most = Math.max(most, wind.update(STEP).front?.strength ?? 0);
            return most;
        };
        expect(peakOf(4)).toBeGreaterThan(peakOf(2));
    });

    it('counts the falling stars it has asked for, and never counts one back', () => {
        const reactions = director();
        const count = () => reactions.getFrame().stars;
        expect(count()).toBe(0);
        // Small things do not move the sky.
        reactions.onPieceLock({ piece: cell(1, 22) });
        reactions.onLineClear(1, {});
        reactions.onLineClear(2, {});
        reactions.onCombo(9);
        reactions.onTSpin({});
        reactions.onBackToBack();
        expect(count()).toBe(0);
        let previous = 0;
        for (const act of [() => reactions.onLineClear(3, {}), () => reactions.onLineClear(4, {}),
            () => reactions.onPerfectClear(), () => reactions.onLevelUp()]) {
            act();
            expect(count()).toBeGreaterThan(previous);
            expect(Number.isInteger(count())).toBe(true);
            previous = count();
        }
        // Time and a game over leave the count alone: it is a serial, not an envelope.
        advance(reactions, 30);
        reactions.onGameOver();
        expect(count()).toBe(previous);
    });
});

describe('Forest reactions: the figure', () => {
    const { gather, hold, release } = FOREST_FIGURE_TIMING;

    it('describes a summons in seconds: gather, stand, let go', () => {
        expect(Object.isFrozen(FOREST_FIGURE_TIMING)).toBe(true);
        expect(Object.keys(FOREST_FIGURE_TIMING).sort()).toEqual(['gather', 'hold', 'release']);
        for (const seconds of [gather, hold, release]) {
            expect(Number.isFinite(seconds) && seconds > 0.2).toBe(true);
            expect(seconds).toBeLessThan(30);
        }
    });

    it('is called by four lines and by a perfect clear, and by nothing less', () => {
        for (const act of [(r) => r.onLineClear(1, {}), (r) => r.onLineClear(3, {}), (r) => r.onCombo(30),
            (r) => r.onTSpin({}), (r) => r.onBackToBack(), (r) => r.onLevelUp(), (r) => r.onPieceLock({})]) {
            const reactions = director();
            act(reactions);
            expect(reactions.getFrame().figure).toBeNull();
            expect(advance(reactions, 1).figure).toBeNull();
        }
        for (const act of [(r) => r.onLineClear(4, {}), (r) => r.onPerfectClear()]) {
            const reactions = director();
            act(reactions);
            const { figure } = reactions.getFrame();
            expect(Object.keys(figure).sort()).toEqual(['age', 'held', 'kind', 'presence', 'serial']);
            expect(FOREST_FIGURE_IDS).toContain(figure.kind);
            expect(figure).toMatchObject({
                serial: 1, age: 0, held: true, presence: 0,
            });
        }
    });

    it('gathers, stands and lets go on its timeline', () => {
        const reactions = director();
        reactions.onLineClear(4, {});
        let previous = reactions.getFrame().figure;
        const seen = { gathering: 0, standing: 0, leaving: 0 };
        let goneAt = null;
        for (let frame = 1; frame <= 60 * 60 && goneAt === null; frame++) {
            const { figure } = reactions.update(STEP);
            const t = frame * STEP;
            if (!figure) {
                goneAt = t;
            } else {
                expect(figure.serial).toBe(1);
                expect(figure.age).toBeCloseTo(t, 6);
                if (figure.held && figure.presence < 1) {
                    // Gathering: presence only rises.
                    expect(figure.presence).toBeGreaterThan(previous.presence);
                    seen.gathering += 1;
                } else if (figure.held) {
                    seen.standing += 1;
                } else {
                    // Letting go: no longer held, presence only falls.
                    expect(figure.presence).toBeLessThanOrEqual(previous.held ? 1 : previous.presence);
                    seen.leaving += 1;
                }
                // Once it has let go it never takes hold again.
                if (!previous.held) expect(figure.held).toBe(false);
                previous = figure;
            }
        }
        expect(goneAt).toBeCloseTo(gather + hold + release, 1);
        expect(seen.gathering * STEP).toBeCloseTo(gather, 1);
        expect(seen.standing * STEP).toBeCloseTo(hold, 1);
        expect(seen.leaving * STEP).toBeCloseTo(release, 1);
        expect(previous.presence).toBeLessThan(0.05);
        // And it stays gone.
        expect(advance(reactions, 5).figure).toBeNull();
    });

    it('numbers every summons, and a new one starts over while the old one still stands', () => {
        const reactions = director();
        reactions.onLineClear(4, {});
        const standing = advance(reactions, gather + hold * 0.5).figure;
        expect(standing).toMatchObject({ serial: 1, held: true, presence: 1 });
        reactions.onLineClear(4, {});
        expect(reactions.getFrame().figure).toMatchObject({
            serial: 2, age: 0, held: true, presence: 0,
        });
        // One that comes while the last is letting go is a new figure too.
        const leaving = advance(reactions, gather + hold + release * 0.5).figure;
        expect(leaving).toMatchObject({ serial: 2, held: false });
        reactions.onPerfectClear();
        expect(reactions.getFrame().figure).toMatchObject({ serial: 3, age: 0, held: true });
        advance(reactions, 60);
        expect(reactions.getFrame().figure).toBeNull();
        reactions.onLineClear(4, {});
        expect(reactions.getFrame().figure.serial).toBe(4);
    });

    it('stands longer for a perfect clear than for four lines', () => {
        const heldFor = (act) => {
            const reactions = director();
            act(reactions);
            let frames = 0;
            while (reactions.update(STEP).figure?.held && frames < 6000) frames += 1;
            return frames * STEP;
        };
        const four = heldFor((reactions) => reactions.onLineClear(4, {}));
        const perfect = heldFor((reactions) => reactions.onPerfectClear());
        expect(four).toBeCloseTo(gather + hold, 1);
        expect(perfect).toBeGreaterThan(four + 0.5);
        expect(perfect).toBeLessThan(60);
    });

    it('holds for as long as it is asked to, within reason', () => {
        const heldFor = (seconds) => {
            const reactions = director();
            reactions.summon(seconds);
            let frames = 0;
            while (reactions.update(STEP).figure?.held && frames < 6000) frames += 1;
            return frames * STEP - gather;
        };
        expect(heldFor(2)).toBeCloseTo(2, 1);
        expect(heldFor(5)).toBeCloseTo(5, 1);
        // Nonsense requests are bounded on both sides.
        expect(heldFor(0)).toBeGreaterThan(0.2);
        expect(heldFor(-9)).toBe(heldFor(0));
        expect(heldFor(1e6)).toBeLessThan(30);
        expect(heldFor(Infinity)).toBe(heldFor(1e6));
        // No argument is the standard hold.
        expect(heldFor(undefined)).toBeCloseTo(hold, 1);
    });

    it('lets go at once when the game ends', () => {
        const reactions = director();
        reactions.onLineClear(4, {});
        expect(advance(reactions, gather * 0.5).figure).toMatchObject({ held: true });
        reactions.onGameOver();
        const cue = reactions.getFrame().figure;
        expect(cue).toMatchObject({ serial: 1, held: false });
        // It fades over the usual release rather than vanishing.
        expect(cue.presence).toBeGreaterThan(0.9);
        expect(advance(reactions, release * 0.5).figure.presence).toBeLessThan(cue.presence);
        expect(advance(reactions, release).figure).toBeNull();
        // A game over with no figure about is not a summons.
        const quiet = director();
        quiet.onGameOver();
        expect(quiet.getFrame().figure).toBeNull();
    });
});

describe('Forest reactions: which animal comes', () => {
    /** The animals of `count` summonses in a row. */
    function called(reactions, count) {
        return Array.from({ length: count }, () => {
            reactions.onLineClear(4, {});
            return reactions.getFrame().figure.kind;
        });
    }
    const ROUND = FOREST_FIGURE_IDS.length;

    it('the wood has many animals, the stag among them, each with a name of its own', () => {
        expect(ROUND).toBeGreaterThanOrEqual(10);
        expect(new Set(FOREST_FIGURE_IDS).size).toBe(ROUND);
        for (const name of ['stag', 'moose', 'bear', 'wolf', 'owl']) expect(FOREST_FIGURE_IDS).toContain(name);
    });

    it('every animal comes once before any comes back', () => {
        for (const seed of [1, 5, 77, 419, 2026]) {
            const reactions = director('High', seed);
            for (let round = 0; round < 4; round++) {
                expect([...called(reactions, ROUND)].sort(), `seed ${seed}, round ${round}`)
                    .toEqual([...FOREST_FIGURE_IDS].sort());
            }
        }
    });

    it('never calls the same animal twice running, not even where two rounds meet', () => {
        for (let seed = 1; seed <= 60; seed++) {
            const order = called(director('High', seed), ROUND * 6);
            for (let index = 1; index < order.length; index++) {
                expect(order[index], `seed ${seed}, summons ${index}`).not.toBe(order[index - 1]);
            }
        }
    });

    it('comes in a different order for a different random source, and the same order for the same one', () => {
        const first = new Set();
        const orders = new Set();
        for (let seed = 1; seed <= 60; seed++) {
            const order = called(director('High', seed), ROUND);
            first.add(order[0]);
            orders.add(order.join());
            expect(called(director('High', seed), ROUND)).toEqual(order);
        }
        // It is not the stag every time a game begins, and the rounds differ.
        expect(first.size).toBeGreaterThan(ROUND / 2);
        expect(orders.size).toBeGreaterThan(50);
    });

    it('a perfect clear calls from the same round as four lines do', () => {
        const reactions = director();
        const order = [];
        for (let index = 0; index < ROUND; index++) {
            if (index % 2 === 0) reactions.onPerfectClear();
            else reactions.onLineClear(4, {});
            order.push(reactions.getFrame().figure.kind);
        }
        expect(order.sort()).toEqual([...FOREST_FIGURE_IDS].sort());
    });

    it('is one animal from the summons until it has gone', () => {
        const reactions = director();
        reactions.onLineClear(4, {});
        const { kind } = reactions.getFrame().figure;
        for (let frame = reactions.update(STEP); frame.figure; frame = reactions.update(STEP)) {
            expect(frame.figure.kind).toBe(kind);
        }
        reactions.onLineClear(4, {});
        expect(reactions.getFrame().figure.kind).not.toBe(kind);
    });

    it('starts a round afresh after a reset, so a capture can be played again', () => {
        const reactions = director('High', 9);
        const order = called(reactions, 5);
        reactions.reset();
        // Five more, and with what was called before the reset no longer counted: a whole round.
        const after = called(reactions, ROUND);
        expect([...after].sort()).toEqual([...FOREST_FIGURE_IDS].sort());
        expect(order.every((name) => FOREST_FIGURE_IDS.includes(name))).toBe(true);
        // The same random numbers after a reset call the same animals.
        let tape = seededRandom(31);
        const replayed = new ForestReactions({ quality: 'High', rng: () => tape() });
        const once = called(replayed, ROUND);
        replayed.reset();
        tape = seededRandom(31);
        expect(called(replayed, ROUND)).toEqual(once);
    });

    it('can be asked for one animal by name, and lets them come as they will again', () => {
        const reactions = director();
        expect(reactions.callFor('owl')).toBe('owl');
        expect(new Set(called(reactions, 6))).toEqual(new Set(['owl']));
        // It stays asked for across a reset: it is how the capture was set up.
        reactions.reset();
        expect(called(reactions, 2)).toEqual(['owl', 'owl']);
        for (const nobody of ['dragon', '', null, undefined, 7, {}]) {
            expect(reactions.callFor(nobody)).toBeNull();
        }
        expect([...called(reactions, ROUND)].sort()).toEqual([...FOREST_FIGURE_IDS].sort());
    });

    it('can be given a generator of its own for the animals, and then leaves the other alone', () => {
        const drawn = { rng: 0, figure: 0 };
        const main = seededRandom(5);
        const dealer = seededRandom(11);
        const reactions = new ForestReactions({
            quality: 'High',
            rng: () => { drawn.rng += 1; return main(); },
            figureRng: () => { drawn.figure += 1; return dealer(); },
        });
        const before = drawn.rng;
        const order = [];
        for (let index = 0; index < ROUND; index++) {
            reactions.summon();
            order.push(reactions.getFrame().figure.kind);
        }
        // One shuffle deals a whole round; the director's own generator was not asked.
        expect(drawn.rng).toBe(before);
        expect(drawn.figure).toBe(ROUND - 1);
        expect([...order].sort()).toEqual([...FOREST_FIGURE_IDS].sort());
        // The same dealer deals the same round whatever the other generator is.
        const dealerAgain = seededRandom(11);
        const other = new ForestReactions({ quality: 'High', rng: seededRandom(999), figureRng: dealerAgain });
        expect(Array.from({ length: ROUND }, () => {
            other.summon();
            return other.getFrame().figure.kind;
        })).toEqual(order);
        // Without one, or with something that is not a generator, the director's own deals.
        for (const figureRng of [undefined, null, 4, 'dice']) {
            const plain = new ForestReactions({ quality: 'High', rng: seededRandom(5), figureRng });
            expect(plain.figureRng).toBe(plain.rng);
        }
    });

    it('still calls every animal when the random source is stuck or broken', () => {
        for (const rng of [() => 0.5, () => 0, () => 0.999999, () => NaN, () => 7, () => -3]) {
            const reactions = new ForestReactions({ quality: 'High', rng });
            const order = called(reactions, ROUND * 2);
            expect([...order.slice(0, ROUND)].sort()).toEqual([...FOREST_FIGURE_IDS].sort());
            expect([...order.slice(ROUND)].sort()).toEqual([...FOREST_FIGURE_IDS].sort());
            for (let index = 1; index < order.length; index++) expect(order[index]).not.toBe(order[index - 1]);
        }
    });
});

describe('Forest reactions: game over', () => {
    it('settles the forest: the wind front stops, the streak ends, the forest falls asleep', () => {
        const reactions = director();
        for (let move = 0; move < 6; move++) clearingMove(reactions, 2);
        reactions.onCombo(12);
        const awake = advance(reactions, 1);
        expect(awake.wake).toBeGreaterThan(0.3);
        expect(awake.front).not.toBeNull();
        expect(awake.streak).toBe(6);
        expect(awake.settled).toBe(false);
        expect(reactions.onGameOver()).toBe(true);
        const over = reactions.getFrame();
        expect(over).toMatchObject({ settled: true, front: null, streak: 0 });
        // What is in the air is left to finish, and the light fades as it would have.
        expect(over.emitters.length).toBe(awake.emitters.length);
        expect(over.wake).toBe(awake.wake);
        for (const key of ENVELOPES) expect(over[key], key).toBe(awake[key]);
        // No hold: it starts to ebb with the very next frame.
        expect(reactions.update(STEP).wake).toBeLessThan(awake.wake);
        const asleep = advance(reactions, 30);
        expect(asleep).toMatchObject({
            wake: 0, heat: 0, sync: 0, settled: true, emitters: [], front: null, figure: null,
        });
        for (const key of ENVELOPES) expect(asleep[key], key).toBe(0);
        // Being told twice changes nothing.
        reactions.onGameOver();
        expect(reactions.getFrame()).toEqual(asleep);
    });

    it.each([
        ['a lock', (r) => r.onPieceLock({ piece: cell(4, 22) })],
        ['a clear', (r) => r.onLineClear(1, {})],
        ['a combo', (r) => r.onCombo(3)],
        ['a perfect clear', (r) => r.onPerfectClear()],
    ])('wakes from being settled with %s of the next game', (_label, act) => {
        const reactions = director();
        reactions.onGameOver();
        expect(reactions.getFrame().settled).toBe(true);
        expect(advance(reactions, 2).settled).toBe(true);
        act(reactions);
        expect(reactions.getFrame().settled).toBe(false);
    });
});

describe('Forest reactions: malformed payloads', () => {
    const JUNK = [undefined, null, 0, -1, NaN, Infinity, '', '   ', 'abc', true, false, [], [3], {}, { detail: null },
        { detail: 7 }, { detail: {} }, { piece: 7 }, { clearedRows: 'all' }, { clearedRows: [{}] }, Symbol('x'), 10n,
        () => 4, { lineCount: {} }, { comboCount: [] }, { viewportOrigin: null },
        { piece: { x: 1, y: 2, shape: 'T' } }];

    it('never throws and never lets a number that is not one into the frame', () => {
        const reactions = director('Low');
        for (const first of JUNK) {
            for (const handler of HANDLERS) {
                expect(() => reactions[handler](first), `${handler}(${String(first)})`).not.toThrow();
                expect(() => reactions[handler](first, first)).not.toThrow();
            }
            expect(() => finiteDeep(reactions.update(STEP))).not.toThrow();
            expectBoundedFrame(reactions.getFrame(), FOREST_REACTION_LIMITS.Low);
        }
        expect(() => finiteDeep(advance(reactions, 20))).not.toThrow();
    });

    it.each([
        [1, 1], [4, 4], [2.9, 2], ['3', 3], [' 2 ', 2], [99, 4], [{ lineCount: 2 }, 2], [{ lines: 3 }, 3],
        [{ linesCleared: 4 }, 4], [{ count: 1 }, 1], [{ detail: { lineCount: 3 } }, 3],
        [{ lineCount: null, lines: 2 }, 2],
    ])('reads the line clear %j as %i lines', (payload, lines) => {
        const reactions = director();
        expect(reactions.onLineClear(payload)).toBe(true);
        const jet = reactions.getFrame().emitters.find((emitter) => emitter.kind === 'clear');
        expect(jet.lines).toBe(lines);
    });

    it.each([
        [0], [-2], [NaN], [Infinity], [''], ['  '], ['two'], [true], [[2]], [{}], [{ lineCount: 0 }],
        [{ lineCount: true }], [{ lineCount: [4] }], [{ lineCount: {} }], [null],
    ])('declines the line clear %j outright', (payload) => {
        const reactions = director();
        const before = reactions.getFrame();
        expect(reactions.onLineClear(payload)).toBe(false);
        expect(reactions.getFrame()).toEqual(before);
        expect(reactions.getFrame().streak).toBe(0);
    });

    it('declines counts that are not numbers at all without trying to convert them', () => {
        const reactions = director();
        const before = reactions.getFrame();
        for (const payload of [10n, Symbol('four'), () => 4, { lineCount: 4n }, { lineCount: Symbol('4') }]) {
            expect(reactions.onLineClear(payload)).toBe(false);
            expect(reactions.onCombo(payload)).toBe(false);
        }
        expect(reactions.getFrame()).toEqual(before);
    });

    it('takes its place from the second argument when the first is a plain count', () => {
        const reactions = director();
        reactions.onLineClear(2, { clearedRows: [5, 6] });
        expect(reactions.getFrame().emitters[0].row).toBeGreaterThan(0.8);
        // The same event as one payload, and wrapped the way a DOM event wraps it.
        const whole = { lineCount: 2, clearedRows: [5, 6] };
        for (const payload of [whole, { detail: whole }]) {
            const other = director();
            other.onLineClear(payload);
            expect(other.getFrame().emitters[0].row).toBe(reactions.getFrame().emitters[0].row);
        }
        // Combos read the same way.
        const combo = director();
        expect(combo.onCombo({ comboCount: 5 })).toBe(true);
        const wrapped = director();
        expect(wrapped.onCombo({ detail: { combo: '5' } })).toBe(true);
        const plain = director();
        expect(plain.onCombo(5, { source: 'odyssey' })).toBe(true);
        const { wake } = advance(plain, 1);
        expect(wake).toBeGreaterThan(0);
        expect(advance(combo, 1).wake).toBe(wake);
        expect(advance(wrapped, 1).wake).toBe(wake);
    });

    it('survives a random source that misbehaves', () => {
        for (const rng of [() => NaN, () => Infinity, () => -5, () => 7, () => '0.5', () => undefined, 'not a function',
            null]) {
            const reactions = new ForestReactions({ quality: 'High', rng });
            reactions.onPieceLock({});
            reactions.onCombo(6);
            reactions.onPerfectClear();
            const frame = reactions.update(STEP);
            expectBoundedFrame(frame, FOREST_REACTION_LIMITS.High);
            for (const emitter of frame.emitters) {
                expect(emitter.seed).toBeGreaterThanOrEqual(0);
                expect(emitter.seed).toBeLessThan(1);
            }
        }
    });
});

describe('Forest reactions: reset, epochs and disposal', () => {
    function busy(reactions) {
        reactions.onHardDrop({ distance: 18 });
        clearingMove(reactions, 4);
        clearingMove(reactions, 4);
        reactions.onCombo(9);
        reactions.onPerfectClear();
        reactions.onLevelUp();
        return advance(reactions, 0.5);
    }

    it('forgets everything on reset and says so by starting a new epoch', () => {
        const reactions = director();
        const fresh = reactions.getFrame();
        const before = busy(reactions);
        expect(before.epoch).toBe(1);
        expect(before.emitters.length).toBeGreaterThan(0);
        reactions.reset();
        const after = reactions.getFrame();
        expect(after).toEqual({ ...fresh, epoch: 2 });
        expect(reactions.time).toBe(0);
        // Serials start over, which is exactly why consumers must watch the epoch.
        reactions.onPieceLock({ piece: cell(1, 22) });
        expect(reactions.getFrame().emitters.map((emitter) => emitter.serial)).toEqual([0]);
        expect(queuedWaves(reactions.getFrame()).map((wave) => wave.serial)).toEqual([0]);
        reactions.onLineClear(4, {});
        expect(reactions.getFrame().figure.serial).toBe(1);
        // Every reset is a new epoch, even one straight after another.
        reactions.reset();
        reactions.reset();
        expect(reactions.getFrame().epoch).toBe(4);
        // The pools are reused, not rebuilt.
        expect(reactions.getFrame().waves).toBe(before.waves);
    });

    it('forgets a pending hard drop and a half-made streak on reset', () => {
        const reactions = director();
        clearingMove(reactions);
        reactions.onHardDrop({ distance: 19 });
        reactions.reset();
        reactions.onPieceLock({ piece: cell(4, 22) });
        expect(reactions.getFrame().emitters.map((emitter) => emitter.kind)).toEqual(['lock']);
        reactions.onLineClear(1, {});
        expect(reactions.getFrame().streak).toBe(1);
        expect(advance(reactions, 1).wake).toBe(0);
    });

    it('plays the same session the same way from the same seed', () => {
        const play = (seed) => {
            const reactions = director('High', seed);
            const frames = [];
            for (let frame = 0; frame < 240; frame++) {
                if (frame % 20 === 0) clearingMove(reactions, 1 + ((frame / 20) % 4), tee(frame % 8, 18));
                if (frame % 45 === 10) reactions.onCombo(2 + frame / 45);
                if (frame === 100) reactions.onTSpin({ piece: tee(2, 12) });
                if (frame === 150) reactions.onPerfectClear();
                frames.push(JSON.stringify(reactions.update(STEP)));
            }
            return frames;
        };
        expect(play(11)).toEqual(play(11));
        expect(play(12)).not.toEqual(play(11));
    });

    it('goes quiet when disposed: every handler declines and the clock stops', () => {
        const reactions = director();
        busy(reactions);
        const { epoch } = reactions.getFrame();
        reactions.dispose();
        expect(reactions.disposed).toBe(true);
        expect(() => reactions.dispose()).not.toThrow();
        const calm = reactions.getFrame();
        expect(calm.emitters).toEqual([]);
        expect(calm).toMatchObject({
            wake: 0, figure: null, front: null, stars: 0, streak: 0,
        });
        for (const key of ENVELOPES) expect(calm[key], key).toBe(0);
        expect(queuedWaves(calm)).toEqual([]);
        // Disposal ends the epoch too, so nothing stale can be replayed from it.
        expect(calm.epoch).toBeGreaterThan(epoch);
        for (const handler of HANDLERS) expect(reactions[handler](4, { clearedRows: [23] }), handler).toBe(false);
        expect(reactions.update(1)).toEqual(calm);
        expect(reactions.time).toBe(0);
        expect(reactions.getFrame()).toEqual(calm);
    });
});
