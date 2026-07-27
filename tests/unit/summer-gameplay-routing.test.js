import { describe, expect, it } from 'vitest';

import {
    DEW_SEAL_ENVELOPE,
    REDUCED_DEW_SEAL_ENVELOPE,
    SUMMER_FX_COMMAND,
    SummerGameplayRouting,
    resolveSummerLockGlyph,
    resolveSummerLockOrigin,
    sampleDewSealEnvelope,
    wreathTierForCombo,
} from '../../src/themes/summer/composition/summer-gameplay-routing.js';

function tPiece(overrides = {}) {
    return {
        shapeKey: 'T',
        type: 'T',
        x: 3,
        y: 17,
        rotation: 1,
        color: '#abc123',
        pieceId: 42,
        shape: [
            [1, 1, 1],
            [0, 1, 0],
        ],
        ...overrides,
    };
}

function makeClock(start = 1000) {
    const ref = { t: start };
    const clock = () => ref.t;
    clock.advance = (ms) => { ref.t += ms; };
    clock.set = (ms) => { ref.t = ms; };
    return clock;
}

function wreaths(commands) {
    return commands.filter((c) => c.type === SUMMER_FX_COMMAND.WREATH);
}

describe('Summer lock mapping', () => {
    it('preserves the exact four-cell glyph, color, rotation, and occupied centroid', () => {
        const payload = { piece: tPiece(), player: 2, position: { x: 640, y: 360, z: 4 } };
        const glyph = resolveSummerLockGlyph(payload);
        const origin = resolveSummerLockOrigin(payload);

        expect(glyph).toEqual({
            type: 'T',
            color: '#abc123',
            rotation: 1,
            pieceId: 42,
            width: 3,
            height: 2,
            shape: [
                [1, 1, 1],
                [0, 1, 0],
            ],
            cells: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
            ],
            boardCells: [
                { x: 3, y: 17 },
                { x: 4, y: 17 },
                { x: 5, y: 17 },
                { x: 4, y: 18 },
            ],
        });
        expect(origin.board).toEqual({ x: 4.5, y: 17.75 });
        expect(origin.normalized.x).toBeCloseTo(0.45);
        expect(origin.normalized.y).toBeCloseTo(0.6875);
        expect(origin.centered.x).toBeCloseTo(-0.1);
        expect(origin.centered.y).toBeCloseTo(-0.375);
        expect(origin.sideLane.side).toBe('left');
        expect(origin.position).toEqual({ x: 640, y: 360, z: 4 });
        expect(origin.player).toBe(2);
    });

    it('maps I and O centroids and clamps a hidden-row lock to the visible band', () => {
        const iOrigin = resolveSummerLockOrigin({
            piece: {
                type: 'I', x: 3, y: 5, shape: [[1, 1, 1, 1]],
            },
        });
        expect(iOrigin.board).toEqual({ x: 5, y: 5.5 });
        expect(iOrigin.normalized.y).toBeCloseTo(0.075);

        // O locked into the hidden rows above the visible field (y=0 < HIDDEN_ROWS).
        const oOrigin = resolveSummerLockOrigin({
            piece: {
                type: 'O', x: 4, y: 0, shape: [[1, 1], [1, 1]],
            },
        });
        expect(oOrigin.board).toEqual({ x: 5, y: 1 });
        expect(oOrigin.normalized.y).toBe(0); // clamped, not negative
        expect(oOrigin.centered.y).toBe(1);
    });

    it('prefers a mode-supplied viewportOrigin over the fixed-board normalization', () => {
        // Infinity's tall scrolling grid: piece.y is a huge absolute row; the on-screen origin
        // wins so the dew-seal / wreath tracks where the piece actually landed.
        const origin = resolveSummerLockOrigin({
            piece: tPiece({ y: 214 }),
            viewportOrigin: { x: 0.2, y: 0.1 },
        });
        expect(origin.normalized).toEqual({ x: 0.2, y: 0.1 });
        expect(origin.centered.y).toBeCloseTo(0.8);
        expect(origin.sideLane.side).toBe('left');
        expect(origin.board.y).toBeGreaterThan(200); // raw centroid still absolute
    });

    it('ignores an invalid viewportOrigin and keeps the piece-cell normalization', () => {
        const origin = resolveSummerLockOrigin({
            piece: tPiece(),
            viewportOrigin: { x: Number.NaN, y: 0.1 },
        });
        expect(origin.normalized.y).toBeCloseTo(0.6875);
    });

    it('falls back to the canonical orientation and centered board for a missing piece', () => {
        const origin = resolveSummerLockOrigin({});
        expect(origin.board).toEqual({ x: 5, y: 14 });
        expect(origin.normalized).toEqual({ x: 0.5, y: 0.5 });
        expect(origin.sideLane.side).toBe('right');
        expect(origin.position).toBeNull();
    });

    it('alternates the safe side lane deterministically by board half', () => {
        const left = resolveSummerLockOrigin({
            piece: {
                type: 'I', x: 0, y: 10, shape: [[1, 1, 1, 1]],
            },
        });
        const right = resolveSummerLockOrigin({
            piece: {
                type: 'I', x: 6, y: 10, shape: [[1, 1, 1, 1]],
            },
        });
        expect(left.sideLane.side).toBe('left');
        expect(right.sideLane.side).toBe('right');
    });
});

