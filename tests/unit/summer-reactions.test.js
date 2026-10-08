import { describe, expect, it } from 'vitest';
import {
    SUMMER_BOUQUET_KINDS, SUMMER_MIXED, SUMMER_PIECE_FLOWERS, SUMMER_REACTION_LIMITS, SummerReactions,
    summerFlowerForPiece,
} from '../../src/themes/summer/summer-reactions.js';

const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const LETTERS = Object.keys(SUMMER_PIECE_FLOWERS);
// What every frame must carry for the world, the post chain and the playground to read.
const FRAME_KEYS = ['epoch', 'crown', 'heat', 'ribbons', 'streak', 'settled', 'species', 'bouquet', 'bouquetFlash',
    'bouquets', 'picked', 'front', 'rings', 'waves', 'emitters', 'gust', 'warmth', 'shafts', 'glow', 'shimmer',
    'flock', 'flutter'];
// Whole numbers and flags; every other number at the top of a frame is a level in 0..1.
const COUNTERS = ['epoch', 'streak', 'bouquets', 'picked'];
const BOARD_ROWS = 20;
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
    return new SummerReactions({ quality, rng: seededRandom(seed) });
}

/** Step the director in whole frames and return the frame it ends on. */
function advance(reactions, seconds, fps = 60) {
    const frames = Math.round(seconds * fps);
    for (let frame = 0; frame < frames; frame++) reactions.update(1 / fps);
    return reactions.getFrame();
}

/** One filled cell at board column `x`, board row `y` (rows 4..23 are the visible matrix). */
function cell(x, y, letter) {
    return letter ? {
        x, y, shape: [[1]], shapeKey: letter,
    } : { x, y, shape: [[1]] };
}

/** A piece of one of the seven kinds, resting near the foot of the board. */
function pieceOf(letter, x = 4) {
    return cell(x, 20, letter);
}

function emittersOf(frame, kind) {
    return frame.emitters.filter((emitter) => emitter.kind === kind);
}

/** The entries of a queue that have been asked for, oldest first. */
function live(queue) {
    return queue.filter((entry) => entry.serial >= 0).sort((a, b) => a.serial - b.serial);
}

function newest(queue) {
    return live(queue).at(-1);
}

/** A deep plain copy, so a held frame cannot change under the test. */
function snapshot(frame) {
    return JSON.parse(JSON.stringify(frame, (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value)));
}

const lanterns = (reactions) => Array.from(reactions.getFrame().bouquet);
const lit = (reactions) => lanterns(reactions).filter((level) => level > 0).length;

/** Every way a frame can leave its documented ranges, as readable messages. */
function frameProblems(frame, reactions) {
    const problems = [];
    const check = (condition, message) => { if (!condition) problems.push(message); };
    const unit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
    for (const key of FRAME_KEYS) check(key in frame, `missing ${key}`);
    for (const [key, value] of Object.entries(frame)) {
        if (typeof value === 'number' && !COUNTERS.includes(key)) check(unit(value), `${key} = ${String(value)}`);
    }
    check(Number.isInteger(frame.epoch) && frame.epoch >= 1, `epoch = ${String(frame.epoch)}`);
    check(Number.isInteger(frame.streak) && frame.streak >= 0, `streak = ${String(frame.streak)}`);
    check(Number.isInteger(frame.bouquets) && frame.bouquets >= 0, `bouquets = ${String(frame.bouquets)}`);
    check(
        Number.isInteger(frame.picked) && frame.picked >= 0 && frame.picked < SUMMER_BOUQUET_KINDS,
        `picked = ${String(frame.picked)}`,
    );
    check(typeof frame.settled === 'boolean', `settled = ${String(frame.settled)}`);
    check(frame.species.length >= SUMMER_BOUQUET_KINDS, `${frame.species.length} species`);
    frame.species.forEach((level, kind) => check(unit(level), `species ${kind} = ${level}`));
    check(frame.bouquet.length === SUMMER_BOUQUET_KINDS, `${frame.bouquet.length} lanterns`);
    frame.bouquet.forEach((level, kind) => check(unit(level), `lantern ${kind} = ${level}`));
    if (frame.front !== null) {
        const { front } = frame;
        check(Number.isFinite(front.position), `front.position = ${front.position}`);
        check(front.direction === 1 || front.direction === -1, `front.direction = ${front.direction}`);
        check(unit(front.strength), `front.strength = ${front.strength}`);
    }
    for (const [name, queue, places] of [['ring', frame.rings, ['column', 'row']], ['gust', frame.waves, ['column']]]) {
        const serials = queue.filter((entry) => entry.serial >= 0).map((entry) => entry.serial);
        check(new Set(serials).size === serials.length, `duplicate ${name} serials`);
        for (const entry of queue) {
            const label = `${name} ${entry.serial}`;
            check(Number.isInteger(entry.serial) && entry.serial >= -1, `${label} serial`);
            for (const key of places) check(unit(entry[key]), `${label} ${key} ${entry[key]}`);
            check(Number.isFinite(entry.strength) && entry.strength >= 0, `${label} strength ${entry.strength}`);
            if (entry.serial >= 0) check(entry.strength > 0, `${label} has no strength`);
        }
    }
    if (reactions) {
        check(frame.rings.length === reactions.rings.length, `${frame.rings.length} rings`);
        check(frame.waves.length === reactions.waves.length, `${frame.waves.length} gusts`);
        check(frame.emitters.length <= reactions.maxEmitters, `${frame.emitters.length} emitters`);
    }
    check(new Set(frame.emitters.map((emitter) => emitter.id)).size === frame.emitters.length, 'duplicate ids');
    check(
        new Set(frame.emitters.map((emitter) => emitter.serial)).size === frame.emitters.length,
        'duplicate serials',
    );
    for (const emitter of frame.emitters) {
        const label = `emitter ${emitter.id}/${emitter.kind}`;
        check(emitter.active === true, `${label} inactive`);
        check(typeof emitter.kind === 'string' && emitter.kind.length > 0, `${label} kind`);
        check(Number.isInteger(emitter.id) && emitter.id >= 0, `${label} id`);
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
        check(
            Number.isInteger(emitter.flower) && emitter.flower >= SUMMER_MIXED && emitter.flower < SUMMER_BOUQUET_KINDS,
            `${label} flower ${emitter.flower}`,
        );
    }
    return problems;
}

function expectBounded(frame, reactions) {
    expect(frameProblems(frame, reactions)).toEqual([]);
}

/** Nothing in the air, on the water or in the grass, and no lantern lit. */
function expectAtRest(frame) {
    for (const [key, value] of Object.entries(frame)) {
        if (typeof value === 'number' && key !== 'epoch') expect(value, key).toBe(0);
    }
    expect(frame.settled).toBe(false);
    expect(frame.front).toBeNull();
    expect(frame.emitters).toEqual([]);
    expect(live(frame.rings)).toEqual([]);
    expect(live(frame.waves)).toEqual([]);
    expect(Array.from(frame.species).every((level) => level === 0)).toBe(true);
    expect(Array.from(frame.bouquet).every((level) => level === 0)).toBe(true);
    expectBounded(frame);
}

/** Lock one piece of each of the given kinds, a frame apart. */
function lockKinds(reactions, letters) {
    for (const letter of letters) {
        reactions.onPieceLock({ piece: pieceOf(letter) });
        reactions.update(1 / 60);
    }
}

