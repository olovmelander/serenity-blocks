import { describe, expect, it } from 'vitest';

import BlackHoleFXController, {
    BLACK_HOLE_COMBO_PHENOMENON,
    BLACK_HOLE_FX_COMMAND,
    BLACK_HOLE_FX_LIMITS,
    BLACK_HOLE_LOCK_ENVELOPE,
    REDUCED_BLACK_HOLE_LOCK_ENVELOPE,
    resolveBlackHoleComboPhenomenon,
    resolveBlackHoleLineOrigin,
    resolveBlackHoleLockGlyph,
    resolveBlackHoleLockOrigin,
    sampleBlackHoleLockEnvelope,
} from '../../src/themes/black-hole/black-hole-fx-controller.js';

function tPiece(overrides = {}) {
    return {
        shapeKey: 'T',
        x: 3,
        y: 16,
        rotation: 1,
        color: '#a8f4ff',
        pieceId: 42,
        shape: [
            [0, 0, 0],
            [1, 1, 1],
            [0, 1, 0],
        ],
        ...overrides,
    };
}

describe('Black Hole lock geometry', () => {
    it('preserves exact occupied cells and maps their centroid into board-neutral coordinates', () => {
        const payload = {
            piece: tPiece(),
            player: 2,
            position: { x: 640, y: 360, z: 4 },
        };

        const glyph = resolveBlackHoleLockGlyph(payload);
        const origin = resolveBlackHoleLockOrigin(payload);

        expect(glyph).toEqual({
            type: 'T',
            color: '#a8f4ff',
            rotation: 1,
            pieceId: 42,
            shape: [
                [0, 0, 0],
                [1, 1, 1],
                [0, 1, 0],
            ],
            cells: [
                { x: 0, y: 1 },
                { x: 1, y: 1 },
                { x: 2, y: 1 },
                { x: 1, y: 2 },
            ],
            boardCells: [
                { x: 3, y: 17 },
                { x: 4, y: 17 },
                { x: 5, y: 17 },
                { x: 4, y: 18 },
            ],
            hasBoardPosition: true,
        });
        expect(origin.board).toEqual({ x: 4.5, y: 17.75 });
        expect(origin.normalized.x).toBeCloseTo(0.45);
        expect(origin.normalized.y).toBeCloseTo(0.6875);
        expect(origin.centered.x).toBeCloseTo(-0.1);
        expect(origin.centered.y).toBeCloseTo(-0.375);
        expect(origin.position).toEqual({ x: 640, y: 360, z: 4 });
        expect(origin.player).toBe(2);
    });

    it('prefers a mode-supplied viewportOrigin over the fixed-board normalization', () => {
        // Infinity's tall scrolling grid makes piece.y a huge absolute row that would saturate
        // normalizedY to 1 (bottom); the on-screen origin wins for normalized + centered.
        const origin = resolveBlackHoleLockOrigin({
            piece: tPiece({ y: 214 }),
            viewportOrigin: { x: 0.2, y: 0.1 },
        });
        expect(origin.normalized).toEqual({ x: 0.2, y: 0.1 });
        expect(origin.centered.x).toBeCloseTo(-0.6);
        expect(origin.centered.y).toBeCloseTo(0.8);
        expect(origin.board.y).toBeGreaterThan(200); // raw centroid still absolute
    });

    it('ignores an invalid viewportOrigin and keeps the piece-cell normalization', () => {
        const origin = resolveBlackHoleLockOrigin({
            piece: tPiece(),
            viewportOrigin: { x: 0.2, y: Number.NaN },
        });
        expect(origin.normalized.y).toBeCloseTo(0.6875);
    });

    it('uses the previous action origin for a malformed lock without inventing cells', () => {
        const fallback = resolveBlackHoleLockOrigin({ piece: tPiece(), player: 3 });
        const payload = {
            piece: { shapeKey: 'I', shape: [[1, 1]] },
            player: 3,
            position: { x: 120, y: 240 },
        };

        const glyph = resolveBlackHoleLockGlyph(payload);
        const origin = resolveBlackHoleLockOrigin(payload, fallback);

        expect(glyph.cells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
        expect(glyph.boardCells).toEqual([]);
        expect(glyph.hasBoardPosition).toBe(false);
        expect(origin.board).toEqual(fallback.board);
        expect(origin.position).toEqual({ x: 120, y: 240 });
        expect(origin.player).toBe(3);
    });

    it('maps cleared rows to their visible board-aligned centroid', () => {
        const origin = resolveBlackHoleLineOrigin({
            lineCount: 4,
            clearedRows: [20, 21, 22, 23],
            cascadeCount: 2,
            player: 1,
        });

        expect(origin.board).toEqual({ x: 5, y: 22 });
        expect(origin.normalized).toEqual({ x: 0.5, y: 0.9 });
        expect(origin.centered).toEqual({ x: 0, y: -0.8 });
        expect(origin.player).toBe(1);
    });

    it('prefers a mode-supplied viewportOrigin for the line-clear origin (Infinity)', () => {
        // Absolute Infinity clear rows would saturate normalizedY to 1 (bottom); on-screen wins.
        const origin = resolveBlackHoleLineOrigin({
            clearedRows: [210, 211, 212],
            viewportOrigin: { x: 0.5, y: 0.3 },
        });
        expect(origin.normalized.y).toBeCloseTo(0.3);
        expect(origin.centered.y).toBeCloseTo(0.4);
        expect(origin.board.y).toBeGreaterThan(200); // raw mean row still absolute
    });
});

describe('Black Hole three-beat lock envelope', () => {
    it('sequences compression, ripple, matter stream, and delayed core without timers', () => {
        expect(sampleBlackHoleLockEnvelope(55)).toMatchObject({
            compression: 1,
            rippleProgress: 0,
            core: 0,
            complete: false,
        });

        const ripple = sampleBlackHoleLockEnvelope(95);
        expect(ripple.rippleOpacity).toBe(1);
        expect(ripple.rippleProgress).toBeGreaterThan(0);
        expect(ripple.core).toBe(0);

        const stream = sampleBlackHoleLockEnvelope(165);
        expect(stream.streamProgress).toBeCloseTo(0.5);
        expect(stream.streamOpacity).toBeCloseTo(1);

        const core = sampleBlackHoleLockEnvelope(245);
        expect(core.core).toBe(1);
        expect(core.complete).toBe(false);

        expect(sampleBlackHoleLockEnvelope(BLACK_HOLE_LOCK_ENVELOPE.durationMs)).toMatchObject({
            compression: 0,
            rippleOpacity: 0,
            core: 0,
            complete: true,
        });
    });

    it('retains only the short core response in reduced-motion mode', () => {
        expect(sampleBlackHoleLockEnvelope(45, true)).toMatchObject({
            compression: 0,
            rippleProgress: 0,
            rippleOpacity: 0,
            streamProgress: 0,
            streamOpacity: 0,
            core: 1,
            complete: false,
        });
        expect(sampleBlackHoleLockEnvelope(
            REDUCED_BLACK_HOLE_LOCK_ENVELOPE.durationMs,
            true,
        ).complete).toBe(true);
    });
});

describe('Black Hole event routing', () => {
    it('queues an immutable spatial lock command and preserves separate player origins', () => {
        const controller = new BlackHoleFXController();
        const firstPayload = { piece: tPiece(), player: 1 };
        const first = controller.onPieceLock(firstPayload);
        firstPayload.piece.shape[1][0] = 0;
        firstPayload.piece.x = 9;

        controller.onPieceLock({
            piece: tPiece({ x: 6, pieceId: 84 }),
            player: 2,
        });
        const playerOneCombo = controller.onCombo({ comboCount: 2, player: 1 });
        const playerTwoCombo = controller.onCombo({ comboCount: 2, player: 2 });

        expect(first).toMatchObject({
            type: BLACK_HOLE_FX_COMMAND.PIECE_LOCK,
            player: 1,
            durationMs: BLACK_HOLE_LOCK_ENVELOPE.durationMs,
            motionScale: 1,
            lockMotes: BLACK_HOLE_FX_LIMITS.maxLockMotes,
            matterStreamParticles: BLACK_HOLE_FX_LIMITS.maxMatterStreamParticles,
            rippleCount: 1,
        });
        expect(first.glyph.shape[1]).toEqual([1, 1, 1]);
        expect(first.origin.board.x).toBe(4.5);
        expect(playerOneCombo.origin.board.x).toBe(4.5);
        expect(playerTwoCombo.origin.board.x).toBe(7.5);
        expect(controller.getState().playerCount).toBe(2);
    });

    it('normalizes and caps line-clear commands while retaining canonical context', () => {
        const controller = new BlackHoleFXController();
        const command = controller.onLineClear({
            lineCount: 12,
            clearedRows: Array.from({ length: 40 }, (_, index) => index),
            cascadeCount: 30,
            player: 4,
        });

        expect(command).toMatchObject({
            type: BLACK_HOLE_FX_COMMAND.LINE_CLEAR,
            player: 4,
            rawLineCount: 12,
            lineCount: BLACK_HOLE_FX_LIMITS.maxVisualLineCount,
            cascadeCount: BLACK_HOLE_FX_LIMITS.maxCascadeCount,
        });
        expect(command.clearedRows).toHaveLength(BLACK_HOLE_FX_LIMITS.maxClearedRows);
        expect(command.intensity).toBeLessThanOrEqual(1);
    });

    it('routes combo counts into four bounded phenomenon tiers', () => {
        expect(resolveBlackHoleComboPhenomenon(1)).toBe(
            BLACK_HOLE_COMBO_PHENOMENON.RING_PULSE,
        );
        expect(resolveBlackHoleComboPhenomenon(3)).toBe(
            BLACK_HOLE_COMBO_PHENOMENON.SHEAR_DOPPLER,
        );
        expect(resolveBlackHoleComboPhenomenon(5)).toBe(
            BLACK_HOLE_COMBO_PHENOMENON.STELLAR_ARC,
        );
        expect(resolveBlackHoleComboPhenomenon(8)).toBe(
            BLACK_HOLE_COMBO_PHENOMENON.CAUSTIC,
        );

        const controller = new BlackHoleFXController();
        const commands = [1, 3, 5, 8].map((comboCount) => (
            controller.onCombo({ comboCount })
        ));

        expect(commands.map((command) => command.phenomenon)).toEqual([
            BLACK_HOLE_COMBO_PHENOMENON.RING_PULSE,
            BLACK_HOLE_COMBO_PHENOMENON.SHEAR_DOPPLER,
            BLACK_HOLE_COMBO_PHENOMENON.STELLAR_ARC,
            BLACK_HOLE_COMBO_PHENOMENON.CAUSTIC,
        ]);
        const caustic = commands[3];
        expect(caustic.comboCount).toBe(8);
        expect(caustic.directives.ringEchoes).toBeLessThanOrEqual(
            BLACK_HOLE_FX_LIMITS.maxRingEchoes,
        );
        expect(caustic.directives.stellarArcs).toBeLessThanOrEqual(
            BLACK_HOLE_FX_LIMITS.maxStellarArcs,
        );
        expect(caustic.directives.polarFilaments).toBeLessThanOrEqual(
            BLACK_HOLE_FX_LIMITS.maxPolarFilaments,
        );
        expect(caustic.directives.backgroundWarp).toBeLessThanOrEqual(1);
        expect(caustic.intensity).toBeLessThanOrEqual(1);
    });

    it('rejects duplicate combo delivery but resets cleanly when a chain restarts', () => {
        const controller = new BlackHoleFXController();

        expect(controller.onCombo({ comboCount: 4, player: 1 })).not.toBeNull();
        expect(controller.onCombo({ comboCount: 4, player: 1 })).toBeNull();
        expect(controller.onCombo({ comboCount: 1, player: 1 })).toMatchObject({
            phenomenon: BLACK_HOLE_COMBO_PHENOMENON.RING_PULSE,
        });
    });

    it('dispatches only known canonical event names', () => {
        const controller = new BlackHoleFXController();

        expect(controller.dispatch('PIECE_LOCK', { piece: tPiece() })).toMatchObject({
            type: BLACK_HOLE_FX_COMMAND.PIECE_LOCK,
        });
        expect(controller.dispatch('LINE_CLEAR', { lineCount: 2 })).toMatchObject({
            type: BLACK_HOLE_FX_COMMAND.LINE_CLEAR,
        });
        expect(controller.dispatch('COMBO', { comboCount: 3 })).toMatchObject({
            type: BLACK_HOLE_FX_COMMAND.COMBO,
        });
        expect(controller.dispatch('toString', {})).toBeNull();
        expect(controller.dispatch('UNKNOWN', {})).toBeNull();
    });
});

describe('Black Hole bounds and delta-time state', () => {
    it('coalesces equivalent pending work and drops stale commands at the hard queue bound', () => {
        const controller = new BlackHoleFXController({ maxCommands: 3 });

        controller.onLineClear({ lineCount: 1, player: 1 });
        controller.onLineClear({ lineCount: 4, player: 1 });
        expect(controller.getState()).toMatchObject({
            pendingCommandCount: 1,
            coalescedCommandCount: 1,
        });

        controller.onLineClear({ lineCount: 1, player: 2 });
        controller.onLineClear({ lineCount: 1, player: 3 });
        controller.onLineClear({ lineCount: 1, player: 4 });

        expect(controller.getState()).toMatchObject({
            pendingCommandCount: 3,
            droppedCommandCount: 1,
        });
        expect(controller.drainCommands().map((command) => command.player)).toEqual([2, 3, 4]);
        expect(controller.drainCommands()).toEqual([]);
    });

    it('caps simultaneous lock envelopes independently of command capacity', () => {
        const controller = new BlackHoleFXController({ maxCommands: 64 });

        for (let index = 0; index < 12; index += 1) {
            controller.onPieceLock({
                piece: tPiece({ pieceId: index, x: index % 7 }),
            });
        }

        expect(controller.getState().activeLockCount).toBe(BLACK_HOLE_FX_LIMITS.maxActiveLocks);
    });

    it('produces the same lock and combo state for equal elapsed time at different frame rates', () => {
        const coarse = new BlackHoleFXController();
        const fine = new BlackHoleFXController();
        coarse.onPieceLock({ piece: tPiece() });
        fine.onPieceLock({ piece: tPiece() });
        coarse.onCombo({ comboCount: 8 });
        fine.onCombo({ comboCount: 8 });

        for (let index = 0; index < 2; index += 1) coarse.step(0.05);
        for (let index = 0; index < 10; index += 1) fine.step(0.01);

        const coarseSignals = coarse.getSignals();
        const fineSignals = fine.getSignals();
        expect(coarseSignals.lockCompression).toBeCloseTo(fineSignals.lockCompression, 8);
        expect(coarseSignals.lockRipple).toBeCloseTo(fineSignals.lockRipple, 8);
        expect(coarseSignals.comboEnergy).toBeCloseTo(fineSignals.comboEnergy, 8);
        expect(coarseSignals.caustic).toBeCloseTo(fineSignals.caustic, 8);

        for (let index = 0; index < 7; index += 1) coarse.step(0.05);
        expect(coarse.getSignals().activeLockCount).toBe(0);
    });

    it('turns spatial motion off while retaining a capped reduced-motion core pulse', () => {
        const controller = new BlackHoleFXController({
            reducedMotion: true,
            intensityMultiplier: 1,
        });
        const lock = controller.onPieceLock({ piece: tPiece() });
        const combo = controller.onCombo({ comboCount: 8 });

        expect(lock).toMatchObject({
            reducedMotion: true,
            motionScale: 0,
            durationMs: REDUCED_BLACK_HOLE_LOCK_ENVELOPE.durationMs,
            lockMotes: 0,
            matterStreamParticles: 0,
            rippleCount: 0,
        });
        expect(lock.intensity).toBeCloseTo(0.42 * 0.45);
        expect(combo).toMatchObject({
            reducedMotion: true,
            motionScale: 0,
            durationMs: 240,
        });

        const signals = controller.step(0.045);
        expect(signals.lockCompression).toBe(0);
        expect(signals.lockRipple).toBe(0);
        expect(signals.matterStream).toBe(0);
        expect(signals.delayedCore).toBeCloseTo(lock.intensity);
    });

    it('resets deterministically and disposes idempotently', () => {
        const controller = new BlackHoleFXController();
        controller.onPieceLock({ piece: tPiece() });
        controller.onCombo({ comboCount: 8 });
        controller.step(0.1);
        controller.reset();

        expect(controller.getState()).toMatchObject({
            pendingCommandCount: 0,
            activeLockCount: 0,
            playerCount: 0,
            droppedCommandCount: 0,
            coalescedCommandCount: 0,
            disposed: false,
        });
        expect(controller.getSignals()).toMatchObject({
            lockCompression: 0,
            comboEnergy: 0,
            timeMs: 0,
        });

        controller.cleanup();
        controller.cleanup();
        expect(controller.getState().disposed).toBe(true);
        expect(controller.onCombo({ comboCount: 3 })).toBeNull();
    });
});