describe('Summer wreath tiers', () => {
    it('grows lobes with the cascade wave and opens the halo only at combo 10+', () => {
        expect(wreathTierForCombo(1)).toBeNull();
        expect(wreathTierForCombo(2)).toMatchObject({ tier: 1, lobes: 2, halo: false });
        expect(wreathTierForCombo(4)).toMatchObject({ tier: 2, lobes: 4, halo: false });
        expect(wreathTierForCombo(6)).toMatchObject({ tier: 3, lobes: 6, halo: false });
        expect(wreathTierForCombo(7)).toMatchObject({ tier: 4, lobes: 7, halo: false });
        expect(wreathTierForCombo(9)).toMatchObject({ tier: 4, lobes: 7, halo: false });
        expect(wreathTierForCombo(10)).toMatchObject({ tier: 5, lobes: 7, halo: true });
        expect(wreathTierForCombo(15)).toMatchObject({ tier: 5, lobes: 7, halo: true });
    });
});

describe('SummerGameplayRouting — lock and combo commands', () => {
    it('emits one DEW_SEAL per lock carrying the glyph, origin, and player', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('PIECE_LOCK', { piece: tPiece(), player: 2, position: { x: 1, y: 2 } });
        const commands = routing.drainCommands();

        expect(commands).toHaveLength(1);
        expect(commands[0].type).toBe(SUMMER_FX_COMMAND.DEW_SEAL);
        expect(commands[0].player).toBe(2);
        expect(commands[0].wispCount).toBe(8);
        expect(commands[0].glyph.boardCells).toEqual([
            { x: 3, y: 17 }, { x: 4, y: 17 }, { x: 5, y: 17 }, { x: 4, y: 18 },
        ]);
        expect(commands[0].origin.normalized.x).toBeCloseTo(0.45);
        expect(commands[0].origin.position).toEqual({ x: 1, y: 2 });
    });

    it('advances the wreath lobe-by-lobe and dedupes a repeated combo count', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() });
        routing.dispatch('COMBO', { comboCount: 2 });
        routing.dispatch('COMBO', { comboCount: 2 }); // duplicate — no new milestone
        routing.dispatch('COMBO', { comboCount: 3 });
        const w = wreaths(routing.drainCommands());

        expect(w.map((c) => c.comboCount)).toEqual([2, 3]);
        expect(w.map((c) => c.lobeTarget)).toEqual([2, 3]);
    });

    it('places the wreath at the last lock origin', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() });
        routing.dispatch('COMBO', { comboCount: 2 });
        const [w] = wreaths(routing.drainCommands());
        expect(w.origin.normalized.x).toBeCloseTo(0.45);
        expect(w.origin.normalized.y).toBeCloseTo(0.6875);
    });
});

describe('SummerGameplayRouting — COMBO/LINE_CLEAR correlation', () => {
    it('emits exactly one milestone for normal COMBO → LINE_CLEAR order', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() });
        routing.dispatch('COMBO', { comboCount: 2 });
        routing.dispatch('LINE_CLEAR', { lineCount: 1, comboCount: 2, clearedRows: [18] });
        const w = wreaths(routing.drainCommands());
        expect(w).toHaveLength(1);
        expect(w[0].comboCount).toBe(2);
    });

    it('emits exactly one milestone for Serenity LINE_CLEAR → COMBO order', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('LINE_CLEAR', {
            lineCount: 1, comboCount: 3, clearedRows: [19], source: 'serenity-interaction',
        });
        routing.dispatch('COMBO', { comboCount: 3, source: 'serenity-interaction' });
        const w = wreaths(routing.drainCommands());
        expect(w).toHaveLength(1);
        expect(w[0].comboCount).toBe(3);
    });

    it('falls back to one wreath when only LINE_CLEAR carries comboCount (no COMBO)', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('LINE_CLEAR', {
            lineCount: 2, comboCount: 4, clearedRows: [18, 19], source: 'odyssey', levelId: 'ch3',
        });
        const w = wreaths(routing.drainCommands());
        expect(w).toHaveLength(1);
        expect(w[0].comboCount).toBe(4);
        expect(w[0].lobeTarget).toBe(4);
        // Origin derived from the cleared rows' centroid.
        expect(w[0].origin.normalized.y).toBeCloseTo(0.75);
        // A second drain must not re-emit the resolved fallback.
        expect(wreaths(routing.drainCommands())).toHaveLength(0);
    });

    it('does not double-emit when a line clear repeats an already-emitted combo', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('COMBO', { comboCount: 5 });
        routing.dispatch('LINE_CLEAR', { lineCount: 1, comboCount: 5, clearedRows: [17] });
        expect(wreaths(routing.drainCommands())).toHaveLength(1);
    });
});

