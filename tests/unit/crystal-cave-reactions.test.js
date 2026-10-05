import { describe, expect, it } from 'vitest';
import {
    CRYSTAL_CAVE_FAMILY_COUNT, CRYSTAL_CAVE_MAX_CUES, CRYSTAL_CAVE_PIECE_FAMILY, CRYSTAL_CAVE_WAVE_SECONDS,
    CRYSTAL_CAVE_WAVE_SPEED, CrystalCaveReactions,
} from '../../src/themes/crystal-cave/crystal-cave-reactions.js';

function seeded(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const cuesOf = (director) => director.cues.slice(0, director.cueCount).map((cue) => ({ ...cue, tint: [...cue.tint] }));
const types = (director) => cuesOf(director).map((cue) => cue.type);
const piece = (type, x = 4, y = 20, color) => ({
    type, x, y, shape: [[1, 1, 1], [0, 1, 0]], color,
});

function run(director, seconds, hz = 60) {
    const steps = Math.round(seconds * hz);
    for (let index = 0; index < steps; index += 1) {
        director.update(1 / hz);
        director.clearCues();
    }
}

describe('Crystal Cave reactions — the director at rest', () => {
    it('starts as an idle cave: every family at its resting level and nothing queued', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        const frame = director.getFrame();
        expect([...frame.familyLevel]).toEqual(new Array(CRYSTAL_CAVE_FAMILY_COUNT).fill(1));
        expect(frame).toMatchObject({
            energy: 0, resonance: 0, flash: 0, worms: 0, shaft: 0, dim: 0, lattice: 0, combo: 0, streak: 0,
        });
        expect(frame.wave).toEqual({
            active: false, radius: -100, strength: 0, far: false,
        });
        expect(director.cueCount).toBe(0);
    });

    it('returns the same frame object every update so a render loop never allocates', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        const frame = director.getFrame();
        director.onPieceLock({ piece: piece('T') });
        expect(director.update(0.016)).toBe(frame);
        expect(director.getFrame().familyLevel).toBe(frame.familyLevel);
    });

    it.each([NaN, Infinity, -1, 0, undefined, '0.1'])('ignores a malformed step of %s', (dt) => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear(2);
        const before = director.energy;
        director.update(dt);
        expect(director.time).toBe(0);
        expect(director.energy).toBe(before);
        expect(director.getFrame().energy).toBe(before);
    });
});

