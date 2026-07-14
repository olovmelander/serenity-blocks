/**
 * Deterministic PRNG pins (plan §5.6) — sfc32 + xmur3 + per-subsystem streams.
 * These properties are the contract Phase 5/6 builds on: bit-identical
 * reproduction from (seed, label), stream independence, unbiased bag shuffles,
 * and an exact save/restore cursor for snapshots.
 */
import {
    describe, it, expect, vi,
} from 'vitest';
import { fillBag } from '../../src/core/game.js';
import {
    createSfc32Random, MatchRandom, RandomStream, restoreSfc32Random,
    SFC32_ALGORITHM, xmur3,
} from '../../src/core/rng.js';
import { seededRandom } from '../../src/utils/helpers.js';

describe('RandomStream determinism', () => {
    it('same (seed, label) → bit-identical sequence', () => {
        const a = new RandomStream('match-42', 'pieces:P1');
        const b = new RandomStream('match-42', 'pieces:P1');
        for (let i = 0; i < 1000; i += 1) expect(a.next()).toBe(b.next());
    });

    it('different labels over one seed are independent streams', () => {
        const pieces = new RandomStream('match-42', 'pieces:P1');
        const garbage = new RandomStream('match-42', 'garbage:P1');
        const seq1 = Array.from({ length: 16 }, () => pieces.next());
        // Draw a DIFFERENT amount from garbage — pieces must be unaffected.
        for (let i = 0; i < 7; i += 1) garbage.next();
        const continuation = Array.from({ length: 16 }, () => pieces.next());
        const fresh = new RandomStream('match-42', 'pieces:P1');
        expect(Array.from({ length: 16 }, () => fresh.next())).toEqual(seq1);
        expect(Array.from({ length: 16 }, () => fresh.next())).toEqual(continuation);
    });

    it('save/restore reproduces the exact continuation (the §5.9 seam)', () => {
        const s = new RandomStream('m', 'pieces:P2');
        for (let i = 0; i < 123; i += 1) s.next();
        const snapshot = s.getState();
        const cont1 = Array.from({ length: 50 }, () => s.next());
        const restored = RandomStream.fromState(snapshot);
        const cont2 = Array.from({ length: 50 }, () => restored.next());
        expect(cont2).toEqual(cont1);
        expect(snapshot.drawCount).toBe(123);
    });

    it('nextInt is unbiased-by-construction and in range (rejection sampling)', () => {
        const s = new RandomStream('bag-seed', 'pieces:P1');
        const counts = new Array(7).fill(0);
        for (let i = 0; i < 70000; i += 1) counts[s.nextInt(7)] += 1;
        for (const c of counts) {
            expect(c).toBeGreaterThan(9500); // expected 10000 ± noise
            expect(c).toBeLessThan(10500);
        }
    });

    it('7-bag shuffle: deterministic, a permutation, and χ²-sane over positions', () => {
        const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        const a = new RandomStream('m7', 'pieces:P1');
        const b = new RandomStream('m7', 'pieces:P1');
        expect(a.shuffle([...PIECES])).toEqual(b.shuffle([...PIECES]));

        // Every bag stays a permutation; over many bags, each piece lands in
        // each position roughly uniformly (bag-distribution sanity, plan §5.6).
        const s = new RandomStream('chi', 'pieces:P1');
        const positionCounts = Array.from({ length: 7 }, () => new Array(7).fill(0));
        const N = 7000;
        for (let bag = 0; bag < N; bag += 1) {
            const arr = s.shuffle([...PIECES]);
            expect([...arr].sort()).toEqual([...PIECES].sort());
            arr.forEach((p, pos) => { positionCounts[pos][PIECES.indexOf(p)] += 1; });
        }
        const expected = N / 7;
        for (const row of positionCounts) {
            const chi2 = row.reduce((acc, c) => acc + ((c - expected) ** 2) / expected, 0);
            expect(chi2).toBeLessThan(30); // df=6; 30 is far beyond the 0.001 tail
        }
    });

    it('rejects unsafe nextInt bounds and accepts the full uint32 range', () => {
        const stream = new RandomStream('bounds', 'pieces');
        for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32 + 1]) {
            expect(() => stream.nextInt(invalid)).toThrow(RangeError);
        }
        expect(stream.nextInt(1)).toBe(0);
        expect(stream.nextInt(2 ** 32)).toBeGreaterThanOrEqual(0);
    });

    it('serializes canonical uint32 words', () => {
        const stream = new RandomStream('match-42', 'pieces:shared-v1');
        for (let i = 0; i < 12; i += 1) stream.next();
        const state = stream.getState();
        for (const field of ['a', 'b', 'c', 'd']) {
            expect(Number.isInteger(state[field])).toBe(true);
            expect(state[field]).toBeGreaterThanOrEqual(0);
            expect(state[field]).toBeLessThanOrEqual(0xffffffff);
        }
    });

    it('validates restored state atomically', () => {
        const random = createSfc32Random('source', 'pieces:source');
        random();
        const original = structuredClone(random.getState());
        const malformedStates = [
            { ...original, a: -0x80000001 },
            { ...original, b: 2 ** 32 },
            { ...original, c: 1.5 },
            { ...original, d: Number.NaN },
            { ...original, drawCount: -1 },
            { ...original, drawCount: Number.MAX_SAFE_INTEGER + 1 },
            { ...original, seed: 7 },
            { ...original, label: null },
        ];
        for (const malformed of malformedStates) {
            expect(() => random.setState(malformed)).toThrow();
            expect(random.getState()).toEqual(original);
        }

        const replacement = createSfc32Random('replacement', 'pieces:replacement');
        for (let i = 0; i < 9; i += 1) replacement();
        expect(random.setState(replacement.getState())).toBe(random);
        expect(random.seed).toBe('replacement');
        expect(random.label).toBe('pieces:replacement');
        expect(random()).toBe(replacement());
    });

    it('normalizes legacy signed-int32 cursor words bit-exactly', () => {
        const source = createSfc32Random('match-42', 'pieces:shared-v1');
        source();
        const canonical = source.getState();
        const legacy = {
            ...canonical,
            a: canonical.a | 0,
            b: canonical.b | 0,
            c: canonical.c | 0,
            d: canonical.d | 0,
        };
        expect(legacy.a).toBeLessThan(0);

        const restored = restoreSfc32Random(legacy);

        expect(restored.getState()).toEqual(canonical);
        expect(Array.from({ length: 32 }, () => restored()))
            .toEqual(Array.from({ length: 32 }, () => source()));
    });

    it('rejects an unadvanceable drawCount and fails atomically at the terminal cursor', () => {
        const state = createSfc32Random('draw-limit', 'pieces').getState();
        expect(() => restoreSfc32Random({
            ...state,
            drawCount: Number.MAX_SAFE_INTEGER,
        })).toThrow(/drawCount/);

        const terminal = restoreSfc32Random({
            ...state,
            drawCount: Number.MAX_SAFE_INTEGER - 1,
        });
        const before = terminal.getState();
        expect(() => terminal()).toThrow(RangeError);
        expect(terminal.getState()).toEqual(before);
    });

    it('numeric and string seeds are both accepted and stable', () => {
        expect(new RandomStream(12345, 'x').next()).toBe(new RandomStream('12345', 'x').next());
    });

    it('xmur3 produces distinct word streams per input', () => {
        expect(xmur3('a')()).not.toBe(xmur3('b')());
    });
});

