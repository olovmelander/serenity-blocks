import { describe, expect, it } from 'vitest';
import { FALL_REACTION_LIMITS, FallReactions } from '../../src/themes/fall/fall-reactions.js';

const ENVELOPES = ['gust', 'warmth', 'shafts', 'glow'];
const EMITTER_KINDS = ['lock', 'clear', 'shower', 'combo', 'spin'];
const EMITTER_KEYS = ['active', 'age', 'column', 'duration', 'id', 'kind', 'lines', 'progress', 'row', 'seed',
    'serial', 'side', 'strength'];
const REST_FRAME = Object.freeze({
    gust: 0, warmth: 0, shafts: 0, glow: 0, vortex: 0, heat: 0, streak: 0, front: null, emitters: [],
});
const MALFORMED_COUNTS = [NaN, Infinity, -Infinity, -5, 0, 0.8, '', ' ', 'garbage', null, false, true, [], [4], {},
    { lineCount: [] }, Symbol('count'), 4n];

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create(quality = 'High', seed = 187) {
    return new FallReactions({ quality, rng: seededRandom(seed) });
}

/** Step the director in whole frames and return the frame it ends on. */
function advance(reactions, seconds, fps = 60) {
    const frames = Math.round(seconds * fps);
    for (let frame = 0; frame < frames; frame++) reactions.update(1 / fps);
    return reactions.getFrame();
}

/** One filled cell at board column `x`, board row `y` (rows 4..23 are the visible matrix). */
function cell(x, y) {
    return { x, y, shape: [[1]] };
}

function emittersOf(frame, kind) {
    return frame.emitters.filter((emitter) => emitter.kind === kind);
}

/** Every way a frame can leave its documented ranges, as readable messages. */
function frameProblems(frame, capacity = Infinity) {
    const problems = [];
    const check = (condition, message) => { if (!condition) problems.push(message); };
    const unit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
    for (const key of [...ENVELOPES, 'vortex', 'heat']) check(unit(frame[key]), `${key} = ${String(frame[key])}`);
    check(Number.isInteger(frame.streak) && frame.streak >= 0, `streak = ${String(frame.streak)}`);
    if (frame.front !== null) {
        const { front } = frame;
        check(Object.keys(front).sort().join() === 'direction,position,strength', `front keys ${Object.keys(front)}`);
        check(Number.isFinite(front.position), `front.position = ${front.position}`);
        check(front.direction === 1 || front.direction === -1, `front.direction = ${front.direction}`);
        check(unit(front.strength), `front.strength = ${front.strength}`);
    }
    check(frame.emitters.length <= capacity, `${frame.emitters.length} emitters exceed ${capacity}`);
    check(new Set(frame.emitters.map((emitter) => emitter.id)).size === frame.emitters.length, 'duplicate ids');
    check(
        new Set(frame.emitters.map((emitter) => emitter.serial)).size === frame.emitters.length,
        'duplicate serials',
    );
    for (const emitter of frame.emitters) {
        const label = `emitter ${emitter.id}/${emitter.kind}`;
        check(Object.keys(emitter).sort().join() === EMITTER_KEYS.join(), `${label} keys ${Object.keys(emitter)}`);
        check(emitter.active === true, `${label} inactive`);
        check(EMITTER_KINDS.includes(emitter.kind), `${label} kind`);
        check(Number.isInteger(emitter.id) && emitter.id >= 0 && emitter.id < capacity, `${label} id`);
        check(Number.isInteger(emitter.serial) && emitter.serial >= 0, `${label} serial ${emitter.serial}`);
        check(emitter.duration > 0, `${label} duration ${emitter.duration}`);
        check(emitter.age >= 0 && emitter.age < emitter.duration, `${label} age ${emitter.age}`);
        check(emitter.progress >= 0 && emitter.progress < 1, `${label} progress ${emitter.progress}`);
        check(emitter.strength > 0 && emitter.strength <= 1, `${label} strength ${emitter.strength}`);
        check(emitter.seed >= 0 && emitter.seed < 1, `${label} seed ${emitter.seed}`);
        check(emitter.side === 1 || emitter.side === -1, `${label} side ${emitter.side}`);
        check(unit(emitter.column), `${label} column ${emitter.column}`);
        check(unit(emitter.row), `${label} row ${emitter.row}`);
        check(Number.isInteger(emitter.lines) && emitter.lines >= 0, `${label} lines ${emitter.lines}`);
    }
    return problems;
}

function expectBounded(frame, capacity = Infinity) {
    expect(frameProblems(frame, capacity)).toEqual([]);
}