describe('Crystal Cave reactions — a lock', () => {
    it('maps every tetromino to the mineral family of its colour', () => {
        expect(CRYSTAL_CAVE_PIECE_FAMILY).toEqual({
            I: 4, O: 1, T: 0, S: 3, Z: 2, J: 4, L: 0,
        });
        for (const [type, family] of Object.entries(CRYSTAL_CAVE_PIECE_FAMILY)) {
            const director = new CrystalCaveReactions({ rng: seeded() });
            director.onPieceLock({ piece: piece(type.toLowerCase()) });
            expect(cuesOf(director)[0].family).toBe(family);
            expect(director.getFrame().familyLevel[family]).toBe(1);
            director.update(0.001);
            const levels = [...director.getFrame().familyLevel];
            expect(levels[family]).toBeGreaterThan(1.3);
            levels.forEach((level, index) => { if (index !== family) expect(level).toBe(1); });
        }
    });

    it('places the cue beside the piece: side from its column, height from its row', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onPieceLock({ piece: piece('T', 0, 22) });
        director.onPieceLock({ piece: piece('T', 7, 6) });
        const [left, right] = cuesOf(director);
        expect(left.type).toBe('lock');
        expect(left.side).toBe(-1);
        expect(left.column).toBeLessThan(0.3);
        expect(left.row).toBeLessThan(0.15);
        expect(right.side).toBe(1);
        expect(right.column).toBeGreaterThan(0.7);
        expect(right.row).toBeGreaterThan(0.8);
    });

    it('prefers the on-screen origin Infinity mode supplies over the absolute board row', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onPieceLock({ piece: piece('T', 1, 400), viewportOrigin: { x: 0.9, y: 0.25 } });
        const [cue] = cuesOf(director);
        expect(cue.side).toBe(1);
        expect(cue.column).toBeCloseTo(0.9);
        expect(cue.row).toBeCloseTo(0.75);
    });

    it('carries the piece colour only when it is a real colour', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onPieceLock({ piece: piece('S', 2, 20, '#ff8000') });
        director.onPieceLock({ piece: piece('S', 2, 20, 0x00ff00) });
        director.onPieceLock({ piece: piece('S', 2, 20, 'red') });
        director.onPieceLock({ piece: piece('S', 2, 20, -4) });
        director.onPieceLock({ piece: piece('S', 2, 20, { r: 1 }) });
        const cues = cuesOf(director);
        expect(cues[0].tinted).toBe(true);
        expect(cues[0].tint).toEqual([1, 128 / 255, 0]);
        expect(cues[1].tint).toEqual([0, 1, 0]);
        expect(cues.slice(2).every((cue) => cue.tinted === false)).toBe(true);
    });

    it('answers a long hard drop harder than a soft landing, once', () => {
        const soft = new CrystalCaveReactions({ rng: seeded() });
        soft.onPieceLock({ piece: piece('I') });
        const hard = new CrystalCaveReactions({ rng: seeded() });
        hard.onHardDrop({ distance: 18 });
        hard.onPieceLock({ piece: piece('I') });
        hard.onPieceLock({ piece: piece('I') });
        const [dropped, next] = cuesOf(hard);
        expect(dropped.drop).toBeCloseTo(0.9);
        expect(dropped.strength).toBeGreaterThan(cuesOf(soft)[0].strength + 0.3);
        expect(next.drop).toBe(0);
        expect(hard.getFrame().worms).toBe(0);
        hard.update(0.001);
        expect(hard.getFrame().worms).toBeGreaterThan(0.3);
    });

    it('reads a drop distance from start and end rows and survives a payload without either', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onHardDrop({ startY: 2, endY: 12 });
        expect(director.pendingDrop).toBeCloseTo(0.5);
        director.onHardDrop({});
        expect(director.pendingDrop).toBe(0);
        director.onHardDrop(null);
        expect(director.pendingDrop).toBe(0);
    });

    it.each([undefined, null, {}, { piece: null }, { piece: { x: NaN } }, { detail: {} }, 7, 'lock'])(
        'answers a lock with no usable piece (%j) from alternating sides',
        (payload) => {
            const director = new CrystalCaveReactions({ rng: seeded() });
            expect(director.onPieceLock(payload)).toBe(true);
            expect(director.onPieceLock(payload)).toBe(true);
            const [first, second] = cuesOf(director);
            expect(first.side).toBe(-1);
            expect(second.side).toBe(1);
            expect(Number.isFinite(first.row) && Number.isFinite(first.column)).toBe(true);
        },
    );

    it('is a local event: no wave, no growth, no hum', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onPieceLock({ piece: piece('T') });
        director.update(0.016);
        expect(types(director)).toEqual(['lock']);
        const frame = director.getFrame();
        expect(frame.wave.active).toBe(false);
        expect(frame.resonance).toBe(0);
        expect(frame.energy).toBeLessThan(0.15);
    });
});