describe('SummerGameplayRouting — sequence resets', () => {
    it('starts a fresh wreath on a new lock', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() });
        routing.dispatch('COMBO', { comboCount: 4 });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() }); // resets the sequence
        routing.dispatch('COMBO', { comboCount: 2 });
        const w = wreaths(routing.drainCommands());
        expect(w.map((c) => c.comboCount)).toEqual([4, 2]);
    });

    it('starts a fresh wreath on a non-monotonic combo drop', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('COMBO', { comboCount: 5 });
        routing.dispatch('COMBO', { comboCount: 2 }); // drop → reset → fresh small wreath
        const w = wreaths(routing.drainCommands());
        expect(w.map((c) => c.comboCount)).toEqual([5, 2]);
        expect(w.map((c) => c.lobeTarget)).toEqual([5, 2]);
    });

    it('starts a fresh wreath after an inactivity gap', () => {
        const clock = makeClock(1000);
        const routing = new SummerGameplayRouting({ clock });

        routing.dispatch('COMBO', { comboCount: 4 });
        expect(wreaths(routing.drainCommands())).toHaveLength(1);

        // Same count again without a gap must NOT re-emit.
        routing.dispatch('COMBO', { comboCount: 4 });
        expect(wreaths(routing.drainCommands())).toHaveLength(0);

        // After a long quiet gap the same count starts a fresh sequence.
        clock.advance(3000);
        routing.dispatch('COMBO', { comboCount: 4 });
        expect(wreaths(routing.drainCommands())).toHaveLength(1);
    });
});

describe('SummerGameplayRouting — stream isolation', () => {
    it('keeps wreath progression independent per (source, levelId, player) stream', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('PIECE_LOCK', { piece: tPiece(), player: 1 });
        routing.dispatch('COMBO', { comboCount: 3, player: 1 });
        routing.dispatch('COMBO', { comboCount: 2, player: 2 });
        const w = wreaths(routing.drainCommands());

        const byPlayer = Object.fromEntries(w.map((c) => [c.player, c]));
        expect(byPlayer[1].lobeTarget).toBe(3);
        expect(byPlayer[2].lobeTarget).toBe(2);
    });

    it('distinguishes Odyssey levels by levelId', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispatch('COMBO', { comboCount: 5, source: 'odyssey', levelId: 'ch3' });
        routing.dispatch('COMBO', { comboCount: 2, source: 'odyssey', levelId: 'ch7' });
        const w = wreaths(routing.drainCommands());
        expect(w.map((c) => c.comboCount).sort()).toEqual([2, 5]);
    });

    it('bounds active streams to four with least-recently-used reclamation', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        for (let player = 0; player < 6; player += 1) {
            routing.dispatch('COMBO', { comboCount: 2, player });
        }
        routing.drainCommands();
        expect(routing.getState().streamCount).toBe(4);
    });
});

describe('SummerGameplayRouting — lifecycle and gating', () => {
    it('suppresses spawns when intensity is zero (effect disabled)', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock(), intensityMultiplier: 0 });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() });
        routing.dispatch('COMBO', { comboCount: 4 });
        expect(routing.drainCommands()).toHaveLength(0);
    });

    it('shortens durations and drops wisps under reduced motion', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock(), reducedMotion: true });
        routing.dispatch('PIECE_LOCK', { piece: tPiece() });
        const [seal] = routing.drainCommands();
        expect(seal.wispCount).toBe(0);
        expect(seal.motionScale).toBe(0);
        expect(seal.durationMs).toBe(REDUCED_DEW_SEAL_ENVELOPE.durationMs);
    });

    it('emits nothing after disposal and is idempotent', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        routing.dispose();
        routing.dispose();
        expect(routing.dispatch('PIECE_LOCK', { piece: tPiece() })).toBeNull();
        expect(routing.drainCommands()).toHaveLength(0);
    });

    it('ignores unknown events', () => {
        const routing = new SummerGameplayRouting({ clock: makeClock() });
        expect(routing.dispatch('NOT_A_REAL_EVENT', {})).toBeNull();
        expect(routing.drainCommands()).toHaveLength(0);
    });
});

describe('sampleDewSealEnvelope', () => {
    it('presses immediately, lifts, then fades to nothing', () => {
        const start = sampleDewSealEnvelope(0);
        expect(start.opacity).toBe(1);
        expect(start.lift).toBe(0);
        expect(start.complete).toBe(false);

        const mid = sampleDewSealEnvelope(DEW_SEAL_ENVELOPE.liftEndMs);
        expect(mid.lift).toBe(1);

        const end = sampleDewSealEnvelope(DEW_SEAL_ENVELOPE.durationMs);
        expect(end.opacity).toBe(0);
        expect(end.complete).toBe(true);
    });

    it('has no lifted beads or wisps in the reduced-motion form', () => {
        const mid = sampleDewSealEnvelope(60, true);
        expect(mid.lift).toBe(0);
        expect(mid.wispOpacity).toBe(0);
        expect(sampleDewSealEnvelope(REDUCED_DEW_SEAL_ENVELOPE.durationMs, true).complete).toBe(true);
    });
});