describe('Fall reaction director', () => {
    describe('budget and frame shape', () => {
        it('uses the required fixed slot budget for every quality tier', () => {
            expect(FALL_REACTION_LIMITS).toEqual({
                Minimal: 4, Low: 6, Medium: 8, High: 12, Ultra: 14, Extreme: 16,
            });
            expect(Object.isFrozen(FALL_REACTION_LIMITS)).toBe(true);
            for (const [quality, capacity] of Object.entries(FALL_REACTION_LIMITS)) {
                const reactions = create(quality);
                reactions.onPieceLock();
                expect(reactions.quality).toBe(quality);
                expect(reactions.maxEmitters).toBe(capacity);
                expect(reactions.emitters).toHaveLength(capacity);
                expect(reactions.emitters.map((emitter) => emitter.id)).toEqual([...Array(capacity).keys()]);
                expect(reactions.frame.emitters).toHaveLength(1);
                expectBounded(reactions.frame, capacity);
            }
        });

        it('normalises tier names and falls back to High for anything else', () => {
            expect(create('low').quality).toBe('Low');
            expect(create('EXTREME').quality).toBe('Extreme');
            expect(create('minimal').quality).toBe('Minimal');
            expect(create('Med').quality).toBe('Medium');
            expect(create('medium').quality).toBe('Medium');
            for (const quality of ['invalid', '', undefined, null, 42, {}, ['Low']]) {
                const reactions = new FallReactions({ quality, rng: seededRandom() });
                expect(reactions.quality).toBe('High');
                expect(reactions.maxEmitters).toBe(FALL_REACTION_LIMITS.High);
            }
            expect(new FallReactions().quality).toBe('High');
        });

        it('starts at rest and reports the documented frame shape', () => {
            const reactions = create();
            expect(reactions.getFrame()).toEqual(REST_FRAME);
            expect(reactions.frame).toEqual(REST_FRAME);
            reactions.onPieceLock({ piece: cell(2, 20) });
            reactions.onLineClear(4);
            const frame = reactions.update(0.1);
            expect(Object.keys(frame).sort()).toEqual(Object.keys(REST_FRAME).sort());
            expect(frame).toEqual(reactions.frame);
            expect(frame.emitters.length).toBeGreaterThan(0);
            expectBounded(frame, reactions.maxEmitters);
        });
    });

    describe('piece locks', () => {
        it('keeps locks gentle and reserves shafts, fronts and the vortex for achievements', () => {
            const lock = create();
            const clear = create();
            expect(lock.onPieceLock()).toBe(true);
            clear.onLineClear(1);
            expect(lock.frame.emitters).toHaveLength(1);
            expect(lock.frame.emitters[0]).toMatchObject({
                kind: 'lock', age: 0, progress: 0, lines: 0, id: 0, serial: 0,
            });
            expect(lock.frame.gust).toBeGreaterThan(0);
            for (const key of ENVELOPES) expect(lock.frame[key]).toBeLessThan(clear.frame[key]);
            expect(lock.frame.emitters[0].strength).toBeLessThan(clear.frame.emitters[0].strength);
            expect(lock.frame.shafts).toBe(0);
            expect(lock.frame.front).toBeNull();
            expect(advance(lock, 0.5)).toMatchObject({ vortex: 0, heat: 0, streak: 0 });
        });

        it('places the puff beside the piece, mapping the visible rows 4..23 from top to foot', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(0, 23) });
            reactions.onPieceLock({ piece: cell(9, 4) });
            reactions.onPieceLock({ piece: { x: 6, y: 13, shape: [[1], [1]] } });
            const [bottomLeft, topRight, middle] = reactions.frame.emitters;
            expect(bottomLeft.side).toBe(-1);
            expect(bottomLeft.column).toBeCloseTo(0.05, 10);
            expect(bottomLeft.row).toBeCloseTo(0.025, 10);
            expect(topRight.side).toBe(1);
            expect(topRight.column).toBeCloseTo(0.95, 10);
            expect(topRight.row).toBeCloseTo(0.975, 10);
            // Two cells straddling the middle of the 20 visible rows.
            expect(middle.row).toBeCloseTo(0.5, 10);
            expect(middle.side).toBe(1);

            // The column at exactly half way belongs to the right edge.
            const centred = create();
            centred.onPieceLock({ piece: { x: 4, y: 20, shape: [[1, 1], [1, 1]] } });
            expect(centred.frame.emitters[0].column).toBeCloseTo(0.5, 10);
            expect(centred.frame.emitters[0].side).toBe(1);
        });

        it('uses the centroid of the filled cells rather than the bounding-box origin', () => {
            const reactions = create();
            // A T piece: cells (4,20) (3,21) (4,21) (5,21).
            reactions.onPieceLock({ piece: { x: 3, y: 20, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] } });
            // A vertical I whose box starts in the left half but whose cells are right of centre.
            reactions.onPieceLock({
                piece: {
                    x: 3, y: 18, shape: [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
                },
            });
            // No usable shape: fall back to the origin cell.
            reactions.onPieceLock({ piece: { x: 2, y: 20 } });
            reactions.onPieceLock({ piece: { x: 7, y: 20, shape: 'T' } });
            reactions.onPieceLock({ piece: { x: 7, y: 20, shape: [[0, 0], 'junk', null] } });
            const [tee, bar, bare, text, empty] = reactions.frame.emitters;
            expect(tee.column).toBeCloseTo(0.45, 10);
            expect(tee.row).toBeCloseTo(1 - (21.25 - 4) / 20, 10);
            expect(tee.side).toBe(-1);
            expect(bar.column).toBeCloseTo(0.55, 10);
            expect(bar.row).toBeCloseTo(1 - (20 - 4) / 20, 10);
            expect(bar.side).toBe(1);
            expect(bare).toMatchObject({ side: -1, column: 0.25 });
            expect(text).toMatchObject({ side: 1, column: 0.75 });
            expect(empty).toMatchObject({ side: 1, column: 0.75 });
        });

        it('clamps pieces outside the visible matrix onto the card', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(4, 0) });
            reactions.onPieceLock({ piece: cell(4, 60) });
            reactions.onPieceLock({ piece: cell(-100, 20) });
            reactions.onPieceLock({ piece: cell(100, 20) });
            const [hidden, below, farLeft, farRight] = reactions.frame.emitters;
            expect(hidden.row).toBe(1);
            expect(below.row).toBe(0);
            expect(farLeft).toMatchObject({ column: 0, side: -1 });
            expect(farRight).toMatchObject({ column: 1, side: 1 });
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('prefers a complete viewport origin over the piece and ignores malformed origins', () => {
            const reactions = create();
            // Screen fractions, y down: a quarter from the top is three quarters up the card.
            reactions.onPieceLock({ viewportOrigin: { x: 0.1, y: 0.25 }, piece: cell(9, 23) });
            reactions.onPieceLock({ detail: { viewportOrigin: { x: 5, y: -3 } } });
            reactions.onPieceLock({ viewportOrigin: { x: 0.1 }, piece: cell(9, 23) });
            reactions.onPieceLock({ viewportOrigin: { x: NaN, y: 0.5 }, piece: cell(0, 4) });
            reactions.onPieceLock({ viewportOrigin: 'left', piece: cell(0, 4) });
            const [origin, clamped, noY, notFinite, text] = reactions.frame.emitters;
            expect(origin).toMatchObject({ side: -1, column: 0.1, row: 0.75 });
            expect(clamped).toMatchObject({ side: 1, column: 1, row: 1 });
            expect(noY.side).toBe(1);
            expect(noY.column).toBeCloseTo(0.95, 10);
            expect(noY.row).toBeCloseTo(0.025, 10);
            for (const fallback of [notFinite, text]) {
                expect(fallback.side).toBe(-1);
                expect(fallback.column).toBeCloseTo(0.05, 10);
                expect(fallback.row).toBeCloseTo(0.975, 10);
            }
        });

        it('alternates sides around the middle of the card when a lock cannot be placed', () => {
            const reactions = create();
            const payloads = [undefined, null, {}, 'lock', 7, { piece: null }, { piece: { x: Infinity, y: 2 } },
                { piece: { x: 3 } }, { viewportOrigin: { x: NaN, y: NaN }, piece: { y: 4 } }];
            for (const payload of payloads) expect(reactions.onPieceLock(payload)).toBe(true);
            const { emitters } = reactions.frame;
            expect(emitters).toHaveLength(payloads.length);
            emitters.forEach((emitter, index) => {
                expect(emitter.kind).toBe('lock');
                expect(emitter.column).toBe(0.5);
                expect(emitter.side).toBe(index % 2 === 0 ? -1 : 1);
                expect(emitter.row).toBe(emitters[0].row);
            });
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('lets a hard drop strengthen the lock that follows it, and only that one', () => {
            const piece = cell(2, 22);
            const plain = create();
            plain.onPieceLock({ piece });
            const dropped = create();
            expect(dropped.onHardDrop({
                piece, startY: 2, endY: 18, distance: 16,
            })).toBe(true);
            // The drop itself is silent; it only loads the next lock.
            expect(dropped.frame).toEqual(REST_FRAME);
            dropped.onPieceLock({ piece });
            const [soft] = plain.frame.emitters;
            const [hard] = dropped.frame.emitters;
            expect(hard.strength).toBeGreaterThan(soft.strength);
            expect(hard).toMatchObject({
                kind: 'lock', side: soft.side, column: soft.column, row: soft.row, duration: soft.duration,
            });
            for (const key of ['gust', 'warmth', 'glow']) {
                expect(dropped.frame[key]).toBeGreaterThan(plain.frame[key]);
            }
            expect(dropped.frame.shafts).toBe(0);
            dropped.onPieceLock({ piece });
            expect(dropped.frame.emitters[1].strength).toBe(soft.strength);
            expectBounded(dropped.frame, dropped.maxEmitters);
        });

        it('scales the drop by its length, reads startY/endY, and ignores malformed drops', () => {
            const strengthAfter = (drop) => {
                const reactions = create();
                reactions.onHardDrop(drop);
                reactions.onPieceLock({ piece: cell(2, 22) });
                expectBounded(reactions.frame, reactions.maxEmitters);
                return reactions.frame.emitters[0].strength;
            };
            const gentle = strengthAfter(undefined);
            expect(strengthAfter({ distance: 0 })).toBe(gentle);
            expect(strengthAfter({ distance: 4 })).toBeGreaterThan(gentle);
            expect(strengthAfter({ distance: 16 })).toBeGreaterThan(strengthAfter({ distance: 4 }));
            expect(strengthAfter({ startY: 2, endY: 18 })).toBe(strengthAfter({ distance: 16 }));
            expect(strengthAfter({ detail: { distance: 16 } })).toBe(strengthAfter({ distance: 16 }));
            // A drop longer than the board is still one full-strength thump.
            expect(strengthAfter({ distance: 1e9 })).toBe(strengthAfter({ distance: 500 }));
            expect(strengthAfter({ distance: 1e9 })).toBeGreaterThanOrEqual(strengthAfter({ distance: 16 }));
            for (const drop of [null, {}, 'far', 12, { distance: NaN }, { distance: 'far' }, { distance: -4 },
                { startY: 'a', endY: 5 }, { startY: 18, endY: 2 }, { distance: Infinity }]) {
                expect(strengthAfter(drop)).toBe(gentle);
            }
        });
    });

    describe('line clears', () => {
        it('blows twin jets out of both sides at the height of the cleared rows', () => {
            const single = create();
            const tetris = create();
            expect(single.onLineClear(1, { clearedRows: [23] })).toBe(true);
            expect(tetris.onLineClear(4, { clearedRows: [20, 21, 22, 23] })).toBe(true);
            expect(single.frame.emitters.map((emitter) => emitter.kind)).toEqual(['clear', 'clear']);
            expect(single.frame.emitters.map((emitter) => emitter.side)).toEqual([-1, 1]);
            for (const emitter of single.frame.emitters) {
                expect(emitter.row).toBeCloseTo(0.025, 10);
                expect(emitter).toMatchObject({ lines: 1, age: 0 });
            }
            const jets = emittersOf(tetris.frame, 'clear');
            expect(jets.map((emitter) => emitter.side)).toEqual([-1, 1]);
            for (const emitter of jets) {
                expect(emitter.row).toBeCloseTo(0.1, 10);
                expect(emitter.lines).toBe(4);
            }
            // Both sides answer identically apart from the side and their identity.
            const strip = ({
                id, serial, side, seed, ...rest
            }) => rest;
            expect(strip(jets[0])).toEqual(strip(jets[1]));
            // The top visible row sits just under the top of the card.
            const top = create();
            top.onLineClear(1, { clearedRows: [4] });
            expect(top.frame.emitters[0].row).toBeCloseTo(0.975, 10);
            expectBounded(tetris.frame, tetris.maxEmitters);
        });

        it('adds a gust front from two lines and a canopy shower only for four', () => {
            const frames = [1, 2, 3, 4].map((lines) => {
                const reactions = create();
                reactions.onLineClear(lines);
                expectBounded(reactions.frame, reactions.maxEmitters);
                return { struck: reactions.frame, later: advance(reactions, 0.4) };
            });
            expect(frames.map(({ struck }) => struck.front !== null)).toEqual([false, true, true, true]);
            expect(frames.map(({ struck }) => emittersOf(struck, 'shower').length)).toEqual([0, 0, 0, 1]);
            expect(frames.map(({ struck }) => emittersOf(struck, 'clear').length)).toEqual([2, 2, 2, 2]);
            expect(frames.map(({ struck }) => struck.emitters.length)).toEqual([2, 2, 2, 3]);
            expect(frames[3].struck.emitters[2]).toMatchObject({ kind: 'shower', lines: 4 });
            for (let index = 1; index < frames.length; index++) {
                const { struck, later } = frames[index];
                const previous = frames[index - 1];
                for (const key of ENVELOPES) expect(struck[key]).toBeGreaterThan(previous.struck[key]);
                expect(struck.emitters[0].strength).toBeGreaterThan(previous.struck.emitters[0].strength);
                expect(struck.emitters[0].duration).toBeGreaterThanOrEqual(previous.struck.emitters[0].duration);
                expect(struck.emitters[0].lines).toBe(index + 1);
                if (index > 1) expect(later.front.strength).toBeGreaterThan(previous.later.front.strength);
            }
            // A clear on its own neither starts a streak vortex nor heats the leaves.
            for (const { later } of frames) expect(later).toMatchObject({ vortex: 0, heat: 0, streak: 1 });
        });

        it('falls back from cleared rows to the viewport origin, then to a default height', () => {
            const rowOf = (...args) => {
                const reactions = create();
                reactions.onLineClear(...args);
                const [left, right] = reactions.frame.emitters;
                expect(left.row).toBe(right.row);
                expectBounded(reactions.frame, reactions.maxEmitters);
                return left.row;
            };
            const origin = { x: 0.5, y: 0.25 };
            const fallback = rowOf(2);
            expect(rowOf(2, { clearedRows: [10, 11], viewportOrigin: origin })).toBeCloseTo(0.65, 10);
            // Infinity mode reports absolute rows far beyond a standard board.
            expect(rowOf(1, { clearedRows: [412], viewportOrigin: origin })).toBe(0.75);
            expect(rowOf(1, { clearedRows: [-50], viewportOrigin: origin })).toBe(0.75);
            expect(rowOf(1, { clearedRows: [], viewportOrigin: origin })).toBe(0.75);
            expect(rowOf(1, { clearedRows: ['a', NaN, null, undefined], viewportOrigin: origin })).toBe(0.75);
            expect(rowOf(1, { clearedRows: 'rows', viewportOrigin: origin })).toBe(0.75);
            // Non-finite entries are dropped before averaging.
            expect(rowOf(1, { clearedRows: [NaN, 23, 'x'] })).toBeCloseTo(0.025, 10);
            expect(rowOf(1, { clearedRows: [412] })).toBe(fallback);
            expect(rowOf(1, {})).toBe(fallback);
            expect(rowOf(1, null)).toBe(fallback);
        });

        it('sends each front across the view in its direction and then retires it', () => {
            const reactions = create();
            reactions.onLineClear(2);
            const start = reactions.frame.front;
            const { direction } = start;
            expect([-1, 1]).toContain(direction);
            expect(start.strength).toBeCloseTo(0, 10);
            let along = start.position * direction;
            expect(along).toBeLessThan(0);
            let peak = 0;
            let frames = 0;
            while (reactions.update(1 / 60).front !== null && frames < 60 * 20) {
                const { front } = reactions.frame;
                expect(front.direction).toBe(direction);
                expect(front.position * direction).toBeGreaterThan(along);
                along = front.position * direction;
                peak = Math.max(peak, front.strength);
                expectBounded(reactions.frame, reactions.maxEmitters);
                frames += 1;
            }
            expect(frames).toBeGreaterThan(10);
            expect(reactions.frame.front).toBeNull();
            expect(along).toBeGreaterThan(0);
            expect(peak).toBeGreaterThan(0);
        });

        it('alternates the direction of successive fronts and restarts each one upwind', () => {
            const reactions = create();
            reactions.onLineClear(2);
            const first = advance(reactions, 0.3).front;
            reactions.onLineClear(3);
            const second = reactions.frame.front;
            reactions.onLevelUp();
            const third = reactions.frame.front;
            expect(second.direction).toBe(-first.direction);
            expect(third.direction).toBe(first.direction);
            for (const front of [second, third]) {
                expect(front.position * front.direction).toBeLessThan(0);
                expect(front.position * front.direction).toBeLessThan(first.position * first.direction);
            }
        });
    });

    describe('streaks, the vortex and heat', () => {
        it('builds a streak from consecutive clearing locks and ends it with a lock that clears nothing', () => {
            const reactions = create();
            const clearingLock = (lines = 1) => {
                reactions.onPieceLock();
                reactions.onLineClear(lines);
                return reactions.frame.streak;
            };
            expect(clearingLock()).toBe(1);
            // Cascade waves after one lock belong to the same step of the streak.
            reactions.onLineClear(1);
            reactions.onLineClear(3);
            expect(reactions.frame.streak).toBe(1);
            expect(clearingLock(2)).toBe(2);
            expect(clearingLock()).toBe(3);
            // This piece may still clear: the streak is only judged at the next lock.
            reactions.onPieceLock();
            expect(reactions.frame.streak).toBe(3);
            reactions.onPieceLock();
            expect(reactions.frame.streak).toBe(0);
            reactions.onPieceLock();
            expect(reactions.frame.streak).toBe(0);
            expect(clearingLock()).toBe(1);
            expect(clearingLock()).toBe(2);
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('counts a clear that arrives before any lock as the first step', () => {
            const reactions = create();
            reactions.onLineClear(1);
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(1);
            reactions.onPieceLock();
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(2);
        });

        it('winds the vortex higher the longer the streak runs', () => {
            const woundAfter = (streak) => {
                const reactions = create();
                for (let lock = 0; lock < streak; lock++) {
                    reactions.onPieceLock();
                    reactions.onLineClear(1);
                }
                expect(reactions.frame.streak).toBe(streak);
                // Nothing snaps: the column winds up over the following frames.
                expect(reactions.frame.vortex).toBe(0);
                const frame = advance(reactions, 1);
                expectBounded(frame, reactions.maxEmitters);
                return frame;
            };
            const frames = [1, 2, 3, 5, 9, 16].map(woundAfter);
            expect(frames[0].vortex).toBe(0);
            for (let index = 1; index < frames.length; index++) {
                expect(frames[index].vortex).toBeGreaterThan(frames[index - 1].vortex);
                expect(frames[index].heat).toBeGreaterThanOrEqual(frames[index - 1].heat);
            }
            // Embers belong to long streaks only.
            expect(frames[1].heat).toBe(0);
            expect(frames.at(-1).heat).toBeGreaterThan(0);
        });

        it('holds the vortex while it winds, then unwinds it to rest with the heat gone first', () => {
            const reactions = create();
            reactions.onCombo(60);
            expect(reactions.frame.vortex).toBe(0);
            const samples = [];
            for (let frame = 0; frame < 60 * 60 && (frame < 30 || reactions.frame.vortex > 0); frame++) {
                const { vortex, heat } = reactions.update(1 / 60);
                samples.push({ vortex, heat });
            }
            expect(samples.at(-1)).toEqual({ vortex: 0, heat: 0 });
            const peak = Math.max(...samples.map((sample) => sample.vortex));
            const peakIndex = samples.findIndex((sample) => sample.vortex === peak);
            expect(peak).toBeGreaterThan(0);
            expect(peak).toBeLessThanOrEqual(1);
            // It keeps climbing for a while instead of spiking and falling straight away.
            expect(peakIndex).toBeGreaterThan(15);
            for (let index = 1; index < samples.length; index++) {
                const delta = samples[index].vortex - samples[index - 1].vortex;
                if (index <= peakIndex) expect(delta).toBeGreaterThanOrEqual(0);
                else expect(delta).toBeLessThanOrEqual(0);
                expect(samples[index].heat).toBeGreaterThanOrEqual(0);
                expect(samples[index].heat).toBeLessThanOrEqual(1);
                // Heat is a function of the vortex alone: it can only follow it up and down.
                if (samples[index].vortex > samples[index - 1].vortex) {
                    expect(samples[index].heat).toBeGreaterThanOrEqual(samples[index - 1].heat);
                } else expect(samples[index].heat).toBeLessThanOrEqual(samples[index - 1].heat);
            }
            // Embers: nothing while the column is still low, something at its height.
            expect(samples[0].vortex).toBeGreaterThan(0);
            expect(samples[0].heat).toBe(0);
            expect(samples[peakIndex].heat).toBeGreaterThan(0);
            const lastWarm = samples.findLastIndex((sample) => sample.heat > 0);
            const lastTurning = samples.findLastIndex((sample) => sample.vortex > 0);
            expect(lastWarm).toBeLessThan(lastTurning);
        });

        it('never heats a vortex that stays low', () => {
            const reactions = create();
            reactions.onCombo(2);
            let peak = 0;
            for (let frame = 0; frame < 60 * 8; frame++) {
                const { vortex, heat } = reactions.update(1 / 60);
                peak = Math.max(peak, vortex);
                expect(heat).toBe(0);
            }
            expect(peak).toBeGreaterThan(0);
        });

        it('keeps the vortex up while clears keep coming and keeps the highest target', () => {
            const fed = create();
            const starved = create();
            fed.onCombo(12);
            starved.onCombo(12);
            const early = advance(fed, 1).vortex;
            advance(starved, 1);
            for (let second = 0; second < 9; second++) {
                fed.onCombo(12);
                advance(fed, 1);
                advance(starved, 1);
            }
            expect(fed.frame.vortex).toBeGreaterThanOrEqual(early);
            expect(fed.frame.vortex).toBeGreaterThan(starved.frame.vortex);

            // A smaller event during the hold never lowers the column.
            const big = create();
            const mixed = create();
            big.onCombo(20);
            mixed.onCombo(20);
            mixed.onCombo(2);
            mixed.onBackToBack();
            expect(advance(mixed, 1).vortex).toBeCloseTo(advance(big, 1).vortex, 12);
        });
    });

    describe('combos', () => {
        it('makes combo two distinct and keeps growing beyond combo seven', () => {
            const frames = [2, 3, 7, 8, 14, 60].map((count) => {
                const reactions = create();
                expect(reactions.onCombo(count)).toBe(true);
                const struck = reactions.frame;
                expect(struck.emitters).toHaveLength(1);
                expect(struck.emitters[0]).toMatchObject({ kind: 'combo', lines: count, age: 0 });
                expectBounded(struck, reactions.maxEmitters);
                return { struck, wound: advance(reactions, 0.5) };
            });
            expect(frames[0].wound.vortex).toBeGreaterThan(0);
            for (const key of ENVELOPES) expect(frames[0].struck[key]).toBeGreaterThan(0);
            for (let index = 1; index < frames.length; index++) {
                const { struck, wound } = frames[index];
                const previous = frames[index - 1];
                for (const key of ENVELOPES) expect(struck[key]).toBeGreaterThan(previous.struck[key]);
                expect(struck.emitters[0].strength).toBeGreaterThan(previous.struck.emitters[0].strength);
                expect(wound.vortex).toBeGreaterThan(previous.wound.vortex);
                expectBounded(wound, FALL_REACTION_LIMITS.High);
            }
        });

        it('ignores zero and single combos without disturbing an existing clear response', () => {
            const reactions = create();
            reactions.onLineClear(2);
            const before = reactions.frame;
            for (const count of [0, 1, '0', '1', 1.99, undefined]) expect(reactions.onCombo(count)).toBe(false);
            expect(reactions.onCombo()).toBe(false);
            expect(reactions.frame).toEqual(before);
            expect(advance(reactions, 0.5).vortex).toBe(0);
        });
    });

    describe('payload hygiene', () => {
        it('rejects malformed counts without throwing or exciting envelopes', () => {
            const reactions = create();
            for (const count of MALFORMED_COUNTS) {
                expect(reactions.onLineClear(count)).toBe(false);
                expect(reactions.onCombo(count)).toBe(false);
                expect(reactions.onLineClear(count, { clearedRows: [22, 23] })).toBe(false);
                expect(reactions.onCombo(count, { comboCount: 9 })).toBe(false);
            }
            expect(reactions.frame).toEqual(REST_FRAME);
            // Nothing was consumed either: the first real event still gets slot and serial zero.
            reactions.onPieceLock();
            expect(reactions.frame.emitters[0]).toMatchObject({ id: 0, serial: 0 });
        });

        it('leaves a live frame untouched when a malformed count arrives mid-celebration', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(1, 22) });
            reactions.onLineClear(4);
            reactions.onCombo(6);
            const before = advance(reactions, 0.2);
            for (const count of MALFORMED_COUNTS) {
                expect(reactions.onLineClear(count)).toBe(false);
                expect(reactions.onCombo(count)).toBe(false);
            }
            expect(reactions.frame).toEqual(before);
        });

        it('accepts wrapped bus payloads and numeric strings while capping oversized counts', () => {
            const origin = { x: 0.2, y: 0.35 };
            const fromPayload = create();
            const fromCount = create();
            fromPayload.onLineClear({ detail: { lineCount: '999', viewportOrigin: origin } });
            fromPayload.onCombo({ detail: { comboCount: '999', viewportOrigin: origin } });
            fromCount.onLineClear(4, { viewportOrigin: origin });
            fromCount.onCombo(60, { viewportOrigin: origin });
            expect(fromPayload.frame).toEqual(fromCount.frame);
            expect(emittersOf(fromPayload.frame, 'clear')[0]).toMatchObject({ lines: 4, row: 0.65 });
            expect(emittersOf(fromPayload.frame, 'combo')[0].lines).toBe(60);
            expectBounded(fromPayload.frame, fromPayload.maxEmitters);
        });

        it('reads every count alias and unwraps a detail envelope in either argument', () => {
            const frameOf = (run) => {
                const reactions = create();
                run(reactions);
                return reactions.frame;
            };
            const rows = { clearedRows: [22, 23] };
            const clear = frameOf((reactions) => reactions.onLineClear(2, rows));
            expect(clear.emitters[0].row).toBeCloseTo(0.05, 10);
            for (const payload of [{ lineCount: 2, ...rows }, { lines: 2, ...rows }, { linesCleared: '2', ...rows },
                { count: 2.9, ...rows }, { detail: { lines: 2, ...rows } }, { lineCount: null, lines: 2, ...rows }]) {
                expect(frameOf((reactions) => reactions.onLineClear(payload))).toEqual(clear);
            }
            expect(frameOf((reactions) => reactions.onLineClear(2, { detail: rows }))).toEqual(clear);
            // The first alias present wins, even over a later, larger one.
            expect(frameOf((reactions) => reactions.onLineClear({ lineCount: 2, count: 4, ...rows }))).toEqual(clear);

            const combo = frameOf((reactions) => reactions.onCombo(5));
            for (const payload of [{ comboCount: 5 }, { combo: '5' }, { count: 5.5 }, { detail: { combo: 5 } }]) {
                expect(frameOf((reactions) => reactions.onCombo(payload))).toEqual(combo);
            }

            const piece = cell(8, 10);
            const lock = frameOf((reactions) => reactions.onPieceLock({ piece }));
            expect(frameOf((reactions) => reactions.onPieceLock({ detail: { piece } }))).toEqual(lock);
            const spin = frameOf((reactions) => reactions.onTSpin({ piece }));
            expect(frameOf((reactions) => reactions.onTSpin({ detail: { piece } }))).toEqual(spin);
        });

        it('counts a bare call as one line, as the bus adapter does for an unknown payload', () => {
            const bare = create();
            const one = create();
            expect(bare.onLineClear()).toBe(true);
            one.onLineClear(1);
            expect(bare.frame).toEqual(one.frame);
        });
    });

    describe('flourishes', () => {
        it('answers a t-spin with a spiral beside the piece', () => {
            const reactions = create();
            expect(reactions.onTSpin({ piece: cell(8, 10) })).toBe(true);
            expect(reactions.onTSpin({ piece: cell(1, 22) })).toBe(true);
            expect(reactions.onTSpin({ lineCount: 2 })).toBe(true);
            expect(reactions.onTSpin()).toBe(true);
            const [right, left, unplaced, bare] = reactions.frame.emitters;
            expect(right).toMatchObject({ kind: 'spin', side: 1, age: 0 });
            expect(right.row).toBeCloseTo(1 - (10.5 - 4) / 20, 10);
            expect(left).toMatchObject({ kind: 'spin', side: -1 });
            expect(left.row).toBeCloseTo(0.075, 10);
            expect(unplaced.kind).toBe('spin');
            expect(bare).toMatchObject({ kind: 'spin', side: unplaced.side, row: unplaced.row });
            for (const key of ENVELOPES) expect(reactions.frame[key]).toBeGreaterThan(0);
            expect(reactions.frame.front).toBeNull();
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('lets a back-to-back warm the light and wind the vortex without throwing leaves', () => {
            const reactions = create();
            expect(reactions.onBackToBack({ active: true })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([]);
            expect(frame.front).toBeNull();
            for (const key of ['warmth', 'shafts', 'glow']) expect(frame[key]).toBeGreaterThan(0);
            expect(frame.gust).toBe(0);
            expect(advance(reactions, 0.5).vortex).toBeGreaterThan(0);
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('makes the whole grove exhale on a perfect clear', () => {
            const perfect = create();
            const tetris = create();
            expect(perfect.onPerfectClear({ depth: 4 })).toBe(true);
            tetris.onLineClear(4);
            const { frame } = perfect;
            expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(['shower']);
            expect(frame.front).not.toBeNull();
            for (const key of ENVELOPES) expect(frame[key]).toBeGreaterThanOrEqual(tetris.frame[key]);
            const shower = emittersOf(tetris.frame, 'shower')[0];
            expect(frame.emitters[0].strength).toBeGreaterThanOrEqual(shower.strength);
            expect(frame.emitters[0].duration).toBeGreaterThanOrEqual(shower.duration);
            const wound = advance(perfect, 0.5);
            expect(wound.vortex).toBeGreaterThan(0);
            expect(wound.front.strength).toBeGreaterThan(0);
            expectBounded(wound, perfect.maxEmitters);
        });

        it('sweeps a front through the forest on a level up without spending an emitter', () => {
            const reactions = create();
            expect(reactions.onLevelUp({ level: 3 })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([]);
            expect(frame.front).not.toBeNull();
            for (const key of ENVELOPES) expect(frame[key]).toBeGreaterThan(0);
            expect(advance(reactions, 0.5)).toMatchObject({ vortex: 0, heat: 0 });
        });

        it('lets the wind die at game over without cutting the leaves already in flight', () => {
            const build = () => {
                const reactions = create();
                for (let lock = 0; lock < 2; lock++) {
                    reactions.onPieceLock({ piece: cell(1, 22) });
                    reactions.onLineClear(4);
                }
                reactions.onCombo(20);
                advance(reactions, 0.5);
                return reactions;
            };
            const ended = build();
            const playing = build();
            const before = ended.frame;
            expect(before.vortex).toBeGreaterThan(0);
            expect(before.front).not.toBeNull();
            expect(before.streak).toBe(2);
            expect(before.emitters.length).toBeGreaterThan(0);
            ended.onGameOver();
            // Only the wind is released; light and emitters finish on their own.
            expect(ended.frame).toEqual({ ...before, streak: 0, front: null });
            expect(ended.vortexTarget).toBe(0);
            let previous = before.vortex;
            expect(playing.update(1 / 60).vortex).toBeGreaterThanOrEqual(before.vortex);
            for (let frame = 0; frame < 60 * 60 && previous > 0; frame++) {
                const { vortex, front } = ended.update(1 / 60);
                expect(vortex).toBeLessThan(previous);
                expect(front).toBeNull();
                previous = vortex;
            }
            expect(previous).toBe(0);
            expect(ended.frame.heat).toBe(0);
            // A new game starts a new streak from nothing.
            ended.onPieceLock();
            ended.onLineClear(1);
            expect(ended.frame.streak).toBe(1);
        });
    });

    describe('time', () => {
        it('advances envelopes, the vortex, fronts and emitter ages identically at 30, 60 and 144 Hz', () => {
            const frames = [30, 60, 144].map((fps) => {
                const reactions = create();
                // A third of a second is a whole number of frames at every rate.
                const third = () => { for (let frame = 0; frame < fps / 3; frame++) reactions.update(1 / fps); };
                reactions.onHardDrop({ distance: 12 });
                reactions.onPieceLock({ piece: cell(1, 22) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                third();
                reactions.onPieceLock({ piece: cell(8, 21) });
                reactions.onLineClear(2, { clearedRows: [22, 23] });
                reactions.onCombo(8);
                reactions.onTSpin({ piece: cell(8, 21) });
                third();
                expect(reactions.time).toBeCloseTo(2 / 3, 10);
                return reactions.getFrame();
            });
            const reference = frames[0];
            expect(reference.emitters.length).toBeGreaterThanOrEqual(8);
            expect(reference.vortex).toBeGreaterThan(0);
            expect(reference.front).not.toBeNull();
            for (const frame of frames.slice(1)) {
                for (const key of [...ENVELOPES, 'vortex', 'heat']) {
                    expect(frame[key]).toBeCloseTo(reference[key], 10);
                }
                expect(frame.streak).toBe(reference.streak);
                expect(frame.front.direction).toBe(reference.front.direction);
                expect(frame.front.position).toBeCloseTo(reference.front.position, 10);
                expect(frame.front.strength).toBeCloseTo(reference.front.strength, 10);
                expect(frame.emitters.map((emitter) => emitter.id))
                    .toEqual(reference.emitters.map((emitter) => emitter.id));
                frame.emitters.forEach((emitter, index) => {
                    const expected = reference.emitters[index];
                    expect(emitter.age).toBeCloseTo(expected.age, 10);
                    expect(emitter.progress).toBeCloseTo(expected.progress, 10);
                    const { age, progress, ...fixed } = emitter;
                    expect(expected).toMatchObject(fixed);
                });
            }
        });

        it('unwinds the vortex at the same pace whatever the frame rate', () => {
            const vortexAt = (fps, seconds) => {
                const reactions = create();
                reactions.onCombo(20);
                return advance(reactions, seconds, fps).vortex;
            };
            for (const seconds of [1, 4, 6]) {
                const samples = [30, 60, 144].map((fps) => vortexAt(fps, seconds));
                // The hold ends on a frame boundary, so the release may start one frame apart.
                expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.05);
            }
            expect(vortexAt(60, 6)).toBeLessThan(vortexAt(60, 1));
        });

        it('decays every envelope exponentially per second', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const start = reactions.frame;
            const half = advance(reactions, 0.5);
            const whole = advance(reactions, 0.5);
            for (const key of ENVELOPES) {
                expect(half[key]).toBeLessThan(start[key]);
                expect(whole[key]).toBeLessThan(half[key]);
                // Equal spans of time shed equal fractions.
                expect(whole[key] / half[key]).toBeCloseTo(half[key] / start[key], 8);
            }
            const settled = advance(reactions, 120, 4);
            for (const key of ENVELOPES) expect(settled[key]).toBe(0);
        });

        it('ignores invalid or negative timesteps and only advances on explicit simulation updates', () => {
            const reactions = create();
            reactions.onLineClear(4);
            reactions.onCombo(10);
            const before = reactions.frame;
            for (const dt of [NaN, Infinity, -Infinity, -1, 0, null, undefined, '0.5', [], {}, Symbol('dt')]) {
                expect(reactions.update(dt)).toEqual(before);
            }
            expect(reactions.time).toBe(0);
            expect(reactions.frame).toEqual(before);
            reactions.update(0.25);
            expect(reactions.time).toBe(0.25);
            expect(reactions.frame.emitters.every((emitter) => emitter.age === 0.25)).toBe(true);
            for (let second = 0; second < 30; second++) reactions.update(1);
            expect(reactions.time).toBe(30.25);
            expect(reactions.frame.emitters).toHaveLength(0);
            expect(reactions.frame.front).toBeNull();
        });
    });

    describe('emitter slots', () => {
        it('keeps event storms bounded and reuses every preallocated slot', () => {
            for (const quality of Object.keys(FALL_REACTION_LIMITS)) {
                const reactions = create(quality);
                const storage = reactions.emitters;
                const slots = [...storage];
                const { envelopes } = reactions;
                const seen = new Set();
                for (let event = 0; event < 100; event++) {
                    reactions.onHardDrop({ distance: event % 21 });
                    reactions.onPieceLock({ piece: cell(event % 10, 4 + (event % 20)) });
                    reactions.onLineClear(1 + (event % 4), { clearedRows: [23 - (event % 20)] });
                    reactions.onCombo(60);
                    if (event % 3 === 0) reactions.onTSpin();
                    if (event % 7 === 0) reactions.onPerfectClear();
                    if (event % 11 === 0) reactions.onLevelUp();
                    if (event % 13 === 0) reactions.onBackToBack();
                    if (event % 5 === 0) reactions.update(0.016);
                    const { frame } = reactions;
                    expect(frame.emitters.length).toBeLessThanOrEqual(reactions.maxEmitters);
                    expectBounded(frame, reactions.maxEmitters);
                    frame.emitters.forEach((emitter) => seen.add(emitter.id));
                }
                expect(seen.size).toBe(reactions.maxEmitters);
                expect(reactions.frame.emitters).toHaveLength(reactions.maxEmitters);
                expect(reactions.emitters).toBe(storage);
                expect(reactions.envelopes).toBe(envelopes);
                slots.forEach((slot, index) => expect(reactions.emitters[index]).toBe(slot));
                // Everything but the streak count (which only a lock can end) settles with time.
                for (let step = 0; step < 480; step++) reactions.update(0.25);
                const { streak, ...settled } = reactions.frame;
                const { streak: atRest, ...rest } = REST_FRAME;
                expect(settled).toEqual(rest);
                expect(streak).toBeGreaterThanOrEqual(atRest);
            }
        });

        it('reclaims the oldest emitter before a fresher one when the pool is full', () => {
            const reactions = create('Minimal');
            reactions.onPieceLock();
            const { duration } = reactions.frame.emitters[0];
            reactions.update(duration * 0.3);
            for (let index = 0; index < 3; index++) reactions.onPieceLock();
            const before = reactions.frame.emitters;
            expect(before.map((emitter) => emitter.id)).toEqual([0, 1, 2, 3]);
            expect(before.map((emitter) => emitter.serial)).toEqual([0, 1, 2, 3]);
            reactions.onPieceLock();
            const after = reactions.frame.emitters;
            expect(after).toHaveLength(4);
            expect(after[0]).toMatchObject({ id: 0, serial: 4, age: 0 });
            expect(after.slice(1)).toEqual(before.slice(1));
        });

        it('reclaims the emitter furthest through its own life, not the one that started first', () => {
            const reactions = create('Minimal');
            reactions.onPerfectClear();
            reactions.update(0.1);
            reactions.onTSpin();
            reactions.update(0.1);
            reactions.onCombo(5);
            reactions.update(0.1);
            reactions.onPieceLock();
            reactions.update(0.2);
            const before = reactions.frame.emitters;
            expect(before.map((emitter) => emitter.kind)).toEqual(['shower', 'spin', 'combo', 'lock']);
            const progress = before.map((emitter) => emitter.progress);
            const furthest = progress.indexOf(Math.max(...progress));
            expect(progress.filter((value) => value === progress[furthest])).toHaveLength(1);
            reactions.onPieceLock();
            const after = reactions.frame.emitters;
            after.forEach((emitter, index) => {
                if (index !== furthest) expect(emitter).toEqual(before[index]);
                else {
                    expect(emitter).toMatchObject({
                        id: furthest, kind: 'lock', serial: 4, age: 0,
                    });
                }
            });
        });

        it('takes a finished slot before recycling one that is still playing', () => {
            const reactions = create('Minimal');
            reactions.onPieceLock();
            const { duration } = reactions.frame.emitters[0];
            reactions.update(duration * 0.6);
            for (let index = 0; index < 3; index++) reactions.onPieceLock();
            reactions.update(duration * 0.5);
            const before = reactions.frame.emitters;
            expect(before.map((emitter) => emitter.id)).toEqual([1, 2, 3]);
            reactions.onPieceLock();
            const after = reactions.frame.emitters;
            expect(after.map((emitter) => emitter.id)).toEqual([0, 1, 2, 3]);
            expect(after[0]).toMatchObject({ serial: 4, age: 0 });
            expect(after.slice(1)).toEqual(before);
        });

        it('numbers every emission with a fresh serial so a reused slot reads as a new event', () => {
            const reactions = create('Minimal');
            const serials = [];
            for (let event = 0; event < 12; event++) {
                reactions.onPieceLock();
                const { emitters } = reactions.frame;
                serials.push(Math.max(...emitters.map((emitter) => emitter.serial)));
                reactions.update(0.05);
            }
            expect(serials).toEqual([...Array(12).keys()]);
        });
    });

    describe('ownership', () => {
        it('protects internal state from returned snapshot mutations', () => {
            const reactions = create();
            reactions.onLineClear(4);
            // A deep copy: the comparison must not share objects with either side.
            const expected = structuredClone(reactions.frame);
            const snapshot = reactions.update(0);
            expect(snapshot).toEqual(expected);
            expect(snapshot).not.toBe(reactions.getFrame());
            expect(snapshot.emitters).not.toBe(reactions.getFrame().emitters);
            expect(snapshot.front).not.toBe(reactions.getFrame().front);
            snapshot.emitters.forEach((emitter, index) => {
                expect(reactions.emitters).not.toContain(emitter);
                expect(emitter).not.toBe(reactions.getFrame().emitters[index]);
            });
            snapshot.gust = 100;
            snapshot.vortex = 100;
            snapshot.streak = 100;
            snapshot.front.position = 100;
            snapshot.front.direction = 0;
            snapshot.emitters[0].strength = 100;
            snapshot.emitters[0].side = 0;
            snapshot.emitters[0].serial = -5;
            snapshot.emitters.length = 0;
            expect(reactions.getFrame()).toEqual(expected);
            snapshot.front = null;
            expect(reactions.getFrame()).toEqual(expected);
        });

        it('resets in place and leaves disposed directors inert until explicitly reset', () => {
            const reactions = create();
            const storage = reactions.emitters;
            const slots = [...storage];
            const { envelopes } = reactions;
            reactions.onHardDrop({ distance: 20 });
            reactions.onPieceLock();
            reactions.onLineClear(4);
            reactions.onPieceLock();
            reactions.onLineClear(4);
            reactions.onCombo(8);
            reactions.onHardDrop({ distance: 20 });
            reactions.update(0.3);
            reactions.reset();
            expect(reactions.emitters).toBe(storage);
            slots.forEach((slot, index) => expect(reactions.emitters[index]).toBe(slot));
            expect(reactions.envelopes).toBe(envelopes);
            expect(reactions.time).toBe(0);
            expect(reactions.frame).toEqual(REST_FRAME);
            // Nothing of the old session survives: not the wound vortex, not the pending drop.
            expect(advance(reactions, 0.5)).toEqual(REST_FRAME);
            const fresh = create();
            reactions.reset();
            reactions.onPieceLock();
            fresh.onPieceLock();
            expect(reactions.frame.emitters[0]).toMatchObject({
                id: 0, serial: 0, strength: fresh.frame.emitters[0].strength,
            });

            reactions.onCombo(8);
            reactions.dispose();
            expect(reactions.frame).toEqual(REST_FRAME);
            expect(reactions.onHardDrop({ distance: 10 })).toBe(false);
            expect(reactions.onPieceLock()).toBe(false);
            expect(reactions.onLineClear(4)).toBe(false);
            expect(reactions.onCombo(8)).toBe(false);
            expect(reactions.onTSpin()).toBe(false);
            expect(reactions.onBackToBack()).toBe(false);
            expect(reactions.onPerfectClear()).toBe(false);
            expect(reactions.onLevelUp()).toBe(false);
            expect(() => reactions.onGameOver()).not.toThrow();
            expect(reactions.update(1)).toEqual(REST_FRAME);
            expect(reactions.time).toBe(0);
            expect(() => reactions.dispose()).not.toThrow();
            reactions.reset();
            expect(reactions.onPieceLock()).toBe(true);
            expect(reactions.frame.emitters).toHaveLength(1);
        });

        it('keeps malformed RNG values bounded and reproduces the same seeded choreography', () => {
            const script = (reactions) => {
                reactions.onHardDrop({ distance: 9 });
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.update(0.1);
                reactions.onCombo(60);
                reactions.onTSpin();
                reactions.onPerfectClear();
                reactions.update(0.25);
                return reactions.frame;
            };
            for (const value of [NaN, Infinity, -Infinity, -1, 2, 'bad', null, undefined, Symbol('seed')]) {
                const reactions = new FallReactions({ rng: () => value });
                expectBounded(script(reactions), reactions.maxEmitters);
            }
            for (const rng of ['not a function', null, 7, {}]) {
                const reactions = new FallReactions({ rng });
                expectBounded(script(reactions), reactions.maxEmitters);
            }
            expect(script(create())).toEqual(script(create()));
            const seeds = (frame) => frame.emitters.map((emitter) => emitter.seed);
            expect(seeds(script(create('High', 5)))).not.toEqual(seeds(script(create('High', 6))));
        });
    });
});