describe('Crystal Cave reactions — line clears', () => {
    it.each([1, 2, 3, 4])('answers %i line(s) with a fan, a wave and that many new crystals', (lines) => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        expect(director.onLineClear({ lineCount: lines, clearedRows: [20] })).toBe(true);
        const cues = cuesOf(director);
        expect(cues.find((cue) => cue.type === 'clear')).toMatchObject({ lines });
        expect(cues.find((cue) => cue.type === 'grow').count).toBe(lines);
        expect(cues.filter((cue) => cue.type === 'wave')).toHaveLength(1);
        expect(cues.some((cue) => cue.type === 'shower')).toBe(lines === 4);
        const frame = director.update(0.001);
        expect(frame.wave.active).toBe(true);
        expect([...frame.familyLevel].every((level) => level > 1.2)).toBe(true);
        expect(frame.shaft > 0).toBe(lines >= 3);
    });

    it('grows stronger with the number of lines', () => {
        const energy = [1, 2, 3, 4].map((lines) => {
            const director = new CrystalCaveReactions({ rng: seeded() });
            director.onLineClear(lines);
            return [director.energy, cuesOf(director).find((cue) => cue.type === 'clear').strength];
        });
        for (let index = 1; index < energy.length; index += 1) {
            expect(energy[index][0]).toBeGreaterThan(energy[index - 1][0]);
            expect(energy[index][1]).toBeGreaterThan(energy[index - 1][1]);
        }
    });

    it('fires the fan at the height of the cleared rows', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear({ lineCount: 2, clearedRows: [22, 23] });
        director.onLineClear({ lineCount: 1, clearedRows: [6] });
        const [low, high] = cuesOf(director).filter((cue) => cue.type === 'clear');
        expect(low.row).toBeLessThan(0.1);
        expect(high.row).toBeGreaterThan(0.85);
    });

    it('keeps a sensible height when Infinity mode reports rows far beyond a board', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear({ lineCount: 1, clearedRows: [412], viewportOrigin: { x: 0.5, y: 0.4 } });
        expect(cuesOf(director).find((cue) => cue.type === 'clear').row).toBeCloseTo(0.6);
    });

    it('sends a second wave after four lines, once the first is under way', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear(4);
        director.clearCues();
        const seen = [];
        for (let index = 0; index < 60; index += 1) {
            director.update(1 / 60);
            seen.push(...types(director));
            director.clearCues();
        }
        expect(seen.filter((type) => type === 'wave')).toHaveLength(1);
        expect(director.getFrame().wave.strength).toBeGreaterThan(0.6);
    });

    it.each([0, -3, '', '  ', NaN, Infinity, true, [], {}, null])('ignores a clear of %j lines', (lines) => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        expect(director.onLineClear(lines)).toBe(false);
        expect(director.cueCount).toBe(0);
        expect(director.energy).toBe(0);
    });

    it('reads the count from canonical fields, aliases and a detail envelope, capped at four', () => {
        for (const payload of [{ lineCount: 3 }, { lines: '3' }, { linesCleared: 3 }, { count: 3.9 }, { detail: { lines: 3 } }]) {
            const director = new CrystalCaveReactions({ rng: seeded() });
            director.onLineClear(payload);
            expect(cuesOf(director).find((cue) => cue.type === 'clear').lines).toBe(3);
        }
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear({ lineCount: 9000 });
        expect(cuesOf(director).find((cue) => cue.type === 'clear').lines).toBe(4);
    });
});

describe('Crystal Cave reactions — the wave', () => {
    it('travels at the published speed and fades out by the published time', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear(2);
        director.update(0.5);
        expect(director.getFrame().wave.radius).toBeCloseTo(0.5 * CRYSTAL_CAVE_WAVE_SPEED);
        const early = director.getFrame().wave.strength;
        run(director, CRYSTAL_CAVE_WAVE_SECONDS * 0.6);
        expect(director.getFrame().wave.strength).toBeLessThan(early);
        run(director, CRYSTAL_CAVE_WAVE_SECONDS * 0.5);
        expect(director.getFrame().wave).toMatchObject({ active: false, radius: -100, strength: 0 });
    });

    it('keeps one wave in flight and one in hand, however many clears arrive', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        for (let index = 0; index < 40; index += 1) director.onLineClear(1 + (index % 4));
        expect(cuesOf(director).filter((cue) => cue.type === 'wave')).toHaveLength(1);
        director.clearCues();
        let started = 0;
        for (let index = 0; index < 600; index += 1) {
            director.update(1 / 60);
            started += types(director).filter((type) => type === 'wave').length;
            director.clearCues();
        }
        expect(started).toBe(1);
        expect(director.getFrame().wave.active).toBe(false);
    });

    it('starts from the far end of the hall for a level up', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLevelUp();
        expect(cuesOf(director).find((cue) => cue.type === 'wave').count).toBe(1);
        expect(cuesOf(director).some((cue) => cue.type === 'heart')).toBe(true);
        expect(director.update(0.001).wave.far).toBe(true);
    });

    it('answers a perfect clear from the board at once and from the heart a moment later', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onPerfectClear();
        expect(cuesOf(director).filter((cue) => cue.type === 'wave').map((cue) => cue.count)).toEqual([0]);
        expect(director.update(0.001).wave.far).toBe(false);
        director.clearCues();
        const later = [];
        for (let index = 0; index < 90; index += 1) {
            director.update(1 / 60);
            later.push(...cuesOf(director).filter((cue) => cue.type === 'wave').map((cue) => cue.count));
            director.clearCues();
        }
        expect(later).toEqual([1]);
        expect(director.getFrame().wave.far).toBe(true);
    });
});

