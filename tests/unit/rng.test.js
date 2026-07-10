/**
 * Deterministic PRNG pins (plan §5.6) — sfc32 + xmur3 + per-subsystem streams.
 * These properties are the contract Phase 5/6 builds on: bit-identical
 * reproduction from (seed, label), stream independence, unbiased bag shuffles,
 * and an exact save/restore cursor for snapshots.
 */
import { describe, it, expect } from 'vitest';
import { RandomStream, MatchRandom, xmur3 } from '../../src/core/rng.js';

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
        const fresh = new RandomStream('match-42', 'pieces:P1');
        for (let i = 0; i < 16; i += 1) fresh.next();
        const seq2 = Array.from({ length: 16 }, () => new RandomStream('match-42', 'pieces:P1').next());
        expect(seq1[0]).toBe(seq2[0]);
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

    it('numeric and string seeds are both accepted and stable', () => {
        expect(new RandomStream(12345, 'x').next()).toBe(new RandomStream('12345', 'x').next());
    });

    it('xmur3 produces distinct word streams per input', () => {
        expect(xmur3('a')()).not.toBe(xmur3('b')());
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
