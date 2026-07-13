import { describe, expect, it } from 'vitest';

import {
    PHASE_SEAL_ENVELOPE,
    REDUCED_PHASE_SEAL_ENVELOPE,
    SERENITY_WARP_COMBO_MILESTONES,
    SERENITY_WARP_FX_COMMAND,
    SerenityWarpFXController,
    resolveSerenityWarpLockGlyph,
    resolveSerenityWarpLockOrigin,
    samplePhaseSealEnvelope,
} from '../../src/themes/serenity-warp/serenity-warp-fx-controller.js';

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

describe('Serenity Warp lock mapping', () => {
    it('preserves the exact four-cell glyph, color, rotation, and occupied centroid', () => {
        const payload = {
            piece: tPiece(),
            player: 2,
            position: { x: 640, y: 360, z: 4 },
        };
        const glyph = resolveSerenityWarpLockGlyph(payload);
        const origin = resolveSerenityWarpLockOrigin(payload);

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
        expect(origin.sideLane.normalized.x).toBe(0.31);
        expect(origin.sideLane.normalized.y).toBeCloseTo(0.62);
        expect(origin.position).toEqual({ x: 640, y: 360, z: 4 });
        expect(origin.player).toBe(2);
    });

    it('falls back to a canonical four-cell glyph for a malformed shape', () => {
        const glyph = resolveSerenityWarpLockGlyph({
            piece: {
                type: 'I',
                x: 1,
                y: 8,
                shape: [[1, 1]],
            },
        });

        expect(glyph.type).toBe('I');
        expect(glyph.cells).toHaveLength(4);
        expect(glyph.shape).toEqual([[1, 1, 1, 1]]);
        expect(glyph.color).toBe('#52ef32');
    });
});

describe('Serenity Warp Phase Seal', () => {
    it('queues one flat, immutable lock envelope without escalation', () => {
        const controller = new SerenityWarpFXController({ clock: () => 125 });
        const payload = { piece: tPiece(), player: 1 };

        const first = controller.onPieceLock(payload);
        payload.piece.shape[0][0] = 0;
        payload.piece.color = '#000000';
        payload.piece.x = 9;
        const second = controller.onPieceLock({ piece: tPiece({ x: 5 }), player: 1 });
        const commands = controller.drainCommands();

        expect(first).toMatchObject({
            type: SERENITY_WARP_FX_COMMAND.PHASE_SEAL,
            issuedAtMs: 125,
            durationMs: 550,
            intensity: 0.36,
            motionScale: 1,
            envelope: PHASE_SEAL_ENVELOPE,
            moteCount: 4,
            ringCount: 1,
        });
        expect(second.intensity).toBe(first.intensity);
        expect(commands[0].glyph.shape).toEqual([
            [1, 1, 1],
            [0, 1, 0],
        ]);
        expect(commands[0].glyph.color).toBe('#abc123');
        expect(commands[0].origin.board.x).toBe(4.5);
    });

    it('samples normal and reduced-motion envelopes without timers', () => {
        expect(samplePhaseSealEnvelope(0)).toMatchObject({
            opacity: 1,
            scale: 1.12,
            moteProgress: 0,
            ringProgress: 0,
            complete: false,
        });
        expect(samplePhaseSealEnvelope(160)).toMatchObject({
            scale: 1,
            moteProgress: 1,
        });
        expect(samplePhaseSealEnvelope(PHASE_SEAL_ENVELOPE.durationMs).complete).toBe(true);

        const reduced = samplePhaseSealEnvelope(20, true);
        expect(reduced).toMatchObject({
            scale: 1,
            moteOpacity: 0,
            ringOpacity: 0,
            ringProgress: 0,
        });
        expect(samplePhaseSealEnvelope(REDUCED_PHASE_SEAL_ENVELOPE.durationMs, true).complete).toBe(
            true,
        );
    });
});