describe('Crystal Cave reactions — chains', () => {
    function chain(director, length) {
        for (let step = 1; step <= length; step += 1) {
            director.onPieceLock({ piece: piece('T') });
            director.onLineClear(1);
            if (step >= 2) director.onCombo(step);
            run(director, 0.6);
        }
    }

    it('raises the hum and the lattice as a chain grows', () => {
        const levels = [2, 4, 8].map((length) => {
            const director = new CrystalCaveReactions({ rng: seeded() });
            chain(director, length);
            return director.getFrame();
        });
        expect(levels[0].resonance).toBeGreaterThan(0.2);
        expect(levels[1].resonance).toBeGreaterThan(levels[0].resonance);
        expect(levels[2].resonance).toBeGreaterThan(levels[1].resonance);
        expect(levels[2].lattice).toBeLessThanOrEqual(1);
        expect(levels.map((frame) => frame.combo)).toEqual([2, 4, 8]);
    });

    it('counts consecutive clearing locks as a chain even without a combo event', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        for (let step = 0; step < 3; step += 1) {
            director.onPieceLock({ piece: piece('L') });
            director.onLineClear(1);
            run(director, 0.5);
        }
        expect(director.getFrame().streak).toBe(3);
        expect(director.getFrame().resonance).toBeGreaterThan(0.2);
        expect(director.getFrame().combo).toBe(3);
    });

    it('lets the lattice go the moment a lock clears nothing', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        chain(director, 5);
        director.onPieceLock({ piece: piece('O') });
        expect(types(director)).toEqual(['lock']);
        director.clearCues();
        director.onPieceLock({ piece: piece('O') });
        const cues = cuesOf(director);
        expect(cues[0].type).toBe('release');
        expect(cues[0].count).toBe(5);
        expect(director.getFrame().streak).toBe(5);
        director.update(0.016);
        expect(director.getFrame()).toMatchObject({ combo: 0, streak: 0 });
        const fading = director.getFrame().resonance;
        run(director, 2);
        expect(director.getFrame().resonance).toBeLessThan(fading * 0.4);
    });

    it('lets the lattice go by itself when the chain is simply not fed', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        chain(director, 4);
        let released = 0;
        for (let index = 0; index < 60 * 6; index += 1) {
            director.update(1 / 60);
            released += types(director).filter((type) => type === 'release').length;
            director.clearCues();
        }
        expect(released).toBe(1);
        expect(director.getFrame().combo).toBe(0);
        expect(director.getFrame().resonance).toBeLessThan(0.1);
    });

    it.each([0, 1, -2, NaN, true, {}, [], null, undefined, ''])('stays quiet for a combo of %j', (count) => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        expect(director.onCombo(count)).toBe(false);
        expect(director.cueCount).toBe(0);
        expect(director.getFrame().resonance).toBe(0);
    });

    it('holds the hum through a back-to-back', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onBackToBack();
        run(director, 0.5);
        expect(director.getFrame().resonance).toBeGreaterThan(0.3);
        expect(director.getFrame().combo).toBe(2);
    });
});

describe('Crystal Cave reactions — flourishes and the end of a game', () => {
    it('spins a pinwheel beside the piece on a t-spin', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onTSpin({ piece: piece('T', 8, 10) });
        const [cue] = cuesOf(director);
        expect(cue).toMatchObject({ type: 'spin', side: 1, family: 0 });
        expect(director.energy).toBeGreaterThan(0.5);
    });

    it('answers a perfect clear with everything the cave has', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onPerfectClear();
        expect(types(director).sort()).toEqual(['grow', 'heart', 'shower', 'wave']);
        const frame = director.update(0.001);
        expect(frame.energy).toBeGreaterThan(0.99);
        expect(frame.worms).toBeGreaterThan(0.99);
        expect(frame.shaft).toBeGreaterThan(0.99);
    });

    it('dims the cave and withdraws what grew when the game ends, then recovers', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear(4);
        director.onCombo(6);
        director.onGameOver();
        expect(types(director)).toEqual(['wither']);
        const frame = director.update(0.016);
        expect(frame.dim).toBeGreaterThan(0.9);
        expect([...frame.familyLevel].every((level) => level < 0.75)).toBe(true);
        expect(frame.wave.active).toBe(false);
        expect(frame.combo).toBe(0);
        run(director, 30);
        expect([...director.getFrame().familyLevel].every((level) => level > 0.99 && level <= 1.01)).toBe(true);
    });
});

