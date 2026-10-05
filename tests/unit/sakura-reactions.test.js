import { describe, expect, it } from 'vitest';
import {
    SAKURA_MAX_FOXFIRE, SAKURA_REACTION_LIMITS, SakuraReactions,
} from '../../src/themes/sakura-twilight/sakura-reactions.js';

const ENVELOPES = ['gust', 'glow', 'lanterns', 'moon'];
const UNIT_STATES = ['vortex', 'heat', 'spirit', 'constellation', 'figures', 'hush'];
const EMITTER_KINDS = ['lock', 'clear', 'floats', 'star', 'shower', 'combo', 'lanterns', 'spin', 'rise'];
const EMITTER_KEYS = ['active', 'age', 'column', 'duration', 'id', 'kind', 'lines', 'progress', 'row', 'seed',
    'serial', 'side', 'strength'];
const REST_FRAME = Object.freeze({
    gust: 0,
    glow: 0,
    lanterns: 0,
    moon: 0,
    vortex: 0,
    heat: 0,
    spirit: 0,
    constellation: 0,
    figures: 0,
    foxfire: 0,
    hush: 0,
    streak: 0,
    front: null,
    emitters: [],
});
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
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
    return new SakuraReactions({ quality, rng: seededRandom(seed) });
}

/** Step the director in whole frames and return the frame it ends on. */
function advance(reactions, seconds, fps = 60) {
    const frames = Math.round(seconds * fps);
    for (let frame = 0; frame < frames; frame += 1) reactions.update(1 / fps);
    return reactions.getFrame();
}

/** Step until `done(frame)` holds; returns the seconds it took (or `limit` when it never did). */
function secondsUntil(reactions, done, limit = 120, fps = 60) {
    for (let frame = 1; frame <= limit * fps; frame += 1) {
        if (done(reactions.update(1 / fps))) return frame / fps;
    }
    return limit;
}

/** One filled cell at board column `x`, board row `y` (rows 4..23 are the visible matrix). */
function cell(x, y) {
    return { x, y, shape: [[1]] };
}

function emittersOf(frame, kind) {
    return frame.emitters.filter((emitter) => emitter.kind === kind);
}

function kindsOf(frame) {
    return frame.emitters.map((emitter) => emitter.kind).sort();
}

