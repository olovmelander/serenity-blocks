import { describe, expect, it } from 'vitest';
import {
    GOLDEN_FOREST_REACTION_LIMITS, GoldenForestReactions,
} from '../../src/themes/golden-forest/golden-forest-reactions.js';

const ENVELOPES = ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flock'];
const DECAY_PER_SECOND = {
    gust: 1.4, warmth: 0.75, shafts: 0.9, glow: 1.1, shimmer: 0.8, flock: 0.32,
};
const EMITTER_KINDS = ['lock', 'splash', 'clear', 'rise', 'spin', 'combo'];
const EMITTER_KEYS = ['active', 'age', 'column', 'duration', 'id', 'kind', 'lines', 'progress', 'row', 'seed',
    'serial', 'side', 'strength'];
const RING_QUEUE = 8;
const REST_RING = Object.freeze({
    serial: -1, column: 0.5, row: 0, strength: 0,
});
// A director that has never been reset is in its first epoch.
const REST_FRAME = Object.freeze({
    epoch: 1,
    gust: 0,
    warmth: 0,
    shafts: 0,
    glow: 0,
    shimmer: 0,
    flock: 0,
    vortex: 0,
    heat: 0,
    ribbons: 0,
    streak: 0,
    settled: false,
    front: null,
    rings: Array.from({ length: RING_QUEUE }, () => ({ ...REST_RING })),
    emitters: [],
});
const MALFORMED_COUNTS = [NaN, Infinity, -Infinity, -5, 0, 0.8, '', ' ', 'garbage', null, false, true, [], [4], {},
    { lineCount: [] }, { detail: { lineCount: true } }, Symbol('count'), 4n];

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create(quality = 'High', seed = 271) {
    return new GoldenForestReactions({ quality, rng: seededRandom(seed) });
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

/** The rings that have been asked for, oldest first. */
function liveRings(frame) {
    return frame.rings.filter((ring) => ring.serial >= 0).sort((a, b) => a.serial - b.serial);
}

function newestRing(frame) {
    return liveRings(frame).at(-1);
}

/** A deep copy, so a held frame cannot change under the test. */
function snapshot(frame) {
    return JSON.parse(JSON.stringify(frame));
}

/** Every way a frame can leave its documented ranges, as readable messages. */
function frameProblems(frame, capacity = Infinity) {
    const problems = [];
    const check = (condition, message) => { if (!condition) problems.push(message); };
    const unit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
    for (const key of [...ENVELOPES, 'vortex', 'heat', 'ribbons']) {
        check(unit(frame[key]), `${key} = ${String(frame[key])}`);
    }
    check(Number.isInteger(frame.streak) && frame.streak >= 0, `streak = ${String(frame.streak)}`);
    check(typeof frame.settled === 'boolean', `settled = ${String(frame.settled)}`);
    check(Number.isInteger(frame.epoch) && frame.epoch >= 1, `epoch = ${String(frame.epoch)}`);
    if (frame.front !== null) {
        const { front } = frame;
        check(Object.keys(front).sort().join() === 'direction,position,strength', `front keys ${Object.keys(front)}`);
        check(Number.isFinite(front.position) && Math.abs(front.position) <= 1.4, `front.position = ${front.position}`);
        check(front.direction === 1 || front.direction === -1, `front.direction = ${front.direction}`);
        check(unit(front.strength), `front.strength = ${front.strength}`);
    }
    check(frame.rings.length === RING_QUEUE, `${frame.rings.length} rings`);
    const serials = frame.rings.filter((ring) => ring.serial >= 0).map((ring) => ring.serial);
    check(new Set(serials).size === serials.length, 'duplicate ring serials');
    for (const ring of frame.rings) {
        const label = `ring ${ring.serial}`;
        check(Object.keys(ring).sort().join() === 'column,row,serial,strength', `${label} keys ${Object.keys(ring)}`);
        check(Number.isInteger(ring.serial) && ring.serial >= -1, `${label} serial`);
        check(unit(ring.column), `${label} column ${ring.column}`);
        check(unit(ring.row), `${label} row ${ring.row}`);
        check(Number.isFinite(ring.strength) && ring.strength >= 0 && ring.strength <= 3, `${label} strength`);
        if (ring.serial >= 0) check(ring.strength > 0, `${label} has no strength`);
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

describe('Golden Forest reaction director', () => {
    describe('budget and frame shape', () => {
        it('uses the fixed emitter budget of every quality tier', () => {
            expect(GOLDEN_FOREST_REACTION_LIMITS).toEqual({
                Minimal: 4, Low: 6, Medium: 8, High: 12, Ultra: 14, Extreme: 16,
            });
            expect(Object.isFrozen(GOLDEN_FOREST_REACTION_LIMITS)).toBe(true);
            for (const [quality, capacity] of Object.entries(GOLDEN_FOREST_REACTION_LIMITS)) {
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
                const reactions = new GoldenForestReactions({ quality, rng: seededRandom() });
                expect(reactions.quality).toBe('High');
                expect(reactions.maxEmitters).toBe(GOLDEN_FOREST_REACTION_LIMITS.High);
            }
            expect(new GoldenForestReactions().quality).toBe('High');
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
        it('answers a lock with one puff, one ring and a gentle shimmer, and nothing grander', () => {
            const reactions = create();
            expect(reactions.onPieceLock({ piece: cell(2, 20) })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toHaveLength(1);
            expect(frame.emitters[0]).toMatchObject({
                kind: 'lock', id: 0, serial: 0, age: 0, progress: 0, lines: 0, duration: 1.1, strength: 0.26,
            });
            expect(liveRings(frame)).toEqual([{
                serial: 0, column: 0.25, row: expect.closeTo(0.175, 12), strength: 0.55,
            }]);
            expect(frame).toMatchObject({
                gust: 0.1, warmth: 0.025, glow: 0.07, shimmer: 0.12, shafts: 0, flock: 0,
            });
            // Shafts, the front, the flock and the river are kept for achievements.
            expect(frame.front).toBeNull();
            expect(advance(reactions, 0.5)).toMatchObject({
                vortex: 0, heat: 0, ribbons: 0, streak: 0, shafts: 0, flock: 0, settled: false,
            });
        });

        it('places the puff and the ring beside the piece, mapping rows 4..23 from the top to the foot', () => {
            const placed = (piece) => {
                const reactions = create();
                reactions.onPieceLock({ piece });
                const [emitter] = reactions.frame.emitters;
                const ring = newestRing(reactions.frame);
                // The ring is dropped behind the same place on the board as the puff.
                expect(ring.column).toBe(emitter.column);
                expect(ring.row).toBe(emitter.row);
                return emitter;
            };
            expect(placed(cell(0, 23))).toMatchObject({ side: -1, column: 0.05, row: expect.closeTo(0.025, 12) });
            expect(placed(cell(9, 4))).toMatchObject({ side: 1, column: 0.95, row: expect.closeTo(0.975, 12) });
            expect(placed(cell(4, 13))).toMatchObject({ side: -1, column: 0.45, row: expect.closeTo(0.525, 12) });
            // A piece centred on the board's axis goes right: only columns left of centre go left.
            expect(placed({ x: 4, y: 13, shape: [[1, 1]] })).toMatchObject({ side: 1, column: 0.5 });
            // The centroid of the filled cells, not the origin of the bounding box.
            expect(placed({ x: 3, y: 10, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] }))
                .toMatchObject({ column: expect.closeTo(0.45, 12), row: expect.closeTo(0.6375, 12) });
            // A shape without cells still has a place.
            expect(placed({ x: 7, y: 19, shape: [[0, 0]] }))
                .toMatchObject({ side: 1, column: 0.75, row: expect.closeTo(0.225, 12) });
            // Pieces outside the visible matrix are clamped onto the card.
            expect(placed(cell(-6, 60))).toMatchObject({ side: -1, column: 0, row: 0 });
            expect(placed(cell(30, -9))).toMatchObject({ side: 1, column: 1, row: 1 });
        });

        it('prefers a complete viewport origin over the piece and ignores malformed origins', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(0, 23), viewportOrigin: { x: 0.8, y: 0.25 } });
            expect(reactions.frame.emitters[0]).toMatchObject({ side: 1, column: 0.8, row: 0.75 });
            reactions.onPieceLock({ piece: cell(0, 23), viewportOrigin: { x: 4, y: -2 } });
            expect(reactions.frame.emitters[1]).toMatchObject({ side: 1, column: 1, row: 1 });
            for (const viewportOrigin of [{ x: NaN, y: 0.5 }, { x: 0.5 }, [0.5, 0.5], 'centre', null, 7]) {
                const fallback = create();
                fallback.onPieceLock({ piece: cell(0, 23), viewportOrigin });
                expect(fallback.frame.emitters[0]).toMatchObject({ side: -1, column: 0.05 });
            }
        });

        it('alternates sides around the middle of the card when a lock cannot be placed', () => {
            const reactions = create();
            for (const payload of [undefined, {}, { piece: null }, { piece: { x: NaN, y: 2 } }]) {
                reactions.onPieceLock(payload);
            }
            const emitters = emittersOf(reactions.frame, 'lock');
            expect(emitters.map((emitter) => emitter.side)).toEqual([-1, 1, -1, 1]);
            for (const emitter of emitters) expect(emitter).toMatchObject({ column: 0.5, row: 0.12 });
            for (const ring of liveRings(reactions.frame)) expect(ring).toMatchObject({ column: 0.5, row: 0.12 });
        });

        it('throws up a splash only for a hard drop longer than six rows', () => {
            const dropped = (distance) => {
                const reactions = create();
                expect(reactions.onHardDrop({ distance })).toBe(true);
                // The drop alone is silent: it only arms the lock that follows.
                expect(reactions.frame).toEqual(REST_FRAME);
                reactions.onPieceLock({ piece: cell(8, 20) });
                return reactions.frame;
            };
            for (const distance of [0, 1, 5, 6]) {
                const frame = dropped(distance);
                expect(emittersOf(frame, 'splash'), `distance ${distance}`).toHaveLength(0);
                expect(frame.emitters).toHaveLength(1);
            }
            for (const distance of [6.1, 7, 12, 20, 400]) {
                const frame = dropped(distance);
                const drop = Math.min(1, distance / 20);
                const [lock] = emittersOf(frame, 'lock');
                const [splash] = emittersOf(frame, 'splash');
                expect(frame.emitters, `distance ${distance}`).toHaveLength(2);
                expect(splash).toMatchObject({
                    side: lock.side, column: lock.column, row: lock.row, duration: 0.9, lines: 0,
                });
                expect(splash.strength).toBeCloseTo(drop, 12);
                expect(splash.serial).toBe(lock.serial + 1);
                // One ring, not two: the splash is light in the air, the lock already rang the water.
                expect(liveRings(frame)).toHaveLength(1);
            }
        });

        it('lets a hard drop strengthen the lock that follows it, and only that one', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(1, 20) });
            const gentle = snapshot(reactions.frame);
            reactions.reset();
            reactions.onHardDrop({ distance: 14 });
            reactions.onPieceLock({ piece: cell(1, 20) });
            const hard = snapshot(reactions.frame);
            expect(emittersOf(hard, 'lock')[0].strength).toBeCloseTo(0.26 + 0.7 * 0.5, 12);
            expect(newestRing(hard).strength).toBeCloseTo(0.55 + 0.7 * 0.9, 12);
            for (const key of ['gust', 'warmth', 'glow', 'shimmer']) expect(hard[key]).toBeGreaterThan(gentle[key]);
            expect(hard.shafts).toBe(0);

            // The next lock is an ordinary one again.
            reactions.onPieceLock({ piece: cell(1, 20) });
            const locks = emittersOf(reactions.frame, 'lock');
            expect(locks).toHaveLength(2);
            expect(locks[1].strength).toBe(0.26);
            expect(newestRing(reactions.frame).strength).toBe(0.55);
            expect(emittersOf(reactions.frame, 'splash')).toHaveLength(1);
        });

        it('reads startY/endY and detail envelopes for a drop, and ignores malformed ones', () => {
            const strengthAfter = (payload) => {
                const reactions = create();
                reactions.onHardDrop(payload);
                reactions.onPieceLock();
                return emittersOf(reactions.frame, 'lock')[0].strength;
            };
            expect(strengthAfter({ startY: 2, endY: 22 })).toBeCloseTo(0.76, 12);
            expect(strengthAfter({ startY: '4', endY: '14' })).toBeCloseTo(0.51, 12);
            expect(strengthAfter({ detail: { distance: 10 } })).toBeCloseTo(0.51, 12);
            // An explicit distance wins over the two ends.
            expect(strengthAfter({ distance: 4, startY: 0, endY: 20 })).toBeCloseTo(0.36, 12);
            expect(strengthAfter({ distance: 1e9 })).toBeCloseTo(0.76, 12);
            for (const payload of [undefined, null, {}, 12, 'far', [], { distance: 'far' }, { distance: NaN },
                { distance: -8 }, { startY: 20, endY: 2 }, { startY: 3 }, { distance: Infinity },
                { distance: true }, { detail: null }]) {
                expect(strengthAfter(payload), String(JSON.stringify(payload))).toBe(0.26);
            }
        });
    });

    describe('line clears', () => {
        it('blows twin jets out of both sides at the height of the cleared rows and rings the water', () => {
            const reactions = create();
            expect(reactions.onLineClear(1, { clearedRows: [23] })).toBe(true);
            const { frame } = reactions;
            const jets = emittersOf(frame, 'clear');
            expect(frame.emitters).toHaveLength(2);
            expect(jets.map((emitter) => emitter.side)).toEqual([-1, 1]);
            for (const jet of jets) {
                expect(jet).toMatchObject({ lines: 1, column: 0.5, row: expect.closeTo(0.025, 12) });
                expect(jet.strength).toBeCloseTo(0.52, 12);
                expect(jet.duration).toBeCloseTo(1.62, 12);
            }
            expect(liveRings(frame)).toEqual([{
                serial: 0, column: 0.5, row: expect.closeTo(0.025, 12), strength: expect.closeTo(1.46, 12),
            }]);
            // One line is not yet a wind front, a sunburst for the birds, or a rising lake.
            expect(frame.front).toBeNull();
            expect(frame.flock).toBe(0);
            expect(frame.shafts).toBeGreaterThan(0);
            // The middle of several rows is where the jets leave.
            const tall = create();
            tall.onLineClear(4, { clearedRows: [10, 11, 12, 13] });
            for (const jet of emittersOf(tall.frame, 'clear')) expect(jet.row).toBeCloseTo(0.6, 12);
        });

        it('grows every answer with the number of lines', () => {
            const frames = [1, 2, 3, 4].map((lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [20] });
                return snapshot(reactions.frame);
            });
            for (let index = 1; index < frames.length; index++) {
                for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer']) {
                    expect(frames[index][key], `${index + 1} lines ${key}`).toBeGreaterThan(frames[index - 1][key]);
                }
                const jet = (frame) => emittersOf(frame, 'clear')[0];
                expect(jet(frames[index]).strength).toBeGreaterThan(jet(frames[index - 1]).strength);
                expect(jet(frames[index]).duration).toBeGreaterThan(jet(frames[index - 1]).duration);
                expect(jet(frames[index]).lines).toBe(index + 1);
                expect(liveRings(frames[index])[0].strength).toBeGreaterThan(liveRings(frames[index - 1])[0].strength);
            }
            frames.forEach((frame) => expectBounded(frame));
        });

        it('adds a second ring and a wind front from two lines', () => {
            const cleared = (lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [22] });
                return reactions;
            };
            expect(liveRings(cleared(1).frame)).toHaveLength(1);
            expect(cleared(1).front.active).toBe(false);
            // The second ring comes in from alternate ends of the row.
            for (const [lines, column] of [[2, 0.12], [3, 0.88], [4, 0.12]]) {
                const reactions = cleared(lines);
                const rings = liveRings(reactions.frame);
                expect(rings).toHaveLength(2);
                expect(rings[0]).toMatchObject({ column: 0.5, strength: expect.closeTo(1.1 + lines * 0.36, 12) });
                expect(rings[1]).toMatchObject({ column, strength: expect.closeTo(0.7 + lines * 0.2, 12) });
                expect(rings[1].row).toBe(rings[0].row);
                expect(reactions.front).toMatchObject({ active: true, age: 0, direction: 1 });
                expect(reactions.front.strength).toBeCloseTo(0.3 + lines * 0.17, 12);
                expect(reactions.frame.front).toEqual({ position: -1.4, direction: 1, strength: 0 });
            }
        });

        it('keeps the rising lake and the startled flock for four lines', () => {
            const three = create();
            three.onLineClear(3, { clearedRows: [21, 22, 23] });
            expect(emittersOf(three.frame, 'rise')).toHaveLength(0);
            expect(three.frame.emitters).toHaveLength(2);
            expect(three.frame.flock).toBe(0);

            const four = create();
            four.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            expect(four.frame.emitters.map((emitter) => emitter.kind)).toEqual(['clear', 'clear', 'rise']);
            expect(emittersOf(four.frame, 'rise')[0]).toMatchObject({
                row: 0, column: 0.5, strength: 1, lines: 4, duration: 2.8, serial: 2,
            });
            expect(four.frame.flock).toBe(1);
            // The sunburst: warmth and shafts jump well past the three-line answer.
            expect(four.frame.warmth).toBeCloseTo(0.88, 12);
            expect(four.frame.shafts).toBeCloseTo(0.96, 12);
            expect(four.frame.warmth - three.frame.warmth).toBeGreaterThan(0.4);
            expect(four.frame.shafts - three.frame.shafts).toBeGreaterThan(0.4);
            // The flock is slow to settle: half a second on, the birds are still up.
            expect(advance(four, 0.5).flock).toBeGreaterThan(0.8);
        });

        it('falls back from cleared rows to the viewport origin, then the piece, then a default height', () => {
            const rowOf = (detail) => {
                const reactions = create();
                reactions.onLineClear(2, detail);
                const [left, right] = emittersOf(reactions.frame, 'clear');
                expect(left.row).toBe(right.row);
                return left.row;
            };
            expect(rowOf({ clearedRows: [13, 14], viewportOrigin: { x: 0.5, y: 0.1 } })).toBeCloseTo(0.5, 12);
            expect(rowOf({ clearedRows: [], viewportOrigin: { x: 0.5, y: 0.1 } })).toBeCloseTo(0.9, 12);
            expect(rowOf({ clearedRows: 'all', piece: cell(3, 13) })).toBeCloseTo(0.525, 12);
            // Non-finite rows are dropped; rows beyond a standard board carry no screen meaning.
            expect(rowOf({ clearedRows: [NaN, 13, 'x', 14, null] })).toBeCloseTo(0.5, 12);
            expect(rowOf({ clearedRows: [80, 81], viewportOrigin: { x: 0.5, y: 0.3 } })).toBeCloseTo(0.7, 12);
            expect(rowOf({ clearedRows: [-9] })).toBe(0.2);
            for (const detail of [undefined, {}, null, { clearedRows: [NaN] }, { clearedRows: null }, 7]) {
                expect(rowOf(detail)).toBe(0.2);
            }
            // Rows above the visible matrix clamp to the top of the card.
            expect(rowOf({ clearedRows: [0, 1] })).toBe(1);
        });

        it('sends each front across the view in its direction and then retires it', () => {
            const reactions = create();
            reactions.onLineClear(2);
            const seen = [];
            for (let frame = 0; frame < 131; frame++) {
                const { front } = reactions.update(1 / 60);
                if (front) seen.push(front);
            }
            expect(seen.length).toBeGreaterThan(125);
            for (let index = 1; index < seen.length; index++) {
                expect(seen[index].position).toBeGreaterThan(seen[index - 1].position);
            }
            expect(seen[0].position).toBeLessThan(-1.3);
            expect(seen.at(-1).position).toBeGreaterThan(1.3);
            // It swells in, peaks and has all but gone when it leaves the far side.
            const peak = Math.max(...seen.map((front) => front.strength));
            expect(peak).toBeCloseTo(0.64, 3);
            expect(seen[0].strength).toBeLessThan(0.1);
            expect(seen.at(-1).strength).toBeLessThan(0.25);
            expect(advance(reactions, 0.1).front).toBeNull();
            expect(reactions.front.active).toBe(false);
        });

        it('alternates the direction of successive fronts and restarts each one upwind', () => {
            const reactions = create();
            const directions = [];
            for (const event of [() => reactions.onLineClear(2), () => reactions.onLevelUp(),
                () => reactions.onPerfectClear(), () => reactions.onLineClear(4)]) {
                advance(reactions, 0.7);
                event();
                const { front } = reactions.frame;
                directions.push(front.direction);
                expect(front.position).toBe(-1.4 * front.direction);
                expect(front.strength).toBe(0);
            }
            expect(directions).toEqual([1, -1, 1, -1]);
            const { front } = advance(reactions, 1.1);
            expect(front.position).toBeCloseTo(0, 9);
            expect(front.direction).toBe(-1);
        });
    });

    describe('streaks, the river and its heat', () => {
        it('builds a streak from consecutive clearing locks and ends it with a lock that clears nothing', () => {
            const reactions = create();
            const lock = () => reactions.onPieceLock({ piece: cell(4, 20) });
            lock();
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(1);
            // A cascade settles several times under one lock: still one step.
            reactions.onLineClear(2);
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(1);
            lock();
            expect(reactions.frame.streak).toBe(1);
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(2);
            lock();
            reactions.onLineClear(3);
            expect(reactions.frame.streak).toBe(3);
            lock();
            expect(reactions.frame.streak).toBe(3);
            lock();
            expect(reactions.frame.streak).toBe(0);
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(1);
        });

        it('counts a clear that arrives before any lock as the first step', () => {
            const reactions = create();
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(1);
            reactions.onPieceLock();
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(2);
        });

        it('leaves the river alone for a single clear and winds it from the second in a row', () => {
            const single = create();
            single.onPieceLock();
            single.onLineClear(4);
            expect(single.vortexTarget).toBe(0);
            expect(advance(single, 1)).toMatchObject({ vortex: 0, heat: 0, ribbons: 0 });

            const reactions = create();
            const levels = [];
            for (let streak = 1; streak <= 7; streak++) {
                reactions.onPieceLock();
                reactions.onLineClear(1);
                expect(reactions.vortexTarget).toBeCloseTo(streak >= 2 ? 1 - Math.exp(-(streak - 1) * 0.3) : 0, 12);
                levels.push(advance(reactions, 1).vortex);
            }
            expect(levels[0]).toBe(0);
            for (let index = 1; index < levels.length; index++) {
                expect(levels[index]).toBeGreaterThan(levels[index - 1]);
            }
            expect(levels.at(-1)).toBeGreaterThan(0.75);
            expect(levels.at(-1)).toBeLessThanOrEqual(1);
        });

        it('whitens the river and unfurls the ribbons only once it has really built', () => {
            const low = create();
            low.onCombo(2);
            const lowFrame = advance(low, 1.5);
            expect(lowFrame.vortex).toBeGreaterThan(0.4);
            expect(lowFrame.vortex).toBeLessThan(0.45);
            expect(lowFrame.heat).toBe(0);
            expect(lowFrame.ribbons).toBeGreaterThan(0);
            expect(lowFrame.ribbons).toBeLessThan(0.3);

            const high = create();
            high.onCombo(14);
            const highFrame = advance(high, 1.5);
            expect(highFrame.vortex).toBeGreaterThan(0.9);
            expect(highFrame.heat).toBeGreaterThan(0.9);
            expect(highFrame.ribbons).toBe(1);
            // The documented thresholds, exactly.
            for (const [vortex, heat, ribbons] of [[0.3, 0, 0], [0.5, 0, 0.4], [0.55, 0.05 / 0.42, 0.5],
                [0.8, 0.3 / 0.42, 1], [0.92, 1, 1], [1, 1, 1]]) {
                high.vortex = vortex;
                expect(high.frame.heat).toBeCloseTo(heat, 12);
                expect(high.frame.ribbons).toBeCloseTo(ribbons, 12);
            }
        });

        it('holds the river while it winds, then unwinds it to rest with the heat gone first', () => {
            const reactions = create();
            reactions.onCombo(20);
            const target = reactions.vortexTarget;
            expect(target).toBeGreaterThan(0.95);
            // It rises quickly toward its target and stays there for the hold.
            expect(advance(reactions, 0.5).vortex).toBeGreaterThan(target * 0.75);
            const held = advance(reactions, 2).vortex;
            expect(held).toBeGreaterThan(target * 0.99);
            expect(held).toBeLessThanOrEqual(target);
            // 2.6 s after the last event the hold lapses and it lets go.
            const released = advance(reactions, 0.5).vortex;
            expect(released).toBeLessThan(held);
            expect(reactions.vortexTarget).toBe(0);
            const order = [];
            for (let step = 0; step < 900 && reactions.vortex > 0; step++) {
                const frame = reactions.update(1 / 60);
                if (frame.heat === 0 && !order.includes('heat')) order.push('heat');
                if (frame.ribbons === 0 && !order.includes('ribbons')) order.push('ribbons');
                if (frame.vortex === 0 && !order.includes('vortex')) order.push('vortex');
            }
            expect(order).toEqual(['heat', 'ribbons', 'vortex']);
            expect(reactions.frame).toMatchObject({ vortex: 0, heat: 0, ribbons: 0 });
        });

        it('keeps the river up while events keep coming and keeps the highest target', () => {
            const reactions = create();
            reactions.onCombo(12);
            const high = reactions.vortexTarget;
            advance(reactions, 2);
            // A smaller combo renews the hold without lowering the target.
            reactions.onCombo(2);
            expect(reactions.vortexTarget).toBe(high);
            expect(advance(reactions, 2).vortex).toBeGreaterThan(high * 0.99);
            reactions.onBackToBack();
            expect(reactions.vortexTarget).toBe(high);
            expect(advance(reactions, 2).vortex).toBeGreaterThan(high * 0.99);
            // Left alone it finally unwinds, and the next river starts from its own target.
            expect(advance(reactions, 12).vortex).toBe(0);
            reactions.onCombo(2);
            expect(reactions.vortexTarget).toBeLessThan(0.5);
        });
    });

    describe('combos', () => {
        it('answers a combo with a ring of fireflies, a ring on the water and a climbing river', () => {
            const reactions = create();
            expect(reactions.onCombo(2)).toBe(true);
            const growth = 1 - Math.exp(-0.22);
            const { frame } = reactions;
            expect(frame.emitters).toHaveLength(1);
            expect(frame.emitters[0]).toMatchObject({
                kind: 'combo', row: 0.1, column: 0.5, lines: 2, duration: 1.4, side: -1,
            });
            expect(frame.emitters[0].strength).toBeCloseTo(0.4 + growth * 0.6, 12);
            const [ring] = liveRings(frame);
            expect(ring.row).toBe(0.05);
            expect(ring.strength).toBeCloseTo(0.7 + growth * 0.9, 12);
            expect(ring.column).toBeGreaterThanOrEqual(0);
            expect(ring.column).toBeLessThan(1);
            expect(reactions.vortexTarget).toBeCloseTo(0.3 + growth * 0.7, 12);
            expect(frame.flock).toBe(0);
            expect(frame.front).toBeNull();
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer']) expect(frame[key]).toBeGreaterThan(0.25);
        });

        it('keeps growing with the count and saturates instead of overflowing', () => {
            const answer = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                return { target: reactions.vortexTarget, frame: snapshot(reactions.frame) };
            };
            const counts = [2, 3, 5, 8, 13, 21];
            const answers = counts.map(answer);
            for (let index = 1; index < answers.length; index++) {
                expect(answers[index].target).toBeGreaterThan(answers[index - 1].target);
                expect(answers[index].frame.emitters[0].strength)
                    .toBeGreaterThan(answers[index - 1].frame.emitters[0].strength);
                expect(answers[index].frame.glow).toBeGreaterThanOrEqual(answers[index - 1].frame.glow);
            }
            const huge = answer(1e9);
            expect(huge).toEqual(answer(60));
            expect(huge.frame.emitters[0].lines).toBe(60);
            expect(huge.target).toBeLessThanOrEqual(1);
            expectBounded(huge.frame);
        });

        it('ignores zero and single combos without disturbing a clear in flight', () => {
            const reactions = create();
            reactions.onLineClear(2, { clearedRows: [20, 21] });
            const before = snapshot(reactions.frame);
            for (const count of [0, 1, '1', { comboCount: 1 }, { detail: { combo: 0 } }, 1.9]) {
                expect(reactions.onCombo(count)).toBe(false);
            }
            expect(reactions.onCombo()).toBe(false);
            expect(snapshot(reactions.frame)).toEqual(before);
            expect(reactions.vortexTarget).toBe(0);
        });
    });

    describe('flourishes', () => {
        it('answers a t-spin with a spiral beside the piece and a ring under it', () => {
            const reactions = create();
            expect(reactions.onTSpin({ piece: cell(8, 13) })).toBe(true);
            expect(reactions.frame.emitters).toEqual([expect.objectContaining({
                kind: 'spin', side: 1, row: expect.closeTo(0.525, 12), strength: 0.8, duration: 1.7,
            })]);
            expect(liveRings(reactions.frame)).toEqual([{
                serial: 0, column: 0.85, row: expect.closeTo(0.525, 12), strength: 1.2,
            }]);
            expect(reactions.frame).toMatchObject({
                gust: 0.45, warmth: 0.3, shafts: 0.3, glow: 0.6, shimmer: 0.5, flock: 0, front: null,
            });
            reactions.onTSpin({ detail: { piece: cell(1, 13) } });
            expect(emittersOf(reactions.frame, 'spin')[1]).toMatchObject({ side: -1 });
            // With nothing to place it, the spiral goes to the left at a third of the height.
            const bare = create();
            bare.onTSpin();
            expect(bare.frame.emitters[0]).toMatchObject({ side: -1, row: 0.3 });
            expect(liveRings(bare.frame)[0]).toMatchObject({ column: 0.5, row: 0.3 });
        });

        it('lets a back-to-back warm the light and wind the river without spending an emitter or a ring', () => {
            const reactions = create();
            expect(reactions.onBackToBack()).toBe(true);
            expect(reactions.frame).toMatchObject({
                warmth: 0.5, glow: 0.7, shafts: 0.45, shimmer: 0.6, gust: 0, flock: 0, emitters: [],
            });
            expect(liveRings(reactions.frame)).toEqual([]);
            expect(reactions.vortexTarget).toBe(0.55);
            const frame = advance(reactions, 1.5);
            expect(frame.vortex).toBeGreaterThan(0.5);
            expect(frame.ribbons).toBeGreaterThan(0.4);
        });

        it('makes the whole lake exhale on a perfect clear', () => {
            const reactions = create();
            expect(reactions.onPerfectClear()).toBe(true);
            const { frame } = reactions;
            expect(frame).toMatchObject({
                gust: 0.9, warmth: 1, shafts: 1, glow: 1, shimmer: 1, flock: 1,
            });
            expect(frame.emitters).toEqual([expect.objectContaining({
                kind: 'rise', row: 0, strength: 1, lines: 4, duration: 3.4,
            })]);
            expect(liveRings(frame)).toEqual([
                {
                    serial: 0, column: 0.5, row: 0.1, strength: 2.6,
                },
                {
                    serial: 1, column: 0.5, row: 0.5, strength: 1.6,
                },
            ]);
            expect(reactions.front).toMatchObject({ active: true, strength: 1 });
            expect(reactions.vortexTarget).toBe(0.85);
            expect(advance(reactions, 1.1).front.strength).toBeGreaterThan(0.9);
        });

        it('rings the lake and sweeps a front on a level up without spending an emitter', () => {
            const reactions = create();
            expect(reactions.onLevelUp()).toBe(true);
            expect(reactions.frame).toMatchObject({
                gust: 0.6, warmth: 0.55, shafts: 0.6, glow: 0.8, shimmer: 0.8, flock: 0.7, emitters: [],
            });
            expect(liveRings(reactions.frame)).toEqual([{
                serial: 0, column: 0.5, row: 0.1, strength: 1.8,
            }]);
            expect(reactions.front).toMatchObject({ active: true, strength: 0.75 });
            expect(reactions.vortexTarget).toBe(0);
        });

        it('settles the lake at game over without cutting the fireflies already in flight', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(9);
            const playing = advance(reactions, 0.6);
            expect(playing.settled).toBe(false);
            expect(playing.front).not.toBeNull();
            expect(playing.vortex).toBeGreaterThan(0.5);
            const rings = snapshot(playing.rings);

            expect(reactions.onGameOver()).toBe(true);
            const over = reactions.frame;
            expect(over.settled).toBe(true);
            expect(over.front).toBeNull();
            expect(over.streak).toBe(0);
            // Nothing is cut: emitters, envelopes and the rings already asked for play out.
            expect(over.emitters).toHaveLength(playing.emitters.length);
            expect(snapshot(over.rings)).toEqual(rings);
            for (const key of ENVELOPES) expect(over[key]).toBe(playing[key]);
            // The river lets go at once instead of waiting out its hold.
            expect(over.vortex).toBe(playing.vortex);
            expect(advance(reactions, 0.5).vortex).toBeLessThan(playing.vortex * 0.7);
            const later = advance(reactions, 14);
            expect(later).toMatchObject({
                vortex: 0, heat: 0, ribbons: 0, settled: true,
            });
            expect(later.emitters).toEqual([]);
        });

        it.each([
            ['a lock', (reactions) => reactions.onPieceLock()],
            ['a line clear', (reactions) => reactions.onLineClear(1)],
            ['a combo', (reactions) => reactions.onCombo(3)],
            ['a perfect clear', (reactions) => reactions.onPerfectClear()],
        ])('wakes a settled lake with %s', (_label, event) => {
            const reactions = create();
            reactions.onGameOver();
            expect(reactions.frame.settled).toBe(true);
            // Time alone does not wake it, nor does a rejected payload.
            expect(advance(reactions, 3).settled).toBe(true);
            reactions.onLineClear(0);
            reactions.onCombo(1);
            expect(reactions.frame.settled).toBe(true);
            event(reactions);
            expect(reactions.frame.settled).toBe(false);
        });
    });

    describe('payload hygiene', () => {
        it('rejects malformed counts without throwing or exciting anything', () => {
            for (const value of MALFORMED_COUNTS) {
                const reactions = create();
                expect(() => reactions.onLineClear(value)).not.toThrow();
                expect(() => reactions.onCombo(value)).not.toThrow();
                expect(reactions.onLineClear(value)).toBe(false);
                expect(reactions.onCombo(value)).toBe(false);
                expect(reactions.onLineClear(value, { lineCount: 4, clearedRows: [20] })).toBe(false);
                expect(reactions.frame).toEqual(REST_FRAME);
                expect(reactions.serial).toBe(0);
                expect(reactions.ringSerial).toBe(0);
                expect(reactions.streak).toBe(0);
            }
        });

        it('leaves a live frame untouched when a malformed count arrives mid-celebration', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(3, 20) });
            reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
            reactions.onCombo(4);
            const before = snapshot(advance(reactions, 0.25));
            for (const value of MALFORMED_COUNTS) {
                reactions.onLineClear(value);
                reactions.onCombo(value);
            }
            expect(snapshot(reactions.frame)).toEqual(before);
        });

        it('accepts numeric strings and wrapped bus payloads, and caps oversized counts', () => {
            const lines = (...args) => {
                const reactions = create();
                expect(reactions.onLineClear(...args)).toBe(true);
                return emittersOf(reactions.frame, 'clear')[0].lines;
            };
            expect(lines()).toBe(1);
            expect(lines('2')).toBe(2);
            expect(lines(' 3 ')).toBe(3);
            expect(lines(2.9)).toBe(2);
            expect(lines(99)).toBe(4);
            expect(lines({ lineCount: 3 })).toBe(3);
            expect(lines({ lines: '2' })).toBe(2);
            expect(lines({ linesCleared: 4 })).toBe(4);
            expect(lines({ count: 1e6 })).toBe(4);
            expect(lines({ detail: { lineCount: 2 } })).toBe(2);
            expect(lines({ lineCount: null, lines: 3 })).toBe(3);

            const combo = (...args) => {
                const reactions = create();
                expect(reactions.onCombo(...args)).toBe(true);
                return emittersOf(reactions.frame, 'combo')[0].lines;
            };
            expect(combo('8')).toBe(8);
            expect(combo({ comboCount: 5 })).toBe(5);
            expect(combo({ combo: '7' })).toBe(7);
            expect(combo({ count: 3 })).toBe(3);
            expect(combo({ detail: { comboCount: 4 } })).toBe(4);
            expect(combo(1e9)).toBe(60);
        });

        it('reads where a clear happened from the payload itself or from the second argument', () => {
            const rowOf = (...args) => {
                const reactions = create();
                reactions.onLineClear(...args);
                return emittersOf(reactions.frame, 'clear')[0].row;
            };
            expect(rowOf({ lineCount: 2, clearedRows: [13, 14] })).toBeCloseTo(0.5, 12);
            expect(rowOf({ detail: { lineCount: 2, clearedRows: [13, 14] } })).toBeCloseTo(0.5, 12);
            expect(rowOf(2, { clearedRows: [13, 14] })).toBeCloseTo(0.5, 12);
            expect(rowOf(2, { detail: { clearedRows: [13, 14] } })).toBeCloseTo(0.5, 12);
            // An object payload carries its own detail: the second argument is not consulted.
            expect(rowOf({ lineCount: 2 }, { clearedRows: [13, 14] })).toBe(0.2);
        });

        it('never throws on hostile lock, drop and flourish payloads and keeps the frame in range', () => {
            const hostile = [undefined, null, 0, 42, NaN, 'piece', true, [], [1, 2], () => {}, Symbol('x'), {},
                { detail: null }, { detail: 5 }, { detail: [] }, { piece: null }, { piece: 'T' }, { piece: [] },
                { piece: { x: 1 } }, { piece: { x: NaN, y: NaN } }, { piece: { x: Infinity, y: 4, shape: [[1]] } },
                { piece: { x: 1, y: 2, shape: 'T' } }, { piece: { x: 1, y: 2, shape: [null, 3, [1, 'x', NaN, -1]] } },
                { piece: { x: 1e12, y: -1e12, shape: [[1]] } }, { viewportOrigin: [] },
                { viewportOrigin: { x: Infinity, y: 0 } }, { viewportOrigin: { x: '0.5', y: '0.5' } },
                { distance: {} }, { startY: [], endY: {} }, { clearedRows: {} }];
            const reactions = create('Low');
            for (const payload of hostile) {
                expect(() => {
                    reactions.onHardDrop(payload);
                    reactions.onPieceLock(payload);
                    reactions.onTSpin(payload);
                    reactions.onLineClear(2, payload);
                    reactions.onCombo(3, payload);
                    reactions.onBackToBack(payload);
                    reactions.onPerfectClear(payload);
                    reactions.onLevelUp(payload);
                }).not.toThrow();
                expectBounded(reactions.update(1 / 60), reactions.maxEmitters);
            }
            reactions.onGameOver({ detail: NaN });
            expectBounded(advance(reactions, 2), reactions.maxEmitters);
        });
    });

    describe('time', () => {
        it('decays every envelope exponentially per second and snaps a dying one to zero', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const start = snapshot(reactions.frame);
            const one = reactions.update(1);
            for (const key of ENVELOPES) {
                expect(one[key], key).toBeCloseTo(start[key] * Math.exp(-DECAY_PER_SECOND[key]), 12);
            }
            // The birds stay up longest; the gust is the first thing to die away.
            expect(one.flock).toBeGreaterThan(one.shimmer);
            expect(one.shimmer).toBeGreaterThan(one.gust);
            const later = advance(reactions, 60);
            for (const key of ENVELOPES) expect(later[key], key).toBe(0);
        });

        it('advances envelopes, the river, fronts and emitter ages identically at 30, 60 and 144 Hz', () => {
            const play = (fps) => {
                const reactions = create();
                reactions.onHardDrop({ distance: 12 });
                reactions.onPieceLock({ piece: cell(2, 20) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(6);
                return advance(reactions, 1, fps);
            };
            const reference = play(60);
            for (const fps of [30, 144]) {
                const frame = play(fps);
                for (const key of ENVELOPES) expect(frame[key], `${key} @${fps}`).toBeCloseTo(reference[key], 9);
                expect(frame.vortex).toBeCloseTo(reference.vortex, 2);
                expect(frame.front.position).toBeCloseTo(reference.front.position, 9);
                expect(frame.front.strength).toBeCloseTo(reference.front.strength, 9);
                expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(reference.emitters.map((e) => e.kind));
                frame.emitters.forEach((emitter, index) => {
                    expect(emitter.age).toBeCloseTo(reference.emitters[index].age, 9);
                    expect(emitter.progress).toBeCloseTo(reference.emitters[index].progress, 9);
                });
            }
            // The 0.9 s splash has gone at every rate; the 1.1 s lock and the longer emitters play on.
            expect(reference.emitters.map((emitter) => emitter.kind))
                .toEqual(['lock', 'clear', 'clear', 'rise', 'combo']);
        });

        it('ages each emitter to the end of its own life and then frees the slot', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onTSpin({ piece: cell(1, 20) });
            const half = advance(reactions, 0.55);
            expect(half.emitters.map((emitter) => emitter.kind)).toEqual(['lock', 'spin']);
            expect(half.emitters[0].progress).toBeCloseTo(0.5, 9);
            expect(half.emitters[1].progress).toBeCloseTo(0.55 / 1.7, 9);
            expect(advance(reactions, 0.5).emitters.map((emitter) => emitter.kind)).toEqual(['lock', 'spin']);
            // 1.1 s: the lock is over, the spin has 0.6 s left.
            expect(advance(reactions, 0.1).emitters.map((emitter) => emitter.kind)).toEqual(['spin']);
            expect(reactions.emitters[0]).toMatchObject({ active: false, strength: 0, age: 1.1 });
            expect(advance(reactions, 0.6).emitters).toEqual([]);
            // One long step cannot age an emitter past its duration.
            reactions.onPieceLock();
            expect(reactions.update(30).emitters).toEqual([]);
            expect(reactions.emitters.every((emitter) => emitter.age <= emitter.duration)).toBe(true);
        });

        it('ignores invalid or non-positive timesteps and only advances on explicit updates', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(2, 20) });
            reactions.onLineClear(3);
            reactions.onCombo(5);
            const before = snapshot(reactions.frame);
            for (const dt of [0, -0, -1, -1e9, NaN, Infinity, -Infinity, undefined, null, '0.1', {}, []]) {
                expect(snapshot(reactions.update(dt))).toEqual(before);
            }
            expect(reactions.time).toBe(0);
            // Reading the frame is not the same as stepping it.
            for (let read = 0; read < 50; read++) reactions.getFrame();
            expect(snapshot(reactions.frame)).toEqual(before);
            const after = reactions.update(0.2);
            expect(reactions.time).toBeCloseTo(0.2, 12);
            expect(after.gust).toBeLessThan(before.gust);
            expect(after.emitters[0].age).toBeCloseTo(0.2, 12);
        });
    });

    describe('emitter slots', () => {
        it.each(Object.entries(GOLDEN_FOREST_REACTION_LIMITS))(
            'keeps an event storm inside the %s budget of %i and uses every slot',
            (quality, capacity) => {
                const reactions = create(quality, 9);
                const random = seededRandom(31);
                const used = new Set();
                const events = [
                    () => reactions.onPieceLock({
                        piece: cell(Math.floor(random() * 10), 4 + Math.floor(random() * 20)),
                    }),
                    () => { reactions.onHardDrop({ distance: random() * 22 }); reactions.onPieceLock(); },
                    () => reactions.onLineClear(1 + Math.floor(random() * 4), { clearedRows: [22, 23] }),
                    () => reactions.onCombo(2 + Math.floor(random() * 30)),
                    () => reactions.onTSpin({ piece: cell(Math.floor(random() * 10), 20) }),
                    () => reactions.onPerfectClear(),
                    () => reactions.onLevelUp(),
                    () => reactions.onBackToBack(),
                    () => reactions.onGameOver(),
                ];
                let peak = 0;
                for (let frame = 0; frame < 600; frame++) {
                    const burst = Math.floor(random() * 4);
                    for (let count = 0; count < burst; count++) events[Math.floor(random() * events.length)]();
                    const state = reactions.update(1 / 60);
                    state.emitters.forEach((emitter) => used.add(emitter.id));
                    peak = Math.max(peak, state.emitters.length);
                    const problems = frameProblems(state, capacity);
                    if (problems.length) throw new Error(`frame ${frame}: ${problems.join('; ')}`);
                }
                expect(peak).toBe(capacity);
                expect([...used].sort((a, b) => a - b)).toEqual([...Array(capacity).keys()]);
                expect(reactions.emitters).toHaveLength(capacity);
            },
        );

        it('reclaims the emitter furthest through its own life, not the one that started first', () => {
            const reactions = create('Minimal');
            reactions.onPieceLock(); // slot 0, 1.1 s
            advance(reactions, 0.5);
            reactions.onTSpin(); // slot 1, 1.7 s
            reactions.onPerfectClear(); // slot 2, 3.4 s
            reactions.onCombo(3); // slot 3, 1.4 s
            const full = advance(reactions, 0.3);
            expect(full.emitters.map((emitter) => emitter.kind)).toEqual(['lock', 'spin', 'rise', 'combo']);
            const progress = full.emitters.map((emitter) => emitter.progress);
            expect(progress[0]).toBeGreaterThan(progress[3]);
            expect(progress[3]).toBeGreaterThan(progress[1]);
            expect(progress[1]).toBeGreaterThan(progress[2]);

            // The lock is 73% through: it goes first.
            reactions.onLevelUp(); // spends no emitter
            reactions.onTSpin();
            expect(reactions.frame.emitters.map((emitter) => emitter.kind)).toEqual(['spin', 'spin', 'rise', 'combo']);
            expect(reactions.frame.emitters[0]).toMatchObject({ id: 0, age: 0, serial: 4 });
            // Next the combo (21%), although the first spin and the rise both started before it.
            reactions.onTSpin();
            expect(reactions.frame.emitters.map((emitter) => emitter.kind)).toEqual(['spin', 'spin', 'rise', 'spin']);
            expect(reactions.frame.emitters[3]).toMatchObject({ id: 3, age: 0, serial: 5 });
            // Then the older spin (18%), and the long rise survives them all.
            reactions.onCombo(2);
            expect(reactions.frame.emitters.map((emitter) => emitter.kind)).toEqual(['spin', 'combo', 'rise', 'spin']);
            expect(reactions.frame.emitters).toHaveLength(4);
        });

        it('takes a finished slot before recycling one that is still playing', () => {
            const reactions = create('Minimal');
            reactions.onPerfectClear(); // slot 0, 3.4 s
            reactions.onPieceLock(); // slot 1, 1.1 s
            reactions.onPerfectClear(); // slot 2
            reactions.onPerfectClear(); // slot 3
            const frame = advance(reactions, 1.2);
            expect(frame.emitters.map((emitter) => emitter.id)).toEqual([0, 2, 3]);
            reactions.onTSpin();
            const after = reactions.frame.emitters;
            expect(after.map((emitter) => emitter.id)).toEqual([0, 1, 2, 3]);
            expect(after.map((emitter) => emitter.kind)).toEqual(['rise', 'spin', 'rise', 'rise']);
            expect(after.filter((emitter) => emitter.kind === 'rise').every((emitter) => emitter.age > 1)).toBe(true);
        });

        it('numbers every emission with a fresh serial so a reused slot reads as a new event', () => {
            const reactions = create('Minimal');
            const seen = [];
            for (let round = 0; round < 12; round++) {
                reactions.onPieceLock({ piece: cell(round % 10, 20) });
                const newest = reactions.frame.emitters.reduce((a, b) => (a.serial > b.serial ? a : b));
                seen.push({ id: newest.id, serial: newest.serial });
                reactions.update(0.05);
            }
            expect(seen.map((entry) => entry.serial)).toEqual([...Array(12).keys()]);
            // Four slots, twelve events: every slot was reused, each time under a new serial.
            for (let id = 0; id < 4; id++) {
                const serials = seen.filter((entry) => entry.id === id).map((entry) => entry.serial);
                expect(serials.length).toBeGreaterThan(1);
                expect(new Set(serials).size).toBe(serials.length);
            }
            expect(reactions.serial).toBe(12);
        });
    });

    describe('the ring queue', () => {
        it('numbers rings in the order they were asked for, whatever asked', () => {
            const reactions = create();
            const script = [
                [() => reactions.onPieceLock(), 1],
                [() => reactions.onHardDrop({ distance: 20 }), 0],
                [() => reactions.onPieceLock(), 1],
                [() => reactions.onLineClear(1), 1],
                [() => reactions.onLineClear(2), 2],
                [() => reactions.onLineClear(4), 2],
                [() => reactions.onCombo(4), 1],
                [() => reactions.onTSpin(), 1],
                [() => reactions.onBackToBack(), 0],
                [() => reactions.onPerfectClear(), 2],
                [() => reactions.onLevelUp(), 1],
                [() => reactions.onGameOver(), 0],
            ];
            let issued = 0;
            for (const [event, rings] of script) {
                event();
                issued += rings;
                expect(reactions.ringSerial).toBe(issued);
                if (issued > 0) expect(newestRing(reactions.frame).serial).toBe(issued - 1);
                // Time does not issue, renumber or retire rings.
                expectBounded(reactions.update(0.4));
                expect(reactions.ringSerial).toBe(issued);
            }
            expect(issued).toBe(12);
        });

        it('wraps around a queue of eight, overwriting the oldest ring and never reusing a serial', () => {
            const reactions = create();
            const seen = [];
            for (let lock = 0; lock < 20; lock++) {
                reactions.onPieceLock({ piece: cell(lock % 10, 4 + lock) });
                const { rings } = reactions.frame;
                expect(rings).toHaveLength(RING_QUEUE);
                const live = liveRings(reactions.frame);
                expect(live).toHaveLength(Math.min(lock + 1, RING_QUEUE));
                // Always the newest eight, each still describing its own lock.
                expect(live.map((ring) => ring.serial))
                    .toEqual([...Array(live.length).keys()].map((index) => lock + 1 - live.length + index));
                for (const ring of live) {
                    expect(ring.column).toBeCloseTo(((ring.serial % 10) + 0.5) / 10, 12);
                    expect(ring.row).toBeCloseTo(Math.max(0, 1 - (ring.serial + 0.5) / 20), 12);
                }
                // The slot is the serial modulo the queue: the writer walks the queue in a circle.
                expect(rings[lock % RING_QUEUE].serial).toBe(lock);
                seen.push(newestRing(reactions.frame).serial);
            }
            expect(seen).toEqual([...Array(20).keys()]);
        });

        it('holds every ring the busiest single lock can ask for', () => {
            const reactions = create();
            // One piece: a t-spin that clears four lines on a combo, empties the board and
            // levels up. Lock 1, clear 2, combo 1, spin 1, perfect clear 2, level 1.
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: cell(4, 20) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(5);
            reactions.onTSpin({ piece: cell(4, 20) });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            const live = liveRings(reactions.frame);
            expect(live.map((ring) => ring.serial)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
            expect(live).toHaveLength(RING_QUEUE);
            // None was overwritten before a frame could read it: the lock's own ring is still first.
            expect(live[0].strength).toBeCloseTo(0.55 + 0.9 * 0.9, 12);
            expect(live.map((ring) => ring.strength).slice(-3)).toEqual([2.6, 1.6, 1.8]);
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('clamps a ring onto the card and caps its strength', () => {
            const reactions = create();
            expect(reactions.ripple(7, -3, 99)).toEqual({
                serial: 0, column: 1, row: 0, strength: 3,
            });
            expect(reactions.ripple(-2, 5, -4)).toEqual({
                serial: 1, column: 0, row: 1, strength: 0,
            });
            // No gameplay event asks for more than the cap.
            const loud = create();
            loud.onHardDrop({ distance: 400 });
            loud.onPieceLock();
            loud.onLineClear(4);
            loud.onPerfectClear();
            loud.onCombo(60);
            for (const ring of liveRings(loud.frame)) expect(ring.strength).toBeLessThan(3);
        });
    });

    describe('ownership', () => {
        it('hands out emitter snapshots that cannot corrupt the director', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(2, 20) });
            reactions.onLineClear(2);
            const first = reactions.getFrame();
            const second = reactions.getFrame();
            expect(first).not.toBe(second);
            expect(first.emitters).not.toBe(second.emitters);
            expect(first.emitters[0]).not.toBe(second.emitters[0]);
            const before = snapshot(second);
            first.gust = 99;
            first.emitters[0].strength = 99;
            first.emitters[0].active = false;
            first.emitters.length = 0;
            first.front = null;
            expect(snapshot(reactions.getFrame())).toEqual(before);
            expectBounded(reactions.update(0.1), reactions.maxEmitters);
        });

        it('resets in place to the rest frame and numbers the next session from zero', () => {
            const reactions = create();
            const { emitters, rings } = reactions;
            reactions.onHardDrop({ distance: 20 });
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onLineClear(4);
            reactions.onCombo(12);
            reactions.onPerfectClear();
            reactions.onGameOver();
            advance(reactions, 0.5);
            reactions.onHardDrop({ distance: 20 });
            reactions.reset();
            // At rest again, in a new epoch: whoever follows the frames can tell a session ended.
            const rest = { ...REST_FRAME, epoch: 2 };
            expect(reactions.frame).toEqual(rest);
            expect(reactions).toMatchObject({
                time: 0, serial: 0, ringSerial: 0, streak: 0, vortex: 0, vortexTarget: 0, vortexHold: 0, settled: false,
            });
            // No allocation: the pools are the ones it was built with.
            expect(reactions.emitters).toBe(emitters);
            expect(reactions.rings).toBe(rings);
            expect(advance(reactions, 1)).toEqual(rest);

            // The armed drop is forgotten too, and serials start over.
            reactions.onPieceLock({ piece: cell(1, 20) });
            expect(reactions.frame.emitters).toEqual([expect.objectContaining({
                kind: 'lock', serial: 0, id: 0, strength: 0.26,
            })]);
            expect(liveRings(reactions.frame).map((ring) => ring.serial)).toEqual([0]);
            reactions.onPerfectClear();
            expect(reactions.frame.front.direction).toBe(1);
        });

        it('leaves a disposed director inert until it is explicitly reset', () => {
            const reactions = create();
            reactions.onPieceLock();
            reactions.onLineClear(4);
            reactions.dispose();
            expect(reactions.disposed).toBe(true);
            const rest = { ...REST_FRAME, epoch: 2 };
            expect(reactions.frame).toEqual(rest);
            expect(reactions.onHardDrop({ distance: 20 })).toBe(false);
            expect(reactions.onPieceLock({ piece: cell(1, 20) })).toBe(false);
            expect(reactions.onLineClear(4)).toBe(false);
            expect(reactions.onCombo(9)).toBe(false);
            expect(reactions.onTSpin()).toBe(false);
            expect(reactions.onBackToBack()).toBe(false);
            expect(reactions.onPerfectClear()).toBe(false);
            expect(reactions.onLevelUp()).toBe(false);
            // Game over is refused like every other event: it does not settle a disposed lake.
            expect(reactions.onGameOver()).toBe(false);
            expect(reactions.settled).toBe(false);
            expect(reactions.update(1)).toEqual(rest);
            expect(reactions.time).toBe(0);
            expect(reactions.serial).toBe(0);
            expect(reactions.ringSerial).toBe(0);
            expect(() => reactions.dispose()).not.toThrow();

            reactions.reset();
            expect(reactions.disposed).toBe(false);
            expect(reactions.onPieceLock()).toBe(true);
            expect(reactions.update(0.1).emitters).toHaveLength(1);
            expect(reactions.onGameOver()).toBe(true);
            expect(reactions.frame.settled).toBe(true);
        });

        it('counts an epoch for every reset, and for nothing else', () => {
            const reactions = create();
            expect(reactions.epoch).toBe(1);
            expect(reactions.frame.epoch).toBe(1);
            // Playing, time and game over all belong to the same session.
            reactions.onHardDrop({ distance: 12 });
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onLineClear(4);
            reactions.onCombo(8);
            reactions.onTSpin();
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            expect(advance(reactions, 3).epoch).toBe(1);
            reactions.onGameOver();
            reactions.onPieceLock();
            expect(advance(reactions, 20).epoch).toBe(1);
            // Every reset starts the serials at zero again, so every reset is a new epoch,
            // even one straight after another with nothing played in between.
            reactions.reset();
            expect(reactions.frame.epoch).toBe(2);
            reactions.reset();
            expect(reactions.getFrame().epoch).toBe(3);
            reactions.onPieceLock();
            expect(reactions.update(0.1)).toMatchObject({ epoch: 3 });
            expect(reactions.frame.emitters[0].serial).toBe(0);
            // Disposal resets too; reviving it is one more.
            reactions.dispose();
            expect(reactions.frame.epoch).toBe(4);
            reactions.reset();
            expect(reactions.frame.epoch).toBe(5);
            // Each director counts for itself.
            expect(create().frame.epoch).toBe(1);
        });

        it('reproduces the same choreography for the same seed and keeps a broken rng in range', () => {
            const play = (rng) => {
                const reactions = new GoldenForestReactions({ quality: 'Medium', rng });
                const frames = [];
                for (let frame = 0; frame < 240; frame++) {
                    if (frame % 40 === 0) reactions.onPieceLock({ piece: cell(frame % 10, 20) });
                    if (frame % 40 === 5) reactions.onLineClear(1 + ((frame / 40) % 4), { clearedRows: [22] });
                    if (frame % 60 === 10) reactions.onCombo(2 + frame / 20);
                    if (frame === 100) reactions.onTSpin();
                    if (frame === 150) reactions.onPerfectClear();
                    frames.push(snapshot(reactions.update(1 / 60)));
                }
                return frames;
            };
            const first = play(seededRandom(7));
            expect(play(seededRandom(7))).toEqual(first);
            // The seed only decides emitter seeds and where a combo's ring falls.
            const other = play(seededRandom(8));
            expect(other).not.toEqual(first);
            expect(other.map((frame) => frame.gust)).toEqual(first.map((frame) => frame.gust));
            expect(other.map((frame) => frame.emitters.map((emitter) => emitter.kind)))
                .toEqual(first.map((frame) => frame.emitters.map((emitter) => emitter.kind)));

            for (const broken of [() => NaN, () => Infinity, () => -3, () => 7, () => undefined, () => '0.5',
                () => 1]) {
                const frames = play(broken);
                for (const frame of frames) expectBounded(frame, GOLDEN_FOREST_REACTION_LIMITS.Medium);
                expect(frames.some((frame) => frame.emitters.length > 0)).toBe(true);
            }
            // Not a function at all: the director falls back to Math.random rather than failing.
            const fallback = new GoldenForestReactions({ rng: 'dice' });
            fallback.onCombo(3);
            expectBounded(fallback.frame);
        });
    });
});