describe('Crystal Cave reactions — bounds, determinism and lifecycle', () => {
    it('never queues more cues than the fixed list holds and keeps every envelope bounded', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        for (let burst = 0; burst < 20; burst += 1) {
            for (let index = 0; index < 30; index += 1) {
                director.onHardDrop({ distance: index });
                director.onPieceLock({ piece: piece('IOTSZJL'[index % 7], index % 10, 4 + (index % 20)) });
                director.onLineClear(1 + (index % 4));
                director.onCombo(index);
                director.onTSpin({});
                director.onBackToBack();
                director.onPerfectClear();
                director.onLevelUp();
            }
            expect(director.cueCount).toBeLessThanOrEqual(CRYSTAL_CAVE_MAX_CUES);
            const frame = director.update(1 / 30);
            director.clearCues();
            for (const key of ['energy', 'resonance', 'flash', 'worms', 'shaft', 'dim', 'lattice']) {
                expect(frame[key]).toBeGreaterThanOrEqual(0);
                expect(frame[key]).toBeLessThanOrEqual(1);
            }
            for (const level of frame.familyLevel) {
                expect(level).toBeGreaterThan(0);
                expect(level).toBeLessThanOrEqual(3.8);
            }
            expect(frame.wave.strength).toBeLessThanOrEqual(1);
        }
        expect(director.cues).toHaveLength(CRYSTAL_CAVE_MAX_CUES);
    });

    it('settles to the same envelopes at 30 Hz and 144 Hz', () => {
        const at = (hz) => {
            const director = new CrystalCaveReactions({ rng: seeded() });
            director.onHardDrop({ distance: 12 });
            director.onPieceLock({ piece: piece('S') });
            director.onLineClear(3);
            director.onCombo(4);
            run(director, 1.5, hz);
            const frame = director.getFrame();
            return [frame.energy, frame.flash, frame.worms, frame.shaft, ...frame.familyLevel, frame.wave.radius];
        };
        const slow = at(30);
        const fast = at(144);
        slow.forEach((value, index) => expect(value).toBeCloseTo(fast[index], 1));
    });

    it('replays identically after reset', () => {
        const director = new CrystalCaveReactions({ rng: seeded(9) });
        const play = () => {
            director.onPieceLock({ piece: piece('Z', 2) });
            director.onLineClear(2);
            director.onCombo(3);
            const cues = cuesOf(director);
            run(director, 0.8);
            return JSON.stringify([cues, director.getFrame()]);
        };
        const first = play();
        director.reset();
        expect(director.getFrame().energy).toBe(0);
        expect(play()).toBe(first);
    });

    it('goes quiet once disposed', () => {
        const director = new CrystalCaveReactions({ rng: seeded() });
        director.onLineClear(4);
        director.dispose();
        expect(director.cueCount).toBe(0);
        for (const [method, argument] of [['onPieceLock', {}], ['onLineClear', 4], ['onCombo', 5], ['onTSpin', {}],
            ['onBackToBack'], ['onPerfectClear'], ['onLevelUp'], ['onGameOver'], ['onHardDrop', { distance: 9 }]]) {
            expect(director[method](argument)).toBe(false);
        }
        expect(director.cueCount).toBe(0);
        const time = director.time;
        director.update(1);
        expect(director.time).toBe(time);
    });

    it('survives a random source that returns nonsense', () => {
        const director = new CrystalCaveReactions({ rng: () => NaN });
        expect(director.random()).toBe(0.5);
        expect(new CrystalCaveReactions({ rng: 'not a function' }).random()).toBeGreaterThanOrEqual(0);
    });
});