describe('Serenity Warp command routing', () => {
    it('emits LINE_CLEAR immediately with canonical fields and row-aligned origin', () => {
        const controller = new SerenityWarpFXController({ clock: () => 500 });
        controller.onPieceLock({ piece: tPiece(), player: 1 });
        controller.drainCommands();

        const command = controller.onLineClear({
            lineCount: 4,
            clearedRows: [20, 21, 22, 23],
            cascadeCount: 2,
            player: 1,
        });

        expect(command).toMatchObject({
            type: SERENITY_WARP_FX_COMMAND.LINE_CLEAR,
            issuedAtMs: 500,
            immediate: true,
            lineCount: 4,
            cascadeCount: 2,
            clearedRows: [20, 21, 22, 23],
            player: 1,
        });
        expect(command.origin.board.y).toBe(22);
        expect(command.origin.sideLane.normalized.y).toBeCloseTo(0.756);
    });

    it('deduplicates combo milestones, resets on a lower count, and isolates players', () => {
        const controller = new SerenityWarpFXController({ clock: () => 1000 });
        expect(SERENITY_WARP_COMBO_MILESTONES).toEqual([2, 3, 6, 10]);

        const playerOneTwo = controller.onCombo({ comboCount: 2, player: 1 });
        expect(playerOneTwo).toMatchObject({ milestone: 2, stage: 'echo', player: 1 });
        expect(controller.onCombo({ comboCount: 2, player: 1 })).toBeNull();

        const playerTwoTwo = controller.onCombo({ comboCount: 2, player: 2 });
        expect(playerTwoTwo).toMatchObject({ milestone: 2, stage: 'echo', player: 2 });

        expect(controller.onCombo({ comboCount: 3, player: 1 })).toMatchObject({
            milestone: 3,
            stage: 'constellation',
        });
        expect(controller.onCombo({ comboCount: 6, player: 1 })).toMatchObject({
            milestone: 6,
            stage: 'aperture',
        });
        expect(controller.onCombo({ comboCount: 10, player: 1 })).toMatchObject({
            milestone: 10,
            stage: 'sevenfold',
            inhaleMs: 120,
        });
        expect(controller.onCombo({ comboCount: 11, player: 1 })).toBeNull();

        expect(controller.onCombo({ comboCount: 1, player: 1 })).toBeNull();
        expect(controller.onCombo({ comboCount: 2, player: 1 })).toMatchObject({
            milestone: 2,
            stage: 'echo',
            player: 1,
        });
        expect(controller.onCombo({ comboCount: 3, player: 2 })).toMatchObject({
            milestone: 3,
            stage: 'constellation',
            player: 2,
        });
    });

    it('coalesces skipped combo counts to the strongest newly reached stage', () => {
        const controller = new SerenityWarpFXController();

        expect(controller.onCombo({ comboCount: 7 })).toMatchObject({
            milestone: 6,
            stage: 'aperture',
        });
        expect(controller.onCombo({ comboCount: 9 })).toBeNull();
        expect(controller.onCombo({ comboCount: 10 })).toMatchObject({
            milestone: 10,
            stage: 'sevenfold',
        });
    });

    it('routes T-spin, perfect-clear, and active B2B commands', () => {
        const controller = new SerenityWarpFXController({ clock: () => 80 });

        expect(controller.dispatch('TSPIN', { lineCount: 0, player: 3 })).toMatchObject({
            type: SERENITY_WARP_FX_COMMAND.MOBIUS_TWIST,
            lineCount: 0,
            reverseHueOrder: true,
            player: 3,
        });
        expect(controller.dispatch('perfectClear', { depth: 3, player: 3 })).toMatchObject({
            type: SERENITY_WARP_FX_COMMAND.PERFECT_CLEAR,
            depth: 3,
            player: 3,
        });
        expect(controller.dispatch('b2b', { active: false, player: 3 })).toBeNull();
        expect(controller.dispatch('B2B', { active: true, player: 3 })).toMatchObject({
            type: SERENITY_WARP_FX_COMMAND.B2B_ECHO,
            delayMs: 180,
            echoCount: 1,
            player: 3,
        });
        expect(controller.dispatch('not-an-event', {})).toBeNull();
        expect(controller.dispatch('toString', {})).toBeNull();
    });

    it('applies reduced motion and an explicit intensity multiplier', () => {
        const controller = new SerenityWarpFXController({
            clock: () => 60,
            reducedMotion: true,
            intensityMultiplier: 0.5,
        });
        const lock = controller.onPieceLock({ piece: tPiece() });
        const gate = controller.onCombo({ comboCount: 10 });

        expect(lock).toMatchObject({
            reducedMotion: true,
            motionScale: 0,
            durationMs: 180,
            envelope: REDUCED_PHASE_SEAL_ENVELOPE,
            moteCount: 0,
            ringCount: 0,
        });
        expect(lock.intensity).toBeCloseTo(0.36 * 0.5 * 0.45);
        expect(gate).toMatchObject({
            reducedMotion: true,
            motionScale: 0,
            durationMs: 260,
            inhaleMs: 0,
        });
        expect(gate.intensity).toBeCloseTo(1 * 0.5 * 0.45);
    });

    it('keeps the queue bounded by dropping stale commands first', () => {
        let now = 0;
        const controller = new SerenityWarpFXController({
            clock: () => {
                now += 1;
                return now;
            },
            maxCommands: 3,
        });

        for (let index = 0; index < 5; index += 1) {
            controller.onLineClear({ lineCount: 1, clearedRows: [], cascadeCount: 1 });
        }

        expect(controller.getState()).toMatchObject({
            pendingCommandCount: 3,
            droppedCommandCount: 2,
        });
        expect(controller.drainCommands().map((command) => command.id)).toEqual([3, 4, 5]);
        expect(controller.drainCommands()).toEqual([]);
    });

    it('uses one monotonic clock sample per event', () => {
        const times = [100, 90, 120];
        let samples = 0;
        const controller = new SerenityWarpFXController({
            clock: () => {
                const value = times[samples];
                samples += 1;
                return value;
            },
        });

        controller.onPieceLock({ piece: tPiece() });
        controller.onLineClear({ lineCount: 1, clearedRows: [], cascadeCount: 1 });
        controller.onB2B({ active: true });
        const commands = controller.drainCommands();

        expect(samples).toBe(3);
        expect(commands.map((command) => command.issuedAtMs)).toEqual([100, 100, 120]);
        expect(controller.playerStates.get('global').recentSeals[0].issuedAtMs).toBe(100);
    });

    it('resets deterministically and disposes idempotently', () => {
        const controller = new SerenityWarpFXController({ clock: () => 25 });
        controller.onLineClear({ lineCount: 2, clearedRows: [], cascadeCount: 1 });
        controller.reset();

        expect(controller.getState()).toMatchObject({
            pendingCommandCount: 0,
            droppedCommandCount: 0,
            playerCount: 0,
            disposed: false,
        });
        expect(controller.onB2B({ active: true }).id).toBe(1);

        controller.cleanup();
        controller.cleanup();
        expect(controller.getState()).toMatchObject({
            pendingCommandCount: 0,
            playerCount: 0,
            disposed: true,
        });
        expect(controller.onLineClear({ lineCount: 1 })).toBeNull();
        expect(controller.drainCommands()).toEqual([]);

        controller.reset();
        expect(controller.onLineClear({ lineCount: 1 }).id).toBe(1);
    });
});