describe('Summer reaction director', () => {
    describe('budget and frame shape', () => {
        it('gives every quality tier a fixed pool of emitters that never grows as the tier drops', () => {
            expect(Object.keys(SUMMER_REACTION_LIMITS).sort()).toEqual([...TIERS].sort());
            expect(Object.isFrozen(SUMMER_REACTION_LIMITS)).toBe(true);
            TIERS.forEach((quality, index) => {
                const capacity = SUMMER_REACTION_LIMITS[quality];
                expect(Number.isInteger(capacity) && capacity > 0, quality).toBe(true);
                if (index > 0) expect(capacity).toBeLessThanOrEqual(SUMMER_REACTION_LIMITS[TIERS[index - 1]]);
                const reactions = create(quality);
                reactions.onPieceLock();
                expect(reactions.quality).toBe(quality);
                expect(reactions.maxEmitters).toBe(capacity);
                expect(reactions.emitters).toHaveLength(capacity);
                expect(reactions.emitters.map((emitter) => emitter.id)).toEqual([...Array(capacity).keys()]);
                expectBounded(reactions.frame, reactions);
            });
        });

        it('normalises tier names and falls back to High for anything else', () => {
            expect(create('low').quality).toBe('Low');
            expect(create('EXTREME').quality).toBe('Extreme');
            expect(create('minimal').quality).toBe('Minimal');
            expect(create('Med').quality).toBe('Medium');
            expect(create('medium').quality).toBe('Medium');
            for (const quality of ['invalid', '', undefined, null, 42, {}, ['Low']]) {
                const reactions = new SummerReactions({ quality, rng: seededRandom() });
                expect(reactions.quality).toBe('High');
                expect(reactions.maxEmitters).toBe(SUMMER_REACTION_LIMITS.High);
            }
            expect(new SummerReactions().quality).toBe('High');
        });

        it('starts at rest, in its first epoch', () => {
            const reactions = create();
            expectAtRest(reactions.getFrame());
            expect(reactions.getFrame().epoch).toBe(1);
            // Time alone starts nothing.
            expectAtRest(advance(reactions, 2));
        });

        it('reports the same documented frame from update(), getFrame() and the frame getter', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('T', 2) });
            reactions.onLineClear(4);
            const frame = reactions.update(0.1);
            for (const key of FRAME_KEYS) expect(frame, key).toHaveProperty(key);
            expect(snapshot(reactions.frame)).toEqual(snapshot(frame));
            expect(snapshot(reactions.getFrame())).toEqual(snapshot(frame));
            expect(frame.emitters.length).toBeGreaterThan(0);
            expectBounded(frame, reactions);
        });
    });

    describe('piece locks', () => {
        it('answers a lock with one puff, one ring and one gust, and nothing grander', () => {
            const reactions = create();
            expect(reactions.onPieceLock({ piece: pieceOf('S', 2) })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(['lock']);
            expect(frame.emitters[0]).toMatchObject({ age: 0, progress: 0, lines: 0 });
            expect(live(frame.rings)).toHaveLength(1);
            expect(live(frame.waves)).toHaveLength(1);
            for (const key of ['gust', 'glow', 'shimmer']) expect(frame[key], key).toBeGreaterThan(0);
            // The front, the swallows and the crown are kept for achievements.
            expect(frame.front).toBeNull();
            expect(frame.flock).toBe(0);
            expect(advance(reactions, 0.5)).toMatchObject({
                crown: 0, heat: 0, ribbons: 0, streak: 0, flock: 0, settled: false, front: null,
            });
        });

        it('places the puff, the ring and the gust beside the piece, mapping rows 4..23 from top to foot', () => {
            const placed = (piece) => {
                const reactions = create();
                reactions.onPieceLock({ piece });
                const [emitter] = reactions.frame.emitters;
                // The ring is dropped behind the same place on the board as the puff, and the
                // gust leaves the foot of the board under it.
                expect(newest(reactions.frame.rings)).toMatchObject({ column: emitter.column, row: emitter.row });
                expect(newest(reactions.frame.waves).column).toBe(emitter.column);
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
            const rows = new Set(emitters.map((emitter) => emitter.row));
            expect(rows.size).toBe(1);
            for (const emitter of emitters) expect(emitter.column).toBe(0.5);
            for (const ring of live(reactions.frame.rings)) {
                expect(ring).toMatchObject({ column: 0.5, row: emitters[0].row });
            }
            for (const wave of live(reactions.frame.waves)) expect(wave.column).toBe(0.5);
        });

        it('lets a harder drop make a stronger lock, up to the height of the board', () => {
            const answer = (distance) => {
                const reactions = create();
                if (distance !== null) expect(reactions.onHardDrop({ distance })).toBe(true);
                reactions.onPieceLock({ piece: pieceOf('J', 8) });
                const frame = snapshot(reactions.frame);
                return {
                    frame,
                    puff: emittersOf(frame, 'lock')[0].strength,
                    ring: newest(frame.rings).strength,
                    gust: newest(frame.waves).strength,
                    call: frame.species[SUMMER_PIECE_FLOWERS.J],
                };
            };
            const distances = [0, 1, 3, 6, 9, 12, 16, BOARD_ROWS];
            const answers = distances.map(answer);
            for (let index = 1; index < answers.length; index++) {
                const [softer, harder] = [answers[index - 1], answers[index]];
                for (const key of ['puff', 'ring', 'gust', 'call']) {
                    expect(harder[key], `${key} at ${distances[index]}`).toBeGreaterThan(softer[key]);
                }
                for (const key of ['gust', 'warmth', 'glow', 'shimmer']) {
                    expect(harder.frame[key], key).toBeGreaterThanOrEqual(softer.frame[key]);
                }
            }
            // No drop at all is a drop of nothing, and a fall past the board is a full one.
            expect(answer(null)).toEqual(answers[0]);
            expect(answer(400)).toEqual(answers.at(-1));
            answers.forEach(({ frame }) => expectBounded(frame));
        });

        it('shakes dandelion seed loose only for a long drop', () => {
            const dropped = (distance) => {
                const reactions = create();
                reactions.onHardDrop({ distance });
                // The drop alone is silent: it only arms the lock that follows.
                expectAtRest(reactions.frame);
                reactions.onPieceLock({ piece: pieceOf('Z', 8) });
                return reactions.frame;
            };
            const shaken = [];
            for (let distance = 0; distance <= BOARD_ROWS; distance++) {
                const frame = dropped(distance);
                const seeds = emittersOf(frame, 'seeds');
                expect(seeds.length).toBeLessThanOrEqual(1);
                shaken.push(seeds.length === 1);
                const [lock] = emittersOf(frame, 'lock');
                if (seeds.length) {
                    // Seed lifts off under the piece, on its side, and carries its flower.
                    expect(seeds[0]).toMatchObject({ side: lock.side, column: lock.column, flower: lock.flower });
                    expect(seeds[0].serial).toBeGreaterThan(lock.serial);
                }
                // One ring and one gust either way: the seed is in the air, not a second event.
                expect(live(frame.rings)).toHaveLength(1);
                expect(live(frame.waves)).toHaveLength(1);
            }
            // A tap or a short drop leaves the clocks alone; a fall down the whole board never does.
            expect(shaken.slice(0, 3)).toEqual([false, false, false]);
            expect(shaken.at(-1)).toBe(true);
            // One threshold: once a drop is long enough, every longer one is too.
            const first = shaken.indexOf(true);
            expect(shaken.slice(first).every(Boolean)).toBe(true);
            // More seed for a longer fall.
            const strength = (distance) => emittersOf(dropped(distance), 'seeds')[0].strength;
            expect(strength(BOARD_ROWS)).toBeGreaterThan(strength(first));
        });

        it('lets a hard drop strengthen the lock that follows it, and only that one', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            const gentle = emittersOf(reactions.frame, 'lock')[0].strength;
            const gentleRing = newest(reactions.frame.rings).strength;
            reactions.reset();
            reactions.onHardDrop({ distance: 14 });
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            expect(emittersOf(reactions.frame, 'lock')[0].strength).toBeGreaterThan(gentle);
            expect(newest(reactions.frame.rings).strength).toBeGreaterThan(gentleRing);
            expect(emittersOf(reactions.frame, 'seeds')).toHaveLength(1);

            // The next lock is an ordinary one again.
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            const locks = emittersOf(reactions.frame, 'lock');
            expect(locks).toHaveLength(2);
            expect(locks[1].strength).toBe(gentle);
            expect(newest(reactions.frame.rings).strength).toBe(gentleRing);
            expect(emittersOf(reactions.frame, 'seeds')).toHaveLength(1);
        });

        it('reads startY/endY and detail envelopes for a drop, and ignores malformed ones', () => {
            const strengthAfter = (payload) => {
                const reactions = create();
                reactions.onHardDrop(payload);
                reactions.onPieceLock();
                return emittersOf(reactions.frame, 'lock')[0].strength;
            };
            const none = strengthAfter({ distance: 0 });
            const ten = strengthAfter({ distance: 10 });
            expect(ten).toBeGreaterThan(none);
            expect(strengthAfter({ startY: 4, endY: 14 })).toBe(ten);
            expect(strengthAfter({ startY: '4', endY: '14' })).toBe(ten);
            expect(strengthAfter({ detail: { distance: 10 } })).toBe(ten);
            // An explicit distance wins over the two ends.
            expect(strengthAfter({ distance: 10, startY: 0, endY: 20 })).toBe(ten);
            expect(strengthAfter({ distance: 1e9 })).toBe(strengthAfter({ distance: BOARD_ROWS }));
            for (const payload of [undefined, null, {}, 12, 'far', [], { distance: 'far' }, { distance: NaN },
                { distance: -8 }, { startY: 20, endY: 2 }, { startY: 3 }, { distance: Infinity },
                { distance: true }, { detail: null }]) {
                expect(strengthAfter(payload), String(JSON.stringify(payload))).toBe(none);
            }
        });
    });

    describe('the seven flowers', () => {
        it('gives each tetromino a flower of its own', () => {
            expect(LETTERS.slice().sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
            expect(Object.isFrozen(SUMMER_PIECE_FLOWERS)).toBe(true);
            const kinds = LETTERS.map((letter) => SUMMER_PIECE_FLOWERS[letter]);
            expect(kinds.slice().sort()).toEqual([...Array(SUMMER_BOUQUET_KINDS).keys()]);
            expect(SUMMER_MIXED).toBeLessThan(0);
        });

        it('reads the flower from whichever field names the piece, in either case', () => {
            for (const letter of LETTERS) {
                const kind = SUMMER_PIECE_FLOWERS[letter];
                expect(summerFlowerForPiece({ shapeKey: letter })).toBe(kind);
                expect(summerFlowerForPiece({ type: letter })).toBe(kind);
                expect(summerFlowerForPiece({ pieceId: letter })).toBe(kind);
                expect(summerFlowerForPiece({ color: letter })).toBe(kind);
                expect(summerFlowerForPiece({ shapeKey: letter.toLowerCase() })).toBe(kind);
                // The first field that names a piece wins; fields that name none are passed over.
                expect(summerFlowerForPiece({ shapeKey: 7, type: '#ff0000', pieceId: letter })).toBe(kind);
            }
            expect(summerFlowerForPiece({ shapeKey: 'T', type: 'I' })).toBe(SUMMER_PIECE_FLOWERS.T);
        });

        it('answers a piece it cannot name with petals of every colour, and never throws', () => {
            for (const piece of [undefined, null, 0, 'T', ['T'], true, {}, { shapeKey: '' }, { shapeKey: 'X' },
                { shapeKey: 'TT' }, { shapeKey: 2 }, { type: null }, { shapeKey: 'constructor' },
                { shapeKey: 'toString' }, { shapeKey: '__proto__' }, { shapeKey: 'hasOwnProperty' },
                { shapeKey: { toUpperCase: () => 'T' } }, { color: '#b267e0' }]) {
                expect(summerFlowerForPiece(piece), String(JSON.stringify(piece))).toBe(SUMMER_MIXED);
            }
        });

        it('throws petals of the piece\'s own flower and calls on that flower alone', () => {
            for (const letter of LETTERS) {
                const kind = SUMMER_PIECE_FLOWERS[letter];
                const reactions = create();
                reactions.onPieceLock({ piece: pieceOf(letter) });
                const { frame } = reactions;
                expect(frame.emitters[0].flower).toBe(kind);
                Array.from(frame.species).forEach((level, slot) => {
                    if (slot === kind) expect(level, `${letter} calls ${slot}`).toBeGreaterThan(0);
                    else expect(level, `${letter} leaves ${slot}`).toBe(0);
                });
            }
        });

        it('calls on all seven when the piece is not named, and lets every call die away', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(3, 20) });
            const called = Array.from(reactions.frame.species);
            expect(reactions.frame.emitters[0].flower).toBe(SUMMER_MIXED);
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind++) expect(called[kind]).toBeGreaterThan(0);
            expect(new Set(called.slice(0, SUMMER_BOUQUET_KINDS)).size).toBe(1);
            // The call fades: lower a second on, gone in the end.
            const later = Array.from(advance(reactions, 1).species);
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind++) {
                expect(later[kind]).toBeGreaterThan(0);
                expect(later[kind]).toBeLessThan(called[kind]);
            }
            expect(Array.from(advance(reactions, 30).species).every((level) => level === 0)).toBe(true);
        });

        it('keeps the louder of two calls on the same flower', () => {
            const reactions = create();
            reactions.onHardDrop({ distance: BOARD_ROWS });
            reactions.onPieceLock({ piece: pieceOf('O') });
            const loud = reactions.frame.species[SUMMER_PIECE_FLOWERS.O];
            // A gentle lock of the same kind does not quieten it.
            reactions.onPieceLock({ piece: pieceOf('O') });
            expect(reactions.frame.species[SUMMER_PIECE_FLOWERS.O]).toBe(loud);
        });
    });

    describe('the bouquet', () => {
        it('lights a lantern for each new kind of flower and none for a repeat', () => {
            const reactions = create();
            expect(reactions.frame.picked).toBe(0);
            reactions.onPieceLock({ piece: pieceOf('I') });
            expect(reactions.frame.picked).toBe(1);
            expect(lit(reactions)).toBe(1);
            expect(lanterns(reactions)[SUMMER_PIECE_FLOWERS.I]).toBeGreaterThan(0);
            // The same kind again, however often, picks nothing new.
            for (let again = 0; again < 5; again++) reactions.onPieceLock({ piece: pieceOf('I', again) });
            expect(reactions.frame.picked).toBe(1);
            expect(lit(reactions)).toBe(1);
            reactions.onPieceLock({ piece: pieceOf('O') });
            expect(reactions.frame.picked).toBe(2);
            expect(lit(reactions)).toBe(2);
            expect(lanterns(reactions)[SUMMER_PIECE_FLOWERS.O]).toBe(lanterns(reactions)[SUMMER_PIECE_FLOWERS.I]);
            // Lanterns of an unfinished bouquet keep burning: they are a tally, not an envelope.
            const before = lanterns(reactions);
            expect(Array.from(advance(reactions, 20).bouquet)).toEqual(before);
            expect(reactions.frame.bouquets).toBe(0);
            expect(emittersOf(reactions.frame, 'bouquet')).toEqual([]);
        });

        it.each([
            ['in piece order', ['I', 'O', 'T', 'S', 'Z', 'J', 'L']],
            ['in reverse', ['L', 'J', 'Z', 'S', 'T', 'O', 'I']],
            ['with repeats on the way', ['T', 'T', 'S', 'I', 'S', 'L', 'T', 'Z', 'Z', 'O', 'I', 'L', 'J']],
        ])('completes the bouquet exactly once, on the seventh distinct kind (%s)', (_label, letters) => {
            const reactions = create();
            const seen = new Set();
            letters.forEach((letter, index) => {
                reactions.onPieceLock({ piece: pieceOf(letter) });
                seen.add(letter);
                const { frame } = reactions;
                const last = index === letters.length - 1;
                expect(frame.bouquets, `after ${letter}`).toBe(last ? 1 : 0);
                expect(emittersOf(frame, 'bouquet').length, `after ${letter}`).toBe(last ? 1 : 0);
                // The tally starts over the moment the bouquet is whole.
                expect(frame.picked).toBe(last ? 0 : seen.size);
                expect(frame.bouquetFlash > 0).toBe(last);
                expectBounded(frame, reactions);
                reactions.update(1 / 60);
            });
            // All seven lanterns burn, equally bright, and every flower in the meadow answers.
            const levels = lanterns(reactions);
            expect(levels.every((level) => level > 0)).toBe(true);
            expect(new Set(levels).size).toBe(1);
            const { species } = reactions.frame;
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind++) expect(species[kind]).toBeGreaterThan(0);
        });

        it('makes the seventh lock much more than a lock', () => {
            const ordinary = create();
            lockKinds(ordinary, ['I', 'O', 'T', 'S', 'Z', 'J']);
            advance(ordinary, 8);
            const completing = create();
            lockKinds(completing, ['I', 'O', 'T', 'S', 'Z', 'J']);
            advance(completing, 8);
            const asked = (reactions) => [reactions.ringSerial, reactions.waveSerial];
            const [ringsBefore, gustsBefore] = asked(completing);
            expect(asked(ordinary)).toEqual([ringsBefore, gustsBefore]);
            // The same piece in the same place: one finishes the bouquet, the other repeats a kind.
            ordinary.onPieceLock({ piece: pieceOf('J') });
            completing.onPieceLock({ piece: pieceOf('L') });
            const [plain, thrown] = [ordinary.frame, completing.frame];
            expect(plain.bouquets).toBe(0);
            expect(thrown.bouquets).toBe(1);
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter']) {
                expect(thrown[key], key).toBeGreaterThan(plain[key]);
            }
            // The maypole sends a gust of its own through the meadow; the lake gets the lock's ring only.
            expect(asked(ordinary)).toEqual([ringsBefore + 1, gustsBefore + 1]);
            expect(asked(completing)).toEqual([ringsBefore + 1, gustsBefore + 2]);
            expect(newest(thrown.waves).strength).toBeGreaterThan(newest(plain.waves).strength);
            const [burst] = emittersOf(thrown, 'bouquet');
            expect(burst.flower).toBe(SUMMER_MIXED);
            expect(burst.strength).toBeGreaterThan(emittersOf(thrown, 'lock').at(-1).strength);
            expect(burst.duration).toBeGreaterThan(emittersOf(thrown, 'lock').at(-1).duration);
        });

        it('does not pick a flower for a piece it cannot name', () => {
            const reactions = create();
            for (const piece of [undefined, null, cell(2, 20), { ...cell(2, 20), shapeKey: 'Q' }, 'T']) {
                reactions.onPieceLock({ piece });
            }
            expect(reactions.frame.picked).toBe(0);
            expect(lit(reactions)).toBe(0);
            // Nor do six kinds and any number of nameless pieces make seven.
            lockKinds(reactions, ['I', 'O', 'T', 'S', 'Z', 'J']);
            for (let lock = 0; lock < 10; lock++) reactions.onPieceLock({ piece: cell(lock, 20) });
            expect(reactions.frame.picked).toBe(6);
            expect(reactions.frame.bouquets).toBe(0);
        });

        it('holds the lanterns through the flash, then burns them down together', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            const full = lanterns(reactions)[0];
            const peak = reactions.frame.bouquetFlash;
            const timeline = [];
            for (let step = 0; step < 60 * 40; step++) {
                const frame = reactions.update(1 / 60);
                const levels = Array.from(frame.bouquet);
                // The seven burn as one.
                expect(new Set(levels).size).toBe(1);
                timeline.push({ lantern: levels[0], flash: frame.bouquetFlash });
                if (levels[0] === 0 && frame.bouquetFlash === 0) break;
            }
            for (let index = 1; index < timeline.length; index++) {
                expect(timeline[index].flash).toBeLessThanOrEqual(timeline[index - 1].flash);
                expect(timeline[index].lantern).toBeLessThanOrEqual(timeline[index - 1].lantern);
            }
            // While the flash is fresh the lanterns stay as they were ...
            const burning = timeline.findIndex((entry) => entry.lantern < full);
            expect(burning / 60).toBeGreaterThan(0.25);
            expect(timeline[burning].flash).toBeLessThan(peak);
            expect(timeline[burning].flash).toBeGreaterThan(0);
            // ... and then go out, all of them, and the flash with them.
            expect(timeline.at(-1)).toEqual({ lantern: 0, flash: 0 });
            expect(reactions.frame.bouquets).toBe(1);
            // A dark maypole is an empty tally: the next flower is the first of a new bouquet.
            reactions.onPieceLock({ piece: pieceOf('S') });
            expect(reactions.frame.picked).toBe(1);
            expect(lit(reactions)).toBe(1);
            expect(reactions.frame.bouquetFlash).toBe(0);
        });

        it('keeps a finished bouquet lit through its flash when the next piece locks at once', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            const full = lanterns(reactions)[0];
            // The very next lock would otherwise put six of the seven lanterns out while the
            // maypole is still flaring: the player would hardly ever see the bouquet whole.
            advance(reactions, 0.5);
            reactions.onPieceLock({ piece: pieceOf('Z') });
            expect(reactions.frame).toMatchObject({ picked: 1, bouquets: 1 });
            expect(reactions.frame.bouquetFlash).toBeGreaterThan(0.35);
            lanterns(reactions).forEach((level) => expect(level).toBe(full));
            // Once the flash has passed the old bouquet burns down, and what is left is the new tally.
            advance(reactions, 12);
            lanterns(reactions).forEach((level, kind) => {
                expect(level).toBe(kind === SUMMER_PIECE_FLOWERS.Z ? full : 0);
            });
        });

        it('starts a fresh bouquet on the embers when a piece locks during the burn-down', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            const full = lanterns(reactions)[0];
            // Wait until the lanterns are visibly lower but not out.
            let guard = 0;
            while (lanterns(reactions)[0] > full * 0.5 && guard++ < 60 * 40) reactions.update(1 / 60);
            const embers = lanterns(reactions);
            expect(embers[0]).toBeGreaterThan(0);
            expect(embers[0]).toBeLessThan(full);
            // A piece nobody can name leaves the embers to burn.
            reactions.onPieceLock({ piece: cell(1, 20) });
            expect(lanterns(reactions)).toEqual(embers);
            // A flower starts over: its lantern is relit at full, and the other embers are left to
            // burn out rather than snuffed.
            reactions.onPieceLock({ piece: pieceOf('Z') });
            lanterns(reactions).forEach((level, kind) => {
                expect(level).toBe(kind === SUMMER_PIECE_FLOWERS.Z ? full : embers[kind]);
            });
            expect(reactions.frame).toMatchObject({ picked: 1, bouquets: 1 });
            // The new tally is not burning down: it waits for its other six, alone.
            const fresh = Array.from(advance(reactions, 10).bouquet);
            fresh.forEach((level, kind) => expect(level).toBe(kind === SUMMER_PIECE_FLOWERS.Z ? full : 0));
            expect(Array.from(advance(reactions, 10).bouquet)).toEqual(fresh);
            lockKinds(reactions, ['Z', 'I', 'O', 'T', 'S', 'J']);
            expect(reactions.frame).toMatchObject({ picked: 6, bouquets: 1 });
            reactions.onPieceLock({ piece: pieceOf('L') });
            expect(reactions.frame).toMatchObject({ picked: 0, bouquets: 2 });
            expect(lit(reactions)).toBe(SUMMER_BOUQUET_KINDS);
        });

        it('leaves the bouquet to the pieces: no other event picks a flower or throws it', () => {
            const reactions = create();
            lockKinds(reactions, ['I', 'O', 'T']);
            const tally = lanterns(reactions);
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(9);
            reactions.onTSpin({ piece: pieceOf('T') });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            reactions.onHardDrop({ distance: 18 });
            reactions.onGameOver();
            const frame = advance(reactions, 3);
            expect(Array.from(frame.bouquet)).toEqual(tally);
            expect(frame).toMatchObject({ picked: 3, bouquets: 0, bouquetFlash: 0 });
        });
    });

    describe('line clears', () => {
        it('blows twin jets out of both sides at the cleared rows, rings the lake and stirs the meadow', () => {
            const reactions = create();
            expect(reactions.onLineClear(1, { clearedRows: [23] })).toBe(true);
            const { frame } = reactions;
            const jets = emittersOf(frame, 'clear');
            expect(frame.emitters).toHaveLength(2);
            expect(jets.map((emitter) => emitter.side)).toEqual([-1, 1]);
            for (const jet of jets) expect(jet).toMatchObject({ lines: 1, row: expect.closeTo(0.025, 12) });
            expect(jets[0].strength).toBe(jets[1].strength);
            expect(jets[0].duration).toBe(jets[1].duration);
            // One broad ring from under the whole row, and a gust from the foot of the board.
            expect(live(frame.rings)).toEqual([expect.objectContaining({ column: 0.5, row: jets[0].row })]);
            expect(live(frame.waves)).toEqual([expect.objectContaining({ column: 0.5 })]);
            // One line is not yet a wind front or a reason for the swallows to go up.
            expect(frame.front).toBeNull();
            expect(frame.flock).toBe(0);
            // The middle of several rows is where the jets leave.
            const tall = create();
            tall.onLineClear(4, { clearedRows: [10, 11, 12, 13] });
            for (const jet of emittersOf(tall.frame, 'clear')) expect(jet.row).toBeCloseTo(0.6, 12);
        });

        it('answers a clear more loudly than a lock', () => {
            const lock = create();
            lock.onHardDrop({ distance: BOARD_ROWS });
            lock.onPieceLock({ piece: pieceOf('I') });
            const clear = create();
            clear.onLineClear(1, { clearedRows: [23] });
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter']) {
                expect(clear.frame[key], key).toBeGreaterThan(lock.frame[key]);
            }
        });

        it('grows every answer with the number of lines', () => {
            const frames = [1, 2, 3, 4].map((lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [20] });
                return snapshot(reactions.frame);
            });
            const jet = (frame) => emittersOf(frame, 'clear')[0];
            for (let index = 1; index < frames.length; index++) {
                const [fewer, more] = [frames[index - 1], frames[index]];
                for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter']) {
                    expect(more[key], `${index + 1} lines ${key}`).toBeGreaterThan(fewer[key]);
                }
                expect(jet(more).strength).toBeGreaterThan(jet(fewer).strength);
                expect(jet(more).duration).toBeGreaterThanOrEqual(jet(fewer).duration);
                expect(jet(more).lines).toBe(index + 1);
                expect(live(more.rings)[0].strength).toBeGreaterThan(live(fewer.rings)[0].strength);
                expect(live(more.waves)[0].strength).toBeGreaterThan(live(fewer.waves)[0].strength);
                for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind++) {
                    expect(more.species[kind]).toBeGreaterThan(fewer.species[kind]);
                }
            }
            frames.forEach((frame) => expectBounded(frame));
        });

        it('adds a second ring and a wind front from two lines', () => {
            const cleared = (lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [22] });
                return reactions;
            };
            expect(live(cleared(1).frame.rings)).toHaveLength(1);
            expect(cleared(1).frame.front).toBeNull();
            let weaker = 0;
            for (const lines of [2, 3, 4]) {
                const reactions = cleared(lines);
                const rings = live(reactions.frame.rings);
                expect(rings).toHaveLength(2);
                // The second ring comes in from one end of the row, behind the first.
                expect(rings[0].column).toBe(0.5);
                expect(rings[1].column).not.toBe(0.5);
                expect(rings[1].row).toBe(rings[0].row);
                expect(rings[1].strength).toBeLessThan(rings[0].strength);
                // A front that has only just set out is at the upwind edge and has no force yet.
                const { front } = reactions.frame;
                expect(front).not.toBeNull();
                expect(front.position * front.direction).toBeLessThan(-1);
                expect(front.strength).toBe(0);
                // ... and carries more with more lines.
                const swell = advance(reactions, 0.6).front.strength;
                expect(swell).toBeGreaterThan(weaker);
                weaker = swell;
            }
        });

        it('keeps the rising meadow and the swallows for four lines', () => {
            const answer = (lines) => {
                const reactions = create();
                reactions.onLineClear(lines, { clearedRows: [20, 21, 22, 23].slice(0, lines) });
                return reactions;
            };
            const [two, three, four] = [2, 3, 4].map(answer);
            expect(emittersOf(three.frame, 'rise')).toHaveLength(0);
            expect(three.frame.emitters).toHaveLength(2);
            expect(three.frame.flock).toBe(0);

            expect(four.frame.emitters.map((emitter) => emitter.kind)).toEqual(['clear', 'clear', 'rise']);
            const [rise] = emittersOf(four.frame, 'rise');
            expect(rise.lines).toBe(4);
            // The rise is the long one: it outlasts the jets it comes with.
            expect(rise.duration).toBeGreaterThan(emittersOf(four.frame, 'clear')[0].duration);
            expect(rise.strength).toBeGreaterThanOrEqual(emittersOf(four.frame, 'clear')[0].strength);
            expect(four.frame.flock).toBeGreaterThan(0);
            // The sunburst: warmth and shafts jump further than one more line would take them.
            for (const key of ['warmth', 'shafts']) {
                expect(four.frame[key] - three.frame[key], key)
                    .toBeGreaterThan(three.frame[key] - two.frame[key]);
            }
            // The swallows are slow to settle: they are still up when the gust has gone.
            const later = advance(four, 3);
            expect(later.flock).toBeGreaterThan(later.gust);
        });

        it('falls back from cleared rows to the viewport origin, then the piece, then a default height', () => {
            const rowOf = (detail) => {
                const reactions = create();
                reactions.onLineClear(2, detail);
                const [left, right] = emittersOf(reactions.frame, 'clear');
                expect(left.row).toBe(right.row);
                return left.row;
            };
            const fallback = rowOf(undefined);
            expect(fallback).toBeGreaterThanOrEqual(0);
            expect(fallback).toBeLessThanOrEqual(1);
            expect(rowOf({ clearedRows: [13, 14], viewportOrigin: { x: 0.5, y: 0.1 } })).toBeCloseTo(0.5, 12);
            expect(rowOf({ clearedRows: [], viewportOrigin: { x: 0.5, y: 0.1 } })).toBeCloseTo(0.9, 12);
            expect(rowOf({ clearedRows: 'all', piece: cell(3, 13) })).toBeCloseTo(0.525, 12);
            // Non-finite rows are dropped; rows beyond a standard board carry no screen meaning.
            expect(rowOf({ clearedRows: [NaN, 13, 'x', 14, null] })).toBeCloseTo(0.5, 12);
            expect(rowOf({ clearedRows: [80, 81], viewportOrigin: { x: 0.5, y: 0.3 } })).toBeCloseTo(0.7, 12);
            for (const detail of [{}, null, { clearedRows: [NaN] }, { clearedRows: null }, 7, { clearedRows: [-9] }]) {
                expect(rowOf(detail), String(JSON.stringify(detail))).toBe(fallback);
            }
            // Rows above the visible matrix clamp to the top of the card.
            expect(rowOf({ clearedRows: [0, 1] })).toBe(1);
        });

        it('sends each front across the view in its direction and then retires it', () => {
            const reactions = create();
            reactions.onLineClear(2);
            const seen = [];
            for (let frame = 0; frame < 60 * 20; frame++) {
                const { front } = reactions.update(1 / 60);
                if (!front) break;
                seen.push({ ...front });
            }
            // It takes its time, and it does end.
            expect(seen.length).toBeGreaterThan(30);
            expect(seen.length).toBeLessThan(60 * 20);
            for (let index = 1; index < seen.length; index++) {
                expect(seen[index].position).toBeGreaterThan(seen[index - 1].position);
                expect(seen[index].direction).toBe(seen[0].direction);
            }
            // From one side of the view to the other.
            expect(seen[0].position).toBeLessThan(-1);
            expect(seen.at(-1).position).toBeGreaterThan(1);
            // It swells in, peaks in the middle of the crossing and has all but gone when it leaves.
            const strengths = seen.map((front) => front.strength);
            const peak = Math.max(...strengths);
            const at = strengths.indexOf(peak);
            expect(peak).toBeGreaterThan(0);
            expect(at).toBeGreaterThan(seen.length * 0.15);
            expect(at).toBeLessThan(seen.length * 0.85);
            expect(strengths[0]).toBeLessThan(peak * 0.25);
            expect(strengths.at(-1)).toBeLessThan(peak * 0.5);
            expect(reactions.frame.front).toBeNull();
            expect(advance(reactions, 1).front).toBeNull();
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
                expect(front.position * front.direction).toBeLessThan(-1);
                expect(front.strength).toBe(0);
            }
            expect(directions).toEqual([directions[0], -directions[0], directions[0], -directions[0]]);
            // A mirrored crossing: the front that goes the other way is where its twin would be, reflected.
            const twin = create();
            twin.onLineClear(2);
            const other = create();
            other.onLineClear(2);
            advance(other, 5);
            other.onLineClear(2);
            const [first, second] = [advance(twin, 0.8).front, advance(other, 0.8).front];
            expect(second.direction).toBe(-first.direction);
            expect(second.position).toBeCloseTo(-first.position, 9);
        });
    });

    describe('streaks, the crown and its heat', () => {
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

        it('leaves the crown alone for a single clear and winds it from the second in a row', () => {
            const single = create();
            single.onPieceLock();
            single.onLineClear(4);
            expect(advance(single, 1)).toMatchObject({ crown: 0, heat: 0, ribbons: 0 });

            const reactions = create();
            const levels = [];
            for (let streak = 1; streak <= 7; streak++) {
                reactions.onPieceLock();
                reactions.onLineClear(1);
                levels.push(advance(reactions, 1).crown);
            }
            expect(levels[0]).toBe(0);
            for (let index = 1; index < levels.length; index++) {
                expect(levels[index]).toBeGreaterThan(levels[index - 1]);
            }
            expect(levels.at(-1)).toBeGreaterThan(0.5);
            expect(levels.at(-1)).toBeLessThanOrEqual(1);
        });

        it('unfurls the ribbons before the crown brightens, and both only once it has built', () => {
            const reactions = create();
            let previous = { heat: 0, ribbons: 0 };
            let ribbonsFrom = null;
            let heatFrom = null;
            for (let step = 0; step <= 100; step++) {
                reactions.crown = step / 100;
                const { heat, ribbons } = reactions.frame;
                expect(heat).toBeGreaterThanOrEqual(previous.heat);
                expect(ribbons).toBeGreaterThanOrEqual(previous.ribbons);
                expect(ribbons).toBeGreaterThanOrEqual(heat);
                if (ribbons > 0 && ribbonsFrom === null) ribbonsFrom = step / 100;
                if (heat > 0 && heatFrom === null) heatFrom = step / 100;
                previous = { heat, ribbons };
            }
            // A young crown has neither; a full one has both in full.
            expect(ribbonsFrom).toBeGreaterThan(0.1);
            expect(heatFrom).toBeGreaterThan(ribbonsFrom);
            expect(previous).toEqual({ heat: 1, ribbons: 1 });

            // The same through play: a first combo winds a plain crown, a long one a glowing one.
            const low = create();
            low.onCombo(2);
            const young = advance(low, 1.5);
            expect(young.crown).toBeGreaterThan(0);
            expect(young.heat).toBe(0);
            const high = create();
            high.onCombo(14);
            const grown = advance(high, 1.5);
            expect(grown.crown).toBeGreaterThan(young.crown);
            expect(grown.heat).toBeGreaterThan(0);
            expect(grown.ribbons).toBeGreaterThan(young.ribbons);
        });

        it('holds the crown while clears keep coming, then unwinds it to rest with the heat gone first', () => {
            const reactions = create();
            reactions.onCombo(20);
            // It rises quickly ...
            const early = advance(reactions, 0.5).crown;
            expect(early).toBeGreaterThan(0.5);
            // ... and stays up for as long as it is fed.
            let held = early;
            for (let second = 0; second < 8; second++) {
                reactions.onCombo(20);
                const { crown } = advance(reactions, 1);
                expect(crown).toBeGreaterThanOrEqual(held - 1e-9);
                held = crown;
            }
            expect(held).toBeGreaterThan(0.9);
            expect(held).toBeLessThanOrEqual(1);
            // Left alone it lets go, the glow first, then the ribbons, then the crown itself.
            const order = [];
            let last = held;
            for (let step = 0; step < 60 * 60 && reactions.crown > 0; step++) {
                const frame = reactions.update(1 / 60);
                expect(frame.crown).toBeLessThanOrEqual(last + 1e-9);
                last = frame.crown;
                if (frame.heat === 0 && !order.includes('heat')) order.push('heat');
                if (frame.ribbons === 0 && !order.includes('ribbons')) order.push('ribbons');
                if (frame.crown === 0 && !order.includes('crown')) order.push('crown');
            }
            expect(order).toEqual(['heat', 'ribbons', 'crown']);
            expect(reactions.frame).toMatchObject({ crown: 0, heat: 0, ribbons: 0 });
        });

        it('keeps the highest crown while smaller events keep it turning, and starts the next from its own', () => {
            const reactions = create();
            reactions.onCombo(12);
            const high = advance(reactions, 1.5).crown;
            // A smaller combo and a back-to-back renew the hold without lowering the crown.
            reactions.onCombo(2);
            expect(advance(reactions, 1.5).crown).toBeGreaterThanOrEqual(high - 1e-9);
            reactions.onBackToBack();
            expect(advance(reactions, 1.5).crown).toBeGreaterThanOrEqual(high - 1e-9);
            // Left alone it finally unwinds, and the next crown is only as high as its own combo.
            expect(advance(reactions, 30).crown).toBe(0);
            reactions.onCombo(2);
            const next = advance(reactions, 1.5).crown;
            expect(next).toBeGreaterThan(0);
            expect(next).toBeLessThan(high);
        });
    });

    describe('combos', () => {
        it('answers a combo with a turn of petals around the board, a ring, a gust and a climbing crown', () => {
            const reactions = create();
            expect(reactions.onCombo(2)).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(['combo']);
            expect(frame.emitters[0]).toMatchObject({ lines: 2, flower: SUMMER_MIXED });
            expect(live(frame.rings)).toHaveLength(1);
            expect(live(frame.waves)).toHaveLength(1);
            expect(frame.flock).toBe(0);
            expect(frame.front).toBeNull();
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter']) {
                expect(frame[key], key).toBeGreaterThan(0);
            }
            expect(advance(reactions, 0.5).crown).toBeGreaterThan(0);
        });

        it('keeps growing with the count and saturates instead of overflowing', () => {
            const answer = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                const frame = snapshot(reactions.frame);
                return { frame, crown: advance(reactions, 2).crown };
            };
            const counts = [2, 3, 5, 8, 13, 21];
            const answers = counts.map(answer);
            for (let index = 1; index < answers.length; index++) {
                const [smaller, larger] = [answers[index - 1], answers[index]];
                expect(larger.crown).toBeGreaterThan(smaller.crown);
                expect(larger.frame.emitters[0].strength).toBeGreaterThanOrEqual(smaller.frame.emitters[0].strength);
                expect(live(larger.frame.rings)[0].strength).toBeGreaterThan(live(smaller.frame.rings)[0].strength);
                expect(live(larger.frame.waves)[0].strength).toBeGreaterThan(live(smaller.frame.waves)[0].strength);
                for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter']) {
                    expect(larger.frame[key], key).toBeGreaterThanOrEqual(smaller.frame[key]);
                }
            }
            expect(answers.at(-1).frame.emitters[0].strength).toBeGreaterThan(answers[0].frame.emitters[0].strength);
            // An absurd count is the largest count, not a larger answer.
            const huge = answer(1e9);
            expect(huge).toEqual(answer(1e12));
            expect(Number.isInteger(huge.frame.emitters[0].lines)).toBe(true);
            expect(huge.crown).toBeLessThanOrEqual(1);
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
            expect(advance(reactions, 1).crown).toBe(0);
        });
    });

    describe('flourishes', () => {
        it('answers a t-spin with a garland of the flower of the T beside the piece, a ring and a gust', () => {
            const reactions = create();
            expect(reactions.onTSpin({ piece: cell(8, 13) })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([expect.objectContaining({
                kind: 'spin', side: 1, row: expect.closeTo(0.525, 12), flower: SUMMER_PIECE_FLOWERS.T,
            })]);
            expect(live(frame.rings)).toEqual([expect.objectContaining({
                column: 0.85, row: expect.closeTo(0.525, 12),
            })]);
            expect(live(frame.waves)).toEqual([expect.objectContaining({ column: 0.85 })]);
            // The T's own flower is the one called on.
            Array.from(frame.species).forEach((level, kind) => {
                expect(level > 0, `kind ${kind}`).toBe(kind === SUMMER_PIECE_FLOWERS.T);
            });
            expect(frame.front).toBeNull();
            expect(frame.flock).toBe(0);
            reactions.onTSpin({ detail: { piece: cell(1, 13) } });
            expect(emittersOf(reactions.frame, 'spin')[1]).toMatchObject({ side: -1 });
            // With nothing to place it, the garland still has a side and a height.
            const bare = create();
            bare.onTSpin();
            expectBounded(bare.frame, bare);
            expect(live(bare.frame.rings)[0]).toMatchObject({ column: 0.5, row: bare.frame.emitters[0].row });
        });

        it('lets a back-to-back lift the light and hold the crown without an emitter, a ring or a gust', () => {
            const reactions = create();
            expect(reactions.onBackToBack()).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([]);
            expect(live(frame.rings)).toEqual([]);
            expect(live(frame.waves)).toEqual([]);
            for (const key of ['warmth', 'glow', 'shafts', 'shimmer']) expect(frame[key], key).toBeGreaterThan(0);
            expect(frame.gust).toBe(0);
            expect(frame.flock).toBe(0);
            const later = advance(reactions, 1.5);
            expect(later.crown).toBeGreaterThan(0);
            expect(later.ribbons).toBeGreaterThan(0);
        });

        it('makes the whole evening exhale on a perfect clear', () => {
            const reactions = create();
            const clear = create();
            clear.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            expect(reactions.onPerfectClear()).toBe(true);
            const { frame } = reactions;
            // Nothing a four-line clear does is louder.
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flock', 'flutter']) {
                expect(frame[key], key).toBeGreaterThanOrEqual(clear.frame[key]);
                expect(frame[key], key).toBeGreaterThan(0.5);
            }
            expect(emittersOf(frame, 'rise')).toHaveLength(1);
            expect(frame.emitters.length).toBeGreaterThanOrEqual(1);
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind++) expect(frame.species[kind]).toBeGreaterThan(0);
            expect(live(frame.rings).length).toBeGreaterThanOrEqual(2);
            expect(live(frame.waves).length).toBeGreaterThanOrEqual(1);
            expect(Math.max(...live(frame.rings).map((ring) => ring.strength)))
                .toBeGreaterThan(Math.max(...live(clear.frame.rings).map((ring) => ring.strength)));
            // The strongest front there is, and a crown from nothing.
            const front = advance(reactions, 1).front.strength;
            expect(front).toBeGreaterThan(advance(clear, 1).front.strength);
            expect(reactions.frame.crown).toBeGreaterThan(0.5);
            expectBounded(reactions.frame, reactions);
        });

        it('rings the lake, stirs the meadow and sweeps a front on a level up', () => {
            const reactions = create();
            expect(reactions.onLevelUp()).toBe(true);
            const { frame } = reactions;
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flock', 'flutter']) {
                expect(frame[key], key).toBeGreaterThan(0);
            }
            expect(live(frame.rings).length).toBeGreaterThanOrEqual(1);
            expect(live(frame.waves).length).toBeGreaterThanOrEqual(1);
            expect(frame.front).not.toBeNull();
            // A level is not a combo: the crown stays down.
            expect(advance(reactions, 1).crown).toBe(0);
            // It is a smaller thing than a perfect clear.
            const perfect = create();
            perfect.onPerfectClear();
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flock', 'flutter']) {
                expect(frame[key], key).toBeLessThanOrEqual(perfect.frame[key]);
            }
            expect(newest(frame.rings).strength).toBeLessThan(live(perfect.frame.rings)[0].strength);
            expect(newest(frame.waves).strength).toBeLessThan(newest(perfect.frame.waves).strength);
        });

        it('settles the evening at game over without cutting the petals already in flight', () => {
            const play = () => {
                const reactions = create();
                reactions.onPieceLock({ piece: pieceOf('I', 1) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(9);
                advance(reactions, 0.6);
                return reactions;
            };
            const reactions = play();
            const playing = snapshot(reactions.frame);
            expect(playing.settled).toBe(false);
            expect(playing.front).not.toBeNull();
            expect(playing.crown).toBeGreaterThan(0.5);

            expect(reactions.onGameOver()).toBe(true);
            const over = snapshot(reactions.frame);
            expect(over.settled).toBe(true);
            expect(over.front).toBeNull();
            expect(over.streak).toBe(0);
            // Nothing is cut: emitters, envelopes, lanterns, rings and gusts already asked for play out.
            expect({
                ...over, settled: false, front: playing.front, streak: playing.streak,
            }).toEqual(playing);
            // The crown lets go at once instead of waiting out its hold.
            const still = play();
            expect(advance(reactions, 0.5).crown).toBeLessThan(advance(still, 0.5).crown);
            const later = advance(reactions, 30);
            expect(later).toMatchObject({
                crown: 0, heat: 0, ribbons: 0, settled: true,
            });
            expect(later.emitters).toEqual([]);
        });

        it.each([
            ['a lock', (reactions) => reactions.onPieceLock()],
            ['a line clear', (reactions) => reactions.onLineClear(1)],
            ['a combo', (reactions) => reactions.onCombo(3)],
            ['a perfect clear', (reactions) => reactions.onPerfectClear()],
        ])('wakes a settled evening with %s', (_label, event) => {
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
                expectAtRest(reactions.frame);
                expect(reactions.serial).toBe(0);
                expect(reactions.ringSerial).toBe(0);
                expect(reactions.waveSerial).toBe(0);
            }
        });

        it('leaves a live frame untouched when a malformed count arrives mid-celebration', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('L', 3) });
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
            expect(rowOf({ lineCount: 2 }, { clearedRows: [13, 14] })).toBe(rowOf(2));
        });

        it('never throws on hostile lock, drop and flourish payloads and keeps the frame in range', () => {
            const hostile = [undefined, null, 0, 42, NaN, 'piece', true, [], [1, 2], () => {}, Symbol('x'), {},
                { detail: null }, { detail: 5 }, { detail: [] }, { piece: null }, { piece: 'T' }, { piece: [] },
                { piece: { x: 1 } }, { piece: { x: NaN, y: NaN } }, { piece: { x: Infinity, y: 4, shape: [[1]] } },
                { piece: { x: 1, y: 2, shape: 'T' } }, { piece: { x: 1, y: 2, shape: [null, 3, [1, 'x', NaN, -1]] } },
                { piece: { x: 1e12, y: -1e12, shape: [[1]] } }, { piece: { x: 1, y: 2, shapeKey: NaN } },
                { piece: { shapeKey: {}, type: [], pieceId: Symbol('T') } }, { piece: { x: 1, y: 2, color: 4n } },
                { viewportOrigin: [] }, { viewportOrigin: { x: Infinity, y: 0 } },
                { viewportOrigin: { x: '0.5', y: '0.5' } }, { distance: {} }, { startY: [], endY: {} },
                { clearedRows: {} }, { clearedRows: [Infinity, -Infinity] }];
            for (const quality of ['Low', 'Extreme']) {
                const reactions = create(quality);
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
                    expectBounded(reactions.update(1 / 60), reactions);
                }
                reactions.onGameOver({ detail: NaN });
                expectBounded(advance(reactions, 2), reactions);
                // No hostile payload named a flower, so none was picked.
                expect(reactions.frame.picked).toBe(0);
            }
        });
    });

    describe('time', () => {
        it('lets every envelope die away, never rise, and snaps a dying one to zero', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            reactions.onPerfectClear();
            let previous = snapshot(reactions.frame);
            const levels = (frame) => Object.entries(frame)
                .filter(([key, value]) => typeof value === 'number' && !COUNTERS.includes(key)
                    && !['crown', 'heat', 'ribbons'].includes(key));
            expect(levels(previous).every(([, value]) => value > 0)).toBe(true);
            for (let step = 0; step < 60; step++) {
                const frame = snapshot(reactions.update(0.25));
                for (const [key, value] of levels(frame)) expect(value, key).toBeLessThanOrEqual(previous[key]);
                for (let kind = 0; kind < frame.species.length; kind++) {
                    expect(frame.species[kind]).toBeLessThanOrEqual(previous.species[kind]);
                }
                previous = frame;
            }
            // A second in, everything is still there but lower.
            const fresh = create();
            fresh.onPerfectClear();
            const start = snapshot(fresh.frame);
            const one = advance(fresh, 1);
            for (const [key, value] of levels(start).filter(([, level]) => level > 0)) {
                expect(one[key], key).toBeGreaterThan(0);
                expect(one[key], key).toBeLessThan(value);
            }
            const later = advance(reactions, 60);
            for (const [key, value] of levels(later)) expect(value, key).toBe(0);
            expect(Array.from(later.species).every((level) => level === 0)).toBe(true);
        });

        it('advances envelopes, the crown, fronts and emitter ages identically at 30, 60 and 144 Hz', () => {
            const play = (fps) => {
                const reactions = create();
                lockKinds(reactions, LETTERS.slice(0, 6));
                reactions.reset();
                reactions.onHardDrop({ distance: 12 });
                reactions.onPieceLock({ piece: pieceOf('T', 2) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(6);
                return snapshot(advance(reactions, 1, fps));
            };
            const reference = play(60);
            expect(reference.emitters.length).toBeGreaterThan(2);
            for (const fps of [30, 144]) {
                const frame = play(fps);
                for (const [key, value] of Object.entries(reference)) {
                    if (typeof value === 'number' && !['crown', 'heat', 'ribbons'].includes(key)) {
                        expect(frame[key], `${key} @${fps}`).toBeCloseTo(value, 9);
                    }
                }
                frame.species.forEach((level, kind) => expect(level).toBeCloseTo(reference.species[kind], 6));
                // The crown is a spring, not an exponential: close, not identical.
                expect(frame.crown).toBeCloseTo(reference.crown, 2);
                expect(frame.front.position).toBeCloseTo(reference.front.position, 9);
                expect(frame.front.strength).toBeCloseTo(reference.front.strength, 9);
                expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(reference.emitters.map((e) => e.kind));
                frame.emitters.forEach((emitter, index) => {
                    expect(emitter.age).toBeCloseTo(reference.emitters[index].age, 9);
                    expect(emitter.progress).toBeCloseTo(reference.emitters[index].progress, 9);
                });
            }
        });

        it('holds the lanterns and burns them down on the same clock at any frame rate', () => {
            const burntOut = (fps) => {
                const reactions = create();
                lockKinds(reactions, LETTERS);
                let seconds = 0;
                while (lit(reactions) > 0 && seconds < 60) {
                    reactions.update(1 / fps);
                    seconds += 1 / fps;
                }
                return seconds;
            };
            const reference = burntOut(60);
            expect(reference).toBeLessThan(60);
            expect(burntOut(30)).toBeCloseTo(reference, 0);
            expect(burntOut(144)).toBeCloseTo(reference, 0);
        });

        it('ages each emitter to the end of its own life and then frees the slot', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            reactions.onTSpin({ piece: pieceOf('T', 1) });
            const [lock, spin] = reactions.frame.emitters;
            expect([lock.kind, spin.kind]).toEqual(['lock', 'spin']);
            const [shorter, longer] = lock.duration <= spin.duration ? [lock, spin] : [spin, lock];
            expect(longer.duration).toBeGreaterThan(shorter.duration);
            const half = advance(reactions, shorter.duration / 2);
            expect(half.emitters).toHaveLength(2);
            for (const emitter of half.emitters) {
                expect(emitter.progress).toBeCloseTo((shorter.duration / 2) / emitter.duration, 1);
                expect(emitter.age).toBeCloseTo(shorter.duration / 2, 1);
            }
            // Just past the shorter life: it is over, the longer one plays on.
            const after = advance(reactions, shorter.duration / 2 + 0.05);
            expect(after.emitters.map((emitter) => emitter.id)).toEqual([longer.id]);
            expect(reactions.emitters[shorter.id]).toMatchObject({ active: false, strength: 0 });
            expect(advance(reactions, longer.duration).emitters).toEqual([]);
            // One long step cannot age an emitter past its duration.
            reactions.onPieceLock();
            expect(reactions.update(30).emitters).toEqual([]);
            expect(reactions.emitters.every((emitter) => emitter.age <= emitter.duration)).toBe(true);
        });

        it('ignores invalid or non-positive timesteps and only advances on explicit updates', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            reactions.onLineClear(3);
            reactions.onCombo(5);
            const before = snapshot(reactions.frame);
            const clock = reactions.time;
            for (const dt of [0, -0, -1, -1e9, NaN, Infinity, -Infinity, undefined, null, '0.1', {}, []]) {
                expect(snapshot(reactions.update(dt))).toEqual(before);
            }
            expect(reactions.time).toBe(clock);
            // Reading the frame is not the same as stepping it.
            for (let read = 0; read < 50; read++) reactions.getFrame();
            expect(snapshot(reactions.frame)).toEqual(before);
            const after = reactions.update(0.2);
            expect(reactions.time).toBeCloseTo(clock + 0.2, 12);
            expect(after.gust).toBeLessThan(before.gust);
            expect(after.bouquetFlash).toBeLessThan(before.bouquetFlash);
            expect(after.emitters.at(-1).age).toBeCloseTo(0.2, 12);
        });
    });

    describe('emitter slots', () => {
        it.each(TIERS.map((quality) => [quality, SUMMER_REACTION_LIMITS[quality]]))(
            'keeps an event storm inside the %s budget of %i and uses every slot',
            (quality, capacity) => {
                const reactions = create(quality, 9);
                const random = seededRandom(31);
                const used = new Set();
                const kinds = new Set();
                const letter = () => LETTERS[Math.floor(random() * LETTERS.length)];
                const events = [
                    () => reactions.onPieceLock({
                        piece: cell(Math.floor(random() * 10), 4 + Math.floor(random() * 20), letter()),
                    }),
                    () => {
                        reactions.onHardDrop({ distance: random() * 22 });
                        reactions.onPieceLock({ piece: pieceOf(letter()) });
                    },
                    () => reactions.onLineClear(1 + Math.floor(random() * 4), { clearedRows: [22, 23] }),
                    () => reactions.onCombo(2 + Math.floor(random() * 30)),
                    () => reactions.onTSpin({ piece: cell(Math.floor(random() * 10), 20, 'T') }),
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
                    state.emitters.forEach((emitter) => { used.add(emitter.id); kinds.add(emitter.kind); });
                    peak = Math.max(peak, state.emitters.length);
                    const problems = frameProblems(state, reactions);
                    if (problems.length) throw new Error(`frame ${frame}: ${problems.join('; ')}`);
                }
                expect(peak).toBe(capacity);
                expect([...used].sort((a, b) => a - b)).toEqual([...Array(capacity).keys()]);
                expect(reactions.emitters).toHaveLength(capacity);
                // The storm reached the whole language, the bouquet included.
                expect([...kinds].sort()).toEqual(['bouquet', 'clear', 'combo', 'lock', 'rise', 'seeds', 'spin']);
                expect(reactions.frame.bouquets).toBeGreaterThan(0);
            },
        );

        it('reclaims the emitter furthest through its own life, not the one that started first', () => {
            const reactions = create('Minimal');
            const capacity = reactions.maxEmitters;
            // Fill the pool with the longest-lived emitters first, so that later ones overtake them.
            for (let slot = 0; slot < capacity; slot++) {
                reactions.emit('lock', { duration: capacity - slot, strength: 0.5 });
                advance(reactions, 0.1);
            }
            advance(reactions, 0.2);
            const first = reactions.frame.emitters;
            expect(first).toHaveLength(capacity);
            // The last to start is now the furthest through its life; the first is the least far.
            expect(first.reduce((a, b) => (b.progress > a.progress ? b : a)).serial).toBe(capacity - 1);
            for (let round = 0; round < capacity * 3; round++) {
                const before = reactions.frame.emitters;
                expect(before).toHaveLength(capacity);
                const furthest = before.reduce((a, b) => (b.progress > a.progress ? b : a));
                const serial = Math.max(...before.map((emitter) => emitter.serial)) + 1;
                reactions.emit('spin', { duration: 1 + (round % 3), strength: 0.5 });
                const after = reactions.frame.emitters;
                expect(after).toHaveLength(capacity);
                const [started] = after.filter((emitter) => emitter.serial === serial);
                expect(started, `round ${round}`).toMatchObject({ id: furthest.id, age: 0, kind: 'spin' });
                // Everything else plays on untouched.
                for (const emitter of before.filter((entry) => entry.id !== furthest.id)) {
                    expect(after.find((entry) => entry.id === emitter.id)).toEqual(emitter);
                }
                advance(reactions, 0.07);
            }
        });

        it('takes a finished slot before recycling one that is still playing', () => {
            const reactions = create('Minimal');
            const capacity = reactions.maxEmitters;
            reactions.onPieceLock(); // the short one
            while (reactions.frame.emitters.length < capacity) reactions.onTSpin();
            const [short] = emittersOf(reactions.frame, 'lock');
            const long = emittersOf(reactions.frame, 'spin');
            expect(long).toHaveLength(capacity - 1);
            expect(long[0].duration).toBeGreaterThan(short.duration + 0.1);
            const frame = advance(reactions, short.duration + 0.05);
            expect(frame.emitters.map((emitter) => emitter.id)).not.toContain(short.id);
            expect(frame.emitters).toHaveLength(capacity - 1);
            reactions.onCombo(3);
            const after = reactions.frame.emitters;
            expect(after).toHaveLength(capacity);
            expect(after.find((emitter) => emitter.id === short.id)).toMatchObject({ kind: 'combo', age: 0 });
            const others = after.filter((emitter) => emitter.id !== short.id);
            expect(others.every((emitter) => emitter.kind === 'spin' && emitter.age >= short.duration)).toBe(true);
        });

        it('numbers every emission with a fresh serial so a reused slot reads as a new event', () => {
            const reactions = create('Minimal');
            const capacity = reactions.maxEmitters;
            const rounds = capacity * 3;
            const seen = [];
            for (let round = 0; round < rounds; round++) {
                reactions.onPieceLock({ piece: cell(round % 10, 20) });
                const last = reactions.frame.emitters.reduce((a, b) => (a.serial > b.serial ? a : b));
                seen.push({ id: last.id, serial: last.serial });
                reactions.update(0.05);
            }
            expect(seen.map((entry) => entry.serial)).toEqual([...Array(rounds).keys()]);
            // Every slot was reused, each time under a new serial.
            for (let id = 0; id < capacity; id++) {
                const serials = seen.filter((entry) => entry.id === id).map((entry) => entry.serial);
                expect(serials.length).toBeGreaterThan(1);
                expect(new Set(serials).size).toBe(serials.length);
            }
            expect(reactions.serial).toBe(rounds);
        });
    });

    describe('the ring and gust queues', () => {
        it('numbers rings and gusts in the order they were asked for, whatever asked', () => {
            const reactions = create();
            const events = [
                () => reactions.onPieceLock({ piece: pieceOf('I') }),
                () => reactions.onHardDrop({ distance: 20 }),
                () => reactions.onPieceLock({ piece: pieceOf('O') }),
                () => reactions.onLineClear(1),
                () => reactions.onLineClear(2),
                () => reactions.onLineClear(4),
                () => reactions.onCombo(4),
                () => reactions.onTSpin(),
                () => reactions.onBackToBack(),
                () => reactions.onPerfectClear(),
                () => reactions.onLevelUp(),
                () => reactions.onGameOver(),
            ];
            for (const event of events) {
                const [rings, gusts] = [reactions.ringSerial, reactions.waveSerial];
                event();
                expect(reactions.ringSerial).toBeGreaterThanOrEqual(rings);
                expect(reactions.waveSerial).toBeGreaterThanOrEqual(gusts);
                const { frame } = reactions;
                if (reactions.ringSerial > 0) expect(newest(frame.rings).serial).toBe(reactions.ringSerial - 1);
                if (reactions.waveSerial > 0) expect(newest(frame.waves).serial).toBe(reactions.waveSerial - 1);
                // Time does not issue, renumber or retire rings or gusts.
                const [issuedRings, issuedGusts] = [reactions.ringSerial, reactions.waveSerial];
                const queued = snapshot({ rings: reactions.rings, waves: reactions.waves });
                expectBounded(reactions.update(0.4), reactions);
                expect([reactions.ringSerial, reactions.waveSerial]).toEqual([issuedRings, issuedGusts]);
                expect(snapshot({ rings: reactions.rings, waves: reactions.waves })).toEqual(queued);
            }
            expect(reactions.ringSerial).toBeGreaterThan(8);
            expect(reactions.waveSerial).toBeGreaterThan(6);
        });

        it.each([
            ['rings', (reactions, index) => reactions.ripple(((index % 10) + 0.5) / 10, 0.5, 1 + (index % 5) / 10)],
            ['waves', (reactions, index) => reactions.gust(((index % 10) + 0.5) / 10, 1 + (index % 5) / 10)],
        ])('wraps the queue of %s, overwriting the oldest and never reusing a serial', (name, ask) => {
            const reactions = create();
            const queue = reactions[name];
            const size = queue.length;
            expect(size).toBeGreaterThan(1);
            for (let index = 0; index < size * 3 + 1; index++) {
                const asked = ask(reactions, index);
                expect(asked.serial).toBe(index);
                expect(reactions.frame[name]).toBe(queue);
                expect(queue).toHaveLength(size);
                const held = live(queue);
                expect(held).toHaveLength(Math.min(index + 1, size));
                // Always the newest, each still describing its own request.
                expect(held.map((entry) => entry.serial))
                    .toEqual([...Array(held.length).keys()].map((offset) => index + 1 - held.length + offset));
                for (const entry of held) {
                    expect(entry.column).toBeCloseTo(((entry.serial % 10) + 0.5) / 10, 12);
                    expect(entry.strength).toBeCloseTo(1 + (entry.serial % 5) / 10, 12);
                }
            }
        });

        it('holds every ring and gust the busiest ordinary lock can ask for', () => {
            const reactions = create();
            for (let lock = 0; lock < 5; lock++) reactions.onPieceLock({ piece: pieceOf('I', lock) });
            advance(reactions, 1);
            const [firstRing, firstGust] = [reactions.ringSerial, reactions.waveSerial];
            // One piece: a hard-dropped t-spin that clears lines on a combo, empties the board
            // and levels up.
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: pieceOf('T') });
            reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
            reactions.onCombo(5);
            reactions.onTSpin({ piece: pieceOf('T') });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            // None was overwritten before a frame could read it.
            const rings = live(reactions.frame.rings).filter((ring) => ring.serial >= firstRing);
            const gusts = live(reactions.frame.waves).filter((wave) => wave.serial >= firstGust);
            expect(rings).toHaveLength(reactions.ringSerial - firstRing);
            expect(gusts).toHaveLength(reactions.waveSerial - firstGust);
            expect(rings.length).toBeGreaterThanOrEqual(6);
            expect(gusts.length).toBeGreaterThanOrEqual(5);
            expectBounded(reactions.frame, reactions);
        });

        // Regression: that lock asks for one gust more when it also completes the bouquet, which was
        // one more than the gust queue held, so the lock's own gust was overwritten unread.
        it('holds every ring and gust of that lock when it also completes the bouquet', () => {
            const reactions = create();
            lockKinds(reactions, ['I', 'O', 'S', 'Z', 'J', 'L']);
            advance(reactions, 5);
            const [firstRing, firstGust] = [reactions.ringSerial, reactions.waveSerial];
            const plain = create();
            for (const director of [reactions, plain]) {
                director.onHardDrop({ distance: 18 });
                director.onPieceLock({ piece: pieceOf('T') });
                director.onLineClear(3, { clearedRows: [21, 22, 23] });
                director.onCombo(5);
                director.onTSpin({ piece: pieceOf('T') });
                director.onBackToBack();
                director.onPerfectClear();
                director.onLevelUp();
            }
            expect(reactions.frame.bouquets).toBe(1);
            expect(plain.frame.bouquets).toBe(0);
            const rings = live(reactions.frame.rings).filter((ring) => ring.serial >= firstRing);
            const gusts = live(reactions.frame.waves).filter((wave) => wave.serial >= firstGust);
            expect(rings).toHaveLength(reactions.ringSerial - firstRing);
            expect(gusts).toHaveLength(reactions.waveSerial - firstGust);
            // It really is the busier lock: one gust more than the same lock without the bouquet.
            expect(gusts).toHaveLength(plain.waveSerial + 1);
            expect(rings).toHaveLength(plain.ringSerial);
            // The lock's own gust, the first of them, is still there to be read.
            expect(gusts[0].serial).toBe(firstGust);
            expectBounded(reactions.frame, reactions);
        });

        it('clamps a ring and a gust onto the card and caps their strength', () => {
            const reactions = create();
            const ring = { ...reactions.ripple(7, -3, 99) };
            expect(ring).toMatchObject({ serial: 0, column: 1, row: 0 });
            expect(reactions.ripple(-2, 5, -4)).toMatchObject({
                serial: 1, column: 0, row: 1, strength: 0,
            });
            const wave = { ...reactions.gust(7, 99) };
            expect(wave).toMatchObject({ serial: 0, column: 1 });
            expect(reactions.gust(-2, -4)).toMatchObject({ serial: 1, column: 0, strength: 0 });
            // One ceiling, however much is asked.
            expect(Number.isFinite(ring.strength)).toBe(true);
            expect(reactions.ripple(0.5, 0.5, 1e9).strength).toBe(ring.strength);
            expect(reactions.gust(0.5, 1e9).strength).toBe(wave.strength);
            // No gameplay event asks for more than the ceiling.
            const loud = create();
            lockKinds(loud, LETTERS.slice(0, 6));
            loud.onHardDrop({ distance: 400 });
            loud.onPieceLock({ piece: pieceOf('L') });
            loud.onPerfectClear();
            loud.onCombo(60);
            for (const entry of live(loud.frame.rings)) expect(entry.strength).toBeLessThan(ring.strength);
            for (const entry of live(loud.frame.waves)) expect(entry.strength).toBeLessThan(wave.strength);
        });
    });

    describe('ownership', () => {
        it('hands out emitter snapshots that cannot corrupt the director', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('S', 2) });
            reactions.onLineClear(2);
            const first = reactions.getFrame();
            const second = reactions.getFrame();
            expect(first).not.toBe(second);
            expect(first.emitters).not.toBe(second.emitters);
            expect(first.emitters[0]).not.toBe(second.emitters[0]);
            const before = snapshot(second);
            first.gust = 99;
            first.crown = 99;
            first.picked = 99;
            first.emitters[0].strength = 99;
            first.emitters[0].active = false;
            first.emitters.length = 0;
            first.front = null;
            expect(snapshot(reactions.getFrame())).toEqual(before);
            expectBounded(reactions.update(0.1), reactions);
        });

        it('resets in place to rest and numbers the next session from zero', () => {
            const reactions = create();
            const {
                emitters, rings, waves, species, bouquet,
            } = reactions;
            lockKinds(reactions, LETTERS);
            reactions.onHardDrop({ distance: 20 });
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            reactions.onLineClear(4);
            reactions.onCombo(12);
            reactions.onPerfectClear();
            reactions.onGameOver();
            advance(reactions, 0.5);
            reactions.onHardDrop({ distance: 20 });
            reactions.reset();
            // At rest again, in a new epoch: whoever follows the frames can tell a session ended.
            expectAtRest(reactions.frame);
            expect(reactions.frame.epoch).toBe(2);
            expect(reactions).toMatchObject({
                time: 0, serial: 0, ringSerial: 0, waveSerial: 0, streak: 0, settled: false,
            });
            // No allocation: the pools are the ones it was built with.
            expect(reactions.emitters).toBe(emitters);
            expect(reactions.rings).toBe(rings);
            expect(reactions.waves).toBe(waves);
            expect(reactions.species).toBe(species);
            expect(reactions.bouquet).toBe(bouquet);
            expectAtRest(advance(reactions, 1));

            // The armed drop is forgotten too, serials start over, and so do the bouquet and the fronts.
            const fresh = create();
            fresh.onPieceLock({ piece: pieceOf('I', 1) });
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            // The same frame a new director gives, but for its epoch and what the dice decided.
            const comparable = (frame) => snapshot({
                ...frame, epoch: 0, emitters: frame.emitters.map((emitter) => ({ ...emitter, seed: 0 })),
            });
            expect(comparable(reactions.frame)).toEqual(comparable(fresh.frame));
            expect(reactions.frame.emitters).toEqual([expect.objectContaining({ kind: 'lock', serial: 0, id: 0 })]);
            expect(live(reactions.frame.rings).map((ring) => ring.serial)).toEqual([0]);
            expect(live(reactions.frame.waves).map((wave) => wave.serial)).toEqual([0]);
            expect(reactions.frame).toMatchObject({ picked: 1, bouquets: 0 });
            fresh.onPerfectClear();
            reactions.onPerfectClear();
            expect(reactions.frame.front.direction).toBe(fresh.frame.front.direction);
        });

        it('leaves a disposed director inert until it is explicitly reset', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            reactions.onLineClear(4);
            reactions.dispose();
            expect(reactions.disposed).toBe(true);
            expectAtRest(reactions.frame);
            expect(reactions.onHardDrop({ distance: 20 })).toBe(false);
            expect(reactions.onPieceLock({ piece: pieceOf('I', 1) })).toBe(false);
            expect(reactions.onLineClear(4)).toBe(false);
            expect(reactions.onCombo(9)).toBe(false);
            expect(reactions.onTSpin()).toBe(false);
            expect(reactions.onBackToBack()).toBe(false);
            expect(reactions.onPerfectClear()).toBe(false);
            expect(reactions.onLevelUp()).toBe(false);
            // Game over is refused like every other event: it does not settle a disposed director.
            expect(reactions.onGameOver()).toBe(false);
            expect(reactions.settled).toBe(false);
            const { epoch } = reactions.frame;
            expectAtRest(reactions.update(1));
            expect(reactions.frame.epoch).toBe(epoch);
            expect(reactions).toMatchObject({
                time: 0, serial: 0, ringSerial: 0, waveSerial: 0,
            });
            expect(reactions.frame.picked).toBe(0);
            expect(() => reactions.dispose()).not.toThrow();

            reactions.reset();
            expect(reactions.disposed).toBe(false);
            expect(reactions.onPieceLock({ piece: pieceOf('O') })).toBe(true);
            expect(reactions.update(0.1).emitters).toHaveLength(1);
            expect(reactions.frame.picked).toBe(1);
            expect(reactions.onGameOver()).toBe(true);
            expect(reactions.frame.settled).toBe(true);
        });

        it('counts an epoch for every reset, and for nothing else', () => {
            const reactions = create();
            expect(reactions.epoch).toBe(1);
            expect(reactions.frame.epoch).toBe(1);
            // Playing, time, a finished bouquet and game over all belong to the same session.
            lockKinds(reactions, LETTERS);
            reactions.onHardDrop({ distance: 12 });
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
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
                const reactions = new SummerReactions({ quality: 'Medium', rng });
                const frames = [];
                for (let frame = 0; frame < 240; frame++) {
                    if (frame % 20 === 0) {
                        reactions.onPieceLock({ piece: cell(frame % 10, 20, LETTERS[(frame / 20) % LETTERS.length]) });
                    }
                    if (frame % 40 === 5) reactions.onLineClear(1 + ((frame / 40) % 4), { clearedRows: [22] });
                    if (frame % 60 === 10) reactions.onCombo(2 + frame / 20);
                    if (frame === 100) reactions.onTSpin();
                    if (frame === 150) reactions.onPerfectClear();
                    frames.push(snapshot(reactions.update(1 / 60)));
                }
                return { frames, reactions };
            };
            const first = play(seededRandom(7)).frames;
            expect(play(seededRandom(7)).frames).toEqual(first);
            expect(first.at(-1).bouquets).toBe(1);
            // The seed only decides emitter seeds and where a combo's ring and gust fall.
            const other = play(seededRandom(8)).frames;
            expect(other).not.toEqual(first);
            expect(other.map((frame) => frame.gust)).toEqual(first.map((frame) => frame.gust));
            expect(other.map((frame) => frame.bouquet)).toEqual(first.map((frame) => frame.bouquet));
            expect(other.map((frame) => frame.emitters.map((emitter) => emitter.kind)))
                .toEqual(first.map((frame) => frame.emitters.map((emitter) => emitter.kind)));

            for (const broken of [() => NaN, () => Infinity, () => -3, () => 7, () => undefined, () => '0.5',
                () => 1]) {
                const { frames, reactions } = play(broken);
                for (const frame of frames) expect(frameProblems(frame, reactions)).toEqual([]);
                expect(frames.some((frame) => frame.emitters.length > 0)).toBe(true);
            }
            // Not a function at all: the director falls back to Math.random rather than failing.
            const fallback = new SummerReactions({ rng: 'dice' });
            fallback.onCombo(3);
            expectBounded(fallback.frame, fallback);
        });
    });
});
