import { describe, expect, it } from 'vitest';
import {
    VERDANT_HILLS_KITES, VERDANT_HILLS_KITE_LINE_SECONDS, VERDANT_HILLS_MIXED, VERDANT_HILLS_REACTION_LIMITS,
    VerdantHillsReactions, verdantHillsKiteForPiece,
} from '../../src/themes/verdant-hills/verdant-hills-reactions.js';
import {
    VERDANT_HILLS_KITE_COLOURS, VERDANT_HILLS_PIECE_KITES,
} from '../../src/themes/verdant-hills/verdant-hills-tetrominos.js';

const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const LETTERS = Object.keys(VERDANT_HILLS_PIECE_KITES);
const ENVELOPES = ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flock', 'flutter'];
// What every frame must carry for the world, the post chain and the playground to read.
const FRAME_KEYS = ['epoch', 'wind', 'whirl', 'heat', 'streamers', 'streak', 'settled', 'kites', 'kiteTug', 'height',
    'aloft', 'festival', 'festivals', 'front', 'sunbreak', 'waves', 'streaks', 'emitters', ...ENVELOPES];
// Whole numbers; every other number at the top of a frame is a level in 0..1.
const COUNTERS = ['epoch', 'streak', 'aloft', 'festivals'];
const RIBBON_KINDS = ['lock', 'clear', 'great', 'spin', 'festival'];
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
    return new VerdantHillsReactions({ quality, rng: seededRandom(seed) });
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

function ribbonsOf(frame, kind) {
    return live(frame.streaks).filter((ribbon) => ribbon.kind === kind);
}

/** A deep plain copy, so a held frame cannot change under the test. */
function snapshot(frame) {
    return JSON.parse(JSON.stringify(frame, (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value)));
}

const flying = (reactions) => Array.from(reactions.getFrame().kites);
const lines = (reactions) => Array.from(reactions.line);

/** Every way a frame can leave its documented ranges, as readable messages. */
function frameProblems(frame, reactions) {
    const problems = [];
    const check = (condition, message) => { if (!condition) problems.push(message); };
    const unit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
    for (const key of FRAME_KEYS) check(key in frame, `missing ${key}`);
    for (const key of Object.keys(frame)) check(FRAME_KEYS.includes(key), `undocumented ${key}`);
    for (const [key, value] of Object.entries(frame)) {
        if (typeof value === 'number' && !COUNTERS.includes(key)) check(unit(value), `${key} = ${String(value)}`);
    }
    check(Number.isInteger(frame.epoch) && frame.epoch >= 1, `epoch = ${String(frame.epoch)}`);
    check(Number.isInteger(frame.streak) && frame.streak >= 0, `streak = ${String(frame.streak)}`);
    check(Number.isInteger(frame.festivals) && frame.festivals >= 0, `festivals = ${String(frame.festivals)}`);
    check(
        Number.isInteger(frame.aloft) && frame.aloft >= 0 && frame.aloft <= VERDANT_HILLS_KITES,
        `aloft = ${String(frame.aloft)}`,
    );
    check(typeof frame.settled === 'boolean', `settled = ${String(frame.settled)}`);
    for (const [name, levels] of [['kite', frame.kites], ['tug', frame.kiteTug]]) {
        check(levels.length === VERDANT_HILLS_KITES, `${levels.length} ${name} levels`);
        levels.forEach((level, slot) => check(unit(level), `${name} ${slot} = ${level}`));
    }
    if (frame.front !== null) {
        const { front } = frame;
        check(Number.isFinite(front.position) && Math.abs(front.position) <= 1.4, `front.position = ${front.position}`);
        check(front.direction === 1, `front.direction = ${front.direction}`);
        check(unit(front.strength), `front.strength = ${front.strength}`);
    }
    if (frame.sunbreak !== null) {
        const { sunbreak } = frame;
        check(sunbreak.progress >= 0 && sunbreak.progress < 1, `sunbreak.progress = ${sunbreak.progress}`);
        check(unit(sunbreak.strength), `sunbreak.strength = ${sunbreak.strength}`);
    }
    const queues = [['gust', frame.waves, ['column']], ['ribbon', frame.streaks, ['column', 'row']]];
    for (const [name, queue, places] of queues) {
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
    for (const ribbon of frame.streaks) {
        const label = `ribbon ${ribbon.serial}/${ribbon.kind}`;
        check(RIBBON_KINDS.includes(ribbon.kind), `${label} kind`);
        check([-1, 0, 1].includes(ribbon.side) && !Object.is(ribbon.side, -0), `${label} side ${ribbon.side}`);
        check(ribbon.strength <= 1, `${label} strength ${ribbon.strength}`);
        check(Number.isInteger(ribbon.lines) && ribbon.lines >= 0, `${label} lines ${ribbon.lines}`);
        check(
            Number.isInteger(ribbon.kite) && ribbon.kite >= VERDANT_HILLS_MIXED && ribbon.kite < VERDANT_HILLS_KITES,
            `${label} kite ${ribbon.kite}`,
        );
    }
    if (reactions) {
        check(frame.waves.length === reactions.waves.length, `${frame.waves.length} gusts`);
        check(frame.streaks.length === reactions.streaks.length, `${frame.streaks.length} ribbons`);
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
            Number.isInteger(emitter.kite) && emitter.kite >= VERDANT_HILLS_MIXED && emitter.kite < VERDANT_HILLS_KITES,
            `${label} kite ${emitter.kite}`,
        );
    }
    return problems;
}

function expectBounded(frame, reactions) {
    expect(frameProblems(frame, reactions)).toEqual([]);
}

/** Still air: nothing asked of the grass or the sky, no kite up and none on its way down. */
function expectAtRest(frame) {
    for (const [key, value] of Object.entries(frame)) {
        if (typeof value === 'number' && key !== 'epoch') expect(value, key).toBe(0);
    }
    expect(frame.settled).toBe(false);
    expect(frame.front).toBeNull();
    expect(frame.sunbreak).toBeNull();
    expect(frame.emitters).toEqual([]);
    expect(live(frame.waves)).toEqual([]);
    expect(live(frame.streaks)).toEqual([]);
    expect(Array.from(frame.kites).every((level) => level === 0)).toBe(true);
    expect(Array.from(frame.kiteTug).every((level) => level === 0)).toBe(true);
    expectBounded(frame);
}

/** Lock one piece of each of the given kinds, a frame apart. */
function lockKinds(reactions, letters) {
    for (const letter of letters) {
        reactions.onPieceLock({ piece: pieceOf(letter) });
        reactions.update(1 / 60);
    }
}