describe('canonical callable sfc32-v1 adapter', () => {
    it('pins the fixed output vector and adapter metadata', () => {
        const random = createSfc32Random('match-42', 'pieces:shared-v1');
        const words = Array.from(
            { length: 10 },
            () => Math.floor(random() * 0x100000000),
        );
        expect(words).toEqual([
            1133842877, 1714644183, 3826949519, 4165770247, 639744577,
            3150542182, 1988637429, 3241203614, 1784947510, 1379367984,
        ]);
        expect(random.algorithm).toBe(SFC32_ALGORITHM);
        expect(random.seed).toBe('match-42');
        expect(random.label).toBe('pieces:shared-v1');
        expect(random.nextInt).toEqual(expect.any(Function));
        expect(random.getState).toEqual(expect.any(Function));
        expect(random.setState).toEqual(expect.any(Function));
    });

    it('lets fillBag select the integer capability without consuming the float callable', () => {
        const random = vi.fn(() => {
            throw new Error('float fallback must not be called');
        });
        random.nextInt = vi.fn(() => 0);
        const queue = [];

        fillBag(queue, random);

        expect(queue).toHaveLength(14);
        expect(random).not.toHaveBeenCalled();
        expect(random.nextInt).toHaveBeenCalledTimes(12);
    });

    it('retains the exact legacy float-path bag sequence', () => {
        const queue = [];
        fillBag(queue, seededRandom(987654));
        expect(queue).toEqual([
            'I', 'T', 'L', 'J', 'S', 'O', 'Z',
            'O', 'J', 'T', 'Z', 'L', 'I', 'S',
        ]);
    });
});

describe('MatchRandom (per-subsystem stream factory)', () => {
    it('stream() memoizes; state round-trips every cursor', () => {
        const m = new MatchRandom('match-99');
        const p1 = m.stream('pieces:P1');
        for (let i = 0; i < 42; i += 1) p1.next();
        m.stream('garbage:P1').next();
        expect(m.stream('pieces:P1')).toBe(p1); // memoized

        const restored = MatchRandom.fromState(m.getState());
        expect(restored.stream('pieces:P1').next()).toBe(p1.next());
        expect(restored.stream('pieces:P1').drawCount).toBe(p1.drawCount);
    });

    it('a late joiner reconstructs their own stream independent of others', () => {
        // Host match: P1 drew 500 times, P2's stream untouched by that.
        const host = new MatchRandom('m-late');
        for (let i = 0; i < 500; i += 1) host.stream('pieces:P1').next();
        const p2First = host.stream('pieces:P2').next();
        // Joiner knows only (matchSeed, own label):
        const joiner = new MatchRandom('m-late');
        expect(joiner.stream('pieces:P2').next()).toBe(p2First);
    });
});
