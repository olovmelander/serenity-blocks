import { describe, expect, it } from 'vitest';
import {
    SAKURA_FRONT_SLOTS, SAKURA_MAX_FOXFIRE, SAKURA_REACTION_LIMITS, SakuraReactions,
} from '../../src/themes/sakura-twilight/sakura-reactions.js';

const ENVELOPES = ['gust', 'glow', 'lanterns', 'moon'];
const UNIT_STATES = ['vortex', 'heat', 'spirit', 'constellation', 'figures', 'hush', 'blizzard'];
/**
 * What gameplay events emit; the fever's own festival of sky lanterns comes on a cadence. The last
 * four are each event's own instrument: a hard drop's crown of spray, the cloud of fireflies three
 * and four lines raise, the back-to-back's gate and the perfect clear's star fox.
 */
const EVENT_KINDS = ['lock', 'clear', 'floats', 'star', 'shower', 'combo', 'lanterns', 'spin', 'rise', 'splash',
    'swarm', 'gate', 'spirit'];
const EMITTER_KINDS = [...EVENT_KINDS, 'festival'];
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
    // Every front crossing, the boughs' sway, how hot play runs, the crown and the corona.
    fronts: [],
    sway: 0,
    punch: 0,
    level: 0,
    fever: 0,
    stage: 0,
    crown: 0,
    corona: 0,
    // The four-line storm still in the air.
    blizzard: 0,
    leap: 0,
    motion: 1,
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
                reactions.onTwist({ piece });
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
                expect(new Set(kindsOf(frame))).toEqual(new Set(EVENT_KINDS));
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
                expect(new Set(fresh.map((emitter) => emitter.kind))).toEqual(new Set(EVENT_KINDS));
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
            // (The piece went through the card into the lake: the drop also raised its crown of spray.)
            expect(kindsOf(dropped.frame)).toEqual(['lock', 'splash']);
            expect(kindsOf(plain.frame)).toEqual(['lock']);
            // The next piece is placed gently: the charge has been spent, and it makes no spray.
            dropped.onPieceLock({ piece });
            expect(emittersOf(dropped.frame, 'lock')[1].strength).toBe(soft.strength);
            expect(emittersOf(dropped.frame, 'splash')).toHaveLength(1);
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

        it('sends every front with the prevailing breeze and never restarts or reverses one in flight', () => {
            // (It used to alternate the direction and restart the one front: every double teleported
            // the wind wall to the far edge and a cascade ping-ponged it.)
            const reactions = create();
            const directions = new Set();
            const tracks = new Map();
            const restarts = [];
            for (let sweep = 0; sweep < 6; sweep += 1) {
                reactions.onLineClear(2);
                for (let frame = 0; frame < 21; frame += 1) {
                    const { fronts } = reactions.update(1 / 60);
                    reactions.fronts.forEach((slot, index) => {
                        if (!slot.active) {
                            tracks.delete(index);
                            return;
                        }
                        const before = tracks.get(index);
                        if (before !== undefined && slot.age < before) restarts.push(index);
                        tracks.set(index, slot.age);
                    });
                    fronts.forEach((front) => directions.add(front.direction));
                }
            }
            expect([...directions]).toEqual([1]);
            expect(restarts).toEqual([]);
            // Fronts overlap instead of replacing each other, never more than the slots.
            const crossing = reactions.getFrame().fronts;
            expect(crossing.length).toBeGreaterThan(1);
            expect(crossing.length).toBeLessThanOrEqual(SAKURA_FRONT_SLOTS);
            // One that finds every slot busy joins the youngest: it grows stronger, it does not restart.
            const full = create();
            for (let sweep = 0; sweep < SAKURA_FRONT_SLOTS; sweep += 1) {
                full.onLineClear(2);
                advance(full, 0.1);
            }
            const ages = full.fronts.map((front) => front.age);
            const youngest = full.fronts.reduce((a, b) => (b.age < a.age ? b : a));
            const before = youngest.target;
            full.onLineClear(4);
            expect(full.fronts.map((front) => front.age)).toEqual(ages);
            expect(youngest.target).toBeGreaterThan(before);
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
        it('answers a twist with a spiral beside the piece and a shooting star', () => {
            const spin = (payload) => {
                const reactions = create();
                expect(reactions.onTwist(payload)).toBe(true);
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
            // (Its one emitter is the gate's: light, and a ring from its feet. No petals.)
            expect(kindsOf(frame)).toEqual(['gate']);
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
            expect(kindsOf(frame)).toEqual(['lanterns', 'rise', 'shower', 'spirit', 'star']);
            expect(frame.front).not.toBeNull();
            for (const key of ENVELOPES) expect(frame[key], key).toBeGreaterThan(0.5);
            for (const emitter of frame.emitters) expect(emitter.strength).toBeGreaterThan(0.5);
            const later = advance(reactions, 2);
            expect(later.vortex).toBeGreaterThan(0.5);
            expect(later.heat).toBeGreaterThan(0);
            expect(later.constellation).toBeGreaterThan(0.5);
            expect(later.figures).toBe(1);
            // The foxfire stays the combo's own gauge: the crown no longer lights the whole ring (only
            // the flame or two the heat of play kindles by itself).
            expect(reactions.foxfireTarget).toBe(0);
            expect(later.foxfire).toBeLessThan(SAKURA_MAX_FOXFIRE / 2);
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
            // The wind dies: a front still crossing eases away rather than snapping the trees upright.
            expect(over.front.strength).toBeLessThanOrEqual(playing.front.strength);
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
                expect(frame.front?.strength ?? 0).toBeLessThanOrEqual(previous.front?.strength ?? 0);
                if (step >= 4) expect(frame.front).toBeNull();
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
            reactions.onTwist({ piece: cell(1, 20) });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            advance(reactions, 2);
            // A lock that clears nothing ends the streak; everything else simply runs out.
            reactions.onPieceLock({ piece: cell(4, 22) });
            reactions.onPieceLock({ piece: cell(4, 22) });
            const rest = advance(reactions, 150);
            // (`leap` counts the four-line clears so far: one.)
            const { spirit, leap, ...others } = rest;
            const { spirit: restSpirit, leap: restLeap, ...restOthers } = REST_FRAME;
            expect(others).toEqual(restOthers);
            expect([restLeap, leap]).toEqual([0, 1]);
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
                    () => reactions.onTwist({ piece: cell(7, 10) }),
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
            expect(reactions.onTwist()).toBe(false);
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
                reactions.onTwist();
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

    describe('building with play', () => {
        /** One clearing lock of a chain, hard-dropped, as the game sends it. */
        const chainStep = (reactions, lines, { cascade = 1 } = {}) => {
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: cell(4, 22) });
            reactions.onLineClear(lines, { clearedRows: [23], cascadeCount: 1 });
            for (let wave = 2; wave <= cascade; wave += 1) {
                advance(reactions, 0.36);
                reactions.onCombo(wave);
                reactions.onLineClear(1, { clearedRows: [23], cascadeCount: wave });
            }
        };
        /** The tray's Fever: twelve clearing locks 0.64 s apart, a cascade, a quad and its crown. */
        const fever = (reactions) => {
            const plan = [1, 1, 2, 1, 2, 2, 3, 2, 2, 'cascade', 3, 4];
            const readings = [];
            plan.forEach((step, index) => {
                if (index > 0) advance(reactions, 0.64);
                if (step === 'cascade') chainStep(reactions, 2, { cascade: 4 });
                else chainStep(reactions, step);
                readings.push(reactions.getFrame());
            });
            advance(reactions, 0.36);
            reactions.onPerfectClear();
            return readings;
        };

        it('never cuts the light when a weak event follows a strong one', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(4, 22) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            advance(reactions, 0.1);
            const quad = reactions.getFrame();
            const alone = create();
            alone.onPieceLock({ piece: cell(4, 22) });
            alone.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            // A plain lock right after: every envelope holds or rises, and stays above the quad's
            // own fall for the next second and a half.
            reactions.onPieceLock({ piece: cell(2, 22) });
            const after = reactions.getFrame();
            for (const key of ENVELOPES) expect(after[key], key).toBeGreaterThanOrEqual(quad[key]);
            advance(alone, 0.1);
            for (let step = 0; step < 15; step += 1) {
                const both = advance(reactions, 0.1);
                const only = advance(alone, 0.1);
                for (const key of ENVELOPES) expect(both[key], key).toBeGreaterThanOrEqual(only[key] - 1e-9);
            }
            // The stream, the sky and the flames are never pulled down by a smaller event.
            const chain = create();
            clearingLock(chain, 4);
            chain.onCombo(9);
            advance(chain, 1);
            const high = chain.getFrame();
            chain.onCombo(2);
            chain.onLineClear(1);
            const low = advance(chain, 1 / 60);
            expect(low.vortex).toBeGreaterThanOrEqual(high.vortex - 1e-3);
            expect(low.constellation).toBeGreaterThanOrEqual(high.constellation - 1e-3);
            expect(low.foxfire).toBeGreaterThanOrEqual(high.foxfire - 1e-3);
        });

        it('reads hotter as a long chain goes on, crowns the quad without throwing it again, and breathes back', () => {
            const reactions = create();
            const readings = fever(reactions);
            const first = readings[0];
            const last = readings.at(-1);
            // The night deepens through the chain: the heat of play, the flames, the drawn sky.
            expect(last.level).toBeGreaterThan(first.level + 0.5);
            expect(last.fever).toBeGreaterThan(0.5);
            expect(last.stage).toBe(3);
            expect(last.foxfire).toBeGreaterThan(first.foxfire + 8);
            expect(last.constellation).toBeGreaterThan(first.constellation + 0.6);
            expect(readings[6].level).toBeGreaterThan(readings[2].level);
            expect(readings[10].fever).toBeGreaterThan(readings[6].fever);
            // A fever is the night of hanami: stars fall and sky lanterns lift in a steady festival.
            const kinds = new Set();
            for (let frame = 0; frame < 120; frame += 1) {
                reactions.update(1 / 60).emitters.forEach((emitter) => kinds.add(emitter.kind));
            }
            expect(kinds.has('festival')).toBe(true);
            // The perfect clear crowned the quad: one blizzard, one leap, the crown lit.
            const crowned = reactions.getFrame();
            expect(crowned.crown).toBeGreaterThan(0.3);
            expect(crowned.leap).toBe(1);
            const showers = reactions.emitters.filter((emitter) => emitter.active && emitter.kind === 'shower');
            expect(showers).toHaveLength(1);
            // Hands at rest: the garden breathes back to calm within seconds, its sky last.
            const rested = advance(reactions, 12);
            expect(rested.level).toBeLessThan(0.15);
            expect(rested.fever).toBe(0);
            expect(rested.stage).toBe(0);
            expect(rested.foxfire).toBeLessThan(1);
            const quiet = advance(reactions, 30);
            expect(quiet.constellation).toBeLessThan(0.05);
            expect(quiet.emitters).toEqual([]);
        });

        it('builds each cascade wave on the last instead of playing the first again', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(4, 22) });
            reactions.onLineClear(2, { clearedRows: [22, 23], cascadeCount: 1 });
            const waves = [reactions.getFrame()];
            for (let wave = 2; wave <= 5; wave += 1) {
                advance(reactions, 0.36);
                reactions.onCombo(wave);
                reactions.onLineClear(1, { clearedRows: [23], cascadeCount: wave });
                waves.push(reactions.getFrame());
            }
            const jets = (frame) => emittersOf(frame, 'clear').filter((emitter) => emitter.age === 0);
            for (let index = 2; index < waves.length; index += 1) {
                // More flames, more of the sky, stronger jets and another front each wave.
                expect(waves[index].foxfire).toBeGreaterThanOrEqual(waves[index - 1].foxfire);
                expect(jets(waves[index])[0].strength).toBeGreaterThan(jets(waves[index - 1])[0].strength);
                expect(jets(waves[index])[0].lines).toBeGreaterThanOrEqual(jets(waves[index - 1])[0].lines);
            }
            expect(waves.at(-1).fronts.length).toBeGreaterThan(1);
            // A wave of the same lock is worth a wave, not a new clear: the streak stays one.
            expect(waves.at(-1).streak).toBe(1);
        });

        it('answers a back-to-back with the moon\'s corona, wider for every one in a row', () => {
            const reactions = create();
            reactions.onBackToBack();
            const one = advance(reactions, 0.4).corona;
            expect(one).toBeGreaterThan(0.5);
            advance(reactions, 1);
            reactions.onBackToBack();
            const two = advance(reactions, 0.4).corona;
            expect(two).toBeGreaterThan(one);
            expect(advance(reactions, 20).corona).toBeLessThan(0.005);
        });

        it('shows a twist that cleared nothing as a smaller flourish', () => {
            const cleared = create();
            cleared.onTwist({ lineCount: 2, piece: cell(6, 20) });
            const empty = create();
            empty.onTwist({ lineCount: 0, piece: cell(6, 20) });
            const spin = (frame) => emittersOf(frame, 'spin')[0];
            expect(spin(empty.frame).strength).toBeGreaterThan(0);
            expect(spin(empty.frame).strength).toBeLessThan(spin(cleared.frame).strength);
            expect(emittersOf(empty.frame, 'star')).toHaveLength(1);
            expect(advance(empty, 0.2).level).toBeGreaterThan(0);
        });

        it('calms the wind, fronts and boughs under Reduce motion', () => {
            const full = create();
            const calm = create();
            calm.setMotion(0.35);
            for (const reactions of [full, calm]) {
                clearingLock(reactions, 3);
                advance(reactions, 0.5);
            }
            expect(calm.frame.motion).toBe(0.35);
            expect(calm.frame.gust).toBeCloseTo(full.frame.gust * 0.35, 9);
            expect(calm.frame.sway).toBeCloseTo(full.frame.sway * 0.35, 9);
            expect(calm.frame.front.strength).toBeCloseTo(full.frame.front.strength * 0.35, 9);
            // The light is not motion: it is the same.
            for (const key of ['glow', 'lanterns', 'moon']) expect(calm.frame[key]).toBe(full.frame[key]);
        });

        it('leans the boughs into a gust instead of jerking them', () => {
            const reactions = create();
            reactions.onLineClear(4);
            // The gust's light is there at once; the boughs follow it on a spring.
            expect(reactions.frame.gust).toBeGreaterThan(0.5);
            expect(reactions.frame.sway).toBe(0);
            const steps = [];
            let previous = 0;
            for (let frame = 0; frame < 30; frame += 1) {
                const { sway } = reactions.update(1 / 60);
                steps.push(sway - previous);
                previous = sway;
            }
            // No frame moves them more than a small share of the way.
            expect(Math.max(...steps)).toBeLessThan(0.1);
            expect(previous).toBeGreaterThan(0.3);
        });
    });
});