/** Every way a frame can leave its documented ranges, as readable messages. */
function frameProblems(frame, capacity = Infinity) {
    const problems = [];
    const check = (condition, message) => { if (!condition) problems.push(message); };
    const unit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
    for (const key of [...ENVELOPES, ...UNIT_STATES]) check(unit(frame[key]), `${key} = ${String(frame[key])}`);
    check(
        Number.isFinite(frame.foxfire) && frame.foxfire >= 0 && frame.foxfire <= SAKURA_MAX_FOXFIRE,
        `foxfire = ${String(frame.foxfire)}`,
    );
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

/** A lock that clears `lines` rows: one step of a streak. */
function clearingLock(reactions, lines = 1) {
    reactions.onPieceLock({ piece: cell(4, 22) });
    reactions.onLineClear(lines, { clearedRows: [23] });
}

describe('Sakura reaction director', () => {
    describe('budget and frame shape', () => {
        it('gives every quality tier a fixed slot budget that never grows as the tier drops', () => {
            expect(Object.isFrozen(SAKURA_REACTION_LIMITS)).toBe(true);
            expect(Object.keys(SAKURA_REACTION_LIMITS).sort()).toEqual([...TIER_ORDER].sort());
            TIER_ORDER.forEach((quality, index) => {
                const capacity = SAKURA_REACTION_LIMITS[quality];
                expect(Number.isInteger(capacity) && capacity > 0, quality).toBe(true);
                if (index > 0) expect(capacity).toBeLessThanOrEqual(SAKURA_REACTION_LIMITS[TIER_ORDER[index - 1]]);
                const reactions = create(quality);
                reactions.onPieceLock();
                expect(reactions.quality).toBe(quality);
                expect(reactions.maxEmitters).toBe(capacity);
                expect(reactions.emitters).toHaveLength(capacity);
                expect(reactions.emitters.map((emitter) => emitter.id)).toEqual([...Array(capacity).keys()]);
                expect(reactions.frame.emitters).toHaveLength(1);
                expectBounded(reactions.frame, capacity);
            });
        });

        // The biggest single event is a four-line clear: twin jets, the lanterns set afloat, the
        // blizzard and its shooting stars. Even the smallest pool must hold all of it at once,
        // or one jet would be recycled before SakuraWorld ever saw it.
        it.each(TIER_ORDER)('plays a whole four-line clear inside the %s budget', (quality) => {
            const reactions = create(quality);
            expect(reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] })).toBe(true);
            const { frame } = reactions;
            expect(emittersOf(frame, 'clear').map((emitter) => emitter.side).sort()).toEqual([-1, 1]);
            expect(emittersOf(frame, 'floats')).toHaveLength(1);
            expect(emittersOf(frame, 'shower')).toHaveLength(1);
            expect(emittersOf(frame, 'star').length).toBeGreaterThan(0);
            expectBounded(frame, reactions.maxEmitters);
        });

        // SakuraWorld only sees the emitters that are alive when the frame is read. An emitter
        // claimed and then reclaimed before that (every emitter of one frame is at age zero, so
        // the pool has nothing older to give up) would never be played: a four-line clear would
        // lose its left jet, and with it the ring on the lake. So a whole frame in which every
        // handler fires must fit in every tier's pool.
        describe('a frame in which everything happens at once', () => {
            function everything(reactions) {
                const piece = cell(1, 20);
                reactions.onHardDrop({ piece, distance: 18 });
                reactions.onPieceLock({ piece });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(9);
                reactions.onTSpin({ piece });
                reactions.onBackToBack();
                reactions.onPerfectClear();
                reactions.onLevelUp();
            }

            /** Serials are handed out in order: a gap below the newest is an emitter that was lost. */
            function lostSince(frame, first = 0) {
                const alive = new Set(frame.emitters.map((emitter) => emitter.serial));
                const newest = Math.max(...alive);
                const lost = [];
                for (let serial = first; serial <= newest; serial += 1) {
                    if (!alive.has(serial)) lost.push(serial);
                }
                return lost;
            }

            it.each(TIER_ORDER)('loses none of it at %s', (quality) => {
                const reactions = create(quality);
                everything(reactions);
                const { frame } = reactions;
                expect(lostSince(frame)).toEqual([]);
                // The pieces that went missing from small pools: the lock, and the left jet.
                expect(emittersOf(frame, 'lock')).toHaveLength(1);
                expect(emittersOf(frame, 'clear').map((emitter) => emitter.side).sort()).toEqual([-1, 1]);
                expect(new Set(kindsOf(frame))).toEqual(new Set(EMITTER_KINDS));
                expectBounded(frame, reactions.maxEmitters);
                // And it is all still there for the frame after, to go on being played.
                expect(lostSince(reactions.update(1 / 60))).toEqual([]);
            });

            it('happens the same way at every tier', () => {
                const frames = TIER_ORDER.map((quality) => {
                    const reactions = create(quality);
                    everything(reactions);
                    return reactions.frame;
                });
                const shape = (frame) => frame.emitters.map(({ id, seed, ...rest }) => rest);
                for (const frame of frames) expect(shape(frame)).toEqual(shape(frames[0]));
            });

            it.each(TIER_ORDER)('gives up only what is already playing when the garden is busy at %s', (quality) => {
                const reactions = create(quality);
                // A full pool of older events, each already seen for a few frames.
                for (let event = 0; event < reactions.maxEmitters; event += 1) {
                    reactions.onPieceLock({ piece: cell(event % 10, 20) });
                    reactions.update(1 / 60);
                }
                const before = reactions.getFrame();
                expect(before.emitters).toHaveLength(reactions.maxEmitters);
                const first = Math.max(...before.emitters.map((emitter) => emitter.serial)) + 1;
                everything(reactions);
                const { frame } = reactions;
                // Every emitter of this frame survived; room was made by the oldest locks.
                expect(lostSince(frame, first)).toEqual([]);
                const fresh = frame.emitters.filter((emitter) => emitter.serial >= first);
                expect(fresh.length).toBeGreaterThan(10);
                expect(fresh.every((emitter) => emitter.age === 0)).toBe(true);
                expect(new Set(fresh.map((emitter) => emitter.kind))).toEqual(new Set(EMITTER_KINDS));
                const kept = frame.emitters.filter((emitter) => emitter.serial < first);
                const keptSerials = new Set(kept.map((emitter) => emitter.serial));
                const dropped = before.emitters.filter((emitter) => !keptSerials.has(emitter.serial));
                expect(dropped.length).toBeGreaterThan(0);
                expect(kept.length + fresh.length).toBe(reactions.maxEmitters);
                // What was given up had been playing longer than anything that was kept.
                for (const old of dropped) {
                    for (const survivor of kept) expect(old.progress).toBeGreaterThanOrEqual(survivor.progress);
                }
                expectBounded(frame, reactions.maxEmitters);
            });
        });

        it('normalises tier names and falls back to High for anything else', () => {
            expect(create('low').quality).toBe('Low');
            expect(create('EXTREME').quality).toBe('Extreme');
            expect(create('minimal').quality).toBe('Minimal');
            expect(create('Med').quality).toBe('Medium');
            expect(create('medium').quality).toBe('Medium');
            for (const quality of ['invalid', '', undefined, null, 42, {}, ['Low']]) {
                const reactions = new SakuraReactions({ quality, rng: seededRandom() });
                expect(reactions.quality).toBe('High');
                expect(reactions.maxEmitters).toBe(SAKURA_REACTION_LIMITS.High);
            }
            expect(new SakuraReactions().quality).toBe('High');
        });

        it('starts at rest and reports the documented frame shape', () => {
            const reactions = create();
            expect(reactions.getFrame()).toEqual(REST_FRAME);
            expect(reactions.frame).toEqual(REST_FRAME);
            reactions.onPieceLock({ piece: cell(2, 20) });
            reactions.onLineClear(4);
            reactions.onCombo(6);
            const frame = reactions.update(0.1);
            expect(Object.keys(frame).sort()).toEqual(Object.keys(REST_FRAME).sort());
            expect(frame).toEqual(reactions.frame);
            expect(frame.emitters.length).toBeGreaterThan(0);
            expectBounded(frame, reactions.maxEmitters);
        });
    });

    describe('piece locks', () => {
        it('keeps a lock gentle: one puff, and nothing a clear or a combo should earn', () => {
            const lock = create();
            const clear = create();
            expect(lock.onPieceLock()).toBe(true);
            clear.onLineClear(1);
            expect(lock.frame.emitters).toHaveLength(1);
            expect(lock.frame.emitters[0]).toMatchObject({
                kind: 'lock', age: 0, progress: 0, lines: 0, id: 0, serial: 0,
            });
            expect(lock.frame.gust).toBeGreaterThan(0);
            // The lanterns breathe with every piece.
            expect(lock.frame.lanterns).toBeGreaterThan(0);
            for (const key of ENVELOPES) expect(lock.frame[key], key).toBeLessThan(clear.frame[key]);
            expect(lock.frame.emitters[0].strength).toBeLessThan(emittersOf(clear.frame, 'clear')[0].strength);
            expect(lock.frame.front).toBeNull();
            expect(advance(lock, 0.5)).toMatchObject({
                vortex: 0, heat: 0, constellation: 0, figures: 0, foxfire: 0, hush: 0, streak: 0, front: null,
            });
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
                kind: 'lock', side: soft.side, column: soft.column, row: soft.row,
            });
            for (const key of ENVELOPES) expect(dropped.frame[key], key).toBeGreaterThan(plain.frame[key]);
            // The next piece is placed gently: the charge has been spent.
            dropped.onPieceLock({ piece });
            expect(dropped.frame.emitters[1].strength).toBe(soft.strength);
            expectBounded(dropped.frame, dropped.maxEmitters);
        });

        it('scales the drop by its length, reads startY/endY, and ignores malformed drops', () => {
            const lockAfter = (drop) => {
                const reactions = create();
                if (drop !== undefined) reactions.onHardDrop(drop);
                reactions.onPieceLock({ piece: cell(2, 22) });
                return reactions.frame.emitters[0].strength;
            };
            const plain = lockAfter();
            const short = lockAfter({ distance: 4 });
            const long = lockAfter({ distance: 16 });
            expect(short).toBeGreaterThan(plain);
            expect(long).toBeGreaterThan(short);
            // A drop cannot be longer than the board is tall.
            expect(lockAfter({ distance: 400 })).toBe(lockAfter({ distance: 20 }));
            expect(lockAfter({ distance: 400 })).toBeLessThanOrEqual(1);
            // Without a distance the rows travelled are used, in a bare payload or a wrapped one.
            expect(lockAfter({ startY: 3, endY: 19 })).toBe(long);
            expect(lockAfter({ detail: { distance: 16 } })).toBe(long);
            for (const drop of [{}, null, 'drop', 7, { distance: NaN }, { distance: -6 }, { distance: '16' },
                { startY: 3 }, { startY: 'a', endY: 'b' }, { distance: Infinity }]) {
                expect(lockAfter(drop), JSON.stringify(drop)).toBe(plain);
            }
        });
    });

    describe('line clears', () => {
        it('blows twin jets out of both sides at the height of the cleared rows and sets lanterns afloat', () => {
            const reactions = create();
            expect(reactions.onLineClear(2, { clearedRows: [22, 23] })).toBe(true);
            const { frame } = reactions;
            const jets = emittersOf(frame, 'clear');
            expect(jets.map((emitter) => emitter.side)).toEqual([-1, 1]);
            // Rows 22 and 23 are the two lowest of the twenty visible rows.
            for (const jet of jets) {
                expect(jet.row).toBeCloseTo(0.05, 10);
                expect(jet.lines).toBe(2);
                expect(jet.strength).toBe(jets[0].strength);
                expect(jet.duration).toBe(jets[0].duration);
            }
            // Every cleared line sets a lantern afloat.
            const [floats] = emittersOf(frame, 'floats');
            expect(floats.lines).toBe(2);
            expect(floats.row).toBeCloseTo(0.05, 10);
            expect(kindsOf(frame)).toEqual(['clear', 'clear', 'floats']);
            for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThan(0);
            expectBounded(frame, reactions.maxEmitters);
        });

        it('answers more lines with stronger jets, more lanterns and more light', () => {
            const frames = [1, 2, 3, 4].map((lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [23] });
                return reactions.frame;
            });
            for (let index = 1; index < frames.length; index += 1) {
                const less = frames[index - 1];
                const more = frames[index];
                expect(emittersOf(more, 'clear')[0].strength).toBeGreaterThan(emittersOf(less, 'clear')[0].strength);
                expect(emittersOf(more, 'floats')[0].lines).toBe(index + 1);
                expect(emittersOf(more, 'floats')[0].strength).toBeGreaterThan(emittersOf(less, 'floats')[0].strength);
                for (const key of ENVELOPES) expect(more[key], key).toBeGreaterThanOrEqual(less[key]);
            }
            for (const key of ENVELOPES) expect(frames[3][key], key).toBeGreaterThan(frames[0][key]);
        });

        it('adds a gust front from two lines, a shooting star from three and the blizzard only for four', () => {
            const cleared = (lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [23] });
                return reactions.frame;
            };
            const [one, two, three, four] = [1, 2, 3, 4].map(cleared);
            expect(one.front).toBeNull();
            expect(two.front).not.toBeNull();
            expect(three.front).not.toBeNull();
            expect(four.front).not.toBeNull();
            expect(emittersOf(one, 'star')).toEqual([]);
            expect(emittersOf(two, 'star')).toEqual([]);
            expect(emittersOf(three, 'star')).toHaveLength(1);
            expect(emittersOf(four, 'star').length).toBeGreaterThanOrEqual(1);
            for (const frame of [one, two, three]) expect(emittersOf(frame, 'shower')).toEqual([]);
            // Hanafubuki: the crowns let go from the top, at full strength, under a flaring moon.
            const [shower] = emittersOf(four, 'shower');
            expect(shower).toMatchObject({ row: 1, lines: 4 });
            expect(shower.strength).toBeGreaterThanOrEqual(emittersOf(four, 'clear')[0].strength);
            expect(shower.duration).toBeGreaterThan(emittersOf(four, 'clear')[0].duration);
            expect(four.moon).toBeGreaterThan(three.moon);
            expect(four.glow).toBeGreaterThan(three.glow);
            // The front of a bigger clear blows harder across the garden.
            const frontAfter = (lines) => {
                const reactions = create();
                reactions.onLineClear(lines);
                return advance(reactions, 0.5).front.strength;
            };
            expect(frontAfter(4)).toBeGreaterThan(frontAfter(2));
        });

        it('falls back from cleared rows to the viewport origin, then to a default height', () => {
            const rowOf = (count, detail) => {
                const reactions = create();
                reactions.onLineClear(count, detail);
                return emittersOf(reactions.frame, 'clear').map((emitter) => emitter.row);
            };
            // The mean of the cleared rows, top of the matrix to its foot.
            expect(rowOf(1, { clearedRows: [4] })[0]).toBeCloseTo(0.975, 10);
            expect(rowOf(1, { clearedRows: [23] })[0]).toBeCloseTo(0.025, 10);
            expect(rowOf(2, { clearedRows: [13, 14] })[0]).toBeCloseTo(0.5, 10);
            // Rows that are not numbers are skipped.
            expect(rowOf(2, { clearedRows: [NaN, 23, 'x', null] })[0]).toBeCloseTo(0.025, 10);
            const fallback = rowOf(1)[0];
            expect(fallback).toBeGreaterThanOrEqual(0);
            expect(fallback).toBeLessThanOrEqual(1);
            expect(rowOf(1, { viewportOrigin: { x: 0.5, y: 0.25 } })).toEqual([0.75, 0.75]);
            expect(rowOf(1, { piece: cell(3, 4) })[0]).toBeCloseTo(0.975, 10);
            expect(rowOf(1, { clearedRows: [23], viewportOrigin: { x: 0.5, y: 0.25 } })[0]).toBeCloseTo(0.025, 10);
            // Rows beyond a standard board (Infinity mode) carry no screen meaning.
            for (const detail of [{ clearedRows: [] }, { clearedRows: 'all' }, { clearedRows: [400, 401] },
                { clearedRows: [-30] }, { clearedRows: [NaN] }, {}, null]) {
                expect(rowOf(1, detail), JSON.stringify(detail)).toEqual([fallback, fallback]);
            }
            expect(rowOf(1, { clearedRows: [400], viewportOrigin: { x: 0.5, y: 0.25 } })).toEqual([0.75, 0.75]);
        });

        it('sends each front across the view in its direction and then retires it', () => {
            const reactions = create();
            reactions.onLineClear(3);
            const first = reactions.frame.front;
            const { direction } = first;
            // It starts upwind, outside the view, with nothing behind it yet.
            expect(first.position * direction).toBeLessThan(-1);
            expect(first.strength).toBe(0);
            const trail = [];
            for (let frame = 0; frame < 600 && reactions.frame.front; frame += 1) {
                trail.push(reactions.update(1 / 60).front);
            }
            expect(trail.at(-1)).toBeNull();
            const live = trail.slice(0, -1);
            expect(live.length).toBeGreaterThan(30);
            for (let index = 1; index < live.length; index += 1) {
                expect(live[index].direction).toBe(direction);
                expect(live[index].position * direction).toBeGreaterThan(live[index - 1].position * direction);
                expect(live[index].strength).toBeGreaterThanOrEqual(0);
                expect(live[index].strength).toBeLessThanOrEqual(1);
            }
            // It swells as it enters and leaves on the far side.
            expect(Math.max(...live.map((front) => front.strength))).toBeGreaterThan(0.3);
            expect(live.at(-1).position * direction).toBeGreaterThan(1);
            expect(advance(reactions, 1).front).toBeNull();
        });

        it('alternates the direction of successive fronts and restarts each one upwind', () => {
            const reactions = create();
            const directions = [];
            for (let sweep = 0; sweep < 4; sweep += 1) {
                reactions.onLineClear(2);
                const { front } = advance(reactions, 0.4);
                directions.push(front.direction);
                expect(front.position * front.direction).toBeLessThan(0);
            }
            expect(directions[1]).toBe(-directions[0]);
            expect(directions[2]).toBe(directions[0]);
            expect(directions[3]).toBe(directions[1]);
            // A new clear replaces the front in flight instead of adding a second one.
            reactions.onLineClear(2);
            expect(reactions.frame.front.strength).toBe(0);
        });
    });

    describe('streaks and the petal stream', () => {
        it('builds a streak from consecutive clearing locks and ends it with a lock that clears nothing', () => {
            const reactions = create();
            expect(reactions.frame.streak).toBe(0);
            clearingLock(reactions);
            expect(reactions.frame.streak).toBe(1);
            clearingLock(reactions);
            expect(reactions.frame.streak).toBe(2);
            // Two clear events for one lock (a cascade) are still one step.
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(2);
            clearingLock(reactions, 3);
            expect(reactions.frame.streak).toBe(3);
            // This lock keeps the streak until the next one proves nothing was cleared.
            reactions.onPieceLock({ piece: cell(4, 22) });
            expect(reactions.frame.streak).toBe(3);
            reactions.onPieceLock({ piece: cell(4, 22) });
            expect(reactions.frame.streak).toBe(0);
            clearingLock(reactions);
            expect(reactions.frame.streak).toBe(1);
        });

        it('counts a clear that arrives before any lock as the first step', () => {
            const reactions = create();
            reactions.onLineClear(1);
            expect(reactions.frame.streak).toBe(1);
            clearingLock(reactions);
            expect(reactions.frame.streak).toBe(2);
        });

        it('winds the stream higher the longer the streak runs', () => {
            const vortexAfter = (steps) => {
                const reactions = create();
                for (let step = 0; step < steps; step += 1) clearingLock(reactions);
                return advance(reactions, 1.5).vortex;
            };
            // One clear is not a streak.
            expect(vortexAfter(1)).toBe(0);
            const heights = [2, 3, 5, 8].map(vortexAfter);
            expect(heights[0]).toBeGreaterThan(0);
            for (let index = 1; index < heights.length; index += 1) {
                expect(heights[index]).toBeGreaterThan(heights[index - 1]);
            }
            expect(heights.at(-1)).toBeLessThanOrEqual(1);
        });

        it('holds the stream while it winds, then unwinds it to rest', () => {
            const reactions = create();
            reactions.onCombo(12);
            const samples = [];
            for (let frame = 0; frame < 60 * 40; frame += 1) {
                const { vortex, heat } = reactions.update(1 / 60);
                samples.push({ vortex, heat });
            }
            const peak = Math.max(...samples.map((sample) => sample.vortex));
            const peakAt = samples.findIndex((sample) => sample.vortex === peak);
            expect(peak).toBeGreaterThan(0.5);
            expect(peak).toBeLessThanOrEqual(1);
            // It rises quickly, and nothing lifts it again once the combo is over.
            expect(peakAt).toBeGreaterThan(10);
            for (let index = 1; index <= peakAt; index += 1) {
                expect(samples[index].vortex).toBeGreaterThanOrEqual(samples[index - 1].vortex);
            }
            for (let index = peakAt + 1; index < samples.length; index += 1) {
                expect(samples[index].vortex).toBeLessThanOrEqual(samples[index - 1].vortex);
            }
            expect(samples.at(-1)).toEqual({ vortex: 0, heat: 0 });
            // The glow goes before the wind does.
            const heatGone = samples.findIndex((sample, index) => index > peakAt && sample.heat === 0);
            const windGone = samples.findIndex((sample, index) => index > peakAt && sample.vortex === 0);
            expect(heatGone).toBeGreaterThan(peakAt);
            expect(heatGone).toBeLessThan(windGone);
        });

        it('only lets the stream glow once it has really built', () => {
            const reactions = create();
            const samples = [];
            const record = (seconds) => {
                for (let frame = 0; frame < seconds * 60; frame += 1) {
                    const { vortex, heat } = reactions.update(1 / 60);
                    samples.push({ vortex, heat });
                }
            };
            clearingLock(reactions);
            clearingLock(reactions);
            record(8);
            for (let count = 2; count <= 14; count += 1) {
                reactions.onCombo(count);
                record(0.5);
            }
            record(20);
            // Heat is a function of the stream's height alone: zero while it is low, rising with it.
            expect(samples.some((sample) => sample.vortex > 0.05 && sample.heat === 0)).toBe(true);
            expect(samples.some((sample) => sample.heat > 0.5)).toBe(true);
            const byHeight = [...samples].sort((a, b) => a.vortex - b.vortex);
            for (let index = 1; index < byHeight.length; index += 1) {
                expect(byHeight[index].heat).toBeGreaterThanOrEqual(byHeight[index - 1].heat);
            }
            for (const sample of samples) {
                if (sample.vortex === 0) expect(sample.heat).toBe(0);
                expect(sample.heat).toBeLessThanOrEqual(1);
            }
        });

        it('keeps the stream up while clears keep coming and never lets a smaller event lower it', () => {
            const reactions = create();
            reactions.onCombo(10);
            const high = advance(reactions, 1.5).vortex;
            // A small combo arriving on top keeps the higher target.
            for (let beat = 0; beat < 12; beat += 1) {
                reactions.onCombo(2);
                expect(advance(reactions, 1).vortex).toBeGreaterThanOrEqual(high - 1e-9);
            }
            // Left alone, it comes down.
            expect(advance(reactions, 30).vortex).toBe(0);
        });
    });

    describe('foxfire and the constellations', () => {
        it('lights one more spirit flame for every step of a combo, up to the full ring', () => {
            const flamesAfter = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                return advance(reactions, 1.5).foxfire;
            };
            // The first step of a combo lights the first flame.
            expect(Math.round(flamesAfter(2))).toBe(1);
            for (const count of [2, 3, 4, 6, 9]) {
                expect(flamesAfter(count + 1) - flamesAfter(count)).toBeCloseTo(1, 1);
            }
            expect(Math.round(flamesAfter(60))).toBe(SAKURA_MAX_FOXFIRE);
            expect(flamesAfter(60)).toBeLessThanOrEqual(SAKURA_MAX_FOXFIRE);
            expect(flamesAfter(1)).toBe(0);
        });

        it('lights flames for a streak of clearing locks as it does for a combo', () => {
            const reactions = create();
            clearingLock(reactions);
            expect(advance(reactions, 1).foxfire).toBe(0);
            clearingLock(reactions);
            expect(Math.round(advance(reactions, 1).foxfire)).toBe(1);
            clearingLock(reactions);
            clearingLock(reactions);
            expect(Math.round(advance(reactions, 1).foxfire)).toBe(3);
        });

        it('kindles flames one after another rather than all at once, and lets them go out', () => {
            const reactions = create();
            reactions.onCombo(9);
            const trail = [];
            for (let frame = 0; frame < 60 * 30; frame += 1) trail.push(reactions.update(1 / 60).foxfire);
            const peak = Math.max(...trail);
            const peakAt = trail.indexOf(peak);
            expect(trail[0]).toBeGreaterThan(0);
            expect(trail[0]).toBeLessThan(peak / 2);
            for (let index = 1; index <= peakAt; index += 1) {
                expect(trail[index]).toBeGreaterThanOrEqual(trail[index - 1]);
            }
            for (let index = peakAt + 1; index < trail.length; index += 1) {
                expect(trail[index]).toBeLessThanOrEqual(trail[index - 1]);
            }
            expect(trail.at(-1)).toBe(0);
        });

        it('draws the constellations in as a combo builds and lets them fade long after the stream', () => {
            const tracedBy = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                return advance(reactions, 3);
            };
            const small = tracedBy(2);
            const large = tracedBy(12);
            expect(small.constellation).toBeGreaterThan(0);
            expect(large.constellation).toBeGreaterThan(small.constellation);
            // Figures are faint until traced, then burn with the combo.
            for (const frame of [small, large]) {
                expect(frame.figures).toBeGreaterThanOrEqual(frame.constellation);
                expect(frame.figures).toBeLessThanOrEqual(1);
                expect(frame.spirit).toBeGreaterThan(0);
            }
            expect(large.spirit).toBeGreaterThan(small.spirit);

            const reactions = create();
            reactions.onCombo(12);
            const windGone = secondsUntil(reactions, (frame) => frame.vortex === 0);
            expect(reactions.frame.constellation).toBeGreaterThan(0);
            expect(reactions.frame.figures).toBeGreaterThan(0);
            const skyDark = windGone + secondsUntil(reactions, (frame) => frame.constellation === 0);
            expect(skyDark).toBeGreaterThan(windGone);
            expect(skyDark).toBeLessThan(120);
            expect(reactions.frame.figures).toBe(0);
        });

        it('is drawn a stroke at a time: the sky lags the event that traces it', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const early = advance(reactions, 0.25).constellation;
            const later = advance(reactions, 2).constellation;
            expect(early).toBeGreaterThan(0);
            expect(early).toBeLessThan(0.9);
            expect(later).toBeGreaterThan(early * 1.5);
        });
    });

    describe('combos', () => {
        it('starts at two and keeps growing with the count', () => {
            const combo = (count) => {
                const reactions = create();
                expect(reactions.onCombo(count)).toBe(true);
                return reactions.frame;
            };
            const frames = [2, 4, 7, 12, 30].map(combo);
            frames.forEach((frame, index) => {
                const [ring] = emittersOf(frame, 'combo');
                expect(ring.lines).toBe([2, 4, 7, 12, 30][index]);
                for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThan(0);
                if (index > 0) {
                    const [previous] = emittersOf(frames[index - 1], 'combo');
                    expect(ring.strength).toBeGreaterThanOrEqual(previous.strength);
                    for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThanOrEqual(frames[index - 1][key]);
                }
                expectBounded(frame);
            });
            expect(emittersOf(frames[2], 'combo')[0].strength)
                .toBeGreaterThan(emittersOf(frames[0], 'combo')[0].strength);
            expect(frames[0].front).toBeNull();
        });

        it('adds a shooting star to a long combo and a flight of sky lanterns to a longer one', () => {
            const kinds = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                return kindsOf(reactions.frame);
            };
            expect(kinds(2)).toEqual(['combo']);
            const firstStar = [...Array(30).keys()].find((count) => kinds(count).includes('star'));
            const firstLanterns = [...Array(30).keys()].find((count) => kinds(count).includes('lanterns'));
            expect(firstStar).toBeGreaterThan(2);
            expect(firstLanterns).toBeGreaterThan(firstStar);
            // Once earned, a reward is never withdrawn by a longer combo.
            for (let count = firstStar; count < 40; count += 1) expect(kinds(count)).toContain('star');
            for (let count = firstLanterns; count < 40; count += 1) {
                expect(kinds(count)).toEqual(['combo', 'lanterns', 'star']);
            }
        });

        it('ignores zero and single combos without disturbing an existing clear response', () => {
            const reactions = create();
            reactions.onLineClear(2, { clearedRows: [22, 23] });
            advance(reactions, 0.2);
            const before = reactions.getFrame();
            for (const count of [0, 1, -3, '1', { comboCount: 1 }, { detail: { combo: 0 } }]) {
                expect(reactions.onCombo(count)).toBe(false);
            }
            expect(reactions.onCombo()).toBe(false);
            expect(reactions.getFrame()).toEqual(before);
            expect(advance(reactions, 2).vortex).toBe(0);
        });

        it('caps runaway counts', () => {
            const frameFor = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                return advance(reactions, 1);
            };
            expect(frameFor(100000)).toEqual(frameFor(60));
            expect(frameFor(61)).toEqual(frameFor(60));
            expectBounded(frameFor(100000));
        });
    });

    describe('payload hygiene', () => {
        it('rejects malformed counts without throwing or exciting envelopes', () => {
            const reactions = create();
            for (const count of MALFORMED_COUNTS) {
                expect(reactions.onLineClear(count), String(count)).toBe(false);
                expect(reactions.onCombo(count), String(count)).toBe(false);
                expect(reactions.onLineClear(count, { lineCount: 4 }), String(count)).toBe(false);
            }
            expect(reactions.getFrame()).toEqual(REST_FRAME);
            expect(reactions.streak).toBe(0);
        });

        it('leaves a live frame untouched when a malformed count arrives mid-celebration', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onLineClear(4);
            reactions.onCombo(6);
            advance(reactions, 0.3);
            const before = reactions.getFrame();
            for (const count of MALFORMED_COUNTS) {
                reactions.onLineClear(count);
                reactions.onCombo(count);
            }
            expect(reactions.getFrame()).toEqual(before);
        });

        it('accepts wrapped bus payloads and numeric strings while capping oversized counts', () => {
            const lines = (payload, detail) => {
                const reactions = create();
                expect(reactions.onLineClear(payload, detail)).toBe(true);
                return emittersOf(reactions.frame, 'clear')[0].lines;
            };
            expect(lines('3')).toBe(3);
            expect(lines(' 2 ')).toBe(2);
            expect(lines(2.9)).toBe(2);
            expect(lines(9)).toBe(4);
            expect(lines('400')).toBe(4);
            expect(lines({ lineCount: 3 })).toBe(3);
            expect(lines({ detail: { lines: '2' } })).toBe(2);
            const combo = (payload, detail) => {
                const reactions = create();
                expect(reactions.onCombo(payload, detail)).toBe(true);
                return emittersOf(reactions.frame, 'combo')[0].lines;
            };
            expect(combo('8')).toBe(8);
            expect(combo({ detail: { comboCount: 5 } })).toBe(5);
            expect(combo(7.99)).toBe(7);
        });

        it('reads every count alias and unwraps a detail envelope in either argument', () => {
            for (const key of ['lineCount', 'lines', 'linesCleared', 'count']) {
                const reactions = create();
                expect(reactions.onLineClear({ [key]: 3, clearedRows: [4] }), key).toBe(true);
                const [jet] = emittersOf(reactions.frame, 'clear');
                expect(jet.lines).toBe(3);
                // The same payload carries the place.
                expect(jet.row).toBeCloseTo(0.975, 10);
            }
            for (const key of ['comboCount', 'combo', 'count']) {
                const reactions = create();
                expect(reactions.onCombo({ detail: { [key]: 6 } }), key).toBe(true);
                expect(emittersOf(reactions.frame, 'combo')[0].lines).toBe(6);
            }
            // The first alias that is present wins; null and undefined do not count as present.
            const mixed = create();
            mixed.onLineClear({
                lineCount: null, lines: undefined, linesCleared: 2, count: 4,
            });
            expect(emittersOf(mixed.frame, 'clear')[0].lines).toBe(2);
            // A count with a separate (possibly wrapped) detail.
            const separate = create();
            separate.onLineClear(2, { detail: { clearedRows: [4] } });
            expect(emittersOf(separate.frame, 'clear')[0].row).toBeCloseTo(0.975, 10);
            const plain = create();
            plain.onLineClear(2, { clearedRows: [23] });
            expect(emittersOf(plain.frame, 'clear')[0].row).toBeCloseTo(0.025, 10);
        });

        it('counts a bare call as one line, as the bus adapter does for an unknown payload', () => {
            const bare = create();
            const one = create();
            expect(bare.onLineClear()).toBe(true);
            one.onLineClear(1);
            expect(bare.getFrame()).toEqual(one.getFrame());
        });
    });

    describe('flourishes', () => {
        it('answers a t-spin with a spiral beside the piece and a shooting star', () => {
            const spin = (payload) => {
                const reactions = create();
                expect(reactions.onTSpin(payload)).toBe(true);
                expect(kindsOf(reactions.frame)).toEqual(['spin', 'star']);
                return { frame: reactions.frame, spiral: emittersOf(reactions.frame, 'spin')[0] };
            };
            const left = spin({ piece: cell(1, 13) });
            const right = spin({ detail: { piece: cell(8, 4) } });
            expect(left.spiral.side).toBe(-1);
            expect(left.spiral.row).toBeCloseTo(0.525, 10);
            expect(right.spiral.side).toBe(1);
            expect(right.spiral.row).toBeCloseTo(0.975, 10);
            // Without a place it still happens, on a side of its own choosing.
            const nowhere = spin();
            expect([-1, 1]).toContain(nowhere.spiral.side);
            expect(spin(null).spiral.side).toBe(nowhere.spiral.side);
            for (const key of ENVELOPES) expect(left.frame[key], key).toBeGreaterThan(0);
            expect(left.frame.front).toBeNull();
            expect(left.frame.streak).toBe(0);
            expectBounded(left.frame);
        });

        it('lets a back-to-back brighten the garden and wind the stream without throwing petals', () => {
            const reactions = create();
            expect(reactions.onBackToBack()).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([]);
            expect(frame.front).toBeNull();
            for (const key of ['glow', 'lanterns', 'moon']) expect(frame[key], key).toBeGreaterThan(0);
            const later = advance(reactions, 1.5);
            expect(later.vortex).toBeGreaterThan(0);
            expect(later.constellation).toBeGreaterThan(0);
            expect(later.foxfire).toBe(0);
            // It never lowers a stream that a long combo has already wound higher.
            const combo = create();
            combo.onCombo(20);
            const high = advance(combo, 1.5).vortex;
            combo.onBackToBack();
            expect(advance(combo, 1).vortex).toBeGreaterThanOrEqual(high - 1e-9);
        });

        it('does everything at once for a perfect clear, and lifts the fallen petals', () => {
            const reactions = create();
            expect(reactions.onPerfectClear()).toBe(true);
            const { frame } = reactions;
            expect(kindsOf(frame)).toEqual(['lanterns', 'rise', 'shower', 'star']);
            expect(frame.front).not.toBeNull();
            for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThan(0.5);
            for (const emitter of frame.emitters) expect(emitter.strength).toBeGreaterThan(0.5);
            const later = advance(reactions, 2);
            expect(later.vortex).toBeGreaterThan(0.5);
            expect(later.heat).toBeGreaterThan(0);
            expect(later.constellation).toBeGreaterThan(0.5);
            expect(later.figures).toBe(1);
            // Every flame of the ring is lit.
            expect(Math.round(later.foxfire)).toBe(SAKURA_MAX_FOXFIRE);
            // Nothing outdoes it.
            const four = create();
            four.onLineClear(4);
            four.onCombo(8);
            for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThanOrEqual(four.frame[key]);
            expectBounded(later, reactions.maxEmitters);
        });

        it('releases sky lanterns on a level up, under a gust front', () => {
            const reactions = create();
            expect(reactions.onLevelUp({ level: 4 })).toBe(true);
            const { frame } = reactions;
            expect(kindsOf(frame)).toEqual(['lanterns']);
            expect(frame.front).not.toBeNull();
            expect(frame.lanterns).toBeGreaterThan(0.5);
            for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThan(0);
            const later = advance(reactions, 1.5);
            expect(later.vortex).toBe(0);
            expect(later.foxfire).toBe(0);
            expect(later.constellation).toBeGreaterThan(0);
            // A perfect clear releases a bigger flight than a level up does.
            const perfect = create();
            perfect.onPerfectClear();
            expect(emittersOf(perfect.frame, 'lanterns')[0].strength)
                .toBeGreaterThan(emittersOf(frame, 'lanterns')[0].strength);
        });

        it('lets the wind die and the lanterns burn low at game over, without cutting petals in flight', () => {
            const reactions = create();
            clearingLock(reactions, 2);
            reactions.onCombo(10);
            advance(reactions, 1);
            const playing = reactions.getFrame();
            expect(playing.front).not.toBeNull();
            expect(playing.vortex).toBeGreaterThan(0);
            expect(playing.foxfire).toBeGreaterThan(0);
            expect(playing.hush).toBe(0);
            expect(reactions.onGameOver()).toBeUndefined();
            const over = reactions.getFrame();
            expect(over.front).toBeNull();
            expect(over.streak).toBe(0);
            // What is already in the air keeps falling.
            expect(over.emitters).toEqual(playing.emitters);
            expect(over.emitters.length).toBeGreaterThan(0);
            let previous = over;
            for (let step = 0; step < 20; step += 1) {
                const frame = advance(reactions, 0.25);
                expect(frame.vortex).toBeLessThanOrEqual(previous.vortex);
                expect(frame.foxfire).toBeLessThanOrEqual(previous.foxfire);
                expect(frame.hush).toBeGreaterThanOrEqual(previous.hush);
                expect(frame.front).toBeNull();
                previous = frame;
            }
            expect(previous.hush).toBeGreaterThan(0.5);
            expect(previous.vortex).toBeLessThan(playing.vortex / 4);
            expect(previous.foxfire).toBeLessThan(playing.foxfire / 4);
            const settled = advance(reactions, 60);
            expect(settled).toMatchObject({
                vortex: 0, heat: 0, constellation: 0, figures: 0, foxfire: 0, gust: 0, glow: 0, lanterns: 0, moon: 0,
            });
            expect(settled.emitters).toEqual([]);
            expect(settled.hush).toBeGreaterThan(0.99);
            expect(settled.hush).toBeLessThanOrEqual(1);
            expectBounded(settled);

            // Play resumes: the lanterns come back up, faster than they went down.
            reactions.onPieceLock({ piece: cell(4, 22) });
            const back = secondsUntil(reactions, (frame) => frame.hush === 0, 60);
            expect(back).toBeLessThan(20);
            expect(reactions.frame.hush).toBe(0);
        });
    });

    describe('time', () => {
        function script(fps) {
            const reactions = create();
            const run = (seconds) => advance(reactions, seconds, fps);
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onLineClear(2, { clearedRows: [22, 23] });
            run(0.5);
            reactions.onPieceLock({ piece: cell(8, 12) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            run(0.5);
            reactions.onCombo(6);
            return run(0.5);
        }

        it('advances envelopes, slow states, fronts and emitter ages alike at 30, 60 and 144 Hz', () => {
            const reference = script(60);
            expect(reference.emitters.length).toBeGreaterThan(3);
            expect(reference.vortex).toBeGreaterThan(0);
            for (const fps of [30, 144]) {
                const frame = script(fps);
                for (const key of ENVELOPES) expect(frame[key], `${key}@${fps}`).toBeCloseTo(reference[key], 9);
                for (const key of ['vortex', 'heat', 'constellation', 'figures', 'foxfire', 'hush']) {
                    expect(frame[key], `${key}@${fps}`).toBeCloseTo(reference[key], 6);
                }
                // The spirit chases the stream, so it only agrees to within a frame's lag.
                expect(Math.abs(frame.spirit - reference.spirit)).toBeLessThan(0.02);
                expect(frame.streak).toBe(reference.streak);
                expect(frame.front === null).toBe(reference.front === null);
                if (frame.front) {
                    expect(frame.front.direction).toBe(reference.front.direction);
                    expect(frame.front.position).toBeCloseTo(reference.front.position, 9);
                    expect(frame.front.strength).toBeCloseTo(reference.front.strength, 9);
                }
                const bySerial = new Map(frame.emitters.map((emitter) => [emitter.serial, emitter]));
                let compared = 0;
                for (const emitter of reference.emitters) {
                    const twin = bySerial.get(emitter.serial);
                    // Only an emitter on the very edge of its life may differ between rates.
                    if (!twin) expect(emitter.progress).toBeGreaterThan(0.999);
                    else {
                        expect(twin).toMatchObject({
                            kind: emitter.kind, side: emitter.side, id: emitter.id, seed: emitter.seed,
                        });
                        expect(twin.age).toBeCloseTo(emitter.age, 9);
                        compared += 1;
                    }
                }
                expect(compared).toBeGreaterThan(3);
            }
        });

        it('unwinds the stream at the same pace whatever the frame rate', () => {
            const unwound = [30, 60, 144].map((fps) => {
                const reactions = create();
                reactions.onPerfectClear();
                return secondsUntil(reactions, (frame) => frame.vortex === 0, 120, fps);
            });
            expect(unwound[1]).toBeGreaterThan(2);
            expect(unwound[1]).toBeLessThan(60);
            expect(Math.abs(unwound[0] - unwound[1])).toBeLessThan(0.15);
            expect(Math.abs(unwound[2] - unwound[1])).toBeLessThan(0.15);
        });

        it('decays every envelope exponentially per second, down to exactly nothing', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const start = reactions.getFrame();
            const one = advance(reactions, 1);
            const two = advance(reactions, 1);
            for (const key of ENVELOPES) {
                expect(one[key], key).toBeLessThan(start[key]);
                expect(two[key], key).toBeLessThan(one[key]);
                // A constant ratio per second is what makes the decay exponential.
                expect(two[key] / one[key]).toBeCloseTo(one[key] / start[key], 9);
            }
            const rest = advance(reactions, 120);
            for (const key of ENVELOPES) expect(rest[key], key).toBe(0);
        });

        it('comes back to rest after any celebration', () => {
            const reactions = create();
            clearingLock(reactions, 4);
            clearingLock(reactions, 2);
            reactions.onCombo(14);
            reactions.onTSpin({ piece: cell(1, 20) });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            advance(reactions, 2);
            // A lock that clears nothing ends the streak; everything else simply runs out.
            reactions.onPieceLock({ piece: cell(4, 22) });
            reactions.onPieceLock({ piece: cell(4, 22) });
            const rest = advance(reactions, 150);
            const { spirit, ...others } = rest;
            const { spirit: restSpirit, ...restOthers } = REST_FRAME;
            expect(others).toEqual(restOthers);
            expect(restSpirit).toBe(0);
            // The spirit trails the stream and the sky asymptotically.
            expect(spirit).toBeLessThan(1e-6);
            expect(spirit).toBeGreaterThanOrEqual(0);
        });

        it('ignores invalid or negative timesteps and only advances on explicit simulation updates', () => {
            const reactions = create();
            reactions.onLineClear(3);
            reactions.onCombo(5);
            advance(reactions, 0.25);
            const before = reactions.getFrame();
            const { time } = reactions;
            for (const dt of [0, -0.016, -5, NaN, Infinity, -Infinity, undefined, null, '0.016']) {
                expect(reactions.update(dt)).toEqual(before);
            }
            expect(reactions.time).toBe(time);
            expect(reactions.getFrame()).toEqual(before);
            expect(reactions.frame).toEqual(before);
            const after = reactions.update(0.016);
            expect(reactions.time).toBeCloseTo(time + 0.016, 12);
            expect(after.gust).toBeLessThan(before.gust);
            // A long frame is taken whole: emitters simply reach the end of their lives.
            const jump = reactions.update(30);
            expect(jump.emitters).toEqual([]);
            expectBounded(jump);
        });
    });

    describe('emitter slots', () => {
        it('keeps event storms bounded and reuses every preallocated slot', () => {
            for (const quality of ['Minimal', 'High']) {
                const reactions = create(quality);
                const slots = reactions.emitters;
                const objects = [...slots];
                const used = new Set();
                const events = [
                    () => reactions.onPieceLock({ piece: cell(2, 20) }),
                    () => reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] }),
                    () => reactions.onCombo(9),
                    () => reactions.onTSpin({ piece: cell(7, 10) }),
                    () => reactions.onPerfectClear(),
                    () => reactions.onLevelUp(),
                    () => reactions.onHardDrop({ distance: 12 }),
                    () => reactions.onBackToBack(),
                ];
                for (let step = 0; step < 400; step += 1) {
                    events[step % events.length]();
                    const frame = step % 3 === 0 ? reactions.update(0.03) : reactions.getFrame();
                    frame.emitters.forEach((emitter) => used.add(emitter.id));
                    expectBounded(frame, reactions.maxEmitters);
                }
                expect(used.size).toBe(reactions.maxEmitters);
                // Nothing was allocated: the pool is the same array of the same objects.
                expect(reactions.emitters).toBe(slots);
                reactions.emitters.forEach((emitter, index) => expect(emitter).toBe(objects[index]));
            }
        });

        it('reclaims the emitter furthest through its own life, not the one that started first', () => {
            const reactions = create('Minimal');
            const capacity = reactions.maxEmitters;
            // The first emitter is long-lived; a later one is short and nearly spent.
            reactions.emit('shower', { duration: 100 });
            for (let slot = 1; slot < capacity - 1; slot += 1) reactions.emit('clear', { duration: 50 });
            const brief = reactions.emit('lock', { duration: 1 });
            advance(reactions, 0.5);
            expect(reactions.frame.emitters).toHaveLength(capacity);
            const claimed = reactions.emit('spin', { duration: 2 });
            expect(claimed).toBe(brief);
            expect(claimed).toMatchObject({ kind: 'spin', age: 0, id: capacity - 1 });
            expect(kindsOf(reactions.frame)).toContain('shower');
            expect(kindsOf(reactions.frame)).not.toContain('lock');
            // With nothing to choose between, the pool is recycled in order.
            const even = create('Minimal');
            for (let slot = 0; slot < capacity; slot += 1) even.emit('clear', { duration: 10 });
            advance(even, 1);
            expect(even.emit('star', { duration: 1 }).id).toBe(0);
            expect(even.emit('star', { duration: 1 }).id).toBe(1);
        });

        it('takes a finished slot before recycling one that is still playing', () => {
            const reactions = create('Minimal');
            const capacity = reactions.maxEmitters;
            for (let slot = 0; slot < capacity; slot += 1) {
                reactions.emit('clear', { duration: slot === 3 ? 0.2 : 4 });
            }
            advance(reactions, 3);
            // Slot 3 has ended; the others are three quarters through.
            expect(capacity).toBeGreaterThan(4);
            expect(reactions.frame.emitters.map((emitter) => emitter.id))
                .toEqual([...Array(capacity).keys()].filter((id) => id !== 3));
            const reused = reactions.emit('star', { duration: 1 });
            expect(reused.id).toBe(3);
            expect(reactions.frame.emitters).toHaveLength(capacity);
            expect(emittersOf(reactions.frame, 'clear')).toHaveLength(capacity - 1);
        });

        it('numbers every emission with a fresh serial so a reused slot reads as a new event', () => {
            const reactions = create('Minimal');
            const seen = [];
            for (let event = 0; event < reactions.maxEmitters * 3; event += 1) {
                reactions.onPieceLock({ piece: cell(event % 10, 20) });
                const newest = reactions.frame.emitters.reduce((a, b) => (a.serial > b.serial ? a : b));
                seen.push({ id: newest.id, serial: newest.serial });
            }
            expect(seen.map((entry) => entry.serial)).toEqual([...Array(seen.length).keys()]);
            // Every slot was used more than once, each time under a new serial.
            for (let id = 0; id < reactions.maxEmitters; id += 1) {
                const serials = seen.filter((entry) => entry.id === id).map((entry) => entry.serial);
                expect(serials.length).toBeGreaterThan(1);
                expect(new Set(serials).size).toBe(serials.length);
            }
        });

        it('clamps what it is asked to emit into the documented ranges', () => {
            const reactions = create();
            const wild = reactions.emit('clear', {
                side: 0, column: 9, row: -4, strength: 30, lines: 2, duration: 3,
            });
            expect(wild).toMatchObject({
                column: 1, row: 0, strength: 1, lines: 2, duration: 3, active: true,
            });
            expect([-1, 1]).toContain(wild.side);
            expect(reactions.emit('lock')).toMatchObject({ kind: 'lock', column: 0.5, active: true });
            expectBounded(reactions.frame);
        });
    });

    describe('ownership', () => {
        it('protects internal state from returned snapshot mutations', () => {
            const reactions = create();
            reactions.onLineClear(3, { clearedRows: [22] });
            reactions.onCombo(4);
            advance(reactions, 0.1);
            const pristine = reactions.getFrame();
            const frame = reactions.getFrame();
            expect(frame).not.toBe(pristine);
            expect(frame.emitters).not.toBe(pristine.emitters);
            expect(frame.front).not.toBe(pristine.front);
            frame.gust = 99;
            frame.vortex = 99;
            frame.streak = 99;
            frame.front.position = 99;
            frame.front.strength = 99;
            frame.emitters[0].strength = 99;
            frame.emitters[0].kind = 'confetti';
            frame.emitters[0].active = false;
            frame.emitters.length = 0;
            expect(reactions.getFrame()).toEqual(pristine);
            expect(reactions.frame).toEqual(pristine);
        });

        it('resets in place and leaves disposed directors inert until explicitly reset', () => {
            const reactions = create();
            const slots = reactions.emitters;
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: cell(1, 20) });
            reactions.onLineClear(4);
            reactions.onCombo(9);
            reactions.onGameOver();
            advance(reactions, 1);
            expect(reactions.getFrame()).not.toEqual(REST_FRAME);
            reactions.reset();
            expect(reactions.getFrame()).toEqual(REST_FRAME);
            expect(reactions.time).toBe(0);
            expect(reactions.emitters).toBe(slots);
            // Nothing lingers: not the streak, not a loaded hard drop, not the hush. (The random
            // source is the caller's and keeps running, so only the decorative seed differs.)
            reactions.onPieceLock({ piece: cell(1, 20) });
            const fresh = create();
            fresh.onPieceLock({ piece: cell(1, 20) });
            const unseeded = (frame) => ({ ...frame, emitters: frame.emitters.map(({ seed, ...rest }) => rest) });
            expect(unseeded(reactions.getFrame())).toEqual(unseeded(fresh.getFrame()));
            expect(reactions.frame.emitters[0].serial).toBe(0);
            expect(advance(reactions, 0.5).hush).toBe(0);

            reactions.dispose();
            expect(reactions.disposed).toBe(true);
            expect(reactions.getFrame()).toEqual(REST_FRAME);
            expect(reactions.onHardDrop({ distance: 10 })).toBe(false);
            expect(reactions.onPieceLock({ piece: cell(1, 20) })).toBe(false);
            expect(reactions.onLineClear(4)).toBe(false);
            expect(reactions.onCombo(8)).toBe(false);
            expect(reactions.onTSpin()).toBe(false);
            expect(reactions.onBackToBack()).toBe(false);
            expect(reactions.onPerfectClear()).toBe(false);
            expect(reactions.onLevelUp()).toBe(false);
            expect(() => reactions.onGameOver()).not.toThrow();
            expect(reactions.update(0.5)).toEqual(REST_FRAME);
            expect(reactions.time).toBe(0);
            expect(() => reactions.dispose()).not.toThrow();

            reactions.reset();
            expect(reactions.disposed).toBe(false);
            expect(reactions.onLineClear(2)).toBe(true);
            expect(reactions.frame.emitters.length).toBeGreaterThan(0);
            expect(advance(reactions, 0.5).hush).toBe(0);
        });

        it('keeps malformed RNG values bounded and reproduces the same seeded choreography', () => {
            for (const value of [NaN, Infinity, -Infinity, -4, 0, 1, 7, undefined, 'x']) {
                const reactions = new SakuraReactions({ quality: 'Low', rng: () => value });
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.onPerfectClear();
                expectBounded(reactions.frame, reactions.maxEmitters);
            }
            // Anything that is not a function falls back to a real random source.
            for (const rng of [null, 5, 'random', {}]) {
                const reactions = new SakuraReactions({ rng });
                reactions.onLineClear(2);
                expectBounded(reactions.frame, reactions.maxEmitters);
            }
            const play = (seed) => {
                const reactions = create('High', seed);
                reactions.onPieceLock({ piece: cell(1, 20) });
                reactions.onLineClear(4);
                reactions.onCombo(7);
                reactions.onTSpin();
                return advance(reactions, 0.4);
            };
            expect(play(11)).toEqual(play(11));
            const seeds = (frame) => frame.emitters.map((emitter) => emitter.seed);
            expect(seeds(play(12))).not.toEqual(seeds(play(11)));
            // The seed only decorates an event: it never changes what happens.
            const shape = (frame) => frame.emitters.map(({ seed, ...rest }) => rest);
            expect(shape(play(12))).toEqual(shape(play(11)));
        });
    });
});