describe('Verdant Hills reaction director', () => {
    describe('budget and frame shape', () => {
        it('gives every quality tier a fixed pool of emitters that never grows as the tier drops', () => {
            expect(Object.keys(VERDANT_HILLS_REACTION_LIMITS).sort()).toEqual([...TIERS].sort());
            expect(Object.isFrozen(VERDANT_HILLS_REACTION_LIMITS)).toBe(true);
            expect(VERDANT_HILLS_REACTION_LIMITS).toEqual({
                Minimal: 4, Low: 6, Medium: 8, High: 12, Ultra: 14, Extreme: 16,
            });
            TIERS.forEach((quality, index) => {
                const capacity = VERDANT_HILLS_REACTION_LIMITS[quality];
                expect(Number.isInteger(capacity) && capacity > 0, quality).toBe(true);
                if (index > 0) expect(capacity).toBeLessThanOrEqual(VERDANT_HILLS_REACTION_LIMITS[TIERS[index - 1]]);
                const reactions = create(quality);
                reactions.onPieceLock();
                expect(reactions.quality).toBe(quality);
                expect(reactions.maxEmitters).toBe(capacity);
                expect(reactions.emitters).toHaveLength(capacity);
                expect(reactions.emitters.map((emitter) => emitter.id)).toEqual([...Array(capacity).keys()]);
                // The queues are the same on every tier: what a tier draws of them is the world's affair.
                expect(reactions.waves).toHaveLength(8);
                expect(reactions.streaks).toHaveLength(16);
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
                const reactions = new VerdantHillsReactions({ quality, rng: seededRandom() });
                expect(reactions.quality).toBe('High');
                expect(reactions.maxEmitters).toBe(VERDANT_HILLS_REACTION_LIMITS.High);
            }
            expect(new VerdantHillsReactions().quality).toBe('High');
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
            // The contract: these fields and no others.
            expect(Object.keys(frame).sort()).toEqual([...FRAME_KEYS].sort());
            expect(snapshot(reactions.frame)).toEqual(snapshot(frame));
            expect(snapshot(reactions.getFrame())).toEqual(snapshot(frame));
            expect(frame.emitters.length).toBeGreaterThan(0);
            expect(frame.kites).toBeInstanceOf(Float32Array);
            expect(frame.kiteTug).toBeInstanceOf(Float32Array);
            expect(frame.front).toEqual({
                position: expect.any(Number), direction: 1, strength: expect.any(Number),
            });
            expect(frame.sunbreak).toEqual({ progress: expect.any(Number), strength: expect.any(Number) });
            expect(Object.keys(newest(frame.waves)).sort()).toEqual(['column', 'serial', 'strength']);
            expect(Object.keys(newest(frame.streaks)).sort())
                .toEqual(['column', 'kind', 'kite', 'lines', 'row', 'serial', 'side', 'strength']);
            expect(Object.keys(frame.emitters[0]).sort()).toEqual(['active', 'age', 'column', 'duration', 'id',
                'kind', 'kite', 'lines', 'progress', 'row', 'seed', 'serial', 'side', 'strength']);
            expectBounded(frame, reactions);
        });
    });

    describe('piece locks', () => {
        it('answers a lock with one ribbon, one puff, one gust and its kite, and nothing grander', () => {
            const reactions = create();
            expect(reactions.onPieceLock({ piece: pieceOf('S', 2) })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(['lock']);
            expect(frame.emitters[0]).toMatchObject({ age: 0, progress: 0, lines: 0 });
            expect(live(frame.streaks)).toEqual([expect.objectContaining({ kind: 'lock', lines: 0 })]);
            expect(live(frame.waves)).toHaveLength(1);
            for (const key of ['gust', 'warmth', 'glow', 'shimmer', 'flutter']) {
                expect(frame[key], key).toBeGreaterThan(0);
            }
            // A breath on the wind dial, no more.
            expect(frame.wind).toBeGreaterThan(0);
            expect(frame.wind).toBeLessThan(0.1);
            expect(frame.aloft).toBe(1);
            // The front, the sunlight, the birds and the whirl are kept for achievements.
            expect(frame.front).toBeNull();
            expect(frame.sunbreak).toBeNull();
            expect(frame.flock).toBe(0);
            expect(frame.shafts).toBe(0);
            expect(advance(reactions, 0.5)).toMatchObject({
                whirl: 0,
                heat: 0,
                streamers: 0,
                streak: 0,
                flock: 0,
                height: 0,
                festival: 0,
                festivals: 0,
                settled: false,
                front: null,
                sunbreak: null,
            });
        });

        it('places the ribbon, the puff and the gust beside the piece, mapping rows 4..23 from top to foot', () => {
            const placed = (piece) => {
                const reactions = create();
                reactions.onPieceLock({ piece });
                const [emitter] = reactions.frame.emitters;
                // The ribbon curls away from the same place on the board as the puff, on the same
                // side, and the gust leaves the foot of the board under it.
                expect(newest(reactions.frame.streaks))
                    .toMatchObject({ side: emitter.side, column: emitter.column, row: emitter.row });
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

        it('takes the sides in turn around the middle of the card when a lock cannot be placed', () => {
            const reactions = create();
            for (const payload of [undefined, {}, { piece: null }, { piece: { x: NaN, y: 2 } }]) {
                reactions.onPieceLock(payload);
            }
            const emitters = emittersOf(reactions.frame, 'lock');
            expect(emitters.map((emitter) => emitter.side)).toEqual([-1, 1, -1, 1]);
            const rows = new Set(emitters.map((emitter) => emitter.row));
            expect(rows.size).toBe(1);
            for (const emitter of emitters) expect(emitter.column).toBe(0.5);
            // Each ribbon leaves from the same edge as its puff: a lock's ribbon always has a side.
            const ribbons = live(reactions.frame.streaks);
            expect(ribbons).toHaveLength(4);
            ribbons.forEach((ribbon, index) => {
                expect(ribbon).toMatchObject({
                    kind: 'lock',
                    side: emitters[index].side,
                    column: 0.5,
                    row: emitters[0].row,
                    kite: VERDANT_HILLS_MIXED,
                });
            });
            for (const wave of live(reactions.frame.waves)) expect(wave.column).toBe(0.5);
            // And so does the seed a long drop shakes loose, on either side.
            for (const before of [0, 1]) {
                const dropped = create();
                for (let lock = 0; lock < before; lock++) dropped.onPieceLock();
                dropped.onHardDrop({ distance: BOARD_ROWS });
                dropped.onPieceLock();
                const puff = emittersOf(dropped.frame, 'lock').at(-1);
                expect(puff.side).toBe(before === 0 ? -1 : 1);
                expect(emittersOf(dropped.frame, 'seeds')).toEqual([expect.objectContaining({ side: puff.side })]);
                expect(newest(dropped.frame.streaks).side).toBe(puff.side);
            }
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
                    ribbon: newest(frame.streaks).strength,
                    gust: newest(frame.waves).strength,
                    wind: frame.wind,
                };
            };
            const distances = [0, 1, 3, 6, 9, 12, 16, BOARD_ROWS];
            const answers = distances.map(answer);
            for (let index = 1; index < answers.length; index++) {
                const [softer, harder] = [answers[index - 1], answers[index]];
                for (const key of ['puff', 'ribbon', 'gust', 'wind']) {
                    expect(harder[key], `${key} at ${distances[index]}`).toBeGreaterThan(softer[key]);
                }
                for (const key of ['gust', 'warmth', 'glow', 'shimmer', 'flutter']) {
                    expect(harder.frame[key], key).toBeGreaterThan(softer.frame[key]);
                }
            }
            // No drop at all is a drop of nothing, and a fall past the board is a full one.
            expect(answer(null)).toEqual(answers[0]);
            expect(answer(400)).toEqual(answers.at(-1));
            // The gentlest and the hardest lock, as written.
            expect(answers[0]).toMatchObject({
                puff: 0.28, ribbon: 0.3, gust: 0.5, wind: 0.03,
            });
            expect(answers.at(-1).puff).toBeCloseTo(0.78, 12);
            expect(answers.at(-1).ribbon).toBeCloseTo(0.8, 12);
            expect(answers.at(-1).gust).toBeCloseTo(1.3, 12);
            expect(answers.at(-1).wind).toBeCloseTo(0.08, 12);
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
                    // Seed lifts off under the piece, on its side, and is marked with its kite.
                    expect(seeds[0]).toMatchObject({
                        side: lock.side, column: lock.column, row: 0, kite: lock.kite,
                    });
                    expect(seeds[0].serial).toBeGreaterThan(lock.serial);
                }
                // One ribbon and one gust either way: the seed is in the air, not a second event.
                expect(live(frame.streaks)).toHaveLength(1);
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
            const gentleRibbon = newest(reactions.frame.streaks).strength;
            reactions.reset();
            reactions.onHardDrop({ distance: 14 });
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            expect(emittersOf(reactions.frame, 'lock')[0].strength).toBeGreaterThan(gentle);
            expect(newest(reactions.frame.streaks).strength).toBeGreaterThan(gentleRibbon);
            expect(emittersOf(reactions.frame, 'seeds')).toHaveLength(1);

            // The next lock is an ordinary one again.
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            const locks = emittersOf(reactions.frame, 'lock');
            expect(locks).toHaveLength(2);
            expect(locks[1].strength).toBe(gentle);
            expect(newest(reactions.frame.streaks).strength).toBe(gentleRibbon);
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

    describe('the seven kites', () => {
        it('gives each tetromino a kite of its own, in the order of the kite colours', () => {
            expect(VERDANT_HILLS_KITES).toBe(7);
            expect(VERDANT_HILLS_MIXED).toBe(-1);
            expect(VERDANT_HILLS_KITE_LINE_SECONDS).toBe(20);
            expect(LETTERS.slice().sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
            // I poppy, O cerulean, T sunflower, S fuchsia, Z teal, J tangerine, L violet.
            expect(['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((letter) => verdantHillsKiteForPiece({ shapeKey: letter })))
                .toEqual([0, 1, 2, 3, 4, 5, 6]);
            expect(VERDANT_HILLS_KITE_COLOURS).toHaveLength(VERDANT_HILLS_KITES);
            const reactions = create();
            for (const pool of [reactions.line, reactions.fly, reactions.tug]) {
                expect(pool).toBeInstanceOf(Float32Array);
                expect(pool).toHaveLength(VERDANT_HILLS_KITES);
            }
        });

        it('reads the kite from whichever field names the piece, in either case', () => {
            for (const letter of LETTERS) {
                const slot = VERDANT_HILLS_PIECE_KITES[letter];
                expect(verdantHillsKiteForPiece({ shapeKey: letter })).toBe(slot);
                expect(verdantHillsKiteForPiece({ type: letter })).toBe(slot);
                expect(verdantHillsKiteForPiece({ pieceId: letter })).toBe(slot);
                expect(verdantHillsKiteForPiece({ color: letter })).toBe(slot);
                expect(verdantHillsKiteForPiece({ shapeKey: letter.toLowerCase() })).toBe(slot);
                // The first field that names a piece wins; fields that name none are passed over.
                expect(verdantHillsKiteForPiece({ shapeKey: 7, type: '#ff0000', pieceId: letter })).toBe(slot);
            }
            expect(verdantHillsKiteForPiece({ shapeKey: 'T', type: 'I' })).toBe(VERDANT_HILLS_PIECE_KITES.T);
        });

        it('answers a piece it cannot name with no kite at all, and never throws', () => {
            for (const piece of [undefined, null, 0, 'T', ['T'], true, {}, { shapeKey: '' }, { shapeKey: 'X' },
                { shapeKey: 'TT' }, { shapeKey: 2 }, { type: null }, { shapeKey: 'constructor' },
                { shapeKey: 'toString' }, { shapeKey: '__proto__' }, { shapeKey: 'hasOwnProperty' },
                { shapeKey: { toUpperCase: () => 'T' } }, { color: '#9a6cf0' }]) {
                expect(verdantHillsKiteForPiece(piece), String(JSON.stringify(piece))).toBe(VERDANT_HILLS_MIXED);
            }
        });

        it('puts the piece\'s own kite in the air on a full line, with a tug, and no other', () => {
            for (const letter of LETTERS) {
                const slot = VERDANT_HILLS_PIECE_KITES[letter];
                const reactions = create();
                reactions.onPieceLock({ piece: pieceOf(letter) });
                const { frame } = reactions;
                expect(frame.aloft, letter).toBe(1);
                expect(frame.emitters[0].kite).toBe(slot);
                expect(newest(frame.streaks).kite).toBe(slot);
                lines(reactions).forEach((left, kite) => {
                    expect(left, `${letter} line ${kite}`).toBe(kite === slot ? VERDANT_HILLS_KITE_LINE_SECONDS : 0);
                });
                Array.from(frame.kiteTug).forEach((tug, kite) => expect(tug).toBe(kite === slot ? 1 : 0));
                // It has only just left the hand: it takes a moment to get up.
                expect(flying(reactions)).toEqual([0, 0, 0, 0, 0, 0, 0]);
                Array.from(advance(reactions, 1).kites).forEach((level, kite) => {
                    if (kite === slot) expect(level, `${letter} flies ${kite}`).toBeGreaterThan(0.5);
                    else expect(level, `${letter} leaves ${kite}`).toBe(0);
                });
                expect(reactions.frame.festivals).toBe(0);
            }
        });

        it('flies no kite for a piece it cannot name', () => {
            const reactions = create();
            for (const piece of [undefined, null, cell(2, 20), { ...cell(2, 20), shapeKey: 'Q' }, 'T']) {
                reactions.onPieceLock({ piece });
                expect(reactions.frame.emitters.at(-1).kite).toBe(VERDANT_HILLS_MIXED);
                expect(newest(reactions.frame.streaks).kite).toBe(VERDANT_HILLS_MIXED);
            }
            expect(reactions.frame.aloft).toBe(0);
            expect(lines(reactions)).toEqual([0, 0, 0, 0, 0, 0, 0]);
            expect(Array.from(advance(reactions, 2).kites)).toEqual([0, 0, 0, 0, 0, 0, 0]);
            expect(Array.from(reactions.frame.kiteTug)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        });

        it('lets a kite climb briskly, stay up while it has line and sink slowly once it has none', () => {
            const reactions = create();
            const slot = VERDANT_HILLS_PIECE_KITES.T;
            reactions.onPieceLock({ piece: pieceOf('T') });
            const timeline = [];
            for (let step = 0; step < 60 * 45; step++) timeline.push(reactions.update(1 / 60).kites[slot]);
            const at = (seconds) => timeline[Math.round(seconds * 60) - 1];
            const expiry = VERDANT_HILLS_KITE_LINE_SECONDS;
            // Up: never a step back, most of the way within a second, all but there in three.
            for (let index = 1; index < expiry * 60 - 2; index++) {
                expect(timeline[index]).toBeGreaterThanOrEqual(timeline[index - 1]);
            }
            expect(at(1)).toBeCloseTo(1 - Math.exp(-1.5), 5);
            expect(at(3)).toBeGreaterThan(0.98);
            expect(at(expiry - 0.5)).toBeGreaterThan(0.9999);
            // Down: from the moment the line runs out, never a step up, and gently.
            for (let index = expiry * 60 + 2; index < timeline.length; index++) {
                expect(timeline[index]).toBeLessThanOrEqual(timeline[index - 1]);
            }
            expect(at(expiry + 1)).toBeCloseTo(Math.exp(-0.45), 2);
            expect(at(expiry + 1)).toBeLessThan(at(expiry - 0.5));
            // It rose to half its height in under half a second; it takes three times as long to lose it.
            const rise = timeline.findIndex((level) => level >= 0.5) / 60;
            const fall = timeline.findIndex((level, index) => index > expiry * 60 && level <= 0.5) / 60 - expiry;
            expect(rise).toBeLessThan(0.5);
            expect(fall).toBeGreaterThan(rise * 3);
            // In the end it lies on the grass: exactly zero, not a lingering fraction.
            expect(timeline.at(-1)).toBe(0);
            expect(reactions.frame.aloft).toBe(0);
        });

        it('counts a kite as aloft for exactly as long as its line lasts', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('I') });
            let seconds = 0;
            while (reactions.frame.aloft === 1 && seconds < 60) {
                reactions.update(1 / 60);
                seconds += 1 / 60;
            }
            expect(seconds).toBeCloseTo(VERDANT_HILLS_KITE_LINE_SECONDS, 1);
            // Three let out five seconds apart come down five seconds apart.
            const three = create();
            const seen = [];
            for (const letter of ['I', 'O', 'T']) {
                three.onPieceLock({ piece: pieceOf(letter) });
                seen.push(three.frame.aloft);
                advance(three, 5);
            }
            expect(seen).toEqual([1, 2, 3]);
            expect(three.frame.aloft).toBe(3);
            expect(advance(three, 6).aloft).toBe(2);
            expect(advance(three, 5).aloft).toBe(1);
            expect(advance(three, 5).aloft).toBe(0);
        });

        it('pays the line out again when the same piece locks, and tugs it', () => {
            const reactions = create();
            const slot = VERDANT_HILLS_PIECE_KITES.O;
            reactions.onPieceLock({ piece: pieceOf('O') });
            advance(reactions, 15);
            expect(reactions.line[slot]).toBeCloseTo(5, 2);
            expect(reactions.frame.kiteTug[slot]).toBe(0);
            reactions.onPieceLock({ piece: pieceOf('O') });
            expect(reactions.line[slot]).toBe(VERDANT_HILLS_KITE_LINE_SECONDS);
            expect(reactions.frame.kiteTug[slot]).toBe(1);
            // Still one kite, and it does not dip: it was up already.
            expect(reactions.frame.aloft).toBe(1);
            expect(reactions.frame.kites[slot]).toBeGreaterThan(0.999);
            // Ten seconds on the first line would long have run out; the second has not.
            const later = advance(reactions, 10);
            expect(later.aloft).toBe(1);
            expect(later.kites[slot]).toBeGreaterThan(0.999);
            expect(advance(reactions, 11).aloft).toBe(0);
        });

        it('lets the tug on a line die away within a few seconds', () => {
            const reactions = create();
            const slot = VERDANT_HILLS_PIECE_KITES.L;
            reactions.onPieceLock({ piece: pieceOf('L') });
            let previous = reactions.frame.kiteTug[slot];
            expect(previous).toBe(1);
            for (let step = 0; step < 60; step++) {
                const tug = reactions.update(1 / 60).kiteTug[slot];
                expect(tug).toBeLessThan(previous);
                previous = tug;
            }
            expect(previous).toBeCloseTo(Math.exp(-1.8), 5);
            expect(advance(reactions, 6).kiteTug[slot]).toBe(0);
            // The kite itself is untouched by its tug going slack.
            expect(reactions.frame.aloft).toBe(1);
        });

        it('launches only the seven: anything else is refused', () => {
            const reactions = create();
            for (const slot of [VERDANT_HILLS_MIXED, VERDANT_HILLS_KITES, 99, 1.5, NaN, Infinity, '2', null, undefined,
                {}, [3]]) {
                expect(reactions.launch(slot), String(slot)).toBe(false);
            }
            expect(reactions.frame.aloft).toBe(0);
            expect(reactions.launch(3)).toBe(true);
            expect(lines(reactions)).toEqual([0, 0, 0, VERDANT_HILLS_KITE_LINE_SECONDS, 0, 0, 0]);
            expect(reactions.frame.aloft).toBe(1);
        });
    });

    describe('the kite festival', () => {
        it.each([
            ['in piece order', ['I', 'O', 'T', 'S', 'Z', 'J', 'L']],
            ['in reverse', ['L', 'J', 'Z', 'S', 'T', 'O', 'I']],
            ['with repeats on the way', ['T', 'T', 'S', 'I', 'S', 'L', 'T', 'Z', 'Z', 'O', 'I', 'L', 'J']],
        ])('begins exactly once, when the seventh kite goes up (%s)', (_label, letters) => {
            const reactions = create();
            const seen = new Set();
            letters.forEach((letter, index) => {
                reactions.onPieceLock({ piece: pieceOf(letter) });
                seen.add(letter);
                const { frame } = reactions;
                const last = index === letters.length - 1;
                expect(frame.festivals, `after ${letter}`).toBe(last ? 1 : 0);
                expect(emittersOf(frame, 'festival').length, `after ${letter}`).toBe(last ? 1 : 0);
                expect(ribbonsOf(frame, 'festival').length, `after ${letter}`).toBe(last ? 1 : 0);
                expect(frame.aloft).toBe(seen.size);
                expect(frame.festival > 0).toBe(last);
                expect(frame.sunbreak !== null).toBe(last);
                expectBounded(frame, reactions);
                reactions.update(1 / 60);
            });
            expect(reactions.frame.aloft).toBe(VERDANT_HILLS_KITES);
            // All seven are flying or on their way up.
            expect(Array.from(advance(reactions, 2).kites).every((level) => level > 0.9)).toBe(true);
        });

        it('makes the seventh kite much more than a lock', () => {
            const six = ['I', 'O', 'T', 'S', 'Z', 'J'];
            const ordinary = create();
            lockKinds(ordinary, six);
            advance(ordinary, 8);
            const completing = create();
            lockKinds(completing, six);
            advance(completing, 8);
            const asked = (reactions) => [reactions.streakSerial, reactions.waveSerial];
            const [ribbonsBefore, gustsBefore] = asked(completing);
            expect(asked(ordinary)).toEqual([ribbonsBefore, gustsBefore]);
            // The same piece in the same place: one fills the sky, the other flies a kite that is up already.
            ordinary.onPieceLock({ piece: pieceOf('J') });
            completing.onPieceLock({ piece: pieceOf('L') });
            const [plain, held] = [snapshot(ordinary.frame), snapshot(completing.frame)];
            expect(plain).toMatchObject({
                festivals: 0, festival: 0, aloft: 6, sunbreak: null,
            });
            expect(held).toMatchObject({ festivals: 1, festival: 1, aloft: 7 });
            for (const key of ENVELOPES) expect(held[key], key).toBeGreaterThan(plain[key]);
            // The wind freshens and the clouds open.
            expect(held.wind).toBeGreaterThan(plain.wind + 0.4);
            expect(held.sunbreak).toEqual({ progress: 0, strength: 0 });
            // One ribbon and one gust of its own, on top of the lock's.
            expect(asked(ordinary)).toEqual([ribbonsBefore + 1, gustsBefore + 1]);
            expect(asked(completing)).toEqual([ribbonsBefore + 2, gustsBefore + 2]);
            expect(newest(held.waves)).toMatchObject({ column: 0.5, strength: 1.6 });
            expect(newest(held.waves).strength).toBeGreaterThan(newest(plain.waves).strength);
            expect(newest(held.streaks)).toMatchObject({
                kind: 'festival', side: 0, row: 0.6, strength: 1, kite: VERDANT_HILLS_MIXED,
            });
            const [burst] = emittersOf(held, 'festival');
            expect(burst).toMatchObject({ kite: VERDANT_HILLS_MIXED, strength: 1, duration: 2.6 });
            expect(burst.strength).toBeGreaterThan(emittersOf(held, 'lock').at(-1).strength);
            expect(burst.duration).toBeGreaterThan(emittersOf(held, 'lock').at(-1).duration);
            // Every kite climbs to the top of its line; a plain lock lifts none.
            expect(advance(completing, 1.5).height).toBeGreaterThan(0.9);
            expect(advance(ordinary, 1.5).height).toBe(0);
            expect(completing.frame.sunbreak.strength).toBeGreaterThan(0.5);
        });

        it('is not held for kites that were never all up at once', () => {
            const reactions = create();
            // Six kinds and any number of nameless pieces do not make seven.
            lockKinds(reactions, ['I', 'O', 'T', 'S', 'Z', 'J']);
            for (let lock = 0; lock < 10; lock++) reactions.onPieceLock({ piece: cell(lock, 20) });
            expect(reactions.frame).toMatchObject({ aloft: 6, festivals: 0 });
            // The seventh after the first six have come down is a kite alone.
            advance(reactions, VERDANT_HILLS_KITE_LINE_SECONDS + 1);
            expect(reactions.frame.aloft).toBe(0);
            reactions.onPieceLock({ piece: pieceOf('L') });
            expect(reactions.frame).toMatchObject({ aloft: 1, festivals: 0 });
            // One that came down before the last went up leaves six.
            const staggered = create();
            staggered.onPieceLock({ piece: pieceOf('I') });
            advance(staggered, VERDANT_HILLS_KITE_LINE_SECONDS + 1);
            lockKinds(staggered, ['O', 'T', 'S', 'Z', 'J', 'L']);
            expect(staggered.frame).toMatchObject({ aloft: 6, festivals: 0, festival: 0 });
            expect(emittersOf(staggered.frame, 'festival')).toEqual([]);
            // Nor does any other way of having seven count but a launch: the next one does.
            staggered.onPieceLock({ piece: pieceOf('I') });
            expect(staggered.frame).toMatchObject({ aloft: 7, festivals: 1 });
        });

        it('is held once for one sky full of kites, however long they stay up', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            expect(reactions.frame.festivals).toBe(1);
            // A minute of steady play: every kite is flown again long before its line runs out.
            for (let round = 0; round < 6; round++) {
                advance(reactions, 10);
                lockKinds(reactions, LETTERS);
                expect(reactions.frame).toMatchObject({ aloft: 7, festivals: 1 });
            }
            expect(emittersOf(reactions.frame, 'festival')).toEqual([]);
            expect(reactions.frame.festival).toBe(0);
            expect(reactions.festivalArmed).toBe(false);
        });

        it('can be held again once the sky has emptied to four kites, and not while five are still up', () => {
            const fly = (reactions, letters) => letters.forEach((letter) => {
                reactions.onPieceLock({ piece: pieceOf(letter) });
            });
            // Five kept up: the two that came down are flown again, and it is the same festival.
            const five = create();
            fly(five, LETTERS);
            advance(five, 10);
            fly(five, ['I', 'O', 'T', 'S', 'Z']);
            expect(advance(five, 11).aloft).toBe(5);
            expect(five.festivalArmed).toBe(false);
            fly(five, ['J', 'L']);
            expect(five.frame).toMatchObject({ aloft: 7, festivals: 1 });

            // Four kept up: three came down, and filling the sky again is a new festival.
            const four = create();
            fly(four, LETTERS);
            advance(four, 10);
            fly(four, ['I', 'O', 'T', 'S']);
            expect(advance(four, 11).aloft).toBe(4);
            expect(four.festivalArmed).toBe(true);
            fly(four, ['Z', 'J']);
            expect(four.frame).toMatchObject({ aloft: 6, festivals: 1 });
            fly(four, ['L']);
            expect(four.frame).toMatchObject({ aloft: 7, festivals: 2, festival: 1 });
            expect(four.festivalArmed).toBe(false);

            // And after an empty sky, of course.
            const empty = create();
            lockKinds(empty, LETTERS);
            advance(empty, VERDANT_HILLS_KITE_LINE_SECONDS + 1);
            expect(empty.frame).toMatchObject({ aloft: 0, festivals: 1 });
            lockKinds(empty, LETTERS);
            expect(empty.frame).toMatchObject({ aloft: 7, festivals: 2 });
        });

        it('flies all seven and begins the festival on a perfect clear', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const { frame } = reactions;
            expect(frame).toMatchObject({ aloft: 7, festivals: 1, festival: 1 });
            expect(lines(reactions)).toEqual(Array(VERDANT_HILLS_KITES).fill(VERDANT_HILLS_KITE_LINE_SECONDS));
            expect(Array.from(frame.kiteTug)).toEqual([1, 1, 1, 1, 1, 1, 1]);
            expect(emittersOf(frame, 'festival')).toHaveLength(1);
            expect(ribbonsOf(frame, 'festival')).toHaveLength(1);
            // Another while they are all still up is the same sky full of kites.
            advance(reactions, 5);
            reactions.onPerfectClear();
            expect(reactions.frame).toMatchObject({ aloft: 7, festivals: 1 });
            // ... though every line is paid out afresh.
            expect(lines(reactions)).toEqual(Array(VERDANT_HILLS_KITES).fill(VERDANT_HILLS_KITE_LINE_SECONDS));
            // Once they have come down it fills the sky afresh.
            advance(reactions, VERDANT_HILLS_KITE_LINE_SECONDS + 1);
            expect(reactions.frame.aloft).toBe(0);
            reactions.onPerfectClear();
            expect(reactions.frame).toMatchObject({ aloft: 7, festivals: 2 });
            // With some kites up already it is still one festival, begun by the clear.
            const partly = create();
            lockKinds(partly, ['I', 'O', 'T']);
            partly.onPerfectClear();
            expect(partly.frame).toMatchObject({ aloft: 7, festivals: 1 });
        });

        it('leaves the kites to the pieces and the perfect clear: no other event flies one', () => {
            const reactions = create();
            lockKinds(reactions, ['I', 'O', 'S']);
            const out = lines(reactions);
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(9);
            reactions.onTSpin({ piece: pieceOf('T') });
            reactions.onBackToBack();
            reactions.onLevelUp();
            reactions.onHardDrop({ distance: 18 });
            expect(lines(reactions)).toEqual(out);
            // Not even the T-spin flies the T's kite: its ribbon only wears the colour.
            expect(reactions.line[VERDANT_HILLS_PIECE_KITES.T]).toBe(0);
            expect(reactions.frame).toMatchObject({ aloft: 3, festivals: 0, festival: 0 });
            expect(advance(reactions, 3)).toMatchObject({ aloft: 3, festivals: 0 });
        });

        it('lets the flash of a festival die away', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            let previous = reactions.frame.festival;
            expect(previous).toBeGreaterThan(0.9);
            const fresh = create();
            fresh.onPerfectClear();
            expect(advance(fresh, 1).festival).toBeCloseTo(Math.exp(-0.55), 9);
            for (let step = 0; step < 60 * 30; step++) {
                const { festival } = reactions.update(1 / 60);
                expect(festival).toBeLessThanOrEqual(previous);
                previous = festival;
            }
            expect(previous).toBe(0);
            // The count is a tally, not an envelope.
            expect(reactions.frame.festivals).toBe(1);
        });

        it('brings every kite down at game over, and lets the next game fill the sky again', () => {
            const reactions = create();
            lockKinds(reactions, LETTERS);
            advance(reactions, 3);
            const up = flying(reactions);
            expect(up.every((level) => level > 0.95)).toBe(true);
            reactions.onGameOver();
            // The lines are let go at once; the kites take their time coming down.
            expect(reactions.frame.aloft).toBe(0);
            expect(lines(reactions)).toEqual([0, 0, 0, 0, 0, 0, 0]);
            expect(flying(reactions)).toEqual(up);
            const sinking = Array.from(advance(reactions, 1).kites);
            sinking.forEach((level, slot) => {
                expect(level).toBeLessThan(up[slot]);
                expect(level).toBeGreaterThan(0.4);
            });
            expect(Array.from(advance(reactions, 30).kites)).toEqual([0, 0, 0, 0, 0, 0, 0]);
            expect(reactions.frame.festivals).toBe(1);
            // A new game, straight away: seven more kites are a festival of their own.
            const again = create();
            again.onPerfectClear();
            again.onGameOver();
            again.onPerfectClear();
            expect(again.frame).toMatchObject({ aloft: 7, festivals: 2, settled: false });
        });
    });

    describe('line clears', () => {
        it('streams ribbons out of both sides at the cleared rows, stirs the grass and freshens the wind', () => {
            const reactions = create();
            expect(reactions.onLineClear(1, { clearedRows: [23] })).toBe(true);
            const { frame } = reactions;
            const jets = emittersOf(frame, 'clear');
            expect(frame.emitters).toHaveLength(2);
            expect(jets.map((emitter) => emitter.side)).toEqual([-1, 1]);
            for (const jet of jets) {
                expect(jet).toMatchObject({ lines: 1, row: expect.closeTo(0.025, 12), kite: VERDANT_HILLS_MIXED });
            }
            expect(jets[0].strength).toBe(jets[1].strength);
            expect(jets[0].duration).toBe(jets[1].duration);
            // A ribbon from either edge at the same height, and nothing else.
            const ribbons = live(frame.streaks);
            expect(ribbons.map((ribbon) => [ribbon.kind, ribbon.side])).toEqual([['clear', -1], ['clear', 1]]);
            for (const ribbon of ribbons) {
                expect(ribbon).toMatchObject({ row: jets[0].row, lines: 1, kite: VERDANT_HILLS_MIXED });
            }
            expect(ribbons[0].strength).toBe(ribbons[1].strength);
            // One gust from the foot of the board.
            expect(live(frame.waves)).toEqual([expect.objectContaining({ column: 0.5 })]);
            expect(frame.wind).toBeCloseTo(0.15, 12);
            // One line is not yet a wind front, a break in the clouds or a reason for the birds to go up.
            expect(frame.front).toBeNull();
            expect(frame.sunbreak).toBeNull();
            expect(frame.flock).toBe(0);
            // The kites that are flying stand higher for it.
            expect(advance(reactions, 1).height).toBeGreaterThan(0.25);
            // The middle of several rows is where the ribbons leave.
            const tall = create();
            tall.onLineClear(4, { clearedRows: [10, 11, 12, 13] });
            for (const jet of emittersOf(tall.frame, 'clear')) expect(jet.row).toBeCloseTo(0.6, 12);
            for (const ribbon of live(tall.frame.streaks)) expect(ribbon.row).toBeCloseTo(0.6, 12);
        });

        it('answers a clear more loudly than a lock', () => {
            const lock = create();
            lock.onHardDrop({ distance: BOARD_ROWS });
            lock.onPieceLock({ piece: pieceOf('I') });
            const clear = create();
            clear.onLineClear(1, { clearedRows: [23] });
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter', 'wind']) {
                expect(clear.frame[key], key).toBeGreaterThan(lock.frame[key]);
            }
            expect(newest(clear.frame.waves).strength).toBeGreaterThanOrEqual(newest(lock.frame.waves).strength);
        });

        it('grows every answer with the number of lines', () => {
            const cleared = [1, 2, 3, 4].map((count) => {
                const reactions = create();
                reactions.onLineClear(count, { clearedRows: [20] });
                const frame = snapshot(reactions.frame);
                return { frame, height: advance(reactions, 1).height };
            });
            const jet = (frame) => emittersOf(frame, 'clear')[0];
            const ribbon = (frame) => ribbonsOf(frame, 'clear')[0];
            for (let index = 1; index < cleared.length; index++) {
                const [fewer, more] = [cleared[index - 1].frame, cleared[index].frame];
                for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter', 'wind']) {
                    expect(more[key], `${index + 1} lines ${key}`).toBeGreaterThan(fewer[key]);
                }
                expect(jet(more).strength).toBeGreaterThan(jet(fewer).strength);
                expect(jet(more).duration).toBeGreaterThanOrEqual(jet(fewer).duration);
                expect(jet(more).lines).toBe(index + 1);
                expect(ribbon(more).strength).toBeGreaterThan(ribbon(fewer).strength);
                expect(ribbon(more).lines).toBe(index + 1);
                expect(live(more.waves)[0].strength).toBeGreaterThan(live(fewer.waves)[0].strength);
                // And the more lines, the higher the kites are lifted.
                expect(cleared[index].height).toBeGreaterThan(cleared[index - 1].height);
            }
            expect(cleared.map(({ frame }) => frame.wind))
                .toEqual([0.15, 0.22, 0.29, 0.36].map((wind) => expect.closeTo(wind, 12)));
            cleared.forEach(({ frame }) => expectBounded(frame));
        });

        it('sends a front of wind across the valley from two lines', () => {
            const cleared = (count) => {
                const reactions = create();
                reactions.onLineClear(count, { clearedRows: [22] });
                return reactions;
            };
            expect(cleared(1).frame.front).toBeNull();
            let weaker = 0;
            for (const count of [2, 3, 4]) {
                const reactions = cleared(count);
                // A front that has only just set out is at the upwind edge and has no force yet.
                const { front } = reactions.frame;
                expect(front).toEqual({ position: -1.4, direction: 1, strength: 0 });
                // ... and carries more with more lines.
                const swell = advance(reactions, 0.6).front.strength;
                expect(swell).toBeGreaterThan(weaker);
                weaker = swell;
            }
        });

        it('keeps the rising seed, the birds, the great ribbon and the sunlight for four lines', () => {
            const answer = (count) => {
                const reactions = create();
                reactions.onLineClear(count, { clearedRows: [20, 21, 22, 23].slice(0, count) });
                return reactions;
            };
            const [two, three, four] = [2, 3, 4].map(answer);
            expect(emittersOf(three.frame, 'rise')).toHaveLength(0);
            expect(three.frame.emitters).toHaveLength(2);
            expect(live(three.frame.streaks).map((ribbon) => ribbon.kind)).toEqual(['clear', 'clear']);
            expect(three.frame.flock).toBe(0);
            expect(three.frame.sunbreak).toBeNull();

            expect(four.frame.emitters.map((emitter) => emitter.kind)).toEqual(['clear', 'clear', 'rise']);
            const [rise] = emittersOf(four.frame, 'rise');
            expect(rise).toMatchObject({ lines: 4, row: 0, strength: 1 });
            // The rise is the long one: it outlasts the jets it comes with.
            expect(rise.duration).toBeGreaterThan(emittersOf(four.frame, 'clear')[0].duration);
            expect(rise.strength).toBeGreaterThanOrEqual(emittersOf(four.frame, 'clear')[0].strength);
            expect(four.frame.flock).toBe(1);
            // One great ribbon over the two from the edges, at the height of the rows, from neither side.
            expect(live(four.frame.streaks).map((ribbon) => ribbon.kind)).toEqual(['clear', 'clear', 'great']);
            expect(ribbonsOf(four.frame, 'great')[0]).toMatchObject({
                side: 0, strength: 1, lines: 4, row: emittersOf(four.frame, 'clear')[0].row,
            });
            // The clouds open.
            expect(four.frame.sunbreak).toEqual({ progress: 0, strength: 0 });
            expect(advance(answer(4), 2).sunbreak.strength).toBeGreaterThan(0.8);
            // Warmth and shafts jump further than one more line would take them.
            for (const key of ['warmth', 'shafts']) {
                expect(four.frame[key] - three.frame[key], key)
                    .toBeGreaterThan(three.frame[key] - two.frame[key]);
            }
            // The birds are slow to settle: they are still up when the gust has gone.
            const later = advance(four, 3);
            expect(later.flock).toBeGreaterThan(later.gust);
        });

        it('falls back from cleared rows to the viewport origin, then the piece, then a default height', () => {
            const rowOf = (detail) => {
                const reactions = create();
                reactions.onLineClear(2, detail);
                const [left, right] = emittersOf(reactions.frame, 'clear');
                expect(left.row).toBe(right.row);
                for (const ribbon of ribbonsOf(reactions.frame, 'clear')) expect(ribbon.row).toBe(left.row);
                return left.row;
            };
            const fallback = rowOf(undefined);
            expect(fallback).toBe(0.2);
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

        it('sends each front downwind across the view in 2.6 seconds and then retires it', () => {
            const reactions = create();
            reactions.onLineClear(2);
            const seen = [];
            for (let frame = 0; frame < 60 * 20; frame++) {
                const { front } = reactions.update(1 / 60);
                if (!front) break;
                seen.push({ ...front });
            }
            expect(seen.length / 60).toBeCloseTo(2.6, 1);
            for (let index = 1; index < seen.length; index++) {
                expect(seen[index].position).toBeGreaterThan(seen[index - 1].position);
                expect(seen[index].direction).toBe(1);
            }
            // From one side of the view to the other.
            expect(seen[0].position).toBeLessThan(-1.3);
            expect(seen.at(-1).position).toBeGreaterThan(1.3);
            expect(seen.at(-1).position).toBeLessThanOrEqual(1.4);
            // It swells in, peaks in the middle of the crossing and has all but gone when it leaves.
            const strengths = seen.map((front) => front.strength);
            const peak = Math.max(...strengths);
            const at = strengths.indexOf(peak);
            expect(peak).toBeCloseTo(0.3 + 2 * 0.17, 3);
            expect(at).toBeGreaterThan(seen.length * 0.15);
            expect(at).toBeLessThan(seen.length * 0.85);
            expect(strengths[0]).toBeLessThan(peak * 0.25);
            expect(strengths.at(-1)).toBeLessThan(peak * 0.5);
            expect(reactions.frame.front).toBeNull();
            expect(advance(reactions, 1).front).toBeNull();
        });

        it('always sweeps with the wind, and restarts each front at the upwind edge', () => {
            const reactions = create();
            for (const event of [() => reactions.onLineClear(2), () => reactions.onLevelUp(),
                () => reactions.onPerfectClear(), () => reactions.onLineClear(4), () => reactions.sweep(0.5)]) {
                advance(reactions, 0.7);
                event();
                const { front } = reactions.frame;
                expect(front.direction).toBe(1);
                expect(front.position).toBe(-1.4);
                expect(front.strength).toBe(0);
                expect(advance(reactions, 0.3).front.position).toBeGreaterThan(-1.4);
            }
            // The strength asked is clamped like every other level.
            reactions.sweep(40);
            expect(advance(reactions, 1.1).front.strength).toBeLessThanOrEqual(1);
            reactions.sweep(-3);
            expect(advance(reactions, 1.1).front.strength).toBe(0);
        });
    });

    describe('streaks, the whirl and its heat', () => {
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

        it('leaves the whirl alone for a single clear and winds it from the second in a row', () => {
            const single = create();
            single.onPieceLock();
            single.onLineClear(4);
            expect(advance(single, 1)).toMatchObject({ whirl: 0, heat: 0, streamers: 0 });

            const reactions = create();
            const levels = [];
            for (let streak = 1; streak <= 7; streak++) {
                reactions.onPieceLock();
                reactions.onLineClear(1);
                levels.push(advance(reactions, 1).whirl);
            }
            expect(levels[0]).toBe(0);
            for (let index = 1; index < levels.length; index++) {
                expect(levels[index]).toBeGreaterThan(levels[index - 1]);
            }
            expect(levels.at(-1)).toBeGreaterThan(0.5);
            expect(levels.at(-1)).toBeLessThanOrEqual(1);
        });

        it('stands the kites higher with every clear in a row', () => {
            const reactions = create();
            const heights = [];
            for (let streak = 1; streak <= 6; streak++) {
                reactions.onPieceLock();
                reactions.onLineClear(1);
                heights.push(advance(reactions, 1).height);
            }
            for (let index = 1; index < heights.length; index++) {
                expect(heights[index]).toBeGreaterThan(heights[index - 1]);
            }
            // The sixth single in a row lifts them as high as four lines at once would.
            const four = create();
            four.onLineClear(4);
            expect(reactions.heightTarget).toBeGreaterThan(four.heightTarget);
            expect(reactions.heightTarget).toBeLessThanOrEqual(1);
            // However long the streak, the top of the line is the top.
            for (let streak = 0; streak < 20; streak++) {
                reactions.onPieceLock();
                reactions.onLineClear(4);
            }
            expect(reactions.heightTarget).toBe(1);
            expect(advance(reactions, 3).height).toBeLessThanOrEqual(1);
        });

        it('unfurls the streamers before the whirl brightens, and both only once it has built', () => {
            const reactions = create();
            let previous = { heat: 0, streamers: 0 };
            let streamersFrom = null;
            let heatFrom = null;
            for (let step = 0; step <= 100; step++) {
                reactions.whirl = step / 100;
                const { heat, streamers, whirl } = reactions.frame;
                expect(whirl).toBe(step / 100);
                expect(heat).toBeGreaterThanOrEqual(previous.heat);
                expect(streamers).toBeGreaterThanOrEqual(previous.streamers);
                expect(streamers).toBeGreaterThanOrEqual(heat);
                if (streamers > 0 && streamersFrom === null) streamersFrom = step / 100;
                if (heat > 0 && heatFrom === null) heatFrom = step / 100;
                previous = { heat, streamers };
            }
            // A young whirl has neither; a full one has both in full.
            expect(streamersFrom).toBeCloseTo(0.31, 12);
            expect(heatFrom).toBeCloseTo(0.51, 12);
            expect(previous).toEqual({ heat: 1, streamers: 1 });
            reactions.whirl = 0.8;
            expect(reactions.frame.streamers).toBe(1);
            expect(reactions.frame.heat).toBeCloseTo(0.3 / 0.42, 12);

            // The same through play: a first combo winds a plain whirl, a long one a glowing one.
            const low = create();
            low.onCombo(2);
            const young = advance(low, 1.5);
            expect(young.whirl).toBeGreaterThan(0);
            expect(young.heat).toBe(0);
            const high = create();
            high.onCombo(14);
            const grown = advance(high, 1.5);
            expect(grown.whirl).toBeGreaterThan(young.whirl);
            expect(grown.heat).toBeGreaterThan(0);
            expect(grown.streamers).toBeGreaterThan(young.streamers);
        });

        it('holds the whirl while clears keep coming, then unwinds it to rest with the heat gone first', () => {
            const reactions = create();
            reactions.onCombo(20);
            // It winds up quickly ...
            const early = advance(reactions, 0.5).whirl;
            expect(early).toBeGreaterThan(0.5);
            // ... and stays up for as long as it is fed.
            let held = early;
            for (let second = 0; second < 8; second++) {
                reactions.onCombo(20);
                const { whirl } = advance(reactions, 1);
                expect(whirl).toBeGreaterThanOrEqual(held - 1e-9);
                held = whirl;
            }
            expect(held).toBeGreaterThan(0.9);
            expect(held).toBeLessThanOrEqual(1);
            // Left alone it lets go, the glow first, then the streamers, then the whirl itself.
            const order = [];
            let last = held;
            for (let step = 0; step < 60 * 60 && reactions.whirl > 0; step++) {
                const frame = reactions.update(1 / 60);
                expect(frame.whirl).toBeLessThanOrEqual(last + 1e-9);
                last = frame.whirl;
                if (frame.heat === 0 && !order.includes('heat')) order.push('heat');
                if (frame.streamers === 0 && !order.includes('streamers')) order.push('streamers');
                if (frame.whirl === 0 && !order.includes('whirl')) order.push('whirl');
            }
            expect(order).toEqual(['heat', 'streamers', 'whirl']);
            expect(reactions.frame).toMatchObject({ whirl: 0, heat: 0, streamers: 0 });
        });

        it('keeps the highest whirl while smaller events keep it turning, and starts the next from its own', () => {
            const reactions = create();
            reactions.onCombo(12);
            const high = advance(reactions, 1.5).whirl;
            // A smaller combo and a back-to-back renew the hold without slackening the whirl.
            reactions.onCombo(2);
            expect(advance(reactions, 1.5).whirl).toBeGreaterThanOrEqual(high - 1e-9);
            reactions.onBackToBack();
            expect(advance(reactions, 1.5).whirl).toBeGreaterThanOrEqual(high - 1e-9);
            // Left alone it finally unwinds, and the next whirl is only as tight as its own combo.
            expect(advance(reactions, 30).whirl).toBe(0);
            reactions.onCombo(2);
            const next = advance(reactions, 1.5).whirl;
            expect(next).toBeGreaterThan(0);
            expect(next).toBeLessThan(high);
        });
    });

    describe('combos', () => {
        it('answers a combo with a turn of wind around the board, a gust, a lift and a climbing whirl', () => {
            const reactions = create();
            expect(reactions.onCombo(2)).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(['combo']);
            expect(frame.emitters[0]).toMatchObject({ lines: 2, kite: VERDANT_HILLS_MIXED, row: 0.1 });
            expect(live(frame.waves)).toHaveLength(1);
            // The whirl is its ribbon: nothing leaves the edges of the board.
            expect(live(frame.streaks)).toEqual([]);
            expect(frame.flock).toBe(0);
            expect(frame.front).toBeNull();
            expect(frame.sunbreak).toBeNull();
            expect(frame.aloft).toBe(0);
            for (const key of ['gust', 'warmth', 'shafts', 'glow', 'shimmer', 'flutter', 'wind']) {
                expect(frame[key], key).toBeGreaterThan(0);
            }
            const later = advance(reactions, 0.5);
            expect(later.whirl).toBeGreaterThan(0);
            expect(later.height).toBeGreaterThan(0);
        });

        it('keeps growing with the count and saturates instead of overflowing', () => {
            const answer = (count) => {
                const reactions = create();
                reactions.onCombo(count);
                const frame = snapshot(reactions.frame);
                const later = advance(reactions, 2);
                return { frame, whirl: later.whirl, height: later.height };
            };
            const counts = [2, 3, 5, 8, 13, 21];
            const answers = counts.map(answer);
            for (let index = 1; index < answers.length; index++) {
                const [smaller, larger] = [answers[index - 1], answers[index]];
                expect(larger.whirl).toBeGreaterThan(smaller.whirl);
                expect(larger.height).toBeGreaterThan(smaller.height);
                expect(larger.frame.wind).toBeGreaterThan(smaller.frame.wind);
                expect(larger.frame.emitters[0].strength).toBeGreaterThanOrEqual(smaller.frame.emitters[0].strength);
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
            expect(huge.whirl).toBeLessThanOrEqual(1);
            expect(huge.frame.wind).toBeLessThanOrEqual(0.4);
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
            expect(advance(reactions, 1).whirl).toBe(0);
        });
    });

    describe('flourishes', () => {
        it('answers a t-spin with a spinning ribbon in the colour of the T beside the piece, and a gust', () => {
            const reactions = create();
            expect(reactions.onTSpin({ piece: cell(8, 13) })).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([expect.objectContaining({
                kind: 'spin', side: 1, row: expect.closeTo(0.525, 12), kite: VERDANT_HILLS_PIECE_KITES.T,
            })]);
            expect(live(frame.streaks)).toEqual([expect.objectContaining({
                kind: 'spin', side: 1, row: expect.closeTo(0.525, 12), strength: 0.8, kite: VERDANT_HILLS_PIECE_KITES.T,
            })]);
            expect(live(frame.waves)).toEqual([expect.objectContaining({ column: 0.85, strength: 1.1 })]);
            expect(frame.wind).toBeCloseTo(0.2, 12);
            expect(frame.front).toBeNull();
            expect(frame.sunbreak).toBeNull();
            expect(frame.flock).toBe(0);
            // A spin is announced with the lock that made it: it flies no kite of its own.
            expect(frame.aloft).toBe(0);
            reactions.onTSpin({ detail: { piece: cell(1, 13) } });
            expect(emittersOf(reactions.frame, 'spin')[1]).toMatchObject({ side: -1 });
            expect(ribbonsOf(reactions.frame, 'spin')[1]).toMatchObject({ side: -1 });
            // With nothing to place it, the ribbon still has a side and a height.
            const bare = create();
            bare.onTSpin();
            expectBounded(bare.frame, bare);
            expect(bare.frame.emitters[0]).toMatchObject({ side: -1, row: 0.3 });
            expect(live(bare.frame.streaks)[0]).toMatchObject({ side: -1, row: 0.3 });
            expect(live(bare.frame.waves)[0]).toMatchObject({ column: 0.5 });
        });

        it('lets a back-to-back lift the light, the kites and the whirl without an emitter, a ribbon or a gust', () => {
            const reactions = create();
            expect(reactions.onBackToBack()).toBe(true);
            const { frame } = reactions;
            expect(frame.emitters).toEqual([]);
            expect(live(frame.streaks)).toEqual([]);
            expect(live(frame.waves)).toEqual([]);
            for (const key of ['warmth', 'glow', 'shafts', 'shimmer']) expect(frame[key], key).toBeGreaterThan(0);
            expect(frame.gust).toBe(0);
            expect(frame.flock).toBe(0);
            expect(frame.wind).toBe(0);
            const later = advance(reactions, 1.5);
            expect(later.whirl).toBeGreaterThan(0.5);
            expect(later.streamers).toBeGreaterThan(0);
            expect(later.height).toBeGreaterThan(0.5);
            expect(later.height).toBeLessThanOrEqual(0.6);
        });

        it('makes the whole day exhale on a perfect clear', () => {
            const reactions = create();
            const clear = create();
            clear.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            expect(reactions.onPerfectClear()).toBe(true);
            const { frame } = reactions;
            // Nothing a four-line clear does is louder.
            for (const key of [...ENVELOPES, 'wind']) {
                expect(frame[key], key).toBeGreaterThanOrEqual(clear.frame[key]);
                expect(frame[key], key).toBeGreaterThan(0.5);
            }
            expect(emittersOf(frame, 'rise')).toEqual([expect.objectContaining({
                lines: 4, strength: 1, duration: 3.4,
            })]);
            expect(ribbonsOf(frame, 'great')).toEqual([expect.objectContaining({
                side: 0, row: 0.5, strength: 1, lines: 4,
            })]);
            expect(Math.max(...live(frame.waves).map((wave) => wave.strength)))
                .toBeGreaterThan(Math.max(...live(clear.frame.waves).map((wave) => wave.strength)));
            expect(frame.sunbreak).not.toBeNull();
            // Every kite there is, and so the festival.
            expect(frame).toMatchObject({ aloft: 7, festivals: 1 });
            // The strongest front there is, a whirl from nothing, and the kites at the top of their lines.
            const later = advance(reactions, 1);
            expect(later.front.strength).toBeGreaterThan(advance(clear, 1).front.strength);
            expect(later.whirl).toBeGreaterThan(0.5);
            expect(later.height).toBeGreaterThan(clear.frame.height);
            expect(later.height).toBeGreaterThan(0.85);
            expectBounded(reactions.frame, reactions);
        });

        it('stirs the grass, sweeps a front and flies a great ribbon on a level up', () => {
            const reactions = create();
            expect(reactions.onLevelUp()).toBe(true);
            const { frame } = reactions;
            for (const key of [...ENVELOPES, 'wind']) expect(frame[key], key).toBeGreaterThan(0);
            expect(frame.emitters).toEqual([]);
            expect(live(frame.waves)).toEqual([expect.objectContaining({ column: 0.5, strength: 1.8 })]);
            expect(live(frame.streaks)).toEqual([expect.objectContaining({
                kind: 'great', side: 0, row: 0.5, strength: 0.7, lines: 2,
            })]);
            expect(frame.front).not.toBeNull();
            // A level is not a combo, a festival or a break in the weather.
            expect(frame.sunbreak).toBeNull();
            expect(frame.aloft).toBe(0);
            const later = advance(reactions, 1);
            expect(later.whirl).toBe(0);
            expect(later.height).toBeGreaterThan(0.5);
            // It is a smaller thing than a perfect clear.
            const perfect = create();
            perfect.onPerfectClear();
            for (const key of [...ENVELOPES, 'wind']) {
                expect(frame[key], key).toBeLessThanOrEqual(perfect.frame[key]);
            }
            expect(newest(frame.waves).strength)
                .toBeLessThan(Math.max(...live(perfect.frame.waves).map((wave) => wave.strength)));
            expect(advance(reactions, 0.2).front.strength).toBeLessThan(advance(perfect, 1.2).front.strength);
        });

        it('settles the day at game over without cutting what is already in the air', () => {
            const play = () => {
                const reactions = create();
                reactions.onPieceLock({ piece: pieceOf('I', 1) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(9);
                advance(reactions, 0.6);
                return reactions;
            };
            const slot = VERDANT_HILLS_PIECE_KITES.I;
            const reactions = play();
            const playing = snapshot(reactions.frame);
            expect(playing).toMatchObject({ settled: false, aloft: 1, streak: 1 });
            expect(playing.front).not.toBeNull();
            expect(playing.sunbreak).not.toBeNull();
            expect(playing.whirl).toBeGreaterThan(0.5);
            expect(playing.wind).toBeGreaterThan(0.3);
            expect(playing.height).toBeGreaterThan(0.3);
            expect(playing.kites[slot]).toBeGreaterThan(0.3);

            expect(reactions.onGameOver()).toBe(true);
            const over = snapshot(reactions.frame);
            expect(over).toMatchObject({
                settled: true, front: null, sunbreak: null, streak: 0, aloft: 0,
            });
            // Nothing is cut: emitters, envelopes, ribbons and gusts already asked for play out, and the
            // wind, the whirl and the kites are where they were, only no longer held there.
            expect({
                ...over,
                settled: false,
                front: playing.front,
                sunbreak: playing.sunbreak,
                streak: playing.streak,
                aloft: playing.aloft,
            }).toEqual(playing);
            // The whirl, the wind and the kites let go at once instead of waiting out their holds.
            const still = play();
            const [settling, held] = [advance(reactions, 0.5), advance(still, 0.5)];
            expect(settling.whirl).toBeLessThan(held.whirl);
            expect(settling.wind).toBeLessThan(held.wind);
            expect(settling.height).toBeLessThan(held.height);
            expect(settling.kites[slot]).toBeLessThan(held.kites[slot]);
            expect(held.wind).toBe(playing.wind);
            const later = advance(reactions, 40);
            expect(later).toMatchObject({
                whirl: 0, heat: 0, streamers: 0, height: 0, aloft: 0, settled: true,
            });
            expect(later.wind).toBeLessThan(0.02);
            expect(Array.from(later.kites)).toEqual([0, 0, 0, 0, 0, 0, 0]);
            expect(later.emitters).toEqual([]);
            expect(advance(reactions, 60).wind).toBe(0);
        });

        it.each([
            ['a lock', (reactions) => reactions.onPieceLock()],
            ['a line clear', (reactions) => reactions.onLineClear(1)],
            ['a combo', (reactions) => reactions.onCombo(3)],
            ['a perfect clear', (reactions) => reactions.onPerfectClear()],
        ])('wakes a settled day with %s', (_label, event) => {
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

    describe('the wind dial', () => {
        it('turns up with everything that stirs the air and never past full', () => {
            const wind = (event) => {
                const reactions = create();
                event(reactions);
                return reactions.frame.wind;
            };
            expect(wind((reactions) => reactions.onPieceLock())).toBeCloseTo(0.03, 12);
            expect(wind((reactions) => reactions.onLineClear(1))).toBeCloseTo(0.15, 12);
            expect(wind((reactions) => reactions.onLineClear(4))).toBeCloseTo(0.36, 12);
            expect(wind((reactions) => reactions.onCombo(2))).toBeCloseTo(0.1 + (1 - Math.exp(-0.22)) * 0.3, 12);
            expect(wind((reactions) => reactions.onTSpin())).toBeCloseTo(0.2, 12);
            expect(wind((reactions) => reactions.onLevelUp())).toBeCloseTo(0.3, 12);
            // A perfect clear and the festival it begins fill the dial between them.
            expect(wind((reactions) => reactions.onPerfectClear())).toBe(1);
            // What only changes the light leaves the air alone.
            expect(wind((reactions) => reactions.onBackToBack())).toBe(0);
            expect(wind((reactions) => reactions.onHardDrop({ distance: 20 }))).toBe(0);
            expect(wind((reactions) => reactions.onGameOver())).toBe(0);
            // It adds up, event on event, to a full gale and no further.
            const reactions = create();
            reactions.onPieceLock();
            reactions.onPieceLock();
            expect(reactions.frame.wind).toBeCloseTo(0.06, 12);
            reactions.onLineClear(2);
            expect(reactions.frame.wind).toBeCloseTo(0.28, 12);
            for (let level = 0; level < 20; level++) reactions.onLevelUp();
            expect(reactions.frame.wind).toBe(1);
            expectBounded(reactions.frame, reactions);
        });

        it('holds for a moment, then drops slowly and comes to rest', () => {
            const reactions = create();
            reactions.blow(0.5);
            expect(reactions.frame.wind).toBe(0.5);
            // While it holds it does not move at all.
            for (let step = 0; step < 90; step++) expect(reactions.update(1 / 60).wind).toBe(0.5);
            // By two seconds it has begun to drop ...
            const dropping = advance(reactions, 0.5).wind;
            expect(dropping).toBeLessThan(0.5);
            expect(dropping).toBeGreaterThan(0.47);
            // ... at a steady eleven percent a second: a slow dial, not an envelope.
            const later = advance(reactions, 1).wind;
            expect(later / dropping).toBeCloseTo(Math.exp(-0.11), 9);
            // Six seconds after it let go, half of it is still blowing.
            expect(advance(reactions, 5).wind).toBeCloseTo(0.5 * Math.exp(-0.11 * 6.4), 2);
            let previous = reactions.frame.wind;
            for (let step = 0; step < 60 * 90; step++) {
                const { wind } = reactions.update(1 / 60);
                expect(wind).toBeLessThanOrEqual(previous);
                previous = wind;
            }
            // And in the end the air is still: exactly zero.
            expect(previous).toBe(0);
        });

        it('renews its hold whenever it is fed, and lets go at once at game over', () => {
            const reactions = create();
            reactions.blow(0.4);
            advance(reactions, 1.5);
            reactions.blow(0.1);
            expect(reactions.frame.wind).toBe(0.5);
            // A second and a half into the second hold: it would long have been dropping on the first.
            expect(advance(reactions, 1.5).wind).toBe(0.5);
            reactions.onGameOver();
            expect(reactions.frame.wind).toBe(0.5);
            expect(advance(reactions, 0.1).wind).toBeLessThan(0.5);
        });

        it('takes only real, positive amounts', () => {
            const reactions = create();
            for (const amount of [NaN, Infinity, -Infinity, -1, undefined, null, 'x', {}, []]) {
                reactions.blow(amount);
                expect(reactions.frame.wind, String(amount)).toBe(0);
            }
            reactions.blow(0.25);
            reactions.blow(-0.2);
            expect(reactions.frame.wind).toBe(0.25);
            reactions.blow(5);
            expect(reactions.frame.wind).toBe(1);
        });
    });

    describe('how high the kites stand', () => {
        it('lifts them to the height asked, holds it there, then lets them sink', () => {
            const reactions = create();
            reactions.raise(0.8);
            // Asking alone moves nothing: the lift takes its time.
            expect(reactions.frame.height).toBe(0);
            expect(advance(reactions, 1).height).toBeCloseTo(0.8 * (1 - Math.exp(-2.2)), 9);
            const top = advance(reactions, 2).height;
            expect(top).toBeCloseTo(0.8 * (1 - Math.exp(-6.6)), 9);
            expect(top).toBeLessThan(0.8);
            // The hold is a little over three seconds; after it they sink far more slowly than they rose.
            const sinking = advance(reactions, 1).height;
            expect(sinking).toBeLessThan(top);
            expect(sinking).toBeGreaterThan(top * 0.75);
            const later = advance(reactions, 1).height;
            expect(later / sinking).toBeCloseTo(Math.exp(-0.3), 9);
            let previous = later;
            for (let step = 0; step < 60 * 40; step++) {
                const { height } = reactions.update(1 / 60);
                expect(height).toBeLessThanOrEqual(previous);
                previous = height;
            }
            expect(previous).toBe(0);
            expect(reactions.heightTarget).toBe(0);
        });

        it('keeps the highest call while it holds, and starts the next lift from its own', () => {
            const reactions = create();
            reactions.raise(0.9);
            const high = advance(reactions, 2).height;
            // A lower call renews the hold without letting them down.
            reactions.raise(0.3);
            expect(reactions.heightTarget).toBe(0.9);
            expect(advance(reactions, 2).height).toBeGreaterThan(high);
            reactions.raise(0.2);
            expect(advance(reactions, 2).height).toBeGreaterThan(0.89);
            // Left alone they come down, and the next lift is only as high as it asks.
            expect(advance(reactions, 40).height).toBe(0);
            reactions.raise(0.3);
            const next = advance(reactions, 2).height;
            expect(next).toBeGreaterThan(0.25);
            expect(next).toBeLessThan(0.3);
        });

        it('clamps the level and refuses nonsense', () => {
            const reactions = create();
            reactions.raise(7);
            expect(reactions.heightTarget).toBe(1);
            expect(advance(reactions, 3).height).toBeLessThanOrEqual(1);
            const other = create();
            for (const level of [-3, NaN, Infinity, undefined, null, 'high', {}]) {
                other.raise(level);
                expect(other.heightTarget, String(level)).toBe(0);
            }
            expect(advance(other, 1).height).toBe(0);
            expectBounded(other.frame, other);
        });
    });

    describe('the break in the clouds', () => {
        it('opens for six seconds and carries a pool of sunlight across the hills', () => {
            const reactions = create();
            reactions.sunbreak(1);
            expect(reactions.frame.sunbreak).toEqual({ progress: 0, strength: 0 });
            const seen = [];
            for (let frame = 0; frame < 60 * 20; frame++) {
                const { sunbreak } = reactions.update(1 / 60);
                if (!sunbreak) break;
                seen.push({ ...sunbreak });
            }
            expect(seen.length / 60).toBeCloseTo(6, 1);
            for (let index = 1; index < seen.length; index++) {
                expect(seen[index].progress).toBeGreaterThan(seen[index - 1].progress);
            }
            expect(seen[0].progress).toBeCloseTo(1 / 360, 9);
            expect(seen.at(-1).progress).toBeGreaterThan(0.99);
            expect(seen.at(-1).progress).toBeLessThan(1);
            expect(seen[179].progress).toBeCloseTo(0.5, 9);
            // The light swells as the clouds part, is full in the middle of the crossing and has gone
            // by the time the pool leaves the far hills.
            const strengths = seen.map((pool) => pool.strength);
            const peak = Math.max(...strengths);
            const at = strengths.indexOf(peak);
            expect(peak).toBeGreaterThan(0.999);
            expect(peak).toBeLessThanOrEqual(1);
            expect(at).toBeGreaterThan(seen.length * 0.3);
            expect(at).toBeLessThan(seen.length * 0.6);
            expect(strengths[0]).toBeLessThan(0.1);
            expect(strengths.at(-1)).toBeLessThan(0.01);
            expect(seen[179].strength).toBeCloseTo(Math.sin(Math.PI * 0.54) ** 0.7, 9);
            expect(reactions.frame.sunbreak).toBeNull();
            expect(advance(reactions, 1).sunbreak).toBeNull();
        });

        it('is as bright as it is asked to be, and starts over when the clouds open again', () => {
            const reactions = create();
            reactions.sunbreak(0.5);
            const half = advance(reactions, 3).sunbreak;
            expect(half.progress).toBeCloseTo(0.5, 9);
            expect(half.strength).toBeCloseTo(0.5 * Math.sin(Math.PI * 0.54) ** 0.7, 9);
            reactions.sunbreak(1);
            expect(reactions.frame.sunbreak).toEqual({ progress: 0, strength: 0 });
            expect(advance(reactions, 5.5).sunbreak).not.toBeNull();
            expect(advance(reactions, 1).sunbreak).toBeNull();
            // Clamped like every other level.
            reactions.sunbreak(40);
            expect(advance(reactions, 3).sunbreak.strength).toBeLessThanOrEqual(1);
            reactions.sunbreak(-2);
            expect(advance(reactions, 3).sunbreak).toEqual({ progress: expect.closeTo(0.5, 9), strength: 0 });
        });

        it('comes with four lines, a perfect clear and the festival, and with nothing less', () => {
            const opened = (event) => {
                const reactions = create();
                event(reactions);
                return reactions.frame.sunbreak !== null;
            };
            expect(opened((reactions) => reactions.onLineClear(4))).toBe(true);
            expect(opened((reactions) => reactions.onPerfectClear())).toBe(true);
            expect(opened((reactions) => lockKinds(reactions, LETTERS))).toBe(true);
            expect(opened((reactions) => reactions.onLineClear(3))).toBe(false);
            expect(opened((reactions) => reactions.onCombo(30))).toBe(false);
            expect(opened((reactions) => reactions.onTSpin())).toBe(false);
            expect(opened((reactions) => reactions.onBackToBack())).toBe(false);
            expect(opened((reactions) => reactions.onLevelUp())).toBe(false);
            expect(opened((reactions) => lockKinds(reactions, LETTERS.slice(0, 6)))).toBe(false);
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
                expect(reactions.streakSerial).toBe(0);
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
            const cleared = (...args) => {
                const reactions = create();
                expect(reactions.onLineClear(...args)).toBe(true);
                return emittersOf(reactions.frame, 'clear')[0].lines;
            };
            expect(cleared()).toBe(1);
            expect(cleared('2')).toBe(2);
            expect(cleared(' 3 ')).toBe(3);
            expect(cleared(2.9)).toBe(2);
            expect(cleared(99)).toBe(4);
            expect(cleared({ lineCount: 3 })).toBe(3);
            expect(cleared({ lines: '2' })).toBe(2);
            expect(cleared({ linesCleared: 4 })).toBe(4);
            expect(cleared({ count: 1e6 })).toBe(4);
            expect(cleared({ detail: { lineCount: 2 } })).toBe(2);
            expect(cleared({ lineCount: null, lines: 3 })).toBe(3);

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
                        reactions.onLevelUp(payload);
                    }).not.toThrow();
                    expectBounded(reactions.update(1 / 60), reactions);
                }
                // No hostile payload named a piece, so no kite went up.
                expect(reactions.frame.aloft).toBe(0);
                expect(reactions.frame.festivals).toBe(0);
                for (const payload of hostile) {
                    expect(() => reactions.onPerfectClear(payload)).not.toThrow();
                    expectBounded(reactions.update(1 / 60), reactions);
                }
                reactions.onGameOver({ detail: NaN });
                expectBounded(advance(reactions, 2), reactions);
            }
        });
    });

    describe('time', () => {
        it('lets every envelope die away, never rise, and snaps a dying one to zero', () => {
            const reactions = create();
            reactions.onPerfectClear();
            const levels = (frame) => [...ENVELOPES, 'festival'].map((key) => [key, frame[key]]);
            let previous = snapshot(reactions.frame);
            expect(levels(previous).every(([, value]) => value > 0)).toBe(true);
            for (let step = 0; step < 60; step++) {
                const frame = snapshot(reactions.update(0.25));
                for (const [key, value] of levels(frame)) expect(value, key).toBeLessThanOrEqual(previous[key]);
                for (let slot = 0; slot < VERDANT_HILLS_KITES; slot++) {
                    expect(frame.kiteTug[slot]).toBeLessThanOrEqual(previous.kiteTug[slot]);
                }
                previous = frame;
            }
            // A second in, everything is still there but lower.
            const fresh = create();
            fresh.onPerfectClear();
            const start = snapshot(fresh.frame);
            const one = advance(fresh, 1);
            for (const [key, value] of levels(start)) {
                expect(one[key], key).toBeGreaterThan(0);
                expect(one[key], key).toBeLessThan(value);
                if (key !== 'festival') expect(one[key] / value, key).toBeGreaterThan(Math.exp(-1.41));
            }
            // Each at its own pace: the gust is gone first, the birds last.
            expect(one.gust / start.gust).toBeCloseTo(Math.exp(-1.4), 9);
            expect(one.flock / start.flock).toBeCloseTo(Math.exp(-0.32), 9);
            const later = advance(reactions, 60);
            for (const [key, value] of levels(later)) expect(value, key).toBe(0);
            expect(Array.from(later.kiteTug).every((level) => level === 0)).toBe(true);
        });

        it('advances envelopes, wind, whirl, fronts, sunlight, kites and emitters alike at 30, 60 and 144 Hz', () => {
            const play = (fps) => {
                const reactions = create();
                reactions.onHardDrop({ distance: 12 });
                reactions.onPieceLock({ piece: pieceOf('T', 2) });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                reactions.onCombo(6);
                return snapshot(advance(reactions, 1, fps));
            };
            const reference = play(60);
            expect(reference.emitters.length).toBeGreaterThan(2);
            expect(reference.front).not.toBeNull();
            expect(reference.sunbreak).not.toBeNull();
            for (const fps of [30, 144]) {
                const frame = play(fps);
                for (const [key, value] of Object.entries(reference)) {
                    if (typeof value === 'number') expect(frame[key], `${key} @${fps}`).toBeCloseTo(value, 9);
                }
                // The kites are kept in single precision.
                frame.kites.forEach((level, slot) => expect(level).toBeCloseTo(reference.kites[slot], 5));
                frame.kiteTug.forEach((level, slot) => expect(level).toBeCloseTo(reference.kiteTug[slot], 5));
                expect(frame.front.position).toBeCloseTo(reference.front.position, 9);
                expect(frame.front.strength).toBeCloseTo(reference.front.strength, 9);
                expect(frame.sunbreak.progress).toBeCloseTo(reference.sunbreak.progress, 9);
                expect(frame.sunbreak.strength).toBeCloseTo(reference.sunbreak.strength, 9);
                expect(frame.emitters.map((emitter) => emitter.kind)).toEqual(reference.emitters.map((e) => e.kind));
                frame.emitters.forEach((emitter, index) => {
                    expect(emitter.age).toBeCloseTo(reference.emitters[index].age, 9);
                    expect(emitter.progress).toBeCloseTo(reference.emitters[index].progress, 9);
                });
            }
        });

        it('runs the lines, the wind and the lift on the same clock at any frame rate', () => {
            const until = (fps, start, done) => {
                const reactions = create();
                start(reactions);
                let seconds = 0;
                while (!done(reactions) && seconds < 200) {
                    reactions.update(1 / fps);
                    seconds += 1 / fps;
                }
                return seconds;
            };
            const clocks = [
                ['a kite line', (r) => r.launch(2), (r) => r.aloft === 0, VERDANT_HILLS_KITE_LINE_SECONDS],
                ['a kite on the grass', (r) => { r.launch(2); r.onGameOver(); r.fly[2] = 1; }, (r) => r.fly[2] === 0,
                    Math.log(2000) / 0.45],
                ['the wind', (r) => r.blow(1), (r) => r.wind === 0, 1.6 + Math.log(2000) / 0.11],
                ['the whirl', (r) => r.raiseWhirl(1), (r) => r.whirlHold === 0, 2.6],
                ['the lift', (r) => r.raise(1), (r) => r.heightHold === 0, 3.2],
                ['the front', (r) => r.sweep(1), (r) => !r.front.active, 2.6],
                ['the sunlight', (r) => r.sunbreak(1), (r) => !r.sunpool.active, 6],
            ];
            for (const [label, start, done, expected] of clocks) {
                for (const fps of [30, 60, 144]) {
                    expect(until(fps, start, done), `${label} @${fps}`).toBeCloseTo(expected, 0);
                }
            }
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
            expect(after.festival).toBeLessThan(before.festival);
            expect(after.emitters.at(-1).age).toBeCloseTo(0.2, 12);
            expect(after.front.position).toBeGreaterThan(before.front.position);
            expect(after.sunbreak.progress).toBeGreaterThan(before.sunbreak.progress);
        });
    });

    describe('emitter slots', () => {
        it.each(TIERS.map((quality) => [quality, VERDANT_HILLS_REACTION_LIMITS[quality]]))(
            'keeps an event storm inside the %s budget of %i and uses every slot',
            (quality, capacity) => {
                const reactions = create(quality, 9);
                const random = seededRandom(31);
                const used = new Set();
                const kinds = new Set();
                const ribbons = new Set();
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
                    live(state.streaks).forEach((ribbon) => ribbons.add(ribbon.kind));
                    peak = Math.max(peak, state.emitters.length);
                    const problems = frameProblems(state, reactions);
                    if (problems.length) throw new Error(`frame ${frame}: ${problems.join('; ')}`);
                }
                expect(peak).toBe(capacity);
                expect([...used].sort((a, b) => a - b)).toEqual([...Array(capacity).keys()]);
                expect(reactions.emitters).toHaveLength(capacity);
                // The storm reached the whole language, the festival included.
                expect([...kinds].sort()).toEqual(['clear', 'combo', 'festival', 'lock', 'rise', 'seeds', 'spin']);
                expect([...ribbons].sort()).toEqual([...RIBBON_KINDS].sort());
                expect(reactions.frame.festivals).toBeGreaterThan(0);
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

        it('gives an emitter a side, a place and a kite even when it is asked for none', () => {
            const reactions = create();
            const first = { ...reactions.emit('lock', {}) };
            const second = { ...reactions.emit('lock', {}) };
            expect(first).toMatchObject({
                side: -1, column: 0.5, row: 0.3, strength: 0.5, lines: 0, duration: 1, kite: VERDANT_HILLS_MIXED,
            });
            expect(second.side).toBe(1);
            // What is asked is clamped onto the card.
            expect(reactions.emit('lock', { column: 9, row: -4, strength: 30 }))
                .toMatchObject({ column: 1, row: 0, strength: 1 });
            expectBounded(reactions.frame, reactions);
        });
    });

    describe('the gust and ribbon queues', () => {
        it('numbers gusts and ribbons in the order they were asked for, whatever asked', () => {
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
                const [ribbons, gusts] = [reactions.streakSerial, reactions.waveSerial];
                event();
                expect(reactions.streakSerial).toBeGreaterThanOrEqual(ribbons);
                expect(reactions.waveSerial).toBeGreaterThanOrEqual(gusts);
                const { frame } = reactions;
                if (reactions.streakSerial > 0) expect(newest(frame.streaks).serial).toBe(reactions.streakSerial - 1);
                if (reactions.waveSerial > 0) expect(newest(frame.waves).serial).toBe(reactions.waveSerial - 1);
                // Time does not issue, renumber or retire ribbons or gusts.
                const [issuedRibbons, issuedGusts] = [reactions.streakSerial, reactions.waveSerial];
                const queued = snapshot({ streaks: reactions.streaks, waves: reactions.waves });
                expectBounded(reactions.update(0.4), reactions);
                expect([reactions.streakSerial, reactions.waveSerial]).toEqual([issuedRibbons, issuedGusts]);
                expect(snapshot({ streaks: reactions.streaks, waves: reactions.waves })).toEqual(queued);
            }
            expect(reactions.streakSerial).toBe(13);
            expect(reactions.waveSerial).toBe(10);
        });

        it.each([
            ['waves', 8, (reactions, index) => reactions.gust(((index % 10) + 0.5) / 10, 1 + (index % 5) / 10),
                (serial) => 1 + (serial % 5) / 10],
            ['streaks', 16, (reactions, index) => reactions.streak('clear', {
                column: ((index % 10) + 0.5) / 10, strength: (1 + (index % 5)) / 10,
            }), (serial) => (1 + (serial % 5)) / 10],
        ])('wraps the queue of %s after %i, overwriting the oldest and never reusing a serial', (
            name,
            size,
            ask,
            strength,
        ) => {
            const reactions = create();
            const queue = reactions[name];
            expect(queue).toHaveLength(size);
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
                    expect(entry.strength).toBeCloseTo(strength(entry.serial), 12);
                }
            }
        });

        it('holds every gust and ribbon the busiest lock can ask for', () => {
            const reactions = create();
            for (let lock = 0; lock < 5; lock++) reactions.onPieceLock({ piece: pieceOf('I', lock) });
            advance(reactions, 1);
            const [firstRibbon, firstGust] = [reactions.streakSerial, reactions.waveSerial];
            // One piece: a hard-dropped t-spin that clears four lines on a combo, empties the board
            // (and so begins the festival) and levels up.
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: pieceOf('T') });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(5);
            reactions.onTSpin({ piece: pieceOf('T') });
            reactions.onBackToBack();
            reactions.onPerfectClear();
            reactions.onLevelUp();
            expect(reactions.frame.festivals).toBe(1);
            // None was overwritten before a frame could read it.
            const ribbons = live(reactions.frame.streaks).filter((ribbon) => ribbon.serial >= firstRibbon);
            const gusts = live(reactions.frame.waves).filter((wave) => wave.serial >= firstGust);
            expect(ribbons).toHaveLength(reactions.streakSerial - firstRibbon);
            expect(gusts).toHaveLength(reactions.waveSerial - firstGust);
            expect(ribbons.map((ribbon) => ribbon.kind))
                .toEqual(['lock', 'clear', 'clear', 'great', 'spin', 'great', 'festival', 'great']);
            expect(gusts).toHaveLength(7);
            // The lock's own, the first of each, are still there to be read.
            expect(ribbons[0].serial).toBe(firstRibbon);
            expect(gusts[0].serial).toBe(firstGust);
            // With room to spare: both queues hold it twice over or nearly.
            expect(gusts.length).toBeLessThan(reactions.waves.length);
            expect(ribbons.length * 2).toBeLessThanOrEqual(reactions.streaks.length);
            expectBounded(reactions.frame, reactions);
        });

        it('clamps a gust and a ribbon onto the card and caps their strength', () => {
            const reactions = create();
            const wave = { ...reactions.gust(7, 99) };
            expect(wave).toMatchObject({ serial: 0, column: 1, strength: 3 });
            expect(reactions.gust(-2, -4)).toMatchObject({ serial: 1, column: 0, strength: 0 });
            // One ceiling, however much is asked.
            expect(reactions.gust(0.5, 1e9).strength).toBe(wave.strength);
            const ribbon = reactions.streak('lock', {
                side: 5, column: 7, row: -3, strength: 99, lines: 2, kite: 4,
            });
            expect({ ...ribbon }).toEqual({
                serial: 0, kind: 'lock', side: 1, column: 1, row: 0, strength: 1, lines: 2, kite: 4,
            });
            const other = reactions.streak('spin', {
                side: -0.2, column: -2, row: 5, strength: -4,
            });
            expect(other).toMatchObject({
                serial: 1, side: -1, column: 0, row: 1, strength: 0,
            });
            // A ribbon asked for with nothing is one from the middle of the card, from neither side.
            for (const options of [undefined, {}]) {
                expect(reactions.streak('great', options)).toMatchObject({
                    kind: 'great', side: 0, column: 0.5, row: 0.3, strength: 0.5, lines: 0, kite: VERDANT_HILLS_MIXED,
                });
            }
            for (const side of [0, -0, NaN]) {
                expect(Object.is(reactions.streak('great', { side }).side, 0), String(side)).toBe(true);
            }
            // No gameplay event asks a gust for more than the ceiling.
            const loud = create();
            loud.onHardDrop({ distance: 400 });
            loud.onPieceLock({ piece: pieceOf('L') });
            loud.onPerfectClear();
            loud.onCombo(60);
            for (const entry of live(loud.frame.waves)) expect(entry.strength).toBeLessThan(wave.strength);
            for (const entry of live(loud.frame.streaks)) expect(entry.strength).toBeLessThanOrEqual(1);
        });
    });

    describe('ownership', () => {
        it('hands out emitter snapshots that cannot corrupt the director', () => {
            const reactions = create();
            reactions.onPieceLock({ piece: pieceOf('S', 2) });
            reactions.onLineClear(4);
            const first = reactions.getFrame();
            const second = reactions.getFrame();
            expect(first).not.toBe(second);
            expect(first.emitters).not.toBe(second.emitters);
            expect(first.emitters[0]).not.toBe(second.emitters[0]);
            expect(first.front).not.toBe(second.front);
            expect(first.sunbreak).not.toBe(second.sunbreak);
            const before = snapshot(second);
            first.gust = 99;
            first.wind = 99;
            first.whirl = 99;
            first.aloft = 99;
            first.emitters[0].strength = 99;
            first.emitters[0].active = false;
            first.emitters.length = 0;
            first.front.strength = 99;
            first.front = null;
            first.sunbreak.progress = 99;
            first.sunbreak = null;
            expect(snapshot(reactions.getFrame())).toEqual(before);
            expectBounded(reactions.update(0.1), reactions);
        });

        it('shares its kites and queues live, so a frame held from last tick reads this one', () => {
            const reactions = create();
            const held = reactions.getFrame();
            reactions.onPieceLock({ piece: pieceOf('Z') });
            reactions.update(0.5);
            const { frame } = reactions;
            for (const key of ['kites', 'kiteTug', 'waves', 'streaks']) expect(frame[key], key).toBe(held[key]);
            expect(frame.kites).toBe(reactions.fly);
            expect(frame.kiteTug).toBe(reactions.tug);
            expect(held.kites[VERDANT_HILLS_PIECE_KITES.Z]).toBeGreaterThan(0);
            expect(live(held.streaks)).toHaveLength(1);
        });

        it('resets in place to rest and numbers the next session from zero', () => {
            const reactions = create();
            const {
                emitters, waves, streaks, line, fly, tug, front, sunpool,
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
                time: 0,
                serial: 0,
                streakSerial: 0,
                waveSerial: 0,
                clearStreak: 0,
                settled: false,
                wind: 0,
                windHold: 0,
                height: 0,
                heightHold: 0,
                whirl: 0,
                whirlHold: 0,
                festivals: 0,
                festivalArmed: true,
            });
            // No allocation: the pools are the ones it was built with.
            expect(reactions.emitters).toBe(emitters);
            expect(reactions.waves).toBe(waves);
            expect(reactions.streaks).toBe(streaks);
            expect(reactions.line).toBe(line);
            expect(reactions.fly).toBe(fly);
            expect(reactions.tug).toBe(tug);
            expect(reactions.front).toBe(front);
            expect(reactions.sunpool).toBe(sunpool);
            expectAtRest(advance(reactions, 1));

            // The armed drop is forgotten too, serials start over, and so do the kites and the festival.
            const fresh = create();
            fresh.onPieceLock({ piece: pieceOf('I', 1) });
            reactions.onPieceLock({ piece: pieceOf('I', 1) });
            // The same frame a new director gives, but for its epoch and what the dice decided.
            const comparable = (frame) => snapshot({
                ...frame, epoch: 0, emitters: frame.emitters.map((emitter) => ({ ...emitter, seed: 0 })),
            });
            expect(comparable(reactions.frame)).toEqual(comparable(fresh.frame));
            expect(reactions.frame.emitters).toEqual([expect.objectContaining({ kind: 'lock', serial: 0, id: 0 })]);
            expect(live(reactions.frame.streaks).map((ribbon) => ribbon.serial)).toEqual([0]);
            expect(live(reactions.frame.waves).map((wave) => wave.serial)).toEqual([0]);
            expect(reactions.frame).toMatchObject({ aloft: 1, festivals: 0 });
            fresh.onPerfectClear();
            reactions.onPerfectClear();
            expect(reactions.frame.festivals).toBe(1);
            expect(comparable(reactions.frame)).toEqual(comparable(fresh.frame));
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
                time: 0, serial: 0, streakSerial: 0, waveSerial: 0,
            });
            expect(reactions.frame.aloft).toBe(0);
            expect(() => reactions.dispose()).not.toThrow();

            reactions.reset();
            expect(reactions.disposed).toBe(false);
            expect(reactions.onPieceLock({ piece: pieceOf('O') })).toBe(true);
            expect(reactions.update(0.1).emitters).toHaveLength(1);
            expect(reactions.frame.aloft).toBe(1);
            expect(reactions.onGameOver()).toBe(true);
            expect(reactions.frame.settled).toBe(true);
        });

        it('counts an epoch for every reset, and for nothing else', () => {
            const reactions = create();
            expect(reactions.epoch).toBe(1);
            expect(reactions.frame.epoch).toBe(1);
            // Playing, time, a festival and game over all belong to the same session.
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
                const reactions = new VerdantHillsReactions({ quality: 'Medium', rng });
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
            // The seventh kind locks two seconds in; the perfect clear after it is the same festival.
            expect(first.at(-1).festivals).toBe(1);
            expect(first.find((frame) => frame.festivals === 1).aloft).toBe(7);
            // The seed only decides emitter seeds and where a combo's gust falls.
            const other = play(seededRandom(8)).frames;
            expect(other).not.toEqual(first);
            for (const key of ['gust', 'wind', 'whirl', 'height', 'kites', 'kiteTug', 'aloft', 'streaks']) {
                expect(other.map((frame) => frame[key]), key).toEqual(first.map((frame) => frame[key]));
            }
            expect(other.map((frame) => frame.emitters.map((emitter) => emitter.kind)))
                .toEqual(first.map((frame) => frame.emitters.map((emitter) => emitter.kind)));
            expect(other.map((frame) => frame.waves)).not.toEqual(first.map((frame) => frame.waves));

            for (const broken of [() => NaN, () => Infinity, () => -3, () => 7, () => undefined, () => '0.5',
                () => 1]) {
                const { frames, reactions } = play(broken);
                for (const frame of frames) expect(frameProblems(frame, reactions)).toEqual([]);
                expect(frames.some((frame) => frame.emitters.length > 0)).toBe(true);
            }
            // Not a function at all: the director falls back to Math.random rather than failing.
            const fallback = new VerdantHillsReactions({ rng: 'dice' });
            fallback.onCombo(3);
            expectBounded(fallback.frame, fallback);
        });
    });
});