/**
 * The second pass over the garden's answers (2026-11): each event has an instrument no other has
 * (sakura-showpieces.js), so the director emits four more kinds — a hard drop's `splash`, three
 * and four lines' `swarm`, the back-to-back's `gate`, the perfect clear's `spirit` — and keeps one
 * more swell, the four-line `blizzard`.
 */
describe('Sakura reaction director: each event\'s own instrument', () => {
    /** Every handler in one frame, as the bus can deliver them. */
    function everything(reactions) {
        const piece = cell(1, 20);
        reactions.onHardDrop({ piece, distance: 18 });
        reactions.onPieceLock({ piece });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onCombo(9);
        reactions.onTwist({ piece });
        reactions.onBackToBack();
        reactions.onPerfectClear();
        reactions.onLevelUp();
    }

    /** Every number anywhere in a frame that is not finite, as readable paths. */
    function nonFinite(value, path = 'frame', found = []) {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) found.push(`${path} = ${value}`);
        } else if (Array.isArray(value)) value.forEach((entry, index) => nonFinite(entry, `${path}[${index}]`, found));
        else if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, entry]) => nonFinite(entry, `${path}.${key}`, found));
        }
        return found;
    }

    describe('the emitter pool', () => {
        it('is as large as the contract says at every tier', () => {
            expect(SAKURA_REACTION_LIMITS).toEqual({
                Minimal: 22, Low: 22, Medium: 24, High: 24, Ultra: 26, Extreme: 28,
            });
        });

        it.each(TIER_ORDER)('holds every handler\'s emitters and the fever\'s cadence in one frame at %s', (tier) => {
            const reactions = create(tier);
            everything(reactions);
            // Twenty emitters are asked for when everything happens at once...
            expect(reactions.serial).toBe(20);
            expect(kindsOf(reactions.frame)).toEqual(['clear', 'clear', 'combo', 'floats', 'gate', 'lanterns',
                'lanterns', 'lanterns', 'lock', 'rise', 'shower', 'spin', 'spirit', 'splash', 'star', 'star', 'star',
                'star', 'star', 'swarm']);
            // ...and a fever can add a falling star and a festival flight in the same update.
            reactions.emit('star', { strength: 0.6, duration: 1.2 });
            reactions.emit('festival', { strength: 0.8, lines: 2, duration: 1.2 });
            const { frame } = reactions;
            expect(frame.emitters).toHaveLength(22);
            const serials = frame.emitters.map((emitter) => emitter.serial).sort((a, b) => a - b);
            expect(serials).toEqual([...Array(22).keys()]);
            expect(frame.emitters.every((emitter) => emitter.age === 0)).toBe(true);
            expect(reactions.maxEmitters).toBeGreaterThanOrEqual(22);
            expectBounded(frame, reactions.maxEmitters);
            // The garden sees every one of them on the next frame, and goes on seeing them.
            const seen = reactions.update(1 / 60);
            expect(seen.emitters).toHaveLength(22);
            expect(new Set(seen.emitters.map((emitter) => emitter.kind)))
                .toEqual(new Set([...EVENT_KINDS, 'festival']));
        });

        // FAULT: sakura-reactions.js emit() (lines 316-337) gives up "the one with the least of its
        // work left", and an emitter the garden has not yet seen counts only its strength there: a
        // faint one that has never been played is given up before a jet, a shower or a lift the
        // garden has been playing for a frame and still has most of its work to do. For an emitter
        // that acts once (the gate's ring, a single line's lantern, a set-down lock) that is the
        // whole event lost. The header's "none is reclaimed before the garden has played it" holds
        // for an empty pool only. Reproduce at Minimal or Low (22 slots): onLineClear(4),
        // onPerfectClear(), onLevelUp(), update(1 / 60), then every handler in one frame: two of
        // that frame's own twenty emitters are gone, and the old clear x 2, shower and rise stay.
        it.fails('gives up what the garden has already seen before anything it has not', () => {
            for (const quality of ['Minimal', 'Low']) {
                const reactions = create(quality);
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onPerfectClear();
                reactions.onLevelUp();
                const playing = reactions.update(1 / 60).emitters.map((emitter) => emitter.serial);
                const first = reactions.serial;
                everything(reactions);
                const alive = new Set(reactions.getFrame().emitters.map((emitter) => emitter.serial));
                const unseenLost = [];
                for (let serial = first; serial < reactions.serial; serial += 1) {
                    if (!alive.has(serial)) unseenLost.push(serial);
                }
                // Room has to be made (thirty-two asked for, twenty-two slots): by the old ones.
                expect(playing.filter((serial) => alive.has(serial)).length).toBeLessThan(playing.length);
                expect(unseenLost, quality).toEqual([]);
            }
        });

        it('gives up the faintest of what the garden has not yet seen when even that is not room enough', () => {
            const reactions = create('Minimal');
            everything(reactions);
            reactions.emit('star', { strength: 0.6, duration: 1.2 });
            reactions.emit('festival', { strength: 0.8, lines: 2, duration: 1.2 });
            const before = reactions.getFrame().emitters;
            expect(before).toHaveLength(reactions.maxEmitters);
            const faintest = Math.min(...before.map((emitter) => emitter.strength));
            // A twenty-third in the same frame: something unseen has to go, and it is the least of them.
            const extra = reactions.emit('star', { strength: 0.9, duration: 1.2 });
            const after = reactions.getFrame().emitters;
            const kept = new Set(after.map((emitter) => emitter.serial));
            const lost = before.filter((emitter) => !kept.has(emitter.serial));
            expect(lost).toHaveLength(1);
            expect(lost[0].strength).toBe(faintest);
            expect(after.find((emitter) => emitter.serial === extra.serial)).toBeTruthy();
            // The full-strength instruments of the frame are all still there.
            for (const kind of ['spirit', 'swarm', 'shower', 'rise', 'spin']) {
                expect(emittersOf({ emitters: after }, kind).length, kind).toBeGreaterThan(0);
            }
        });
    });

    describe('a hard drop\'s crown of spray', () => {
        const dropLock = (distance, piece = cell(2, 22)) => {
            const reactions = create();
            if (distance !== undefined) reactions.onHardDrop({ distance });
            reactions.onPieceLock(piece === null ? undefined : { piece });
            return reactions;
        };

        it('rises for a piece that fell some way, and not for one set down', () => {
            for (const distance of [undefined, 0, 1, 2, 2.3]) {
                expect(kindsOf(dropLock(distance).frame), String(distance)).toEqual(['lock']);
            }
            for (const distance of [2.5, 3, 8, 16, 20, 400]) {
                expect(kindsOf(dropLock(distance).frame), String(distance)).toEqual(['lock', 'splash']);
            }
            // A soft drop, a lock delay, a piece that simply landed: no hard drop, no spray.
            const soft = create();
            for (let lock = 0; lock < 6; lock += 1) soft.onPieceLock({ piece: cell(lock, 22) });
            expect(emittersOf(soft.frame, 'splash')).toEqual([]);
        });

        it('is as tall as the piece fell far, beside the board where the piece is', () => {
            for (const [distance, strength] of [[3, 0.15], [10, 0.5], [16, 0.8], [20, 1], [400, 1]]) {
                for (const [piece, side, column] of [[cell(1, 22), -1, 0.15], [cell(8, 10), 1, 0.85]]) {
                    const { frame } = dropLock(distance, piece);
                    const [lock] = emittersOf(frame, 'lock');
                    const [splash] = emittersOf(frame, 'splash');
                    expect(splash.strength).toBeCloseTo(strength, 12);
                    expect(splash.side).toBe(side);
                    expect(splash.side).toBe(lock.side);
                    expect(splash.column).toBeCloseTo(column, 12);
                    expect(splash.column).toBe(lock.column);
                    expect(splash).toMatchObject({
                        age: 0, duration: 0.5, lines: 0, serial: lock.serial + 1,
                    });
                }
            }
            // A longer fall is a taller crown.
            const strengths = [3, 6, 12, 18]
                .map((distance) => emittersOf(dropLock(distance).frame, 'splash')[0].strength);
            expect([...strengths].sort((a, b) => a - b)).toEqual(strengths);
            expect(new Set(strengths).size).toBe(4);
        });

        it('is spent with its drop: the next piece raises none unless it was dropped too', () => {
            const reactions = create();
            reactions.onHardDrop({ distance: 15 });
            reactions.onPieceLock({ piece: cell(1, 22) });
            reactions.onPieceLock({ piece: cell(5, 22) });
            reactions.onHardDrop({ distance: 15 });
            reactions.onPieceLock({ piece: cell(8, 22) });
            expect(kindsOf(reactions.frame)).toEqual(['lock', 'lock', 'lock', 'splash', 'splash']);
            expect(emittersOf(reactions.frame, 'splash').map((emitter) => emitter.side)).toEqual([-1, 1]);
            // It is over in half a second; the lock's puff outlives it.
            const later = advance(reactions, 0.6);
            expect(emittersOf(later, 'splash')).toEqual([]);
            expect(emittersOf(later, 'lock').length).toBeGreaterThan(0);
        });

        // FAULT: sakura-reactions.js onPieceLock() (lines 436-446) hands the lock and its splash
        // the same `side` of 0 when the lock cannot be placed (a payload with no piece and no
        // viewport origin), and emit() then picks a side from the serial's parity (line 342): the
        // two emitters have consecutive serials, so the crown of spray stands on the opposite side
        // of the board from the lock's puff of petals. Reproduce: reactions.onHardDrop({ distance:
        // 16 }); reactions.onPieceLock(); the frame's lock has side -1 and its splash side 1.
        it.fails('stands on the side the lock\'s puff took when the lock could not be placed', () => {
            for (let locks = 0; locks < 4; locks += 1) {
                const reactions = create();
                for (let before = 0; before < locks; before += 1) reactions.onPieceLock();
                reactions.onHardDrop({ distance: 16 });
                reactions.onPieceLock();
                const lock = emittersOf(reactions.frame, 'lock').at(-1);
                const [splash] = emittersOf(reactions.frame, 'splash');
                expect(splash.side, `after ${locks} locks`).toBe(lock.side);
            }
        });
    });

    describe('the fireflies\' swarm', () => {
        it('rises for three lines and for four, whole for four, and not for fewer', () => {
            const cleared = (lines, detail = { clearedRows: [23] }) => {
                const reactions = create();
                reactions.onLineClear(lines, detail);
                return emittersOf(reactions.frame, 'swarm');
            };
            expect(cleared(1)).toEqual([]);
            expect(cleared(2)).toEqual([]);
            expect(cleared(3)).toHaveLength(1);
            expect(cleared(3)[0]).toMatchObject({
                strength: 0.8, lines: 3, duration: 3.4, age: 0,
            });
            expect(cleared(4)).toHaveLength(1);
            expect(cleared(4)[0]).toMatchObject({
                strength: 1, lines: 4, duration: 3.4, age: 0,
            });
            // A later wave of a cascade is one line: a wave, not a swarm.
            expect(cleared(1, { clearedRows: [23], cascadeCount: 3 })).toEqual([]);
            expect(cleared(3, { clearedRows: [23], cascadeCount: 3 })).toHaveLength(1);
            // The far-shore wave it replaced is gone.
            const reactions = create();
            reactions.onLineClear(4);
            expect(emittersOf(reactions.frame, 'shore')).toEqual([]);
        });

        it('plays its whole life when nothing presses on the pool', () => {
            const reactions = create('Minimal');
            reactions.onLineClear(3, { clearedRows: [23] });
            const [{ serial }] = emittersOf(reactions.frame, 'swarm');
            let frames = 0;
            let last = 0;
            for (;;) {
                const frame = reactions.update(1 / 60);
                const live = frame.emitters.find((emitter) => emitter.serial === serial);
                if (!live) break;
                expect(live.age).toBeGreaterThan(last);
                last = live.age;
                frames += 1;
            }
            expect(frames / 60).toBeGreaterThan(3.4 - 2 / 60);
            expect(frames / 60).toBeLessThan(3.4 + 2 / 60);
        });

        // FAULT: sakura-reactions.js WORK_SECONDS (line 102) has no entry for 'swarm', so emit()
        // (lines 326-330) counts a swarm that has been seen for one frame as having no work left —
        // but its work is its whole 3.4 s (the petal director reads the fireflies' height from its
        // age every frame). With the pool full it is given up before emitters that really are
        // spent (a lock 0.3 s old only lingers), and `env.swarm` falls from its height to nothing
        // in one frame: the cloud of fireflies snaps back onto the grass. In ten-minute scripted
        // sessions of fast play (a lock every 0.4-0.7 s, half of them clearing) this cut 40 of 545
        // swarms at Minimal, 19 at High and 3 at Extreme; steady play never fills the pool.
        // Reproduce: below — three lines, 1.7 s, then locks until the pool is full of spent ones.
        it.fails('is not given up at its height while emitters that have done their work are there to take', () => {
            const reactions = create('Minimal');
            reactions.onLineClear(3, { clearedRows: [23] });
            const [{ serial }] = emittersOf(reactions.frame, 'swarm');
            advance(reactions, 1.7);
            // The cloud is at its height; the clear's own emitters are all but over.
            for (let lock = 0; lock < 19; lock += 1) reactions.onPieceLock({ piece: cell(lock % 10, 22) });
            advance(reactions, 0.3);
            for (let lock = 0; lock < 2; lock += 1) reactions.onPieceLock({ piece: cell(lock, 22) });
            expect(reactions.getFrame().emitters).toHaveLength(reactions.maxEmitters);
            // Nineteen of them are locks that threw their petals 0.3 s ago (their window is 0.28 s).
            reactions.onPieceLock({ piece: cell(4, 22) });
            const live = reactions.getFrame().emitters.find((emitter) => emitter.serial === serial);
            expect(live, 'the swarm, 2 s into its 3.4 s').toBeTruthy();
        });
    });

    describe('the gate', () => {
        it('wakes once for a back-to-back, taller for every one in a row', () => {
            const reactions = create();
            reactions.onBackToBack();
            const [first] = emittersOf(reactions.frame, 'gate');
            expect(first).toMatchObject({ duration: 1.2, age: 0, lines: 0 });
            expect(first.strength).toBeGreaterThanOrEqual(0.4);
            expect(first.strength).toBeLessThanOrEqual(1);
            const strengths = [first.strength];
            for (let row = 0; row < 5; row += 1) {
                advance(reactions, 0.9);
                reactions.onBackToBack();
                strengths.push(emittersOf(reactions.frame, 'gate').at(-1).strength);
            }
            // Taller for each until the gate stands whole (there the swell rides its ceiling: the
            // odd one is a hair under the last).
            for (let index = 1; index < strengths.length; index += 1) {
                expect(strengths[index]).toBeGreaterThanOrEqual(strengths[index - 1] - 1e-3);
            }
            expect(strengths[1]).toBeGreaterThan(strengths[0] + 0.1);
            expect(strengths.at(-1)).toBeGreaterThan(0.95);
            expect(strengths.at(-1)).toBeLessThanOrEqual(1);
            expectBounded(reactions.frame, reactions.maxEmitters);
        });

        it('is as strong as the corona will stand a quarter second on', () => {
            const reactions = create();
            reactions.onBackToBack();
            advance(reactions, 1.5);
            reactions.onBackToBack();
            const gate = emittersOf(reactions.frame, 'gate').at(-1);
            const soon = advance(reactions, 0.25).corona;
            expect(gate.strength).toBeCloseTo(Math.max(0.4, Math.min(1, soon / 1.6)), 6);
        });

        it('looks ahead without disturbing the present: the corona still rises from where it was', () => {
            const reactions = create();
            expect(reactions.frame.corona).toBe(0);
            reactions.onBackToBack();
            // The light has not happened yet on the frame of the event.
            expect(reactions.frame.corona).toBe(0);
            let last = 0;
            let steepest = 0;
            let peak = 0;
            for (let frame = 0; frame < 60 * 12; frame += 1) {
                const { corona } = reactions.update(1 / 60);
                expect(corona).toBeGreaterThanOrEqual(0);
                expect(corona).toBeLessThanOrEqual(1.6);
                steepest = Math.max(steepest, Math.abs(corona - last));
                peak = Math.max(peak, corona);
                last = corona;
            }
            expect(peak).toBeGreaterThan(0.9);
            // (It opens in a quarter second: a tenth of the way a frame at its quickest.)
            expect(steepest).toBeLessThan(0.1);
            // Many in one frame (a capture's `combo=5`) are one tall gate, not a broken swell.
            const many = create();
            for (let row = 0; row < 5; row += 1) many.onBackToBack();
            const gates = emittersOf(many.frame, 'gate');
            expect(gates).toHaveLength(5);
            expect(gates.at(-1).strength).toBeGreaterThanOrEqual(gates[0].strength);
            const frames = [];
            for (let frame = 0; frame < 120; frame += 1) frames.push(many.update(1 / 60).corona);
            expect(Math.max(...frames)).toBeGreaterThan(1.2);
            expect(Math.max(...frames)).toBeLessThanOrEqual(1.6);
            // It opens from nothing (five at once open it five times as fast, under the same ceiling)
            // and closes once: one rise, one fall.
            expect(frames[0]).toBeLessThan(0.3);
            const widest = frames.indexOf(Math.max(...frames));
            for (let index = 1; index < frames.length; index += 1) {
                if (index <= widest) expect(frames[index]).toBeGreaterThanOrEqual(frames[index - 1]);
                else expect(frames[index]).toBeLessThanOrEqual(frames[index - 1]);
            }
        });
    });

    describe('the star fox', () => {
        it('comes down once for every perfect clear, and is the first thing the crown asks for', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const [spirit] = emittersOf(reactions.frame, 'spirit');
            expect(emittersOf(reactions.frame, 'spirit')).toHaveLength(1);
            expect(spirit).toMatchObject({
                strength: 1, duration: 2.6, age: 0, serial: 0,
            });
            advance(reactions, 3);
            reactions.onPerfectClear();
            expect(emittersOf(reactions.frame, 'spirit')).toHaveLength(1);
            expect(emittersOf(reactions.frame, 'spirit')[0].serial).toBeGreaterThan(spirit.serial);
            // Two in one frame are two emitters (the garden flies one at a time: sakura-showpieces.js).
            const twice = create();
            twice.onPerfectClear();
            twice.onPerfectClear();
            expect(emittersOf(twice.frame, 'spirit')).toHaveLength(2);
        });

        it('draws the whole sky and leaves the foxfire to the combo', () => {
            const reactions = create();
            reactions.onPerfectClear();
            // The whole sky, the Fox with it: that is where the spirit leaves from.
            expect(reactions.constellationTarget).toBe(1);
            expect(reactions.foxfireTarget).toBe(0);
            // A combo's flames are neither put out nor topped up by the crown.
            const combo = create();
            combo.onCombo(6);
            const lit = combo.foxfireTarget;
            expect(lit).toBe(5);
            combo.onPerfectClear();
            expect(combo.foxfireTarget).toBe(lit);
            const flames = advance(combo, 1.5).foxfire;
            expect(flames).toBeGreaterThan(4);
            expect(flames).toBeLessThan(SAKURA_MAX_FOXFIRE - 2);
            // Alone, the crown's own heat kindles a few flames at most.
            const peak = { foxfire: 0 };
            for (let frame = 0; frame < 60 * 8; frame += 1) {
                peak.foxfire = Math.max(peak.foxfire, reactions.update(1 / 60).foxfire);
            }
            expect(peak.foxfire).toBeLessThan(SAKURA_MAX_FOXFIRE / 2);
            expect(advance(reactions, 0).constellation).toBeGreaterThan(0.5);
        });
    });

    describe('the blizzard', () => {
        const trace = (reactions, seconds) => {
            const values = [];
            for (let frame = 0; frame < seconds * 60; frame += 1) values.push(reactions.update(1 / 60).blizzard);
            return values;
        };
        const steepest = (values, from = 0) => values.reduce((most, value, index) => (
            Math.max(most, Math.abs(value - (index ? values[index - 1] : from)))), 0);

        it('is none at rest and for anything less than four lines', () => {
            const reactions = create();
            expect(reactions.frame.blizzard).toBe(0);
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: cell(1, 20) });
            for (const lines of [1, 2, 3]) reactions.onLineClear(lines, { clearedRows: [23] });
            reactions.onCombo(12);
            reactions.onTwist({ piece: cell(1, 20) });
            reactions.onBackToBack();
            reactions.onLevelUp();
            expect(Math.max(...trace(reactions, 6))).toBe(0);
        });

        it('builds over half a second after four lines, never past whole, and is gone in half a minute', () => {
            const reactions = create();
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            // Not there on the frame of the clear: it gathers.
            expect(reactions.frame.blizzard).toBe(0);
            const values = trace(reactions, 60);
            const peak = Math.max(...values);
            const peakAt = values.indexOf(peak) / 60;
            expect(peak).toBeGreaterThan(0.9);
            expect(peak).toBeLessThanOrEqual(1);
            expect(peakAt).toBeGreaterThan(0.5);
            expect(peakAt).toBeLessThan(2.5);
            // One rise and one long fall, a little a frame.
            for (let index = 1; index < values.length; index += 1) {
                if (index / 60 < peakAt) expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
                else if (index / 60 > peakAt + 1 / 60) expect(values[index]).toBeLessThanOrEqual(values[index - 1]);
            }
            expect(steepest(values)).toBeLessThan(0.06);
            // Still most of a storm when the shower's own petals have stopped; gone, exactly, later.
            expect(values[4 * 60]).toBeGreaterThan(0.4);
            expect(values[30 * 60]).toBeLessThan(0.01);
            expect(values.at(-1)).toBe(0);
        });

        it('answers a perfect clear with most of a storm, and adds a second quad to the first, never overfull', () => {
            const perfect = create();
            perfect.onPerfectClear();
            const crown = Math.max(...trace(perfect, 10));
            expect(crown).toBeGreaterThan(0.55);
            expect(crown).toBeLessThan(0.8);
            const single = create();
            single.onLineClear(4);
            const one = trace(single, 12);
            const double = create();
            double.onLineClear(4);
            const first = trace(double, 3);
            double.onLineClear(4);
            const second = trace(double, 9);
            const two = [...first, ...second];
            for (let index = 0; index < two.length; index += 1) {
                expect(two[index]).toBeGreaterThanOrEqual(one[index] - 1e-12);
                expect(two[index]).toBeLessThanOrEqual(1);
            }
            // The second arrives on top of what is left of the first: no dip, no step.
            expect(steepest(two)).toBeLessThan(0.06);
            expect(two[6 * 60]).toBeGreaterThan(one[6 * 60] + 0.1);
            // Everything at once is still at most a whole storm.
            const all = create();
            everything(all);
            everything(all);
            for (const value of trace(all, 10)) expect(value >= 0 && value <= 1).toBe(true);
        });

        it('thins out with the wind when the game ends instead of vanishing, and is gone once the hush settles', () => {
            const reactions = create();
            const twin = create();
            for (const each of [reactions, twin]) {
                each.onLineClear(4);
                advance(each, 1.5);
            }
            const before = reactions.getFrame().blizzard;
            expect(before).toBeGreaterThan(0.9);
            reactions.onGameOver();
            // The frame of the event itself reads what the frame before it read.
            expect(reactions.getFrame().blizzard).toBe(before);
            let last = before;
            const values = [];
            for (let frame = 0; frame < 60 * 8; frame += 1) {
                const over = reactions.update(1 / 60);
                const playing = twin.update(1 / 60);
                // No step: a few percent a frame at the most, and always down.
                expect(last - over.blizzard, `frame ${frame}`).toBeLessThan(0.03);
                expect(over.blizzard).toBeLessThanOrEqual(last + 1e-12);
                // It is the storm that would have been, under the hush that eases in.
                expect(over.blizzard).toBeCloseTo(playing.blizzard * (1 - over.hush), 12);
                expect(over.blizzard).toBeGreaterThanOrEqual(0);
                values.push(over.blizzard);
                last = over.blizzard;
            }
            // It takes a second or two to thin (half of it is still in the air after half a second)...
            expect(values[30]).toBeGreaterThan(before * 0.5);
            expect(values[3 * 60]).toBeLessThan(before * 0.12);
            // ...and once the hush has settled there is next to none, while the storm itself, had the
            // game gone on, would still be blowing.
            expect(values.at(-1)).toBeLessThan(0.002);
            expect(twin.getFrame().blizzard).toBeGreaterThan(0.15);
        });

        it('comes back without a step when play resumes under a storm still blowing', () => {
            const reactions = create();
            reactions.onLineClear(4);
            advance(reactions, 1);
            reactions.onGameOver();
            advance(reactions, 3);
            const hushed = reactions.getFrame().blizzard;
            expect(hushed).toBeLessThan(0.1);
            reactions.onPieceLock({ piece: cell(4, 22) });
            expect(reactions.getFrame().blizzard).toBe(hushed);
            const values = trace(reactions, 3);
            expect(steepest(values, hushed)).toBeLessThan(0.06);
            expect(Math.max(...values)).toBeGreaterThan(hushed + 0.15);
        });

        it('is not motion to calm here, and is forgotten by a reset', () => {
            const full = create();
            const calm = create();
            calm.setMotion(0.35);
            for (const each of [full, calm]) {
                each.onLineClear(4);
                advance(each, 1.2);
            }
            // (Reduce motion thins it where it is drawn: sakura-showpieces.js.)
            expect(calm.frame.blizzard).toBe(full.frame.blizzard);
            full.reset();
            expect(full.frame.blizzard).toBe(0);
            expect(advance(full, 2).blizzard).toBe(0);
            full.onLineClear(4);
            full.dispose();
            expect(full.frame.blizzard).toBe(0);
        });
    });

    describe('whatever it is handed', () => {
        const JUNK = [
            // Not a payload at all.
            undefined, null, '', 'x', 0, 7, -7, 0.5, NaN, Infinity, -Infinity, 1e308, -1e308, Number.MAX_SAFE_INTEGER,
            [], [1, 2], [[1]], {}, true, false, () => 4, 4n,
            // An envelope with nothing, or nonsense, in it.
            { detail: null }, { detail: 'x' }, { detail: { detail: {} } },
            // Pieces.
            { piece: 'x' }, { piece: [] }, { piece: { x: NaN, y: Infinity } },
            { piece: { x: 1e308, y: 1e308, shape: [[1, 1], [1, 1]] } },
            { piece: { x: -1e308, y: -1e308, shape: [[1]] } },
            { piece: { x: 1, y: 2, shape: [[NaN, 'a', null, {}, [], 4n, Infinity, -1]] } },
            { piece: { x: 1, y: 2, shape: { length: 3 } } },
            { viewportOrigin: { x: 1e308, y: -1e308 } }, { viewportOrigin: [0.5, 0.5] },
            // Drops.
            { distance: 1e308 }, { distance: -1e308 }, { distance: '16' }, { distance: [] },
            { startY: [], endY: [18] }, { startY: '3', endY: '19' }, { startY: -1e308, endY: 1e308 },
            // Clears and combos.
            { clearedRows: [1e308, 1e308] }, { clearedRows: [NaN, Infinity, -Infinity] },
            { clearedRows: { 0: 5, length: 1 } }, { cascadeCount: 1e308 }, { cascadeCount: -3 },
            { cascadeCount: 'deep' }, { lineCount: 1e308 }, { lineCount: [] }, { comboCount: 1e308 },
            { count: Infinity }, { level: NaN },
            {
                lineCount: 4, clearedRows: 'all', piece: 7, viewportOrigin: 9,
            },
        ];
        const HANDLERS = ['onHardDrop', 'onPieceLock', 'onLineClear', 'onCombo', 'onTwist', 'onBackToBack',
            'onPerfectClear', 'onLevelUp', 'onGameOver'];

        it.each(HANDLERS)('%s takes nonsense without throwing, and the frame stays finite and in range', (handler) => {
            const problems = [];
            JUNK.forEach((value, index) => {
                const reactions = create('Minimal', 3);
                const label = `${handler}(junk #${index})`;
                try {
                    reactions[handler](value);
                    reactions[handler](value, value);
                    reactions[handler](4, value);
                    reactions[handler]({ detail: value });
                    // The lock that follows a hard drop of nonsense, and the frames after.
                    reactions.onPieceLock(value);
                    for (const frame of [reactions.getFrame(), reactions.update(1 / 60), advance(reactions, 0.5)]) {
                        [...nonFinite(frame), ...frameProblems(frame, reactions.maxEmitters)]
                            .forEach((found) => problems.push(`${label}: ${found}`));
                    }
                } catch (error) {
                    problems.push(`${label} threw ${error?.message}`);
                }
            });
            expect(problems).toEqual([]);
        });

        it('takes all of it at once, again and again, and comes back to rest', () => {
            const reactions = create('Low', 9);
            const problems = [];
            for (let round = 0; round < 3; round += 1) {
                for (const value of JUNK) {
                    for (const handler of HANDLERS) {
                        if (handler !== 'onGameOver') reactions[handler](value, value);
                    }
                    reactions.setMotion(value);
                    const frame = reactions.update(1 / 60);
                    nonFinite(frame).forEach((found) => problems.push(found));
                    frameProblems(frame, reactions.maxEmitters).forEach((found) => problems.push(found));
                }
            }
            expect(problems).toEqual([]);
            reactions.setMotion(1);
            const rest = advance(reactions, 200);
            expect(nonFinite(rest)).toEqual([]);
            expect(rest.emitters).toEqual([]);
            for (const key of [...ENVELOPES, 'vortex', 'heat', 'constellation', 'figures', 'foxfire', 'hush',
                'blizzard', 'crown', 'corona', 'sway', 'punch', 'level', 'fever', 'stage']) {
                expect(rest[key], key).toBe(0);
            }
        });

        it('takes a step of any length: a long frame is taken whole and leaves every number finite', () => {
            for (const dt of [1e-9, 0.5, 30, 3600, 1e6, 1e12, 1e100]) {
                const reactions = create('Minimal', 5);
                everything(reactions);
                reactions.update(1 / 60);
                everything(reactions);
                const frame = reactions.update(dt);
                expect(nonFinite(frame), `dt ${dt}`).toEqual([]);
                expect(frameProblems(frame, reactions.maxEmitters), `dt ${dt}`).toEqual([]);
                expect(Number.isFinite(reactions.time)).toBe(true);
                // And play goes on from there.
                everything(reactions);
                expect(nonFinite(advance(reactions, 1)), `after dt ${dt}`).toEqual([]);
            }
        });

        // FAULT (it was there before this rework): sakura-reactions.js update(), the boughs' spring
        // (`this.sway = target + (c1 + c2 * dt) * decay`, about line 698). For a step near the
        // largest number a double holds, `c2 * dt` overflows to Infinity while `decay` has
        // underflowed to 0, and Infinity x 0 is NaN: `frame.sway` is NaN from then on (only reset()
        // clears it). The theme clamps a frame to 0.05 s, so play never reaches it. Reproduce:
        // reactions.onLineClear(4); reactions.update(1 / 60); reactions.update(1e308).sway is NaN.
        it.fails('keeps the boughs\' sway a number after the longest step there is', () => {
            const reactions = create();
            reactions.onLineClear(4);
            reactions.update(1 / 60);
            expect(nonFinite(reactions.update(1e308))).toEqual([]);
            expect(nonFinite(reactions.update(Number.MAX_VALUE))).toEqual([]);
        });

        it('reads Reduce motion as all of it, or the share it is given, never as nonsense', () => {
            const reactions = create();
            for (const [scale, motion] of [[0.35, 0.35], [0, 0], [1, 1], [7, 1], [-2, 0], [NaN, 1], [undefined, 1],
                [null, 1], ['0.5', 1], [Infinity, 1], [{}, 1]]) {
                reactions.setMotion(scale);
                expect(reactions.frame.motion, String(scale)).toBe(motion);
            }
        });
    });
});
